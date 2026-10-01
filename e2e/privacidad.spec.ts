import { expect, test } from "@playwright/test";

test.describe("aviso de privacidad (HU-008)", () => {
  test("se llega desde el pie de la página de inicio y carga sin errores de consola", async ({ page }) => {
    const errores: string[] = [];
    page.on("console", (mensaje) => {
      if (mensaje.type() === "error") errores.push(mensaje.text());
    });
    page.on("pageerror", (error) => errores.push(error.message));

    await page.goto("/");
    // Con la máquina cargada, la fuente y la sesión anónima siguen llegando y el pie se mueve: el clic
    // esperaba un enlace quieto hasta agotar el tiempo. Se espera a que la página termine de cargar.
    await page.waitForLoadState("networkidle");
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
      "Si eres monitor",
      "Tus derechos",
      "Canal de consultas",
      "Cuánto tiempo los guardamos",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: titulo })).toBeVisible();
    }

    await expect(page.getByText("Compartir el resultado de tu diagnóstico con el monitor de tu monitoría")).toBeVisible();
    await expect(page.getByText("Calibra es la responsable del tratamiento")).toBeVisible();

    // HU-069 (D-6): el nombre del monitor se muestra; su contacto y su llave no. Con la fecha del cambio.
    const monitores = page.locator("section", { has: page.getByRole("heading", { name: "Si eres monitor" }) });
    await expect(monitores).toContainText(
      "tu nombre, tal como lo escribiste al crear tu cuenta, se muestra a estudiantes y visitantes en la lista de monitores de esa materia, junto con tus fechas libres y sus precios",
    );
    await expect(monitores).toContainText("Tu teléfono, tu correo y tu llave no se muestran a estudiantes ni a visitantes.");
    await expect(page.getByText("Última actualización: 1 de octubre de 2026.")).toBeVisible();

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
