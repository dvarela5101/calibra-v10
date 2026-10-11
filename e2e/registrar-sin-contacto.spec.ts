import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-089: el admin registra en la tarjeta de un Lead que pidió no recibir más mensajes. Corre contra el Supabase local.
// La lista es de todos los admins: cada prueba pone a sus Leads un origen único y filtra por él (como
// e2e/gestionar-leads.spec.ts).

const ESPERA = { timeout: 20_000 };

type DatosDeLead = { nombre?: string; fecha: string; aceptaContacto?: boolean; estado?: "nuevo" | "contactado" | "descartado" };

type Escenario = {
  origen: string;
  lead(datos: DatosDeLead): Promise<{ id: string; nombre: string; correo: string }>;
  leer(id: string): Promise<{ estado: string; acepta_contacto: boolean }>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const origen = `e2e-hu089-${randomUUID().slice(0, 8)}`;
    const leads: string[] = [];

    await entregar({
      origen,
      async lead({ nombre = `Lead e2e ${randomUUID().slice(0, 6)}`, fecha, aceptaContacto = true, estado = "nuevo" }) {
        const correo = `lead-e2e-${randomUUID()}@calibra.test`;
        const { data, error } = await cliente
          .from("lead")
          .insert({
            nombre,
            correo,
            numero_telefono: `+57300${String(randomInt(0, 10_000_000)).padStart(7, "0")}`,
            origen,
            acepta_tratamiento_datos: true,
            fecha_consentimiento: fecha,
            fecha_creacion: fecha,
            acepta_contacto: aceptaContacto,
            estado,
          })
          .select("id")
          .single();
        if (error) throw new Error(`crear lead: ${error.message}`);
        leads.push(data.id);
        return { id: data.id, nombre, correo };
      },
      async leer(id) {
        const { data, error } = await cliente.from("lead").select("estado, acepta_contacto").eq("id", id).single();
        if (error) throw new Error(`leer lead: ${error.message}`);
        return data;
      },
    });

    if (leads.length) {
      const { error } = await cliente.from("lead").delete().in("id", leads);
      if (error) throw new Error(`No se pudieron borrar los leads de la prueba: ${error.message}`);
    }
  },
});

test.describe.configure({ mode: "default", timeout: 90_000 });

/** Ingresa y abre la ruta. `exigirRol` vuelve a `/admin/leads` sin los filtros: se abren después. */
async function entrar(page: Page, ruta: string, cuenta: Cuenta): Promise<void> {
  await page.goto(ruta);
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin%2Fleads", ESPERA);
  await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
  await expect(page).toHaveURL("/admin/leads", ESPERA);
  await page.goto(ruta);
}

const tarjetaDe = (page: Page, nombre: string) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: nombre }) });

