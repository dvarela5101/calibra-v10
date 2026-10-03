"use server";

import { redirect } from "next/navigation";
import { mensajeDeError } from "@/lib/auth/mensajes";
import { comoRol, destinoTrasIngresar, rutaInternaSegura } from "@/lib/auth/roles";
import { leerTokenCaptcha } from "@/lib/captcha/campo";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export type EstadoIngreso = { error: string | null };

export async function ingresar(_anterior: EstadoIngreso, datos: FormData): Promise<EstadoIngreso> {
  const correo = String(datos.get("correo") ?? "").trim();
  const contrasena = String(datos.get("contrasena") ?? "");
  if (!correo || !contrasena) return { error: "Escribe tu correo y tu contraseña." };

  const supabase = await crearClienteServidor();
  if (!supabase) return { error: "El inicio de sesión no está disponible en este momento." };

  // HU-058: con el CAPTCHA de Auth encendido el token es obligatorio; sin él (sin llave de sitio) no se manda nada.
  const { error } = await supabase.auth.signInWithPassword({
    email: correo,
    password: contrasena,
    options: { captchaToken: leerTokenCaptcha(datos) },
  });
  if (error) return { error: mensajeDeError(error.code, "No pudimos iniciar sesión. Intenta de nuevo.") };

  const { data: rol } = await supabase.rpc("mi_rol");
  const siguiente = rutaInternaSegura(String(datos.get("siguiente") ?? ""), "");
  redirect(destinoTrasIngresar(comoRol(rol), siguiente || null));
}
