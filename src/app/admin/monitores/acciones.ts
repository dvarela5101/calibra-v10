"use server";

import { exigirRol } from "@/lib/auth/sesion";
import { normalizarCorreo } from "@/lib/monitores/invitacion";
import { invitarMonitor } from "@/lib/monitores/servidor";

export type EstadoInvitacion = { error: string | null; exito: string | null };

export async function invitar(_anterior: EstadoInvitacion, datos: FormData): Promise<EstadoInvitacion> {
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  const sesion = await exigirRol("admin", "/admin/monitores");
  const correo = normalizarCorreo(datos.get("correo"));
  if (!correo) return { error: "Escribe un correo válido.", exito: null };

  try {
    const resultado = await invitarMonitor(sesion.idUsuario, correo);
    if (!resultado.ok) return { error: resultado.error, exito: null };
    if (!resultado.correoEnviado) {
      return {
        error: `La invitación quedó creada, pero el correo a ${correo} no salió todavía. Calibra lo reintenta solo; si no sale, lo verás en tu bandeja en "Correos que no salieron". No hace falta invitar de nuevo.`,
        exito: null,
      };
    }
    return { error: null, exito: `Enviamos la invitación a ${correo}. El enlace vence en 7 días.` };
  } catch (error) {
    console.error("[admin] no se pudo invitar al monitor:", error);
    return { error: "No pudimos crear la invitación. Intenta de nuevo.", exito: null };
  }
}
