"use server";

import { revalidatePath } from "next/cache";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { cambiarEstadoDeLead, ERROR_AL_CAMBIAR, ERROR_AL_REGISTRAR, registrarSinContacto } from "@/lib/leads/admin";
import { esEstadoDeLead, ETIQUETA_DE_ESTADO } from "@/lib/leads/estados";
import { resumenDeError } from "@/lib/leads/reglas";
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

/** HU-089 (D-61 f): el admin registra que el Lead pidió no recibir más mensajes. */
export async function registrarPedidoSinContacto(_anterior: EstadoCambio, datos: FormData): Promise<EstadoCambio> {
  await exigirRol("admin", "/admin/leads");
  const idLead = datos.get("id_lead");
  if (typeof idLead !== "string" || !esUuid(idLead)) return { error: ERROR_AL_REGISTRAR, exito: null };

  const supabase = await crearClienteServidor();
  if (!supabase) return { error: ERROR_AL_REGISTRAR, exito: null };
  try {
    // Con la sesión del admin: la función guarda su id con auth.uid().
    const resultado = await registrarSinContacto(supabase, idLead);
    if (!resultado.ok) return { error: resultado.error, exito: null };
  } catch (error) {
    // Solo el código y el mensaje: nunca nombres, correos ni teléfonos.
    console.error("[admin] no se pudo registrar que un lead pidió no recibir mensajes:", resumenDeError(error));
    return { error: ERROR_AL_REGISTRAR, exito: null };
  }

  revalidatePath("/admin/leads");
  return { error: null, exito: "Quedó registrado." };
}
