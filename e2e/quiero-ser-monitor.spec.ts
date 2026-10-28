import { expect, test, type Page } from "@playwright/test";

// HU-109 (D-78): la landing de monitores en /quiero-ser-monitor, con el formulario de HU-062 al final (el formulario lo prueba
// e2e/solicitudes.spec.ts). Corre en `movil` (390x844) y `escritorio` (1280x800). No necesita sesión ni datos propios.

const ESPERA = { timeout: 20_000 };
const H1 = "Monitorías de ciclo básico donde ya sabes qué explicar.";
const CTA = "Quiero ser monitor";

async function abrir(page: Page) {
  await page.goto("/quiero-ser-monitor");
  await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible(ESPERA);
}

const esMovil = (page: Page) => (page.viewportSize()?.width ?? 0) < 720;
const monitorias = (page: Page) => page.getByRole("group", { name: "Monitorías agendadas" }).getByRole("button");
const ctas = (page: Page) => page.locator('[data-evento="clic_cta_ser_monitor"]');

test.describe("HU-109 · la landing de monitores", () => {
  test("sin hacer scroll: el titular, el subtítulo y el CTA; en escritorio, también la agenda", async ({ page }) => {
    await abrir(page);
    await expect(page).toHaveTitle("Quiero ser monitor · Calibra");
    await expect(page.getByText("Antes de la sesión ves el diagnóstico de tu estudiante", { exact: false })).toBeInViewport();
    const cta = page.getByRole("main").getByRole("link", { name: CTA, exact: true }).first();
    await expect(cta).toBeInViewport();
    await expect(cta).toHaveAttribute("href", "#solicitud");
    await expect(page.getByText("Dejas tus datos y te contactamos para la evaluación.").first()).toBeVisible();
    if (!esMovil(page)) await expect(page.getByRole("heading", { name: "Tus próximas monitorías" })).toBeInViewport();
  });

  test("las secciones van en el orden del diseño y el formulario queda al final", async ({ page }) => {
    await abrir(page);
    const titulos = await page.getByRole("heading", { level: 2 }).allTextContents();
    // «Materias en las que puedes certificarte» sale solo si la base tiene materias: se mira el orden de las demás.
    const esperados = [
      "Tus próximas monitorías",
      "Dar monitorías por tu cuenta es más trabajo que enseñar.",
      "Cómo llegas a tu primera monitoría",
      "Tú enseñas. Lo demás lo hace Calibra.",
      "Preguntas frecuentes",
      "Tu primera monitoría empieza con una evaluación.",
      "Quiero ser monitor",
    ];
    expect(titulos.filter((t) => t !== "Materias en las que puedes certificarte")).toEqual(esperados);
    await expect(page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) })).toHaveCount(4);
    // Su propio pie: «Soy estudiante» y el aviso; el global, escondido.
    await expect(page.locator("[data-pie-global]")).toBeHidden();
    await expect(page.getByRole("link", { name: "Soy estudiante" })).toHaveAttribute("href", "/");
  });

  test("la agenda: cada monitoría abre el diagnóstico de quien agendó, con lo que no domina encerrado", async ({ page }) => {
    await abrir(page);
    const botones = monitorias(page);
    await expect(botones).toHaveCount(3);
    await expect(botones.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Diagnóstico de Laura · Cálculo Diferencial")).toBeVisible();
    await expect(page.getByText("Derivas la función de afuera y olvidas multiplicar por la derivada de lo que está adentro.")).toBeVisible();
    await expect(page.getByText("Lo eligió 2 veces")).toBeVisible();

    // Santiago, con el teclado.
    await botones.nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(botones.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(botones.nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Diagnóstico de Santiago · Física I")).toBeVisible();
    await expect(page.getByText("Asumes que la normal siempre es igual al peso.")).toBeVisible();
    // Solo «No lo domina» va encerrado con el trazo.
    const diagnostico = page.locator('[aria-live="polite"]').filter({ hasText: "Diagnóstico de Santiago" });
    await expect(diagnostico.locator("ellipse")).toHaveCount(1);
    await expect(diagnostico.locator("li").filter({ hasText: "Leyes de Newton" }).locator("ellipse")).toHaveCount(1);
  });

  test("con movimiento reducido, el trazo aparece sin animación", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await abrir(page);
    await expect(page.locator("ellipse").first()).toHaveCSS("animation-name", "none");
  });

  test("cada «Quiero ser monitor» baja al formulario; es la única acción con el color de acento", async ({ page }) => {
    await abrir(page);
    await expect(ctas(page)).toHaveCount(3);
    await page.getByRole("main").getByRole("link", { name: CTA, exact: true }).first().click();
    await expect(page).toHaveURL(/#solicitud$/);
    await expect(page.getByRole("heading", { level: 2, name: "Quiero ser monitor" })).toBeInViewport(ESPERA);

    const fondoDelCta = await ctas(page).first().evaluate((a) => getComputedStyle(a).backgroundColor);
    const acceso = page.getByRole("link", { name: "Iniciar sesión" });
    await expect(acceso).not.toHaveCSS("background-color", fondoDelCta);
  });

  test("las preguntas frecuentes citan los plazos de la base y no hablan de cifras de la comisión (D-78 c)", async ({ page }) => {
    await abrir(page);
    await page.getByText("¿Cuándo y cómo me pagan?").click();
    await expect(page.getByText("El pago sale a partir de 24 horas después de que termina la sesión.", { exact: false })).toBeVisible();
    await page.getByText("¿Qué pasa si un estudiante cancela?").click();
    await expect(page.getByText("Una individual se puede cancelar hasta 12 horas antes y una grupal hasta 24 horas.", { exact: false })).toBeVisible();
    await page.getByText("¿Calibra se queda con una parte?").click();
    await expect(page.getByText("Te mostramos la regla exacta cuando creas tu cuenta", { exact: false })).toBeVisible();

    const texto = await page.locator("body").innerText();
    expect(texto).not.toMatch(/comisi[oó]n/i);
    expect(texto).not.toMatch(/\d+\s?%/);
  });

  test("en el teléfono, una barra lleva al formulario y se esconde cuando el formulario está a la vista", async ({ page }) => {
    await abrir(page);
    const barra = ctas(page).last();
    if (!esMovil(page)) {
      await expect(barra).toBeHidden();
      return;
    }
    await page.getByRole("heading", { name: "Cómo llegas a tu primera monitoría" }).scrollIntoViewIfNeeded();
    await expect(barra).toBeInViewport();
    const caja = await barra.boundingBox();
    expect(caja!.height).toBeGreaterThanOrEqual(52);
    expect(caja!.y + caja!.height).toBeGreaterThan(page.viewportSize()!.height - 40);

    await page.locator("#solicitud").scrollIntoViewIfNeeded();
    await expect(barra).toBeHidden();
    await page.getByRole("heading", { name: "Preguntas frecuentes" }).scrollIntoViewIfNeeded();
    await expect(barra).toBeVisible();
  });

  test("respeta las reglas del producto: nada se sale de la pantalla, sin texto menor de 14 px ni degradados", async ({ page }) => {
    await abrir(page);
    const medidas = await page.evaluate(() => {
      const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
        (el) => el.checkVisibility() && [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
      );
      return {
        sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length,
      };
    });
    expect(medidas).toEqual({ sinScrollHorizontal: true, menorTexto: expect.any(Number), degradados: 0 });
    expect(medidas.menorTexto).toBeGreaterThanOrEqual(14);
  });
});
