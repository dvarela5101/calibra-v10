import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import type { Database } from "@/lib/supabase/tipos";

// HU-025 sin base ni red: un cliente falso que solo sabe las cadenas que usa el código y un envío falso. Qué pedidos
// anota la base y cuándo lo fija supabase/tests/llave_reembolso.test.sql; el cableado con la base real, la integración.

const admin = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => admin.cliente }));

import { MAXIMO_DE_INTENTOS, PRESUPUESTO_DE_CORRIDA_MS } from "@/lib/citas/servidor";
import {
  LOTE_DE_PEDIDOS,
  procesarPedidosDeLlave,
  reconstruirPedidoDeLlave,
  reconstruirRecordatorioDeLlave,
  type DependenciasDePedidos,
} from "./pedidos";

const TOKEN = "b".repeat(64);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Un día después de que se pidió la llave: dentro del plazo. */
const AHORA = new Date("2026-10-02T15:00:00.000Z");

type FilaDeDatos = {
  tipo: string;
  plazo_desde: string;
  vence_en: string;
  plazo_llave_desde: string;
  estado: string;
  cerrado_en: string | null;
  en_correo_de_cancelacion: boolean;
  contacto: string;
  nombre_pagador: string;
  monto: number;
  motivo: string;
  token: string;
  motivo_cancelacion: string | null;
};

const DATOS: FilaDeDatos = {
  tipo: "pedido",
  // Como la devuelve PostgREST: con microsegundos y zona.
  plazo_desde: "2026-10-01T15:00:00.123456+00:00",
  vence_en: "2026-10-08T15:00:00.123456+00:00",
  plazo_llave_desde: "2026-10-01T15:00:00.123456+00:00",
  estado: "esperando_llave",
  cerrado_en: null,
  en_correo_de_cancelacion: false,
  contacto: "pagador@calibra.test",
  nombre_pagador: "Pablo",
  monto: 25_000,
  motivo: "Cancelaste la monitoría dentro del plazo.",
  token: TOKEN,
  motivo_cancelacion: "estudiante",
};

type FilaDePedido = { id: string; tipo: string; intentos: number };
type Cambio = { id: string; cambios: { procesado_en?: string; intentos?: number } };

function clienteFalso(
  filas: FilaDePedido[],
  opciones: {
    datos?: (idPedido: string) => FilaDeDatos | null;
    errorAlLeer?: string;
    rpc?: (nombre: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };
  } = {},
) {
  const consultas: string[] = [];
  const cambios: Cambio[] = [];
  const rpc = vi.fn(async (nombre: string, args: Record<string, unknown> = {}) => {
    consultas.push(`rpc:${nombre}`);
    if (opciones.rpc) return opciones.rpc(nombre, args);
    const fila = opciones.datos ? opciones.datos(String(args.p_id)) : DATOS;
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
          return { error: null };
        },
      }),
    }),
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, consultas, cambios, rpc };
}

const ENVIADO: ResultadoEnvio = { ok: true, yaEnviado: false, intentos: 1, idProveedor: "p-1" };

function dependenciasCon(cliente: SupabaseClient<Database>, enviar: ResultadoEnvio | (() => Promise<ResultadoEnvio>) = ENVIADO) {
  const enviarFalso = vi.fn(async () => (typeof enviar === "function" ? enviar() : enviar));
  const dependencias = { cliente, enviar: enviarFalso as unknown as DependenciasDePedidos["enviar"], reloj: () => 0 };
  return { dependencias, enviar: enviarFalso };
}

type Entrada = { plantilla: string; entidad: string; destinatario: string; datos: Record<string, unknown> };
const entradas = (enviar: ReturnType<typeof vi.fn>) => (enviar.mock.calls as unknown as [Entrada][]).map(([entrada]) => entrada);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  vi.stubEnv("CORREO_DATOS_PERSONALES", "ayuda@calibra.example");
  vi.stubEnv("SITIO_URL", "https://calibra.test");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  admin.cliente = null;
});

