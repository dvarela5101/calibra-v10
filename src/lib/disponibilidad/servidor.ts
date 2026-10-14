import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import type { DatosDelPerfil } from "@/lib/monitores/perfil";
import type { FechaLibre } from "./reglas";

/**
 * Lecturas de la lista de monitores (HU-016). Reciben el cliente de quien consulta: la primera página de
 * un visitante corre sin sesión (rol anon) y las siguientes con su sesión anónima, y ambos leen lo mismo.
 * Nada de la llave secreta: todo lo que sale es público.
 */

type Cliente = SupabaseClient<Database>;

export type MateriaDeLaLista = { nombre: string; codigo: string; conCertificados: boolean };

/** Las materias, por nombre, y si alguien está certificado en ella (RN-22). */
export async function cargarMaterias(cliente: Cliente): Promise<MateriaDeLaLista[]> {
  const { data, error } = await cliente
    .from("materia")
    .select("nombre, codigo, certificado(id_monitor)")
    .order("nombre", { ascending: true })
    .order("codigo", { ascending: true });
  if (error) throw new Error(`No se pudieron leer las materias: ${error.message}`);
  return (data ?? []).map((m) => ({ nombre: m.nombre, codigo: m.codigo, conCertificados: m.certificado.length > 0 }));
}

/** Tope de filas de la Data API (`max_rows`): si se alcanza, la lista pudo quedar recortada. */
const MAXIMO_DE_FILAS = 1000;

/** Las fechas libres de los monitores certificados en la materia, de las próximas `semanas` semanas. */
export async function cargarFechasLibres(cliente: Cliente, codigoMateria: string, semanas: number): Promise<FechaLibre[]> {
  const { data, error } = await cliente.rpc("fechas_libres_de_materia", { p_codigo_materia: codigoMateria, p_semanas: semanas });
  if (error) throw new Error(`No se pudieron leer las fechas libres: ${error.message}`);
  const filas = data ?? [];
  if (filas.length >= MAXIMO_DE_FILAS) {
    console.error(`[monitores] ${codigoMateria} llegó al tope de ${MAXIMO_DE_FILAS} fechas: la lista puede estar recortada.`);
  }
  return filas.map((f) => ({
    idMonitor: f.id_monitor,
    nombreMonitor: f.nombre_monitor,
    idFranja: f.id_franja,
    fecha: f.fecha,
    hora: f.hora,
    duracionMin: f.duracion_min,
    presencial: f.presencial,
    precio: f.precio,
  }));
}

/**
 * HU-049: los perfiles de los monitores que ya trajo la lista, en una segunda consulta. La política de
 * `perfil_monitor` solo deja ver los de monitores certificados con la cuenta activa. HU-092 le sumará los temas.
 * Si la lectura falla, la lista sale sin perfiles y el error queda en el log (solo el código, nunca el texto).
 */
export async function cargarPerfiles(cliente: Cliente, ids: string[]): Promise<Map<string, DatosDelPerfil>> {
  const perfiles = new Map<string, DatosDelPerfil>();
  if (ids.length === 0) return perfiles;
  const { data, error } = await cliente.from("perfil_monitor").select("id_monitor, carrera, semestre, presentacion").in("id_monitor", ids);
  if (error) {
    console.error("[monitores] no se pudieron leer los perfiles:", error.code ?? "sin código");
    return perfiles;
  }
  for (const { id_monitor, ...perfil } of data ?? []) perfiles.set(id_monitor, perfil);
  return perfiles;
}