test.describe("Criterios 1 a 5 y 8 · registrar el pedido", () => {
  test("cancela sin cambiar nada, confirma, ve la nota y el Lead deja de salir en la descarga", async ({ page, cuentas, escenario }) => {
    const lead = await escenario.lead({ fecha: "2026-03-02T15:30:00Z", estado: "contactado" });
    const otro = await escenario.lead({ fecha: "2026-03-01T00:00:00Z" });
    const admin = await cuentas.crearAdmin();
    const errores: string[] = [];
    page.on("pageerror", (error) => errores.push(error.message));
    await entrar(page, `/admin/leads?origen=${escenario.origen}&contacto=todos`, admin);
    await expect(page.getByRole("link", { name: "Descargar para contactar (2)" })).toBeVisible(ESPERA);

    const tarjeta = tarjetaDe(page, lead.nombre);
    const boton = tarjeta.getByRole("button", { name: "Pidió no recibir mensajes" });
    await boton.click();
    await expect(
      tarjeta.getByText(
        `¿Registrar que ${lead.nombre} pidió no recibir más mensajes? Dejará de salir en la lista para contactar y no se puede deshacer desde esta pantalla.`,
      ),
    ).toBeVisible();
    await tarjeta.getByRole("button", { name: "Cancelar" }).click();
    await expect(boton).toBeFocused();
    expect(await escenario.leer(lead.id)).toEqual({ estado: "contactado", acepta_contacto: true });

    await boton.click();
    await tarjeta.getByRole("button", { name: "Sí, registrar" }).click();
    await expect(tarjeta.getByText(new RegExp(`^Pidió no recibir mensajes\\. Lo registró ${admin.nombre} el `))).toBeVisible(ESPERA);
    await expect(tarjeta.getByRole("button", { name: "Pidió no recibir mensajes" })).toHaveCount(0);
    await expect(tarjeta.locator("dt", { hasText: "Acepta contacto" }).locator("+ dd")).toHaveText("No");
    // No cambia el estado ni dice «descartado» ni «retiró su autorización».
    await expect(tarjeta.getByText("Contactado", { exact: true })).toBeVisible();
    await expect(tarjeta.getByText(/retiró su autorización/i)).toHaveCount(0);
    expect(await escenario.leer(lead.id)).toEqual({ estado: "contactado", acepta_contacto: false });

    await page.reload();
    await expect(tarjeta.getByText(/^Pidió no recibir mensajes\. Lo registró/)).toBeVisible(ESPERA);

    // La descarga baja en uno y el archivo no lo trae.
    const descargar = page.getByRole("link", { name: "Descargar para contactar (1)" });
    const [descarga] = await Promise.all([page.waitForEvent("download"), descargar.click()]);
    const contenido = await readFile(await descarga.path(), "utf8");
    expect(contenido).not.toContain(lead.correo);
    expect(contenido).toContain(otro.correo);

    // Con el filtro por defecto («Sí») ya no aparece; con «No», sí.
    await page.goto(`/admin/leads?origen=${escenario.origen}`);
    await expect(tarjetaDe(page, otro.nombre)).toBeVisible(ESPERA);
    await expect(tarjetaDe(page, lead.nombre)).toHaveCount(0);
    await page.goto(`/admin/leads?origen=${escenario.origen}&contacto=no`);
    await expect(tarjetaDe(page, lead.nombre).getByText(/^Pidió no recibir mensajes\./)).toBeVisible(ESPERA);
    expect(errores).toEqual([]);
  });

  test("el botón sale también en un descartado, y no en quien ya no acepta contacto", async ({ page, cuentas, escenario }) => {
    const descartado = await escenario.lead({ fecha: "2026-03-01T00:00:00Z", estado: "descartado" });
    const sinContacto = await escenario.lead({ fecha: "2026-03-02T00:00:00Z", aceptaContacto: false });
    const admin = await cuentas.crearAdmin();
    await entrar(page, `/admin/leads?origen=${escenario.origen}&contacto=todos`, admin);

    await expect(tarjetaDe(page, descartado.nombre).getByRole("button", { name: "Pidió no recibir mensajes" })).toBeVisible(ESPERA);
    await expect(tarjetaDe(page, sinContacto.nombre).getByRole("button", { name: "Pidió no recibir mensajes" })).toHaveCount(0);
    // Quien apagó la casilla por su cuenta no lo pidió: no hay nota.
    await expect(tarjetaDe(page, sinContacto.nombre).getByText(/Pidió no recibir mensajes/)).toHaveCount(0);
  });
});

test.describe("Criterio 11 · accesibilidad", () => {
  test("la confirmación se opera con el teclado y cumple las medidas", async ({ page, cuentas, escenario }) => {
    const lead = await escenario.lead({ fecha: "2026-03-01T00:00:00Z", nombre: "Un nombre bastante largo para una tarjeta angosta" });
    const admin = await cuentas.crearAdmin();
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, `/admin/leads?origen=${escenario.origen}`, admin);

    const tarjeta = tarjetaDe(page, lead.nombre);
    await tarjeta.getByRole("button", { name: "Pidió no recibir mensajes" }).focus();
    await page.keyboard.press("Enter");
    await expect(tarjeta.getByRole("button", { name: "Sí, registrar" })).toBeFocused();

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
    expect(medidas.sinScrollHorizontal).toBe(true);
    expect(medidas.menorTexto).toBeGreaterThanOrEqual(14);
    expect(medidas.degradados).toBe(0);
    for (const objetivo of await tarjeta.locator("button:visible, summary").all()) {
      const caja = await objetivo.boundingBox();
      expect(caja?.height ?? 0, await objetivo.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    }

    // Con el teclado: Tab hasta «Cancelar» y Enter cierra y devuelve el foco.
    await page.keyboard.press("Tab");
    await expect(tarjeta.getByRole("button", { name: "Cancelar" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(tarjeta.getByRole("button", { name: "Pidió no recibir mensajes" })).toBeFocused();
    expect(await escenario.leer(lead.id)).toEqual({ estado: "nuevo", acepta_contacto: true });
  });
});
