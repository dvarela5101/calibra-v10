import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import type { Database } from "@/lib/supabase/tipos";

// HU-076 sin base ni red: un cliente falso que solo sabe las cadenas que usa el código y un envío falso.
// La prueba de integración comprueba el cableado con la base real.

const admin = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => admin.cliente }));

import { MAXIMO_DE_INTENTOS, PRESUPUESTO_DE_CORRIDA_MS } from "@/lib/citas/servidor";
import { LOTE_DE_AVISOS_DE_RECHAZO, procesarAvisosDeRechazoDePago, type DependenciasDeAvisosDeRechazo } from "./avisos-rechazo";
import { reconstruirPagoRechazado, reconstruirPagoRechazadoSinReembolso } from "./pagos";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type FilaDeAviso = { id: string; id_pago: string; caso: string; intentos: number };
type FilaDePago = {
  estado: "en_revision" | "aprobado" | "rechazado";
  contacto: string;
  nombre_pagador: string;
  monto: number;
  monitoria: { estado: "pendiente_pago" | "confirmada" | "realizada" | "cancelada"; motivo_cancelacion: string | null; fecha: string } | null;
};

const PAGO_CITA_CANCELADA: FilaDePago = {
  estado: "rechazado",
  contacto: "ana@calibra.test",
  nombre_pagador: "Ana",
  monto: 25_000,
  monitoria: { estado: "cancelada", motivo_cancelacion: "pago_rechazado", fecha: "2099-01-13" },
};
const PAGO_YA_CANCELADA: FilaDePago = { ...PAGO_CITA_CANCELADA, monitoria: { ...PAGO_CITA_CANCELADA.monitoria!, motivo_cancelacion: "estudiante" } };

type Cambio = { id: string; cambios: { procesado_en?: string; intentos?: number } };

function clienteFalso(
  avisos: FilaDeAviso[],
  opciones: { pago?: (idPago: string) => FilaDePago | null; errorAlLeer?: string; errorAlMarcar?: string; errorAlLeerPago?: string } = {},
) {
  const consultas: string[] = [];
  const cambios: Cambio[] = [];
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
        // El pago: .eq("id", ...).maybeSingle()
        eq: (columna: string, valor: string) => ({
          maybeSingle: async () => {
            consultas.push(`${tabla}.select(${columnas}).eq(${columna},${valor})`);
            if (opciones.errorAlLeerPago) return { data: null, error: { message: opciones.errorAlLeerPago } };
            return { data: (opciones.pago ? opciones.pago(valor) : PAGO_CITA_CANCELADA) ?? null, error: null };
          },
        }),
      }),
      update: (campos: Cambio["cambios"]) => ({
        eq: async (_columna: string, valor: string) => {
          consultas.push(`${tabla}.update`);
          cambios.push({ id: valor, cambios: campos });
          return { error: opciones.errorAlMarcar ? { message: opciones.errorAlMarcar } : null };
        },
      }),
    }),
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, consultas, cambios };
}

const ENVIADO: ResultadoEnvio = { ok: true, yaEnviado: false, intentos: 1, idProveedor: "p-1" };

function dependenciasCon(cliente: SupabaseClient<Database>, enviar: ResultadoEnvio | (() => Promise<ResultadoEnvio>) = ENVIADO) {
  const enviarFalso = vi.fn(async () => (typeof enviar === "function" ? enviar() : enviar));
  const dependencias = { cliente, enviar: enviarFalso as unknown as DependenciasDeAvisosDeRechazo["enviar"], reloj: () => 0 };
  return { dependencias, enviar: enviarFalso };
}

const entradaDe = (enviar: ReturnType<typeof vi.fn>, n = 0) =>
  (enviar.mock.calls as unknown as [{ plantilla: string; entidad: string; destinatario: string; datos: Record<string, unknown> }][])[n][0];

