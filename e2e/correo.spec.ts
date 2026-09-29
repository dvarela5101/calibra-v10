import type { Page } from "@playwright/test";
import { enviarCredenciales, expect, test } from "./utilidades";

// HU-006, criterio 4: ninguna llave del proveedor de correo se expone en el cliente web. Se descarga el
// JavaScript que de verdad recibe un navegador, en las páginas públicas y en la del admin, y se busca
// en él lo que solo debería existir en el servidor. pruebas/correo-sin-llaves.test.ts lo vigila en el código.

test.describe.configure({ mode: "default", timeout: 60_000 });

/** Lo que solo puede aparecer en el servidor: la dirección del proveedor, sus variables y sus cabeceras. */
const RASTROS_DEL_SERVIDOR = ["api.resend.com", "RESEND_API_KEY", "CORREO_REMITENTE", "Idempotency-Key", "/api/v1/send"];

/** Las direcciones de todos los .js que la página cargó, tanto los <script> como los que se pidieron después. */
async function scriptsCargados(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const deLaPagina = [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map((s) => s.src);
    const pedidos = performance
      .getEntriesByType("resource")
      .map((entrada) => entrada.name)
      .filter((nombre) => /\.js(\?|$)/.test(nombre));
    return [...new Set([...deLaPagina, ...pedidos])];
  });
}

test("ninguna página entrega al navegador la llave ni el código del proveedor de correo", async ({ page, cuentas }) => {
  const admin = await cuentas.crearAdmin();
  const recolectados = new Set<string>();
  const htmls: [string, string][] = [];

  for (const ruta of ["/", "/ingresar", "/restablecer"]) {
    await page.goto(ruta);
    await page.waitForLoadState("networkidle");
    htmls.push([ruta, await page.content()]);
    for (const url of await scriptsCargados(page)) recolectados.add(url);
  }

  await page.goto("/ingresar?siguiente=%2Fadmin");
  await enviarCredenciales(page, admin.correo, admin.contrasena);
  await expect(page).toHaveURL("/admin", { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  htmls.push(["/admin", await page.content()]);
  for (const url of await scriptsCargados(page)) recolectados.add(url);

  // La prueba no es vacía: se revisaron scripts de verdad.
  expect(recolectados.size).toBeGreaterThan(2);

  for (const url of recolectados) {
    const respuesta = await page.request.get(url);
    expect(respuesta.ok(), url).toBe(true);
    const codigo = await respuesta.text();
    for (const rastro of RASTROS_DEL_SERVIDOR) {
      expect(codigo.includes(rastro), `${rastro} aparece en ${url}`).toBe(false);
    }
  }
  for (const [ruta, html] of htmls) {
    for (const rastro of RASTROS_DEL_SERVIDOR) {
      expect(html.includes(rastro), `${rastro} aparece en el HTML de ${ruta}`).toBe(false);
    }
  }
});
