import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import type { Database } from "@/lib/supabase/tipos";

// HU-079 sin base ni red: una bandeja de mentira (tabla, columnas y mensajes inventados) para fijar, una sola vez, lo que
// hacen las seis bandejas reales. Las pruebas de cada una siguen con las suyas; esta fija el bucle que comparten.

const admin = vi.hoisted(() => ({ cliente: null as unknown, creaciones: 0 }));
vi.mock("@/lib/supabase/admin", () => ({
  crearClienteAdmin: () => {
    admin.creaciones++;
    return admin.cliente;
  },
}));
const servidor = vi.hoisted(() => ({ enviarCorreoDesdeServidor: vi.fn() }));
vi.mock("@/lib/correo/servidor", () => servidor);

import {
  LOTE_POR_DEFECTO,
  MAXIMO_DE_INTENTOS,
  PRESUPUESTO_DE_CORRIDA_MS,
  procesarBandeja,
  type DefinicionDeBandeja,
  type DependenciasDeBandeja,
} from "./bandeja";

type Cliente = SupabaseClient<Database>;
type Fila = { id: string; intentos: number; token?: string; contacto?: string };
type Cambio = { tabla: string; columna: string; id: string; cambios: { procesado_en?: string; intentos?: number } };

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fila = (n: number, intentos = 0): Fila => ({ id: id(n), intentos });

/** Un cliente que solo conoce las dos cadenas del procesador común y apunta todo lo que le piden, en orden. */
function clienteFalso(filas: Fila[], opciones: { errorAlLeer?: string; errorAlMarcar?: (vez: number) => string | undefined } = {}) {
  const llamadas: string[] = [];
  const cambios: Cambio[] = [];
  let marcados = 0;
  const cliente = {
    from: (tabla: string) => ({
      select: (columnas: string) => ({
        is: (columna: string, valor: null) => ({
          order: (...orden: unknown[]) => ({
            limit: async (limite: number) => {
              llamadas.push(`${tabla}.select(${columnas}).is(${columna},${valor}).order(${JSON.stringify(orden)}).limit(${limite})`);
              return opciones.errorAlLeer ? { data: null, error: { message: opciones.errorAlLeer } } : { data: filas, error: null };
            },
          }),
        }),
      }),
      update: (campos: Cambio["cambios"]) => ({
        eq: async (columna: string, valor: string) => {
          marcados++;
          llamadas.push(`${tabla}.update`);
          cambios.push({ tabla, columna, id: valor, cambios: campos });
          const error = opciones.errorAlMarcar?.(marcados);
          return { error: error ? { message: error } : null };
        },
      }),
    }),
  };
  return { cliente: cliente as unknown as Cliente, llamadas, cambios };
}

const ENVIADO: ResultadoEnvio = { ok: true, yaEnviado: false, intentos: 1, idProveedor: "p-1" };
const fallo = (motivo: Extract<ResultadoEnvio, { ok: false }>["motivo"], error = "texto del proveedor tal cual"): ResultadoEnvio => ({
  ok: false,
  motivo,
  error,
  intentos: 1,
});

function definicion(extra: Partial<DefinicionDeBandeja<Fila>> = {}): DefinicionDeBandeja<Fila> {
  return {
    prefijo: "prueba",
    tabla: "cancelacion_cita",
    lote: 3,
    lectura: { columnas: "id, intentos, token", orden: "creada_en" },
    textos: { leer: "No se pudieron leer los de prueba", marcar: "No se pudo marcar el de prueba" },
    nombrar: (f) => `el de prueba ${f.id}`,
    mandar: async () => ENVIADO,
    ...extra,
  };
}

function dependenciasCon(cliente: Cliente, reloj: () => number = () => 0) {
  const enviar = vi.fn(async () => ENVIADO);
  const dependencias: DependenciasDeBandeja = { cliente, enviar: enviar as unknown as DependenciasDeBandeja["enviar"], reloj };
  return { dependencias, enviar };
}