describe("reconstruirPedidoDeLlave (criterio 1, P-22)", () => {
  it("arma el pedido a quien pagó, con el enlace a la página de la llave, el vencimiento del ciclo en ISO y el soporte", async () => {
    const { cliente, rpc } = clienteFalso([]);
    const correo = await reconstruirPedidoDeLlave(id(1), cliente);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("datos_de_pedido_llave", { p_id: id(1) });
    expect(correo).toEqual({
      destinatario: "pagador@calibra.test",
      datos: {
        nombre: "Pablo",
        monto: 25_000,
        motivo: "Cancelaste la monitoría dentro del plazo.",
        enlace: `https://calibra.test/reembolso?token=${TOKEN}`,
        venceEn: "2026-10-08T15:00:00.123Z",
        reporteAceptado: false,
        contactoSoporte: "ayuda@calibra.example",
      },
    });
  });

  it("la reapertura y el reenvío salen con la misma plantilla; el recordatorio no", async () => {
    for (const tipo of ["reapertura", "reenvio"]) {
      const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, tipo }) });
      expect(await reconstruirPedidoDeLlave(id(1), cliente), tipo).not.toBeNull();
    }
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, tipo: "recordatorio" }) });
    expect(await reconstruirPedidoDeLlave(id(1), cliente)).toBeNull();
  });

  it("D-37: el pedido de una inasistencia aceptada lo dice", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, motivo_cancelacion: "monitor_no_asistio", motivo: "El monitor no asistió a la monitoría." }) });
    expect((await reconstruirPedidoDeLlave(id(1), cliente))?.datos.reporteAceptado).toBe(true);
  });

  it("una monitoría sin motivo de cancelación no rompe nada", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, motivo_cancelacion: null }) });
    expect((await reconstruirPedidoDeLlave(id(1), cliente))?.datos.reporteAceptado).toBe(false);
  });

  it("sin correo de soporte configurado, el correo no lleva el campo", async () => {
    vi.stubEnv("CORREO_DATOS_PERSONALES", "");
    const { cliente } = clienteFalso([]);
    expect((await reconstruirPedidoDeLlave(id(1), cliente))?.datos).not.toHaveProperty("contactoSoporte");
  });

  it("es null si ya no vale: llave entregada, caso cerrado, otro ciclo, plazo vencido o llave ya pedida por el correo de cancelación", async () => {
    for (const cambios of [
      { estado: "pendiente" },
      { estado: "reembolsado" },
      { cerrado_en: "2026-10-08T15:00:01+00:00" },
      { plazo_llave_desde: "2026-10-20T15:00:00+00:00" },
      { en_correo_de_cancelacion: true },
    ]) {
      const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, ...cambios }) });
      expect(await reconstruirPedidoDeLlave(id(1), cliente), JSON.stringify(cambios)).toBeNull();
    }
    const { cliente } = clienteFalso([]);
    vi.setSystemTime(new Date("2026-10-08T15:00:00.124Z"));
    expect(await reconstruirPedidoDeLlave(id(1), cliente)).toBeNull();
    // P-40: con el instante exacto todavía sale.
    vi.setSystemTime(new Date("2026-10-08T15:00:00.123Z"));
    expect(await reconstruirPedidoDeLlave(id(1), cliente)).not.toBeNull();
  });

  it("es null sin consultar si el id no es un uuid, y null si el pedido no existe", async () => {
    const cualquiera = clienteFalso([]);
    expect(await reconstruirPedidoDeLlave("pedido-1", cualquiera.cliente)).toBeNull();
    expect(cualquiera.rpc).not.toHaveBeenCalled();
    expect(await reconstruirPedidoDeLlave(id(1), clienteFalso([], { datos: () => null }).cliente)).toBeNull();
  });

  it("es null si no hay a quién escribirle, y lo deja en el log con el id del pedido y sin el token", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const contacto of ["", "   "]) {
      const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, contacto }) });
      expect(await reconstruirPedidoDeLlave(id(1), cliente)).toBeNull();
    }
    expect(aviso).toHaveBeenCalledTimes(2);
    expect(aviso.mock.calls.flat().join(" ")).toContain(id(1));
    expect(aviso.mock.calls.flat().join(" ")).not.toContain(TOKEN);
  });

  it("recorta el contacto", async () => {
    const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, contacto: "  pagador@calibra.test " }) });
    expect((await reconstruirPedidoDeLlave(id(1), cliente))?.destinatario).toBe("pagador@calibra.test");
  });

  it("lanza si la base falla (el reintento lo toma como error, no como descarte), sin el token en el mensaje", async () => {
    const { cliente } = clienteFalso([], { rpc: () => ({ data: null, error: { message: "sin permiso" } }) });
    const falla = (await reconstruirPedidoDeLlave(id(1), cliente).catch((error: Error) => error)) as Error;
    expect(falla.message).toBe("No se pudieron leer los datos del pedido de la llave: sin permiso");
  });

  it("lanza si la base devuelve un tipo, un estado o un motivo que no conoce", async () => {
    for (const [cambios, mensaje] of [
      [{ tipo: "aviso" }, "Tipo desconocido"],
      [{ estado: "cerrado" }, "Estado del reembolso desconocido"],
      [{ motivo_cancelacion: "porque_si" }, "Motivo de cancelación desconocido"],
    ] as const) {
      const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, ...cambios }) });
      await expect(reconstruirPedidoDeLlave(id(1), cliente), mensaje).rejects.toThrow(mensaje);
    }
  });

  it("no lee el reloj para el cuerpo: el mismo pedido da el mismo correo en cualquier momento del plazo", async () => {
    const { cliente } = clienteFalso([]);
    const antes = await reconstruirPedidoDeLlave(id(1), cliente);
    vi.setSystemTime(new Date("2026-10-07T23:00:00.000Z"));
    expect(await reconstruirPedidoDeLlave(id(1), cliente)).toEqual(antes);
  });

  it("sin cliente usa la llave secreta", async () => {
    const { cliente, rpc } = clienteFalso([]);
    admin.cliente = cliente;
    expect(await reconstruirPedidoDeLlave(id(1))).not.toBeNull();
    expect(rpc).toHaveBeenCalledOnce();
  });
});

