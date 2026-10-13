import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { entenderResultadoDeBorrar, type DatosDeEvaluacion, type DatosDeMateria, type ErrorDeLaBase } from "./reglas";

type Cliente = SupabaseClient<Database>;

/**
 * Las lecturas y escrituras de materias y evaluaciones del admin (HU-055), todas con el cliente de la sesión: nunca con
 * la llave secreta. Las políticas y los permisos por columna de la base dejan escribir solo a un admin activo, solo
 * `nombre` y `codigo` de una materia y `nombre` y `semana` de una evaluación, y el borrado va por las funciones
 * `borrar_materia` y `borrar_evaluacion`, que vuelven a comprobar lo ligado con la fila bloqueada.
 *
 * Una lectura que falla lanza. Una escritura que la base rechaza no lanza: devuelve `{ tipo: "error" }` con el código y la
 * pista para que quien llama decida el mensaje (`mensajeDeError`, en reglas.ts).
 */

export type MateriaDeLaLista = { id: string; nombre: string; codigo: string; evaluaciones: number; activas: number };

/** Las materias por nombre, cada una con cuántas evaluaciones tiene y cuántas están activas. */
export async function listarMaterias(cliente: Cliente): Promise<MateriaDeLaLista[]> {
  const { data, error } = await cliente
    .from("materia")
    .select("id, nombre, codigo, evaluacion(id, activa)")
    .order("nombre", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`No se pudieron leer las materias: ${error.message}`);
  return (data ?? []).map((m) => ({
    id: m.id,
    nombre: m.nombre,
    codigo: m.codigo,
    evaluaciones: m.evaluacion.length,
    activas: m.evaluacion.filter((e) => e.activa).length,
  }));
}

export type FilaDeMateria = { id: string; nombre: string; codigo: string };
export type EvaluacionDeLaMateria = { id: string; nombre: string; semana: number; acumulativo: boolean; activa: boolean };
export type MateriaConEvaluaciones = FilaDeMateria & { evaluaciones: EvaluacionDeLaMateria[] };

