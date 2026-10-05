import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import type { Database } from "@/lib/supabase/tipos";

// HU-076 y HU-030 sin base ni red: el aviso al monitor por el rechazo de un pago (evento `pago_rechazado`) y por un
// reporte de inasistencia aceptado (evento `inasistencia_aceptada`), con un cliente falso que responde
// `datos_de_aviso_monitor` y un envío falso.

const admin = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => admin.cliente }));

import {
  procesarAvisosAlMonitor,
  reconstruirAvisoInasistenciaAceptada,
  reconstruirAvisoPagoRechazado,
  type DependenciasDeAvisos,
} from "./servidor";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AHORA = new Date("2099-01-12T12:00:00.000Z");

type DatosDeRpc = {
  correo_monitor: string;
  duracion_min: number;
  estado: "pendiente_pago" | "confirmada" | "realizada" | "cancelada";
  grupal: boolean;
  inicio: string;
  motivo_cancelacion: string | null;
  nombre_estudiante: string;
  nombre_materia: string;
  nombre_monitor: string;
  presencial: boolean;
};

const CANCELADA_POR_PAGO: DatosDeRpc = {
  correo_monitor: "camilo@calibra.test",
  duracion_min: 60,
  estado: "cancelada",
  grupal: false,
  inicio: "2099-01-13T15:00:00+00:00",
  motivo_cancelacion: "pago_rechazado",
  nombre_estudiante: "Ana",
  nombre_materia: "Cálculo",
  nombre_monitor: "Camilo",
  presencial: true,
};

type Cambio = { id: string; cambios: { procesado_en?: string; intentos?: number } };

/** El estado del desembolso de la monitoría que responde `from("desembolso")`; `null` si no tiene, o `"error"` si la lectura falla. */
type DesembolsoFalso = "pendiente" | "desembolsado" | "anulado" | "error" | null;

function clienteFalso(
  avisos: { id: string; id_monitoria: string; evento: string; intentos: number }[],
  datos: DatosDeRpc | null = CANCELADA_POR_PAGO,
  desembolso: DesembolsoFalso = null,
) {
  const cambios: Cambio[] = [];
  const lecturasDeDesembolso: { columnas: string; donde: [string, string] }[] = [];
  const rpc = vi.fn(async () => ({ data: datos ? [datos] : [], error: null }));
  const cliente = {
    rpc,
    from: (tabla: string) =>
      tabla === "desembolso"
        ? {
            select: (columnas: string) => ({
              eq: (columna: string, valor: string) => ({
                maybeSingle: async () => {
                  lecturasDeDesembolso.push({ columnas, donde: [columna, valor] });
                  if (desembolso === "error") return { data: null, error: { message: "se cayó la base" } };
                  return { data: desembolso ? { estado: desembolso } : null, error: null };
                },
              }),
            }),
          }
        : {
            select: () => ({ is: () => ({ order: () => ({ limit: async () => ({ data: avisos, error: null }) }) }) }),
            update: (campos: Cambio["cambios"]) => ({
              eq: async (_columna: string, valor: string) => {
                cambios.push({ id: valor, cambios: campos });
                return { error: null };
              },
            }),
          },
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, cambios, rpc, lecturasDeDesembolso };
}

const ENVIADO: ResultadoEnvio = { ok: true, yaEnviado: false, intentos: 1, idProveedor: "p-1" };

function dependenciasCon(cliente: SupabaseClient<Database>) {
  const enviar = vi.fn(async () => ENVIADO);
  return { dependencias: { cliente, enviar: enviar as unknown as DependenciasDeAvisos["enviar"], reloj: () => 0 }, enviar };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  vi.stubEnv("SITIO_URL", "https://calibra.test");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  admin.cliente = null;
});

