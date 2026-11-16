import * as Sentry from "@sentry/nextjs";

// HU-138: monitoreo de errores. Sin `SENTRY_DSN`, los archivos de configuración no inicializan el SDK y `onRequestError`
// no hace nada. El proxy corre en Node (Next 16), así que lo cubre la configuración del servidor.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Errores de componentes de servidor, rutas, acciones y proxy.
export const onRequestError = Sentry.captureRequestError;
