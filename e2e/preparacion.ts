import type { FullConfig } from "@playwright/test";
import { exigirSupabaseLocal, variable } from "./utilidades";

/**
 * Se corre una vez antes de todas las pruebas (globalSetup en playwright.config.ts):
 *  1. Falla pronto y en claro si falta el Supabase local o si apunta a uno remoto.
 *  2. Compila de antemano las rutas de Auth. `next dev` compila cada página en su primera
 *     visita y, en paralelo (móvil y escritorio), esa espera agotaría los tiempos de las pruebas.
 */

const RUTAS = ["/", "/ingresar", "/restablecer", "/restablecer/nueva", "/monitor", "/admin", "/auth/confirmar", "/monitores"];

async function comprobar(nombre: string, url: string, cabeceras: Record<string, string> = {}): Promise<void> {
  const respuesta = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(10_000) }).catch((error: unknown) => {
    throw new Error(`${nombre} no responde en ${url}: ${String(error)}. ¿Está corriendo? (npm run db:iniciar)`);
  });
  if (!respuesta.ok) throw new Error(`${nombre} respondió ${respuesta.status} en ${url}.`);
}

export default async function preparacion(config: FullConfig): Promise<void> {
  exigirSupabaseLocal();
  variable("SUPABASE_SECRET_KEY");
  await comprobar("Supabase Auth", `${variable("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/health`, {
    apikey: variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  });
  await comprobar("Mailpit", `${variable("MAILPIT_URL")}/api/v1/info`);

  const base = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  await Promise.all(
    RUTAS.map((ruta) =>
      // Un error aquí no es motivo para no probar: solo se pierde el calentamiento.
      fetch(new URL(ruta, base), { signal: AbortSignal.timeout(90_000) }).catch(() => undefined),
    ),
  );
}
