"use server";

import { revalidatePath } from "next/cache";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { cambiarEstadoDeLead, ERROR_AL_CAMBIAR } from "@/lib/leads/admin";
import { esEstadoDeLead, ETIQUETA_DE_ESTADO } from "@/lib/leads/estados";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/** HU-053 (D-61 d): el admin marca un Lead como nuevo, contactado o descartado. */
export type EstadoCambio = { error: string | null; exito: string | null };

export async function marcarLead(_anterior: EstadoCambio, datos: FormData): Promise<EstadoCambio> {
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  await exigirRol("admin", "/admin/leads");
  const idLead = datos.get("id_lead");
  const estado = datos.get("estado");
  if (typeof idLead !== "string" || !esUuid(idLead) || !esEstadoDeLead(estado)) {
    return { error: ERROR_AL_CAMBIAR, exito: null };
  }

  const supabase = await crearClienteServidor();
  if (!supabase) return { error: ERROR_AL_CAMBIAR, exito: null };
  // Con la sesión del admin, no con la llave secreta: así el trigger anota su id (lead_gestion).
  const resultado = await cambiarEstadoDeLead(supabase, { idLead, estado });
  if (!resultado.ok) return { error: resultado.error, exito: null };

  // La lista no cambia de orden con el estado: la tarjeta se queda donde estaba, con su foco.
  revalidatePath("/admin/leads");
  return { error: null, exito: `Quedó como ${ETIQUETA_DE_ESTADO[estado].toLowerCase()}.` };
}
