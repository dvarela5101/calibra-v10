import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-012: el admin entra y ve su bandeja. Corre contra el Supabase local (Auth y base) con datos
// que crea y borra cada prueba. Los desembolsos ejecutables son de todos los admins, así que otras
// pruebas en paralelo pueden agregar los suyos: de ellos solo se comprueba que aparezca el propio.

const ESPERA = { timeout: 20_000 };

// La semilla (supabase/seed.sql) crea estos admins; corre con `npm run db:reiniciar`.
const CONTRASENA_SEMILLA = "calibra-admin-local";

type Mundo = {
  nombrePagadorVencido: string;
  nombrePagadorIntermedio: string;
  nombrePagadorVigente: string;
  /** El neto del desembolso de este mundo: distinto en cada prueba para reconocer el propio entre los de todos. */
  netoDesembolso: number;
};

/**
 * Datos de un admin: tres pagos en revisión (uno con la hora vencida y dos vigentes), dos reembolsos
 * (uno por estado), un reporte en revisión y un desembolso ejecutable. Se borran al terminar, antes
 * de que la fixture `cuentas` borre al admin y al monitor.
 */
const test = base.extend<{ mundo: (admin: Cuenta) => Promise<Mundo> }>({
  mundo: async ({ cuentas }, entregar) => {
    const tablas: [string, string[]][] = [
      ["reembolso", []],
      ["reporte_inasistencia", []],
      ["desembolso", []],
      ["pago", []],
      ["monitoria", []],
      ["franja", []],
      ["certificado", []],
      ["lead", []],
      ["materia", []],
    ];
    const creados = new Map(tablas);
    // Un pago solo puede apuntar a un comprobante revisado (HU-059). Su llave es la ruta, no un id.
    const revisados: string[] = [];

    async function insertar(tabla: string, fila: Record<string, unknown>) {
      const { data, error } = await cuentas.cliente.from(tabla).insert(fila).select().single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      creados.get(tabla)!.push(data.id as string);
      return data as { id: string };
    }

    await entregar(async (admin) => {
      const monitor = await cuentas.crearMonitor();
      const materia = await insertar("materia", { nombre: "Materia e2e", codigo: `E2E-${randomUUID().slice(0, 12)}` });
      await insertar("certificado", { id_monitor: monitor.id, id_materia: materia.id, id_admin: admin.id });
      const franja = await insertar("franja", {
        id_monitor: monitor.id,
        dia: 1,
        hora: "10:00",
        presencial: true,
        precio: 25_000,
        duracion_min: 60,
      });
      const lead = await insertar("lead", {
        nombre: "Lead e2e",
        correo: `lead-${randomUUID()}@calibra.test`,
        acepta_tratamiento_datos: true,
        fecha_consentimiento: new Date().toISOString(),
      });
      const monitoria = (fecha: string, extra: Record<string, unknown> = {}) =>
        insertar("monitoria", {
          id_franja: franja.id,
          id_monitor: monitor.id,
          id_materia: materia.id,
          id_lead: lead.id,
          fecha,
          valor_total: 25_000,
          ...extra,
        });

      const futura = await monitoria("2030-01-14");
      const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
      const netoDesembolso = 31_000 + Math.floor(Math.random() * 9_000);
      const nombres: Omit<Mundo, "netoDesembolso"> = {
        nombrePagadorVencido: `Ana Vencida ${randomUUID().slice(0, 6)}`,
        nombrePagadorIntermedio: `Carla Vigente ${randomUUID().slice(0, 6)}`,
        nombrePagadorVigente: `Beto Vigente ${randomUUID().slice(0, 6)}`,
      };
      const pago = async (extra: Record<string, unknown>) => {
        const comprobante = `${randomUUID()}/${randomUUID()}.png`;
        const { error } = await cuentas.cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
        if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
        revisados.push(comprobante);
        return insertar("pago", {
          id_monitoria: futura.id,
          monto: 25_000,
          contacto: "pagador@calibra.test",
          id_admin: admin.id,
          comprobante,
          nombre_pagador: "Pagador",
          ...extra,
        });
      };

      await pago({ nombre_pagador: nombres.nombrePagadorVencido, fecha_asignacion: hace(90) });
      await pago({ nombre_pagador: nombres.nombrePagadorVigente, fecha_asignacion: hace(10) });
      await pago({ nombre_pagador: nombres.nombrePagadorIntermedio, fecha_asignacion: hace(20) });

      const aprobado = () => pago({ estado: "aprobado", fecha_revision: hace(1) });
      const reembolsoBase = { id_admin: admin.id, monto: 25_000 };
      await insertar("reembolso", { ...reembolsoBase, motivo: "Cancelación e2e A", id_pago: (await aprobado()).id, estado: "esperando_llave" });
      await insertar("reembolso", {
        ...reembolsoBase,
        motivo: "Cancelación e2e B",
        id_pago: (await aprobado()).id,
        estado: "pendiente",
        llave_destino: "llave-e2e",
      });

      const conReporte = await monitoria("2020-01-13", { estado: "realizada", fecha_finalizacion: "2020-01-13T16:30:00+00:00" });
      await insertar("reporte_inasistencia", { id_monitoria: conReporte.id, id_admin: admin.id, estado: "en_revision" });

      const ejecutable = await monitoria("2020-01-06", { estado: "realizada", fecha_finalizacion: "2020-01-06T16:30:00+00:00" });
      await insertar("desembolso", {
        id_monitoria: ejecutable.id,
        monto_bruto: netoDesembolso + 2_000,
        comision: 2_000,
        monto_neto: netoDesembolso,
        llave_destino: "llave-e2e",
      });
      return { ...nombres, netoDesembolso };
    });

    // Limpieza en el orden de las claves foráneas; se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    for (const [tabla, ids] of creados) {
      if (ids.length === 0) continue;
      const { error } = await cuentas.cliente.from(tabla).delete().in("id", ids);
      if (error) fallos.push(`${tabla}: ${error.message}`);
    }
    // Después de los pagos, que les apuntan.
    if (revisados.length > 0) {
      const { error } = await cuentas.cliente.from("comprobante_revisado").delete().in("ruta", revisados);
      if (error) fallos.push(`comprobante_revisado: ${error.message}`);
    }
    if (fallos.length > 0) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

// Las pruebas de este archivo corren una tras otra en cada proyecto y comparten el Auth local (ver auth.spec.ts).
test.describe.configure({ mode: "default", timeout: 60_000 });

async function entrarComoAdmin(page: Page, correo: string, contrasena: string) {
  await page.goto("/admin");
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  await enviarCredenciales(page, correo, contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
}

test.describe("Criterios 1 y 2 · el admin ve lo que tiene asignado y cuánto le queda", () => {
  test("contadores, listas por sección y tiempo restante de los pagos", async ({ page, cuentas, mundo }) => {
    const admin = await cuentas.crearAdmin();
    const { nombrePagadorVencido, nombrePagadorIntermedio, nombrePagadorVigente, netoDesembolso } = await mundo(admin);

    await entrarComoAdmin(page, admin.correo, admin.contrasena);
    await expect(page).toHaveTitle("Administración · Calibra");
    await expect(page.getByRole("heading", { level: 1, name: `Hola, ${admin.nombre}` })).toBeVisible();

    // Contadores de arriba.
    const resumen = page.getByRole("navigation", { name: "Resumen de tu bandeja" });
    await expect(resumen.getByRole("link", { name: "3 Pagos por revisar" })).toBeVisible();
    await expect(resumen.getByRole("link", { name: "2 Reembolsos" })).toBeVisible();
    await expect(resumen.getByRole("link", { name: "1 Reportes en revisión" })).toBeVisible();
    await expect(resumen.getByRole("link", { name: /^\d+ Desembolsos ejecutables$/ })).toBeVisible();

    // Pagos por vencimiento: el que se asignó hace más va primero, ya vencido; los otros todavía tienen tiempo. Solo
    // la lista de los suyos: debajo puede haber pagos vencidos de los admins de otras pruebas (HU-077).
    const pagos = page.getByRole("region", { name: /Pagos por revisar/ });
    const filas = pagos.getByRole("list", { name: "Asignados a ti" }).getByRole("listitem");
    await expect(filas).toHaveCount(3);
    await expect(filas.nth(0)).toContainText(nombrePagadorVencido);
    await expect(filas.nth(0)).toContainText("$ 25.000");
    await expect(filas.nth(0)).toContainText(/Vencido hace (29|30|31|32) min/);
    await expect(filas.nth(1)).toContainText(nombrePagadorIntermedio);
    await expect(filas.nth(1)).toContainText(/Quedan (37|38|39|40) min/);
    await expect(filas.nth(2)).toContainText(nombrePagadorVigente);
    await expect(filas.nth(2)).toContainText(/Quedan (47|48|49|50) min/);

    // Reembolsos por estado.
    const reembolsos = page.getByRole("region", { name: /Reembolsos/ });
    await expect(reembolsos.getByRole("heading", { level: 3, name: "Esperando la llave del pagador (1)" })).toBeVisible();
    await expect(reembolsos.getByRole("heading", { level: 3, name: "Listos para transferir (1)" })).toBeVisible();
    // Cada reembolso bajo su estado: el que espera la llave, bajo el primer título; el listo, bajo el segundo.
    await expect(reembolsos.locator("h3:has-text('Esperando la llave') + ul li")).toHaveText(/Cancelación e2e A/);
    await expect(reembolsos.locator("h3:has-text('Listos para transferir') + ul li")).toHaveText(/Cancelación e2e B/);

    // Reportes y desembolsos.
    await expect(page.getByRole("region", { name: /Reportes en revisión/ })).toContainText("Sesión del 13 de enero de 2020");
    const desembolsos = page.getByRole("region", { name: /Desembolsos ejecutables/ });
    // El neto de este mundo es único: entre los desembolsos de todos los admins se reconoce el propio.
    await expect(desembolsos).toContainText(`Transferir $ ${netoDesembolso.toLocaleString("es-CO")}`);
    await expect(desembolsos).toContainText("Sesión del 6 de enero de 2020");
    await expect(desembolsos).toContainText("ejecutable después del");
    // La bandeja no promete lo que aún no existe (HU-064): el orden por vencimiento se anuncia solo en los pagos
    // y el paso al siguiente admin llega con HU-034.
    await expect(pagos).toContainText("el que vence primero va arriba");
    await expect(page.locator("body")).not.toContainText("Lo que vence primero va arriba");
    await expect(page.locator("body")).not.toContainText(/siguiente admin/i);
    // Ni el bruto ni la comisión llegan a la pantalla (P-32).
    await expect(page.locator("body")).not.toContainText(`$ ${(netoDesembolso + 2_000).toLocaleString("es-CO")}`);
    await expect(page.locator("body")).not.toContainText("$ 2.000");
    await expect(page.locator("body")).not.toContainText(/comisi[oó]n/i);
  });

  test("con nada asignado, cada sección lo dice en vez de quedar en blanco", async ({ page, cuentas }) => {
    const admin = await cuentas.crearAdmin();
    await entrarComoAdmin(page, admin.correo, admin.contrasena);

    const resumen = page.getByRole("navigation", { name: "Resumen de tu bandeja" });
    await expect(resumen.getByRole("link", { name: "0 Pagos por revisar" })).toBeVisible();
    await expect(resumen.getByRole("link", { name: "0 Reembolsos" })).toBeVisible();
    await expect(resumen.getByRole("link", { name: "0 Reportes en revisión" })).toBeVisible();
    await expect(page.getByText("No tienes pagos por revisar.")).toBeVisible();
    await expect(page.getByText("No tienes reembolsos por atender.")).toBeVisible();
    await expect(page.getByText("No tienes reportes en revisión.")).toBeVisible();
  });

  test("respeta las reglas de accesibilidad del producto", async ({ page, cuentas, mundo }) => {
    const admin = await cuentas.crearAdmin();
    await mundo(admin);
    await entrarComoAdmin(page, admin.correo, admin.contrasena);
    await expect(page.getByRole("heading", { level: 2, name: /Pagos por revisar/ })).toBeVisible();

    const medidas = await page.evaluate(() => {
      const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) =>
        [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
      );
      const enlaces = [...document.querySelectorAll<HTMLElement>("a, button")].map((el) => {
        const caja = el.getBoundingClientRect();
        return { texto: el.textContent?.trim() ?? "", alto: caja.height };
      });
      return {
        sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length,
        tactilesChicos: enlaces.filter((enlace) => enlace.alto < 44),
      };
    });

    expect(medidas.sinScrollHorizontal).toBe(true);
    expect(medidas.menorTexto).toBeGreaterThanOrEqual(14);
    expect(medidas.degradados).toBe(0);
    // Los contadores y el botón de salir son tocables: 44 px o más.
    expect(medidas.tactilesChicos).toEqual([]);
  });

  test("los contadores se acomodan al ancho y ninguna etiqueta se parte a mitad de palabra", async ({ page, cuentas, mundo }) => {
    const admin = await cuentas.crearAdmin();
    await mundo(admin);
    await entrarComoAdmin(page, admin.correo, admin.contrasena);
    await expect(page.getByRole("heading", { level: 2, name: /Pagos por revisar/ })).toBeVisible();

    // 390 y 834 px: dos columnas (cuatro a 834 px partirían "Desembolsos"); 1280 px: las cuatro en una fila.
    for (const [ancho, columnas] of [
      [390, 2],
      [768, 2],
      [834, 2],
      [1199, 2],
      [1280, 4],
    ] as const) {
      await page.setViewportSize({ width: ancho, height: 1000 });
      const medidas = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Resumen de tu bandeja"]')!;
        const lienzo = document.createElement("canvas").getContext("2d")!;
        const partidas: string[] = [];
        for (const rotulo of nav.querySelectorAll<HTMLElement>("a span:last-child")) {
          const estilo = getComputedStyle(rotulo);
          lienzo.font = `${estilo.fontWeight} ${estilo.fontSize} ${estilo.fontFamily}`;
          for (const palabra of (rotulo.textContent ?? "").split(/\s+/).filter(Boolean)) {
            if (lienzo.measureText(palabra).width > rotulo.clientWidth) partidas.push(palabra);
          }
        }
        return {
          columnas: getComputedStyle(nav.querySelector("ul")!).gridTemplateColumns.split(" ").length,
          partidas,
          sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        };
      });
      expect(medidas, `a ${ancho} px`).toEqual({ columnas, partidas: [], sinScrollHorizontal: true });
    }
  });

  test("un contador lleva a su sección", async ({ page, cuentas, mundo }) => {
    const admin = await cuentas.crearAdmin();
    await mundo(admin);
    await entrarComoAdmin(page, admin.correo, admin.contrasena);

    await page.getByRole("navigation", { name: "Resumen de tu bandeja" }).getByRole("link", { name: "1 Reportes en revisión" }).click();
    await expect(page).toHaveURL("/admin#reportes");
    await expect(page.getByRole("heading", { level: 2, name: /Reportes en revisión/ })).toBeInViewport();
  });
});

