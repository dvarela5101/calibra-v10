import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import type { EstadoLead } from "./estados";
import { SIN_ORIGEN, type FiltrosDeLeads } from "./filtros";

type Cliente = SupabaseClient<Database>;

/** Leads por página en `/admin/leads` (HU-053). */
export const LEADS_POR_PAGINA = 50;

/** La API corta cada respuesta en 1000 filas (`max_rows` de `supabase/config.toml`). */
export const FILAS_POR_BLOQUE = 1000;

/** Una materia, para el filtro y para nombrar las de cada Lead. */
export type MateriaDeFiltro = { id: string; nombre: string; codigo: string };

/** Un Lead como lo ve el admin en su lista (HU-053). */
export type LeadParaAdmin = {
  id: string;
  nombre: string;
  correo: string | null;
  numeroTelefono: string | null;
  estado: EstadoLead;
  origen: string | null;
  aceptaContacto: boolean;
  fechaCreacion: Date;
  /** Nombres de sus materias (D-61 a), en orden alfabético. */
  materias: string[];
  /** Quién marcó el estado y cuándo; `null` si nadie lo ha gestionado. */
  marcado: { porAdmin: string | null; en: Date } | null;
};

export type PaginaDeLeads = {
  leads: LeadParaAdmin[];
  /** Cuántos cumplen los filtros, en todas las páginas. */
  total: number;
  /** Cuántos hay sin ningún filtro: con 0 la pantalla dice que todavía no hay leads. */
  totalSinFiltros: number;
  pagina: number;
  porPagina: number;
};

/** Los filtros ya resueltos: la materia como id (el código lo traduce quien llama). */
export type FiltrosResueltos = Pick<FiltrosDeLeads, "estado" | "origen" | "contacto"> & { idMateria: string | null };

const COLUMNAS =
  "id, nombre, correo, numero_telefono, estado, origen, acepta_contacto, fecha_creacion, estado_cambiado_en, id_admin_estado, ids_materia";

type Fila = Database["public"]["Views"]["lead_para_gestion"]["Row"];

/** Las materias para el filtro, por nombre. `materia` es de lectura pública. */
export async function listarMaterias(cliente: Cliente): Promise<MateriaDeFiltro[]> {
  const { data, error } = await cliente.from("materia").select("id, nombre, codigo").order("nombre");
  if (error) throw new Error(`No se pudieron leer las materias: ${error.message}`);
  return data ?? [];
}

/** Las campañas distintas con que llegaron los Leads (vacío para quien no es admin activo). */
export async function listarOrigenes(cliente: Cliente): Promise<string[]> {
  const { data, error } = await cliente.rpc("origenes_de_leads");
  if (error) throw new Error(`No se pudieron leer los orígenes: ${error.message}`);
  return (data ?? []).filter((origen): origen is string => typeof origen === "string");
}

/**
 * Aplica los filtros de estado, origen y materia (y, si se pide, el de acepta contacto) a una consulta de las
 * vistas de leads. «Sin origen» es `origen is null`; la materia, que esté en `ids_materia`.
 */
/** Lo que `filtrar` usa de una consulta de PostgREST, sin los tipos por columna de cada vista. */
type ConsultaFiltrable = {
  eq(columna: string, valor: string | boolean): ConsultaFiltrable;
  is(columna: string, valor: null): ConsultaFiltrable;
  contains(columna: string, valor: string[]): ConsultaFiltrable;
};

function filtrar<Q>(
  consulta: Q,
  filtros: Omit<FiltrosResueltos, "contacto"> & { contacto?: FiltrosResueltos["contacto"] },
): Q {
  let q = consulta as unknown as ConsultaFiltrable;
  if (filtros.estado) q = q.eq("estado", filtros.estado);
  if (filtros.origen === SIN_ORIGEN) q = q.is("origen", null);
  else if (filtros.origen) q = q.eq("origen", filtros.origen);
  if (filtros.idMateria) q = q.contains("ids_materia", [filtros.idMateria]);
  if (filtros.contacto === "si") q = q.eq("acepta_contacto", true);
  else if (filtros.contacto === "no") q = q.eq("acepta_contacto", false);
  return q as unknown as Q;
}

/**
 * Una página de leads, del más nuevo al más antiguo (`fecha_creacion` e `id`, descendentes: un orden total). Se
 * leen con la sesión del admin: la vista da cero filas a quien no es admin activo.
 */
export async function listarLeads(
  cliente: Cliente,
  { filtros, pagina = 1, porPagina = LEADS_POR_PAGINA, materias }: {
    filtros: FiltrosResueltos;
    pagina?: number;
    porPagina?: number;
    materias: readonly MateriaDeFiltro[];
  },
): Promise<PaginaDeLeads> {
  const desde = (pagina - 1) * porPagina;
  const [{ data, error, count }, totalSinFiltros] = await Promise.all([
    filtrar(cliente.from("lead_para_gestion").select(COLUMNAS, { count: "exact" }), filtros)
      .order("fecha_creacion", { ascending: false })
      .order("id", { ascending: false })
      .range(desde, desde + porPagina - 1),
    contar(cliente, "lead_para_gestion", null),
  ]);
  // Una página después de la última: la API responde PGRST103. Se cuentan aparte y la página va vacía.
  if (error?.code === "PGRST103") {
    return { leads: [], total: await contar(cliente, "lead_para_gestion", filtros), totalSinFiltros, pagina, porPagina };
  }
  if (error) throw new Error(`No se pudieron leer los leads: ${error.message}`);

  const filas = (data ?? []) as Fila[];
  const nombresDeAdmin = await nombresDeAdmins(cliente, filas);
  const leads = filas.map((fila) => aLeadParaAdmin(fila, materias, nombresDeAdmin));
  return { leads, total: count ?? leads.length, totalSinFiltros, pagina, porPagina };
}

