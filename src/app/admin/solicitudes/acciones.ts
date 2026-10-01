"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/auth/sesion";
import { cambiarEstadoDeSolicitud } from "@/lib/solicitudes/admin";
import { confirmacionDelEstado, leerCambioDeEstado } from "@/lib/solicitudes/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/** HU-062: el admin marca una solicitud como contactada, evaluada o descartada. */
export type EstadoCambio = { error: string | null; exito: string | null };

export async function marcarSolicitud(_anterior: EstadoCambio, datos: FormData): Promise<EstadoCambio> {
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  const sesion = await exigirRol("admin", "/admin/solicitudes");
  const cambio = leerCambioDeEstado(datos);
  if (!cambio.ok) return { error: cambio.error, exito: null };

  const supabase = await crearClienteServidor();
  if (!supabase) return { error: "No pudimos cambiar la solicitud. Intenta de nuevo.", exito: null };
  // Con la sesión del admin: la política exige que sea un admin activo y que deje su propio id.
  const resultado = await cambiarEstadoDeSolicitud(supabase, { ...cambio.datos, idAdmin: sesion.idUsuario });
  if (!resultado.ok) return { error: resultado.error, exito: null };

  // La lista no cambia de orden con el estado, así que la tarjeta se queda donde estaba, con su foco.
  revalidatePath("/admin/solicitudes");
  return { error: null, exito: confirmacionDelEstado(cambio.datos.estado) };
}
