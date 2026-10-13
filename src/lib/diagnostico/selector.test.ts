import { beforeEach, describe, expect, it, vi } from "vitest";

// HU-009: lo que ofrece el selector, con dos clientes falsos: el de la sesión (materias y Evaluaciones activas, lectura pública)
// y el de la llave secreta (solo los nombres de los temas). Que el embed y los filtros funcionen contra PostgREST lo comprueba
// la e2e.

type Respuesta = { data: unknown; error: { code?: string; message?: string; details?: string } | null };
type Llamada = { tabla: string; pasos: [string, unknown[]][] };

const falsos = vi.hoisted(() => ({
  sesion: null as null | { from: (tabla: string) => unknown },
  llamadasDeSesion: [] as unknown[],
  llamadasDeAdmin: [] as unknown[],
  respuestas: {} as Record<string, Respuesta>,
  crearAdmin: vi.fn(),
}));

/** Una consulta de supabase-js que se puede encadenar y esperar. Anota cada paso. */
function consulta(destino: unknown[], tabla: string) {
  const llamada: Llamada = { tabla, pasos: [] };
  destino.push(llamada);
  const constructor: Record<string, unknown> = {};
  for (const paso of ["select", "eq", "in"]) {
    constructor[paso] = (...argumentos: unknown[]) => {
      llamada.pasos.push([paso, argumentos]);
      return constructor;
    };
  }
  constructor.then = (alResolver: (r: Respuesta) => unknown, alRechazar: (e: unknown) => unknown) =>
    Promise.resolve(falsos.respuestas[tabla] ?? { data: [], error: null }).then(alResolver, alRechazar);
  return constructor;
}

vi.mock("@/lib/supabase/servidor", () => ({
  crearClienteServidor: async () => falsos.sesion,
}));
vi.mock("@/lib/supabase/admin", () => ({
  crearClienteAdmin: () => {
    falsos.crearAdmin();
    return { from: (tabla: string) => consulta(falsos.llamadasDeAdmin, tabla) };
  },
}));

import { cargarEvaluacionesActivas } from "./selector";

const FISICA = { codigo: "FISI-1018", nombre: "Física II", evaluacion: [{ id: "e2", nombre: "Parcial 2", semana: 8 }, { id: "e1", nombre: "Parcial 1", semana: 4 }] };
const ALGEBRA = { codigo: "ALGE-1001", nombre: "Álgebra Lineal", evaluacion: [{ id: "e3", nombre: "Parcial 1", semana: 4 }] };

beforeEach(() => {
  falsos.llamadasDeSesion = [];
  falsos.llamadasDeAdmin = [];
  falsos.crearAdmin.mockClear();
  falsos.sesion = { from: (tabla: string) => consulta(falsos.llamadasDeSesion, tabla) };
  falsos.respuestas = {
    materia: { data: [FISICA, ALGEBRA], error: null },
    evaluacion_tema: {
      data: [
        { id_evaluacion: "e1", id_tema: "t2" },
        { id_evaluacion: "e1", id_tema: "t1" },
        { id_evaluacion: "e2", id_tema: "t3" },
        { id_evaluacion: "e3", id_tema: "t1" },
      ],
      error: null,
    },
    tema: {
      data: [
        { id: "t1", nombre: "Cinemática", orden: 1 },
        { id: "t2", nombre: "Dinámica", orden: 2 },
        { id: "t3", nombre: "Energía", orden: 3 },
      ],
      error: null,
    },
  };
});

describe("cargarEvaluacionesActivas", () => {
  it("lee solo las Evaluaciones activas (M36): el filtro va en la consulta, con el embed interno", async () => {
    await cargarEvaluacionesActivas();
    const [materia] = falsos.llamadasDeSesion as Llamada[];
    expect(materia.tabla).toBe("materia");
    expect(materia.pasos).toContainEqual(["eq", ["evaluacion.activa", true]]);
    const seleccion = materia.pasos.find(([paso]) => paso === "select")?.[1][0];
    expect(seleccion).toMatch(/evaluacion!inner\(/);
  });

  it("devuelve las materias por nombre en español, con sus Evaluaciones por semana", async () => {
    const materias = await cargarEvaluacionesActivas();
    expect(materias.map((m) => m.nombre)).toEqual(["Álgebra Lineal", "Física II"]);
    expect(materias[1].evaluaciones.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(materias[1].evaluaciones[0]).toEqual({ id: "e1", nombre: "Parcial 1", semana: 4, temas: ["Cinemática", "Dinámica"] });
  });

  it("cada Evaluación lleva los nombres de sus temas por orden", async () => {
    const materias = await cargarEvaluacionesActivas();
    const porId = Object.fromEntries(materias.flatMap((m) => m.evaluaciones).map((e) => [e.id, e.temas]));
    expect(porId).toEqual({ e1: ["Cinemática", "Dinámica"], e2: ["Energía"], e3: ["Cinemática"] });
  });

  it("los temas se leen con la llave secreta y solo sus nombres: nada de preguntas", async () => {
    await cargarEvaluacionesActivas();
    const llamadas = falsos.llamadasDeAdmin as Llamada[];
    expect(llamadas.map((l) => l.tabla)).toEqual(["evaluacion_tema", "tema"]);
    expect(llamadas[0].pasos).toContainEqual(["in", ["id_evaluacion", ["e2", "e1", "e3"]]]);
    expect(llamadas[1].pasos).toContainEqual(["in", ["id", ["t2", "t1", "t3"]]]);
    expect(llamadas[1].pasos.find(([paso]) => paso === "select")?.[1]).toEqual(["id, nombre, orden"]);
  });

  it("una Evaluación sin temas queda con la lista vacía", async () => {
    falsos.respuestas.evaluacion_tema = { data: [{ id_evaluacion: "e1", id_tema: "t1" }], error: null };
    const materias = await cargarEvaluacionesActivas();
    const porId = Object.fromEntries(materias.flatMap((m) => m.evaluaciones).map((e) => [e.id, e.temas]));
    expect(porId).toEqual({ e1: ["Cinemática"], e2: [], e3: [] });
  });

  it("sin materias con Evaluación activa devuelve una lista vacía y ni siquiera abre el cliente de la llave secreta", async () => {
    falsos.respuestas.materia = { data: [], error: null };
    expect(await cargarEvaluacionesActivas()).toEqual([]);
    expect(falsos.crearAdmin).not.toHaveBeenCalled();
  });

  it("si falla la lectura de materias lanza con solo el código", async () => {
    falsos.respuestas.materia = { data: null, error: { code: "PGRST301", message: "MENSAJE-SECRETO", details: "DETALLE-SECRETO" } };
    const error = await cargarEvaluacionesActivas().then(
      () => null,
      (fallo: unknown) => fallo as Error,
    );
    expect(error?.message).toContain("PGRST301");
    expect(error?.message).not.toContain("SECRETO");
  });

  it("si falla la lectura de los temas lanza: la página muestra el error de carga", async () => {
    falsos.respuestas.tema = { data: null, error: { code: "42501", details: "DETALLE-SECRETO" } };
    const error = await cargarEvaluacionesActivas().then(
      () => null,
      (fallo: unknown) => fallo as Error,
    );
    expect(error?.message).toContain("42501");
    expect(error?.message).not.toContain("SECRETO");
  });

  it("sin variables de Supabase lanza", async () => {
    falsos.sesion = null;
    await expect(cargarEvaluacionesActivas()).rejects.toThrow("Faltan las variables de Supabase.");
  });
});
