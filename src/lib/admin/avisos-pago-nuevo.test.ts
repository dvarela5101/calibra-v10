import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import type { Database } from "@/lib/supabase/tipos";

// HU-034 sin base ni red: un cliente falso que solo sabe las cadenas que usa el código y un envío falso.
// La prueba de integración comprueba el cableado con la base y con Auth reales.

const admin = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => admin.cliente }));

import { MAXIMO_DE_INTENTOS, PRESUPUESTO_DE_CORRIDA_MS } from "@/lib/citas/servidor";
import { LOTE_DE_AVISOS_DE_PAGO_NUEVO, procesarAvisosDePagoNuevo, reconstruirAvisoPagoNuevo, type DependenciasDeAvisosDePagoNuevo } from "./avisos-pago-nuevo";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const PAGO_ID = id(10);
const UNO = id(1);
const DOS = id(2);
const TRES = id(3);

type FilaDeAviso = { id: string; id_pago: string; id_admin: string; intentos: number };
type FilaDePago = { estado: "en_revision" | "aprobado" | "rechazado"; nombre_pagador: string; monto: number; id_admin?: string };
type FilaDeAdmin = { id: string; nombre: string; correo: string };
type Cuenta = { id: string; banned_until?: string | null } | null;

const ADMINS: FilaDeAdmin[] = [
  { id: UNO, nombre: "Admin Uno", correo: "uno@calibra.test" },
  { id: DOS, nombre: "Admin Dos", correo: "dos@calibra.test" },
  { id: TRES, nombre: "Admin Tres", correo: "tres@calibra.test" },
];

/** `id_admin` del pago es otro que el responsable del aviso: si el código lo leyera, el nombre del responsable saldría mal. */
const PAGO_EN_REVISION: FilaDePago = { estado: "en_revision", nombre_pagador: "Ana Pérez", monto: 25_000, id_admin: TRES };

type Opciones = {
  pago?: (idPago: string) => FilaDePago | null;
  /** Quién era el responsable al llegar el pago, por (pago, admin). Por defecto, UNO. */
  responsable?: (idPago: string, idAdmin: string) => string | null;
  admins?: FilaDeAdmin[];
  cuenta?: (idAdmin: string) => Cuenta;
  errorAlLeer?: string;
  errorAlMarcar?: string;
  errorAlLeerPago?: string;
  errorAlLeerAviso?: string;
  errorAlLeerAdmins?: string;
  errorDeAuth?: string;
};

type Cambio = { id: string; cambios: { procesado_en?: string; intentos?: number } };

function clienteFalso(avisos: FilaDeAviso[], opciones: Opciones = {}) {
  const consultas: string[] = [];
  const cambios: Cambio[] = [];
  const usuariosPedidos: string[] = [];
  const admins = opciones.admins ?? ADMINS;

  /** El select con filtros `.eq(...)` encadenados que acaba en `.maybeSingle()` o, para los admins, en `.in(...)`. */
  const seleccion = (tabla: string, columnas: string) => {
    const filtros: Record<string, string> = {};
    const consulta = {
      eq: (columna: string, valor: string) => {
        filtros[columna] = valor;
        return consulta;
      },
      in: async (columna: string, valores: string[]) => {
        consultas.push(`${tabla}.select(${columnas}).in(${columna},${valores.join("|")})`);
        if (opciones.errorAlLeerAdmins) return { data: null, error: { message: opciones.errorAlLeerAdmins } };
        return { data: admins.filter((a) => valores.includes(a.id)), error: null };
      },
      maybeSingle: async () => {
        consultas.push(`${tabla}.select(${columnas}).${Object.entries(filtros).map(([c, v]) => `eq(${c},${v})`).join(".")}`);
        if (tabla === "pago") {
          if (opciones.errorAlLeerPago) return { data: null, error: { message: opciones.errorAlLeerPago } };
          return { data: (opciones.pago ? opciones.pago(filtros.id) : PAGO_EN_REVISION) ?? null, error: null };
        }
        if (opciones.errorAlLeerAviso) return { data: null, error: { message: opciones.errorAlLeerAviso } };
        const responsable = opciones.responsable ? opciones.responsable(filtros.id_pago, filtros.id_admin) : UNO;
        return { data: responsable ? { id_responsable: responsable } : null, error: null };
      },
    };
    return consulta;
  };

  const cliente = {
    from: (tabla: string) => ({
      select: (columnas: string) => ({
        // La bandeja de salida: .is().order().limit()
        is: (columna: string, valor: null) => ({
          order: (orden: string) => ({
            limit: async (limite: number) => {
              consultas.push(`${tabla}.select(${columnas}).is(${columna},${valor}).order(${orden}).limit(${limite})`);
              return opciones.errorAlLeer ? { data: null, error: { message: opciones.errorAlLeer } } : { data: avisos, error: null };
            },
          }),
        }),
        ...seleccion(tabla, columnas),
      }),
      update: (campos: Cambio["cambios"]) => ({
        eq: async (_columna: string, valor: string) => {
          consultas.push(`${tabla}.update`);
          cambios.push({ id: valor, cambios: campos });
          return { error: opciones.errorAlMarcar ? { message: opciones.errorAlMarcar } : null };
        },
      }),
    }),
    auth: {
      admin: {
        getUserById: async (idAdmin: string) => {
          usuariosPedidos.push(idAdmin);
          if (opciones.errorDeAuth) return { data: { user: null }, error: { message: opciones.errorDeAuth } };
          const cuenta = opciones.cuenta ? opciones.cuenta(idAdmin) : { id: idAdmin };
          return { data: { user: cuenta }, error: null };
        },
      },
    },
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, consultas, cambios, usuariosPedidos };
}

