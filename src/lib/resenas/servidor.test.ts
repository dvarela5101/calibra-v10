import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import type { Database } from "@/lib/supabase/tipos";
import {
  LOTE_DE_INVITACIONES,
  MAXIMO_DE_INTENTOS,
  PRESUPUESTO_DE_CORRIDA_MS,
  procesarInvitacionesResena,
  reconstruirInvitacionResena,
  type DependenciasDeInvitaciones,
} from "./servidor";

// HU-035 sin base ni red: un cliente falso que solo sabe las cadenas que usa el procesador y un envío falso.
// La prueba de integración comprueba el cableado con la base real.

const TOKEN = "b".repeat(64);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type FilaDeInvitacion = { id: string; id_pago: string; intentos: number };
type DatosDeRpc = { token: string; disponible: boolean; correo_lead: string; nombre_lead: string; nombre_monitor: string };

const DATOS: DatosDeRpc = { token: TOKEN, disponible: true, correo_lead: "ana@calibra.test", nombre_lead: "Ana", nombre_monitor: "Camilo" };

type Cambio = { id: string; cambios: { procesado_en?: string; intentos?: number } };

function clienteFalso(
  filas: FilaDeInvitacion[],
  opciones: { datos?: (idPago: string) => DatosDeRpc | null; errorAlLeer?: string; errorAlMarcar?: string } = {},
) {
  const consultas: string[] = [];
  const cambios: Cambio[] = [];
  const rpc = vi.fn(async (nombre: string, args: { p_id_pago: string }) => {
    consultas.push(`rpc:${nombre}`);
    const fila = opciones.datos ? opciones.datos(args.p_id_pago) : DATOS;
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
  const dependencias = { cliente, enviar: enviarFalso as unknown as DependenciasDeInvitaciones["enviar"], reloj: () => 0 };
  return { dependencias, enviar: enviarFalso };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reconstruirInvitacionResena (HU-035)", () => {
  it("arma el correo con el enlace del token y el correo del Lead", async () => {
    const { cliente } = clienteFalso([]);
    const correo = await reconstruirInvitacionResena(id(1), cliente);
    expect(correo?.destinatario).toBe("ana@calibra.test");
    expect(correo?.datos.nombre).toBe("Ana");
    expect(correo?.datos.monitor).toBe("Camilo");
    expect(correo?.datos.enlace).toMatch(new RegExp(`/resena\\?token=${TOKEN}$`));
  });

  it("es null si ya no se puede reseñar, si no hay invitación o si el id no es un uuid", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const noDisponible = clienteFalso([], { datos: () => ({ ...DATOS, disponible: false }) });
    expect(await reconstruirInvitacionResena(id(1), noDisponible.cliente)).toBeNull();
    const sinInvitacion = clienteFalso([], { datos: () => null });
    expect(await reconstruirInvitacionResena(id(1), sinInvitacion.cliente)).toBeNull();
    const cualquiera = clienteFalso([]);
    expect(await reconstruirInvitacionResena("cita-1", cualquiera.cliente)).toBeNull();
    expect(cualquiera.rpc).not.toHaveBeenCalled();
  });
});

