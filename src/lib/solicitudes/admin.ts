import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { paginaDeInicio, SOLICITUDES_POR_PAGINA, type EstadoDeSolicitud, type EstadoQueMarcaElAdmin } from "./reglas";

type Cliente = SupabaseClient<Database>;

/** Una solicitud como la ve el admin en su lista (HU-062). */
export type SolicitudParaAdmin = {
  id: string;
  nombre: string;
  correo: string;
  numeroTelefono: string;
  estado: EstadoDeSolicitud;
  creadaEn: Date;
  actualizadaEn: Date;
  /** Nombres de las materias, en orden alfabético. */
  materias: string[];
};

export type PaginaDeSolicitudes = {
  solicitudes: SolicitudParaAdmin[];
  /** Cuántas hay en todas las páginas. */
  total: number;
  /** Cuántas siguen abiertas (nueva o contactada), en todas las páginas. */
  abiertas: number;
  pagina: number;
  porPagina: number;
};

/**
 * Una página de solicitudes, de la más antigua a la más nueva. El orden no depende del estado: al marcar una,
 * ninguna cambia de lugar ni de página. Se leen con la sesión del admin: la política "admin lee" deja ver
 * todas a un admin activo y ninguna a los demás, que reciben una lista vacía. Va por páginas porque la API
 * corta cada respuesta en 1000 filas.
 */
export async function listarSolicitudes(
  cliente: Cliente,
  { pagina = 1, porPagina = SOLICITUDES_POR_PAGINA }: { pagina?: number; porPagina?: number } = {},
): Promise<PaginaDeSolicitudes> {
  const desde = (pagina - 1) * porPagina;
  const [{ data, error, count }, abiertas] = await Promise.all([
    cliente
      .from("solicitud_monitor")
      .select("id, nombre, correo, numero_telefono, estado, creada_en, actualizada_en, solicitud_monitor_materia(materia(nombre))", {
        count: "exact",
      })
      .order("creada_en", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, desde + porPagina - 1),
    contarSolicitudes(cliente, true),
  ]);
  // Una página después de la última: la API responde PGRST103. Se cuentan aparte y la página va vacía.
  if (error?.code === "PGRST103") return { solicitudes: [], total: await contarSolicitudes(cliente), abiertas, pagina, porPagina };
  if (error) throw new Error(`No se pudieron leer las solicitudes: ${error.message}`);

  const solicitudes = (data ?? []).map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    correo: fila.correo,
    numeroTelefono: fila.numero_telefono,
    estado: fila.estado,
    creadaEn: new Date(fila.creada_en),
    actualizadaEn: new Date(fila.actualizada_en),
    materias: (fila.solicitud_monitor_materia ?? [])
      .map((m) => m.materia?.nombre)
      .filter((nombre): nombre is string => Boolean(nombre))
      .sort((a, b) => a.localeCompare(b, "es")),
  }));
  return { solicitudes, total: count ?? solicitudes.length, abiertas, pagina, porPagina };
}

/** La página de la solicitud abierta más antigua (o la última, si no hay abiertas): ahí abre la lista. */
export async function paginaDeLaPrimeraAbierta(cliente: Cliente, porPagina = SOLICITUDES_POR_PAGINA): Promise<number> {
  const { data, error } = await cliente
    .from("solicitud_monitor")
    .select("id, creada_en")
    .eq("abierta", true)
    .order("creada_en", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw new Error(`No se pudo buscar la primera solicitud abierta: ${error.message}`);
  const primera = data?.[0];
  if (!primera) return paginaDeInicio(null, await contarSolicitudes(cliente), porPagina);

  // Las que van antes en la lista: más antiguas, o de la misma fecha con un id menor.
  const { count, error: errorConteo } = await cliente
    .from("solicitud_monitor")
    .select("id", { count: "exact", head: true })
    .or(`creada_en.lt."${primera.creada_en}",and(creada_en.eq."${primera.creada_en}",id.lt.${primera.id})`);
  if (errorConteo) throw new Error(`No se pudo ubicar la primera solicitud abierta: ${errorConteo.message}`);
  return paginaDeInicio(count ?? 0, 0, porPagina);
}

async function contarSolicitudes(cliente: Cliente, soloAbiertas = false): Promise<number> {
  let consulta = cliente.from("solicitud_monitor").select("id", { count: "exact", head: true });
  if (soloAbiertas) consulta = consulta.eq("abierta", true);
  const { count, error } = await consulta;
  if (error) throw new Error(`No se pudieron contar las solicitudes: ${error.message}`);
  return count ?? 0;
}

export type ResultadoCambio = { ok: true } | { ok: false; error: string };

/**
 * El admin marca una solicitud como contactada, evaluada o descartada, a su nombre. Con su sesión: la
 * política "admin cambia el estado" exige que sea un admin activo y que deje su propio id.
 */
export async function cambiarEstadoDeSolicitud(
  cliente: Cliente,
  cambio: { idSolicitud: string; estado: EstadoQueMarcaElAdmin; idAdmin: string },
): Promise<ResultadoCambio> {
  const { data, error } = await cliente
    .from("solicitud_monitor")
    .update({ estado: cambio.estado, id_admin_actualizo: cambio.idAdmin })
    .eq("id", cambio.idSolicitud)
    .select("id");
  if (error) return { ok: false, error: "No pudimos cambiar la solicitud. Intenta de nuevo." };
  if (!data?.length) return { ok: false, error: "No encontramos esa solicitud. Recarga la página." };
  return { ok: true };
}
