"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/auth/sesion";
import { avisoDeInvitacion } from "@/lib/monitores/invitacion";
import { correoDeLaSolicitud, invitarMonitor } from "@/lib/monitores/servidor";
import { cambiarEstadoDeSolicitud } from "@/lib/solicitudes/admin";
import { confirmacionDelEstado, leerCambioDeEstado, leerSolicitudAInvitar } from "@/lib/solicitudes/reglas";
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

/**
 * D-75 c: el admin invita a la persona desde su solicitud, como en `/admin/monitores`, con el correo que ella dejó. El estado de
 * la solicitud no cambia: lo marca el admin con los botones de siempre.
 */
export async function invitarDesdeSolicitud(_anterior: EstadoCambio, datos: FormData): Promise<EstadoCambio> {
  const sesion = await exigirRol("admin", "/admin/solicitudes");
  const lectura = leerSolicitudAInvitar(datos);
  if (!lectura.ok) return { error: lectura.error, exito: null };

  try {
    const solicitud = await correoDeLaSolicitud(lectura.datos.idSolicitud);
    if (!solicitud) return { error: "No encontramos esa solicitud. Recarga la página.", exito: null };
    const aviso = avisoDeInvitacion(solicitud.correo, await invitarMonitor(sesion.idUsuario, solicitud.correo));
    // La tarjeta pasa a «Invitación enviada» (o a «Ya tiene cuenta de monitor») sin cambiar de lugar.
    revalidatePath("/admin/solicitudes");
    return aviso;
  } catch (error) {
    console.error("[admin] no se pudo invitar desde la solicitud:", error instanceof Error ? error.message : error);
    return { error: "No pudimos crear la invitación. Intenta de nuevo.", exito: null };
  }
}
