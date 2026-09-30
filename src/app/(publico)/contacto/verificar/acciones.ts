"use server";

import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/auth/sesion";
import { resumenDeError, rutaSiguiente } from "@/lib/leads/reglas";
import { confirmarCorreo, type ResultadoConfirmacion } from "@/lib/leads/servidor";

export type EstadoConfirmacion = { error: string | null };

/**
 * P-23 (HU-068): la sesión de este navegador queda ligada al Lead dueño del correo. Se hace con un botón
 * (POST) y no al abrir el enlace, para que un revisor de enlaces del correo no lo gaste solo.
 */
export async function confirmar(_anterior: EstadoConfirmacion, datos: FormData): Promise<EstadoConfirmacion> {
  const sesion = await obtenerSesion();
  if (!sesion) return { error: "No encontramos tu sesión. Recarga la página e intenta de nuevo." };
  if (sesion.rol === "monitor" || sesion.rol === "admin") {
    return { error: "Estás con tu cuenta del equipo de Calibra. Abre el enlace en otra ventana, sin iniciar sesión." };
  }

  let resultado: ResultadoConfirmacion;
  try {
    resultado = await confirmarCorreo(datos.get("token"), sesion.idUsuario);
  } catch (error) {
    console.error("[leads] no se pudo confirmar el correo:", resumenDeError(error));
    return { error: "No pudimos confirmar tu correo. Intenta de nuevo." };
  }
  if (!resultado.ok) {
    return {
      error:
        "No pudimos confirmar con este enlace: ya se usó o venció, o este navegador ya tiene guardados los datos de otra persona. Si es lo segundo, ábrelo en otra ventana privada.",
    };
  }
  redirect(rutaSiguiente(resultado.siguiente));
}
