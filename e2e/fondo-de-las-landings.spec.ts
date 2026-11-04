import { expect, test, type Page } from "@playwright/test";

// HU-122 (D-88) y HU-125: el fondo blanco con la cuadrícula y los trazos que se dibujan con el scroll, solo en las dos landings. Corre
// en `movil` (390x844) y `escritorio` (1280x800). No necesita sesión: el alta anónima se bloquea para no dejar usuarios en el Supabase local.

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

/** Cuántos dibujos tienen todos sus trazos terminados. */
const trazosCompletos = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("[data-dibujo]")].filter((dibujo) =>
        [...dibujo.querySelectorAll("path")].every((trazo) => parseFloat(getComputedStyle(trazo).strokeDashoffset) < 0.001),
      ).length,
  );

async function bajarConLaRueda(page: Page) {
  await page.mouse.move(640, 400);
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, 600);
      return page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1);
    }, { timeout: 30_000, intervals: [50] })
    .toBe(true);
}

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

    test("HU-125: los trazos se dibujan al bajar y se borran al subir; en el teléfono la capa se esconde", async ({ page }) => {
      await abrir(page, ruta);
      if (esMovil(page)) {
        await expect(capa(page)).toBeHidden();
        for (const curva of await curvas(page).all()) await expect(curva).toBeHidden();
        const sinScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        expect(sinScroll).toBe(true);
        return;
      }
      const dibujos = page.locator("[data-simbolo], [data-curva]");
      expect(await capa(page).locator("[data-simbolo]").count()).toBeGreaterThanOrEqual(30);

      // Arriba, los de abajo de la página siguen en blanco.
      await expect.poll(() => trazosCompletos(page)).toBeLessThan(await dibujos.count());
      const alCargar = await trazosCompletos(page);

      // Con la rueda, como un visitante: al final de la página todos quedaron completos.
      await bajarConLaRueda(page);
      await expect.poll(() => trazosCompletos(page)).toBe(await dibujos.count());

      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await expect.poll(() => trazosCompletos(page)).toBe(alCargar);
    });

    test("HU-125: cada dibujo se traza a la vista, con su borde superior subiendo del 85 % al 25 % de la pantalla", async ({ page }) => {
      if (esMovil(page)) return;
      await abrir(page, ruta);
      const dibujo = capa(page).locator('[data-dibujo="sumatoria"]');
      /** Lleva el dibujo a esa altura de la pantalla y dice cuánto se ha trazado, de 0 a 1. */
      const trazadoCon = async (altura: number) => {
        await dibujo.evaluate((el, a) => {
          const destino = window.scrollY + el.getBoundingClientRect().top - window.innerHeight * a;
          window.scrollTo({ top: destino, behavior: "instant" });
        }, altura);
        return dibujo.evaluate((el) => {
          const trazos = [...el.querySelectorAll("path")].map((t) => 1 - Math.min(parseFloat(getComputedStyle(t).strokeDashoffset), 1));
          return trazos.reduce((a, b) => a + b, 0) / trazos.length;
        });
      };
      await expect.poll(() => trazadoCon(0.9)).toBe(0);
      const aLaMitad = await trazadoCon(0.55);
      expect(aLaMitad).toBeGreaterThan(0.2);
      expect(aLaMitad).toBeLessThan(0.8);
      await expect.poll(() => trazadoCon(0.2)).toBe(1);
    });

    test("HU-125: al final de la página todos quedan completos también en pantallas bajas y altas", async ({ page }) => {
      if (esMovil(page)) return;
      for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1300]] as const) {
        await page.setViewportSize({ width, height });
        await abrir(page, ruta);
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        await expect.poll(() => trazosCompletos(page)).toBe(await page.locator("[data-simbolo], [data-curva]").count());
      }
    });

    test("HU-125: ningún dibujo pasa por detrás de un texto o un control, en 1280 y en 1920 px", async ({ page }) => {
      if (esMovil(page)) return;
      for (const [width, height] of [[1280, 800], [1920, 1080]] as const) {
        await page.setViewportSize({ width, height });
        await abrir(page, ruta);
        const choques = await page.evaluate(() => {
          const contenido = [...document.querySelectorAll("main h1, main h2, main h3, main p, main li, main a, main button, main input, main label, main table, main summary")];
          const cajas = contenido.map((el) => el.getBoundingClientRect()).filter((c) => c.width > 0);
          return [...document.querySelectorAll<SVGElement>("[data-dibujo]")].flatMap((dibujo) => {
            const d = dibujo.getBoundingClientRect();
            const choca = cajas.some((c) => d.left < c.right && d.right > c.left && d.top < c.bottom && d.bottom > c.top);
            return choca ? [dibujo.dataset.dibujo] : [];
          });
        });
        expect(choques).toEqual([]);
      }
    });

    test("con movimiento reducido, la decoración queda quieta y completa", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await abrir(page, ruta);
      if (esMovil(page)) return;
      const trazo = curvas(page).locator("path").first();
      await expect(trazo).toHaveCSS("animation-name", "none");
      await expect(trazo).toHaveCSS("stroke-dashoffset", "0px");
      expect(await trazosCompletos(page)).toBe(await page.locator("[data-simbolo], [data-curva]").count());
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