beforeEach(() => {
  vi.stubEnv("CORREO_DATOS_PERSONALES", "ayuda@calibra.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  admin.cliente = null;
});

describe("reconstruirPagoRechazadoSinReembolso (HU-076, D-39 d)", () => {
  it("arma el correo al contacto del pago, con el día de la cita y el soporte de Calibra", async () => {
    const { cliente, consultas } = clienteFalso([], { pago: () => PAGO_YA_CANCELADA });
    expect(await reconstruirPagoRechazadoSinReembolso(id(1), cliente)).toEqual({
      destinatario: "ana@calibra.test",
      datos: { nombre: "Ana", monto: 25_000, fechaSesion: "2099-01-13", contactoSoporte: "ayuda@calibra.test" },
    });
    expect(consultas).toEqual([`pago.select(estado, contacto, nombre_pagador, monto, monitoria(estado, motivo_cancelacion, fecha)).eq(id,${id(1)})`]);
  });

  it("es nulo si la cita no está cancelada por el estudiante, si el pago no existe o si el id no es un uuid", async () => {
    expect(await reconstruirPagoRechazadoSinReembolso(id(1), clienteFalso([], { pago: () => PAGO_CITA_CANCELADA }).cliente)).toBeNull();
    expect(await reconstruirPagoRechazadoSinReembolso(id(1), clienteFalso([], { pago: () => null }).cliente)).toBeNull();
    const { cliente, consultas } = clienteFalso([]);
    expect(await reconstruirPagoRechazadoSinReembolso("no-es-un-id", cliente)).toBeNull();
    expect(consultas).toEqual([]);
  });

  it("usa la llave secreta por defecto y lanza si la base falla", async () => {
    admin.cliente = clienteFalso([], { pago: () => PAGO_YA_CANCELADA }).cliente;
    expect(await reconstruirPagoRechazadoSinReembolso(id(1))).not.toBeNull();
    admin.cliente = clienteFalso([], { errorAlLeerPago: "caída" }).cliente;
    await expect(reconstruirPagoRechazadoSinReembolso(id(1))).rejects.toThrow("No se pudo leer el pago rechazado: caída");
  });
});

describe("reconstruirPagoRechazado (HU-020, sigue igual)", () => {
  it("da el correo de la cita cancelada por el rechazo y nulo en los demás casos", async () => {
    expect(await reconstruirPagoRechazado(id(1), clienteFalso([], { pago: () => PAGO_CITA_CANCELADA }).cliente)).toEqual({
      destinatario: "ana@calibra.test",
      datos: { nombre: "Ana", monto: 25_000, fechaSesion: "2099-01-13", contactoSoporte: "ayuda@calibra.test" },
    });
    expect(await reconstruirPagoRechazado(id(1), clienteFalso([], { pago: () => PAGO_YA_CANCELADA }).cliente)).toBeNull();
    expect(await reconstruirPagoRechazado(id(1), clienteFalso([], { pago: () => ({ ...PAGO_CITA_CANCELADA, estado: "aprobado" }) }).cliente)).toBeNull();
    expect(await reconstruirPagoRechazado(id(1), clienteFalso([], { pago: () => null }).cliente)).toBeNull();
  });
});

describe("procesarAvisosDeRechazoDePago (HU-076)", () => {
  it("cita_cancelada: manda pago_rechazado_individual con el id del pago como entidad y lo marca procesado", async () => {
    const { cliente, consultas, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 }]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen).toEqual({ revisadas: 1, enviadas: 1, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(consultas[0]).toBe(
      `aviso_rechazo_pago.select(id, id_pago, caso, intentos).is(procesado_en,null).order(creado_en).limit(${LOTE_DE_AVISOS_DE_RECHAZO})`,
    );
    expect(LOTE_DE_AVISOS_DE_RECHAZO).toBe(10);
    expect(enviar).toHaveBeenCalledOnce();
    expect(entradaDe(enviar)).toMatchObject({ plantilla: "pago_rechazado_individual", entidad: id(1), destinatario: "ana@calibra.test" });
    expect(cambios).toHaveLength(1);
    expect(cambios[0].id).toBe(id(10));
    expect(Object.keys(cambios[0].cambios)).toEqual(["procesado_en"]);
  });

  it("cita_ya_cancelada: manda pago_rechazado_sin_reembolso con el id del pago como entidad", async () => {
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), caso: "cita_ya_cancelada", intentos: 0 }], {
      pago: () => PAGO_YA_CANCELADA,
    });
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, enviadas: 1, descartadas: 0 });
    expect(entradaDe(enviar)).toMatchObject({
      plantilla: "pago_rechazado_sin_reembolso",
      entidad: id(1),
      destinatario: "ana@calibra.test",
      datos: { nombre: "Ana", monto: 25_000, fechaSesion: "2099-01-13" },
    });
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });

  it("un caso por plantilla: cada aviso manda la suya, en el orden de la bandeja", async () => {
    const { cliente } = clienteFalso(
      [
        { id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 },
        { id: id(11), id_pago: id(2), caso: "cita_ya_cancelada", intentos: 0 },
      ],
      { pago: (idPago) => (idPago === id(1) ? PAGO_CITA_CANCELADA : PAGO_YA_CANCELADA) },
    );
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, enviadas: 2 });
    expect([entradaDe(enviar, 0).plantilla, entradaDe(enviar, 1).plantilla]).toEqual(["pago_rechazado_individual", "pago_rechazado_sin_reembolso"]);
  });

  it("descarta el que ya no vale (el pago cambió, no existe o el caso no se conoce), sin mandar nada, y lo marca procesado", async () => {
    const filas = [
      { id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 },
      { id: id(11), id_pago: id(2), caso: "cita_ya_cancelada", intentos: 0 },
      { id: id(12), id_pago: id(3), caso: "otro_caso", intentos: 0 },
      { id: id(13), id_pago: "no-es-un-id", caso: "cita_cancelada", intentos: 0 },
    ];
    const { cliente, cambios } = clienteFalso(filas, {
      // id(1): el pago ya no está rechazado; id(2): no existe.
      pago: (idPago) => (idPago === id(1) ? { ...PAGO_CITA_CANCELADA, estado: "aprobado" } : null),
    });
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen).toMatchObject({ revisadas: 4, descartadas: 4, enviadas: 0, conError: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11), id(12), id(13)]);
  });

  it("el aviso no caduca: se manda aunque la sesión ya haya pasado", async () => {
    const { cliente } = clienteFalso([{ id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 }], {
      pago: () => ({ ...PAGO_CITA_CANCELADA, monitoria: { ...PAGO_CITA_CANCELADA.monitoria!, fecha: "2020-01-13" } }),
    });
    const { dependencias, enviar } = dependenciasCon(cliente);
    expect(await procesarAvisosDeRechazoDePago(dependencias)).toMatchObject({ enviadas: 1, descartadas: 0 });
    expect(enviar).toHaveBeenCalledOnce();
  });

  it("cuenta el correo fallido y el tomado por otra corrida, y marca ambos procesados", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const filas = [
      { id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 },
      { id: id(11), id_pago: id(2), caso: "cita_cancelada", intentos: 0 },
    ];
    const { cliente, cambios } = clienteFalso(filas);
    const respuestas: ResultadoEnvio[] = [
      { ok: false, motivo: "fallo_del_proveedor", error: "caído", intentos: 3 },
      { ok: false, motivo: "en_curso", error: "otra corrida", intentos: 0 },
    ];
    const { dependencias } = dependenciasCon(cliente, async () => respuestas.shift()!);
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, fallidas: 1, tomadasPorOtro: 1, enviadas: 0, conError: 0 });
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11)]);
  });

  it("un contacto que no es un correo queda como fallido y procesado: la página ya le dijo al admin que avise él", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 }]);
    const { dependencias } = dependenciasCon(cliente, { ok: false, motivo: "contacto_no_es_correo", error: "no es un correo", intentos: 0 });
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, fallidas: 1, conError: 0 });
    expect(Object.keys(cambios[0].cambios)).toEqual(["procesado_en"]);
  });

  it("si el registro del correo falla (fallo_del_registro), suma un intento y no lo marca procesado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 1 }]);
    const { dependencias } = dependenciasCon(cliente, { ok: false, motivo: "fallo_del_registro", error: "sin base", intentos: 0 });
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, conError: 1, enviadas: 0 });
    expect(cambios).toEqual([{ id: id(10), cambios: { intentos: 2 } }]);
  });

  it("si la base falla al reconstruir el correo, suma un intento y no lo marca procesado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 }], { errorAlLeerPago: "sin permiso" });
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, conError: 1, enviadas: 0, descartadas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios).toEqual([{ id: id(10), cambios: { intentos: 1 } }]);
  });

  it("al llegar al quinto intento fallido lo abandona: queda procesado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(MAXIMO_DE_INTENTOS).toBe(5);
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: MAXIMO_DE_INTENTOS - 1 }]);
    const { dependencias } = dependenciasCon(cliente, { ok: false, motivo: "fallo_del_registro", error: "sin base", intentos: 0 });
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen.conError).toBe(1);
    expect(cambios).toHaveLength(1);
    expect(cambios[0].cambios.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(cambios[0].cambios.procesado_en).toBeTruthy();
  });

  it("antes del quinto intento no lo abandona", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: MAXIMO_DE_INTENTOS - 2 }]);
    const { dependencias } = dependenciasCon(cliente, async () => {
      throw new Error("boom");
    });
    await procesarAvisosDeRechazoDePago(dependencias);
    expect(cambios).toEqual([{ id: id(10), cambios: { intentos: MAXIMO_DE_INTENTOS - 1 } }]);
  });

  it("un error en uno no detiene a los demás", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const filas = [
      { id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 },
      { id: id(11), id_pago: id(2), caso: "cita_cancelada", intentos: 0 },
    ];
    const { cliente, cambios } = clienteFalso(filas);
    let n = 0;
    const { dependencias, enviar } = dependenciasCon(cliente, async () => {
      if (n++ === 0) throw new Error("boom");
      return ENVIADO;
    });
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, conError: 1, enviadas: 1 });
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11)]);
  });

  it("el log de una falla nombra el pago y nunca el contacto del pagador", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteFalso([{ id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 }]);
    const { dependencias } = dependenciasCon(cliente, async () => {
      throw new Error("boom");
    });
    await procesarAvisosDeRechazoDePago(dependencias);
    const registrado = error.mock.calls.flat().join(" ");
    expect(registrado).toContain(id(1));
    expect(registrado).not.toContain("ana@calibra.test");
  });

  it("pasado el presupuesto de tiempo pospone los que quedan", async () => {
    const filas = [
      { id: id(10), id_pago: id(1), caso: "cita_cancelada", intentos: 0 },
      { id: id(11), id_pago: id(2), caso: "cita_cancelada", intentos: 0 },
      { id: id(12), id_pago: id(3), caso: "cita_cancelada", intentos: 0 },
    ];
    const { cliente, cambios } = clienteFalso(filas);
    const { dependencias, enviar } = dependenciasCon(cliente);
    let ahora = 0;
    const enviarYAvanzar = vi.fn(async () => {
      ahora += PRESUPUESTO_DE_CORRIDA_MS;
      return ENVIADO;
    });
    const resumen = await procesarAvisosDeRechazoDePago({
      ...dependencias,
      enviar: enviarYAvanzar as unknown as DependenciasDeAvisosDeRechazo["enviar"],
      reloj: () => ahora,
    });
    expect(resumen).toMatchObject({ revisadas: 3, enviadas: 1, pospuestas: 2 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });

  it("lanza si no puede leer los avisos", async () => {
    const { cliente } = clienteFalso([], { errorAlLeer: "sin permiso" });
    const { dependencias } = dependenciasCon(cliente);
    await expect(procesarAvisosDeRechazoDePago(dependencias)).rejects.toThrow("No se pudieron leer los avisos de rechazo: sin permiso");
  });

  it("sin avisos no hace nada", async () => {
    const { cliente, cambios } = clienteFalso([]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosDeRechazoDePago(dependencias);
    expect(resumen).toEqual({ revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios).toEqual([]);
  });

  it("sin dependencias usa el cliente de la llave secreta", async () => {
    admin.cliente = clienteFalso([]).cliente;
    expect(await procesarAvisosDeRechazoDePago()).toMatchObject({ revisadas: 0 });
  });
});

describe("el literal de la plantilla (pruebas/reconstructores.test.ts lo busca en el código)", () => {
  it("cada llamada a enviar escribe el nombre de su plantilla tal cual", () => {
    const codigo = readFileSync(join(__dirname, "avisos-rechazo.ts"), "utf8");
    expect(codigo).toContain('plantilla: "pago_rechazado_individual"');
    expect(codigo).toContain('plantilla: "pago_rechazado_sin_reembolso"');
  });
});
