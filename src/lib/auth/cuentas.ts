import "server-only";
import { crearClienteAdmin } from "@/lib/supabase/admin";

/** Go duration: 100 años. Supabase no acepta días ni semanas. */
const PARA_SIEMPRE = "876000h";

/**
 * RN-23: desactivar, nunca borrar. La cuenta queda baneada en Auth (no puede iniciar
 * sesión ni refrescar el token) y es_admin() deja de reconocerla al instante. La fila,
 * sus certificados y sus revisiones se conservan. La pantalla llega con HU-054.
 */
export async function desactivarCuenta(idUsuario: string): Promise<void> {
  const { error } = await crearClienteAdmin().auth.admin.updateUserById(idUsuario, { ban_duration: PARA_SIEMPRE });
  if (error) throw error;
}

export async function reactivarCuenta(idUsuario: string): Promise<void> {
  const { error } = await crearClienteAdmin().auth.admin.updateUserById(idUsuario, { ban_duration: "none" });
  if (error) throw error;
}