const REGISTRADO = (error: ReturnType<typeof vi.spyOn>) => (error.mock.calls as unknown[][]).map((argumentos) => argumentos.join(" "));

beforeEach(() => {
  admin.creaciones = 0;
  servidor.enviarCorreoDesdeServidor.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  admin.cliente = null;
});

describe("la lectura", () => {
  it("solo toma filas sin procesar, de la más antigua a la más reciente, hasta el lote de la definición", async () => {
    const { cliente, llamadas } = clienteFalso([]);
    await procesarBandeja(definicion(), dependenciasCon(cliente).dependencias);
    expect(llamadas).toEqual(['cancelacion_cita.select(id, intentos, token).is(procesado_en,null).order(["creada_en"]).limit(3)']);
  });

  it("el lote por defecto es 10, el presupuesto 20 000 ms y el máximo de intentos 5", () => {
    expect([LOTE_POR_DEFECTO, PRESUPUESTO_DE_CORRIDA_MS, MAXIMO_DE_INTENTOS]).toEqual([10, 20_000, 5]);
  });

  it("una definición con su propia lectura la recibe con el cliente y el lote, y no toca el select", async () => {
    const { cliente, llamadas } = clienteFalso([]);
    const leer = vi.fn(async () => ({ data: [fila(1)], error: null }));
    const resumen = await procesarBandeja(definicion({ lectura: { leer } }), dependenciasCon(cliente).dependencias);
    expect(leer.mock.calls).toEqual([[cliente, 3]]);
    expect(resumen.revisadas).toBe(1);
    expect(llamadas).toEqual(["cancelacion_cita.update"]);
  });

  it("si no puede leer lanza con el texto de la definición y el de la base, sin tocar nada", async () => {
    const { cliente, cambios } = clienteFalso([fila(1)], { errorAlLeer: "sin permiso" });
    const mandar = vi.fn(async () => ENVIADO);
    await expect(procesarBandeja(definicion({ mandar }), dependenciasCon(cliente).dependencias)).rejects.toThrow("No se pudieron leer los de prueba: sin permiso");
    expect(mandar).not.toHaveBeenCalled();
    expect(cambios).toEqual([]);
  });

  it("sin filas no hace nada y el resumen trae sus claves en el orden de siempre", async () => {
    const { cliente, cambios } = clienteFalso([]);
    const resumen = await procesarBandeja(definicion(), dependenciasCon(cliente).dependencias);
    expect(resumen).toStrictEqual({ revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(Object.keys(resumen)).toEqual(["revisadas", "enviadas", "descartadas", "fallidas", "tomadasPorOtro", "conError", "pospuestas"]);
    expect(cambios).toEqual([]);
  });

  it("solo una definición con gancho «en espera» trae enEspera, en el tercer lugar", async () => {
    const { cliente } = clienteFalso([]);
    const con = await procesarBandeja({ ...definicion(), enEspera: async () => false }, dependenciasCon(cliente).dependencias);
    expect(Object.keys(con)).toEqual(["revisadas", "enviadas", "enEspera", "descartadas", "fallidas", "tomadasPorOtro", "conError", "pospuestas"]);
  });

  it("cada corrida lleva su propio resumen", async () => {
    const { cliente } = clienteFalso([fila(1)]);
    const { dependencias } = dependenciasCon(cliente);
    await procesarBandeja(definicion(), dependencias);
    expect((await procesarBandeja(definicion(), dependencias)).enviadas).toBe(1);
  });
});

describe("el presupuesto de tiempo", () => {
  it("lee el reloj una vez al empezar y una por fila; con 20 000 ms justos deja las que quedan sin marcar", async () => {
    const { cliente, cambios } = clienteFalso([fila(1), fila(2), fila(3)]);
    const lecturas = [0, PRESUPUESTO_DE_CORRIDA_MS - 1, PRESUPUESTO_DE_CORRIDA_MS, PRESUPUESTO_DE_CORRIDA_MS];
    const reloj = vi.fn(() => lecturas.shift()!);
    const mandar = vi.fn(async () => ENVIADO);
    const resumen = await procesarBandeja(definicion({ mandar }), dependenciasCon(cliente, reloj).dependencias);
    expect(resumen).toMatchObject({ revisadas: 3, enviadas: 1, pospuestas: 2, conError: 0 });
    expect(reloj).toHaveBeenCalledTimes(4);
    expect(mandar).toHaveBeenCalledOnce();
    expect(cambios.map((c) => c.id)).toEqual([id(1)]);
  });

  it("sin reloj propio usa el de verdad (Date.now)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-12T12:00:00.000Z"));
    const { cliente, cambios } = clienteFalso([fila(1), fila(2)]);
    const mandar = vi.fn(async () => {
      vi.setSystemTime(Date.now() + PRESUPUESTO_DE_CORRIDA_MS);
      return ENVIADO;
    });
    const resumen = await procesarBandeja(definicion({ mandar }), { cliente, enviar: servidor.enviarCorreoDesdeServidor });
    expect(resumen).toMatchObject({ revisadas: 2, enviadas: 1, pospuestas: 1 });
    expect(cambios.map((c) => c.id)).toEqual([id(1)]);
  });
});

