import "server-only";
import { crearClienteAdmin } from "@/lib/supabase/admin";

/** Go duration: 100 años. Supabase no acepta días ni semanas. */
const PARA_SIEMPRE = "876000h";

/**
 * RN-23: desactivar, nunca borrar. La cuenta queda baneada en Auth (no puede iniciar
 * sesión ni refrescar el token) y es_admin() deja de reconocerla al instante. La fila,
 * sus certificados y sus revisiones se conservan. La pantalla es la de HU-054 (`/admin/equipo`).
 *
 * P-44 (HU-054) y HU-074: si es un admin, antes sus casos abiertos (reembolsos activos, reportes
 * en revisión y pagos en revisión) pasan al siguiente admin activo; los pagos, con una hora nueva
 * para revisarlos (RN-42). Va primero y aquí, para que ningún camino desactive sin reasignar: si la
 * reasignación falla (por ejemplo, no hay otro admin activo), la cuenta no se desactiva. Para quien
 * no es admin no mueve nada.
 *
 * Reasigna dos veces (HU-074, criterio 3): el baneo va por la API de Auth, en otra transacción, y
 * entre la primera reasignación y el baneo el admin sigue activo, así que un pago nuevo lo puede
 * elegir. La segunda, ya baneado, pasa esos pagos. Los que se estaban creando justo al reasignar
 * los cubre el candado del turno en la base (`*_reasignar_pagos.sql`).
 *
 * La segunda corre aunque Auth responda con error: el baneo pudo quedar aplicado y perderse la
 * respuesta, y después no hay cómo repetirla (el admin ya sale como desactivado). Si el baneo de
 * verdad no se aplicó, no hace daño: la reasignación es idempotente.
 */
export async function desactivarCuenta(idUsuario: string): Promise<void> {
  const cliente = crearClienteAdmin();
  const reasignacion = await cliente.rpc("reasignar_casos_de_admin", { p_id_admin: idUsuario });
  if (reasignacion.error) throw new Error(`No se pudieron reasignar sus casos: ${reasignacion.error.message}`);
  const { error } = await cliente.auth.admin.updateUserById(idUsuario, { ban_duration: PARA_SIEMPRE });
  const rezagados = await cliente.rpc("reasignar_casos_de_admin", { p_id_admin: idUsuario });
  if (error) throw error;
  if (rezagados.error) {
    throw new Error(
      `La cuenta ya quedó desactivada, pero no se pudieron pasar los casos que le llegaron mientras tanto: ${rezagados.error.message}`,
    );
  }
}

export async function reactivarCuenta(idUsuario: string): Promise<void> {
  const { error } = await crearClienteAdmin().auth.admin.updateUserById(idUsuario, { ban_duration: "none" });
  if (error) throw error;
}
