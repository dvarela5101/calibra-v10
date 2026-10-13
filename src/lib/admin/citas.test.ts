import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/tipos";
import { MAX_CITAS_SIN_PLAZO, autorizarCancelacion, cargarCitaParaAutorizar, cargarCitasSinPlazo } from "./citas";
import { RESULTADOS_DE_AUTORIZACION } from "./citas-reglas";

// HU-052 sin base: la lista, la cita y la autorización con un cliente falso. Aquí se fija qué pide cada lectura (nunca el
// contacto del monitor, el desembolso ni cifras de comisión), cómo arma la lista en el orden de la vista y la cita con sus
// pagos y su autorización, que un dato nulo o una fecha ilegible lanzan en vez de llegar a la página, y qué manda y qué
// guarda la autorización (la nota no va al error). Lo que responde la base de verdad lo cubre
// integracion/cancelar-fuera-de-plazo.test.ts.

const M1 = "11111111-0000-4000-8000-000000000052";
const M2 = "22222222-0000-4000-8000-000000000052";
const M3 = "33333333-0000-4000-8000-000000000052";
const ADMIN = "a0a0a0a0-0000-4000-8000-000000000052";

type Fila = Record<string, unknown>;
type Pedido = {
  tabla: string;
  columnas: string;
  opciones: unknown;
  filtros: ["eq" | "in", string, unknown][];
  /** Cada `order`, con su sentido: la lista pide «la que empieza primero arriba», y eso es `ascending: true`, no solo la columna. */
  orden: { columna: string; ascending: boolean }[];
  limite: number | undefined;
};

/**
 * Un cliente que responde `tablas` aplicando de verdad los filtros `eq` e `in`, y anota qué pidió de cada una: así una
 * lectura que pida los ids equivocados se queda sin datos en vez de pasar por casualidad.
 */
function clienteConLectura(tablas: Record<string, Fila[]>, { errores = {}, conteo }: { errores?: Record<string, string>; conteo?: number } = {}) {
  const pedidos: Pedido[] = [];
  const from = (tabla: string) => {
    const pedido: Pedido = { tabla, columnas: "", opciones: undefined, filtros: [], orden: [], limite: undefined };
    pedidos.push(pedido);
    const filas = () =>
      (tablas[tabla] ?? [])
        .filter((fila) => pedido.filtros.every(([tipo, columna, valor]) => (tipo === "eq" ? fila[columna] === valor : (valor as unknown[]).includes(fila[columna]))))
        .slice(0, pedido.limite);
    const error = errores[tabla] ? { message: errores[tabla] } : null;
    const lista = async () => ({ data: error ? null : filas(), error, count: conteo ?? filas().length });
    const uno = (obligatorio: boolean) => async () => {
      const [primera] = filas();
      if (!error && !primera && obligatorio) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      return { data: error ? null : (primera ?? null), error };
    };
    const consulta = {
      select: (columnas: string, opciones?: unknown) => {
        pedido.columnas = columnas;
        pedido.opciones = opciones;
        return consulta;
      },
      eq: (columna: string, valor: unknown) => {
        pedido.filtros.push(["eq", columna, valor]);
        return consulta;
      },
      in: (columna: string, valores: unknown[]) => {
        pedido.filtros.push(["in", columna, valores]);
        return consulta;
      },
      order: (columna: string, opciones?: { ascending?: boolean }) => {
        // Como supabase-js: sin opciones el orden es ascendente.
        pedido.orden.push({ columna, ascending: opciones?.ascending ?? true });
        return consulta;
      },
      limit: (n: number) => {
        pedido.limite = n;
        return consulta;
      },
      maybeSingle: uno(false),
      single: uno(true),
      then: (resolver: (valor: Awaited<ReturnType<typeof lista>>) => unknown) => lista().then(resolver),
    };
    return consulta;
  };
  return { cliente: { from } as unknown as SupabaseClient<Database>, pedidos };
}

/** Todas las claves de un valor, a cualquier profundidad. */
function clavesDe(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(clavesDe);
  if (valor instanceof Date || valor === null || typeof valor !== "object") return [];
  return Object.entries(valor).flatMap(([clave, hijo]) => [clave, ...clavesDe(hijo)]);
}

// --- La lista ----------------------------------------------------------------------------------------------------

