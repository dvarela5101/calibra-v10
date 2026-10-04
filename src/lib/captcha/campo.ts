/*
 * El token de Turnstile viaja del navegador a las acciones del servidor en un campo oculto del formulario
 * (HU-058, D-30). Este módulo no toca `window`: lo importan tanto los componentes de cliente como las acciones.
 */

/** Nombre del `<input type="hidden">` que lleva el token en los formularios de cuentas. */
export const CAMPO_TOKEN_CAPTCHA = "captcha_token";

/** Largo máximo del token que se acepta del formulario (Turnstile documenta tokens de hasta 2048 caracteres). */
const LARGO_MAXIMO_TOKEN = 2048;

/**
 * El token que trae el formulario, o `undefined` si viene vacío o ausente (sin llave de sitio, widget caído):
 * así no se manda `captchaToken: ""` a Auth, que lo trataría como un token inválido en vez de como ausente.
 * Tampoco se manda lo que no es texto (un archivo) ni lo que pasa de `LARGO_MAXIMO_TOKEN` caracteres.
 */
export function leerTokenCaptcha(datos: FormData): string | undefined {
  const valor = datos.get(CAMPO_TOKEN_CAPTCHA);
  if (typeof valor !== "string" || valor.length > LARGO_MAXIMO_TOKEN) return undefined;
  return valor.trim() || undefined;
}