describe("procesarInvitacionesResena (HU-035)", () => {
  it("manda la invitación pendiente, con el id del pago como entidad, y la marca procesada", async () => {
    const { cliente, consultas, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), intentos: 0 }]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarInvitacionesResena(dependencias);
    expect(resumen).toEqual({ revisadas: 1, enviadas: 1, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(consultas[0]).toBe(`invitacion_resena.select(id, id_pago, intentos).is(procesado_en,null).order(creada_en).limit(${LOTE_DE_INVITACIONES})`);
    expect(enviar).toHaveBeenCalledOnce();
    const entrada = (enviar.mock.calls as unknown as [{ plantilla: string; entidad: string; destinatario: string }][])[0][0];
    expect(entrada).toMatchObject({ plantilla: "resena_individual", entidad: id(1), destinatario: "ana@calibra.test" });
    expect(cambios).toHaveLength(1);
    expect(cambios[0].id).toBe(id(10));
    expect(Object.keys(cambios[0].cambios)).toEqual(["procesado_en"]);
  });

  it("descarta la que ya no vale, sin mandar nada, y la marca procesada", async () => {
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), intentos: 0 }], {
      datos: () => ({ ...DATOS, disponible: false }),
    });
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarInvitacionesResena(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, descartadas: 1, enviadas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });

  it("cuenta el correo fallido y el tomado por otra corrida, y marca ambos procesados", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const filas = [
      { id: id(10), id_pago: id(1), intentos: 0 },
      { id: id(11), id_pago: id(2), intentos: 0 },
    ];
    const { cliente, cambios } = clienteFalso(filas);
    const respuestas: ResultadoEnvio[] = [
      { ok: false, motivo: "fallo_del_proveedor", error: "caído", intentos: 3 },
      { ok: false, motivo: "en_curso", error: "otra corrida", intentos: 0 },
    ];
    const { dependencias } = dependenciasCon(cliente, async () => respuestas.shift()!);
    const resumen = await procesarInvitacionesResena(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, fallidas: 1, tomadasPorOtro: 1, enviadas: 0, conError: 0 });
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11)]);
  });

  it("si el registro del correo falla, suma un intento y no la marca procesada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), intentos: 1 }]);
    const { dependencias } = dependenciasCon(cliente, { ok: false, motivo: "fallo_del_registro", error: "sin base", intentos: 0 });
    const resumen = await procesarInvitacionesResena(dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, conError: 1, enviadas: 0 });
    expect(cambios).toEqual([{ id: id(10), cambios: { intentos: 2 } }]);
  });

  it("al llegar al máximo de intentos la abandona: queda procesada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([{ id: id(10), id_pago: id(1), intentos: MAXIMO_DE_INTENTOS - 1 }]);
    const { dependencias } = dependenciasCon(cliente, async () => {
      throw new Error("boom");
    });
    const resumen = await procesarInvitacionesResena(dependencias);
    expect(resumen.conError).toBe(1);
    expect(cambios).toHaveLength(1);
    expect(cambios[0].cambios.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(cambios[0].cambios.procesado_en).toBeTruthy();
  });

  it("un error de la base en una no detiene a las demás", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const filas = [
      { id: id(10), id_pago: id(1), intentos: 0 },
      { id: id(11), id_pago: id(2), intentos: 0 },
    ];
    const { cliente, cambios } = clienteFalso(filas);
    let n = 0;
    const { dependencias, enviar } = dependenciasCon(cliente, async () => {
      if (n++ === 0) throw new Error("boom");
      return ENVIADO;
    });
    const resumen = await procesarInvitacionesResena(dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, conError: 1, enviadas: 1 });
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(cambios.map((c) => c.id)).toEqual([id(10), id(11)]);
  });

  it("pasado el presupuesto de tiempo pospone las que quedan", async () => {
    const filas = [
      { id: id(10), id_pago: id(1), intentos: 0 },
      { id: id(11), id_pago: id(2), intentos: 0 },
      { id: id(12), id_pago: id(3), intentos: 0 },
    ];
    const { cliente, cambios } = clienteFalso(filas);
    const { dependencias, enviar } = dependenciasCon(cliente);
    let ahora = 0;
    const reloj = () => ahora;
    const enviarYAvanzar = vi.fn(async () => {
      ahora += PRESUPUESTO_DE_CORRIDA_MS;
      return ENVIADO;
    });
    const resumen = await procesarInvitacionesResena({ ...dependencias, enviar: enviarYAvanzar as unknown as DependenciasDeInvitaciones["enviar"], reloj });
    expect(resumen).toMatchObject({ revisadas: 3, enviadas: 1, pospuestas: 2 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios.map((c) => c.id)).toEqual([id(10)]);
  });

  it("lanza si no puede leer las invitaciones", async () => {
    const { cliente } = clienteFalso([], { errorAlLeer: "sin permiso" });
    const { dependencias } = dependenciasCon(cliente);
    await expect(procesarInvitacionesResena(dependencias)).rejects.toThrow("No se pudieron leer las invitaciones: sin permiso");
  });

  it("sin invitaciones no hace nada", async () => {
    const { cliente, cambios } = clienteFalso([]);
    const { dependencias, enviar } = dependenciasCon(cliente);
    const resumen = await procesarInvitacionesResena(dependencias);
    expect(resumen).toEqual({ revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(cambios).toEqual([]);
  });
});
