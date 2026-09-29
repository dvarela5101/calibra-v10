import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { test as base, expect, type BrowserContext, type Cookie, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Utilidades de las pruebas de punta a punta que tocan Auth. Todo corre contra el
 * Supabase LOCAL (llaves en .env.local, que playwright.config.ts carga). Las cuentas
 * las crea y las borra cada prueba; ninguna contraseña queda escrita en el repo.
 */

// ---------------------------------------------------------------------------
// Entorno
// ---------------------------------------------------------------------------

export function variable(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta ${nombre}. Levanta el Supabase local (npm run db:iniciar) y corre npm run db:env.`);
  }
  return valor;
}

/** Las pruebas crean y borran usuarios: jamás deben apuntar a un proyecto remoto. */
export function exigirSupabaseLocal(): void {
  const { hostname } = new URL(variable("NEXT_PUBLIC_SUPABASE_URL"));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    throw new Error(`Las pruebas e2e solo corren contra el Supabase local; NEXT_PUBLIC_SUPABASE_URL apunta a ${hostname}.`);
  }
}

export function crearClienteAdmin(): SupabaseClient {
  exigirSupabaseLocal();
  return createClient(variable("NEXT_PUBLIC_SUPABASE_URL"), variable("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

export type Cuenta = { id: string; correo: string; contrasena: string; nombre: string };

export function correoUnico(): string {
  return `e2e-${randomUUID()}@calibra.test`;
}

export function contrasenaAleatoria(): string {
  return randomBytes(18).toString("base64url");
}

function sufijo(): string {
  return randomBytes(3).toString("hex");
}

// ---------------------------------------------------------------------------
// Sesión de Supabase en las cookies
// ---------------------------------------------------------------------------

export type SesionEnCookie = { id: string; esAnonimo: boolean; tokenDeAcceso: string };

// sb-<proyecto>-auth-token, o partida en sb-<proyecto>-auth-token.0, .1, ...
const COOKIE_DE_SESION = /^sb-.+-auth-token(?:\.(\d+))?$/;

export function cookiesDeSesion(cookies: Cookie[]): Cookie[] {
  const trozo = (cookie: Cookie) => Number(COOKIE_DE_SESION.exec(cookie.name)?.[1] ?? -1);
  return cookies.filter((cookie) => COOKIE_DE_SESION.test(cookie.name)).sort((a, b) => trozo(a) - trozo(b));
}

/** Lee el id y el tipo de usuario de la cookie de sesión; null si no hay sesión. */
export function leerSesion(cookies: Cookie[]): SesionEnCookie | null {
  const trozos = cookiesDeSesion(cookies);
  if (trozos.length === 0) return null;
  try {
    const bruto = decodeURIComponent(trozos.map((trozo) => trozo.value).join(""));
    const json = bruto.startsWith("base64-") ? Buffer.from(bruto.slice("base64-".length), "base64url").toString("utf8") : bruto;
    const datos = JSON.parse(json) as { access_token: string; user: { id: string; is_anonymous?: boolean } };
    return { id: datos.user.id, esAnonimo: datos.user.is_anonymous === true, tokenDeAcceso: datos.access_token };
  } catch {
    return null;
  }
}

/** Espera a que el navegador reciba la cookie de sesión (la sesión anónima nace en el cliente). */
export async function esperarSesion(context: BrowserContext): Promise<SesionEnCookie> {
  let sesion: SesionEnCookie | null = null;
  await expect
    .poll(
      async () => {
        sesion = leerSesion(await context.cookies());
        return sesion !== null;
      },
      { message: "el navegador debía recibir la cookie de sesión", timeout: 20_000 },
    )
    .toBe(true);
  return sesion!;
}

// ---------------------------------------------------------------------------
// Formulario de ingreso
// ---------------------------------------------------------------------------

/** Escribe las credenciales en /ingresar (donde esté la página) y pulsa Entrar. */
export async function enviarCredenciales(page: Page, correo: string, contrasena: string): Promise<void> {
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña").fill(contrasena);
  await page.getByRole("button", { name: "Entrar" }).click();
}

// ---------------------------------------------------------------------------
// Mailpit (el buzón del Supabase local)
// ---------------------------------------------------------------------------

export type CorreoRecibido = { id: string; asunto: string; html: string };

/** Espera con reintentos a que llegue el primer correo para `destinatario`. */
export async function esperarCorreo(destinatario: string): Promise<CorreoRecibido> {
  const mailpit = variable("MAILPIT_URL");
  let resumen: { ID: string; Subject: string } | undefined;
  await expect
    .poll(
      async () => {
        const respuesta = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${destinatario}"`)}`);
        const { messages } = (await respuesta.json()) as { messages?: { ID: string; Subject: string }[] };
        resumen = messages?.[0];
        return resumen !== undefined;
      },
      { message: `debía llegar un correo a ${destinatario}`, timeout: 30_000, intervals: [250, 500, 1_000] },
    )
    .toBe(true);

  const detalle = (await (await fetch(`${mailpit}/api/v1/message/${resumen!.ID}`)).json()) as { HTML: string };
  return { id: resumen!.ID, asunto: resumen!.Subject, html: detalle.HTML };
}

/** El enlace de /auth/confirmar del correo, con los `&amp;` del HTML ya desescapados. */
export function enlaceDeConfirmacion(html: string): string {
  const coincidencia = /href="([^"]*\/auth\/confirmar\?[^"]*)"/.exec(html);
  if (!coincidencia) throw new Error("El correo no trae el enlace a /auth/confirmar.");
  return coincidencia[1].replaceAll("&amp;", "&");
}

async function borrarCorreos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await fetch(`${variable("MAILPIT_URL")}/api/v1/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ IDs: ids }),
  });
}

