import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import type { Database } from "@/lib/supabase/tipos";

// HU-019 sin base ni red: un cliente falso que solo sabe las cadenas que usa el procesador y un envío falso.
// La prueba de integración comprueba el cableado con la base real.

const admin = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => admin.cliente }));

import {
  leerCitaPorToken,
  leerMiCita,
  leerMisCitas,
  LOTE_DE_CONFIRMACIONES,
  MAXIMO_DE_INTENTOS,
  PRESUPUESTO_DE_CORRIDA_MS,
  procesarConfirmacionesDeCita,
  reconstruirConfirmacionCita,
  type DependenciasDeConfirmaciones,
} from "./servidor";

const TOKEN = "d".repeat(64);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Una hora de margen antes del inicio de la cita de ejemplo. */
const AHORA = new Date("2099-01-12T12:00:00.000Z");
const INICIO = "2099-01-13T15:00:00+00:00";

type FilaDeConfirmacion = { id: string; id_monitoria: string; intentos: number };
type DatosDeRpc = {
  token: string;
  creada_en: string;
  estado: "pendiente_pago" | "confirmada" | "realizada" | "cancelada";
  grupal: boolean;
  correo_destino: string | null;
  nombre_lead: string;
  nombre_monitor: string;
  nombre_materia: string;
  inicio: string;
  duracion_min: number;
  presencial: boolean;
  lugar: string | null;
  enlace: string | null;
  valor_total: number;
  cancelable_hasta: string;
};

const DATOS: DatosDeRpc = {
  token: TOKEN,
  creada_en: "2099-01-10T14:00:00+00:00",
  estado: "confirmada",
  grupal: false,
  correo_destino: "ana@calibra.test",
  nombre_lead: "Ana",
  nombre_monitor: "Camilo",
  nombre_materia: "Cálculo",
  inicio: INICIO,
  duracion_min: 60,
  presencial: true,
  lugar: "Edificio Principal, salón 301",
  enlace: null,
  valor_total: 25_000,
  cancelable_hasta: "2099-01-13T03:00:00+00:00",
};

const FILA_DE_CITA = {
  id_monitoria: id(1),
  estado: "confirmada",
  motivo_cancelacion: null,
  nombre_monitor: "Camilo",
  nombre_materia: "Cálculo",
  codigo_materia: "MATE1203",
  fecha: "2099-01-13",
  hora: "10:00:00",
  duracion_min: 60,
  presencial: true,
  valor_total: 25_000,
  lugar: "Edificio Principal, salón 301",
  enlace: null,
  inicio: INICIO,
  fin_programado: "2099-01-13T16:00:00+00:00",
  cancelable_hasta: "2099-01-13T03:00:00+00:00",
  reporte_hasta: "2099-01-14T16:00:00+00:00",
  estado_pago: "en_revision",
  estado_reembolso: null,
  estado_reporte: null,
};

type Cambio = { id: string; cambios: { procesado_en?: string; intentos?: number } };

