import { leerPagina } from "@/lib/solicitudes/reglas";
import { esEstadoDeLead, type EstadoLead } from "./estados";
import { leerOrigen } from "./origen";

/**
 * Filtros de la lista de Leads del admin y de su descarga (HU-053, D-61). Módulo puro, sin servidor: lo usan
 * la página, los enlaces de los filtros y la ruta del CSV.
 */

/**
 * Valor de «Sin origen» en `?origen=`. `leerOrigen` nunca acepta `~`, así que no choca con una campaña real.
 */
export const SIN_ORIGEN = "~";

/** Filtro de «con contacto»: `si` (por defecto, D-61 e), `no` o `todos`. */
export type FiltroContacto = "si" | "no" | "todos";

/** Filtros leídos de la dirección. `null` es «Todos»; `materia` es el código de la materia. */
export type FiltrosDeLeads = {
  estado: EstadoLead | null;
  origen: string | null;
  materia: string | null;
  contacto: FiltroContacto;
  pagina: number;
};

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Lee los filtros de `searchParams` (HU-053, D-61 e). Un valor repetido toma el primero; lo desconocido es
 * «Todos» y `contacto` sin valor válido vale `si`. Nunca lanza error.
 */
export function leerFiltrosDeLeads(parametros: Parametros, codigosDeMateria: readonly string[]): FiltrosDeLeads {
  const estado = primero(parametros.estado);
  const origen = primero(parametros.origen);
  const materia = primero(parametros.materia);
  const contacto = primero(parametros.contacto);
  return {
    estado: esEstadoDeLead(estado) ? estado : null,
    origen: origen === SIN_ORIGEN ? SIN_ORIGEN : leerOrigen(origen),
    materia: materia !== undefined && codigosDeMateria.includes(materia) ? materia : null,
    contacto: contacto === "no" || contacto === "todos" ? contacto : "si",
    pagina: leerPagina(parametros.pagina),
  };
}

/**
 * La dirección de la lista con esos filtros (HU-053). Solo los no nulos, en orden fijo; omite `contacto`
 * cuando es `si` (el default) y `pagina` cuando es 1.
 */
export function direccionDeLeads(filtros: Partial<FiltrosDeLeads>): string {
  const consulta = new URLSearchParams();
  if (filtros.estado) consulta.set("estado", filtros.estado);
  if (filtros.origen) consulta.set("origen", filtros.origen);
  if (filtros.materia) consulta.set("materia", filtros.materia);
  if (filtros.contacto && filtros.contacto !== "si") consulta.set("contacto", filtros.contacto);
  if (filtros.pagina && filtros.pagina > 1) consulta.set("pagina", String(filtros.pagina));
  const texto = consulta.toString();
  return texto ? `/admin/leads?${texto}` : "/admin/leads";
}

/**
 * La dirección de la descarga del CSV (HU-053): solo `estado`, `origen` y `materia`; nunca `contacto` ni
 * `pagina`.
 */
export function direccionDeDescarga(filtros: Pick<FiltrosDeLeads, "estado" | "origen" | "materia">): string {
  const consulta = new URLSearchParams();
  if (filtros.estado) consulta.set("estado", filtros.estado);
  if (filtros.origen) consulta.set("origen", filtros.origen);
  if (filtros.materia) consulta.set("materia", filtros.materia);
  const texto = consulta.toString();
  return texto ? `/admin/leads/exportar?${texto}` : "/admin/leads/exportar";
}