const ENVIADO: ResultadoEnvio = { ok: true, yaEnviado: false, intentos: 1, idProveedor: "p-1" };

function dependenciasCon(cliente: SupabaseClient<Database>, enviar: ResultadoEnvio | (() => Promise<ResultadoEnvio>) = ENVIADO) {
  const enviarFalso = vi.fn(async () => (typeof enviar === "function" ? enviar() : enviar));
  const dependencias = { cliente, enviar: enviarFalso as unknown as DependenciasDeAvisosDePagoNuevo["enviar"], reloj: () => 0 };
  return { dependencias, enviar: enviarFalso };
}

const entradaDe = (enviar: ReturnType<typeof vi.fn>, n = 0) =>
  (enviar.mock.calls as unknown as [{ plantilla: string; entidad: string; destinatario: string; datos: Record<string, unknown> }][])[n][0];

const aviso = (n: number, idAdmin: string, idPago = PAGO_ID, intentos = 0): FilaDeAviso => ({ id: id(100 + n), id_pago: idPago, id_admin: idAdmin, intentos });

beforeEach(() => {
  vi.stubEnv("SITIO_URL", "https://calibra.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  admin.cliente = null;
});

describe("reconstruirAvisoPagoNuevo (HU-034, HU-065)", () => {
  const entidad = (idAdmin: string, idPago = PAGO_ID) => `${idPago}:${idAdmin}`;

  it("el destinatario es el responsable: correo a su dirección, «Te toca a ti» (nombreResponsable nulo) y enlace al pago", async () => {
    const { cliente } = clienteFalso([]);
    expect(await reconstruirAvisoPagoNuevo(entidad(UNO), cliente)).toEqual({
      destinatario: "uno@calibra.test",
      datos: {
        nombreAdmin: "Admin Uno",
        nombrePagador: "Ana Pérez",
        monto: 25_000,
        nombreResponsable: null,
        enlace: `https://calibra.test/admin/pagos/${PAGO_ID}`,
      },
    });
  });

  it("el destinatario no es el responsable: el correo lleva el nombre del responsable", async () => {
    const { cliente } = clienteFalso([]);
    expect(await reconstruirAvisoPagoNuevo(entidad(DOS), cliente)).toEqual({
      destinatario: "dos@calibra.test",
      datos: {
        nombreAdmin: "Admin Dos",
        nombrePagador: "Ana Pérez",
        monto: 25_000,
        nombreResponsable: "Admin Uno",
        enlace: `https://calibra.test/admin/pagos/${PAGO_ID}`,
      },
    });
  });

  it("el responsable es el de la foto del aviso, no el id_admin del pago: un pago reasignado da el mismo correo", async () => {
    // El pago ya es de TRES (id_admin), pero al llegar le tocaba a UNO; el aviso de DOS lo dice.
    const { cliente, consultas } = clienteFalso([]);
    const correo = await reconstruirAvisoPagoNuevo(entidad(DOS), cliente);
    expect(correo?.datos.nombreResponsable).toBe("Admin Uno");
    expect(consultas).toEqual([
      `pago.select(estado, nombre_pagador, monto).eq(id,${PAGO_ID})`,
      `aviso_pago_nuevo.select(id_responsable).eq(id_pago,${PAGO_ID}).eq(id_admin,${DOS})`,
      `admin.select(id, nombre, correo).in(id,${DOS}|${UNO})`,
    ]);
    // No lee id_admin ni fecha_asignacion del pago.
    expect(consultas[0]).not.toContain("id_admin");
  });

  it("si el responsable de la foto fue otro admin, dice el suyo aunque el pago haya pasado por varios", async () => {
    const { cliente } = clienteFalso([], { responsable: () => TRES });
    const correo = await reconstruirAvisoPagoNuevo(entidad(UNO), cliente);
    expect(correo?.datos.nombreResponsable).toBe("Admin Tres");
  });

  it("un reintento da el mismo correo que el primer envío", async () => {
    const primero = await reconstruirAvisoPagoNuevo(entidad(DOS), clienteFalso([]).cliente);
    const reintento = await reconstruirAvisoPagoNuevo(entidad(DOS), clienteFalso([]).cliente);
    expect(reintento).toEqual(primero);
  });

  it.each(["aprobado", "rechazado"] as const)("es nulo si el pago ya está %s, y no pregunta a Auth", async (estado) => {
    const { cliente, usuariosPedidos } = clienteFalso([], { pago: () => ({ ...PAGO_EN_REVISION, estado }) });
    expect(await reconstruirAvisoPagoNuevo(entidad(UNO), cliente)).toBeNull();
    expect(usuariosPedidos).toEqual([]);
  });

  it("es nulo si el pago no existe", async () => {
    expect(await reconstruirAvisoPagoNuevo(entidad(UNO), clienteFalso([], { pago: () => null }).cliente)).toBeNull();
  });

  it("es nulo si el admin no existe (ni en la tabla ni en Auth)", async () => {
    const sinElAdmin = ADMINS.filter((a) => a.id !== DOS);
    expect(await reconstruirAvisoPagoNuevo(entidad(DOS), clienteFalso([], { admins: sinElAdmin }).cliente)).toBeNull();
    expect(await reconstruirAvisoPagoNuevo(entidad(DOS), clienteFalso([], { cuenta: () => null }).cliente)).toBeNull();
  });

  it("es nulo si el admin está baneado en Auth, y no si el baneo ya venció", async () => {
    const baneado = clienteFalso([], { cuenta: (idAdmin) => ({ id: idAdmin, banned_until: "2126-10-14T12:00:00.000Z" }) });
    expect(await reconstruirAvisoPagoNuevo(entidad(DOS), baneado.cliente)).toBeNull();
    expect(baneado.usuariosPedidos).toEqual([DOS]);

    const vencido = clienteFalso([], { cuenta: (idAdmin) => ({ id: idAdmin, banned_until: "2020-01-01T00:00:00.000Z" }) });
    expect(await reconstruirAvisoPagoNuevo(entidad(DOS), vencido.cliente)).not.toBeNull();
    expect(await reconstruirAvisoPagoNuevo(entidad(DOS), vencido.cliente, new Date("2019-12-31T00:00:00.000Z"))).toBeNull();
  });

  it("solo mira al destinatario en Auth, no al responsable", async () => {
    const { cliente, usuariosPedidos } = clienteFalso([], { cuenta: (idAdmin) => ({ id: idAdmin, banned_until: idAdmin === UNO ? "2126-10-14T12:00:00.000Z" : null }) });
    // El responsable (UNO) está baneado, pero el destinatario (DOS) no: el aviso sale.
    expect(await reconstruirAvisoPagoNuevo(entidad(DOS), cliente)).not.toBeNull();
    expect(usuariosPedidos).toEqual([DOS]);
  });

  it("es nulo si no hay aviso para ese pago y ese admin", async () => {
    expect(await reconstruirAvisoPagoNuevo(entidad(UNO), clienteFalso([], { responsable: () => null }).cliente)).toBeNull();
  });

  it("es nulo si la entidad no es <id_pago>:<id_admin>, sin leer nada", async () => {
    for (const mala of ["", PAGO_ID, `${PAGO_ID}:no-es-un-id`, `${PAGO_ID}:${UNO}:1`]) {
      const { cliente, consultas } = clienteFalso([]);
      expect(await reconstruirAvisoPagoNuevo(mala, cliente), mala).toBeNull();
      expect(consultas, mala).toEqual([]);
    }
  });

  it("no lleva el contacto del pagador, el comprobante ni la comisión", async () => {
    const { cliente } = clienteFalso([], { pago: () => ({ ...PAGO_EN_REVISION, contacto: "ana@calibra.test", comision: 5_000 } as FilaDePago) });
    const correo = await reconstruirAvisoPagoNuevo(entidad(DOS), cliente);
    expect(Object.keys(correo!.datos).sort()).toEqual(["enlace", "monto", "nombreAdmin", "nombrePagador", "nombreResponsable"]);
    expect(JSON.stringify(correo)).not.toContain("ana@calibra.test");
  });

  it("usa la llave secreta por defecto", async () => {
    admin.cliente = clienteFalso([]).cliente;
    expect(await reconstruirAvisoPagoNuevo(entidad(UNO))).not.toBeNull();
  });

  it.each([
    ["el pago", { errorAlLeerPago: "caída" }, "No se pudo leer el pago nuevo: caída"],
    ["el aviso", { errorAlLeerAviso: "caída" }, "No se pudo leer el aviso del pago nuevo: caída"],
    ["los admins", { errorAlLeerAdmins: "caída" }, "No se pudieron leer los admins del aviso: caída"],
    ["la cuenta de Auth", { errorDeAuth: "caída" }, "No se pudo leer la cuenta del admin: caída"],
  ] as [string, Opciones, string][])("lanza si no puede leer %s (el aviso se reintenta, no se descarta)", async (_nombre, opciones, mensaje) => {
    await expect(reconstruirAvisoPagoNuevo(entidad(UNO), clienteFalso([], opciones).cliente)).rejects.toThrow(mensaje);
  });
});

describe("procesarAvisosDePagoNuevo (HU-034)", () => {
  it("manda aviso_admin_pago_nuevo con <id_pago>:<id_admin> como entidad al correo del admin y lo marca procesado", async () => {
    const { cliente, consultas, cambios } = clienteFalso([aviso(1, DOS)]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDePagoNuevo(dependencias);
    expect(resumen).toEqual({ revisadas: 1, enviadas: 1, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(consultas[0]).toBe(
      `aviso_pago_nuevo.select(id, id_pago, id_admin, intentos).is(procesado_en,null).order(creado_en).limit(${LOTE_DE_AVISOS_DE_PAGO_NUEVO})`,
    );
    expect(LOTE_DE_AVISOS_DE_PAGO_NUEVO).toBe(10);
    expect(enviar).toHaveBeenCalledOnce();
    expect(entradaDe(enviar)).toMatchObject({
      plantilla: "aviso_admin_pago_nuevo",
      entidad: `${PAGO_ID}:${DOS}`,
      destinatario: "dos@calibra.test",
      datos: { nombreAdmin: "Admin Dos", nombrePagador: "Ana Pérez", monto: 25_000, nombreResponsable: "Admin Uno" },
    });
    expect(cambios).toHaveLength(1);
    expect(cambios[0].id).toBe(id(101));
    expect(Object.keys(cambios[0].cambios)).toEqual(["procesado_en"]);
  });

  it("un pago nuevo con tres admins activos: un correo por admin, cada uno con su entidad y su «te toca»", async () => {
    const { cliente } = clienteFalso([aviso(1, UNO), aviso(2, DOS), aviso(3, TRES)]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDePagoNuevo(dependencias);
    expect(resumen).toMatchObject({ revisadas: 3, enviadas: 3 });
    expect([0, 1, 2].map((n) => entradaDe(enviar, n).entidad)).toEqual([`${PAGO_ID}:${UNO}`, `${PAGO_ID}:${DOS}`, `${PAGO_ID}:${TRES}`]);
    expect([0, 1, 2].map((n) => entradaDe(enviar, n).datos.nombreResponsable)).toEqual([null, "Admin Uno", "Admin Uno"]);
  });

  it("descarta el que ya no vale (pago revisado, admin desactivado o inexistente), sin mandar nada, y lo marca procesado", async () => {
    const filas = [aviso(1, UNO, id(11)), aviso(2, DOS), aviso(3, TRES), aviso(4, id(4))];
    const { cliente, cambios } = clienteFalso(filas, {
      // id(11): el pago ya se aprobó; DOS: baneado en Auth; TRES: sin cuenta en Auth; id(4): ni siquiera es un admin.
      pago: (idPago) => (idPago === id(11) ? { ...PAGO_EN_REVISION, estado: "aprobado" } : PAGO_EN_REVISION),
      cuenta: (idAdmin) => (idAdmin === TRES ? null : { id: idAdmin, banned_until: idAdmin === DOS ? "2126-10-14T12:00:00.000Z" : null }),
    });
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDePagoNuevo(dependencias);
    expect(resumen).toMatchObject({ revisadas: 4, descartadas: 4, enviadas: 0, conError: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(101), id(102), id(103), id(104)]);
    expect(cambios.every((c) => Object.keys(c.cambios).join() === "procesado_en")).toBe(true);
  });

  it("descarta un aviso cuya entidad no es válida (el id del pago no es un uuid)", async () => {
    const { cliente, cambios } = clienteFalso([aviso(1, UNO, "no-es-un-id")]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDePagoNuevo(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, descartadas: 1, enviadas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(101)]);
  });

  it("cuenta el correo fallido y el tomado por otra corrida, y marca ambos procesados", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([aviso(1, UNO), aviso(2, DOS)]);
    const respuestas: ResultadoEnvio[] = [
      { ok: false, motivo: "fallo_del_proveedor", error: "caído", intentos: 3 },
      { ok: false, motivo: "en_curso", error: "otra corrida", intentos: 0 },
    ];
    const { dependencias } = dependenciasCon(cliente, async () => respuestas.shift()!);
    const resumen = await procesarAvisosDePagoNuevo(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, fallidas: 1, tomadasPorOtro: 1, enviadas: 0, conError: 0 });
    expect(cambios.map((c) => c.id)).toEqual([id(101), id(102)]);
  });

  it("dos corridas a la vez: la que llega segunda ve ya enviado y el aviso queda procesado una sola vez por corrida", async () => {
    const filas = [aviso(1, DOS)];
    const primera = dependenciasCon(clienteFalso(filas).cliente);
    const segunda = dependenciasCon(clienteFalso(filas).cliente, { ok: true, yaEnviado: true, intentos: 0, idProveedor: null });
    await Promise.all([procesarAvisosDePagoNuevo(primera.dependencias), procesarAvisosDePagoNuevo(segunda.dependencias)]);
    // Ambas piden el mismo correo con la misma entidad: la clave única del registro deja pasar solo uno.
    expect(entradaDe(primera.enviar).entidad).toBe(entradaDe(segunda.enviar).entidad);
    expect(entradaDe(primera.enviar).entidad).toBe(`${PAGO_ID}:${DOS}`);
  });

  it("si el registro del correo falla (fallo_del_registro), suma un intento y no lo marca procesado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([aviso(1, UNO, PAGO_ID, 1)]);
    const { dependencias } = dependenciasCon(cliente, { ok: false, motivo: "fallo_del_registro", error: "sin base", intentos: 0 });
    const resumen = await procesarAvisosDePagoNuevo(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, conError: 1, enviadas: 0 });
    expect(cambios).toEqual([{ id: id(101), cambios: { intentos: 2 } }]);
  });

  it("si la base o Auth fallan al reconstruir el correo, suma un intento y no lo marca procesado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const opciones of [{ errorAlLeerPago: "sin permiso" }, { errorDeAuth: "sin red" }]) {
      const { cliente, cambios } = clienteFalso([aviso(1, UNO)], opciones);
      const { dependencias, enviar } = dependenciasCon(cliente);
      const resumen = await procesarAvisosDePagoNuevo(dependencias);
      expect(resumen).toMatchObject({ revisadas: 1, conError: 1, enviadas: 0, descartadas: 0 });
      expect(enviar).not.toHaveBeenCalled();
      expect(cambios).toEqual([{ id: id(101), cambios: { intentos: 1 } }]);
    }
  });

  it("al llegar al quinto intento fallido lo abandona: queda procesado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(MAXIMO_DE_INTENTOS).toBe(5);
    const { cliente, cambios } = clienteFalso([aviso(1, UNO, PAGO_ID, MAXIMO_DE_INTENTOS - 1)]);
    const { dependencias } = dependenciasCon(cliente, { ok: false, motivo: "fallo_del_registro", error: "sin base", intentos: 0 });
    const resumen = await procesarAvisosDePagoNuevo(dependencias);
    expect(resumen.conError).toBe(1);
    expect(cambios).toHaveLength(1);
    expect(cambios[0].cambios.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(cambios[0].cambios.procesado_en).toBeTruthy();
  });

  it("antes del quinto intento no lo abandona", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([aviso(1, UNO, PAGO_ID, MAXIMO_DE_INTENTOS - 2)]);
    const { dependencias } = dependenciasCon(cliente, async () => {
      throw new Error("boom");
    });
    await procesarAvisosDePagoNuevo(dependencias);
    expect(cambios).toEqual([{ id: id(101), cambios: { intentos: MAXIMO_DE_INTENTOS - 1 } }]);
  });

  it("un error en uno no detiene a los demás", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([aviso(1, UNO), aviso(2, DOS)]);
    let n = 0;
    const { dependencias, enviar } = dependenciasCon(cliente, async () => {
      if (n++ === 0) throw new Error("boom");
      return ENVIADO;
    });
    const resumen = await procesarAvisosDePagoNuevo(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, conError: 1, enviadas: 1 });
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(cambios.map((c) => c.id)).toEqual([id(101), id(102)]);
  });

  it("el log de una falla nombra el pago y el admin por su id, nunca el correo ni el nombre", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteFalso([aviso(1, DOS)]);
    const { dependencias } = dependenciasCon(cliente, async () => {
      throw new Error("boom");
    });
    await procesarAvisosDePagoNuevo(dependencias);
    const registrado = error.mock.calls.flat().join(" ");
    expect(registrado).toContain(PAGO_ID);
    expect(registrado).toContain(DOS);
    expect(registrado).not.toContain("dos@calibra.test");
    expect(registrado).not.toContain("Admin Dos");
    expect(registrado).not.toContain("Ana Pérez");
  });

  it("pasado el presupuesto de tiempo pospone los que quedan", async () => {
    const { cliente, cambios } = clienteFalso([aviso(1, UNO), aviso(2, DOS), aviso(3, TRES)]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    let ahora = 0;
    const enviarYAvanzar = vi.fn(async () => {
      ahora += PRESUPUESTO_DE_CORRIDA_MS;
      return ENVIADO;
    });
    const resumen = await procesarAvisosDePagoNuevo({
      ...dependencias,
      enviar: enviarYAvanzar as unknown as DependenciasDeAvisosDePagoNuevo["enviar"],
      reloj: () => ahora,
    });
    expect(resumen).toMatchObject({ revisadas: 3, enviadas: 1, pospuestas: 2 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(101)]);
  });

  it("lanza si no puede leer los avisos", async () => {
    const { cliente } = clienteFalso([], { errorAlLeer: "sin permiso" });
    const { dependencias } = dependenciasCon(cliente);
    await expect(procesarAvisosDePagoNuevo(dependencias)).rejects.toThrow("No se pudieron leer los avisos de pago nuevo: sin permiso");
  });

  it("si no puede marcar el aviso, lo cuenta como error y lo deja para otra corrida", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([aviso(1, UNO)], { errorAlMarcar: "sin base" });
    const { dependencias } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDePagoNuevo(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, enviadas: 1, conError: 1 });
    expect(cambios.map((c) => c.cambios)).toEqual([{ procesado_en: expect.any(String) }, { intentos: 1 }]);
  });

  it("sin avisos no hace nada", async () => {
    const { cliente, cambios } = clienteFalso([]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDePagoNuevo(dependencias);
    expect(resumen).toEqual({ revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios).toEqual([]);
  });

  it("sin dependencias usa el cliente de la llave secreta", async () => {
    admin.cliente = clienteFalso([]).cliente;
    expect(await procesarAvisosDePagoNuevo()).toMatchObject({ revisadas: 0 });
  });
});

describe("el literal de la plantilla (pruebas/reconstructores.test.ts lo busca en el código)", () => {
  it("la llamada a enviar escribe el nombre de su plantilla tal cual", () => {
    const codigo = readFileSync(join(__dirname, "avisos-pago-nuevo.ts"), "utf8");
    expect(codigo).toContain('plantilla: "aviso_admin_pago_nuevo"');
  });
});