const LISTA: Record<string, Fila[]> = {
  citas_sin_plazo_para_cancelar: [
    { id_monitoria: M1, inicio: "2030-01-07T15:00:00+00:00" },
    { id_monitoria: M2, inicio: "2030-01-07T16:30:00+00:00" },
  ],
  monitoria: [
    // A propósito en otro orden que la vista.
    { id: M2, fecha: "2030-01-07", id_franja: "f2", id_materia: "mat", id_monitor: "mon", id_lead: "l2" },
    { id: M1, fecha: "2030-01-07", id_franja: "f1", id_materia: "mat", id_monitor: "mon", id_lead: "l1" },
  ],
  pago: [
    { id_monitoria: M1, estado: "aprobado" },
    { id_monitoria: M2, estado: "aprobado" },
    { id_monitoria: M2, estado: "en_revision" },
  ],
  franja: [
    { id: "f1", hora: "10:00:00", duracion_min: 60 },
    { id: "f2", hora: "11:30:00", duracion_min: 90 },
  ],
  materia: [{ id: "mat", nombre: "Cálculo Diferencial" }],
  monitor: [{ id: "mon", nombre: "Andrés Gómez" }],
  lead: [
    { id: "l1", nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numero_telefono: "3001234567" },
    { id: "l2", nombre: "Luis Pérez", correo: null, numero_telefono: "3109876543" },
  ],
};

