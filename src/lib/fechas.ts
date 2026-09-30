import { LOCALE, ZONA_HORARIA_NEGOCIO } from "@/config/regional";

const formatoFechaHora = new Intl.DateTimeFormat(LOCALE, {
  timeZone: ZONA_HORARIA_NEGOCIO,
  dateStyle: "full",
  timeStyle: "short",
});

/**
 * Fecha y hora legibles en español, siempre en la zona del negocio. La hora y su "a. m." o "p. m." van
 * unidas con espacios duros para que un renglón no se corte entre "a." y "m.".
 */
export function formatearFechaHora(instante: Date): string {
  // Según la versión de ICU el separador es un espacio normal, duro o fino: siempre se deja uno duro.
  return formatoFechaHora.format(instante).replace(/(\d)\s([ap])\.\s([mM])\./, "$1\xa0$2.\xa0$3.");
}

// Un día de calendario no tiene zona: se formatea en UTC sobre el mediodía para que ninguna zona lo corra de día.
const formatoDia = new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", dateStyle: "long" });

/** Un día de calendario (`AAAA-MM-DD`, como lo guarda la base) legible en español: `6 de enero de 2020`. */
export function formatearDia(fecha: string): string {
  const instante = new Date(`${fecha}T12:00:00Z`);
  // El chequeo de ida y vuelta rechaza días que no existen (2026-02-30), que Date rueda al mes siguiente.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(instante.getTime()) || instante.toISOString().slice(0, 10) !== fecha) {
    throw new RangeError(`La fecha debe ser AAAA-MM-DD (llegó "${fecha}").`);
  }
  return formatoDia.format(instante);
}

const formatoDiaDelNegocio = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** El día de calendario (`AAAA-MM-DD`) de un instante en la zona del negocio, no en la del servidor. */
export function diaDelNegocio(instante: Date): string {
  // Por partes, sin depender de cómo ordene la fecha el formato de "en-CA".
  const partes = Object.fromEntries(formatoDiaDelNegocio.formatToParts(instante).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

