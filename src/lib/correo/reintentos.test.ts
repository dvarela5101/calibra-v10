import { afterEach, describe, expect, it, vi } from "vitest";
import { claveDeCorreo, type EntradaDeEnvio, type ResultadoEnvio } from "./enviar";
import { PLANTILLAS, type Plantilla, type Reconstruccion } from "./plantillas";
import {
  entidadDeClave,
  LOTE_DE_REINTENTOS,
  reintentarCorreosFallidos,
  VENTANA_DE_REINTENTO_MS,
  type DependenciasDeReintento,
  type Reconstructores,
} from "./reintentos";

// HU-065 sin base ni red: un cliente falso que solo sabe las cadenas que usa el proceso, y dobles de
// reconstructores y de envío. La prueba de integración comprueba el cableado con la base real.

const AHORA = new Date("2026-10-05T15:00:00.000Z");
const HORA = 60 * 60_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("entidadDeClave", () => {
  it("saca la entidad de una clave plantilla:entidad", () => {
    expect(entidadDeClave("invitacion_monitor:7f3c", "invitacion_monitor")).toBe("7f3c");
  });

  it("la entidad puede traer dos puntos: solo se quita el prefijo de la plantilla", () => {
    expect(entidadDeClave("escalamiento_pago:pago-1:admin-2:3", "escalamiento_pago")).toBe("pago-1:admin-2:3");
  });

  it("es null si la clave es de otra plantilla", () => {
    expect(entidadDeClave("resena_individual:abc", "invitacion_monitor")).toBeNull();
  });

  it("es null si el prefijo solo se parece a la plantilla (sin los dos puntos)", () => {
    expect(entidadDeClave("invitacion_monitor_2:abc", "invitacion_monitor")).toBeNull();
    expect(entidadDeClave("invitacion_monitorabc", "invitacion_monitor")).toBeNull();
  });

  it("es null si la entidad está vacía o falta el separador", () => {
    expect(entidadDeClave("invitacion_monitor:", "invitacion_monitor")).toBeNull();
    expect(entidadDeClave("invitacion_monitor", "invitacion_monitor")).toBeNull();
    expect(entidadDeClave("", "invitacion_monitor")).toBeNull();
  });

  it.each([...PLANTILLAS])("%s: deshace lo que hace claveDeCorreo", (plantilla) => {
    expect(entidadDeClave(claveDeCorreo(plantilla, "  entidad-1 "), plantilla)).toBe("entidad-1");
  });
});

describe("la ventana y el lote", () => {
  it("la ventana de reintento es de 24 horas y el lote por defecto, de 25", () => {
    expect(VENTANA_DE_REINTENTO_MS).toBe(24 * HORA);
    expect(LOTE_DE_REINTENTOS).toBe(25);
  });
});

type FilaPorReintentar = { id: string; clave: string; plantilla: string; actualizado_en: string };
type Cliente = DependenciasDeReintento["cliente"];

/** Una escritura del proceso sobre `correo_envio`: tomar la fila (con `select`) o descartarla (sin él). */
type Escritura = { tipo: "tomar" | "descartar"; valores: Record<string, unknown>; eq: [string, unknown][] };

/**
 * Un cliente de Supabase que solo implementa lo que usa el proceso:
 * `from().select().eq().eq().gt().order().limit()` para leer,
 * `from().update().eq().eq().eq().select()` para tomar una fila (HU-065: el candado contra corridas
 * solapadas) y `from().update().eq().eq()` para descartarla. Anota cada llamada y su orden.
 */
