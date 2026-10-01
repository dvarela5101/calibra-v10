import { expect, test } from "@playwright/test";

// HU-071: la página de no encontrado, en español. Las páginas que llaman `notFound()` (una reserva ajena,
// una franja de otro monitor) se prueban en agendar.spec.ts y franjas.spec.ts.

const RUTA_QUE_NO_EXISTE = "/esta-pagina-no-existe";

test.describe("Página de no encontrado (HU-071)", () => {
  test("una ruta que no existe responde 404 en español, con la marca y un enlace al inicio", async ({ page }) => {
    const respuesta = await page.goto(RUTA_QUE_NO_EXISTE);

    expect(respuesta?.status()).toBe(404);
    await expect(page).toHaveTitle("Página no encontrada · Calibra");
    await expect(page.getByRole("heading", { level: 1, name: "No encontramos esta página" })).toBeVisible();
    await expect(page.getByText("Puede que el enlace esté incompleto")).toBeVisible();
    await expect(page.getByRole("link", { name: "Calibra, ir al inicio" })).toBeVisible();
    await expect(page.getByText("This page could not be found")).toHaveCount(0);

    await page.getByRole("link", { name: "Ir al inicio", exact: true }).click();
    await expect(page).toHaveURL("/");
  });

  test("respeta las reglas de accesibilidad del producto", async ({ page }) => {
    await page.goto(RUTA_QUE_NO_EXISTE);
    await expect(page.getByRole("heading", { level: 1, name: "No encontramos esta página" })).toBeVisible();

    const medidas = await page.evaluate(() => {
      const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) =>
        [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
      );
      return {
        sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient"))
          .length,
      };
    });

    expect(medidas.sinScrollHorizontal).toBe(true);
    expect(medidas.menorTexto).toBeGreaterThanOrEqual(14);
    expect(medidas.degradados).toBe(0);

    // Áreas táctiles: el logo, el enlace al inicio y el del pie.
    const enlaces = await page.locator("a").all();
    expect(enlaces.length).toBeGreaterThanOrEqual(3);
    for (const enlace of enlaces) {
      const caja = await enlace.boundingBox();
      expect(caja?.height ?? 0, await enlace.innerText()).toBeGreaterThanOrEqual(44);
    }
  });
});