test.describe("HU-077 · los pagos vencidos de otros admins", () => {
  test("otro admin los ve después de los suyos, con de quién son y desde cuándo están vencidos; los que siguen en hora no", async ({
    page,
    cuentas,
    mundo,
  }) => {
    const asignado = await cuentas.crearAdmin();
    const { nombrePagadorVencido, nombrePagadorIntermedio, nombrePagadorVigente } = await mundo(asignado);
    const otro = await cuentas.crearAdmin();
    await entrarComoAdmin(page, otro.correo, otro.contrasena);

    // Nada asignado a este admin: el contador de arriba y la lista propia lo dicen.
    await expect(page.getByRole("navigation", { name: "Resumen de tu bandeja" }).getByRole("link", { name: "0 Pagos por revisar" })).toBeVisible();
    const pagos = page.getByRole("region", { name: /Pagos por revisar/ });
    await expect(pagos.getByText("No tienes pagos por revisar.")).toBeVisible();

    // Debajo, en la misma sección, el vencido del otro admin. Puede haber de otras pruebas: se busca el de este mundo.
    await expect(pagos.getByRole("heading", { level: 3, name: /^Vencidos de otros admins \(\d+\)$/ })).toBeVisible();
    const deOtros = pagos.getByRole("list", { name: /Vencidos de otros admins/ });
    const fila = deOtros.getByRole("link", { name: new RegExp(nombrePagadorVencido) });
    await expect(fila).toContainText("$ 25.000");
    await expect(fila).toContainText(new RegExp(`De ${asignado.nombre} · Vencido hace (29|30|31|32) min`));
    await expect(pagos).not.toContainText(nombrePagadorIntermedio);
    await expect(pagos).not.toContainText(nombrePagadorVigente);

    // Lleva a la revisión del pago, que le dice que ya puede revisarlo él.
    await fila.click();
    await expect(page).toHaveURL(/\/admin\/pagos\/[0-9a-f-]{36}$/, ESPERA);
    await expect(page.getByText(new RegExp(`^Este pago está asignado a ${asignado.nombre}, pero se le pasó la hora el .*Puedes aprobarlo o rechazarlo tú\\.$`))).toBeVisible(ESPERA);
  });
});

test.describe("Criterio 3 · la semilla deja admins iniciales que entran con su contraseña", () => {
  for (const [correo, nombre] of [
    ["admin1@calibra.test", "Admin Uno"],
    ["admin2@calibra.test", "Admin Dos"],
  ]) {
    test(`${correo} entra y ve su bandeja`, async ({ page }) => {
      await entrarComoAdmin(page, correo, CONTRASENA_SEMILLA);
      await expect(page.getByRole("heading", { level: 1, name: `Hola, ${nombre}` })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Resumen de tu bandeja" })).toBeVisible();
    });
  }
});