function clienteFalso(
  filas: FilaPorReintentar[],
  {
    errorAlLeer,
    errorAlDescartar,
    errorAlTomar,
    tomadasPorOtro = [],
    eventos = [],
  }: {
    errorAlLeer?: string;
    errorAlDescartar?: (id: string) => string | undefined;
    errorAlTomar?: (id: string) => string | undefined;
    /** Ids que otra corrida ya tomó: su UPDATE condicionado no toca ninguna fila. Además, tomar mueve `actualizado_en` como la base. */
    tomadasPorOtro?: string[];
    /** Bitácora compartida con los otros dobles, para comprobar el orden. */
    eventos?: string[];
  } = {},
) {
  const lectura: { tabla?: string; columnas?: string; eq: [string, unknown][]; gt: [string, unknown][]; order?: [string, unknown]; limit?: number } = {
    eq: [],
    gt: [],
  };
  // El `actualizado_en` que tiene cada fila en la "base": tomar solo funciona si sigue siendo el que se leyó.
  const actualizadoEn = new Map(filas.map((f) => [f.id, f.actualizado_en]));
  // Toda escritura empieza como descarte; si se le encadena `select`, era una toma y pasa a la otra lista.
  const descartes: Escritura[] = [];
  const tomas: Escritura[] = [];

  const cliente = {
    from(tabla: string) {
      lectura.tabla = tabla;
      return {
        select(columnas: string) {
          lectura.columnas = columnas;
          const consulta = {
            eq(columna: string, valor: unknown) {
              lectura.eq.push([columna, valor]);
              return consulta;
            },
            gt(columna: string, valor: unknown) {
              lectura.gt.push([columna, valor]);
              return consulta;
            },
            order(columna: string, opciones: unknown) {
              lectura.order = [columna, opciones];
              return consulta;
            },
            limit(cantidad: number) {
              lectura.limit = cantidad;
              return Promise.resolve(errorAlLeer ? { data: null, error: { message: errorAlLeer } } : { data: filas, error: null });
            },
          };
          return consulta;
        },
        update(valores: Record<string, unknown>) {
          const escritura: Escritura = { tipo: "descartar", valores, eq: [] };
          descartes.push(escritura);
          const id = () => String(escritura.eq.find(([columna]) => columna === "id")?.[1]);
          // Como el de verdad: se puede seguir encadenando o esperarlo tal cual (descartar).
          const cadena = {
            eq(columna: string, valor: unknown) {
              escritura.eq.push([columna, valor]);
              return cadena;
            },
            select() {
              escritura.tipo = "tomar";
              descartes.splice(descartes.indexOf(escritura), 1);
              tomas.push(escritura);
              eventos.push(`tomar:${id()}`);
              const mensaje = errorAlTomar?.(id());
              if (mensaje) return Promise.resolve({ data: null, error: { message: mensaje } });
              const esperado = escritura.eq.find(([columna]) => columna === "actualizado_en")?.[1];
              const sigueIgual = !tomadasPorOtro.includes(id()) && actualizadoEn.get(id()) === esperado;
              if (sigueIgual) actualizadoEn.set(id(), String(valores.actualizado_en));
              return Promise.resolve({ data: sigueIgual ? [{ id: id() }] : [], error: null });
            },
            then(resolver: (resultado: { error: { message: string } | null }) => unknown) {
              eventos.push(`descartar:${id()}`);
              const mensaje = errorAlDescartar?.(id());
              return Promise.resolve({ error: mensaje ? { message: mensaje } : null }).then(resolver);
            },
          };
          return cadena;
        },
      };
    },
  } as unknown as Cliente;

  return { cliente, lectura, descartes, tomas };
}

const RECONSTRUCCION_INVITACION: Reconstruccion<"invitacion_monitor"> = {
  destinatario: "aspirante@calibra.test",
  datos: { enlace: "https://calibra.test/monitores/registro?token=abc", venceEn: "2026-10-12T15:00:00.000Z" },
};

/** Todos los reconstructores en null, salvo los que se pasen. */
function reconstructoresCon(cambios: Partial<Reconstructores> = {}): Reconstructores {
  return {
    recuperacion_diagnostico: null,
    resena_individual: null,
    solicitud_llave_reembolso: null,
    pago_rechazado_individual: null,
    pago_rechazado_grupal: null,
    escalamiento_pago: null,
    invitacion_monitor: null,
    ...cambios,
  };
}