describe("cargarCitasSinPlazo (HU-052)", () => {
  it("arma la lista en el orden de la vista, con la materia, el monitor, quien agendó y el estado del pago", async () => {
    const { cliente } = clienteConLectura(LISTA);
    expect(await cargarCitasSinPlazo(cliente)).toEqual({
      total: 2,
      filas: [
        {
          id: M1,
          inicio: new Date("2030-01-07T15:00:00.000Z"),
          fecha: "2030-01-07",
          hora: "10:00:00",
          duracionMin: 60,
          nombreMateria: "Cálculo Diferencial",
          nombreMonitor: "Andrés Gómez",
          lead: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", telefono: "3001234567" },
          estadoPago: "aprobado",
        },
        {
          id: M2,
          inicio: new Date("2030-01-07T16:30:00.000Z"),
          fecha: "2030-01-07",
          hora: "11:30:00",
          duracionMin: 90,
          nombreMateria: "Cálculo Diferencial",
          nombreMonitor: "Andrés Gómez",
          lead: { nombre: "Luis Pérez", correo: null, telefono: "3109876543" },
          // Aprobado y en revisión: gana el que está en revisión (D-11).
          estadoPago: "en_revision",
        },
      ],
    });
  });

  it("pide la vista ordenada por inicio y por id, con el total exacto y el corte de 100", async () => {
    const { cliente, pedidos } = clienteConLectura(LISTA);
    await cargarCitasSinPlazo(cliente);
    expect(MAX_CITAS_SIN_PLAZO).toBe(100);
    const vista = pedidos[0];
    expect(vista.tabla).toBe("citas_sin_plazo_para_cancelar");
    expect(vista.columnas).toBe("id_monitoria, inicio");
    expect(vista.opciones).toEqual({ count: "exact" });
    // La que empieza primero, arriba (ascendente), y el id como desempate estable.
    expect(vista.orden).toEqual([
      { columna: "inicio", ascending: true },
      { columna: "id_monitoria", ascending: true },
    ]);
    expect(vista.limite).toBe(100);
  });

  it("el corte se puede cambiar, y el total sigue siendo el de la base", async () => {
    const { cliente, pedidos } = clienteConLectura(LISTA, { conteo: 250 });
    const lista = await cargarCitasSinPlazo(cliente, { maxFilas: 2 });
    expect(pedidos[0].limite).toBe(2);
    expect(lista.filas).toHaveLength(2);
    expect(lista.total).toBe(250);
  });

  it("lee las monitorías y los pagos de las citas de la vista, y los nombres de los que salieron de ellas, sin repetidos", async () => {
    const { cliente, pedidos } = clienteConLectura(LISTA);
    await cargarCitasSinPlazo(cliente);
    const de = (tabla: string) => pedidos.find((p) => p.tabla === tabla);
    expect(de("monitoria")?.filtros).toEqual([["in", "id", [M1, M2]]]);
    expect(de("pago")?.filtros).toEqual([["in", "id_monitoria", [M1, M2]]]);
    // Los ids salen de las monitorías, en el orden en que llegaron.
    expect(de("franja")?.filtros).toEqual([["in", "id", ["f2", "f1"]]]);
    // Una sola materia y un solo monitor para las dos citas: no se piden dos veces.
    expect(de("materia")?.filtros).toEqual([["in", "id", ["mat"]]]);
    expect(de("monitor")?.filtros).toEqual([["in", "id", ["mon"]]]);
    expect(de("lead")?.filtros).toEqual([["in", "id", ["l2", "l1"]]]);
  });

  it("del monitor, solo el nombre; nunca su contacto, el desembolso ni cifras de comisión", async () => {
    const { cliente, pedidos } = clienteConLectura(LISTA);
    await cargarCitasSinPlazo(cliente);
    expect(pedidos.map((p) => p.tabla).sort()).toEqual(["citas_sin_plazo_para_cancelar", "franja", "lead", "materia", "monitor", "monitoria", "pago"]);
    expect(pedidos.find((p) => p.tabla === "monitor")?.columnas).toBe("id, nombre");
    expect(pedidos.map((p) => p.columnas).join(" | ")).not.toMatch(/llave|comision|bruto|neto|desembolso|monitor_privado/i);
    expect(pedidos.find((p) => p.tabla === "pago")?.columnas).toBe("id_monitoria, estado");
  });

  it("lo que devuelve no tiene claves de bruto, neto, comisión ni llave, a ninguna profundidad", async () => {
    const { cliente } = clienteConLectura(LISTA);
    const claves = clavesDe(await cargarCitasSinPlazo(cliente));
    expect(claves.length).toBeGreaterThan(10);
    for (const clave of claves) expect(clave).not.toMatch(/bruto|neto|comisi|llave/i);
  });

  it("sin citas no pide nada más que la vista", async () => {
    const { cliente, pedidos } = clienteConLectura({ citas_sin_plazo_para_cancelar: [] });
    expect(await cargarCitasSinPlazo(cliente)).toEqual({ filas: [], total: 0 });
    expect(pedidos).toHaveLength(1);
  });

  it("una cita sin pagos queda sin pagar", async () => {
    const { cliente } = clienteConLectura({ ...LISTA, pago: [] });
    expect((await cargarCitasSinPlazo(cliente)).filas.map((f) => f.estadoPago)).toEqual(["sin_pagar", "sin_pagar"]);
  });

  it("un dato nulo de la vista, o un inicio ilegible, lanza «la cita está incompleta» en vez de pintar una cita a medias", async () => {
    for (const fila of [
      { id_monitoria: null, inicio: "2030-01-07T15:00:00+00:00" },
      { id_monitoria: M1, inicio: null },
      { id_monitoria: M1, inicio: "no es una fecha" },
    ]) {
      const { cliente } = clienteConLectura({ ...LISTA, citas_sin_plazo_para_cancelar: [fila] });
      await expect(cargarCitasSinPlazo(cliente), JSON.stringify(fila)).rejects.toThrow("La cita está incompleta");
    }
  });

  it("si falta la monitoría, la franja, la materia, el monitor o quien agendó, lanza con el id de la cita", async () => {
    for (const tabla of ["monitoria", "franja", "materia", "monitor", "lead"]) {
      const { cliente } = clienteConLectura({ ...LISTA, [tabla]: [] });
      await expect(cargarCitasSinPlazo(cliente), tabla).rejects.toThrow(`La cita ${M1} está incompleta.`);
    }
  });

  it("si una lectura falla, lanza con el mensaje de la base", async () => {
    for (const tabla of ["citas_sin_plazo_para_cancelar", "monitoria", "pago", "franja", "materia", "monitor", "lead"]) {
      const { cliente } = clienteConLectura(LISTA, { errores: { [tabla]: "se cayó la base" } });
      await expect(cargarCitasSinPlazo(cliente), tabla).rejects.toThrow("No se pudieron leer las citas sin plazo para cancelar: se cayó la base");
    }
  });
});

// --- La cita -----------------------------------------------------------------------------------------------------

