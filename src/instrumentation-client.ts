import * as Sentry from "@sentry/nextjs";
import { opcionesDeSentry } from "@/lib/monitoreo/opciones";

// HU-138: navegador. Sin `NEXT_PUBLIC_SENTRY_DSN` no se inicializa nada. Cada variable se escribe literal para que Next la
// incorpore al compilar; el entorno y la versión los pone `next.config.ts` desde las variables del despliegue de Vercel.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    ...opcionesDeSentry({
      dsn,
      entorno: process.env.NEXT_PUBLIC_SENTRY_ENTORNO,
      version: process.env.NEXT_PUBLIC_SENTRY_VERSION,
    }),
    // Sin la integración de trazas de navegación: solo se envían errores.
    integrations: (predeterminadas) => predeterminadas.filter((integracion) => integracion.name !== "BrowserTracing"),
  });
}
