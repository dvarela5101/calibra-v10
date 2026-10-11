import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-053: el admin ve los Leads, los filtra, les cambia el estado y descarga los que puede contactar. Corre contra el
// Supabase local. La lista es de todos los admins: cada prueba pone a sus Leads un origen único y filtra por él.

const ESPERA = { timeout: 20_000 };

type DatosDeLead = { nombre?: string; fecha: string; aceptaContacto?: boolean; estado?: "nuevo" | "contactado" | "descartado" };

type Escenario = {
  /** El origen único de esta prueba: sus Leads lo llevan. */
  origen: string;
  lead(datos: DatosDeLead): Promise<{ id: string; nombre: string; correo: string; telefono: string }>;
  estadoDe(id: string): Promise<string>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const origen = `e2e-hu053-${randomUUID().slice(0, 8)}`;
    const leads: string[] = [];

    await entregar({
      origen,
      async lead({ nombre = `Lead e2e ${randomUUID().slice(0, 6)}`, fecha, aceptaContacto = true, estado = "nuevo" }) {
        const correo = `lead-e2e-${randomUUID()}@calibra.test`;
        const telefono = `+57300${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
        const { data, error } = await cliente
          .from("lead")
          .insert({
            nombre,
            correo,
            numero_telefono: telefono,
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
        return { id: data.id, nombre, correo, telefono };
      },
      async estadoDe(id) {
        const { data, error } = await cliente.from("lead").select("estado").eq("id", id).single();
        if (error) throw new Error(`leer lead: ${error.message}`);
        return data.estado;
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

/** La fecha de hoy en Bogotá, como la lleva el nombre del archivo. */
function hoyEnBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

test.describe("Criterios 1, 3, 4 y 7 a 9 · la lista y el cambio de estado", () => {
  test("llega desde su bandeja, ve el Lead con sus datos, lo marca contactado y lo descarta", async ({ page, cuentas, escenario }) => {
    const lead = await escenario.lead({ fecha: "2026-03-02T15:30:00Z" });
    const admin = await cuentas.crearAdmin();
    const errores: string[] = [];
    page.on("pageerror", (error) => errores.push(error.message));

    await page.goto("/admin");
    await enviarCredenciales(page, admin.correo, admin.contrasena);
    await expect(page).toHaveURL("/admin", ESPERA);
    await page.getByRole("link", { name: "Leads", exact: true }).click();
    await expect(page).toHaveURL("/admin/leads", ESPERA);
    await expect(page).toHaveTitle("Leads · Calibra");
    // Por defecto, solo quienes aceptaron contacto, y la página lo dice.
    await expect(page.getByLabel("Acepta contacto")).toHaveValue("si");
    await expect(page.getByText("Muestra solo a quienes marcaron «Quiero que Calibra me escriba con novedades y ofertas»")).toBeVisible();

    await page.goto(`/admin/leads?origen=${escenario.origen}`);
    await expect(page.getByText("Leads 1 a 1 de 1.")).toBeVisible(ESPERA);
    await expect(page.getByLabel("Origen")).toHaveValue(escenario.origen);
    const tarjeta = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: lead.nombre }) });
    await expect(tarjeta.getByText("Nuevo", { exact: true })).toBeVisible();
    await expect(tarjeta.getByText(escenario.origen)).toBeVisible();
    await expect(tarjeta.getByText("Sin materia")).toBeVisible();
    // 15:30 UTC son las 10:30 a. m. en Bogotá.
    await expect(tarjeta.getByText(/Dejó su contacto el .*10:30/)).toBeVisible();
    await expect(tarjeta.getByRole("link", { name: lead.correo })).toHaveAttribute("href", `mailto:${lead.correo}`);
    await expect(tarjeta.getByRole("link", { name: lead.telefono })).toHaveAttribute("href", `tel:${lead.telefono}`);
    await expect(tarjeta.getByText(/^Lo marcó/)).toHaveCount(0);

    const contactado = tarjeta.getByRole("button", { name: "Marcar como contactado" });
    await expect(contactado).toHaveAttribute("aria-pressed", "false");
    await contactado.click();
    await expect(tarjeta.getByRole("status")).toHaveText("Quedó como contactado.", ESPERA);
    await expect(tarjeta.getByText("Contactado", { exact: true })).toBeVisible();
    await expect(contactado).toHaveAttribute("aria-pressed", "true");
    await expect(contactado).toBeFocused();
    await expect(tarjeta.getByText(`Lo marcó ${admin.nombre} el`)).toBeVisible();
    expect(await escenario.estadoDe(lead.id)).toBe("contactado");

    await page.reload();
    await expect(tarjeta.getByText("Contactado", { exact: true })).toBeVisible(ESPERA);

    // Descartar se confirma en la misma tarjeta y avisa que no se deshace.
    await tarjeta.getByText("Descartar", { exact: true }).click();
    await expect(tarjeta.getByText("no se puede volver a cambiar desde esta pantalla")).toBeVisible();
    await tarjeta.getByRole("button", { name: `Sí, descartar a ${lead.nombre}` }).click();
    await expect(tarjeta.getByText("Descartado", { exact: true })).toBeVisible(ESPERA);
    await expect(tarjeta.getByRole("button")).toHaveCount(0);
    expect(await escenario.estadoDe(lead.id)).toBe("descartado");
    expect(errores).toEqual([]);
  });

  test("el formulario de filtros deja todo en la dirección y un filtro sin resultados lo dice", async ({ page, cuentas, escenario }) => {
    const nuevo = await escenario.lead({ fecha: "2026-03-01T00:00:00Z" });
    const contactado = await escenario.lead({ fecha: "2026-03-02T00:00:00Z", estado: "contactado" });
    const sinContacto = await escenario.lead({ fecha: "2026-03-03T00:00:00Z", aceptaContacto: false });
    const admin = await cuentas.crearAdmin();
    await entrar(page, `/admin/leads?origen=${escenario.origen}`, admin);

    const nombres = () => page.getByRole("listitem").getByRole("heading", { level: 2 }).allTextContents();
    expect(await nombres()).toEqual([contactado.nombre, nuevo.nombre]);

    await page.getByLabel("Estado", { exact: true }).selectOption("contactado");
    await page.getByLabel("Acepta contacto").selectOption("todos");
    await page.getByRole("button", { name: "Filtrar" }).click();
    // Un formulario GET manda también los vacíos (`materia=`), que cuentan como «Todas».
    await expect(page).toHaveURL(/contacto=todos/, ESPERA);
    const consulta = new URL(page.url()).searchParams;
    expect([consulta.get("estado"), consulta.get("origen"), consulta.get("materia")]).toEqual(["contactado", escenario.origen, ""]);
    expect(await nombres()).toEqual([contactado.nombre]);
    await expect(page.getByLabel("Estado", { exact: true })).toHaveValue("contactado");

    await page.goto(`/admin/leads?origen=${escenario.origen}&contacto=no`);
    expect(await nombres()).toEqual([sinContacto.nombre]);

    // Un valor que no existe cuenta como «Todos».
    await page.goto(`/admin/leads?origen=${escenario.origen}&estado=x`);
    expect(await nombres()).toEqual([contactado.nombre, nuevo.nombre]);

    await page.goto(`/admin/leads?origen=${escenario.origen}&estado=descartado`);
    await expect(page.getByText("Ningún lead cumple estos filtros.")).toBeVisible(ESPERA);
    await expect(page.getByRole("link", { name: "Quitar los filtros" }).first()).toHaveAttribute("href", "/admin/leads");

    await page.goto(`/admin/leads?origen=${escenario.origen}&pagina=9`);
    await expect(page.getByText("Esta página no tiene leads.")).toBeVisible(ESPERA);
    await expect(page.getByRole("link", { name: "Ir a la primera página" })).toHaveAttribute(
      "href",
      `/admin/leads?origen=${escenario.origen}`,
    );
  });
});

test.describe("Criterios 11 a 16 · la descarga para contactar", () => {
  test("baja el CSV con los que aceptaron contacto y no están descartados; sin ninguno, el botón no lleva a nada", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const viejo = await escenario.lead({ fecha: "2026-03-01T00:00:00Z", nombre: "=Formula e2e" });
    const nuevo = await escenario.lead({ fecha: "2026-03-02T00:00:00Z" });
    await escenario.lead({ fecha: "2026-03-03T00:00:00Z", aceptaContacto: false });
    await escenario.lead({ fecha: "2026-03-04T00:00:00Z", estado: "descartado" });
    const admin = await cuentas.crearAdmin();
    // Con «Todos» en la pantalla, la descarga sigue trayendo solo a quienes aceptaron.
    await entrar(page, `/admin/leads?origen=${escenario.origen}&contacto=todos`, admin);

    await expect(page.getByText("El archivo trae datos personales. Guárdalo en un lugar seguro y bórralo cuando termines.")).toBeVisible();
    const boton = page.getByRole("link", { name: "Descargar para contactar (2)" });
    await expect(boton).toHaveAttribute("href", `/admin/leads/exportar?origen=${escenario.origen}`);
    const [descarga] = await Promise.all([page.waitForEvent("download"), boton.click()]);
    expect(descarga.suggestedFilename()).toBe(`leads-para-contactar-${hoyEnBogota()}.csv`);
    const ruta = await descarga.path();
    const contenido = await readFile(ruta, "utf8");
    expect(contenido.startsWith("﻿")).toBe(true);
    const filas = contenido.slice(1).trimEnd().split("\r\n");
    expect(filas[0]).toBe("Nombre;Correo;Teléfono;Estado;Origen;Materias;Dejó su contacto");
    expect(filas).toHaveLength(3);
    expect(filas[1]).toContain(nuevo.correo);
    expect(filas[1]).toContain(nuevo.telefono);
    expect(filas[2]).toContain("'=Formula e2e");
    expect(filas[2]).toContain(viejo.correo);

    // Sin leads para contactar: «(0)», sin enlace.
    await page.goto(`/admin/leads?origen=${escenario.origen}&estado=descartado&contacto=todos`);
    await expect(page.getByText("Descargar para contactar (0)", { exact: true })).toBeVisible(ESPERA);
    await expect(page.getByRole("link", { name: /Descargar para contactar/ })).toHaveCount(0);

    // Armada a mano, la dirección de descarga trae solo los encabezados.
    const respuesta = await page.request.get(`/admin/leads/exportar?origen=${escenario.origen}&estado=descartado`);
    expect(respuesta.headers()["cache-control"]).toContain("no-store");
    expect((await respuesta.text()).slice(1).trimEnd().split("\r\n")).toHaveLength(1);
  });
});

test.describe("Criterio 2 · nadie más entra", () => {
  test("sin sesión, la lista y la descarga llevan a ingresar; un monitor vuelve a su panel", async ({ page, cuentas }) => {
    await page.goto("/admin/leads/exportar");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin%2Fleads", ESPERA);

    const monitor = await cuentas.crearMonitor();
    await page.goto("/admin/leads");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin%2Fleads", ESPERA);
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);
    await page.goto("/admin/leads");
    await expect(page).toHaveURL("/monitor", ESPERA);
    await page.goto("/admin/leads/exportar");
    await expect(page).toHaveURL("/monitor", ESPERA);
  });
});

test.describe("Criterio 18 · accesibilidad", () => {
  test("en 390 px no hay scroll horizontal, ni texto de menos de 14 px, ni áreas táctiles pequeñas", async ({ page, cuentas, escenario }) => {
    await escenario.lead({ fecha: "2026-03-01T00:00:00Z" });
    await escenario.lead({ fecha: "2026-03-02T00:00:00Z", estado: "contactado", nombre: "Un nombre bastante largo para una tarjeta angosta" });
    await escenario.lead({ fecha: "2026-03-03T00:00:00Z", estado: "descartado" });
    const admin = await cuentas.crearAdmin();
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page, `/admin/leads?origen=${escenario.origen}`, admin);
    await page.getByText("Descartar", { exact: true }).first().click();

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

    for (const objetivo of await page.locator("main a:visible, main button:visible, main select, main summary").all()) {
      const caja = await objetivo.boundingBox();
      expect(caja?.height ?? 0, await objetivo.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    }
  });
});