// ---------------------------------------------------------------------------
// Fixture `cuentas`: crea usuarios y correos de prueba y los borra al terminar
// ---------------------------------------------------------------------------

export type Cuentas = {
  /** Cliente con la llave secreta, para consultar o cambiar el estado real. */
  cliente: SupabaseClient;
  crearMonitor(): Promise<Cuenta>;
  crearAdmin(): Promise<Cuenta>;
  /** RN-23: desactivar es banear en Auth; la fila se conserva. */
  desactivar(id: string): Promise<void>;
  /** Borra al final de la prueba un usuario que no creó la fixture (p. ej. una sesión anónima). */
  borrarAlFinal(id: string): void;
  /** Como esperarCorreo, y borra el correo del buzón al final de la prueba. */
  esperarCorreo(destinatario: string): Promise<CorreoRecibido>;
};

export const test = base.extend<{ cuentas: Cuentas }>({
  // Playwright exige desestructurar el primer argumento, aunque no dependa de nada. El segundo
  // no se llama `use` porque eslint lo confundiría con un hook de React.
  cuentas: async ({}, entregar) => {
    const cliente = crearClienteAdmin();
    const usuarios = new Set<string>();
    const correos: string[] = [];

    async function crearUsuario(rol: "monitor" | "admin"): Promise<Cuenta> {
      const cuenta: Omit<Cuenta, "id"> = {
        correo: correoUnico(),
        contrasena: contrasenaAleatoria(),
        nombre: `${rol === "monitor" ? "Monitora" : "Admin"} de prueba ${sufijo()}`,
      };
      const { data, error } = await cliente.auth.admin.createUser({
        email: cuenta.correo,
        password: cuenta.contrasena,
        email_confirm: true,
      });
      if (error) throw error;
      const id = data.user.id;
      usuarios.add(id);

      const fila =
        rol === "monitor"
          ? cliente.from("monitor").insert({ id, nombre: cuenta.nombre })
          : cliente
              .from("admin")
              // El orden de revisión es único: un número alto al azar evita chocar con datos reales.
              .insert({ id, nombre: cuenta.nombre, correo: cuenta.correo, orden_revision: randomInt(100_000_000, 2_000_000_000) });
      const { error: errorFila } = await fila;
      if (errorFila) throw errorFila;
      return { id, ...cuenta };
    }

    await entregar({
      cliente,
      crearMonitor: () => crearUsuario("monitor"),
      crearAdmin: () => crearUsuario("admin"),
      async desactivar(id) {
        const { error } = await cliente.auth.admin.updateUserById(id, { ban_duration: "876000h" });
        if (error) throw error;
      },
      borrarAlFinal(id) {
        usuarios.add(id);
      },
      async esperarCorreo(destinatario) {
        const correo = await esperarCorreo(destinatario);
        correos.push(correo.id);
        return correo;
      },
    });

    // Limpieza: primero las filas de rol, luego el usuario. Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    for (const id of usuarios) {
      const pasos = [
        await cliente.from("monitor").delete().eq("id", id),
        await cliente.from("admin").delete().eq("id", id),
        await cliente.auth.admin.deleteUser(id),
      ];
      for (const { error } of pasos) if (error) fallos.push(`${id}: ${error.message}`);
    }
    await borrarCorreos(correos).catch((error: unknown) => fallos.push(`correos: ${String(error)}`));
    if (fallos.length > 0) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

export { expect };