const CLAVE_UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACTUALIZADO = (n: number) => `2026-10-05T14:0${n}:00.000000+00:00`;
const fila = (n: number, cambios: Partial<FilaPorReintentar> = {}): FilaPorReintentar => ({
  id: `id-${n}`,
  clave: `invitacion_monitor:${CLAVE_UUID(n)}`,
  plantilla: "invitacion_monitor",
  actualizado_en: ACTUALIZADO(n),
  ...cambios,
});

const OK: ResultadoEnvio = { ok: true, yaEnviado: false, intentos: 1, idProveedor: "prov-1" };
const FALLO: ResultadoEnvio = { ok: false, motivo: "fallo_del_proveedor", error: "Resend 503", intentos: 3 };

/** Un doble de `enviar` que contesta en orden (o siempre lo mismo) y anota lo que recibió. */
function enviarFalso(...respuestas: (ResultadoEnvio | Error)[]) {
  const recibidas: EntradaDeEnvio<Plantilla>[] = [];
  const enviar = vi.fn(async (entrada: EntradaDeEnvio<Plantilla>): Promise<ResultadoEnvio> => {
    recibidas.push(entrada);
    const respuesta = respuestas[Math.min(recibidas.length - 1, respuestas.length - 1)] ?? OK;
    if (respuesta instanceof Error) throw respuesta;
    return respuesta;
  });
  return { enviar: enviar as unknown as DependenciasDeReintento["enviar"], recibidas, llamadas: enviar };
}

describe("reintentarCorreosFallidos: qué le pide a la base", () => {
  it("pide los fallidos reintentables de las últimas 24 horas, los más antiguos primero, con el lote", async () => {
    const { cliente, lectura } = clienteFalso([]);
    const { enviar } = enviarFalso();

    await reintentarCorreosFallidos({ cliente, reconstructores: reconstructoresCon(), enviar, ahora: AHORA });

    expect(lectura.tabla).toBe("correo_envio");
    expect(lectura.columnas).toBe("id, clave, plantilla, actualizado_en");
    expect(lectura.eq).toEqual([
      ["estado", "fallido"],
      ["reintentable", true],
    ]);
    expect(lectura.gt).toEqual([["creado_en", "2026-10-04T15:00:00.000Z"]]);
    expect(lectura.order).toEqual(["actualizado_en", { ascending: true }]);
    expect(lectura.limit).toBe(LOTE_DE_REINTENTOS);
  });

  it("acepta otro tamaño de lote", async () => {
    const { cliente, lectura } = clienteFalso([]);
    await reintentarCorreosFallidos({ cliente, reconstructores: reconstructoresCon(), enviar: enviarFalso().enviar, ahora: AHORA, lote: 3 });
    expect(lectura.limit).toBe(3);
  });

  it("sin nada por reintentar, todo en cero y no envía", async () => {
    const { cliente } = clienteFalso([]);
    const { enviar, llamadas } = enviarFalso();

    const resumen = await reintentarCorreosFallidos({ cliente, reconstructores: reconstructoresCon(), enviar, ahora: AHORA });

    expect(resumen).toEqual({ revisados: 0, enviados: 0, siguenFallando: 0, descartados: 0, conError: 0, tomadosPorOtro: 0 });
    expect(llamadas).not.toHaveBeenCalled();
  });

  it("si no puede leer la lista, lanza con el motivo de la base", async () => {
    const { cliente } = clienteFalso([], { errorAlLeer: "connection refused" });
    await expect(
      reintentarCorreosFallidos({ cliente, reconstructores: reconstructoresCon(), enviar: enviarFalso().enviar, ahora: AHORA }),
    ).rejects.toThrow("No se pudieron leer los correos por reintentar: connection refused");
  });
});