/** Una materia con sus evaluaciones por semana (y por nombre); `null` si no existe. */
export async function cargarMateria(cliente: Cliente, id: string): Promise<MateriaConEvaluaciones | null> {
  const [materia, evaluaciones] = await Promise.all([
    cliente.from("materia").select("id, nombre, codigo").eq("id", id).maybeSingle(),
    cliente
      .from("evaluacion")
      .select("id, nombre, semana, acumulativo, activa")
      .eq("id_materia", id)
      .order("semana", { ascending: true })
      .order("nombre", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (materia.error) throw new Error(`No se pudo leer la materia: ${materia.error.message}`);
  if (evaluaciones.error) throw new Error(`No se pudieron leer las evaluaciones: ${evaluaciones.error.message}`);
  if (!materia.data) return null;
  return { ...materia.data, evaluaciones: evaluaciones.data ?? [] };
}

/** La materia como está guardada, sin sus evaluaciones; `null` si no existe. */
export async function materiaGuardada(cliente: Cliente, id: string): Promise<FilaDeMateria | null> {
  const { data, error } = await cliente.from("materia").select("id, nombre, codigo").eq("id", id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la materia: ${error.message}`);
  return data;
}

export type EvaluacionGuardada = { id: string; nombre: string; semana: number; idMateria: string };

/** La evaluación como está guardada, con su materia; `null` si no existe. */
export async function evaluacionGuardada(cliente: Cliente, id: string): Promise<EvaluacionGuardada | null> {
  const { data, error } = await cliente.from("evaluacion").select("id, nombre, semana, id_materia").eq("id", id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la evaluación: ${error.message}`);
  return data ? { id: data.id, nombre: data.nombre, semana: data.semana, idMateria: data.id_materia } : null;
}

/** El id y el nombre de todas las evaluaciones de una materia, para comprobar que el nombre no se repita. */
export async function nombresDeLasEvaluaciones(cliente: Cliente, idMateria: string): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await cliente.from("evaluacion").select("id, nombre").eq("id_materia", idMateria);
  if (error) throw new Error(`No se pudieron leer las evaluaciones: ${error.message}`);
  return data ?? [];
}

/** Lo que tiene ligado una materia (`evaluaciones`, `temas`, `certificados`, `solicitudes`, `diagnosticos`, `monitorias`). Vacío si no hay nada, o si quien llama no es un admin activo. */
export async function ligadoDeMateria(cliente: Cliente, id: string): Promise<string[]> {
  const { data, error } = await cliente.rpc("ligado_de_materia", { p_id: id });
  if (error) throw new Error(`No se pudo leer lo ligado a la materia: ${error.message}`);
  return data ?? [];
}

/** Lo que tiene ligado una evaluación (`temas`, `diagnosticos`). Vacío si no hay nada, o si quien llama no es un admin activo. */
export async function ligadoDeEvaluacion(cliente: Cliente, id: string): Promise<string[]> {
  const { data, error } = await cliente.rpc("ligado_de_evaluacion", { p_id: id });
  if (error) throw new Error(`No se pudo leer lo ligado a la evaluación: ${error.message}`);
  return data ?? [];
}

export type ResultadoDeEscribir<T> =
  | { tipo: "guardada"; fila: T }
  | { tipo: "no_existe" }
  | { tipo: "error"; error: ErrorDeLaBase };

const errorDeLaBase = (error: { code: string; hint?: string | null }): ErrorDeLaBase => ({ code: error.code, hint: error.hint ?? null });

/** Crea una materia. Los datos ya vienen normalizados; el trigger de la base los normaliza otra vez y marca la fila como editada en la app. */
export async function crearMateria(cliente: Cliente, datos: DatosDeMateria): Promise<Exclude<ResultadoDeEscribir<FilaDeMateria>, { tipo: "no_existe" }>> {
  const { data, error } = await cliente.from("materia").insert({ nombre: datos.nombre, codigo: datos.codigo }).select("id, nombre, codigo").single();
  if (error) return { tipo: "error", error: errorDeLaBase(error) };
  return { tipo: "guardada", fila: data };
}

/** Cambia el nombre y el código de una materia. `no_existe` si no hay fila (cero filas tocadas). */
export async function guardarMateria(cliente: Cliente, id: string, datos: DatosDeMateria): Promise<ResultadoDeEscribir<FilaDeMateria>> {
  const { data, error } = await cliente.from("materia").update({ nombre: datos.nombre, codigo: datos.codigo }).eq("id", id).select("id, nombre, codigo");
  if (error) return { tipo: "error", error: errorDeLaBase(error) };
  return data.length === 0 ? { tipo: "no_existe" } : { tipo: "guardada", fila: data[0] };
}

/** Cambia el nombre y la semana de una evaluación. `no_existe` si no hay fila (cero filas tocadas). */
export async function guardarEvaluacion(
  cliente: Cliente,
  id: string,
  datos: DatosDeEvaluacion,
): Promise<ResultadoDeEscribir<{ id: string; nombre: string; semana: number }>> {
  const { data, error } = await cliente.from("evaluacion").update({ nombre: datos.nombre, semana: datos.semana }).eq("id", id).select("id, nombre, semana");
  if (error) return { tipo: "error", error: errorDeLaBase(error) };
  return data.length === 0 ? { tipo: "no_existe" } : { tipo: "guardada", fila: data[0] };
}

/** `ilike` toma `%`, `_` y `\` como comodines o escape: se escapan para comparar el texto tal cual. */
const sinComodines = (texto: string) => texto.replace(/[\\%_]/g, "\\$&");

/**
 * El nombre de la materia que ya tiene este código (sin distinguir mayúsculas), para decírselo al admin cuando la base
 * rechaza uno repetido. PostgREST no puede comparar `lower(btrim(codigo))`, así que un código guardado con espacios en
 * una fila histórica no se encuentra y quien llama dice el mensaje sin nombre. `idPropio` excluye a la materia que se está editando.
 */
export async function quienTieneElCodigo(cliente: Cliente, codigoNormalizado: string, idPropio?: string): Promise<string | null> {
  const { data, error } = await cliente
    .from("materia")
    .select("id, nombre")
    .ilike("codigo", sinComodines(codigoNormalizado))
    .order("nombre", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`No se pudo buscar quién tiene el código: ${error.message}`);
  return (data ?? []).find((m) => m.id !== idPropio)?.nombre ?? null;
}

export type ResultadoDeBorrarMateria =
  | { tipo: "borrada"; nombre: string }
  | { tipo: "no_existe" }
  | { tipo: "no_autorizado" }
  | { tipo: "ligada"; ligado: string[] };

export type ResultadoDeBorrarEvaluacion =
  | { tipo: "borrada"; nombre: string; idMateria: string }
  | { tipo: "no_existe" }
  | { tipo: "no_autorizado" }
  | { tipo: "ligada"; ligado: string[] };

/**
 * Borra una materia que no tiene nada ligado. La base lo comprueba otra vez con la fila bloqueada (`ligada:…` si alguien
 * ligó algo mientras tanto). Antes se lee el nombre, que `borrar_materia` no devuelve, para el aviso de después.
 */
export async function borrarMateria(cliente: Cliente, id: string): Promise<ResultadoDeBorrarMateria> {
  const materia = await materiaGuardada(cliente, id);
  if (!materia) return { tipo: "no_existe" };
  const { data, error } = await cliente.rpc("borrar_materia", { p_id: id });
  if (error?.code === "42501") return { tipo: "no_autorizado" };
  if (error) throw new Error(`No se pudo borrar la materia: ${error.message}`);
  const resultado = entenderResultadoDeBorrar(data);
  return resultado.tipo === "borrada" ? { tipo: "borrada", nombre: materia.nombre } : resultado;
}

/** Borra una evaluación que no tiene nada ligado; mismas garantías que `borrarMateria`. Devuelve también su materia, para volver a su página. */
export async function borrarEvaluacion(cliente: Cliente, id: string): Promise<ResultadoDeBorrarEvaluacion> {
  const evaluacion = await evaluacionGuardada(cliente, id);
  if (!evaluacion) return { tipo: "no_existe" };
  const { data, error } = await cliente.rpc("borrar_evaluacion", { p_id: id });
  if (error?.code === "42501") return { tipo: "no_autorizado" };
  if (error) throw new Error(`No se pudo borrar la evaluación: ${error.message}`);
  const resultado = entenderResultadoDeBorrar(data);
  return resultado.tipo === "borrada" ? { tipo: "borrada", nombre: evaluacion.nombre, idMateria: evaluacion.idMateria } : resultado;
}