describe("el marcado", () => {
  it("marca en la tabla de la definición, por id, con el instante real y nada más", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-12T12:00:00.000Z"));
    const { cliente, cambios } = clienteFalso([fila(1)]);
    const resumen = await procesarBandeja(definicion(), dependenciasCon(cliente, () => 5).dependencias);
    expect(resumen.enviadas).toBe(1);
    expect(cambios).toEqual([{ tabla: "cancelacion_cita", columna: "id", id: id(1), cambios: { procesado_en: "2099-01-12T12:00:00.000Z" } }]);
  });

  it("descarta la que la definición dice que ya no vale: sin correo, marcada", async () => {
    const { cliente, cambios } = clienteFalso([fila(1)]);
    const resumen = await procesarBandeja(definicion({ mandar: async () => null }), dependenciasCon(cliente).dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, descartadas: 1, enviadas: 0, conError: 0 });
    expect(cambios.map((c) => Object.keys(c.cambios))).toEqual([["procesado_en"]]);
  });

  it("tomada por otra corrida: se cuenta y se marca", async () => {
    const { cliente, cambios } = clienteFalso([fila(1)]);
    const resumen = await procesarBandeja(definicion({ mandar: async () => fallo("en_curso") }), dependenciasCon(cliente).dependencias);
    expect(resumen).toMatchObject({ tomadasPorOtro: 1, fallidas: 0, conError: 0 });
    expect(cambios.map((c) => Object.keys(c.cambios))).toEqual([["procesado_en"]]);
  });

  it.each(["fallo_del_proveedor", "sin_proveedor", "contacto_no_es_correo"] as const)(
    "%s: fallida, con el texto de quien falló tal cual en el log, y marcada",
    async (motivo) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { cliente, cambios } = clienteFalso([{ ...fila(1), token: "TOKEN-SECRETO", contacto: "ana@calibra.test" }]);
      const resumen = await procesarBandeja(definicion({ mandar: async () => fallo(motivo, "SMTP 550: ana@calibra.test no existe") }), dependenciasCon(cliente).dependencias);
      expect(resumen).toMatchObject({ revisadas: 1, fallidas: 1, conError: 0, enviadas: 0 });
      expect(cambios.map((c) => Object.keys(c.cambios))).toEqual([["procesado_en"]]);
      expect(REGISTRADO(error)).toEqual([`[prueba] el de prueba ${id(1)} no salió: SMTP 550: ana@calibra.test no existe`]);
    },
  );

  it("el log nombra la fila como dice la definición y no vuelca ninguno de sus datos", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteFalso([{ ...fila(1), token: "TOKEN-SECRETO", contacto: "ana@calibra.test" }]);
    const mandar = async () => {
      throw new Error("boom");
    };
    await procesarBandeja(definicion({ mandar }), dependenciasCon(cliente).dependencias);
    const registrado = REGISTRADO(error).join("\n");
    expect(registrado).toContain(`el de prueba ${id(1)}`);
    expect(registrado).not.toContain("TOKEN-SECRETO");
    expect(registrado).not.toContain("ana@calibra.test");
  });
});

