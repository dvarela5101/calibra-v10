import type { FullConfig } from "@playwright/test";
import { crearClienteAdmin, exigirSupabaseLocal, TOKEN_CAPTCHA_DE_PRUEBA, variable } from "./utilidades";

/**
 * Se corre una vez antes de todas las pruebas (globalSetup en playwright.config.ts):
 *  1. Falla pronto y en claro si falta el Supabase local o si apunta a uno remoto.
 *  2. Comprueba que el Auth local corra con el CAPTCHA de Turnstile y llegue a Cloudflare (HU-058).
 *  3. Compila de antemano las rutas de Auth. `next dev` compila cada página en su primera
 *     visita y, en paralelo (móvil y escritorio), esa espera agotaría los tiempos de las pruebas.
 */

const RUTAS = ["/", "/ingresar", "/restablecer", "/restablecer/nueva", "/monitor", "/monitor/agenda", "/admin", "/admin/equipo", "/auth/confirmar", "/monitores", "/agendar", "/agendar/contacto", "/agendar/reserva/00000000-0000-4000-8000-000000000000", "/cita"];

async function comprobar(nombre: string, url: string, cabeceras: Record<string, string> = {}): Promise<void> {
  const respuesta = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(10_000) }).catch((error: unknown) => {
    throw new Error(`${nombre} no responde en ${url}: ${String(error)}. ¿Está corriendo? (npm run db:iniciar)`);
  });
  if (!respuesta.ok) throw new Error(`${nombre} respondió ${respuesta.status} en ${url}.`);
}

/**
 * HU-058: el alta anónima sin token debe dar 400 (el stack corre con `[auth.captcha]` encendido) y con el token de
 * prueba debe dar 200 (el Auth local llega a challenges.cloudflare.com y su llave secreta es la de prueba). Un stack
 * levantado con `npx supabase start` a secas, o antes de traer esta HU, falla aquí en claro y no en cada prueba.
 */
async function comprobarCaptcha(): Promise<void> {
  const url = `${variable("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/signup`;
  const cabeceras = { apikey: variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), "Content-Type": "application/json" };
  const alta = (cuerpo: object) =>
    fetch(url, { method: "POST", headers: cabeceras, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(15_000) });

  const sinToken = await alta({ data: {} });
  if (sinToken.status === 200) {
    // El alta salió: no deja un usuario anónimo suelto.
    const { user } = (await sinToken.json()) as { user?: { id: string } };
    if (user) await crearClienteAdmin().auth.admin.deleteUser(user.id);
    throw new Error("El stack corre sin CAPTCHA: corre npm run db:detener y npm run db:iniciar.");
  }
  if (sinToken.status !== 400) throw new Error(`El alta anónima sin token respondió ${sinToken.status} y se esperaba 400 (captcha_failed).`);

  const conToken = await alta({ data: {}, gotrue_meta_security: { captcha_token: TOKEN_CAPTCHA_DE_PRUEBA } });
  if (conToken.status !== 200) {
    throw new Error(
      `El alta anónima con el token de prueba respondió ${conToken.status}: el Auth local no llega a challenges.cloudflare.com ` +
        "o la llave secreta no es la de prueba (corre npm run db:detener y npm run db:iniciar).",
    );
  }
  const { user } = (await conToken.json()) as { user?: { id: string } };
  if (user) await crearClienteAdmin().auth.admin.deleteUser(user.id);
}

export default async function preparacion(config: FullConfig): Promise<void> {
  exigirSupabaseLocal();
  variable("SUPABASE_SECRET_KEY");
  await comprobar("Supabase Auth", `${variable("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/health`, {
    apikey: variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  });
  await comprobar("Mailpit", `${variable("MAILPIT_URL")}/api/v1/info`);
  await comprobarCaptcha();

  const base = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  await Promise.all(
    RUTAS.map((ruta) =>
      // Un error aquí no es motivo para no probar: solo se pierde el calentamiento.
      fetch(new URL(ruta, base), { signal: AbortSignal.timeout(90_000) }).catch(() => undefined),
    ),
  );
}
