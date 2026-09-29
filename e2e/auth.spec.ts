import type { Page } from "@playwright/test";
import {
  contrasenaAleatoria,
  cookiesDeSesion,
  enlaceDeConfirmacion,
  enviarCredenciales,
  esperarSesion,
  expect,
  leerSesion,
  test,
} from "./utilidades";

// HU-004: sesión anónima persistente, cuentas y roles. Corre contra el Supabase local
// (Auth y Mailpit) con cuentas que crea y borra cada prueba.

// Las pruebas de este archivo corren una tras otra en cada proyecto (móvil y escritorio siguen
// en paralelo entre sí). Todas comparten el mismo Auth local, que limita por IP los inicios de
// sesión (30 cada 5 min) y las sesiones anónimas (30 por hora, ver [auth.rate_limit] en
// supabase/config.toml); con ocho trabajadores a la vez se acercarían al tope, y el navegador y
// `next dev` compiten por la misma máquina.
// Navegar a una página que `next dev` aún no compiló, o esperar a Auth, puede tardar.
test.describe.configure({ mode: "default", timeout: 60_000 });
const ESPERA = { timeout: 20_000 };
const DIAS_30 = 30 * 24 * 60 * 60;

const MENSAJE_CREDENCIALES = "Correo o contraseña incorrectos.";

/** Cuenta una alta de sesión anónima: el cliente la pide con POST /auth/v1/signup sin credenciales. */
function contarAltasAnonimas(page: Page): () => number {
  let altas = 0;
  page.on("request", (peticion) => {
    if (peticion.method() === "POST" && new URL(peticion.url()).pathname === "/auth/v1/signup") altas += 1;
  });
  return () => altas;
}

test.describe("Criterio 1 · sesión anónima persistente (RN-10)", () => {
  test("al abrir / se crea una sesión anónima que sobrevive a recargar y a cerrar el navegador", async ({
    page,
    context,
    browser,
    baseURL,
    cuentas,
  }) => {
    const altas = contarAltasAnonimas(page);

    await page.goto("/");
    const sesion = await esperarSesion(context);
    cuentas.borrarAlFinal(sesion.id);

    // Es una sesión anónima de verdad, tanto en el token como en Auth.
    expect(sesion.esAnonimo).toBe(true);
    const { data, error } = await cuentas.cliente.auth.admin.getUserById(sesion.id);
    expect(error).toBeNull();
    expect(data.user?.is_anonymous).toBe(true);
    expect(altas()).toBe(1);

    // La cookie es persistente: vence dentro de 30 días o más (no es de sesión del navegador).
    const trozos = cookiesDeSesion(await context.cookies());
    expect(trozos.length).toBeGreaterThan(0);
    const ahora = Date.now() / 1000;
    for (const trozo of trozos) expect(trozo.expires, `expires de ${trozo.name}`).toBeGreaterThan(ahora + DIAS_30);

    // Recargar conserva el mismo id y no pide otra sesión anónima.
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(leerSesion(await context.cookies())?.id).toBe(sesion.id);
    expect(altas()).toBe(1);

    // Cerrar y reabrir el navegador: un contexto nuevo que solo trae lo que quedó guardado.
    const guardado = await context.storageState();
    const reabierto = await browser.newContext({ baseURL, storageState: guardado, viewport: page.viewportSize() ?? undefined });
    try {
      const paginaNueva = await reabierto.newPage();
      const altasNuevas = contarAltasAnonimas(paginaNueva);
      await paginaNueva.goto("/");
      await paginaNueva.waitForLoadState("networkidle");
      expect(leerSesion(await reabierto.cookies())?.id).toBe(sesion.id);
      expect(altasNuevas()).toBe(0);
    } finally {
      await reabierto.close();
    }
  });
});

