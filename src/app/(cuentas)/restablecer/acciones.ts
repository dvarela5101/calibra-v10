"use server";

import { headers } from "next/headers";
import { mensajeDeError } from "@/lib/auth/mensajes";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export type EstadoRestablecer = { enviado: boolean; error: string | null };

export async function pedirEnlace(_anterior: EstadoRestablecer, datos: FormData): Promise<EstadoRestablecer> {
  const correo = String(datos.get("correo") ?? "").trim();
  if (!correo) return { enviado: false, error: "Escribe el correo de tu cuenta." };

  const supabase = await crearClienteServidor();
  if (!supabase) return { enviado: false, error: "Este servicio no está disponible en este momento." };

  const origen = (await headers()).get("origin") ?? "";
  const { error } = await supabase.auth.resetPasswordForEmail(correo, { redirectTo: `${origen}/auth/confirmar` });
  // Un correo sin cuenta responde igual que uno con cuenta: no revela quién está registrado.
  if (error) return { enviado: false, error: mensajeDeError(error.code) };
  return { enviado: true, error: null };
}
