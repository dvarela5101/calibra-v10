import { expect, test } from "@playwright/test";

test.describe("página de inicio", () => {
  test("carga en español y sin errores de consola", async ({ page }) => {
    const errores: string[] = [];
    page.on("console", (mensaje) => {
      if (mensaje.type() === "error") errores.push(mensaje.text());
    });
    page.on("pageerror", (error) => errores.push(error.message));

    await page.goto("/");

    await expect(page).toHaveTitle("Calibra");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(
      page.getByRole("heading", { level: 1, name: "Descubre en qué tema fallas antes de tu monitoría" }),
    ).toBeVisible();
    expect(errores).toEqual([]);
  });

  test("respeta las reglas de accesibilidad del producto", async ({ page }) => {
    await page.goto("/");

    const medidas = await page.evaluate(() => {
      const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) =>
        [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
      );
      return {
        sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        degradados: [...document.querySelectorAll("*")].filter((el) =>
          getComputedStyle(el).backgroundImage.includes("gradient"),
        ).length,
      };
    });

    expect(medidas.sinScrollHorizontal).toBe(true);
    expect(medidas.menorTexto).toBeGreaterThanOrEqual(14);
    expect(medidas.degradados).toBe(0);
  });
});
