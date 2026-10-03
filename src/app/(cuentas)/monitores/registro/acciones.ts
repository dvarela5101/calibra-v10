"use server";

import { redirect } from "next/navigation";
import { leerTokenCaptcha } from "@/lib/captcha/campo";
import { leerRegistro } from "@/lib/monitores/invitacion";
import { registrarMonitor } from "@/lib/monitores/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/** `valores` devuelve lo escrito (sin contraseñas) para no vaciar el formulario tras un error. */
export type EstadoRegistro = { error: string | null; invitacionNoSirve: boolean; valores: Record<string, string> };

const CAMPOS_QUE_SE_CONSERVAN = ["nombre", "numero_telefono", "llave"] as const;

export async function registrarse(_anterior: EstadoRegistro, datos: FormData): Promise<EstadoRegistro> {
  const valores = Object.fromEntries(CAMPOS_QUE_SE_CONSERVAN.map((campo) => [campo, String(datos.get(campo) ?? "")]));
  const fallo = (error: string, invitacionNoSirve = false): EstadoRegistro => ({ error, invitacionNoSirve, valores });

  const lectura = leerRegistro(datos);
  if (!lectura.ok) return fallo(lectura.error);

  let resultado;
  try {
    resultado = await registrarMonitor(datos.get("token"), lectura.datos);
  } catch (error) {
    console.error("[monitores] fallo al registrar:", error);
    return fallo("No pudimos crear tu cuenta. Intenta de nuevo.");
  }
  if (!resultado.ok) return fallo(resultado.error, resultado.motivo === "invitacion_no_sirve");

  // La cuenta ya existe: se entra con ella. Si el inicio falla, puede entrar desde /ingresar.
  const supabase = await crearClienteServidor();
  // HU-058: con el CAPTCHA de Auth encendido este inicio de sesión también exige el token.
  const { error } = (await supabase?.auth.signInWithPassword({
    email: resultado.correo,
    password: lectura.datos.contrasena,
    options: { captchaToken: leerTokenCaptcha(datos) },
  })) ?? { error: true };
  redirect(error ? "/ingresar" : "/monitor");
}
