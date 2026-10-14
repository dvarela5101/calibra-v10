import "server-only";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { ordenarMaterias, type MateriaConEvaluaciones } from "./pantalla";

/**
 * Lo que ofrece el selector del diagnóstico (HU-009, D-53 a, D-13 del banco): las materias con al menos una Evaluación activa,
 * cada una con sus Evaluaciones y los nombres de sus temas. Una materia sin Evaluaciones activas no aparece. Si algo falla,
 * lanza con un mensaje sin contenido y la página muestra el error de carga.
 */

/** El resultado de una consulta, o un error que dice cuál falló y con qué código (nunca `message`, `details` ni `hint`). */
function exigir<T>(consulta: string, respuesta: { data: T | null; error: { code?: string } | null }): T {
  if (respuesta.error || respuesta.data === null) {
    throw new Error(`Falló «${consulta}» al cargar el selector del diagnóstico (código ${respuesta.error?.code || "sin código"}).`);
  }
  return respuesta.data;
}

export async function cargarEvaluacionesActivas(): Promise<MateriaConEvaluaciones[]> {
  // `materia` y `evaluacion` tienen lectura pública: sirve sin sesión, y la primera visita aún no la tiene.
  const supabase = await crearClienteServidor();
  if (!supabase) throw new Error("Faltan las variables de Supabase.");

  const materias = exigir(
    "las materias con Evaluación activa",
    await supabase.from("materia").select("codigo, nombre, evaluacion!inner(id, nombre, semana)").eq("evaluacion.activa", true),
  );

  const idsDeEvaluaciones = materias.flatMap((materia) => materia.evaluacion.map((evaluacion) => evaluacion.id));
  const temas = await cargarNombresDeTemas(idsDeEvaluaciones);

  // El orden no lo pone la base: la colación de Postgres puede mandar «Álgebra» después de «Z».
  return ordenarMaterias(
    materias.map((materia) => ({
      codigo: materia.codigo,
      nombre: materia.nombre,
      evaluaciones: materia.evaluacion.map((evaluacion) => ({
        id: evaluacion.id,
        nombre: evaluacion.nombre,
        semana: evaluacion.semana,
        temas: temas.get(evaluacion.id) ?? [],
      })),
    })),
  );
}

/**
 * Los nombres de los temas de cada Evaluación, por su `orden`. `tema` y `evaluacion_tema` son solo de `service_role`, así que
 * se leen con la llave secreta y solo nombres: nunca preguntas. Son dos consultas simples y no un embed por la llave
 * compuesta (`id_tema`, `id_materia`).
 */
async function cargarNombresDeTemas(idsDeEvaluaciones: string[]): Promise<Map<string, string[]>> {
  if (idsDeEvaluaciones.length === 0) return new Map();

  const admin = crearClienteAdmin();
  const enlaces = exigir(
    "los temas de las Evaluaciones",
    await admin.from("evaluacion_tema").select("id_evaluacion, id_tema").in("id_evaluacion", idsDeEvaluaciones),
  );
  const idsDeTemas = [...new Set(enlaces.map((enlace) => enlace.id_tema))];
  if (idsDeTemas.length === 0) return new Map();

  const temas = exigir("los nombres de los temas", await admin.from("tema").select("id, nombre, orden").in("id", idsDeTemas));
  const porId = new Map(temas.map((tema) => [tema.id, tema]));

  const porEvaluacion = new Map<string, typeof temas>();
  for (const enlace of enlaces) {
    const tema = porId.get(enlace.id_tema);
    if (!tema) continue;
    porEvaluacion.set(enlace.id_evaluacion, [...(porEvaluacion.get(enlace.id_evaluacion) ?? []), tema]);
  }
  // Por `orden`; el nombre y el id desempatan para que el resultado no dependa del orden en que responda la base.
  return new Map(
    [...porEvaluacion].map(([idEvaluacion, lista]) => [
      idEvaluacion,
      lista.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id)).map((tema) => tema.nombre),
    ]),
  );
}
