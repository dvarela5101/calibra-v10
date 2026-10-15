import type { FullConfig } from "@playwright/test";
import { crearClienteAdmin, exigirSupabaseLocal, TOKEN_CAPTCHA_DE_PRUEBA, variable } from "./utilidades";

/**
 * Se corre una vez antes de todas las pruebas (globalSetup en playwright.config.ts):
 *  1. Falla pronto y en claro si falta el Supabase local o si apunta a uno remoto.
 *  2. Comprueba que el Auth local corra con el CAPTCHA de Turnstile y llegue a Cloudflare (HU-058).
 *  3. Comprueba que el Auth local exija confirmar el correo (HU-032).
 *  4. Compila de antemano las rutas de Auth. `next dev` compila cada página en su primera
 *     visita y, en paralelo (móvil y escritorio), esa espera agotaría los tiempos de las pruebas.
 */

const RUTAS = ["/", "/ingresar", "/restablecer", "/restablecer/nueva", "/monitor", "/monitor/agenda", "/admin", "/admin/equipo", "/admin/leads", "/admin/leads/exportar", "/auth/confirmar", "/monitores", "/agendar", "/agendar/contacto", "/agendar/reserva/00000000-0000-4000-8000-000000000000", "/cita", "/admin/pagos/00000000-0000-4000-8000-000000000000", "/admin/pagos/00000000-0000-4000-8000-000000000000/comprobante", "/admin/desembolsos/00000000-0000-4000-8000-000000000000", "/admin/reembolsos/00000000-0000-4000-8000-000000000000", "/admin/reportes/00000000-0000-4000-8000-000000000000", "/reembolso", "/cuenta/crear", "/cuenta/confirmar", "/cuenta/contrasena"];

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

/**
 * HU-032: la cuenta de Estudiante depende de que Auth exija confirmar el correo (`enable_confirmations = true` en
 * supabase/config.toml). Con `mailer_autoconfirm` activo, `updateUser({ email })` convertiría a un anónimo al instante con un
 * correo que nadie confirmó. Auth lee esa configuración al arrancar: un stack levantado antes de esta HU, o con otra rama,
 * falla aquí en claro y no en cada prueba.
 */
async function comprobarConfirmaciones(): Promise<void> {
  const respuesta = await fetch(`${variable("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/settings`, {
    headers: { apikey: variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") },
    signal: AbortSignal.timeout(10_000),
  });
  if (!respuesta.ok) throw new Error(`Auth respondió ${respuesta.status} en /auth/v1/settings.`);
  const { mailer_autoconfirm: autoconfirmar } = (await respuesta.json()) as { mailer_autoconfirm?: boolean };
  if (autoconfirmar !== false) {
    throw new Error(
      "El Auth local no exige confirmar el correo (enable_confirmations = true de supabase/config.toml, HU-032): corre " +
        "npm run db:detener y npm run db:iniciar desde un árbol con esta configuración.",
    );
  }
}

export default async function preparacion(config: FullConfig): Promise<void> {
  exigirSupabaseLocal();
  variable("SUPABASE_SECRET_KEY");
  await comprobar("Supabase Auth", `${variable("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/health`, {
    apikey: variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  });
  await comprobar("Mailpit", `${variable("MAILPIT_URL")}/api/v1/info`);
  await comprobarCaptcha();
  await comprobarConfirmaciones();

  const base = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  await Promise.all(
    RUTAS.map((ruta) =>
      // Un error aquí no es motivo para no probar: solo se pierde el calentamiento.
      fetch(new URL(ruta, base), { signal: AbortSignal.timeout(90_000) }).catch(() => undefined),
    ),
  );
}
