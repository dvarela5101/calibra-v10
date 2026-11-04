import { expect, test, type Page } from "@playwright/test";

// HU-122 (D-88): el fondo blanco con la cuadrícula y la capa de trazos, solo en las dos landings. Corre en `movil` (390x844) y
// `escritorio` (1280x800). No necesita sesión: el alta anónima se bloquea para no dejar usuarios en el Supabase local.

const ESPERA = { timeout: 20_000 };
const BLANCO = "rgb(255, 255, 255)";
const LANDINGS = [
  ["la de estudiantes", "/"],
  ["la de monitores", "/quiero-ser-monitor"],
] as const;

async function abrir(page: Page, ruta: string) {
  await page.route("**/auth/v1/signup", (r) => r.abort());
  await page.goto(ruta);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(ESPERA);
}

const capa = (page: Page) => page.locator("[data-fondo-animado]");
const curvas = (page: Page) => page.locator("[data-curva]");
const esMovil = (page: Page) => (page.viewportSize()?.width ?? 0) < 960;

for (const [nombre, ruta] of LANDINGS) {
  test.describe(`HU-122 · ${nombre}`, () => {
    test("el fondo es blanco con la cuadrícula en toda la página, y la franja azul se conserva", async ({ page }) => {
      await abrir(page, ruta);
      const raiz = page.locator("[data-landing]");
      await expect(raiz).toHaveCSS("background-color", BLANCO);
      await expect(raiz).toHaveCSS("background-image", /url\("data:image\/svg/);
      // El hero y el cierre ya no pintan su propio papel: la cuadrícula es una sola.
      await expect(page.locator("main > section").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(page.locator("main > section").first()).toHaveCSS("background-image", "none");
      const franja = page.locator("main section").filter({ has: page.getByRole("heading", { name: /^Cómo (funciona|llegas)/ }) });
      await expect(franja).not.toHaveCSS("background-color", BLANCO);
    });

    test("la capa es decorativa: no se lee, no recibe foco ni clics, y sin degradados", async ({ page }) => {
      await abrir(page, ruta);
      await expect(capa(page)).toHaveAttribute("aria-hidden", "true");
      await expect(capa(page)).toHaveCSS("pointer-events", "none");
      await expect(capa(page)).toHaveText("");
      await expect(capa(page).locator("a, button, input, [tabindex], text")).toHaveCount(0);
      await expect(page.locator("linearGradient, radialGradient")).toHaveCount(0);
      for (const curva of await curvas(page).all()) {
        await expect(curva).toHaveAttribute("aria-hidden", "true");
        await expect(curva).toHaveCSS("pointer-events", "none");
      }
    });

    test("en escritorio las curvas se dibujan una vez y los símbolos flotan lento; en el teléfono la capa se esconde", async ({ page }) => {
      await abrir(page, ruta);
      if (esMovil(page)) {
        await expect(capa(page)).toBeHidden();
        for (const curva of await curvas(page).all()) await expect(curva).toBeHidden();
        const sinScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        expect(sinScroll).toBe(true);
        return;
      }
      await expect(capa(page)).toBeAttached();
      const curva = curvas(page).locator("path").first();
      await expect(curva).toHaveCSS("animation-iteration-count", "1");
      await expect(curva).toHaveCSS("stroke-dashoffset", "0px", ESPERA);
      expect(await curvas(page).count()).toBeGreaterThanOrEqual(3);

      const simbolos = capa(page).locator("[data-simbolo]");
      expect(await simbolos.count()).toBeGreaterThanOrEqual(4);
      const animaciones = await simbolos.evaluateAll((els) =>
        els.map((el) => {
          const estilo = getComputedStyle(el);
          return { segundos: parseFloat(estilo.animationDuration), vueltas: estilo.animationIterationCount };
        }),
      );
      for (const a of animaciones) {
        expect(a.segundos).toBeGreaterThanOrEqual(20);
        expect(a.vueltas).toBe("infinite");
      }
    });

    test("con movimiento reducido, la decoración queda quieta y completa", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await abrir(page, ruta);
      if (esMovil(page)) return;
      const curva = curvas(page).locator("path").first();
      await expect(curva).toHaveCSS("animation-name", "none");
      await expect(curva).toHaveCSS("stroke-dashoffset", "0px");
      await expect(capa(page).locator("[data-simbolo]").first()).toHaveCSS("animation-name", "none");
    });
  });
}

test("HU-122: otra pantalla conserva su fondo y no lleva la capa", async ({ page }) => {
  await page.goto("/ingresar");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(ESPERA);
  await expect(capa(page)).toHaveCount(0);
  await expect(curvas(page)).toHaveCount(0);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 253, 245)");
});
