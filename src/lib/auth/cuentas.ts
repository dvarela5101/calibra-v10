import "server-only";
import { crearClienteAdmin } from "@/lib/supabase/admin";

/** Go duration: 100 años. Supabase no acepta días ni semanas. */
const PARA_SIEMPRE = "876000h";

/**
 * RN-23: desactivar, nunca borrar. La cuenta queda baneada en Auth (no puede iniciar
 * sesión ni refrescar el token) y es_admin() deja de reconocerla al instante. La fila,
 * sus certificados y sus revisiones se conservan. La pantalla es la de HU-054 (`/admin/equipo`).
 *
 * P-44 (HU-054): si es un admin, antes sus reembolsos y reportes abiertos pasan al siguiente admin
 * activo. Va primero y aquí, para que ningún camino desactive sin reasignar: si la reasignación
 * falla (por ejemplo, no hay otro admin activo), la cuenta no se desactiva. Para quien no es admin
 * no mueve nada.
 */
export async function desactivarCuenta(idUsuario: string): Promise<void> {
  const cliente = crearClienteAdmin();
  const reasignacion = await cliente.rpc("reasignar_casos_de_admin", { p_id_admin: idUsuario });
  if (reasignacion.error) throw new Error(`No se pudieron reasignar sus casos: ${reasignacion.error.message}`);
  const { error } = await cliente.auth.admin.updateUserById(idUsuario, { ban_duration: PARA_SIEMPRE });
  if (error) throw error;
}

export async function reactivarCuenta(idUsuario: string): Promise<void> {
  const { error } = await crearClienteAdmin().auth.admin.updateUserById(idUsuario, { ban_duration: "none" });
  if (error) throw error;
}
