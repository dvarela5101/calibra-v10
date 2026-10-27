import { enviarCredenciales, expect, test } from "./utilidades";

// D-75 a y b: «Iniciar sesión» y «Registrarse» en la cabecera de las pantallas del visitante, la pantalla de registro y,
// con cuenta, el enlace a lo suyo. Corre contra el Supabase local con cuentas que crea y borra cada prueba.

test.describe.configure({ mode: "default", timeout: 90_000 });
const ESPERA = { timeout: 20_000 };

test.describe("D-75 · acceso a las cuentas", () => {
  test("el visitante llega a registrarse y a iniciar sesión desde la cabecera", async ({ page }) => {
    await page.goto("/");
    const cuenta = page.getByRole("navigation", { name: "Tu cuenta" });
    await expect(cuenta.getByRole("link")).toHaveText(["Iniciar sesión", "Registrarse"], ESPERA);

    // Cabe junto a la marca, con su área táctil, sin barra horizontal.
    const medidas = await cuenta.evaluate((nav) => ({
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      alturas: [...nav.querySelectorAll("a")].map((a) => a.getBoundingClientRect().height),
      letra: Math.min(...[...nav.querySelectorAll("a")].map((a) => parseFloat(getComputedStyle(a).fontSize))),
    }));
    expect(medidas.sinScrollHorizontal).toBe(true);
    for (const altura of medidas.alturas) expect(altura).toBeGreaterThanOrEqual(44);
    expect(medidas.letra).toBeGreaterThanOrEqual(14);

    await cuenta.getByRole("link", { name: "Registrarse" }).click();
    await expect(page).toHaveURL("/registrarse", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: "Regístrate" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Crear mi cuenta de estudiante" })).toHaveAttribute("href", "/cuenta/crear");
    await expect(page.getByRole("link", { name: "Enviar mi solicitud" })).toHaveAttribute("href", "/quiero-ser-monitor");
    await expect(page.getByText("te llega al correo la invitación para crear tu cuenta de monitor")).toBeVisible();

    await page.getByRole("link", { name: "¿Ya tienes cuenta? Inicia sesión" }).click();
    await expect(page).toHaveURL("/ingresar", ESPERA);
    await expect(page.getByText("Tu cuenta de Calibra")).toBeVisible();
    await expect(page.getByRole("link", { name: "¿No tienes cuenta? Regístrate" })).toHaveAttribute("href", "/registrarse");

    // Las pantallas del visitante lo llevan; las de cuentas no.
    for (const ruta of ["/diagnostico", "/monitores", "/quiero-ser-monitor", "/privacidad"]) {
      await page.goto(ruta);
      await expect(page.getByRole("navigation", { name: "Tu cuenta" }).getByRole("link", { name: "Iniciar sesión" }), ruta).toBeVisible(ESPERA);
    }
    await page.goto("/ingresar");
    await expect(page.getByRole("navigation", { name: "Tu cuenta" })).toHaveCount(0);
  });

  test("con cuenta de admin la cabecera lleva a su panel, y /registrarse también", async ({ page, cuentas }) => {
    const admin = await cuentas.crearAdmin();
    await page.goto("/ingresar");
    await enviarCredenciales(page, admin.correo, admin.contrasena);
    await expect(page).toHaveURL("/admin", ESPERA);

    await page.goto("/");
    const cuenta = page.getByRole("navigation", { name: "Tu cuenta" });
    await expect(cuenta.getByRole("link")).toHaveText(["Mi panel"], ESPERA);
    await cuenta.getByRole("link", { name: "Mi panel" }).click();
    await expect(page).toHaveURL("/admin", ESPERA);

    await page.goto("/registrarse");
    await expect(page).toHaveURL("/admin", ESPERA);
  });
});
