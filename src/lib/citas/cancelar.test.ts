import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import type { Database } from "@/lib/supabase/tipos";

// HU-024 sin base ni red: un cliente falso que solo sabe las cadenas que usa el código y un envío falso.
// La prueba de integración comprueba el cableado con la base real.

const admin = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => admin.cliente }));

import {
  cancelarCitaPorToken,
  cancelarMiCita,
  LOTE_DE_CANCELACIONES,
  procesarCancelacionesDeCita,
  reconstruirCancelacionCita,
  type DependenciasDeCancelaciones,
} from "./cancelar";
import { RESULTADOS_DE_CANCELAR } from "./cancelar-reglas";
import { MAXIMO_DE_INTENTOS, PRESUPUESTO_DE_CORRIDA_MS } from "./servidor";

const TOKEN = "d".repeat(64);
const TOKEN_CITA = "c".repeat(64);
const TOKEN_LLAVE = "e".repeat(64);
const TOKEN_LLAVE_2 = "f".repeat(64);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const AHORA = new Date("2099-01-12T12:00:00.000Z");
const INICIO = "2099-01-13T15:00:00+00:00";

type FilaDeCancelacion = { id: string; id_monitoria: string; intentos: number };
type DatosDeRpc = {
  creada_en: string;
  correo_destino: string | null;
  con_pago_en_revision: boolean;
  reembolso_a_otro_contacto: boolean;
  estado: "pendiente_pago" | "confirmada" | "realizada" | "cancelada";
  motivo_cancelacion: string | null;
  grupal: boolean;
  nombre_lead: string;
  nombre_materia: string;
  inicio: string;
  token_cita: string | null;
};
type LlaveDeRpc = { id_reembolso: string; monto: number; token: string };

const DATOS: DatosDeRpc = {
  creada_en: "2099-01-12T11:00:00+00:00",
  correo_destino: "ana@calibra.test",
  con_pago_en_revision: false,
  reembolso_a_otro_contacto: false,
  estado: "cancelada",
  motivo_cancelacion: "estudiante",
  grupal: false,
  nombre_lead: "Ana",
  nombre_materia: "Cálculo",
  inicio: INICIO,
  token_cita: TOKEN_CITA,
};

const LLAVES: LlaveDeRpc[] = [{ id_reembolso: id(100), monto: 25_000, token: TOKEN_LLAVE }];

type Cambio = { id: string; cambios: { procesado_en?: string; intentos?: number } };

function clienteFalso(
  filas: FilaDeCancelacion[],
  opciones: {
    datos?: (idMonitoria: string) => DatosDeRpc | null;
    llaves?: (idMonitoria: string) => LlaveDeRpc[];
    errorAlLeer?: string;
    errorAlMarcar?: string;
    rpc?: (nombre: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };
  } = {},
) {
  const consultas: string[] = [];
  const cambios: Cambio[] = [];
  const rpc = vi.fn(async (nombre: string, args: Record<string, unknown> = {}) => {
    consultas.push(`rpc:${nombre}`);
    if (opciones.rpc) return opciones.rpc(nombre, args);
    if (nombre === "llaves_de_cancelacion") {
      return { data: opciones.llaves ? opciones.llaves(String(args.p_id_monitoria)) : LLAVES, error: null };
    }
    const fila = opciones.datos ? opciones.datos(String(args.p_id_monitoria)) : DATOS;
    return { data: fila ? [fila] : [], error: null };
  });
  const cliente = {
    rpc,
    from: (tabla: string) => ({
      select: (columnas: string) => ({
        is: (columna: string, valor: null) => ({
          order: (orden: string) => ({
            limit: async (limite: number) => {
              consultas.push(`${tabla}.select(${columnas}).is(${columna},${valor}).order(${orden}).limit(${limite})`);
              return opciones.errorAlLeer ? { data: null, error: { message: opciones.errorAlLeer } } : { data: filas, error: null };
            },
          }),
        }),
      }),
      update: (campos: Cambio["cambios"]) => ({
        eq: async (_columna: string, valor: string) => {
          cambios.push({ id: valor, cambios: campos });
          return { error: opciones.errorAlMarcar ? { message: opciones.errorAlMarcar } : null };
        },
      }),
    }),
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, consultas, cambios, rpc };
}

/** Un cliente que solo responde a las puertas de cancelar, con el resultado que se le diga. */
const conResultado = (data: unknown) => clienteFalso([], { rpc: () => ({ data, error: null }) });