describe("lo que no se pudo procesar", () => {
  it("fallo_del_registro: con error, suma un intento y no la marca procesada", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([fila(1, 1)]);
    const resumen = await procesarBandeja(definicion({ mandar: async () => fallo("fallo_del_registro", "sin base") }), dependenciasCon(cliente).dependencias);
    expect(resumen).toMatchObject({ revisadas: 1, conError: 1, enviadas: 0, fallidas: 0 });
    expect(cambios).toEqual([{ tabla: "cancelacion_cita", columna: "id", id: id(1), cambios: { intentos: 2 } }]);
    expect(REGISTRADO(error)).toEqual([`[prueba] no se pudo procesar el de prueba ${id(1)} (intento 2): sin base`]);
  });

  it.each([
    ["un Error", new Error("boom"), "boom"],
    ["un texto suelto", "se cayó", "se cayó"],
  ])("lanzar %s al armar el correo cuenta como error, con el mensaje en el log", async (_nombre, lanzado, mensaje) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([fila(1)]);
    const mandar = async () => {
      throw lanzado;
    };
    const resumen = await procesarBandeja(definicion({ mandar }), dependenciasCon(cliente).dependencias);
    expect(resumen.conError).toBe(1);
    expect(cambios.map((c) => c.cambios)).toEqual([{ intentos: 1 }]);
    expect(REGISTRADO(error)).toEqual([`[prueba] no se pudo procesar el de prueba ${id(1)} (intento 1): ${mensaje}`]);
  });

  it("el quinto intento la abandona (queda procesada y lo dice el log); el cuarto todavía no", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([fila(1, MAXIMO_DE_INTENTOS - 1), fila(2, MAXIMO_DE_INTENTOS - 2)]);
    const mandar = async () => {
      throw new Error("boom");
    };
    await procesarBandeja(definicion({ mandar }), dependenciasCon(cliente).dependencias);
    expect(cambios.map((c) => [c.id, Object.keys(c.cambios).sort(), c.cambios.intentos])).toEqual([
      [id(1), ["intentos", "procesado_en"], MAXIMO_DE_INTENTOS],
      [id(2), ["intentos"], MAXIMO_DE_INTENTOS - 1],
    ]);
    expect(REGISTRADO(error)).toEqual([
      `[prueba] no se pudo procesar el de prueba ${id(1)} (intento 5, se abandona): boom`,
      `[prueba] no se pudo procesar el de prueba ${id(2)} (intento 4): boom`,
    ]);
  });

  it("un error en una fila no detiene a las demás, y se procesan una tras otra en el orden de la lectura", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([fila(1), fila(2), fila(3)]);
    const eventos: string[] = [];
    const mandar = async (f: Fila) => {
      eventos.push(`empieza ${f.id}`);
      await new Promise((resolver) => setTimeout(resolver, f.id === id(1) ? 20 : 0));
      eventos.push(`termina ${f.id}`);
      if (f.id === id(1)) throw new Error("boom");
      return ENVIADO;
    };
    const resumen = await procesarBandeja(definicion({ mandar }), dependenciasCon(cliente).dependencias);
    expect(resumen).toMatchObject({ revisadas: 3, conError: 1, enviadas: 2 });
    expect(eventos).toEqual([`empieza ${id(1)}`, `termina ${id(1)}`, `empieza ${id(2)}`, `termina ${id(2)}`, `empieza ${id(3)}`, `termina ${id(3)}`]);
    expect(cambios.map((c) => c.id)).toEqual([id(1), id(2), id(3)]);
  });
});