describe("reintentarCorreosFallidos: reconstruir y volver a mandar", () => {
  it("reconstruye desde la entidad de la clave y manda con la misma plantilla y la misma entidad", async () => {
    const f = fila(1);
    const { cliente, descartes, tomas } = clienteFalso([f]);
    const reconstructor = vi.fn(async () => RECONSTRUCCION_INVITACION);
    const { enviar, recibidas } = enviarFalso(OK);

    const resumen = await reintentarCorreosFallidos({
      cliente,
      reconstructores: reconstructoresCon({ invitacion_monitor: reconstructor }),
      enviar,
      ahora: AHORA,
    });

    expect(reconstructor).toHaveBeenCalledExactlyOnceWith(CLAVE_UUID(1));
    expect(recibidas).toEqual([
      {
        plantilla: "invitacion_monitor",
        datos: RECONSTRUCCION_INVITACION.datos,
        destinatario: "aspirante@calibra.test",
        entidad: CLAVE_UUID(1),
      },
    ]);
    // La clave que armará enviarCorreo es la misma de la fila: el mismo correo, sin duplicar.
    expect(claveDeCorreo(recibidas[0].plantilla, recibidas[0].entidad)).toBe(f.clave);
    expect(resumen).toEqual({ revisados: 1, enviados: 1, siguenFallando: 0, descartados: 0, conError: 0, tomadosPorOtro: 0 });
    expect(descartes).toEqual([]);
    // Antes de reconstruir tomó la fila: la marca como suya si nadie la movió (mismo actualizado_en que leyó).
    expect(tomas).toHaveLength(1);
    expect(tomas[0].valores).toEqual({ actualizado_en: AHORA.toISOString() });
    expect(tomas[0].eq).toEqual([
      ["id", "id-1"],
      ["estado", "fallido"],
      ["actualizado_en", f.actualizado_en],
    ]);
  });

  it("el reconstructor de una plantilla no se usa para las demás", async () => {
    const { cliente } = clienteFalso([fila(1, { clave: "solicitud_llave_reembolso:reembolso-9", plantilla: "solicitud_llave_reembolso" })]);
    const deInvitacion = vi.fn(async () => RECONSTRUCCION_INVITACION);
    const deReembolso = vi.fn(async () => ({
      destinatario: "ana@calibra.test",
      datos: { nombre: "Ana", monto: 25_000, motivo: "Cancelaste a tiempo", enlace: "https://calibra.test/x" },
    }));
    const { enviar, recibidas } = enviarFalso(OK);

    await reintentarCorreosFallidos({
      cliente,
      reconstructores: reconstructoresCon({ invitacion_monitor: deInvitacion, solicitud_llave_reembolso: deReembolso }),
      enviar,
      ahora: AHORA,
    });

    expect(deInvitacion).not.toHaveBeenCalled();
    expect(deReembolso).toHaveBeenCalledExactlyOnceWith("reembolso-9");
    expect(recibidas.map((r) => [r.plantilla, r.entidad, r.destinatario])).toEqual([["solicitud_llave_reembolso", "reembolso-9", "ana@calibra.test"]]);
  });

  it("cuenta enviados, los que siguen fallando y los descartados, y sigue con los demás", async () => {
    const filas = [
      fila(1), // sale
      fila(2), // el proveedor sigue caído
      fila(3), // el reconstructor dice que ya no aplica
      fila(4, { clave: "resena_individual:cita-1", plantilla: "resena_individual" }), // sin reconstructor
      fila(5), // sale
      fila(6, { clave: "invitacion_monitor:", plantilla: "invitacion_monitor" }), // clave mal formada
      fila(7, { plantilla: "plantilla_que_no_existe" }), // plantilla desconocida
    ];
    const { cliente, descartes, tomas } = clienteFalso(filas);
    const reconstructor = vi.fn(async (entidad: string) => (entidad === CLAVE_UUID(3) ? null : RECONSTRUCCION_INVITACION));
    const { enviar, llamadas } = enviarFalso(OK, FALLO, OK);

    const resumen = await reintentarCorreosFallidos({
      cliente,
      reconstructores: reconstructoresCon({ invitacion_monitor: reconstructor }),
      enviar,
      ahora: AHORA,
    });

    expect(resumen).toEqual({ revisados: 7, enviados: 2, siguenFallando: 1, descartados: 4, conError: 0, tomadosPorOtro: 0 });
    expect(llamadas).toHaveBeenCalledTimes(3);
    expect(descartes.map((d) => d.eq[0][1])).toEqual(["id-3", "id-4", "id-6", "id-7"]);
    // Solo se toman las que se van a reconstruir: los descartes de plantilla, clave o reconstructor no toman nada.
    expect(tomas.map((t) => t.eq[0][1])).toEqual(["id-1", "id-2", "id-3", "id-5"]);
  });

  it("los manda de uno en uno y en el orden en que llegan", async () => {
    const filas = [fila(1), fila(2), fila(3)];
    const { cliente } = clienteFalso(filas);
    let enCurso = 0;
    let maximo = 0;
    const enviar = (async (entrada: EntradaDeEnvio<Plantilla>) => {
      enCurso += 1;
      maximo = Math.max(maximo, enCurso);
      await new Promise((resolver) => setTimeout(resolver, 5));
      enCurso -= 1;
      return { ...OK, idProveedor: entrada.entidad };
    }) as unknown as DependenciasDeReintento["enviar"];
    const orden: string[] = [];
    const reconstructor = async (entidad: string) => {
      orden.push(entidad);
      return RECONSTRUCCION_INVITACION;
    };

    await reintentarCorreosFallidos({ cliente, reconstructores: reconstructoresCon({ invitacion_monitor: reconstructor }), enviar, ahora: AHORA });

    expect(maximo).toBe(1);
    expect(orden).toEqual([CLAVE_UUID(1), CLAVE_UUID(2), CLAVE_UUID(3)]);
  });
});