/** Cuántos entran en la descarga con los filtros de estado, origen y materia (D-61 c: la vista pone la regla). */
export async function contarParaContactar(cliente: Cliente, filtros: Omit<FiltrosResueltos, "contacto">): Promise<number> {
  return contar(cliente, "lead_para_contactar", filtros);
}

/**
 * Todos los leads para contactar con esos filtros, en el orden de la lista, recorriendo la vista por bloques: la API
 * corta cada respuesta en 1000 filas. El orden es total, así que ningún bloque repite ni salta filas.
 */
export async function leerParaContactar(
  cliente: Cliente,
  { filtros, materias, filasPorBloque = FILAS_POR_BLOQUE }: {
    filtros: Omit<FiltrosResueltos, "contacto">;
    materias: readonly MateriaDeFiltro[];
    filasPorBloque?: number;
  },
): Promise<LeadParaAdmin[]> {
  const todos: LeadParaAdmin[] = [];
  for (let desde = 0; ; desde += filasPorBloque) {
    const { data, error } = await filtrar(cliente.from("lead_para_contactar").select(COLUMNAS), filtros)
      .order("fecha_creacion", { ascending: false })
      .order("id", { ascending: false })
      .range(desde, desde + filasPorBloque - 1);
    if (error) throw new Error(`No se pudieron leer los leads para contactar: ${error.message}`);
    const filas = (data ?? []) as Fila[];
    // La descarga no muestra quién marcó: no se leen los nombres de los admins.
    todos.push(...filas.map((fila) => aLeadParaAdmin(fila, materias, new Map())));
    if (filas.length < filasPorBloque) return todos;
  }
}

async function contar(
  cliente: Cliente,
  vista: "lead_para_gestion" | "lead_para_contactar",
  filtros: (Omit<FiltrosResueltos, "contacto"> & { contacto?: FiltrosResueltos["contacto"] }) | null,
): Promise<number> {
  const base = cliente.from(vista).select("id", { count: "exact", head: true });
  const { count, error } = await (filtros ? filtrar(base, filtros) : base);
  if (error) throw new Error(`No se pudieron contar los leads: ${error.message}`);
  return count ?? 0;
}

/** Los nombres de los admins que marcaron estas filas (la política «admin lee» de `admin` lo permite). */
async function nombresDeAdmins(cliente: Cliente, filas: readonly Fila[]): Promise<Map<string, string>> {
  const ids = [...new Set(filas.map((f) => f.id_admin_estado).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const { data, error } = await cliente.from("admin").select("id, nombre").in("id", ids);
  if (error) throw new Error(`No se pudieron leer los nombres de los admins: ${error.message}`);
  return new Map((data ?? []).map((a) => [a.id, a.nombre]));
}

function aLeadParaAdmin(fila: Fila, materias: readonly MateriaDeFiltro[], nombresDeAdmin: Map<string, string>): LeadParaAdmin {
  const nombreDe = new Map(materias.map((m) => [m.id, m.nombre]));
  return {
    id: fila.id ?? "",
    nombre: fila.nombre ?? "",
    correo: fila.correo,
    numeroTelefono: fila.numero_telefono,
    estado: (fila.estado ?? "nuevo") as EstadoLead,
    origen: fila.origen,
    aceptaContacto: fila.acepta_contacto === true,
    fechaCreacion: new Date(fila.fecha_creacion ?? 0),
    materias: (fila.ids_materia ?? [])
      .map((id) => nombreDe.get(id))
      .filter((nombre): nombre is string => Boolean(nombre))
      .sort((a, b) => a.localeCompare(b, "es")),
    marcado: fila.estado_cambiado_en
      ? {
          porAdmin: fila.id_admin_estado ? (nombresDeAdmin.get(fila.id_admin_estado) ?? null) : null,
          en: new Date(fila.estado_cambiado_en),
        }
      : null,
  };
}

export type ResultadoCambio = { ok: true } | { ok: false; error: string };

export const ERROR_AL_CAMBIAR = "No pudimos cambiar el estado. Intenta de nuevo.";
export const YA_DESCARTADO = "Ese lead ya está descartado. Recarga la página.";
export const NO_ENCONTRADO = "No encontramos ese lead. Recarga la página.";

/**
 * El admin marca el estado de un Lead (D-61 d). Con su sesión, no con la llave secreta: así el trigger anota su id.
 * La política no deja tocar un descartado; un update que no toca ninguna fila se lee de nuevo para decir por qué.
 */
export async function cambiarEstadoDeLead(
  cliente: Cliente,
  cambio: { idLead: string; estado: EstadoLead },
): Promise<ResultadoCambio> {
  const { data, error } = await cliente.from("lead").update({ estado: cambio.estado }).eq("id", cambio.idLead).select("id");
  if (error) return { ok: false, error: ERROR_AL_CAMBIAR };
  if (data?.length) return { ok: true };

  const { data: actual, error: errorLectura } = await cliente
    .from("lead_para_gestion")
    .select("estado")
    .eq("id", cambio.idLead)
    .maybeSingle();
  if (errorLectura) return { ok: false, error: ERROR_AL_CAMBIAR };
  if (actual?.estado === "descartado") return { ok: false, error: YA_DESCARTADO };
  return { ok: false, error: NO_ENCONTRADO };
}
