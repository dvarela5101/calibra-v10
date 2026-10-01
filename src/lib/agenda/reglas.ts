/**
 * La agenda del monitor (HU-021). Aquí va lo puro: separar próximas de pasadas y qué se dice de cada
 * estado. Qué monitorías son suyas, el nombre de quien agendó y el estado del pago los da la base
 * (`public.mi_agenda`), sin contacto del estudiante ni cifras (P-37, P-24).
 */

export type EstadoMonitoria = "pendiente_pago" | "confirmada" | "realizada" | "cancelada";
export type MotivoCancelacion = "reserva_expirada" | "pago_rechazado" | "estudiante" | "monitor_no_asistio" | "diferencia_no_cubierta";
/** D-11: rechazado si algún comprobante lo fue, si no en revisión, si no aprobado; sin comprobantes, sin pagar. */
export type EstadoPago = "sin_pagar" | "en_revision" | "aprobado" | "rechazado";

export type MonitoriaDeAgenda = {
  idMonitoria: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  /** `HH:MM:SS`, en la zona del negocio. */
  hora: string;
  duracionMin: number;
  presencial: boolean;
  nombreMateria: string;
  codigoMateria: string;
  nombreEstudiante: string;
  estado: EstadoMonitoria;
  motivoCancelacion: MotivoCancelacion | null;
  /** Pendiente de pago con la reserva de 10 minutos ya vencida (RN-34). */
  reservaVencida: boolean;
  estadoPago: EstadoPago;
  inicio: Date;
};

export type Agenda = { proximas: MonitoriaDeAgenda[]; pasadas: MonitoriaDeAgenda[] };

/**
 * Próximas: pendientes de pago vigentes y confirmadas, de la más cercana a la más lejana. Pasadas:
 * realizadas, canceladas y reservas vencidas (D-12), de la más reciente a la más antigua.
 */
export function separarAgenda(monitorias: MonitoriaDeAgenda[]): Agenda {
  const esProxima = (m: MonitoriaDeAgenda) => m.estado === "confirmada" || (m.estado === "pendiente_pago" && !m.reservaVencida);
  const porInicio = (a: MonitoriaDeAgenda, b: MonitoriaDeAgenda) => a.inicio.getTime() - b.inicio.getTime() || a.idMonitoria.localeCompare(b.idMonitoria);
  return {
    proximas: monitorias.filter(esProxima).sort(porInicio),
    pasadas: monitorias.filter((m) => !esProxima(m)).sort((a, b) => porInicio(b, a)),
  };
}

const MOTIVOS: Record<MotivoCancelacion, string> = {
  reserva_expirada: "La reserva venció sin pago",
  pago_rechazado: "El pago fue rechazado",
  estudiante: "La canceló el estudiante",
  monitor_no_asistio: "Se aceptó un reporte de inasistencia",
  diferencia_no_cubierta: "No se cubrió la diferencia de la grupal",
};

/** Qué estado se muestra de la monitoría, con el motivo si se canceló. */
export function textoDeEstado(m: Pick<MonitoriaDeAgenda, "estado" | "motivoCancelacion" | "reservaVencida">): string {
  switch (m.estado) {
    case "pendiente_pago":
      return m.reservaVencida ? "Reserva vencida: no llegó el pago a tiempo" : "Reservada, esperando el pago";
    case "confirmada":
      return "Confirmada";
    case "realizada":
      return "Realizada";
    case "cancelada":
      return m.motivoCancelacion ? `Cancelada: ${MOTIVOS[m.motivoCancelacion].toLowerCase()}` : "Cancelada";
  }
}

const PAGOS: Record<EstadoPago, string> = {
  sin_pagar: "Sin pagar",
  en_revision: "Pago en revisión",
  aprobado: "Pago aprobado",
  rechazado: "Pago rechazado",
};

/** El estado del pago (P-24), sin cifras. */
export function textoDePago(estado: EstadoPago): string {
  return PAGOS[estado];
}

export function esEstadoPago(valor: unknown): valor is EstadoPago {
  return typeof valor === "string" && Object.hasOwn(PAGOS, valor);
}
