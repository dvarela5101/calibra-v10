/**
 * La agenda del monitor (HU-021) y finalizar una sesión (HU-023). Aquí va lo puro: separar por finalizar,
 * próximas y pasadas, y qué se dice de cada estado. Qué monitorías son suyas, el nombre de quien agendó y el estado del pago los da la base
 * (`public.mi_agenda`), sin contacto del estudiante ni cifras (P-37, P-24).
 */
import { cierreAutomaticoDesde, finProgramado, plazoAlcanzado } from "@/lib/plazos/motor";
import type { ParametrosNegocio } from "@/lib/plazos/parametros";

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

export type Agenda = { porFinalizar: MonitoriaDeAgenda[]; proximas: MonitoriaDeAgenda[]; pasadas: MonitoriaDeAgenda[] };

/**
 * D-13 (HU-023): una confirmada se puede finalizar desde su inicio; con la hora exacta ya se puede (P-40).
 * La base decide lo mismo al finalizar (`public.finalizar_monitoria`).
 */
export function sePuedeFinalizar(m: Pick<MonitoriaDeAgenda, "estado" | "inicio">, ahora: Date): boolean {
  return m.estado === "confirmada" && plazoAlcanzado(m.inicio, ahora);
}

/**
 * Por finalizar: confirmadas que ya empezaron (HU-023, D-13), de la más antigua a la más reciente. Próximas:
 * confirmadas que no han empezado y pendientes de pago vigentes, de la más cercana a la más lejana. Pasadas:
 * realizadas, canceladas y reservas vencidas (D-12), de la más reciente a la más antigua.
 */
export function separarAgenda(monitorias: MonitoriaDeAgenda[], ahora: Date): Agenda {
  const porInicio = (a: MonitoriaDeAgenda, b: MonitoriaDeAgenda) => a.inicio.getTime() - b.inicio.getTime() || a.idMonitoria.localeCompare(b.idMonitoria);
  const porFinalizar = monitorias.filter((m) => sePuedeFinalizar(m, ahora));
  const proximas = monitorias.filter(
    (m) => (m.estado === "confirmada" && !sePuedeFinalizar(m, ahora)) || (m.estado === "pendiente_pago" && !m.reservaVencida),
  );
  const pasadas = monitorias.filter((m) => !porFinalizar.includes(m) && !proximas.includes(m));
  return {
    porFinalizar: porFinalizar.sort(porInicio),
    proximas: proximas.sort(porInicio),
    pasadas: pasadas.sort((a, b) => porInicio(b, a)),
  };
}

/** Desde cuándo se cierra sola una individual sin finalizar (P-05, D-14): fin programado + cierre automático. */
export function cierreAutomaticoDe(m: Pick<MonitoriaDeAgenda, "inicio" | "duracionMin">, p: ParametrosNegocio): Date {
  return cierreAutomaticoDesde(finProgramado(m.inicio, m.duracionMin), p);
}

/** Lo que responde `public.finalizar_monitoria` (ver su migración). */
export const RESULTADOS_DE_FINALIZAR = ["finalizada", "ya_finalizada", "no_empezo", "no_confirmada", "no_encontrada", "sin_sesion"] as const;
export type ResultadoDeFinalizar = (typeof RESULTADOS_DE_FINALIZAR)[number];

export function esResultadoDeFinalizar(valor: unknown): valor is ResultadoDeFinalizar {
  return typeof valor === "string" && (RESULTADOS_DE_FINALIZAR as readonly string[]).includes(valor);
}

/** Qué se le dice al monitor cuando no se pudo finalizar. */
export const MENSAJES_DE_FINALIZAR: Record<Exclude<ResultadoDeFinalizar, "finalizada" | "ya_finalizada">, string> = {
  no_empezo: "Esa monitoría todavía no empieza: podrás finalizarla desde su hora de inicio.",
  no_confirmada: "Esa monitoría no está confirmada, así que no hay sesión que finalizar.",
  no_encontrada: "No encontramos esa monitoría en tu agenda.",
  sin_sesion: "Tu sesión terminó. Vuelve a entrar e intenta de nuevo.",
};

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