function clienteFalso(
  filas: FilaDeConfirmacion[],
  opciones: {
    datos?: (idMonitoria: string) => DatosDeRpc | null;
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

const ENVIADO: ResultadoEnvio = { ok: true, yaEnviado: false, intentos: 1, idProveedor: "p-1" };

function dependenciasCon(cliente: SupabaseClient<Database>, enviar: ResultadoEnvio | (() => Promise<ResultadoEnvio>) = ENVIADO) {
  const enviarFalso = vi.fn(async () => (typeof enviar === "function" ? enviar() : enviar));
  const dependencias = { cliente, enviar: enviarFalso as unknown as DependenciasDeConfirmaciones["enviar"], reloj: () => 0 };
  return { dependencias, enviar: enviarFalso };
}

beforeEach(() => {
  // La cita de ejemplo empieza el 13 de enero de 2099: "ahora" es el día anterior.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  admin.cliente = null;
});

describe("reconstruirConfirmacionCita (HU-019)", () => {
  it("arma el correo al correo del Lead, con el enlace del token y la cita en ISO (D-19, D-20)", async () => {
    const { cliente, rpc } = clienteFalso([]);
    const correo = await reconstruirConfirmacionCita(id(1), cliente);
    expect(rpc).toHaveBeenCalledWith("datos_de_confirmacion_cita", { p_id_monitoria: id(1) });
    expect(correo?.destinatario).toBe("ana@calibra.test");
    expect(correo?.datos).toMatchObject({
      nombre: "Ana",
      nombreMonitor: "Camilo",
      materia: "Cálculo",
      inicio: "2099-01-13T15:00:00.000Z",
      duracionMin: 60,
      presencial: true,
      valorTotal: 25_000,
      lugar: "Edificio Principal, salón 301",
      enlaceSesion: null,
      cancelableHasta: "2099-01-13T03:00:00.000Z",
    });
    expect(correo?.datos.enlace).toMatch(new RegExp(`/cita\\?token=${TOKEN}$`));
  });

  it("si el Lead no tiene correo usa el que trae la base (el del primer pago)", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, correo_destino: "pagador@calibra.test" }) });
    expect((await reconstruirConfirmacionCita(id(1), cliente))?.destinatario).toBe("pagador@calibra.test");
  });

  it("una virtual lleva el enlace de la videollamada y no el lugar", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, presencial: false, lugar: null, enlace: "https://meet.example/abc" }) });
    const correo = await reconstruirConfirmacionCita(id(1), cliente);
    expect(correo?.datos).toMatchObject({ presencial: false, lugar: null, enlaceSesion: "https://meet.example/abc" });
  });

  it("el plazo de cancelación es null si ya había pasado cuando se confirmó (RN-37), por un dato fijo", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, creada_en: "2099-01-13T05:00:00+00:00" }) });
    expect((await reconstruirConfirmacionCita(id(1), cliente))?.datos.cancelableHasta).toBeNull();
  });

  it("no lleva el token ni el correo en los datos de la plantilla, solo el enlace", async () => {
    const { cliente } = clienteFalso([]);
    const correo = await reconstruirConfirmacionCita(id(1), cliente);
    expect(Object.keys(correo!.datos).sort()).toEqual(
      ["cancelableHasta", "duracionMin", "enlace", "enlaceSesion", "inicio", "lugar", "materia", "nombre", "nombreMonitor", "presencial", "valorTotal"].sort(),
    );
  });

  it("es null si la cita ya no vale: cancelada (pago rechazado), realizada, grupal o ya empezada", async () => {
    for (const cambios of [
      { estado: "cancelada" as const },
      { estado: "realizada" as const },
      { grupal: true },
      { inicio: "2099-01-12T11:00:00+00:00" },
      { inicio: "2099-01-12T12:00:00+00:00" },
    ]) {
      const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, ...cambios }) });
      expect(await reconstruirConfirmacionCita(id(1), cliente), JSON.stringify(cambios)).toBeNull();
    }
  });

  it("es null si no hay a quién escribirle (sin correo del Lead ni del pago)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const correo_destino of [null, "", "   "]) {
      const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, correo_destino }) });
      expect(await reconstruirConfirmacionCita(id(1), cliente), JSON.stringify(correo_destino)).toBeNull();
    }
  });

  it("es null si no hay confirmación anotada o si el id no es un uuid, sin consultar", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sinConfirmacion = clienteFalso([], { datos: () => null });
    expect(await reconstruirConfirmacionCita(id(1), sinConfirmacion.cliente)).toBeNull();
    const cualquiera = clienteFalso([]);
    expect(await reconstruirConfirmacionCita("cita-1", cualquiera.cliente)).toBeNull();
    expect(cualquiera.rpc).not.toHaveBeenCalled();
  });

  it("lanza si la base falla, y el reintento lo toma como error y no como descarte", async () => {
    const { cliente } = clienteFalso([], { rpc: () => ({ data: null, error: { message: "sin permiso" } }) });
    await expect(reconstruirConfirmacionCita(id(1), cliente)).rejects.toThrow("No se pudieron leer los datos de la confirmación: sin permiso");
  });

  it("lanza si la base devuelve un estado que no conoce", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, estado: "archivada" as never }) });
    await expect(reconstruirConfirmacionCita(id(1), cliente)).rejects.toThrow("Estado de la cita desconocido");
  });
});