describe("reintentarCorreosFallidos: lo que se descarta", () => {
  /** Corre con una sola fila y devuelve lo que el proceso le escribió a la base. */
  async function descartar(f: FilaPorReintentar, reconstructores = reconstructoresCon()) {
    const { cliente, descartes, tomas } = clienteFalso([f]);
    const { enviar, llamadas } = enviarFalso();
    const resumen = await reintentarCorreosFallidos({ cliente, reconstructores, enviar, ahora: AHORA });
    return { resumen, descartes, tomas, llamadas };
  }

  it("una plantilla que no existe: deja de reintentarse, con el motivo, sin reconstruir ni enviar", async () => {
    const reconstructor = vi.fn(async () => RECONSTRUCCION_INVITACION);
    const { resumen, descartes, tomas, llamadas } = await descartar(
      fila(1, { plantilla: "plantilla_que_no_existe", clave: "plantilla_que_no_existe:abc" }),
      reconstructoresCon({ invitacion_monitor: reconstructor }),
    );

    expect(resumen).toMatchObject({ revisados: 1, descartados: 1, enviados: 0, siguenFallando: 0, conError: 0, tomadosPorOtro: 0 });
    expect(descartes).toHaveLength(1);
    expect(descartes[0].valores).toEqual({
      reintentable: false,
      ultimo_error: "No se reconoce la plantilla o la clave del correo (plantilla_que_no_existe).",
      actualizado_en: AHORA.toISOString(),
    });
    // Solo toca esa fila y solo si sigue fallida: si otro proceso ya la mandó, no la pisa.
    expect(descartes[0].eq).toEqual([
      ["id", "id-1"],
      ["estado", "fallido"],
    ]);
    // Se descarta sin tomar la fila: no hay nada que reconstruir.
    expect(tomas).toEqual([]);
    expect(reconstructor).not.toHaveBeenCalled();
    expect(llamadas).not.toHaveBeenCalled();
  });

  it("una clave que no es de su plantilla o no tiene entidad: se descarta", async () => {
    const reconstructor = vi.fn(async () => RECONSTRUCCION_INVITACION);
    for (const clave of ["resena_individual:otra-cosa", "invitacion_monitor:", "invitacion_monitor", "sin-separador"]) {
      const { resumen, descartes, tomas, llamadas } = await descartar(fila(1, { clave }), reconstructoresCon({ invitacion_monitor: reconstructor }));
      expect(tomas, clave).toEqual([]);
      expect(resumen, clave).toMatchObject({ descartados: 1, enviados: 0, conError: 0, tomadosPorOtro: 0 });
      expect(descartes[0].valores, clave).toMatchObject({ reintentable: false });
      expect(String(descartes[0].valores.ultimo_error), clave).toContain("No se reconoce la plantilla o la clave");
      expect(llamadas, clave).not.toHaveBeenCalled();
    }
    expect(reconstructor).not.toHaveBeenCalled();
  });

  it("una plantilla que ninguna HU dispara todavía (reconstructor null): se descarta", async () => {
    const { resumen, descartes, tomas, llamadas } = await descartar(fila(1, { clave: "escalamiento_pago:pago-1:2", plantilla: "escalamiento_pago" }));

    expect(resumen).toMatchObject({ revisados: 1, descartados: 1, enviados: 0 });
    expect(tomas).toEqual([]);
    expect(descartes[0].valores).toMatchObject({
      reintentable: false,
      ultimo_error: "No hay cómo reconstruir este correo para reintentarlo.",
      actualizado_en: AHORA.toISOString(),
    });
    expect(llamadas).not.toHaveBeenCalled();
  });

  it("cuando la entidad ya no aplica (el reconstructor devuelve null): se descarta con el motivo", async () => {
    const reconstructor = vi.fn(async () => null);
    const { resumen, descartes, tomas, llamadas } = await descartar(fila(1), reconstructoresCon({ invitacion_monitor: reconstructor }));

    expect(reconstructor).toHaveBeenCalledExactlyOnceWith(CLAVE_UUID(1));
    // Este descarte ocurre después de tomar la fila, y su UPDATE sigue filtrando solo por id y estado.
    expect(tomas).toHaveLength(1);
    expect(descartes[0].eq).toEqual([
      ["id", "id-1"],
      ["estado", "fallido"],
    ]);
    expect(resumen).toMatchObject({ revisados: 1, descartados: 1, enviados: 0, siguenFallando: 0, conError: 0, tomadosPorOtro: 0 });
    expect(descartes[0].valores.reintentable).toBe(false);
    expect(String(descartes[0].valores.ultimo_error)).toContain("El correo ya no aplica");
    expect(descartes[0].valores.actualizado_en).toBe(AHORA.toISOString());
    expect(llamadas).not.toHaveBeenCalled();
  });

  it("el motivo cabe en la columna: una línea y menos de 500 caracteres aunque la plantilla sea enorme", async () => {
    const plantilla = `rara-${"x".repeat(1_000)}\n\nsegunda línea`;
    const { descartes } = await descartar(fila(1, { plantilla, clave: `${plantilla}:abc` }));

    const error = String(descartes[0].valores.ultimo_error);
    expect(error.length).toBeLessThanOrEqual(300);
    expect(error).not.toMatch(/[\r\n]/);
  });

  it("si no puede anotar el descarte, cuenta un error (no un descartado) y la próxima corrida lo intenta otra vez", async () => {
    const { cliente } = clienteFalso([fila(1, { plantilla: "plantilla_que_no_existe" })], { errorAlDescartar: () => "permiso denegado" });
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const resumen = await reintentarCorreosFallidos({ cliente, reconstructores: reconstructoresCon(), enviar: enviarFalso().enviar, ahora: AHORA });

    expect(resumen).toEqual({ revisados: 1, enviados: 0, siguenFallando: 0, descartados: 0, conError: 1, tomadosPorOtro: 0 });
    expect(consola).toHaveBeenCalledOnce();
    expect(String(consola.mock.calls[0][0])).toContain("permiso denegado");
  });
});

