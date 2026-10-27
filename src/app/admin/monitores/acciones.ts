"use server";

import { exigirRol } from "@/lib/auth/sesion";
import { avisoDeInvitacion, normalizarCorreo } from "@/lib/monitores/invitacion";
import { invitarMonitor } from "@/lib/monitores/servidor";

export type EstadoInvitacion = { error: string | null; exito: string | null };

export async function invitar(_anterior: EstadoInvitacion, datos: FormData): Promise<EstadoInvitacion> {
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  const sesion = await exigirRol("admin", "/admin/monitores");
  const correo = normalizarCorreo(datos.get("correo"));
  if (!correo) return { error: "Escribe un correo válido.", exito: null };

  try {
    return avisoDeInvitacion(correo, await invitarMonitor(sesion.idUsuario, correo));
  } catch (error) {
    console.error("[admin] no se pudo invitar al monitor:", error);
    return { error: "No pudimos crear la invitación. Intenta de nuevo.", exito: null };
  }
}
