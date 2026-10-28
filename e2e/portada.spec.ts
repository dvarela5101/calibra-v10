import { expect, test, type Page } from "@playwright/test";

// HU-108: la landing de la portada, para quien no tiene un diagnóstico terminado (la portada con resultado la prueba
// e2e/ultimo-diagnostico.spec.ts). Corre en `movil` (390x844) y `escritorio` (1280x800). No necesita sesión: el alta anónima
// se bloquea para no dejar usuarios en el Supabase local.

const ESPERA = { timeout: 20_000 };
const H1 = "Monitorías de ciclo básico que empiezan por tu error.";
const CTA = "Hacer mi diagnóstico gratis";

async function abrir(page: Page) {
  await page.route("**/auth/v1/signup", (ruta) => ruta.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible(ESPERA);
}

const esMovil = (page: Page) => (page.viewportSize()?.width ?? 0) < 720;
const opciones = (page: Page) => page.getByRole("group", { name: "Opciones de respuesta" }).getByRole("button");

test.describe("HU-108 · la landing de la portada", () => {
  test("sin hacer scroll: el titular, el subtítulo y el CTA; en escritorio, también la pregunta", async ({ page }) => {
    await abrir(page);
    await expect(page.getByText("Un diagnóstico corto encuentra en qué te equivocas exactamente.", { exact: false })).toBeInViewport();
    const cta = page.getByRole("main").getByRole("link", { name: CTA, exact: true }).first();
    await expect(cta).toBeInViewport();
    await expect(cta).toHaveAttribute("href", "/diagnostico");
    await expect(page.getByText("Sin crear cuenta.").first()).toBeVisible();
    if (!esMovil(page)) await expect(page.getByText("Cálculo Diferencial, parcial 2").first()).toBeInViewport();
  });

  test("las secciones van en el orden del diseño", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      /¿Cuál es la derivada de/,
      "Estudiar más horas no arregla un error que no sabes que tienes.",
      "Cómo funciona",
      "La hora de monitoría rinde, porque nadie empieza a ciegas.",
      "Hecho con los parciales de ciclo básico",
      "Preguntas frecuentes",
      "Averigua qué te falla antes del próximo parcial.",
    ]);
    await expect(page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) })).toHaveCount(3);
  });

  test("la pregunta de muestra: el error del banco al equivocarse, «Lo dominas» al acertar y volver a empezar", async ({ page }) => {
    await abrir(page);
    const botones = opciones(page);
    await expect(botones).toHaveCount(5);
    await expect(page.getByText("Elige una respuesta. Si te equivocas, Calibra te dice qué error cometiste.")).toBeVisible();

    // La primera es cos(x²): olvida la derivada de adentro. Queda marcada y encerrada con el trazo.
    await botones.nth(0).click();
    await expect(botones.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(botones.nth(0).locator("svg")).toHaveCount(1);
    await expect(page.getByText("Error detectado", { exact: true })).toBeVisible();
    await expect(page.getByText("Derivas la función de afuera y olvidas multiplicar por la derivada de lo que está adentro.")).toBeVisible();
    await expect(page.getByText("Habilidad: Derivar una composición de funciones con la regla de la cadena.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Hacer el diagnóstico completo" })).toHaveAttribute("href", "/diagnostico");

    await page.getByRole("button", { name: "Probar otra respuesta" }).click();
    await expect(page.getByText("Elige una respuesta.", { exact: false })).toBeVisible();
    await expect(botones.filter({ has: page.locator("svg") })).toHaveCount(0);

    // La tercera es 2x cos(x²), la correcta. Se elige con el teclado.
    await botones.nth(2).focus();
    await page.keyboard.press("Enter");
    await expect(botones.nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Lo dominas: regla de la cadena")).toBeVisible();
    await expect(page.getByText("Error detectado", { exact: true })).toHaveCount(0);
  });

  test("con movimiento reducido, el trazo aparece sin animación", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await abrir(page);
    await opciones(page).nth(3).click();
    await expect(opciones(page).nth(3).locator("ellipse")).toHaveCSS("animation-name", "none");
  });

  test("una sola acción: sin menú, solo «Iniciar sesión» en la cabecera y el aviso en el pie (D-77 a y b)", async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole("navigation", { name: "Tu cuenta" }).getByRole("link")).toHaveText(["Iniciar sesión"]);
    await expect(page.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/ingresar");
    await expect(page.locator("[data-pie-global]")).toBeHidden();

    const destinos = await page.getByRole("link").evaluateAll((enlaces) => [...new Set(enlaces.map((a) => a.getAttribute("href")))].sort());
    expect(destinos).toEqual(["/", "/diagnostico", "/ingresar", "/privacidad"]);

    // El color de acento es solo del CTA: «Iniciar sesión» va con borde y texto oscuro.
    const fondoDelCta = await page.getByRole("link", { name: CTA, exact: true }).first().evaluate((a) => getComputedStyle(a).backgroundColor);
    const acceso = page.getByRole("link", { name: "Iniciar sesión" });
    await expect(acceso).not.toHaveCSS("background-color", fondoDelCta);
    await expect(acceso).not.toHaveCSS("color", fondoDelCta);
  });

  test("las preguntas frecuentes se abren y citan los plazos de la base", async ({ page }) => {
    await abrir(page);
    const cuesta = page.getByText("¿Cuánto cuesta?");
    await cuesta.click();
    await expect(page.getByText("El diagnóstico es gratis.", { exact: false })).toBeVisible();
    await cuesta.click();
    await expect(page.getByText("El diagnóstico es gratis.", { exact: false })).toBeHidden();

    await page.getByText("¿Y si tengo que cancelar?").click();
    await expect(page.getByText("Cancelas hasta 12 horas antes de una sesión individual, o 24 horas antes de una grupal", { exact: false })).toBeVisible();
  });

  test("en el teléfono el CTA queda al alcance del pulgar al hacer scroll; en pantallas anchas no hay barra", async ({ page }) => {
    await abrir(page);
    const barra = page.getByRole("link", { name: CTA, exact: true }).last();
    if (!esMovil(page)) {
      await expect(page.getByRole("link", { name: CTA, exact: true })).toHaveCount(2);
      return;
    }
    await expect(page.getByRole("link", { name: CTA, exact: true })).toHaveCount(3);
    await page.getByRole("heading", { name: "Preguntas frecuentes" }).scrollIntoViewIfNeeded();
    await expect(barra).toBeInViewport();
    const caja = await barra.boundingBox();
    expect(caja!.height).toBeGreaterThanOrEqual(52);
    expect(caja!.y + caja!.height).toBeGreaterThan(page.viewportSize()!.height - 40);
    // La barra no tapa el pie: al final, el aviso de privacidad se ve entero por encima de ella.
    await page.getByRole("link", { name: "Aviso de privacidad" }).scrollIntoViewIfNeeded();
    const aviso = await page.getByRole("link", { name: "Aviso de privacidad" }).boundingBox();
    expect(aviso!.y + aviso!.height).toBeLessThanOrEqual((await barra.boundingBox())!.y);
  });
});
