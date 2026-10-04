"use server";

import { headers } from "next/headers";
import { mensajeDeError } from "@/lib/auth/mensajes";
import { leerTokenCaptcha } from "@/lib/captcha/campo";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export type EstadoRestablecer = { enviado: boolean; error: string | null };

export async function pedirEnlace(_anterior: EstadoRestablecer, datos: FormData): Promise<EstadoRestablecer> {
  const correo = String(datos.get("correo") ?? "").trim();
  if (!correo) return { enviado: false, error: "Escribe el correo de tu cuenta." };

  const supabase = await crearClienteServidor();
  if (!supabase) return { enviado: false, error: "Este servicio no está disponible en este momento." };

  const origen = (await headers()).get("origin") ?? "";
  // HU-058: con el CAPTCHA de Auth encendido el token es obligatorio; sin él (sin llave de sitio) no se manda nada.
  const { error } = await supabase.auth.resetPasswordForEmail(correo, {
    redirectTo: `${origen}/auth/confirmar`,
    captchaToken: leerTokenCaptcha(datos),
  });
  // Un correo sin cuenta responde igual que uno con cuenta: no revela quién está registrado.
  if (error) return { enviado: false, error: mensajeDeError(error.code) };
  return { enviado: true, error: null };
}
