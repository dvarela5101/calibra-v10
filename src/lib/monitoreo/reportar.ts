import * as Sentry from "@sentry/nextjs";

/**
 * HU-138: envía a Sentry el error que muestran `error.tsx` y `global-error.tsx`. Sin DSN el SDK no está inicializado y no hace
 * nada. El mensaje y la pila pasan por el filtro de privacidad en `beforeSend`.
 */
export function reportarError(error: unknown): void {
  Sentry.captureException(error);
}