describe("reconstruirAvisoPagoRechazado (HU-076, criterios 1 a 3)", () => {
  it("arma el correo al monitor con su agenda, sin el nombre del estudiante", async () => {
    const { cliente, rpc } = clienteFalso([]);
    const correo = await reconstruirAvisoPagoRechazado(id(1), cliente);
    expect(rpc).toHaveBeenCalledWith("datos_de_aviso_monitor", { p_id_monitoria: id(1) });
    expect(correo).toEqual({
      destinatario: "camilo@calibra.test",
      datos: { nombreMonitor: "Camilo", materia: "Cálculo", inicio: "2099-01-13T15:00:00.000Z", enlace: "https://calibra.test/monitor/agenda" },
    });
    expect(JSON.stringify(correo)).not.toContain("Ana");
  });

  it("no lo arma si la sesión ya empezó (con retraso) ni en el borde exacto del inicio", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cliente } = clienteFalso([]);
    vi.setSystemTime(new Date("2099-01-13T15:00:00.000Z"));
    expect(await reconstruirAvisoPagoRechazado(id(1), cliente)).toBeNull();
    vi.setSystemTime(new Date("2099-01-13T14:59:59.999Z"));
    expect(await reconstruirAvisoPagoRechazado(id(1), cliente)).not.toBeNull();
  });

  it("no lo arma si la monitoría se canceló por otro motivo, no está cancelada o es grupal", async () => {
    for (const cambios of [
      { motivo_cancelacion: "estudiante" },
      { motivo_cancelacion: "monitor_no_asistio" },
      { estado: "confirmada" as const, motivo_cancelacion: null },
      { grupal: true },
    ]) {
      const { cliente } = clienteFalso([], { ...CANCELADA_POR_PAGO, ...cambios });
      expect(await reconstruirAvisoPagoRechazado(id(1), cliente), JSON.stringify(cambios)).toBeNull();
    }
  });

  it("no lo arma si el id no es un uuid o la monitoría ya no tiene datos", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cliente, rpc } = clienteFalso([], null);
    expect(await reconstruirAvisoPagoRechazado("no-es-un-id", cliente)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(await reconstruirAvisoPagoRechazado(id(1), cliente)).toBeNull();
  });
});

describe("procesarAvisosAlMonitor con el evento pago_rechazado (HU-076)", () => {
  it("manda aviso_monitor_pago_rechazado con el id de la monitoría como entidad y lo marca procesado", async () => {
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), evento: "pago_rechazado", intentos: 0 }]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosAlMonitor(dependencias);
    expect(resumen).toMatchObject({ revisados: 1, enviados: 1, descartados: 0 });
    expect(enviar).toHaveBeenCalledOnce();
    expect((enviar.mock.calls as unknown as [Record<string, unknown>][])[0][0]).toMatchObject({
      plantilla: "aviso_monitor_pago_rechazado",
      entidad: id(1),
      destinatario: "camilo@calibra.test",
    });
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
    expect(Object.keys(cambios[0].cambios)).toEqual(["procesado_en"]);
  });

  it("con la sesión ya empezada o el motivo distinto lo descarta: procesado y sin correo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const datos of [{ ...CANCELADA_POR_PAGO, inicio: "2099-01-12T11:00:00+00:00" }, { ...CANCELADA_POR_PAGO, motivo_cancelacion: "estudiante" }]) {
      const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), evento: "pago_rechazado", intentos: 0 }], datos);
      const { dependencias, enviar } = dependenciasCon(cliente);
      const resumen = await procesarAvisosAlMonitor(dependencias);
      expect(resumen).toMatchObject({ revisados: 1, descartados: 1, enviados: 0 });
      expect(enviar).not.toHaveBeenCalled();
      expect(cambios.map((c) => c.id)).toEqual([id(10)]);
    }
  });

  it("un evento que no conoce se descarta sin mandar nada", async () => {
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), evento: "realizada", intentos: 0 }]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    expect(await procesarAvisosAlMonitor(dependencias)).toMatchObject({ descartados: 1, enviados: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });
});

const ACEPTADA: DatosDeRpc = {
  ...CANCELADA_POR_PAGO,
  // Un reporte solo existe desde que la sesión empezó (RN-64): la de la prueba empezó hace una hora.
  inicio: "2099-01-12T11:00:00+00:00",
  motivo_cancelacion: "monitor_no_asistio",
};

