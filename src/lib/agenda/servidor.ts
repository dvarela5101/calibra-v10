import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { esEstadoPago, esResultadoDeFinalizar, type MonitoriaDeAgenda, type ResultadoDeFinalizar } from "./reglas";

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

/**
 * El monitor de la sesión marca como realizada una monitoría (HU-023). La base decide si se puede: que sea
 * suya, que esté confirmada y que ya haya empezado (D-13), con su propia hora.
 */
export async function finalizarMonitoria(cliente: SupabaseClient<Database>, idMonitoria: string): Promise<ResultadoDeFinalizar> {
  const { data, error } = await cliente.rpc("finalizar_monitoria", { p_id_monitoria: idMonitoria });
  if (error) throw new Error(`No se pudo finalizar la monitoría: ${error.code ?? ""} ${error.message}`.trim());
  if (!esResultadoDeFinalizar(data)) throw new Error(`Respuesta inesperada al finalizar: ${JSON.stringify(data)}`);
  return data;
}
