import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { desactivarCuenta } from "@/lib/auth/cuentas";
import type { Database } from "@/lib/supabase/tipos";
import {
  esResultadoDeMover,
  motivoParaNoDesactivar,
  siguienteActivo,
  type Direccion,
  type MiembroDelEquipo,
  type MotivoParaNoDesactivar,
  type ResultadoDeMover,
} from "./equipo-reglas";

type Cliente = SupabaseClient<Database>;

/**
 * El equipo de admins en su orden de revisión (HU-054), con la sesión del admin: `public.equipo_de_admins()` solo
 * responde a un admin activo; a cualquier otro le devuelve una lista vacía.
 */
export async function cargarEquipo(cliente: Cliente): Promise<MiembroDelEquipo[]> {
  const { data, error } = await cliente.rpc("equipo_de_admins");
  if (error) throw new Error(`No se pudo leer el equipo de admins: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id,
    nombre: f.nombre,
    correo: f.correo,
    ordenRevision: f.orden_revision,
    activo: f.activo,
    casosAbiertos: f.casos_abiertos,
  }));
}

/** Sube o baja a un admin un puesto (RN-07). La base comprueba que quien llama sea un admin activo. */
export async function moverAdmin(cliente: Cliente, id: string, direccion: Direccion): Promise<ResultadoDeMover> {
  const { data, error } = await cliente.rpc("mover_admin", { p_id: id, p_direccion: direccion });
  if (error) throw new Error(`No se pudo mover al admin: ${error.message}`);
  if (!esResultadoDeMover(data)) throw new Error(`Respuesta inesperada al mover: ${JSON.stringify(data)}`);
  return data;
}

export type ResultadoDeDesactivar = { ok: true; nombre: string; recibe: string | null } | { ok: false; motivo: MotivoParaNoDesactivar };

/**
 * Desactiva a otro admin (RN-23): sus casos abiertos, pagos en revisión incluidos (HU-074), pasan al siguiente activo
 * (P-44) y su cuenta queda baneada, todo dentro de `desactivarCuenta()`, que reasigna antes y después del baneo. Antes
 * se comprueba con el equipo que ve el admin de la sesión (si no es admin activo, lo ve vacío y no puede desactivar a
 * nadie).
 */
export async function desactivarAdmin(cliente: Cliente, idPropio: string, idObjetivo: string): Promise<ResultadoDeDesactivar> {
  const equipo = await cargarEquipo(cliente);
  const motivo = motivoParaNoDesactivar(equipo, idPropio, idObjetivo);
  if (motivo) return { ok: false, motivo };
  const objetivo = equipo.find((m) => m.id === idObjetivo)!;
  await desactivarCuenta(idObjetivo);
  return { ok: true, nombre: objetivo.nombre, recibe: objetivo.casosAbiertos > 0 ? (siguienteActivo(equipo, idObjetivo)?.nombre ?? null) : null };
}
