/**
 * Reseña individual desde el correo (HU-035, RN-70, RN-72, D-17). Aquí va lo puro: la forma del enlace, la lectura
 * del formulario y los datos del correo. Qué pagos reciben la invitación y si la reseña se puede dejar lo decide la
 * base (un trigger anota la invitación al pasar la monitoría a `realizada`, ver la migración `*_resena_individual.sql`).
 */
import type { DatosPorPlantilla } from "@/lib/correo/plantillas";

/** D-17: la calificación es un entero de 1 a 5. */
export const CALIFICACION_MINIMA = 1;
export const CALIFICACION_MAXIMA = 5;

/** Mismo tope que el `check` de `resena.comentario`. */
export const LARGO_MAXIMO_COMENTARIO = 1000;

/** A dónde lleva el enlace del correo. */
export const RUTA_DE_RESENA = "/resena";

const FORMATO_TOKEN = /^[0-9a-f]{64}$/;

/** Ruta del enlace del correo, para `urlDelSitio`. El token no vence (RN-72). */
export function rutaDeResena(token: string): string {
  return `${RUTA_DE_RESENA}?token=${token}`;
}

/** ¿Tiene forma de token? Lo que no la tiene ni se consulta en la base. */
export function tieneFormaDeTokenDeResena(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_TOKEN.test(valor);
}

/** Lo que muestra la página según la base: si se puede reseñar, o por qué no. */
export type EstadoDeResena = "disponible" | "ya_resenada" | "no_disponible";

export type LecturaDeResena = { ok: true; calificacion: number; comentario: string | null } | { ok: false; error: string };

/**
 * Lee el formulario de la reseña: `calificacion` (entero de 1 a 5, obligatoria) y `comentario` (opcional, se
 * recorta; vacío queda `null`). El largo se cuenta en caracteres, como `char_length` de la base.
 */
export function validarResena(formulario: FormData): LecturaDeResena {
  const texto = String(formulario.get("calificacion") ?? "").trim();
  if (!/^\d+$/.test(texto)) return { ok: false, error: `Elige una calificación de ${CALIFICACION_MINIMA} a ${CALIFICACION_MAXIMA}.` };
  const calificacion = Number(texto);
  if (calificacion < CALIFICACION_MINIMA || calificacion > CALIFICACION_MAXIMA) {
    return { ok: false, error: `La calificación va de ${CALIFICACION_MINIMA} a ${CALIFICACION_MAXIMA}.` };
  }
  const comentario = String(formulario.get("comentario") ?? "").trim();
  if ([...comentario].length > LARGO_MAXIMO_COMENTARIO) {
    return { ok: false, error: `El comentario puede tener hasta ${LARGO_MAXIMO_COMENTARIO} caracteres.` };
  }
  return { ok: true, calificacion, comentario: comentario || null };
}

/** Lo que devuelve `public.datos_de_invitacion_resena`. Del Lead, el nombre y el correo para escribirle. */
export type DatosDeInvitacion = {
  token: string;
  /** Monitoría realizada, individual, pago no rechazado y sin reseña. */
  disponible: boolean;
  correoLead: string;
  nombreLead: string;
  nombreMonitor: string;
};

export function datosDeResenaIndividual(d: DatosDeInvitacion, enlace: string): DatosPorPlantilla["resena_individual"] {
  return { nombre: d.nombreLead, monitor: d.nombreMonitor, enlace };
}
