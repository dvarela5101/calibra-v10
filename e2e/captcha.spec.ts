import { randomUUID } from "node:crypto";
import { expect, test as base, type BrowserContext, type Locator, type Page, type Request } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contrasenaAleatoria, correoUnico, crearClienteAdmin, enviarCredenciales, esperarSesion, leerSesion, variable } from "./utilidades";

// HU-058: CAPTCHA de Cloudflare Turnstile en el inicio de sesión anónimo y en el ingreso. A diferencia del resto de la
// suite, este archivo importa `test` de @playwright/test y NO de ./utilidades: no instala el stub de Turnstile, así que
// corre contra el script REAL de Cloudflare con las llaves de prueba (sitio `1x00000000000000000000BB`, la que no pide
// interacción, y secreta `1x0000000000000000000000000000000AA`). Hace falta internet. Cada prueba que abre una página
// pública gasta una sesión anónima del Auth local (ver `[auth.rate_limit]` de supabase/config.toml).

const ESPERA = { timeout: 30_000 };
const AVISO_SIN_VERIFICACION = "No pudimos verificar tu navegador. Revisa tu conexión y vuelve a intentarlo.";
const AVISO_DE_AUTH = "No pudimos verificar que eres una persona. Recarga la página e intenta de nuevo.";
const REINTENTAR = "Reintentar la verificación";
const CLOUDFLARE = "**/challenges.cloudflare.com/**";
const AUTORIZO = /Autorizo a Calibra a tratar mis datos personales/;
/** Con `siguiente`, a una página que existe y no pide sesión: ahí termina quien deja su contacto. */
const FORMULARIO = "/agendar/contacto?siguiente=/privacidad";

// ---------------------------------------------------------------------------
// Fixture `limpieza`: lo que crea la prueba (sesiones anónimas, monitores, Leads) se borra al terminar
// ---------------------------------------------------------------------------
type Limpieza = {
  /** Cliente con la llave secreta, para consultar el estado real. */
  admin: SupabaseClient;
  /** Anota cada usuario que nazca por un alta anónima de este contexto, aunque la prueba falle antes de leer la cookie. */
  vigilar(context: BrowserContext): void;
  /** Borra al final de la prueba un usuario que no creó la fixture. */
  borrarAlFinal(id: string): void;
  /** Un correo que solo existe en esta prueba: si queda como Lead, se borra al terminar. */
  correo(): string;
  /** Un monitor con contraseña propia, para entrar por /ingresar. */
  crearMonitor(): Promise<{ id: string; correo: string; contrasena: string; nombre: string }>;
  leadsConCorreo(correo: string): Promise<{ id: string; id_sesion_anonima: string | null }[]>;
};

