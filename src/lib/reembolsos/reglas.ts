/**
 * Lo puro de los reembolsos que arranca HU-024 (D-26, D-27): la ruta de la página donde la persona da su llave y
 * los textos fijos con que se explica el reembolso al cancelar. La página la construye HU-025 (hasta entonces el
 * enlace da 404); el token vive en `solicitud_llave` y es uno por reembolso, lo cree quien lo cree (HU-024, P-07,
 * HU-030). Aquí no hay cifras de comisión: el reembolso es siempre el valor completo del pago.
 */

/** La página de la llave (HU-025) y la base del enlace del correo. */
export const RUTA_DE_LLAVE = "/reembolso";

const FORMATO_TOKEN = /^[0-9a-f]{64}$/;

/** Ruta del enlace del correo que pide la llave, para `urlDelSitio`. */
export function rutaDeLlave(token: string): string {
  return `${RUTA_DE_LLAVE}?token=${token}`;
}

/** ¿Tiene forma de token de llave (64 hexadecimales en minúscula)? Lo que no la tiene ni se consulta en la base. */
export function tieneFormaDeTokenDeLlave(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_TOKEN.test(valor);
}

/** El motivo del reembolso que crea una cancelación a tiempo del estudiante (D-26). Se guarda en `reembolso.motivo`. */
export const MOTIVO_CANCELACION_A_TIEMPO = "Cancelaste la monitoría dentro del plazo.";

/**
 * Qué se le dice a quien cancela con un pago todavía en revisión (D-27, P-07): el reembolso depende de que el admin
 * lo apruebe. Lo usan el correo de cancelación y la página de la cita.
 */
export const TEXTO_PAGO_EN_REVISION_AL_CANCELAR =
  "Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.";