describe("reconstruirAvisoInasistenciaAceptada (HU-030, D-37)", () => {
  it("arma el correo al monitor con su agenda, aunque la sesión ya haya empezado, sin el nombre del estudiante", async () => {
    const { cliente, rpc } = clienteFalso([], ACEPTADA);
    const correo = await reconstruirAvisoInasistenciaAceptada(id(1), cliente);
    expect(rpc).toHaveBeenCalledWith("datos_de_aviso_monitor", { p_id_monitoria: id(1) });
    expect(correo).toEqual({
      destinatario: "camilo@calibra.test",
      datos: {
        nombreMonitor: "Camilo",
        materia: "Cálculo",
        inicio: "2099-01-12T11:00:00.000Z",
        enlace: "https://calibra.test/monitor/agenda",
        desembolsado: false,
      },
    });
    expect(JSON.stringify(correo)).not.toContain("Ana");
  });

  it("marca `desembolsado` solo si el desembolso de esa monitoría ya se transfirió: ahí el correo no puede decir que no se le desembolsa", async () => {
    const transferido = clienteFalso([], ACEPTADA, "desembolsado");
    expect((await reconstruirAvisoInasistenciaAceptada(id(1), transferido.cliente))?.datos.desembolsado).toBe(true);
    // Lo lee de la monitoría del aviso y solo el estado.
    expect(transferido.lecturasDeDesembolso).toEqual([{ columnas: "estado", donde: ["id_monitoria", id(1)] }]);
    // Anulado (lo normal al aceptar), pendiente o sin desembolso (una confirmada): no se transfirió nada.
    for (const estado of ["anulado", "pendiente", null] as const) {
      const { cliente } = clienteFalso([], ACEPTADA, estado);
      expect((await reconstruirAvisoInasistenciaAceptada(id(1), cliente))?.datos.desembolsado, String(estado)).toBe(false);
    }
  });

  it("si no se puede leer el desembolso falla en vez de mandar un correo que quizás diga algo falso (el aviso se reintenta)", async () => {
    const { cliente } = clienteFalso([], ACEPTADA, "error");
    await expect(reconstruirAvisoInasistenciaAceptada(id(1), cliente)).rejects.toThrow(/desembolso.*se cayó la base/);
  });

  it("no lo arma si la monitoría se canceló por otro motivo, no está cancelada o es grupal", async () => {
    for (const cambios of [
      { motivo_cancelacion: "estudiante" },
      { motivo_cancelacion: "pago_rechazado" },
      { estado: "realizada" as const, motivo_cancelacion: null },
      { estado: "confirmada" as const, motivo_cancelacion: null },
      { grupal: true },
    ]) {
      const { cliente } = clienteFalso([], { ...ACEPTADA, ...cambios });
      expect(await reconstruirAvisoInasistenciaAceptada(id(1), cliente), JSON.stringify(cambios)).toBeNull();
    }
  });

  it("no lo arma si el id no es un uuid o la monitoría ya no tiene datos", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cliente, rpc } = clienteFalso([], null);
    expect(await reconstruirAvisoInasistenciaAceptada("no-es-un-id", cliente)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(await reconstruirAvisoInasistenciaAceptada(id(1), cliente)).toBeNull();
  });
});

describe("procesarAvisosAlMonitor con el evento inasistencia_aceptada (HU-030)", () => {
  it("manda aviso_monitor_inasistencia_aceptada con el id de la monitoría como entidad aunque la sesión ya empezó, y lo marca procesado", async () => {
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), evento: "inasistencia_aceptada", intentos: 0 }], ACEPTADA);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosAlMonitor(dependencias);
    expect(resumen).toMatchObject({ revisados: 1, enviados: 1, descartados: 0 });
    expect(enviar).toHaveBeenCalledOnce();
    expect((enviar.mock.calls as unknown as [Record<string, unknown>][])[0][0]).toMatchObject({
      plantilla: "aviso_monitor_inasistencia_aceptada",
      entidad: id(1),
      destinatario: "camilo@calibra.test",
    });
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
    expect(Object.keys(cambios[0].cambios)).toEqual(["procesado_en"]);
  });

  it("con el desembolso ya transferido el correo sale marcado, para que no diga que no se le desembolsa", async () => {
    const { cliente } = clienteFalso([{ id: id(10), id_monitoria: id(1), evento: "inasistencia_aceptada", intentos: 0 }], ACEPTADA, "desembolsado");
    const { dependencias, enviar } = dependenciasCon(cliente);
    await procesarAvisosAlMonitor(dependencias);
    expect((enviar.mock.calls as unknown as [{ datos: Record<string, unknown> }][])[0][0].datos).toMatchObject({ desembolsado: true });
  });

  it("si el desembolso no se puede leer no manda nada y suma un intento: el aviso sigue pendiente", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_monitoria: id(1), evento: "inasistencia_aceptada", intentos: 0 }], ACEPTADA, "error");
    const { dependencias, enviar } = dependenciasCon(cliente);
    expect(await procesarAvisosAlMonitor(dependencias)).toMatchObject({ revisados: 1, conError: 1, enviados: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios).toEqual([{ id: id(10), cambios: { intentos: 1 } }]);
  });

  it("con el motivo distinto lo descarta: procesado y sin correo", async () => {
    const { cliente, cambios } = clienteFalso(
      [{ id: id(10), id_monitoria: id(1), evento: "inasistencia_aceptada", intentos: 0 }],
      { ...ACEPTADA, motivo_cancelacion: "estudiante" },
    );
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarAvisosAlMonitor(dependencias);
    expect(resumen).toMatchObject({ revisados: 1, descartados: 1, enviados: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });
});