const CITA: Record<string, Fila[]> = {
  monitoria: [
    {
      id: M3,
      estado: "confirmada",
      motivo_cancelacion: null,
      fecha: "2030-01-07",
      id_franja: "f1",
      id_materia: "mat",
      id_monitor: "mon",
      id_lead: "l1",
    },
  ],
  monitoria_plazos: [{ id_monitoria: M3, inicio: "2030-01-07T15:00:00+00:00", cancelable_hasta: "2030-01-07T03:00:00+00:00", es_grupal: false }],
  franja: [{ id: "f1", hora: "10:00:00", duracion_min: 60 }],
  materia: [{ id: "mat", nombre: "Cálculo Diferencial" }],
  monitor: [{ id: "mon", nombre: "Andrés Gómez" }],
  lead: [{ id: "l1", nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numero_telefono: null }],
  pago: [
    { id: "p1", id_monitoria: M3, nombre_pagador: "Camila Rojas", monto: 32_000, estado: "aprobado", reembolso: null },
    { id: "p2", id_monitoria: M3, nombre_pagador: "Luis Pérez", monto: 15_000, estado: "en_revision", reembolso: null },
  ],
  cancelacion_excepcional: [],
};

const REGISTRO = {
  id_monitoria: M3,
  categoria: "fuerza_mayor",
  nota: "Accidente de tránsito.",
  autorizada_en: "2030-01-07T09:05:00+00:00",
  id_admin: ADMIN,
  admin: { nombre: "Admin Uno" },
};

