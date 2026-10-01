import type { Page } from "@playwright/test";
import { enviarCredenciales, expect, test, type Cuenta } from "./utilidades";

// HU-054: el equipo de admins en /admin/equipo. Corre contra el Supabase local con admins que crea y borra cada
// prueba. Otras pruebas crean admins en paralelo y la lista es de todos: solo se miran las tarjetas propias.

const ESPERA = { timeout: 20_000 };
const RUTA = "/admin/equipo";

async function entrar(page: Page, cuenta: Cuenta): Promise<void> {
  await page.goto("/admin");
  await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent("/admin")}`, ESPERA);
  await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
  await page.getByRole("link", { name: "Equipo de admins" }).click();
  await expect(page).toHaveURL(RUTA, ESPERA);
}

const tarjeta = (page: Page, nombre: string) => page.getByRole("listitem").filter({ hasText: nombre });

test.describe("Equipo de admins (HU-054)", () => {
  test("se llega desde la bandeja, se ve el orden y a uno mismo no se le ofrece desactivarse", async ({ page, cuentas }) => {
    const yo = await cuentas.crearAdmin();
    const otro = await cuentas.crearAdmin();
    await entrar(page, yo);

    await expect(page.getByRole("heading", { level: 1, name: "Equipo de admins" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Orden de revisión" })).toBeVisible();
    await expect(tarjeta(page, `${yo.nombre} (tú)`)).toBeVisible();
    await expect(tarjeta(page, `${yo.nombre} (tú)`).getByText(`Desactivar a ${yo.nombre}`, { exact: true })).toHaveCount(0);
    await expect(tarjeta(page, otro.nombre)).toContainText("Activo · Sin casos abiertos");
  });

  test("criterio 1: subir a un admin cambia el orden", async ({ page, cuentas }) => {
    const yo = await cuentas.crearAdmin();
    await entrar(page, yo);

    // Si quedó primero, se baja; si no, se sube. Cualquiera de los dos cambia el orden.
    const propia = tarjeta(page, `${yo.nombre} (tú)`);
    const boton = (await propia.getByRole("button", { name: "Subir" }).count()) > 0 ? "Subir" : "Bajar";
    await propia.getByRole("button", { name: boton }).click();

    await expect(page.getByRole("status")).toHaveText("Listo: el orden de revisión cambió.", ESPERA);
  });

  test("criterios 2 y 3: desactivar a otro admin pide confirmación y lo deja desactivado", async ({ page, cuentas }) => {
    const yo = await cuentas.crearAdmin();
    const otro = await cuentas.crearAdmin();
    await entrar(page, yo);

    const suya = tarjeta(page, otro.nombre);
    await suya.getByText(`Desactivar a ${otro.nombre}`, { exact: true }).click();
    await expect(suya.getByText(`${otro.nombre} ya no podrá entrar a Calibra. Sus certificados y revisiones se conservan.`)).toBeVisible();
    await suya.getByRole("button", { name: `Sí, desactivar a ${otro.nombre}` }).click();

    await expect(page.getByRole("status")).toHaveText(`${otro.nombre} quedó desactivado: ya no puede entrar.`, ESPERA);
    await expect(tarjeta(page, otro.nombre)).toContainText("Desactivado");
    await expect(tarjeta(page, otro.nombre).getByText(`Desactivar a ${otro.nombre}`, { exact: true })).toHaveCount(0);

    // La fila se conserva (RN-23).
    const { data } = await cuentas.cliente.from("admin").select("id").eq("id", otro.id).single();
    expect(data?.id).toBe(otro.id);
  });

  test("un monitor no entra al equipo", async ({ page, cuentas }) => {
    const monitor = await cuentas.crearMonitor();
    await page.goto(RUTA);
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);
  });

  test("respeta las reglas de accesibilidad del producto", async ({ page, cuentas }) => {
    const yo = await cuentas.crearAdmin();
    await cuentas.crearAdmin();
    await entrar(page, yo);

    const medidas = await page.evaluate(() => {
      const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) =>
        [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
      );
      return {
        sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
      };
    });
    expect(medidas.sinScrollHorizontal).toBe(true);
    expect(medidas.menorTexto).toBeGreaterThanOrEqual(14);

    for (const control of await page.locator("main button:visible, main summary:visible").all()) {
      const caja = await control.boundingBox();
      expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
