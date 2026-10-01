/**
 * Avisos por correo al monitor (HU-051, D-16). Aquí va lo puro: qué aviso sigue valiendo y qué datos lleva el
 * correo. Qué monitorías se avisan lo decide la base (un trigger anota el aviso al cambiar el estado, ver la
 * migración `*_avisos_al_monitor.sql`).
 */
import type { DatosPorPlantilla } from "@/lib/correo/plantillas";

export const EVENTOS_DE_AVISO = ["confirmada", "cancelada"] as const;
export type EventoDeAviso = (typeof EVENTOS_DE_AVISO)[number];

export function esEventoDeAviso(valor: unknown): valor is EventoDeAviso {
  return typeof valor === "string" && (EVENTOS_DE_AVISO as readonly string[]).includes(valor);
}

/** A dónde lleva el botón del correo: la agenda del monitor (HU-021). */
export const RUTA_DE_LA_AGENDA = "/monitor/agenda";

/** Lo que devuelve `public.datos_de_aviso_monitor`. Del estudiante, solo el nombre (P-37). */
export type DatosDeAviso = {
  estado: "pendiente_pago" | "confirmada" | "realizada" | "cancelada";
  motivoCancelacion: string | null;
  grupal: boolean;
  correoMonitor: string;
  nombreMonitor: string;
  nombreEstudiante: string;
  nombreMateria: string;
  /** Instante ISO del inicio de la sesión. */
  inicio: string;
  duracionMin: number;
  presencial: boolean;
};

/**
 * ¿Todavía se manda el aviso? Se pregunta al procesarlo y al reintentarlo (HU-065), porque entre que se anotó y
 * que sale el correo la monitoría pudo cambiar:
 *  - confirmada: solo si sigue confirmada. Si el estudiante ya la canceló, sale solo el aviso de cancelación;
 *    si ya se realizó, el aviso llegaría tarde.
 *  - cancelada: si la canceló el estudiante (una cancelada no cambia más).
 * Nunca para una grupal (sus avisos llegan con sus HUs) ni para una sesión que ya empezó: el aviso llegaría tarde
 * (pasa si el aviso se procesa con retraso, por ejemplo antes de configurar Vault en el corte).
 */
export function avisoVigente(
  evento: EventoDeAviso,
  d: Pick<DatosDeAviso, "estado" | "motivoCancelacion" | "grupal" | "inicio">,
  ahora: Date,
): boolean {
  if (d.grupal || new Date(d.inicio).getTime() <= ahora.getTime()) return false;
  if (evento === "confirmada") return d.estado === "confirmada";
  return d.estado === "cancelada" && d.motivoCancelacion === "estudiante";
}

export function datosDeConfirmada(d: DatosDeAviso, enlace: string): DatosPorPlantilla["aviso_monitor_confirmada"] {
  return {
    nombreMonitor: d.nombreMonitor,
    nombreEstudiante: d.nombreEstudiante,
    materia: d.nombreMateria,
    inicio: d.inicio,
    duracionMin: d.duracionMin,
    presencial: d.presencial,
    enlace,
  };
}

export function datosDeCancelada(d: DatosDeAviso, enlace: string): DatosPorPlantilla["aviso_monitor_cancelada"] {
  return { nombreMonitor: d.nombreMonitor, nombreEstudiante: d.nombreEstudiante, materia: d.nombreMateria, inicio: d.inicio, enlace };
}
