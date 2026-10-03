import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import type { Database } from "@/lib/supabase/tipos";

// HU-076 sin base ni red: el aviso al monitor por el rechazo de un pago (evento `pago_rechazado`), con un cliente
// falso que responde `datos_de_aviso_monitor` y un envío falso.

const admin = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => admin.cliente }));

import { procesarAvisosAlMonitor, reconstruirAvisoPagoRechazado, type DependenciasDeAvisos } from "./servidor";

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

function clienteFalso(avisos: { id: string; id_monitoria: string; evento: string; intentos: number }[], datos: DatosDeRpc | null = CANCELADA_POR_PAGO) {
  const cambios: Cambio[] = [];
  const rpc = vi.fn(async () => ({ data: datos ? [datos] : [], error: null }));
  const cliente = {
    rpc,
    from: () => ({
      select: () => ({ is: () => ({ order: () => ({ limit: async () => ({ data: avisos, error: null }) }) }) }),
      update: (campos: Cambio["cambios"]) => ({
        eq: async (_columna: string, valor: string) => {
          cambios.push({ id: valor, cambios: campos });
          return { error: null };
        },
      }),
    }),
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, cambios, rpc };
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
