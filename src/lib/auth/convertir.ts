import type { SupabaseClient } from "@supabase/supabase-js";

/** Igual a minimum_password_length de supabase/config.toml. */
export const CONTRASENA_MINIMA = 8;

export type ResultadoDeVincular = { ok: true } | { ok: false; codigo: string };

/**
 * Crear la cuenta de Estudiante (HU-032) es el mismo usuario de Auth de la sesión anónima, que se convierte en dos
 * pasos: ligar el correo (`vincularCorreo`) y, ya confirmado, ponerle contraseña (`ponerContrasena`). El id del
 * usuario NO cambia, así que sus diagnósticos y su Lead siguen siendo suyos sin migrar nada (sección 14).
 *
 * Pide a Auth que ligue el correo a la sesión anónima. Con las confirmaciones activas, Auth manda el enlace al
 * correo y el usuario sigue anónimo hasta abrirlo (`verifyOtp` con el tipo `email_change`).
 */
export async function vincularCorreo(supabase: SupabaseClient, correo: string): Promise<ResultadoDeVincular> {
  const { data, error } = await supabase.auth.updateUser({ email: correo });
  if (error) return { ok: false, codigo: error.code ?? "desconocido" };
  // Si ya dejó de ser anónimo, Auth cambió el correo sin confirmarlo: las confirmaciones están apagadas. La guardia del
  // servidor lo evita antes de llamar; esto es la segunda red (RN-12).
  if (data.user?.is_anonymous === false) return { ok: false, codigo: "correo_sin_confirmar" };
  return { ok: true };
}

/**
 * Pone la contraseña de quien ya confirmó su correo. No refresca la sesión: la que deja `verifyOtp` al confirmar ya
 * trae el token nuevo, el de un usuario que dejó de ser anónimo.
 */
export async function ponerContrasena(supabase: SupabaseClient, contrasena: string): Promise<ResultadoDeVincular> {
  // Se valida antes de llamar a Auth: la contraseña corta no cambia nada.
  if (contrasena.length < CONTRASENA_MINIMA) return { ok: false, codigo: "weak_password" };
  const { error } = await supabase.auth.updateUser({ password: contrasena });
  return error ? { ok: false, codigo: error.code ?? "desconocido" } : { ok: true };
}
