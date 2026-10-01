/**
 * Agendar una monitoría individual (HU-017). Aquí va lo puro: leer el pedido del enlace, las rutas y qué
 * se le dice a la persona con cada resultado. Si la fecha se puede apartar lo decide la base
 * (`public.agendar_monitoria`), con la misma regla con que la lista de HU-016 muestra las fechas libres.
 */
import { cancelableHasta, dentroDePlazo } from "@/lib/plazos/motor";
import type { ParametrosNegocio } from "@/lib/plazos/parametros";

export const RUTA_AGENDAR = "/agendar";

/** Lo que trae el enlace de una fecha de la lista: la franja, el día y la materia. */
export type PedidoDeAgendar = { idFranja: string; fecha: string; codigoMateria: string };

/** Lo que responde `public.agendar_monitoria` (ver su migración). */
export const RESULTADOS = [
  "agendada",
  "ya_agendada",
  "reserva_pendiente",
  "confirmar_sin_cancelacion",
  "sin_antelacion",
  "ocupada",
  "no_disponible",
  "no_es_lead",
  "sin_sesion",
] as const;
export type ResultadoDeAgendar = (typeof RESULTADOS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LARGO_MAXIMO_CODIGO = 50;

/** Un id de la base (uuid). */
export function esUuid(valor: string): boolean {
  return UUID.test(valor);
}

const primero = (valor: unknown): string => String((Array.isArray(valor) ? valor[0] : valor) ?? "").trim();

/** `AAAA-MM-DD` que existe en el calendario (2026-02-30 no). */
export function esFechaDeCalendario(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const instante = new Date(`${texto}T12:00:00Z`);
  return !Number.isNaN(instante.getTime()) && instante.toISOString().slice(0, 10) === texto;
}

/**
 * El pedido de `?franja=…&fecha=…&materia=…` (o de los campos del formulario con esos nombres). `null` si
 * falta algo o no tiene forma: la franja es un uuid, la fecha un día que existe y la materia un código.
 */
export function leerPedidoDeAgendar(valores: { franja?: unknown; fecha?: unknown; materia?: unknown }): PedidoDeAgendar | null {
  const idFranja = primero(valores.franja).toLowerCase();
  const fecha = primero(valores.fecha);
  const codigoMateria = primero(valores.materia);
  if (!esUuid(idFranja) || !esFechaDeCalendario(fecha)) return null;
  if (!codigoMateria || codigoMateria.length > LARGO_MAXIMO_CODIGO || /[\u0000-\u001f\u007f]/.test(codigoMateria)) return null;
  return { idFranja, fecha, codigoMateria };
}

/** La página para confirmar una fecha de la lista. */
export function rutaDeAgendar(pedido: PedidoDeAgendar): string {
  const consulta = new URLSearchParams({ franja: pedido.idFranja, fecha: pedido.fecha, materia: pedido.codigoMateria });
  return `${RUTA_AGENDAR}?${consulta}`;
}

/** La reserva ya apartada (la misma página donde HU-018 pondrá el pago). */
export function rutaDeReserva(idMonitoria: string): string {
  return `${RUTA_AGENDAR}/reserva/${encodeURIComponent(idMonitoria)}`;
}

/** Antes de reservar, quien no es Lead deja su contacto (D-3, HU-068) y vuelve aquí. */
export function rutaDeContactoParaAgendar(pedido: PedidoDeAgendar): string {
  return `${RUTA_AGENDAR}/contacto?${new URLSearchParams({ siguiente: rutaDeAgendar(pedido) })}`;
}

/**
 * RN-37 y P-40: con menos de 12 h hasta el inicio ya no se podrá cancelar (con 12 h exactas todavía sí),
 * así que se avisa y hace falta la casilla (D-10). La base decide lo mismo al reservar.
 */
export function requiereAvisoSinCancelacion(inicio: Date, ahora: Date, p: ParametrosNegocio): boolean {
  return !dentroDePlazo(cancelableHasta(inicio, false, p), ahora);
}

export const TEXTO_CASILLA_SIN_CANCELACION = "Entiendo que no podré cancelarla";

/** Qué se le dice a la persona cuando la base no apartó la fecha. */
export const MENSAJES: Record<Exclude<ResultadoDeAgendar, "agendada" | "ya_agendada" | "no_es_lead">, string> = {
  reserva_pendiente: "Ya tienes una reserva por pagar. Termínala o espera a que venza para apartar otra fecha.",
  confirmar_sin_cancelacion: `Faltan menos de 12 horas para esta monitoría y no podrás cancelarla. Si quieres apartarla, marca "${TEXTO_CASILLA_SIN_CANCELACION}".`,
  sin_antelacion: "Faltan menos de 3 horas para esta monitoría y ya no se puede agendar. Elige otra fecha.",
  ocupada: "Alguien acaba de apartar esta fecha. Elige otra.",
  no_disponible: "Esta fecha ya no está disponible. Elige otra.",
  sin_sesion: "No encontramos tu sesión. Recarga la página e intenta de nuevo.",
};

export function esResultadoDeAgendar(valor: unknown): valor is ResultadoDeAgendar {
  return typeof valor === "string" && (RESULTADOS as readonly string[]).includes(valor);
}
