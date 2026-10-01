import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { esEstadoPago, type MonitoriaDeAgenda } from "./reglas";

/**
 * La agenda del monitor de la sesión (HU-021). Con su propia sesión: `public.mi_agenda()` solo devuelve sus
 * monitorías, y a otro monitor o a una sesión sin monitorías le devuelve una lista vacía.
 */
export async function cargarAgenda(cliente: SupabaseClient<Database>): Promise<MonitoriaDeAgenda[]> {
  const { data, error } = await cliente.rpc("mi_agenda");
  if (error) throw new Error(`No se pudo leer la agenda: ${error.message}`);
  return (data ?? []).map((f) => {
    if (!esEstadoPago(f.estado_pago)) throw new Error(`Estado de pago inesperado: ${f.estado_pago}`);
    return {
      idMonitoria: f.id_monitoria,
      fecha: f.fecha,
      hora: f.hora,
      duracionMin: f.duracion_min,
      presencial: f.presencial,
      nombreMateria: f.nombre_materia,
      codigoMateria: f.codigo_materia,
      nombreEstudiante: f.nombre_estudiante,
      estado: f.estado,
      motivoCancelacion: f.motivo_cancelacion,
      reservaVencida: f.reserva_vencida,
      estadoPago: f.estado_pago,
      inicio: new Date(f.inicio),
    };
  });
}