describe("cargarCitaParaAutorizar (HU-052)", () => {
  it("arma la cita con los datos, los plazos y cada pago; sin autorización registrada", async () => {
    const { cliente } = clienteConLectura(CITA);
    expect(await cargarCitaParaAutorizar(cliente, M3)).toEqual({
      id: M3,
      estado: "confirmada",
      motivoCancelacion: null,
      fecha: "2030-01-07",
      hora: "10:00:00",
      duracionMin: 60,
      nombreMateria: "Cálculo Diferencial",
      nombreMonitor: "Andrés Gómez",
      lead: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", telefono: null },
      inicio: new Date("2030-01-07T15:00:00.000Z"),
      cancelableHasta: new Date("2030-01-07T03:00:00.000Z"),
      grupal: false,
      pagos: [
        { id: "p1", nombrePagador: "Camila Rojas", monto: 32_000, estado: "aprobado", reembolso: null },
        { id: "p2", nombrePagador: "Luis Pérez", monto: 15_000, estado: "en_revision", reembolso: null },
      ],
      autorizacion: null,
    });
  });

  it("una cita ya autorizada trae quién, cuándo, el motivo y la nota; y cada pago su reembolso", async () => {
    const { cliente } = clienteConLectura({
      ...CITA,
      monitoria: [{ ...CITA.monitoria[0], estado: "cancelada", motivo_cancelacion: "estudiante" }],
      pago: [{ ...CITA.pago[0], reembolso: { id: "r1", estado: "esperando_llave" } }],
      cancelacion_excepcional: [REGISTRO],
    });
    expect(await cargarCitaParaAutorizar(cliente, M3)).toMatchObject({
      estado: "cancelada",
      motivoCancelacion: "estudiante",
      pagos: [{ id: "p1", reembolso: { id: "r1", estado: "esperando_llave" } }],
      autorizacion: {
        categoria: "fuerza_mayor",
        nota: "Accidente de tránsito.",
        autorizadaEn: new Date("2030-01-07T09:05:00.000Z"),
        idAdmin: ADMIN,
        nombreAdmin: "Admin Uno",
      },
    });
  });

  it("una autorización sin nota (con «fuerza mayor» o «falla de Calibra») trae la nota nula", async () => {
    const { cliente } = clienteConLectura({ ...CITA, cancelacion_excepcional: [{ ...REGISTRO, categoria: "falla_de_calibra", nota: null }] });
    expect((await cargarCitaParaAutorizar(cliente, M3))?.autorizacion).toMatchObject({ categoria: "falla_de_calibra", nota: null });
  });

  it("una cita grupal se marca grupal", async () => {
    const { cliente } = clienteConLectura({ ...CITA, monitoria_plazos: [{ ...CITA.monitoria_plazos[0], es_grupal: true }] });
    expect(await cargarCitaParaAutorizar(cliente, M3)).toMatchObject({ grupal: true });
  });

  it("una cita sin pagos da la lista vacía", async () => {
    const { cliente } = clienteConLectura({ ...CITA, pago: [] });
    expect((await cargarCitaParaAutorizar(cliente, M3))?.pagos).toEqual([]);
  });

  it("una cita que no existe (o que la sesión no lee) da null y no pide nada más", async () => {
    const { cliente, pedidos } = clienteConLectura({ ...CITA, monitoria: [] });
    expect(await cargarCitaParaAutorizar(cliente, M3)).toBeNull();
    expect(pedidos).toHaveLength(1);
  });

  it("lee todo de la cita pedida y no de otra, en consultas aparte", async () => {
    const { cliente, pedidos } = clienteConLectura(CITA);
    await cargarCitaParaAutorizar(cliente, M3);
    const de = (tabla: string) => pedidos.find((p) => p.tabla === tabla);
    expect(de("monitoria")?.filtros).toEqual([["eq", "id", M3]]);
    expect(de("monitoria_plazos")?.columnas).toBe("inicio, cancelable_hasta, es_grupal");
    expect(de("monitoria_plazos")?.filtros).toEqual([["eq", "id_monitoria", M3]]);
    expect(de("pago")?.filtros).toEqual([["eq", "id_monitoria", M3]]);
    expect(de("cancelacion_excepcional")?.filtros).toEqual([["eq", "id_monitoria", M3]]);
    expect(de("franja")?.filtros).toEqual([["eq", "id", "f1"]]);
    expect(de("lead")?.filtros).toEqual([["eq", "id", "l1"]]);
    expect(de("pago")?.orden).toEqual([
      { columna: "fecha_pago", ascending: true },
      { columna: "id", ascending: true },
    ]);
  });

  it("del monitor, solo el nombre; nunca su contacto, el desembolso, el comprobante ni cifras de comisión", async () => {
    const { cliente, pedidos } = clienteConLectura(CITA);
    await cargarCitaParaAutorizar(cliente, M3);
    expect(pedidos.map((p) => p.tabla).sort()).toEqual([
      "cancelacion_excepcional",
      "franja",
      "lead",
      "materia",
      "monitor",
      "monitoria",
      "monitoria_plazos",
      "pago",
    ]);
    expect(pedidos.find((p) => p.tabla === "monitor")?.columnas).toBe("nombre");
    expect(pedidos.map((p) => p.columnas).join(" | ")).not.toMatch(/llave|comision|bruto|neto|desembolso|monitor_privado|comprobante/i);
    expect(pedidos.find((p) => p.tabla === "pago")?.columnas).toBe("id, nombre_pagador, monto, estado, reembolso(id, estado)");
  });

  it("lo que devuelve no tiene claves de bruto, neto, comisión ni llave, a ninguna profundidad", async () => {
    const { cliente } = clienteConLectura({
      ...CITA,
      pago: [{ ...CITA.pago[0], reembolso: { id: "r1", estado: "pendiente" } }],
      cancelacion_excepcional: [REGISTRO],
    });
    const claves = clavesDe(await cargarCitaParaAutorizar(cliente, M3));
    expect(claves).toContain("reembolso");
    expect(claves).toContain("autorizacion");
    for (const clave of claves) expect(clave).not.toMatch(/bruto|neto|comisi|llave/i);
  });

  it("una cita incompleta lanza en vez de pintarse: sin plazos, sin saber si es grupal, o con un instante ilegible", async () => {
    const incompletas: Record<string, Fila[]>[] = [
      { ...CITA, monitoria_plazos: [] },
      { ...CITA, monitoria_plazos: [{ ...CITA.monitoria_plazos[0], es_grupal: null }] },
      { ...CITA, monitoria_plazos: [{ ...CITA.monitoria_plazos[0], inicio: null }] },
      { ...CITA, monitoria_plazos: [{ ...CITA.monitoria_plazos[0], inicio: "no es una fecha" }] },
      { ...CITA, monitoria_plazos: [{ ...CITA.monitoria_plazos[0], cancelable_hasta: null }] },
      { ...CITA, monitoria_plazos: [{ ...CITA.monitoria_plazos[0], cancelable_hasta: "no es una fecha" }] },
    ];
    for (const tablas of incompletas) {
      const { cliente } = clienteConLectura(tablas);
      await expect(cargarCitaParaAutorizar(cliente, M3)).rejects.toThrow("La cita está incompleta");
    }
  });

  it("sin la franja, la materia, el monitor o quien agendó (la base no devuelve la fila) lanza en vez de pintar la cita", async () => {
    for (const tabla of ["franja", "materia", "monitor", "lead"]) {
      const { cliente } = clienteConLectura({ ...CITA, [tabla]: [] });
      await expect(cargarCitaParaAutorizar(cliente, M3), tabla).rejects.toThrow("No se pudo leer la cita");
    }
  });

  it("una autorización con un motivo desconocido, sin admin o con la hora ilegible lanza", async () => {
    for (const registro of [{ ...REGISTRO, categoria: "inventada" }, { ...REGISTRO, admin: null }, { ...REGISTRO, autorizada_en: "no es una fecha" }]) {
      const { cliente } = clienteConLectura({ ...CITA, cancelacion_excepcional: [registro] });
      await expect(cargarCitaParaAutorizar(cliente, M3), JSON.stringify(registro)).rejects.toThrow("incompleta");
    }
  });

  it("si una lectura falla, lanza con el mensaje de la base", async () => {
    for (const tabla of ["monitoria", "monitoria_plazos", "pago", "cancelacion_excepcional", "lead"]) {
      const { cliente } = clienteConLectura(CITA, { errores: { [tabla]: "se cayó la base" } });
      await expect(cargarCitaParaAutorizar(cliente, M3), tabla).rejects.toThrow("No se pudo leer la cita: se cayó la base");
    }
  });
});