describe("el marcado que falla (el conteo doble de hoy, que se conserva)", () => {
  it("el correo salió y no se pudo marcar: queda enviada y con error, se le suma el intento y se sigue", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([fila(1, 1), fila(2)], { errorAlMarcar: (vez) => (vez === 1 ? "se cayó la base" : undefined) });
    const resumen = await procesarBandeja(definicion(), dependenciasCon(cliente).dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, enviadas: 2, conError: 1 });
    expect(cambios.map((c) => [c.id, Object.keys(c.cambios)])).toEqual([
      [id(1), ["procesado_en"]],
      [id(1), ["intentos"]],
      [id(2), ["procesado_en"]],
    ]);
    expect(cambios[1].cambios.intentos).toBe(2);
    expect(REGISTRADO(error)).toEqual([`[prueba] no se pudo procesar el de prueba ${id(1)} (intento 2): No se pudo marcar el de prueba: se cayó la base`]);
  });

  it("si tampoco puede anotar el intento lo deja en el log y sigue con las demás", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteFalso([fila(1), fila(2)], { errorAlMarcar: (vez) => (vez <= 2 ? `falla ${vez}` : undefined) });
    const resumen = await procesarBandeja(definicion(), dependenciasCon(cliente).dependencias);
    expect(resumen).toMatchObject({ revisadas: 2, enviadas: 2, conError: 1 });
    const llamadas = error.mock.calls as unknown[][];
    expect(llamadas[1]).toEqual(["[prueba] tampoco se pudo anotar el intento:", "No se pudo marcar el de prueba: falla 2"]);
  });
});

describe("el gancho «en espera»", () => {
  it("solo se pregunta cuando la definición dice que ya no vale; en espera no se marca ni suma intento y se sigue", async () => {
    const { cliente, cambios } = clienteFalso([fila(1), fila(2), fila(3)]);
    const mandar = vi.fn(async (f: Fila) => (f.id === id(3) ? ENVIADO : null));
    const enEspera = vi.fn(async (f: Fila) => f.id === id(1));
    const resumen = await procesarBandeja({ ...definicion({ mandar }), enEspera }, dependenciasCon(cliente).dependencias);
    expect(resumen).toStrictEqual({ revisadas: 3, enviadas: 1, enEspera: 1, descartadas: 1, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 });
    expect(enEspera.mock.calls.map(([f]) => f.id)).toEqual([id(1), id(2)]);
    expect(cambios.map((c) => c.id)).toEqual([id(2), id(3)]);
  });

  it("si no puede saberlo cuenta el error y suma un intento", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente, cambios } = clienteFalso([fila(1)]);
    const enEspera = async () => {
      throw new Error("sin permiso");
    };
    const resumen = await procesarBandeja({ ...definicion({ mandar: async () => null }), enEspera }, dependenciasCon(cliente).dependencias);
    expect(resumen).toMatchObject({ conError: 1, enEspera: 0, descartadas: 0 });
    expect(cambios.map((c) => c.cambios)).toEqual([{ intentos: 1 }]);
  });
});

describe("las dependencias", () => {
  it("sin ellas usa el cliente de la llave secreta y el envío del servidor; con ellas no crea ningún cliente", async () => {
    const mandar = vi.fn<DefinicionDeBandeja<Fila>["mandar"]>(async () => ENVIADO);
    admin.cliente = clienteFalso([fila(1)]).cliente;
    await procesarBandeja(definicion({ mandar }));
    expect(admin.creaciones).toBe(1);
    expect(mandar.mock.calls[0][1]).toEqual({ cliente: admin.cliente, enviar: servidor.enviarCorreoDesdeServidor });

    admin.creaciones = 0;
    const { cliente } = clienteFalso([fila(1)]);
    await procesarBandeja(definicion({ mandar }), dependenciasCon(cliente).dependencias);
    expect(admin.creaciones).toBe(0);
  });
});