const ENVIADO: ResultadoEnvio = { ok: true, yaEnviado: false, intentos: 1, idProveedor: "p-1" };

function dependenciasCon(cliente: SupabaseClient<Database>, enviar: ResultadoEnvio | (() => Promise<ResultadoEnvio>) = ENVIADO) {
  const enviarFalso = vi.fn(async () => (typeof enviar === "function" ? enviar() : enviar));
  const dependencias = { cliente, enviar: enviarFalso as unknown as DependenciasDeCancelaciones["enviar"], reloj: () => 0 };
  return { dependencias, enviar: enviarFalso };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  admin.cliente = null;
});

describe("cancelarCitaPorToken (criterio 1 de HU-024, puerta del enlace del correo)", () => {
  it("un token sin forma de token es no_existe sin consultar la base ni tocar la llave secreta", async () => {
    // `admin.cliente` es null: si el código intentara usarlo, fallaría.
    for (const malo of ["", "abc", "A".repeat(64), "d".repeat(63), `${"d".repeat(64)}0`, `${"d".repeat(63)}\n`]) {
      expect(await cancelarCitaPorToken(malo), JSON.stringify(malo)).toBe("no_existe");
    }
  });

  it("llama a la base con la llave secreta y el token, y devuelve el resultado tal cual", async () => {
    for (const resultado of RESULTADOS_DE_CANCELAR) {
      const { cliente, rpc } = conResultado(resultado);
      admin.cliente = cliente;
      expect(await cancelarCitaPorToken(TOKEN), resultado).toBe(resultado);
      expect(rpc).toHaveBeenCalledWith("cancelar_cita_por_token", { p_token: TOKEN });
    }
  });

  it("si la base responde algo que no conoce lanza, en vez de decirle a la persona que se canceló", async () => {
    for (const raro of ["sin_admin", "", null, 1]) {
      admin.cliente = conResultado(raro).cliente;
      await expect(cancelarCitaPorToken(TOKEN), JSON.stringify(raro)).rejects.toThrow("Respuesta inesperada al cancelar la cita");
    }
  });

  it("si la base falla lanza, sin repetir el token en el mensaje", async () => {
    admin.cliente = clienteFalso([], { rpc: () => ({ data: null, error: { message: "caída" } }) }).cliente;
    const falla = await cancelarCitaPorToken(TOKEN).catch((error: Error) => error);
    expect(falla).toBeInstanceOf(Error);
    expect((falla as Error).message).toBe("No se pudo cancelar la cita: caída");
    expect((falla as Error).message).not.toContain(TOKEN);
  });
});