describe("procesarConfirmacionesDeCita (HU-019)", () => {
  it("manda la confirmación pendiente, con el id de la monitoría como entidad, y la marca procesada", async () => {
    const { cliente, consultas, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: 0 }]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarConfirmacionesDeCita(dependencias);
    expect(resumen).toEqual({ revisadas: 1, enviadas: 1, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(consultas[0]).toBe(
      `confirmacion_cita.select(id, id_monitoria, intentos).is(procesado_en,null).order(creada_en).limit(${LOTE_DE_CONFIRMACIONES})`,
    );
    expect(enviar).toHaveBeenCalledOnce();
    const entrada = (enviar.mock.calls as unknown as [{ plantilla: string; entidad: string; destinatario: string }][])[0][0];
    expect(entrada).toMatchObject({ plantilla: "confirmacion_cita", entidad: id(1), destinatario: "ana@calibra.test" });
    expect(cambios).toHaveLength(1);
    expect(cambios[0].id).toBe(id(10));
    expect(Object.keys(cambios[0].cambios)).toEqual(["procesado_en"]);
  });

  it("descarta la que ya no vale (la cita se canceló), sin mandar nada, y la marca procesada", async () => {
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: 0 }], {
      datos: () => ({ ...DATOS, estado: "cancelada" }),
    });
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarConfirmacionesDeCita(dependencias);
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
    const resumen = await procesarConfirmacionesDeCita(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, fallidas: 1, tomadasPorOtro: 1, enviadas: 0, conError: 0 });
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11)]);
  });

  it("si el registro del correo falla, suma un intento y no la marca procesada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: 1 }]);
    const { dependencias } = dependenciasCon(cliente, { ok: false, motivo: "fallo_del_registro", error: "sin base", intentos: 0 });
    const resumen = await procesarConfirmacionesDeCita(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, conError: 1, enviadas: 0 });
    expect(cambios).toEqual([{ id: id(10), cambios: { intentos: 2 } }]);
  });

  it("al llegar al máximo de intentos la abandona: queda procesada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: MAXIMO_DE_INTENTOS - 1 }]);
    const { dependencias } = dependenciasCon(cliente, async () => {
      throw new Error("boom");
    });
    const resumen = await procesarConfirmacionesDeCita(dependencias);
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
    const resumen = await procesarConfirmacionesDeCita(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, conError: 1, enviadas: 1 });
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11)]);
  });

  it("el log de una falla nombra la monitoría y nunca el token", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteFalso([{ id: id(10), id_monitoria: id(1), intentos: 0 }]);
    const { dependencias } = dependenciasCon(cliente, async () => {
      throw new Error("boom");
    });
    await procesarConfirmacionesDeCita(dependencias);
    const registrado = error.mock.calls.flat().join(" ");
    expect(registrado).toContain(id(1));
    expect(registrado).not.toContain(TOKEN);
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
    const resumen = await procesarConfirmacionesDeCita({
      ...dependencias,
      enviar: enviarYAvanzar as unknown as DependenciasDeConfirmaciones["enviar"],
      reloj,
    });
    expect(resumen).toMatchObject({ revisadas: 3, enviadas: 1, pospuestas: 2 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });

  it("lanza si no puede leer las confirmaciones", async () => {
    const { cliente } = clienteFalso([], { errorAlLeer: "sin permiso" });
    const { dependencias } = dependenciasCon(cliente);
    await expect(procesarConfirmacionesDeCita(dependencias)).rejects.toThrow("No se pudieron leer las confirmaciones: sin permiso");
  });

  it("sin confirmaciones no hace nada", async () => {
    const { cliente, cambios } = clienteFalso([]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarConfirmacionesDeCita(dependencias);
    expect(resumen).toEqual({ revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios).toEqual([]);
  });
});

describe("leerCitaPorToken (criterio 3 de HU-019)", () => {
  it("un token sin forma de token no consulta la base ni devuelve nada", async () => {
    const { cliente, rpc } = clienteFalso([]);
    admin.cliente = cliente;
    for (const malo of ["", "abc", "A".repeat(64), "d".repeat(63), `${"d".repeat(64)}0`, "d".repeat(63) + "\n"]) {
      expect(await leerCitaPorToken(malo), JSON.stringify(malo)).toBeNull();
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un token con forma pero inventado devuelve null: la base no devuelve filas", async () => {
    const { cliente, rpc } = clienteFalso([], { rpc: () => ({ data: [], error: null }) });
    admin.cliente = cliente;
    expect(await leerCitaPorToken(TOKEN)).toBeNull();
    expect(rpc).toHaveBeenCalledWith("cita_por_token", { p_token: TOKEN });
  });

  it("devuelve la cita con las fechas como Date", async () => {
    const { cliente } = clienteFalso([], { rpc: () => ({ data: [FILA_DE_CITA], error: null }) });
    admin.cliente = cliente;
    const cita = await leerCitaPorToken(TOKEN);
    expect(cita).toMatchObject({ idMonitoria: id(1), estado: "confirmada", nombreMonitor: "Camilo", valorTotal: 25_000, estadoPago: "en_revision" });
    expect(cita?.inicio).toEqual(new Date("2099-01-13T15:00:00.000Z"));
    expect(cita?.cancelableHasta).toEqual(new Date("2099-01-13T03:00:00.000Z"));
    expect(Object.keys(cita!).filter((campo) => /comisi|correo|telefono|contacto|lead/i.test(campo))).toEqual([]);
  });

  it("si la base falla lanza, sin repetir el token en el mensaje", async () => {
    const { cliente } = clienteFalso([], { rpc: () => ({ data: null, error: { message: "caída" } }) });
    admin.cliente = cliente;
    const falla = await leerCitaPorToken(TOKEN).catch((error: Error) => error);
    expect(falla).toBeInstanceOf(Error);
    expect((falla as Error).message).toBe("No se pudo leer la cita: caída");
    expect((falla as Error).message).not.toContain(TOKEN);
  });
});

describe("leerMiCita y leerMisCitas (criterio 4 de HU-019)", () => {
  it("leerMiCita pide la cita con la sesión del Lead y devuelve null si no es suya (sin filas)", async () => {
    const suya = clienteFalso([], { rpc: () => ({ data: [FILA_DE_CITA], error: null }) });
    expect((await leerMiCita(suya.cliente, id(1)))?.idMonitoria).toBe(id(1));
    expect(suya.rpc).toHaveBeenCalledWith("mi_cita", { p_id_monitoria: id(1) });
    const ajena = clienteFalso([], { rpc: () => ({ data: [], error: null }) });
    expect(await leerMiCita(ajena.cliente, id(1))).toBeNull();
  });

  it("leerMiCita no consulta con un id que no es un uuid", async () => {
    const { cliente, rpc } = clienteFalso([]);
    expect(await leerMiCita(cliente, "no-es-un-id")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("leerMiCita no usa la llave secreta: trabaja con el cliente que recibe", async () => {
    const { cliente } = clienteFalso([], { rpc: () => ({ data: [FILA_DE_CITA], error: null }) });
    admin.cliente = { rpc: () => Promise.reject(new Error("no debía usarse")) };
    await expect(leerMiCita(cliente, id(1))).resolves.toBeTruthy();
    await expect(leerMisCitas(cliente)).resolves.toHaveLength(1);
  });

  it("leerMisCitas devuelve las citas en el orden de la base, y vacío si no hay Lead", async () => {
    const dos = clienteFalso([], {
      rpc: () => ({ data: [FILA_DE_CITA, { ...FILA_DE_CITA, id_monitoria: id(2), estado: "cancelada", motivo_cancelacion: "estudiante" }], error: null }),
    });
    const citas = await leerMisCitas(dos.cliente);
    expect(dos.rpc).toHaveBeenCalledWith("mis_citas");
    expect(citas.map((c) => c.idMonitoria)).toEqual([id(1), id(2)]);
    expect(citas[1].motivoCancelacion).toBe("estudiante");
    const ninguna = clienteFalso([], { rpc: () => ({ data: null, error: null }) });
    expect(await leerMisCitas(ninguna.cliente)).toEqual([]);
  });

  it("si la base falla lanza", async () => {
    const { cliente } = clienteFalso([], { rpc: () => ({ data: null, error: { message: "sin sesión" } }) });
    await expect(leerMiCita(cliente, id(1))).rejects.toThrow("No se pudo leer la cita: sin sesión");
    await expect(leerMisCitas(cliente)).rejects.toThrow("No se pudieron leer las citas: sin sesión");
  });
});
