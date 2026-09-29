import type { SupabaseClient } from "@supabase/supabase-js";

/** Igual a minimum_password_length de supabase/config.toml. */
export const CONTRASENA_MINIMA = 8;

export type ResultadoConversion =
  | { ok: true; pendiente: null }
  /** Con confirmación de correo activa: la contraseña se pone después de verificar el correo. */
  | { ok: true; pendiente: "verificar_correo" }
  | { ok: false; codigo: string };

/**
 * Convierte la sesión anónima en una cuenta con correo y contraseña. El id del usuario
 * NO cambia, así que sus diagnósticos y su lead siguen siendo suyos sin migrar nada
 * (sección 14). Recibe el cliente con la sesión anónima activa. La pantalla es HU-032.
 *
 * Supabase exige vincular el correo antes que la contraseña. Si el proyecto pide
 * confirmar correos, el usuario sigue anónimo hasta abrir el enlace.
 */
export async function convertirAnonimoEnCuenta(
  supabase: SupabaseClient,
  datos: { correo: string; contrasena: string },
): Promise<ResultadoConversion> {
  // Se valida antes de tocar nada: vincular el correo no se puede deshacer, y con una
  // contraseña rechazada la cuenta quedaría con correo y sin contraseña.
  if (datos.contrasena.length < CONTRASENA_MINIMA) return { ok: false, codigo: "weak_password" };

  const conCorreo = await supabase.auth.updateUser({ email: datos.correo });
  if (conCorreo.error) return { ok: false, codigo: conCorreo.error.code ?? "desconocido" };
  if (conCorreo.data.user?.is_anonymous) return { ok: true, pendiente: "verificar_correo" };

  const conContrasena = await supabase.auth.updateUser({ password: datos.contrasena });
  if (conContrasena.error) return { ok: false, codigo: conContrasena.error.code ?? "desconocido" };

  // El token vigente todavía dice is_anonymous: true; el nuevo ya no.
  const refresco = await supabase.auth.refreshSession();
  if (refresco.error) return { ok: false, codigo: refresco.error.code ?? "desconocido" };

  return { ok: true, pendiente: null };
}