describe("reintentarCorreosFallidos: tomar la fila antes de reconstruirla (corridas que se solapan)", () => {
  it("toma la fila antes de reconstruir y antes de enviar", async () => {
    const eventos: string[] = [];
    const { cliente } = clienteFalso([fila(1)], { eventos });
    const reconstructor = async (entidad: string) => {
      eventos.push(`reconstruir:${entidad}`);
      return RECONSTRUCCION_INVITACION;
    };
    const enviar = (async () => {
      eventos.push("enviar");
      return OK;
    }) as unknown as DependenciasDeReintento["enviar"];

    await reintentarCorreosFallidos({ cliente, reconstructores: reconstructoresCon({ invitacion_monitor: reconstructor }), enviar, ahora: AHORA });

    expect(eventos).toEqual(["tomar:id-1", `reconstruir:${CLAVE_UUID(1)}`, "enviar"]);
  });

  it("si tomar no toca ninguna fila (otra corrida llegó antes), no reconstruye ni envía y cuenta tomadosPorOtro", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cliente, descartes, tomas } = clienteFalso([fila(1)], { tomadasPorOtro: ["id-1"] });
    const reconstructor = vi.fn(async () => RECONSTRUCCION_INVITACION);
    const { enviar, llamadas } = enviarFalso(OK);

    const resumen = await reintentarCorreosFallidos({
      cliente,
      reconstructores: reconstructoresCon({ invitacion_monitor: reconstructor }),
      enviar,
      ahora: AHORA,
    });

    expect(resumen).toEqual({ revisados: 1, enviados: 0, siguenFallando: 0, descartados: 0, conError: 0, tomadosPorOtro: 1 });
    expect(tomas).toHaveLength(1);
    expect(reconstructor).not.toHaveBeenCalled();
    expect(llamadas).not.toHaveBeenCalled();
    // No es un error ni un descarte: la otra corrida se encarga.
    expect(descartes).toEqual([]);
    expect(consola).not.toHaveBeenCalled();
  });

  it("una fila que otra corrida se llevó no frena a las demás", async () => {
    const { cliente } = clienteFalso([fila(1), fila(2), fila(3)], { tomadasPorOtro: ["id-2"] });
    const reconstruidas: string[] = [];
    const reconstructor = async (entidad: string) => {
      reconstruidas.push(entidad);
      return RECONSTRUCCION_INVITACION;
    };
    const { enviar, llamadas } = enviarFalso(OK);

    const resumen = await reintentarCorreosFallidos({
      cliente,
      reconstructores: reconstructoresCon({ invitacion_monitor: reconstructor }),
      enviar,
      ahora: AHORA,
    });

    expect(resumen).toEqual({ revisados: 3, enviados: 2, siguenFallando: 0, descartados: 0, conError: 0, tomadosPorOtro: 1 });
    expect(reconstruidas).toEqual([CLAVE_UUID(1), CLAVE_UUID(3)]);
    expect(llamadas).toHaveBeenCalledTimes(2);
  });

  it("si no puede tomar la fila (error de la base), cuenta un error y no la reconstruye", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cliente } = clienteFalso([fila(1), fila(2)], { errorAlTomar: (id) => (id === "id-1" ? "sin conexión" : undefined) });
    const reconstructor = vi.fn(async () => RECONSTRUCCION_INVITACION);

    const resumen = await reintentarCorreosFallidos({
      cliente,
      reconstructores: reconstructoresCon({ invitacion_monitor: reconstructor }),
      enviar: enviarFalso(OK).enviar,
      ahora: AHORA,
    });

    expect(resumen).toEqual({ revisados: 2, enviados: 1, siguenFallando: 0, descartados: 0, conError: 1, tomadosPorOtro: 0 });
    expect(reconstructor).toHaveBeenCalledExactlyOnceWith(CLAVE_UUID(2));
  });

  it("dos corridas a la vez sobre las mismas filas: cada fila se reconstruye y se envía una sola vez", async () => {
    const { cliente } = clienteFalso([fila(1), fila(2)]);
    const reconstructor = vi.fn(async () => RECONSTRUCCION_INVITACION);
    const { enviar, llamadas } = enviarFalso(OK);
    const dependencias = { cliente, reconstructores: reconstructoresCon({ invitacion_monitor: reconstructor }), enviar, ahora: AHORA };

    const [a, b] = await Promise.all([reintentarCorreosFallidos(dependencias), reintentarCorreosFallidos(dependencias)]);

    expect(reconstructor).toHaveBeenCalledTimes(2); // una vez por fila, no una por corrida
    expect(llamadas).toHaveBeenCalledTimes(2);
    expect(a.enviados + b.enviados).toBe(2);
    expect(a.tomadosPorOtro + b.tomadosPorOtro).toBe(2);
    expect(a.revisados).toBe(2);
    expect(b.revisados).toBe(2);
  });
});