const test = base.extend<{ limpieza: Limpieza }>({
  limpieza: async ({}, entregar) => {
    const admin = crearClienteAdmin();
    const usuarios = new Set<string>();
    const monitores = new Set<string>();
    const correos: string[] = [];

    await entregar({
      admin,
      vigilar(context) {
        context.on("response", async (respuesta) => {
          if (respuesta.request().method() !== "POST" || new URL(respuesta.url()).pathname !== "/auth/v1/signup" || !respuesta.ok()) return;
          try {
            const { user } = (await respuesta.json()) as { user?: { id: string } };
            if (user) usuarios.add(user.id);
          } catch {
            // La página se cerró antes de leer la respuesta: la cookie o el siguiente intento lo anotan.
          }
        });
      },
      borrarAlFinal: (id) => void usuarios.add(id),
      correo() {
        const correo = correoUnico();
        correos.push(correo);
        return correo;
      },
      async crearMonitor() {
        const cuenta = { correo: correoUnico(), contrasena: contrasenaAleatoria(), nombre: `Monitora de prueba ${randomUUID().slice(0, 6)}` };
        const { data, error } = await admin.auth.admin.createUser({ email: cuenta.correo, password: cuenta.contrasena, email_confirm: true });
        if (error) throw error;
        usuarios.add(data.user.id);
        monitores.add(data.user.id);
        const { error: errorFila } = await admin.from("monitor").insert({ id: data.user.id, nombre: cuenta.nombre });
        if (errorFila) throw errorFila;
        return { id: data.user.id, ...cuenta };
      },
      async leadsConCorreo(correo) {
        const { data, error } = await admin.from("lead").select("id, id_sesion_anonima").eq("correo", correo);
        if (error) throw new Error(`leer Leads por correo: ${error.message}`);
        return data ?? [];
      },
    });

    // Limpieza, antes de borrar las sesiones (al borrar una, su Lead ya no se encontraría por ella). Se intenta todo y
    // se avisa de lo que falle.
    const fallos: string[] = [];
    const anotar = (contexto: string, error: { message: string } | null) => {
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (correos.length) {
      anotar("lead por correo", (await admin.from("lead").delete().in("correo", correos)).error);
      anotar("correo_envio por destinatario", (await admin.from("correo_envio").delete().in("destinatario", correos)).error);
      for (const correo of correos) {
        await fetch(`${variable("MAILPIT_URL")}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch((error: unknown) =>
          fallos.push(`buzón de ${correo}: ${String(error)}`),
        );
      }
    }
    if (usuarios.size) anotar("lead por sesión", (await admin.from("lead").delete().in("id_sesion_anonima", [...usuarios])).error);
    for (const id of usuarios) {
      if (monitores.has(id)) anotar(`monitor ${id}`, (await admin.from("monitor").delete().eq("id", id)).error);
      anotar(`usuario ${id}`, (await admin.auth.admin.deleteUser(id)).error);
    }
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 90_000 });

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** El alta de la sesión anónima: POST /auth/v1/signup. */
const esAlta = (peticion: Request) => peticion.method() === "POST" && new URL(peticion.url()).pathname === "/auth/v1/signup";
const esDeCloudflare = (peticion: Request) => new URL(peticion.url()).hostname === "challenges.cloudflare.com";

const alerta = (page: Page, texto: string): Locator => page.getByRole("alert").filter({ hasText: texto });
const campo = (page: Page, etiqueta: string): Locator => page.getByLabel(etiqueta, { exact: true });
const botonReintentar = (page: Page): Locator => page.getByRole("button", { name: REINTENTAR });

/** Abre una página y espera a que termine de cargar e hidratarse: el formulario y la sesión anónima llegan después. */
async function abrir(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta);
  await page.waitForLoadState("networkidle");
}

// ---------------------------------------------------------------------------
// Criterio 1: la sesión nace con el token de Turnstile, sin interacción
// ---------------------------------------------------------------------------
test.describe("Criterio 1 · el CAPTCHA invisible se resuelve solo y la sesión nace con su token", () => {
  test("al abrir / el alta lleva el token, es una sola y el visitante que vuelve no carga Turnstile", async ({ page, context, limpieza }) => {
    limpieza.vigilar(context);
    const altas: Request[] = [];
    page.on("request", (peticion) => {
      if (esAlta(peticion)) altas.push(peticion);
    });

    await page.goto("/");
    const sesion = await esperarSesion(context);
    limpieza.borrarAlFinal(sesion.id);
    await page.waitForLoadState("networkidle");

    expect(sesion.esAnonimo).toBe(true);
    expect(altas, "un solo POST /auth/v1/signup").toHaveLength(1);
    const cuerpo = altas[0].postDataJSON() as { gotrue_meta_security?: { captcha_token?: string } } | null;
    expect(cuerpo?.gotrue_meta_security?.captcha_token, "el alta debía llevar el token de Turnstile").toBeTruthy();
    expect((await altas[0].response())?.status()).toBe(200);
    const { data, error } = await limpieza.admin.auth.admin.getUserById(sesion.id);
    expect(error).toBeNull();
    expect(data.user?.is_anonymous).toBe(true);

    // Con el token ya entregado, el widget y su contenedor se retiran de la página (sin interacción, nada a la vista).
    await expect(page.locator('iframe[src*="challenges.cloudflare.com"]')).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Verificación de seguridad" })).toHaveCount(0);

    // Quien ya tiene sesión no vuelve a pedir nada: ni alta ni script de Cloudflare.
    const aCloudflare: Request[] = [];
    page.on("request", (peticion) => {
      if (esDeCloudflare(peticion)) aCloudflare.push(peticion);
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(leerSesion(await context.cookies())?.id).toBe(sesion.id);
    expect(altas).toHaveLength(1);
    expect(aCloudflare.map((peticion) => peticion.url())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Criterio 4: con Cloudflare caído se sigue navegando y el aviso sale solo al intentar algo que necesita sesión
// ---------------------------------------------------------------------------
test.describe("Criterio 4 · Cloudflare no responde", () => {
  test("lo público carga sin avisos; al enviar aparece el aviso y, al reintentar con Cloudflare de vuelta, la sesión nace y el envío sigue", async ({
    page,
    context,
    limpieza,
  }) => {
    limpieza.vigilar(context);
    const correo = limpieza.correo();
    await context.route(CLOUDFLARE, (ruta) => ruta.abort());

    await test.step("navegar lo público no muestra nada ni crea sesión", async () => {
      for (const ruta of ["/", "/monitores"]) {
        // Se espera a que el script falle de verdad: sin eso, "no hay aviso" podría ser solo que aún no pasó nada.
        const falla = page.waitForEvent("requestfailed", { predicate: esDeCloudflare, timeout: 30_000 });
        await page.goto(ruta);
        await falla;
        await page.waitForLoadState("networkidle");

        await expect(alerta(page, AVISO_SIN_VERIFICACION), `${ruta}: sin aviso`).toHaveCount(0);
        await expect(botonReintentar(page), `${ruta}: sin botón de reintentar`).toHaveCount(0);
        expect(leerSesion(await context.cookies()), `${ruta}: sin sesión`).toBeNull();
      }
    });

    await test.step("al enviar el contacto aparece el aviso con su botón y no se guarda nada", async () => {
      await abrir(page, FORMULARIO);
      await expect(page.getByRole("heading", { level: 1, name: "Tus datos para agendar" })).toBeVisible(ESPERA);
      await campo(page, "Tu nombre").fill("Ana Pérez");
      await campo(page, "Tu correo").fill(correo);
      await page.getByLabel(AUTORIZO).check();
      await page.getByRole("button", { name: "Seguir" }).click();

      await expect(alerta(page, AVISO_SIN_VERIFICACION)).toBeVisible(ESPERA);
      await expect(alerta(page, AVISO_SIN_VERIFICACION)).toHaveText(AVISO_SIN_VERIFICACION);
      await expect(botonReintentar(page)).toBeVisible();
      await expect(page).toHaveURL(/\/agendar\/contacto/);
      expect(leerSesion(await context.cookies())).toBeNull();
      expect(await limpieza.leadsConCorreo(correo)).toEqual([]);
    });

    await test.step("con Cloudflare de vuelta, reintentar crea la sesión y el envío sigue solo", async () => {
      await context.unroute(CLOUDFLARE);
      await botonReintentar(page).click();

      // El formulario ya tenía datos válidos: al nacer la sesión se reenvía y termina en la página que sigue.
      await expect(page).toHaveURL("/privacidad", { timeout: 45_000 });
      await expect(page.getByRole("heading", { level: 1, name: "Aviso de privacidad" })).toBeVisible(ESPERA);
      const sesion = await esperarSesion(context);
      limpieza.borrarAlFinal(sesion.id);
      expect(sesion.esAnonimo).toBe(true);
      expect(await limpieza.leadsConCorreo(correo)).toEqual([{ id: expect.any(String), id_sesion_anonima: sesion.id }]);
    });
  });

  test("en /ingresar el envío sale sin token y Auth lo rechaza con el aviso del CAPTCHA, sin crear sesión", async ({ page, context, limpieza }) => {
    const monitor = await limpieza.crearMonitor();
    await context.route(CLOUDFLARE, (ruta) => ruta.abort());

    const falla = page.waitForEvent("requestfailed", { predicate: esDeCloudflare, timeout: 30_000 });
    await page.goto("/ingresar");
    await falla;
    await page.waitForLoadState("networkidle");

    await enviarCredenciales(page, monitor.correo, monitor.contrasena);

    await expect(alerta(page, AVISO_DE_AUTH)).toBeVisible(ESPERA);
    await expect(page).toHaveURL(/\/ingresar/);
    expect(leerSesion(await context.cookies())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D-30: el ingreso con contraseña, contra el script real
// ---------------------------------------------------------------------------
test.describe("D-30 · ingresar con el widget real", () => {
  test("el monitor entra a /monitor con el token de Turnstile que le llega al formulario", async ({ page, context, limpieza }) => {
    const monitor = await limpieza.crearMonitor();

    await page.goto("/ingresar");
    // El widget se dibuja al montar el formulario y el token llega solo (sin interacción) al campo oculto.
    await expect(page.locator('input[name="captcha_token"]')).toHaveValue(/.+/, { timeout: 30_000 });

    await enviarCredenciales(page, monitor.correo, monitor.contrasena);

    await expect(page).toHaveURL("/monitor", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: `Hola, ${monitor.nombre}` })).toBeVisible();
    const sesion = leerSesion(await context.cookies());
    expect(sesion?.id).toBe(monitor.id);
    expect(sesion?.esAnonimo).toBe(false);
  });
});
