import { expect, test, enviarCredenciales, contrasenaAleatoria, correoUnico, type Cuenta, type Cuentas } from "./utilidades";

// HU-013: cuenta de monitor por invitación. Corre contra el Supabase local (Auth, base y Mailpit)
// con cuentas que crea y borra cada prueba.

test.describe.configure({ mode: "default", timeout: 90_000 });
const ESPERA = { timeout: 20_000 };
const TITULO_SIN_INVITACION = "Necesitas una invitación vigente";

/** La fixture crea solo la fila `monitor`; el panel también lee `monitor_privado` (la llave). */
async function crearMonitorConLlave(cuentas: Cuentas, llave: string): Promise<Cuenta> {
  const monitor = await cuentas.crearMonitor();
  const { error } = await cuentas.cliente
    .from("monitor_privado")
    .insert({ id_monitor: monitor.id, numero_telefono: "3001234567", correo: monitor.correo, llave });
  if (error) throw error;
  const { error: errorPerfil } = await cuentas.cliente.from("perfil_monitor").insert({ id_monitor: monitor.id });
  if (errorPerfil) throw errorPerfil;
  return monitor;
}

test.describe("Criterios 1 a 3 y 7 · invitar y registrarse", () => {
  test("el admin invita, el aspirante se registra con el enlace, ve su panel y el enlace ya no sirve", async ({
    page,
    browser,
    cuentas,
  }) => {
    const admin = await cuentas.crearAdmin();
    const correo = correoUnico();
    const nombre = `Aspirante ${Date.now()}`;
    const contrasena = contrasenaAleatoria();

    // El admin entra y llega al formulario desde su bandeja.
    await page.goto("/admin");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
    await enviarCredenciales(page, admin.correo, admin.contrasena);
    await expect(page).toHaveURL("/admin", ESPERA);
    await page.getByRole("link", { name: "Invitar a un monitor" }).click();
    await expect(page).toHaveURL("/admin/monitores", ESPERA);

    await page.getByLabel("Correo del aspirante").fill(correo);
    await page.getByRole("button", { name: "Enviar invitación" }).click();
    await expect(page.getByRole("status")).toContainText(`Enviamos la invitación a ${correo}`, ESPERA);

    // El correo trae el enlace de registro.
    const mensaje = await cuentas.esperarCorreo(correo);
    expect(mensaje.asunto).toBe("Crea tu cuenta de monitor en Calibra");
    const enlace = /href="([^"]*\/monitores\/registro\?[^"]*)"/.exec(mensaje.html)?.[1]?.replaceAll("&amp;", "&");
    expect(enlace, "el correo debía traer el enlace de registro").toBeTruthy();

    // En un contexto limpio (sin la sesión del admin) el aspirante se registra.
    const contexto = await browser.newContext();
    try {
      const aspirante = await contexto.newPage();
      await aspirante.goto(enlace!);
      const campoCorreo = aspirante.getByLabel("Correo", { exact: true });
      await expect(campoCorreo).toHaveValue(correo, ESPERA);
      await expect(campoCorreo).toHaveAttribute("readonly", "");

      await aspirante.getByLabel("Nombre completo").fill(nombre);
      await aspirante.getByLabel("Teléfono").fill("3109876543");
      await aspirante.getByLabel("Tu llave").fill("llave-e2e@calibra.test");
      await aspirante.getByLabel("Contraseña", { exact: true }).fill(contrasena);
      await aspirante.getByLabel("Repite la contraseña").fill(contrasena);
      await aspirante.getByRole("button", { name: "Crear mi cuenta" }).click();

      await expect(aspirante).toHaveURL("/monitor", ESPERA);
      await expect(aspirante.getByRole("heading", { name: `Hola, ${nombre}` })).toBeVisible(ESPERA);
      await expect(aspirante.getByText("Aún no tienes materias certificadas")).toBeVisible();

      // La cuenta se borra al terminar la prueba.
      const { data } = await cuentas.cliente.from("monitor_privado").select("id_monitor").eq("correo", correo).single();
      expect(data, "el registro debía crear monitor_privado").not.toBeNull();
      cuentas.borrarAlFinal(data!.id_monitor as string);

      // El enlace es de un solo uso.
      await aspirante.goto(enlace!);
      await expect(aspirante.getByRole("heading", { name: TITULO_SIN_INVITACION })).toBeVisible(ESPERA);
      await expect(aspirante.locator('input[type="password"]')).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });
});

test.describe("Criterio 4 · no hay autorregistro", () => {
  test("sin token o con un token inventado no hay formulario", async ({ page }) => {
    for (const ruta of ["/monitores/registro", "/monitores/registro?token=basura-que-no-existe"]) {
      await page.goto(ruta);
      await expect(page.getByRole("heading", { name: TITULO_SIN_INVITACION })).toBeVisible(ESPERA);
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Crear mi cuenta" })).toHaveCount(0);
    }
  });

  test("/ingresar no ofrece crear una cuenta de monitor", async ({ page }) => {
    await page.goto("/ingresar");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible(ESPERA);
    await expect(page.getByRole("link", { name: /monitor|crear.*cuenta|registr/i })).toHaveCount(0);
  });
});

test.describe("Criterio 5 · el monitor cambia su llave", () => {
  test("guarda la nueva llave y lo confirma", async ({ page, cuentas }) => {
    const monitor = await crearMonitorConLlave(cuentas, "llave-anterior");

    await page.goto("/monitor");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fmonitor", ESPERA);
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);

    const llave = page.getByLabel("Tu llave para recibir pagos");
    await expect(llave).toHaveValue("llave-anterior", ESPERA);
    await llave.fill("llave-nueva-e2e");
    await page.getByRole("button", { name: "Guardar mi llave" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Guardamos tu llave" })).toBeVisible(ESPERA);

    const { data } = await cuentas.cliente.from("monitor_privado").select("llave").eq("id_monitor", monitor.id).single();
    expect(data?.llave).toBe("llave-nueva-e2e");
  });
});

test.describe("Invitar es solo del admin", () => {
  test("un monitor que abre /admin/monitores termina en /monitor", async ({ page, cuentas }) => {
    const monitor = await crearMonitorConLlave(cuentas, "llave-e2e");

    await page.goto("/admin/monitores");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin%2Fmonitores", ESPERA);
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);
    await expect(page.getByLabel("Correo del aspirante")).toHaveCount(0);
  });
});
