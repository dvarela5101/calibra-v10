import * as Sentry from "@sentry/nextjs";
import { opcionesDeSentry } from "@/lib/monitoreo/opciones";

// HU-138: runtime edge. `instrumentation.ts` lo carga solo si hay código en edge. Sin `SENTRY_DSN` no se inicializa nada.
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init(opcionesDeSentry({ dsn, entorno: process.env.VERCEL_ENV, version: process.env.VERCEL_GIT_COMMIT_SHA }));
}