describe("reintentarCorreosFallidos: un fallo en un correo no detiene a los demás", () => {
  it("si el reconstructor lanza, cuenta un error, lo anota en la consola y sigue con el resto", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cliente, descartes } = clienteFalso([fila(1), fila(2), fila(3)]);
    const reconstructor = vi.fn(async (entidad: string) => {
      if (entidad === CLAVE_UUID(2)) throw new Error("la base no responde");
      return RECONSTRUCCION_INVITACION;
    });
    const { enviar, llamadas } = enviarFalso(OK);

    const resumen = await reintentarCorreosFallidos({
      cliente,
      reconstructores: reconstructoresCon({ invitacion_monitor: reconstructor }),
      enviar,
      ahora: AHORA,
    });

    expect(resumen).toEqual({ revisados: 3, enviados: 2, siguenFallando: 0, descartados: 0, conError: 1, tomadosPorOtro: 0 });
    expect(llamadas).toHaveBeenCalledTimes(2);
    // Un error no descarta: la fila sigue fallida y reintentable para la próxima corrida.
    expect(descartes).toEqual([]);
    expect(consola).toHaveBeenCalledOnce();
    expect(String(consola.mock.calls[0][0])).toContain("id-2");
    expect(String(consola.mock.calls[0][0])).toContain("la base no responde");
  });

  it("si enviar lanza, también cuenta un error y sigue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cliente } = clienteFalso([fila(1), fila(2)]);
    const { enviar } = enviarFalso(new RangeError("datos inválidos"), OK);

    const resumen = await reintentarCorreosFallidos({
      cliente,
      reconstructores: reconstructoresCon({ invitacion_monitor: async () => RECONSTRUCCION_INVITACION }),
      enviar,
      ahora: AHORA,
    });

    expect(resumen).toEqual({ revisados: 2, enviados: 1, siguenFallando: 0, descartados: 0, conError: 1, tomadosPorOtro: 0 });
  });

  it("lo que lanza algo que no es un Error también se cuenta, y su mensaje se anota en una línea y recortado", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cliente } = clienteFalso([fila(1)]);
    const reconstructor = async () => {
      throw `fallo\ncon varias líneas ${"y".repeat(1_000)}`;
    };

    const resumen = await reintentarCorreosFallidos({
      cliente,
      reconstructores: reconstructoresCon({ invitacion_monitor: reconstructor }),
      enviar: enviarFalso().enviar,
      ahora: AHORA,
    });

    expect(resumen.conError).toBe(1);
    const mensaje = String(consola.mock.calls[0][0]);
    expect(mensaje).not.toMatch(/[\r\n]/);
    expect(mensaje.length).toBeLessThan(400);
  });
});