describe("cancelarMiCita (criterio 1 de HU-024, puerta de la sesión del Lead)", () => {
  it("un id que no es un uuid es no_existe sin consultar", async () => {
    const { cliente, rpc } = conResultado("cancelada");
    for (const malo of ["", "no-es-un-id", `${id(1)}0`, `${id(1)}\n`]) {
      expect(await cancelarMiCita(cliente, malo), JSON.stringify(malo)).toBe("no_existe");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("llama a la base con la sesión de quien mira y devuelve el resultado tal cual", async () => {
    for (const resultado of RESULTADOS_DE_CANCELAR) {
      const { cliente, rpc } = conResultado(resultado);
      expect(await cancelarMiCita(cliente, id(1)), resultado).toBe(resultado);
      expect(rpc).toHaveBeenCalledWith("cancelar_mi_cita", { p_id_monitoria: id(1) });
    }
  });

  it("no usa la llave secreta: trabaja con el cliente que recibe", async () => {
    admin.cliente = { rpc: () => Promise.reject(new Error("no debía usarse")) };
    await expect(cancelarMiCita(conResultado("cancelada").cliente, id(1))).resolves.toBe("cancelada");
  });

  it("si la base falla o responde algo que no conoce lanza", async () => {
    const cae = clienteFalso([], { rpc: () => ({ data: null, error: { message: "sin sesión" } }) });
    await expect(cancelarMiCita(cae.cliente, id(1))).rejects.toThrow("No se pudo cancelar la cita: sin sesión");
    await expect(cancelarMiCita(conResultado("sin_admin").cliente, id(1))).rejects.toThrow("Respuesta inesperada al cancelar la cita");
  });
});

describe("reconstruirCancelacionCita (HU-024, D-27)", () => {
  it("arma el correo al correo del Lead, con el enlace de la llave de cada reembolso y el de la cita, y la cita en ISO", async () => {
    const { cliente, rpc } = clienteFalso([], {
      llaves: () => [...LLAVES, { id_reembolso: id(101), monto: 5_000, token: TOKEN_LLAVE_2 }],
    });
    const correo = await reconstruirCancelacionCita(id(1), cliente);
    expect(rpc).toHaveBeenCalledWith("datos_de_cancelacion_cita", { p_id_monitoria: id(1) });
    expect(rpc).toHaveBeenCalledWith("llaves_de_cancelacion", { p_id_monitoria: id(1) });
    expect(correo?.destinatario).toBe("ana@calibra.test");
    expect(correo?.datos).toMatchObject({
      nombre: "Ana",
      materia: "Cálculo",
      inicio: "2099-01-13T15:00:00.000Z",
      conPagoEnRevision: false,
      reembolsoAOtroContacto: false,
    });
    expect(correo?.datos.reembolsos).toHaveLength(2);
    expect(correo?.datos.reembolsos.map((r) => r.monto)).toEqual([25_000, 5_000]);
    expect(correo?.datos.reembolsos[0].enlace).toMatch(new RegExp(`/reembolso\\?token=${TOKEN_LLAVE}$`));
    expect(correo?.datos.reembolsos[1].enlace).toMatch(new RegExp(`/reembolso\\?token=${TOKEN_LLAVE_2}$`));
    expect(correo?.datos.enlaceCita).toMatch(new RegExp(`/cita\\?token=${TOKEN_CITA}$`));
  });

  it("sin reembolsos que pedir (pago en revisión) lleva solo el aviso y el enlace de la cita", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, con_pago_en_revision: true }), llaves: () => [] });
    const correo = await reconstruirCancelacionCita(id(1), cliente);
    expect(correo?.datos).toMatchObject({ reembolsos: [], conPagoEnRevision: true, reembolsoAOtroContacto: false });
    expect(correo?.datos.enlaceCita).toMatch(/\/cita\?token=/);
  });

  it("pasa el aviso de que otro contacto pagó (HU-025 le pide su llave) y no inventa reembolsos", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, reembolso_a_otro_contacto: true }), llaves: () => [] });
    const correo = await reconstruirCancelacionCita(id(1), cliente);
    expect(correo?.datos).toMatchObject({ reembolsos: [], reembolsoAOtroContacto: true });
  });

  it("sin token de la cita, el enlace de la cita es null", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, token_cita: null }) });
    expect((await reconstruirCancelacionCita(id(1), cliente))?.datos.enlaceCita).toBeNull();
  });

  it("si el Lead no tiene correo usa el que trae la base (el del primer pago), recortado", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, correo_destino: "  pagador@calibra.test " }) });
    expect((await reconstruirCancelacionCita(id(1), cliente))?.destinatario).toBe("pagador@calibra.test");
  });

  it("no lleva el correo ni el token de la llave como campo: solo los enlaces armados", async () => {
    const { cliente } = clienteFalso([]);
    const correo = await reconstruirCancelacionCita(id(1), cliente);
    expect(Object.keys(correo!.datos).sort()).toEqual(
      ["conPagoEnRevision", "enlaceCita", "inicio", "materia", "nombre", "reembolsoAOtroContacto", "reembolsos"].sort(),
    );
    expect(JSON.stringify(correo!.datos)).not.toContain("ana@calibra.test");
  });

  it("es null si la cita ya no vale: no está cancelada, se canceló por otro motivo o es grupal; sin pedir las llaves", async () => {
    for (const cambios of [
      { estado: "confirmada" as const },
      { estado: "realizada" as const },
      { estado: "pendiente_pago" as const },
      { motivo_cancelacion: "pago_rechazado" },
      { motivo_cancelacion: "monitor_no_asistio" },
      { motivo_cancelacion: null },
      { grupal: true },
    ]) {
      const { cliente, rpc } = clienteFalso([], { datos: () => ({ ...DATOS, ...cambios }) });
      expect(await reconstruirCancelacionCita(id(1), cliente), JSON.stringify(cambios)).toBeNull();
      expect(rpc).not.toHaveBeenCalledWith("llaves_de_cancelacion", expect.anything());
    }
  });

  it("es null si no hay a quién escribirle (sin correo del Lead ni del pago) y lo deja en el log", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const correo_destino of [null, "", "   "]) {
      const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, correo_destino }) });
      expect(await reconstruirCancelacionCita(id(1), cliente), JSON.stringify(correo_destino)).toBeNull();
    }
    expect(aviso).toHaveBeenCalledTimes(3);
    expect(aviso.mock.calls.flat().join(" ")).toContain(id(1));
  });

  it("una cita que ya no vale por otra razón no deja rastro de falta de correo", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, estado: "confirmada", correo_destino: null }) });
    expect(await reconstruirCancelacionCita(id(1), cliente)).toBeNull();
    expect(aviso).not.toHaveBeenCalled();
  });

  it("es null si no hay cancelación anotada o si el id no es un uuid, sin consultar", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sinCancelacion = clienteFalso([], { datos: () => null });
    expect(await reconstruirCancelacionCita(id(1), sinCancelacion.cliente)).toBeNull();
    const cualquiera = clienteFalso([]);
    expect(await reconstruirCancelacionCita("cita-1", cualquiera.cliente)).toBeNull();
    expect(cualquiera.rpc).not.toHaveBeenCalled();
  });

  it("lanza si la base falla al leer los datos o las llaves: el reintento lo toma como error y no como descarte", async () => {
    const sinDatos = clienteFalso([], { rpc: () => ({ data: null, error: { message: "sin permiso" } }) });
    await expect(reconstruirCancelacionCita(id(1), sinDatos.cliente)).rejects.toThrow("No se pudieron leer los datos de la cancelación: sin permiso");
    const sinLlaves = clienteFalso([], {
      rpc: (nombre) =>
        nombre === "llaves_de_cancelacion" ? { data: null, error: { message: "sin permiso" } } : { data: [DATOS], error: null },
    });
    await expect(reconstruirCancelacionCita(id(1), sinLlaves.cliente)).rejects.toThrow("No se pudieron leer las llaves de la cancelación: sin permiso");
  });

  it("lanza si la base devuelve un estado o un motivo que no conoce", async () => {
    const estado = clienteFalso([], { datos: () => ({ ...DATOS, estado: "archivada" as never }) });
    await expect(reconstruirCancelacionCita(id(1), estado.cliente)).rejects.toThrow("Estado de la cita desconocido");
    const motivo = clienteFalso([], { datos: () => ({ ...DATOS, motivo_cancelacion: "porque_si" }) });
    await expect(reconstruirCancelacionCita(id(1), motivo.cliente)).rejects.toThrow("Motivo de cancelación desconocido");
  });

  it("no lee el reloj: el mismo dato da el mismo correo hoy y dentro de un año (el reintento lo exige)", async () => {
    const { cliente } = clienteFalso([]);
    const antes = await reconstruirCancelacionCita(id(1), cliente);
    vi.setSystemTime(new Date("2100-01-12T12:00:00.000Z"));
    expect(await reconstruirCancelacionCita(id(1), cliente)).toEqual(antes);
    // Aunque la sesión ya haya pasado, la cancelación se sigue avisando.
    expect(antes).not.toBeNull();
  });
});

