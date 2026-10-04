/** Script de Cloudflare Turnstile en modo de renderizado explícito (nosotros decidimos cuándo y dónde se dibuja). */
export const URL_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Cuánto esperar a que el script de Cloudflare cargue antes de darlo por caído. */
export const ESPERA_DEL_SCRIPT_MS = 10_000;

/** Plazo total para recibir un token una vez dibujado el widget (se suspende mientras la persona resuelve un reto). */
export const ESPERA_DEL_TOKEN_MS = 20_000;

/**
 * Llave de sitio de Turnstile. Es pública por diseño: llega al navegador.
 * Sin ella (variable ausente o en blanco) no hay CAPTCHA en el cliente y la sesión anónima
 * se pide sin token, como antes de HU-058.
 */
export function llaveDeSitioTurnstile(): string | null {
  // Referencia literal: Next la reemplaza al compilar.
  const llave = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return llave ? llave : null;
}
