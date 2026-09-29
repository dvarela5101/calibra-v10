import { expect, test } from "@playwright/test";

test.describe("aviso de privacidad (HU-008)", () => {
  test("se llega desde el pie de la página de inicio y carga sin errores de consola", async ({ page }) => {
    const errores: string[] = [];
    page.on("console", (mensaje) => {
      if (mensaje.type() === "error") errores.push(mensaje.text());
    });
    page.on("pageerror", (error) => errores.push(error.message));

    await page.goto("/");
    await page.getByRole("link", { name: "Aviso de privacidad" }).click();

    await expect(page).toHaveURL(/\/privacidad$/);
    await expect(page).toHaveTitle("Aviso de privacidad · Calibra");
    await expect(page.getByRole("heading", { level: 1, name: "Aviso de privacidad" })).toBeVisible();
    expect(errores).toEqual([]);
  });

  test("muestra las secciones y textos exigidos", async ({ page }) => {
    await page.goto("/privacidad");

    for (const titulo of [
      "Responsable del tratamiento",
      "Para qué los usamos",
      "Tus derechos",
      "Canal de consultas",
      "Cuánto tiempo los guardamos",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: titulo })).toBeVisible();
    }

    await expect(page.getByText("Compartir el resultado de tu diagnóstico con el monitor de tu monitoría")).toBeVisible();
    await expect(page.getByText("Calibra es la responsable del tratamiento")).toBeVisible();

    // El correo depende de CORREO_DATOS_PERSONALES: basta con el enlace o con el aviso de que llegará pronto.
    const canal = page.locator("section", { has: page.getByRole("heading", { name: "Canal de consultas" }) });
    const conCorreo = await canal.locator('a[href^="mailto:"]').count();
    if (conCorreo === 0) {
      await expect(canal.getByText("Pronto publicaremos aquí el correo")).toBeVisible();
    } else {
      await expect(canal.locator('a[href^="mailto:"]').first()).toBeVisible();
    }
  });

  test("el enlace al aviso también está en una página fuera del grupo público", async ({ page }) => {
    await page.goto("/ingresar");

    await expect(page.getByRole("link", { name: "Aviso de privacidad" })).toBeVisible();
  });

  test("respeta las reglas de accesibilidad del producto", async ({ page }) => {
    await page.goto("/privacidad");

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

    // Áreas táctiles: solo el enlace del pie y el logo (los enlaces dentro de texto corrido quedan fuera).
    const enlaces = await page.locator("footer a, header a").all();
    expect(enlaces.length).toBeGreaterThan(0);
    for (const enlace of enlaces) {
      const caja = await enlace.boundingBox();
      expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
