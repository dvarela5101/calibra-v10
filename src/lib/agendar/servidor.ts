import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { esResultadoDeAgendar, type PedidoDeAgendar, type ResultadoDeAgendar } from "./reglas";

/**
 * Agendar con la sesión de quien agenda (HU-017). Nada de la llave secreta: `public.agendar_monitoria` toma
 * la identidad de la sesión (`auth.uid()`) y la hora de la base, y solo la ejecuta una sesión (la anónima
 * del visitante incluida). La reserva la lee la misma sesión, por las políticas de `monitoria`.
 */

type Cliente = SupabaseClient<Database>;

export type Agendamiento = { resultado: ResultadoDeAgendar; idMonitoria: string | null };

/** Aparta la fecha para el Lead de la sesión. `aceptaSinCancelacion` es la casilla de RN-37 (D-10). */
export async function agendarMonitoria(cliente: Cliente, pedido: PedidoDeAgendar, aceptaSinCancelacion: boolean): Promise<Agendamiento> {
  const { data, error } = await cliente.rpc("agendar_monitoria", {
    p_id_franja: pedido.idFranja,
    p_fecha: pedido.fecha,
    p_codigo_materia: pedido.codigoMateria,
    p_acepta_sin_cancelacion: aceptaSinCancelacion,
  });
  if (error) throw new Error(`No se pudo agendar: ${error.code ?? ""} ${error.message}`.trim());
  const fila = data?.[0];
  if (!fila || !esResultadoDeAgendar(fila.resultado)) throw new Error(`Respuesta inesperada al agendar: ${JSON.stringify(fila ?? null)}`);
  return { resultado: fila.resultado, idMonitoria: fila.id_monitoria ?? null };
}

export type Reserva = {
  id: string;
  estado: Database["public"]["Enums"]["estado_monitoria"];
  motivoCancelacion: Database["public"]["Enums"]["motivo_cancelacion"] | null;
  /** Día de calendario, `AAAA-MM-DD`. */
  fecha: string;
  /** Hora de inicio en la zona del negocio, `HH:MM:SS`. */
  hora: string;
  duracionMin: number;
  presencial: boolean;
  valorTotal: number;
  nombreMonitor: string;
  nombreMateria: string;
  codigoMateria: string;
  inicio: Date;
  reservaHasta: Date;
  cancelableHasta: Date;
};

/**
 * Una reserva de la sesión, o `null` si no existe o no es suya (las políticas de `monitoria` solo dejan
 * ver las del propio Lead, las del monitor que la dicta y las del admin).
 */
export async function cargarReserva(cliente: Cliente, idMonitoria: string): Promise<Reserva | null> {
  const { data: monitoria, error } = await cliente
    .from("monitoria")
    .select("id, estado, motivo_cancelacion, fecha, valor_total, id_franja, id_monitor, id_materia")
    .eq("id", idMonitoria)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la reserva: ${error.message}`);
  if (!monitoria) return null;

  const [franja, monitor, materia, plazos] = await Promise.all([
    cliente.from("franja").select("hora, duracion_min, presencial").eq("id", monitoria.id_franja).single(),
    cliente.from("monitor").select("nombre").eq("id", monitoria.id_monitor).single(),
    cliente.from("materia").select("nombre, codigo").eq("id", monitoria.id_materia).single(),
    cliente.from("monitoria_plazos").select("inicio, reserva_hasta, cancelable_hasta").eq("id_monitoria", monitoria.id).single(),
  ]);
  const fallo = franja.error ?? monitor.error ?? materia.error ?? plazos.error;
  if (fallo) throw new Error(`No se pudo leer la reserva: ${fallo.message}`);
  const p = plazos.data;
  if (!franja.data || !monitor.data || !materia.data || !p?.inicio || !p.reserva_hasta || !p.cancelable_hasta) {
    throw new Error("La reserva está incompleta.");
  }

  return {
    id: monitoria.id,
    estado: monitoria.estado,
    motivoCancelacion: monitoria.motivo_cancelacion,
    fecha: monitoria.fecha,
    hora: franja.data.hora,
    duracionMin: franja.data.duracion_min,
    presencial: franja.data.presencial,
    valorTotal: monitoria.valor_total,
    nombreMonitor: monitor.data.nombre,
    nombreMateria: materia.data.nombre,
    codigoMateria: materia.data.codigo,
    inicio: new Date(p.inicio),
    reservaHasta: new Date(p.reserva_hasta),
    cancelableHasta: new Date(p.cancelable_hasta),
  };
}