test.describe("Criterio 3 · rutas por rol", () => {
  for (const ruta of ["/monitor", "/admin"]) {
    test(`sin sesión, ${ruta} manda a /ingresar con siguiente`, async ({ page, context }) => {
      await page.goto(ruta);
      await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
      await expect(page.getByRole("heading", { level: 1, name: "Inicia sesión" })).toBeVisible();
      // Las páginas de cuentas y paneles no crean sesión anónima.
      expect(leerSesion(await context.cookies())).toBeNull();
    });
  }

  test("un visitante anónimo tampoco entra a /admin ni a /monitor", async ({ page, context, cuentas }) => {
    await page.goto("/");
    const sesion = await esperarSesion(context);
    cuentas.borrarAlFinal(sesion.id);
    expect(sesion.esAnonimo).toBe(true);

    for (const ruta of ["/admin", "/monitor"]) {
      await page.goto(ruta);
      await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
      await expect(page.getByRole("heading", { level: 1, name: "Inicia sesión" })).toBeVisible();
    }
  });

  test("el monitor entra a /monitor con su nombre y no puede ir a /admin", async ({ page, cuentas }) => {
    const monitor = await cuentas.crearMonitor();

    await page.goto("/ingresar");
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);
    await expect(page).toHaveTitle("Panel del monitor · Calibra");
    await expect(page.getByRole("heading", { level: 1, name: `Hola, ${monitor.nombre}` })).toBeVisible();

    await page.goto("/admin");
    await expect(page).toHaveURL("/monitor", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: `Hola, ${monitor.nombre}` })).toBeVisible();
  });

  test("el admin entra a /admin con su nombre y no puede ir a /monitor", async ({ page, cuentas }) => {
    const admin = await cuentas.crearAdmin();

    // Pide su panel sin sesión: tras entrar, vuelve a él.
    await page.goto("/admin");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
    await enviarCredenciales(page, admin.correo, admin.contrasena);
    await expect(page).toHaveURL("/admin", ESPERA);
    await expect(page).toHaveTitle("Administración · Calibra");
    await expect(page.getByRole("heading", { level: 1, name: `Hola, ${admin.nombre}` })).toBeVisible();

    await page.goto("/monitor");
    await expect(page).toHaveURL("/admin", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: `Hola, ${admin.nombre}` })).toBeVisible();
  });

  test("si pidió la ruta de otro rol, tras entrar el monitor termina en su panel", async ({ page, cuentas }) => {
    const monitor = await cuentas.crearMonitor();

    await page.goto("/admin");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);
  });

  test("Cerrar sesión lleva a /ingresar y /monitor vuelve a pedir sesión", async ({ page, context, cuentas }) => {
    const monitor = await cuentas.crearMonitor();

    await page.goto("/monitor");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fmonitor", ESPERA);
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);
    expect(leerSesion(await context.cookies())?.id).toBe(monitor.id);

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL("/ingresar", ESPERA);
    expect(leerSesion(await context.cookies())).toBeNull();

    await page.goto("/monitor");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fmonitor", ESPERA);
  });

  test("con credenciales incorrectas muestra el error y se queda en /ingresar", async ({ page, context, cuentas }) => {
    const monitor = await cuentas.crearMonitor();

    await page.goto("/ingresar");
    await enviarCredenciales(page, monitor.correo, contrasenaAleatoria());
    await expect(page.getByText(MENSAJE_CREDENCIALES)).toBeVisible(ESPERA);
    await expect(page).toHaveURL("/ingresar");
    expect(leerSesion(await context.cookies())).toBeNull();
  });

  test("un siguiente que apunta a otro sitio no redirige fuera tras iniciar sesión", async ({ page, baseURL, cuentas }) => {
    const monitor = await cuentas.crearMonitor();

    await page.goto("/ingresar?siguiente=https://otro.sitio");
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });

  for (const siguiente of ["https://otro.sitio", "//otro.sitio", "/\\otro.sitio", "javascript:alert(1)"]) {
    test(`el formulario descarta el siguiente externo ${siguiente}`, async ({ page }) => {
      await page.goto(`/ingresar?siguiente=${encodeURIComponent(siguiente)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Inicia sesión" })).toBeVisible(ESPERA);
      await expect(page.locator('input[name="siguiente"]')).toHaveValue("");
    });
  }
});

test.describe("Criterio 4 · cuenta desactivada (RN-23)", () => {
  test("un admin desactivado no puede entrar y sus datos se conservan", async ({ page, context, cuentas }) => {
    const admin = await cuentas.crearAdmin();
    await cuentas.desactivar(admin.id);

    await page.goto("/ingresar");
    await enviarCredenciales(page, admin.correo, admin.contrasena);
    await expect(page.getByText(/desactivada/)).toBeVisible(ESPERA);
    await expect(page).toHaveURL("/ingresar");
    expect(leerSesion(await context.cookies())).toBeNull();

    // Desactivar no borra: la fila del admin sigue ahí.
    const { data, error } = await cuentas.cliente.from("admin").select("id").eq("id", admin.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  test("un admin con la sesión abierta pierde el acceso al panel en cuanto lo desactivan", async ({ page, cuentas }) => {
    const admin = await cuentas.crearAdmin();

    await page.goto("/ingresar");
    await enviarCredenciales(page, admin.correo, admin.contrasena);
    await expect(page).toHaveURL("/admin", ESPERA);

    await cuentas.desactivar(admin.id);

    await page.goto("/admin");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  });
});

test.describe("Criterio 5 · olvidé mi contraseña", () => {
  test("restablece la contraseña por correo, el enlace sirve una sola vez y la vieja deja de servir", async ({
    page,
    context,
    cuentas,
  }) => {
    const monitor = await cuentas.crearMonitor();
    const contrasenaNueva = contrasenaAleatoria();

    // 1. Pide el enlace desde /ingresar.
    await page.goto("/ingresar");
    await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
    await expect(page).toHaveURL("/restablecer", ESPERA);
    await page.getByLabel("Correo").fill(monitor.correo);
    await page.getByRole("button", { name: "Enviarme el enlace" }).click();
    await expect(page.getByRole("status")).toContainText("te enviamos un enlace", ESPERA);

    // 2. Lee el correo en Mailpit y abre el enlace.
    const correo = await cuentas.esperarCorreo(monitor.correo);
    expect(correo.asunto).toBe("Restablece tu contraseña de Calibra");
    const enlace = enlaceDeConfirmacion(correo.html);
    await page.goto(enlace);
    await expect(page).toHaveURL("/restablecer/nueva", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: "Elige una nueva contraseña" })).toBeVisible();

    // 3. Elige la contraseña nueva, dos veces.
    await page.getByLabel("Nueva contraseña").fill(contrasenaNueva);
    await page.getByLabel("Repite la contraseña").fill(contrasenaNueva);
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page).toHaveURL("/ingresar?contrasena=actualizada", ESPERA);
    await expect(page.getByRole("status")).toContainText("Tu contraseña quedó actualizada");
    expect(leerSesion(await context.cookies())).toBeNull();

    // 4. El mismo enlace, por segunda vez, ya no sirve.
    await page.goto(enlace);
    await expect(page).toHaveURL("/restablecer?error=enlace", ESPERA);
    await expect(page.getByRole("alert").filter({ hasText: "El enlace ya se usó o venció" })).toBeVisible();
    expect(leerSesion(await context.cookies())).toBeNull();

    // 5. La contraseña vieja ya no sirve y la nueva sí.
    await page.goto("/ingresar");
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page.getByText(MENSAJE_CREDENCIALES)).toBeVisible(ESPERA);
    await expect(page).toHaveURL("/ingresar");

    await enviarCredenciales(page, monitor.correo, contrasenaNueva);
    await expect(page).toHaveURL("/monitor", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: `Hola, ${monitor.nombre}` })).toBeVisible();
  });
});