describe("procesarCancelacionesDeCita (HU-024)", () => {
  it("manda la cancelación pendiente, con el id de la monitoría como entidad, y la marca procesada", async () => {
    const { cliente, consultas, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: 0 }]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarCancelacionesDeCita(dependencias);
    expect(resumen).toEqual({ revisadas: 1, enviadas: 1, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(consultas[0]).toBe(
      `cancelacion_cita.select(id, id_monitoria, intentos).is(procesado_en,null).order(creada_en).limit(${LOTE_DE_CANCELACIONES})`,
    );
    expect(LOTE_DE_CANCELACIONES).toBe(10);
    expect(enviar).toHaveBeenCalledOnce();
    const entrada = (enviar.mock.calls as unknown as [{ plantilla: string; entidad: string; destinatario: string }][])[0][0];
    expect(entrada).toMatchObject({ plantilla: "cancelacion_cita", entidad: id(1), destinatario: "ana@calibra.test" });
    expect(cambios).toHaveLength(1);
    expect(cambios[0].id).toBe(id(10));
    expect(Object.keys(cambios[0].cambios)).toEqual(["procesado_en"]);
  });

  it("descarta la que ya no vale (sin correo, grupal), sin mandar nada, y la marca procesada", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: 0 }], {
      datos: () => ({ ...DATOS, correo_destino: null }),
    });
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarCancelacionesDeCita(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, descartadas: 1, enviadas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });

  it("cuenta el correo fallido y el tomado por otra corrida, y marca ambos procesados", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const filas = [
      { id: id(10), id_monitoria: id(1), intentos: 0 },
      { id: id(11), id_monitoria: id(2), intentos: 0 },
    ];
    const { cliente, cambios } = clienteFalso(filas);
    const respuestas: ResultadoEnvio[] = [
      { ok: false, motivo: "fallo_del_proveedor", error: "caído", intentos: 3 },
      { ok: false, motivo: "en_curso", error: "otra corrida", intentos: 0 },
    ];
    const { dependencias } = dependenciasCon(cliente, async () => respuestas.shift()!);
    const resumen = await procesarCancelacionesDeCita(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, fallidas: 1, tomadasPorOtro: 1, enviadas: 0, conError: 0 });
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11)]);
  });

  it("si el registro del correo falla, suma un intento y no la marca procesada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: 1 }]);
    const { dependencias } = dependenciasCon(cliente, { ok: false, motivo: "fallo_del_registro", error: "sin base", intentos: 0 });
    const resumen = await procesarCancelacionesDeCita(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, conError: 1, enviadas: 0 });
    expect(cambios).toEqual([{ id: id(10), cambios: { intentos: 2 } }]);
  });

  it("si la base falla al reconstruir el correo, suma un intento y no la marca procesada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: 0 }], {
      rpc: () => ({ data: null, error: { message: "sin permiso" } }),
    });
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarCancelacionesDeCita(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, conError: 1, enviadas: 0, descartadas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios).toEqual([{ id: id(10), cambios: { intentos: 1 } }]);
  });

  it("al llegar al máximo de intentos la abandona: queda procesada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: MAXIMO_DE_INTENTOS - 1 }]);
    const { dependencias } = dependenciasCon(cliente, async () => {
      throw new Error("boom");
    });
    const resumen = await procesarCancelacionesDeCita(dependencias);
    expect(resumen.conError).toBe(1);
    expect(cambios).toHaveLength(1);
    expect(cambios[0].cambios.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(cambios[0].cambios.procesado_en).toBeTruthy();
  });

  it("un error de la base en una no detiene a las demás", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const filas = [
      { id: id(10), id_monitoria: id(1), intentos: 0 },
      { id: id(11), id_monitoria: id(2), intentos: 0 },
    ];
    const { cliente, cambios } = clienteFalso(filas);
    let n = 0;
    const { dependencias, enviar } = dependenciasCon(cliente, async () => {
      if (n++ === 0) throw new Error("boom");
      return ENVIADO;
    });
    const resumen = await procesarCancelacionesDeCita(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, conError: 1, enviadas: 1 });
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11)]);
  });

  it("el log de una falla nombra la monitoría y nunca un token", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: 0 }]);
    const { dependencias } = dependenciasCon(cliente, async () => {
      throw new Error("boom");
    });
    await procesarCancelacionesDeCita(dependencias);
    const registrado = error.mock.calls.flat().join(" ");
    expect(registrado).toContain(id(1));
    for (const token of [TOKEN, TOKEN_CITA, TOKEN_LLAVE]) expect(registrado).not.toContain(token);
  });

  it("pasado el presupuesto de tiempo pospone las que quedan", async () => {
    const filas = [
      { id: id(10), id_monitoria: id(1), intentos: 0 },
      { id: id(11), id_monitoria: id(2), intentos: 0 },
      { id: id(12), id_monitoria: id(3), intentos: 0 },
    ];
    const { cliente, cambios } = clienteFalso(filas);
    const { dependencias, enviar } = dependenciasCon(cliente);
    let ahora = 0;
    const reloj = () => ahora;
    const enviarYAvanzar = vi.fn(async () => {
      ahora += PRESUPUESTO_DE_CORRIDA_MS;
      return ENVIADO;
    });
    const resumen = await procesarCancelacionesDeCita({
      ...dependencias,
      enviar: enviarYAvanzar as unknown as DependenciasDeCancelaciones["enviar"],
      reloj,
    });
    expect(resumen).toMatchObject({ revisadas: 3, enviadas: 1, pospuestas: 2 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });

  it("lanza si no puede leer las cancelaciones", async () => {
    const { cliente } = clienteFalso([], { errorAlLeer: "sin permiso" });
    const { dependencias } = dependenciasCon(cliente);
    await expect(procesarCancelacionesDeCita(dependencias)).rejects.toThrow("No se pudieron leer las cancelaciones: sin permiso");
  });

  it("sin cancelaciones no hace nada", async () => {
    const { cliente, cambios } = clienteFalso([]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarCancelacionesDeCita(dependencias);
    expect(resumen).toEqual({ revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios).toEqual([]);
  });
});