// --- La autorización ---------------------------------------------------------------------------------------------

describe("autorizarCancelacion (HU-052)", () => {
  function clienteConRpc(respuesta: { data: unknown; error: { code?: string; message: string; details?: string } | null }) {
    const rpc = vi.fn(async () => respuesta);
    return { cliente: { rpc } as unknown as SupabaseClient<Database>, rpc };
  }

  it("llama a la función de la puerta con la cita, el motivo y la nota", async () => {
    const { cliente, rpc } = clienteConRpc({ data: "autorizada", error: null });
    expect(await autorizarCancelacion(cliente, { idMonitoria: M3, categoria: "otro", nota: "Un error nuestro." })).toBe("autorizada");
    expect(rpc).toHaveBeenCalledWith("autorizar_cancelacion_fuera_de_plazo", { p_id_monitoria: M3, p_categoria: "otro", p_nota: "Un error nuestro." });
  });

  it("sin nota manda el texto vacío, que la base toma como ninguna (el parámetro no admite nulo)", async () => {
    const { cliente, rpc } = clienteConRpc({ data: "autorizada", error: null });
    await autorizarCancelacion(cliente, { idMonitoria: M3, categoria: "fuerza_mayor", nota: null });
    expect(rpc).toHaveBeenCalledWith("autorizar_cancelacion_fuera_de_plazo", { p_id_monitoria: M3, p_categoria: "fuerza_mayor", p_nota: "" });
  });

  it("devuelve cualquiera de los resultados de la base tal cual", async () => {
    for (const resultado of RESULTADOS_DE_AUTORIZACION) {
      const { cliente } = clienteConRpc({ data: resultado, error: null });
      expect(await autorizarCancelacion(cliente, { idMonitoria: M3, categoria: "fuerza_mayor", nota: null }), resultado).toBe(resultado);
    }
  });

  it("un error de la base lanza con el código y el mensaje, nunca con el detalle ni la nota", async () => {
    const { cliente } = clienteConRpc({
      data: null,
      error: { code: "42501", message: "permission denied for function", details: "nota: Dato sensible de quien agendó" },
    });
    const error = await autorizarCancelacion(cliente, { idMonitoria: M3, categoria: "otro", nota: "Dato sensible de quien agendó" }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("No se pudo autorizar la cancelación: 42501 permission denied for function");
    expect((error as Error).message).not.toContain("Dato sensible");
  });

  it("una respuesta que no es un resultado conocido lanza en vez de darse por buena", async () => {
    for (const data of ["cancelada", "fuera_de_plazo", null, 3, ["autorizada"]]) {
      const { cliente } = clienteConRpc({ data, error: null });
      await expect(autorizarCancelacion(cliente, { idMonitoria: M3, categoria: "fuerza_mayor", nota: null })).rejects.toThrow(
        "Respuesta inesperada al autorizar la cancelación",
      );
    }
  });
});
