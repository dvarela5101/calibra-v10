import type { NodeOptions } from "@sentry/nextjs";
import { filtrarEvento, filtrarMigaDePan } from "./filtro";

/**
 * Opciones de `Sentry.init` que comparten el servidor, el edge y el navegador (HU-138). Cada punto de entrada lee su propio
 * DSN (`process.env.NEXT_PUBLIC_SENTRY_DSN` solo se incorpora al paquete del navegador si se escribe literal) y solo llama
 * a `init` si hay DSN: sin él, no se inicializa nada y no sale ninguna petición.
 *
 * Privacidad: `dataCollection` apagado (sin usuario, cookies, cabeceras, cuerpos ni variables locales), sin Session Replay (no se registra su integración) y sin trazas de
 * rendimiento (solo errores, para cuidar el cupo gratis). `filtrarEvento` quita lo demás antes de enviar.
 */
export function opcionesDeSentry(origen: { dsn: string; entorno?: string; version?: string }) {
  return {
    dsn: origen.dsn,
    environment: origen.entorno || process.env.NODE_ENV,
    release: origen.version || undefined,
    // En @sentry/nextjs 11 `sendDefaultPii` ya no existe y `dataCollection` recoge casi todo por defecto: se apaga todo.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0,
    maxBreadcrumbs: 20,
    beforeSend: filtrarEvento,
    beforeBreadcrumb: filtrarMigaDePan,
  } satisfies NodeOptions;
}
