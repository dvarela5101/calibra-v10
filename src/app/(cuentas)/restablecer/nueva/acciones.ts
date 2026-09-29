"use server";

import { redirect } from "next/navigation";
import { mensajeDeError } from "@/lib/auth/mensajes";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export type EstadoNuevaContrasena = { error: string | null };

export async function guardarContrasena(
  _anterior: EstadoNuevaContrasena,
  datos: FormData,
): Promise<EstadoNuevaContrasena> {
  const contrasena = String(datos.get("contrasena") ?? "");
  const confirmacion = String(datos.get("confirmacion") ?? "");
  if (contrasena.length < 8) return { error: mensajeDeError("weak_password") };
  if (contrasena !== confirmacion) return { error: "Las dos contraseñas no coinciden." };

  const supabase = await crearClienteServidor();
  if (!supabase) return { error: "Este servicio no está disponible en este momento." };

  // La sesión viene del enlace del correo (/auth/confirmar). Sin ella no hay a quién cambiarle la clave.
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/restablecer?error=enlace");

  const { error } = await supabase.auth.updateUser({ password: contrasena });
  if (error) return { error: mensajeDeError(error.code) };

  // Se cierra la sesión del enlace: la persona entra de nuevo, ya con su contraseña nueva.
  await supabase.auth.signOut();
  redirect("/ingresar?contrasena=actualizada");
}
