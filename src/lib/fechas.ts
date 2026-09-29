import { LOCALE, ZONA_HORARIA_NEGOCIO } from "@/config/regional";

const formatoFechaHora = new Intl.DateTimeFormat(LOCALE, {
  timeZone: ZONA_HORARIA_NEGOCIO,
  dateStyle: "full",
  timeStyle: "short",
});

/** Fecha y hora legibles en español, siempre en la zona del negocio. */
export function formatearFechaHora(instante: Date): string {
  return formatoFechaHora.format(instante);
}
