import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/tipos";
import { cargarMisDesembolsos } from "./servidor";

// HU-050 sin base ni red: un cliente falso que solo sabe las dos lecturas de la carga. El cableado con la base real
// (permisos, filtro por monitor, las siete situaciones) lo prueban pgTAP y la integración.

const YO = "a0a0a0a0-0000-4000-8000-000000000050";
const id = (n: number) => `d0d0d0d0-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Fila = Record<string, unknown>;
type ErrorDeLaBase = { code?: string; message: string };

/** Valores únicos que no deben salir en ningún mensaje de error. */
const LLAVE = "llave-secreta-50";
const REFERENCIA = "REF-SECRETA-50";

function fila(cambios: Fila = {}): Fila {
  return {
    id_desembolso: id(1),
    fecha: "2031-12-01",
    hora: "10:00:00",
    duracion_min: 60,
    nombre_materia: "Cálculo Diferencial",
    situacion: "listo",
    desembolsable_desde: null,
    monto_bruto: 37_000,
    comision: 3_700,
    monto_neto: 33_300,
    llave_destino: LLAVE,
    referencia_transferencia: null,
    fecha_desembolso: null,
    ...cambios,
  };
}

const TRANSFERIDO = {
  situacion: "transferido",
  referencia_transferencia: REFERENCIA,
  fecha_desembolso: "2031-12-30",
  monto_bruto: 18_000,
  comision: 1_800,
  monto_neto: 16_200,
};

const ANULADO = {
  situacion: "anulado",
  monto_bruto: null,
  comision: null,
  monto_neto: null,
  llave_destino: null,
  referencia_transferencia: null,
  fecha_desembolso: null,
};

function cliente(opciones: { filas?: Fila[] | null; errorDeDesembolsos?: ErrorDeLaBase; llave?: { llave: string } | null; errorDeLlave?: ErrorDeLaBase } = {}) {
  const llamadas = { rpc: [] as string[], tablas: [] as string[], columnas: [] as string[], filtros: [] as [string, unknown][] };
  const falso = {
    rpc: vi.fn(async (nombre: string) => {
      llamadas.rpc.push(nombre);
      return opciones.errorDeDesembolsos
        ? { data: null, error: opciones.errorDeDesembolsos }
        : { data: opciones.filas === undefined ? [] : opciones.filas, error: null };
    }),
    from: vi.fn((tabla: string) => {
      llamadas.tablas.push(tabla);
      return {
        select: (columnas: string) => {
          llamadas.columnas.push(columnas);
          return {
            eq: (columna: string, valor: unknown) => {
              llamadas.filtros.push([columna, valor]);
              return {
                maybeSingle: async () =>
                  opciones.errorDeLlave ? { data: null, error: opciones.errorDeLlave } : { data: opciones.llave === undefined ? null : opciones.llave, error: null },
              };
            },
          };
        },
      };
    }),
  };
  return { cliente: falso as unknown as SupabaseClient<Database>, llamadas };
}

/** El mensaje con el que falla la carga; falla la prueba si no falla. */
async function mensajeDeLaFalla(c: SupabaseClient<Database>): Promise<string> {
  try {
    await cargarMisDesembolsos(c, YO);
  } catch (error) {
    return (error as { message: string }).message;
  }
  throw new Error("La carga debía fallar y no falló.");
}

describe("cargarMisDesembolsos (HU-050): la lectura", () => {
  it("llama a la función del monitor y lee su llave de hoy con la misma sesión", async () => {
    const { cliente: c, llamadas } = cliente({ filas: [fila()], llave: { llave: "llave-de-hoy" } });
    const carga = await cargarMisDesembolsos(c, YO);
    expect(llamadas.rpc).toEqual(["mis_desembolsos"]);
    expect(llamadas.tablas).toEqual(["monitor_privado"]);
    expect(llamadas.columnas).toEqual(["llave"]);
    expect(llamadas.filtros).toEqual([["id_monitor", YO]]);
    expect(carga.llaveActual).toBe("llave-de-hoy");
    expect(carga.desembolsos).toHaveLength(1);
  });

  it("convierte una fila por transferir, una en plazo, una transferida y una anulada a lo que usa la pantalla", async () => {
    const { cliente: c } = cliente({
      filas: [
        fila(),
        fila({ id_desembolso: id(2), situacion: "en_plazo", desembolsable_desde: "2031-12-30T16:00:00+00:00" }),
        fila({ id_desembolso: id(3), ...TRANSFERIDO }),
        fila({ id_desembolso: id(4), ...ANULADO }),
      ],
      llave: { llave: LLAVE },
    });
    const { desembolsos } = await cargarMisDesembolsos(c, YO);
    expect(desembolsos[0]).toEqual({
      idDesembolso: id(1),
      fecha: "2031-12-01",
      hora: "10:00:00",
      duracionMin: 60,
      nombreMateria: "Cálculo Diferencial",
      situacion: "listo",
      desembolsableDesde: null,
      montos: { bruto: 37_000, comision: 3_700, neto: 33_300 },
      llaveDestino: LLAVE,
      referencia: null,
      diaDeTransferencia: null,
    });
    expect(desembolsos[1].desembolsableDesde).toEqual(new Date("2031-12-30T16:00:00.000Z"));
    expect(desembolsos[2]).toMatchObject({
      situacion: "transferido",
      montos: { bruto: 18_000, comision: 1_800, neto: 16_200 },
      llaveDestino: LLAVE,
      referencia: REFERENCIA,
      diaDeTransferencia: "2031-12-30",
    });
    expect(desembolsos[3]).toMatchObject({ situacion: "anulado", montos: null, llaveDestino: null, referencia: null, diaDeTransferencia: null });
  });

  it("sin desembolsos devuelve una lista vacía; sin fila de llave, la llave de hoy es nula", async () => {
    const { cliente: vacio } = cliente({ filas: [], llave: null });
    expect(await cargarMisDesembolsos(vacio, YO)).toEqual({ desembolsos: [], llaveActual: null });
    const { cliente: sinDatos } = cliente({ filas: null, llave: null });
    expect((await cargarMisDesembolsos(sinDatos, YO)).desembolsos).toEqual([]);
  });

  it("deja pasar un por transferir con bruto 0 (el único pago sigue en revisión): la pantalla decide qué decir", async () => {
    const { cliente: c } = cliente({ filas: [fila({ monto_bruto: 0, comision: 0, monto_neto: 0 })] });
    expect((await cargarMisDesembolsos(c, YO)).desembolsos[0].montos).toEqual({ bruto: 0, comision: 0, neto: 0 });
  });
});

describe("cargarMisDesembolsos: si una lectura falla, la carga falla", () => {
  it("un error de la función de desembolsos lanza con el código y el mensaje", async () => {
    const { cliente: c } = cliente({ errorDeDesembolsos: { code: "42501", message: "permission denied for function mis_desembolsos" } });
    await expect(cargarMisDesembolsos(c, YO)).rejects.toThrow("No se pudo leer los desembolsos: 42501 permission denied for function mis_desembolsos");
  });

  it("un error al leer la llave también lanza: sin ella no se sabría si cambió y el aviso se perdería en silencio", async () => {
    const { cliente: c } = cliente({ filas: [fila()], errorDeLlave: { code: "XX000", message: "se cayó" } });
    await expect(cargarMisDesembolsos(c, YO)).rejects.toThrow("No se pudo leer la llave del monitor: XX000 se cayó");
  });

  it("el mensaje del error no lleva filas", async () => {
    const { cliente: c } = cliente({ filas: [fila()], errorDeLlave: { message: "se cayó" } });
    expect(await mensajeDeLaFalla(c)).toBe("No se pudo leer la llave del monitor: se cayó");
  });
});

describe("cargarMisDesembolsos: el guardia (es mejor no pintar que pintar una cifra incoherente)", () => {
  const incoherentes: [string, Fila][] = [
    ["una situación que no es de las siete (con_reporte)", { situacion: "con_reporte" }],
    ["una situación nula", { situacion: null }],
    ["un día de la transferencia que no es AAAA-MM-DD", { ...TRANSFERIDO, fecha_desembolso: "2031-12-30T22:00:00-05:00" }],
    ["un día de la transferencia que no existe", { ...TRANSFERIDO, fecha_desembolso: "2031-02-30" }],
    ["un en plazo sin la fecha desde la que se puede transferir", { situacion: "en_plazo", desembolsable_desde: null }],
    ["un desembolsable_desde que no es una fecha", { situacion: "en_plazo", desembolsable_desde: "pronto" }],
    ["un por transferir sin el total", { monto_bruto: null }],
    ["un por transferir sin la comisión", { comision: null }],
    ["un por transferir sin el neto", { monto_neto: null }],
    ["un neto que no es el total menos la comisión", { monto_neto: 33_301 }],
    ["una cifra con centavos", { monto_bruto: 37_000.5, comision: 3_700.5, monto_neto: 33_300 }],
    ["una cifra negativa", { monto_bruto: -1, comision: 0, monto_neto: -1 }],
    ["un transferido sin los montos finales", { ...TRANSFERIDO, monto_bruto: null, comision: null, monto_neto: null }],
    ["un transferido con un neto que no cuadra", { ...TRANSFERIDO, monto_neto: 16_000 }],
    ["un transferido sin llave", { ...TRANSFERIDO, llave_destino: null }],
    ["un transferido con la llave vacía", { ...TRANSFERIDO, llave_destino: "  " }],
    ["un transferido sin referencia", { ...TRANSFERIDO, referencia_transferencia: null }],
    ["un transferido sin día de transferencia", { ...TRANSFERIDO, fecha_desembolso: null }],
    ["un anulado con el total", { ...ANULADO, monto_bruto: 37_000 }],
    ["un anulado con la comisión", { ...ANULADO, comision: 3_700 }],
    ["un anulado con el neto", { ...ANULADO, monto_neto: 33_300 }],
    ["un anulado con llave", { ...ANULADO, llave_destino: LLAVE }],
    ["un anulado con referencia", { ...ANULADO, referencia_transferencia: REFERENCIA }],
    ["un anulado con día de transferencia", { ...ANULADO, fecha_desembolso: "2031-12-30" }],
    ["un día de la sesión que no existe", { fecha: "2031-13-01" }],
    ["una hora de la sesión que no es una hora", { hora: "25:00:00" }],
    ["una duración de la sesión que no es positiva", { duracion_min: 0 }],
    ["una fila sin materia", { nombre_materia: null }],
    ["una fila sin id", { id_desembolso: null }],
  ];

  it.each(incoherentes)("lanza con %s", async (_nombre, cambios) => {
    const { cliente: c } = cliente({ filas: [fila(), fila({ id_desembolso: id(2), ...cambios })] });
    await expect(cargarMisDesembolsos(c, YO)).rejects.toThrow();
  });

  it("el mensaje dice cuál desembolso y por qué, sin montos, llaves ni referencias", async () => {
    const { cliente: c } = cliente({ filas: [fila({ id_desembolso: id(7), ...TRANSFERIDO, monto_neto: 16_000 })] });
    const mensaje = await mensajeDeLaFalla(c);
    expect(mensaje).toBe(`Desembolso ${id(7)} incoherente: el neto no es el total menos la comisión`);
    for (const secreto of [LLAVE, REFERENCIA, "18000", "16000", "1800"]) expect(mensaje).not.toContain(secreto);
  });

  it("una situación desconocida nombra solo la situación", async () => {
    const { cliente: c } = cliente({ filas: [fila({ situacion: "con_reporte", llave_destino: LLAVE })] });
    const mensaje = await mensajeDeLaFalla(c);
    expect(mensaje).toBe('Situación de desembolso inesperada: "con_reporte"');
    expect(mensaje).not.toContain(LLAVE);
  });

  it("acepta las horas con y sin segundos", async () => {
    const { cliente: c } = cliente({ filas: [fila({ hora: "10:00" }), fila({ id_desembolso: id(2), hora: "10:00:00" })] });
    expect((await cargarMisDesembolsos(c, YO)).desembolsos).toHaveLength(2);
  });
});