describe("reconstruirRecordatorioDeLlave (criterio 4)", () => {
  const RECORDATORIO = { ...DATOS, tipo: "recordatorio", en_correo_de_cancelacion: true };

  it("arma el recordatorio, también para la llave que pidió el correo de cancelación (supuesto 2)", async () => {
    const { cliente } = clienteFalso([], { datos: () => RECORDATORIO });
    expect(await reconstruirRecordatorioDeLlave(id(2), cliente)).toEqual({
      destinatario: "pagador@calibra.test",
      datos: {
        nombre: "Pablo",
        monto: 25_000,
        motivo: "Cancelaste la monitoría dentro del plazo.",
        enlace: `https://calibra.test/reembolso?token=${TOKEN}`,
        venceEn: "2026-10-08T15:00:00.123Z",
        contactoSoporte: "ayuda@calibra.example",
      },
    });
  });

  it("un pedido no sale como recordatorio, y un recordatorio que ya no vale tampoco", async () => {
    for (const tipo of ["pedido", "reapertura", "reenvio"]) {
      const { cliente } = clienteFalso([], { datos: () => ({ ...DATOS, tipo }) });
      expect(await reconstruirRecordatorioDeLlave(id(2), cliente), tipo).toBeNull();
    }
    const { cliente } = clienteFalso([], { datos: () => ({ ...RECORDATORIO, estado: "pendiente" }) });
    expect(await reconstruirRecordatorioDeLlave(id(2), cliente)).toBeNull();
  });
});

