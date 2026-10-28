import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerVistaDelMonitor, type VistaDelMonitor } from "@/lib/diagnostico/vista-del-monitor";
import type { Database } from "@/lib/supabase/tipos";
import { esEstadoPago, esResultadoDeFinalizar, type LugarDeMonitoria, type MonitoriaDeAgenda, type ResultadoDeFinalizar } from "./reglas";

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

/**
 * El diagnóstico ligado a una cita del monitor de la sesión (HU-022), tal como lo proyecta `public.diagnostico_de_mi_monitoria`.
 * Va con el cliente DE LA SESIÓN, nunca con la llave secreta: la base saca al monitor del JWT y devuelve nada si la cita no existe,
 * no es suya, es grupal o su estado no se ve (pendiente de pago, cancelada o realizada hace más de 30 días); aquí eso es `null`,
 * sin distinguir cuál. Un `select` sobre `diagnostico` no sirve: la política ya no deja leerlo por la cita.
 *
 * Lanza si la base falla, con el código y el mensaje de PostgREST y nunca `details`, o si lo que devolvió no cuadra
 * (`ErrorDeVistaDelMonitor`, con la ruta del dato malo y sin su contenido).
 */
export async function cargarDiagnosticoDeLaCita(cliente: Pick<SupabaseClient<Database>, "rpc">, idMonitoria: string): Promise<VistaDelMonitor | null> {
  const { data, error } = await cliente.rpc("diagnostico_de_mi_monitoria", { p_id_monitoria: idMonitoria });
  if (error) throw new Error(`No se pudo leer el diagnóstico de la cita (código ${error.code || "sin código"}): ${error.message}`);
  return leerVistaDelMonitor(data);
}

/** D-76 (HU-107): el dato de las monitorías del monitor de la sesión que ya lo tienen, por id. */
export async function cargarLugares(cliente: Pick<SupabaseClient<Database>, "rpc">): Promise<Map<string, LugarDeMonitoria>> {
  const { data, error } = await cliente.rpc("lugares_de_mi_agenda");
  if (error) throw new Error(`No se pudieron leer los lugares de la agenda: ${error.message}`);
  return new Map((data ?? []).map((f) => [f.id_monitoria, { lugar: f.lugar, enlace: f.enlace }]));
}

/**
 * D-76: el monitor de la sesión pone o cambia el lugar o el enlace de una monitoría suya. La base decide si se puede y si el dato
 * sirve; sus mensajes (P0001) son para la persona. Cualquier otro error lanza.
 */
export async function ponerLugar(
  cliente: Pick<SupabaseClient<Database>, "rpc">,
  idMonitoria: string,
  valor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await cliente.rpc("poner_lugar_de_mi_monitoria", { p_id_monitoria: idMonitoria, p_valor: valor });
  if (!error) return { ok: true };
  if (error.code === "P0001") return { ok: false, error: error.message };
  throw new Error(`No se pudo guardar el lugar (código ${error.code || "sin código"}): ${error.message}`);
}
