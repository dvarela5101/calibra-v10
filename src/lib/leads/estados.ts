import type { Database } from "@/lib/supabase/tipos";

/**
 * Estado comercial de un Lead (RN-09, HU-053). Lo cambia a mano un admin: nada lo mueve solo. `descartado` es
 * definitivo desde la pantalla (D-61 d). Sin dependencias del servidor: lo usan la pantalla, la acción y el CSV.
 */
export type EstadoLead = Database["public"]["Enums"]["estado_lead"];

/** En el orden en que se ofrecen en los filtros y en la tarjeta. */
export const ESTADOS_DE_LEAD = ["nuevo", "contactado", "descartado"] as const satisfies readonly EstadoLead[];

/** Cómo se lee cada estado en la pantalla y en el archivo. */
export const ETIQUETA_DE_ESTADO: Record<EstadoLead, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  descartado: "Descartado",
};

export function esEstadoDeLead(valor: unknown): valor is EstadoLead {
  return typeof valor === "string" && (ESTADOS_DE_LEAD as readonly string[]).includes(valor);
}