describe("procesarPedidosDeLlave (HU-025)", () => {
  it("manda cada pedido con la plantilla de su tipo, con su id como entidad, y lo marca procesado", async () => {
    const filas = [
      { id: id(10), tipo: "pedido", intentos: 0 },
      { id: id(11), tipo: "recordatorio", intentos: 0 },
      { id: id(12), tipo: "reapertura", intentos: 0 },
    ];
    const tipoDe: Record<string, string> = { [id(10)]: "pedido", [id(11)]: "recordatorio", [id(12)]: "reapertura" };
    const { cliente, consultas, cambios } = clienteFalso(filas, { datos: (idPedido) => ({ ...DATOS, tipo: tipoDe[idPedido] }) });
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarPedidosDeLlave(dependencias);
    expect(resumen).toEqual({ revisadas: 3, enviadas: 3, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(consultas[0]).toBe(`pedido_llave.select(id, tipo, intentos).is(procesado_en,null).order(creada_en).limit(${LOTE_DE_PEDIDOS})`);
    expect(LOTE_DE_PEDIDOS).toBe(10);
    expect(entradas(enviar).map((e) => [e.plantilla, e.entidad, e.destinatario])).toEqual([
      ["solicitud_llave_reembolso", id(10), "pagador@calibra.test"],
      ["recordatorio_llave_reembolso", id(11), "pagador@calibra.test"],
      ["solicitud_llave_reembolso", id(12), "pagador@calibra.test"],
    ]);
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11), id(12)]);
    for (const c of cambios) expect(Object.keys(c.cambios)).toEqual(["procesado_en"]);
  });

  it("descarta el pedido que ya no vale (la llave la pidió el correo de cancelación), sin mandar nada, y lo marca procesado", async () => {
    const { cliente, cambios } = clienteFalso([{ id: id(10), tipo: "pedido", intentos: 0 }], {
      datos: () => ({ ...DATOS, en_correo_de_cancelacion: true }),
    });
    const { dependencias, enviar } = dependenciasCon(cliente);
    expect(await procesarPedidosDeLlave(dependencias)).toMatchObject({ revisadas: 1, descartadas: 1, enviadas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });

  it("cuenta el correo fallido y el tomado por otra corrida, y marca ambos procesados", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([
      { id: id(10), tipo: "pedido", intentos: 0 },
      { id: id(11), tipo: "pedido", intentos: 0 },
    ]);
    const respuestas: ResultadoEnvio[] = [
      { ok: false, motivo: "fallo_del_proveedor", error: "caído", intentos: 3 },
      { ok: false, motivo: "en_curso", error: "otra corrida", intentos: 0 },
    ];
    const { dependencias } = dependenciasCon(cliente, async () => respuestas.shift()!);
    expect(await procesarPedidosDeLlave(dependencias)).toMatchObject({ revisadas: 2, fallidas: 1, tomadasPorOtro: 1, enviadas: 0, conError: 0 });
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11)]);
  });

  it("si el registro del correo falla, suma un intento y no lo marca procesado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), tipo: "pedido", intentos: 1 }]);
    const { dependencias } = dependenciasCon(cliente, { ok: false, motivo: "fallo_del_registro", error: "sin base", intentos: 0 });
    expect(await procesarPedidosDeLlave(dependencias)).toMatchObject({ revisadas: 1, conError: 1, enviadas: 0 });
    expect(cambios).toEqual([{ id: id(10), cambios: { intentos: 2 } }]);
  });

  it("si la base falla al armar el correo, suma un intento sin mandar nada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), tipo: "recordatorio", intentos: 0 }], {
      rpc: () => ({ data: null, error: { message: "sin permiso" } }),
    });
    const { dependencias, enviar } = dependenciasCon(cliente);
    expect(await procesarPedidosDeLlave(dependencias)).toMatchObject({ revisadas: 1, conError: 1, descartadas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios).toEqual([{ id: id(10), cambios: { intentos: 1 } }]);
  });

  it("al llegar al máximo de intentos lo abandona: queda procesado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), tipo: "pedido", intentos: MAXIMO_DE_INTENTOS - 1 }]);
    const { dependencias } = dependenciasCon(cliente, async () => {
      throw new Error("boom");
    });
    expect((await procesarPedidosDeLlave(dependencias)).conError).toBe(1);
    expect(cambios).toHaveLength(1);
    expect(cambios[0].cambios.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(cambios[0].cambios.procesado_en).toBeTruthy();
  });

  it("un error en uno no detiene a los demás, y el log nombra el pedido y nunca el token", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([
      { id: id(10), tipo: "pedido", intentos: 0 },
      { id: id(11), tipo: "pedido", intentos: 0 },
    ]);
    let n = 0;
    const { dependencias, enviar } = dependenciasCon(cliente, async () => {
      if (n++ === 0) throw new Error("boom");
      return ENVIADO;
    });
    expect(await procesarPedidosDeLlave(dependencias)).toMatchObject({ revisadas: 2, conError: 1, enviadas: 1 });
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11)]);
    const registrado = error.mock.calls.flat().join(" ");
    expect(registrado).toContain(id(10));
    expect(registrado).not.toContain(TOKEN);
  });

  it("pasado el presupuesto de tiempo pospone los que quedan", async () => {
    const { cliente, cambios } = clienteFalso([
      { id: id(10), tipo: "pedido", intentos: 0 },
      { id: id(11), tipo: "pedido", intentos: 0 },
    ]);
    let ahora = 0;
    const enviarYAvanzar = vi.fn(async () => {
      ahora += PRESUPUESTO_DE_CORRIDA_MS;
      return ENVIADO;
    });
    const resumen = await procesarPedidosDeLlave({
      cliente,
      enviar: enviarYAvanzar as unknown as DependenciasDePedidos["enviar"],
      reloj: () => ahora,
    });
    expect(resumen).toMatchObject({ revisadas: 2, enviadas: 1, pospuestas: 1 });
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });

  it("lanza si no puede leer los pedidos, y sin pedidos no hace nada", async () => {
    const roto = clienteFalso([], { errorAlLeer: "sin permiso" });
    await expect(procesarPedidosDeLlave(dependenciasCon(roto.cliente).dependencias)).rejects.toThrow("No se pudieron leer los pedidos de llave: sin permiso");
    const vacio = clienteFalso([]);
    const { dependencias, enviar } = dependenciasCon(vacio.cliente);
    expect(await procesarPedidosDeLlave(dependencias)).toEqual({ revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(vacio.cambios).toEqual([]);
  });
});
