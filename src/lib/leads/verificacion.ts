import { createHash, randomBytes } from "node:crypto";

/**
 * Enlace de verificación del correo de un Lead (P-23, HU-068). Como la invitación de monitor (HU-013):
 * el token son 256 bits aleatorios en hex que viajan solo en el correo, y la base guarda su SHA-256
 * (`verificacion_lead.token_hash`). Vence a las 24 horas: el vencimiento lo pone la base (`vence_en`),
 * aquí solo se muestra.
 */
export const HORAS_DE_VIGENCIA = 24;

export const RUTA_VERIFICACION = "/contacto/verificar";

/** Cuántos enlaces se mandan como máximo a un mismo Lead en una hora: frena que alguien llene su buzón. */
export const MAXIMO_DE_ENLACES_POR_HORA = 3;

const FORMATO_TOKEN = /^[0-9a-f]{64}$/;

export function generarToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashDeToken(token) };
}

export function hashDeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** ¿Tiene forma de token? Lo que no la tiene ni se consulta en la base. */
export function tieneFormaDeToken(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_TOKEN.test(valor);
}

/** Ruta del enlace del correo, para `urlDelSitio`. */
export function rutaDeVerificacion(token: string): string {
  return `${RUTA_VERIFICACION}?token=${token}`;
}
