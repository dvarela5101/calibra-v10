import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-012: el admin entra y ve su bandeja. Corre contra el Supabase local (Auth y base) con datos
// que crea y borra cada prueba. Los desembolsos ejecutables son de todos los admins, así que otras
// pruebas en paralelo pueden agregar los suyos: de ellos solo se comprueba que aparezca el propio. Con la bandeja común
// de pagos (HU-034, D-56) pasa lo mismo con «Pagos por revisar»: el título y la tarjeta suman los pagos de todos los
// admins, así que no se espera un total exacto. Se mira la lista «Asignados a ti», que sí es exacta, y los pagos de
// otros se buscan por el nombre del pagador.

const ESPERA = { timeout: 20_000 };

// La semilla (supabase/seed.sql) crea estos admins; corre con `npm run db:reiniciar`.
const CONTRASENA_SEMILLA = "calibra-admin-local";

type Mundo = {
  /** El que llegó hace más tiempo: va primero. */
  nombrePagadorAntiguo: string;
  nombrePagadorIntermedio: string;
  /** El que llegó hace menos: va al final. */
  nombrePagadorReciente: string;
  /** El neto del desembolso de este mundo: distinto en cada prueba para reconocer el propio entre los de todos. */
  netoDesembolso: number;
};

/**
 * Datos de un admin: tres pagos en revisión (que llegaron hace 90, 20 y 10 minutos), dos reembolsos
 * (uno por estado), un reporte en revisión y un desembolso ejecutable con su pago aprobado. Se borran al terminar, antes
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
        nombrePagadorAntiguo: `Ana Antigua ${randomUUID().slice(0, 6)}`,
        nombrePagadorIntermedio: `Carla Intermedia ${randomUUID().slice(0, 6)}`,
        nombrePagadorReciente: `Beto Reciente ${randomUUID().slice(0, 6)}`,
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

      // La bandeja ordena por cuándo llegó el pago (`fecha_pago`, que la base pone en now()): se fija a mano (HU-034).
      await pago({ nombre_pagador: nombres.nombrePagadorAntiguo, fecha_pago: hace(90) });
      await pago({ nombre_pagador: nombres.nombrePagadorReciente, fecha_pago: hace(10) });
      await pago({ nombre_pagador: nombres.nombrePagadorIntermedio, fecha_pago: hace(20) });

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
      // Sin un pago aprobado no hay nada que transferir y la bandeja no lo lista (HU-028): el de la foto.
      await pago({ id_monitoria: ejecutable.id, monto: netoDesembolso + 2_000, estado: "aprobado", fecha_revision: hace(1) });
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

test.describe("Criterios 1 y 2 · el admin ve lo que tiene asignado y cuánto lleva esperando cada pago", () => {
  test("contadores, listas por sección y hace cuánto llegó cada pago", async ({ page, cuentas, mundo }) => {
    const admin = await cuentas.crearAdmin();
    const { nombrePagadorAntiguo, nombrePagadorIntermedio, nombrePagadorReciente, netoDesembolso } = await mundo(admin);

    await entrarComoAdmin(page, admin.correo, admin.contrasena);
    await expect(page).toHaveTitle("Administración · Calibra");
    await expect(page.getByRole("heading", { level: 1, name: `Hola, ${admin.nombre}` })).toBeVisible();

    // Contadores de arriba.
    const resumen = page.getByRole("navigation", { name: "Resumen de tu bandeja" });
    // La tarjeta suma los pagos de todos los admins (HU-034): con los de otras pruebas no hay un total exacto, pero
    // nunca son menos que los tres de este admin.
    const tarjetaDePagos = resumen.getByRole("link", { name: /^\d+ Pagos por revisar$/ });
    await expect(tarjetaDePagos).toBeVisible();
    expect(Number((await tarjetaDePagos.textContent())!.match(/\d+/)![0])).toBeGreaterThanOrEqual(3);
    await expect(resumen.getByRole("link", { name: "2 Reembolsos" })).toBeVisible();
    await expect(resumen.getByRole("link", { name: "1 Reportes en revisión" })).toBeVisible();
    await expect(resumen.getByRole("link", { name: /^\d+ Desembolsos ejecutables$/ })).toBeVisible();

    // Pagos por antigüedad (D-56): el que llegó hace más va primero y cada fila dice hace cuánto llegó. Solo la lista de
    // los suyos: debajo, en «De otros admins», puede haber pagos de los admins de otras pruebas.
    const pagos = page.getByRole("region", { name: /Pagos por revisar/ });
    const filas = pagos.getByRole("list", { name: "Asignados a ti" }).getByRole("listitem");
    await expect(filas).toHaveCount(3);
    await expect(filas.nth(0)).toContainText(nombrePagadorAntiguo);
    await expect(filas.nth(0)).toContainText("$ 25.000");
    await expect(filas.nth(0)).toContainText(/Llegó hace 1 h 3\d min/);
    await expect(filas.nth(1)).toContainText(nombrePagadorIntermedio);
    await expect(filas.nth(1)).toContainText(/Llegó hace 2\d min/);
    await expect(filas.nth(2)).toContainText(nombrePagadorReciente);
    await expect(filas.nth(2)).toContainText(/Llegó hace 1\d min/);
    // No es un plazo: ninguna fila promete tiempo ni dice que venció, y las propias no llevan «De …» (eso es de la otra lista).
    await expect(filas.getByText(/Quedan|Vencido/)).toHaveCount(0);
    await expect(filas.getByText(/^De /)).toHaveCount(0);

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
    // La ayuda de los pagos dice que cualquier admin activo los revisa y por qué orden salen, sin plazo ni cifras de
    // horas o de minutos (HU-034, HU-064): el orden por vencimiento y el paso al siguiente admin ya no existen.
    await expect(pagos).toContainText(
      "Cualquier admin activo puede aprobar o rechazar estos pagos desde que llegan, también los de otros. El que lleva más tiempo esperando va arriba. Los asignados a ti son los que te tocan según el orden de revisión.",
    );
    await expect(pagos).not.toContainText(/vence primero|Quedan|Vencido|hasta el/);
    await expect(page.locator("body")).not.toContainText("Lo que vence primero va arriba");
    await expect(page.locator("body")).not.toContainText(/siguiente admin/i);
    // Ni el bruto ni la comisión llegan a la pantalla (P-32).
    await expect(page.locator("body")).not.toContainText(`$ ${(netoDesembolso + 2_000).toLocaleString("es-CO")}`);
    await expect(page.locator("body")).not.toContainText("$ 2.000");
    await expect(page.locator("body")).not.toContainText(/comisi[oó]n/i);
  });

  test("con nada asignado, los pagos no traen la lista «Asignados a ti» y las demás secciones lo dicen en vez de quedar en blanco", async ({ page, cuentas }) => {
    const admin = await cuentas.crearAdmin();
    await entrarComoAdmin(page, admin.correo, admin.contrasena);

    const resumen = page.getByRole("navigation", { name: "Resumen de tu bandeja" });
    // «Pagos por revisar» suma los pagos de todos los admins (HU-034): con los de otras pruebas no vale 0 ni dice
    // «No hay pagos por revisar.». Lo exacto es que a este admin no le toca ninguno.
    await expect(resumen.getByRole("link", { name: /^\d+ Pagos por revisar$/ })).toBeVisible();
    await expect(page.getByRole("region", { name: /Pagos por revisar/ }).getByRole("list", { name: "Asignados a ti" })).toHaveCount(0);
    await expect(resumen.getByRole("link", { name: "0 Reembolsos" })).toBeVisible();
    await expect(resumen.getByRole("link", { name: "0 Reportes en revisión" })).toBeVisible();
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

test.describe("HU-034 · los pagos de otros admins desde que llegan", () => {
  test("otro admin los ve después de los suyos, todos desde el primer minuto, con de quién son y hace cuánto llegaron, el más antiguo arriba", async ({
    page,
    cuentas,
    mundo,
  }) => {
    const asignado = await cuentas.crearAdmin();
    const { nombrePagadorAntiguo, nombrePagadorIntermedio, nombrePagadorReciente } = await mundo(asignado);
    const otro = await cuentas.crearAdmin();
    await entrarComoAdmin(page, otro.correo, otro.contrasena);

    // Nada asignado a este admin: no sale la lista propia. La tarjeta y el título suman los pagos de todos los admins
    // (los tres de este mundo y los de otras pruebas), así que no se espera un total exacto.
    const resumen = page.getByRole("navigation", { name: "Resumen de tu bandeja" });
    const tarjetaDePagos = resumen.getByRole("link", { name: /^\d+ Pagos por revisar$/ });
    await expect(tarjetaDePagos).toBeVisible();
    expect(Number((await tarjetaDePagos.textContent())!.match(/\d+/)![0])).toBeGreaterThanOrEqual(3);
    const pagos = page.getByRole("region", { name: /Pagos por revisar/ });
    await expect(pagos.getByRole("list", { name: "Asignados a ti" })).toHaveCount(0);

    // Debajo, en la misma sección, los tres del otro admin. Puede haber de otras pruebas: se buscan los de este mundo.
    await expect(pagos.getByRole("heading", { level: 3, name: /^De otros admins \(\d+\)$/ })).toBeVisible();
    await expect(pagos.getByText("Le tocan a otro admin, pero puedes aprobarlos o rechazarlos tú.")).toBeVisible();
    const deOtros = pagos.getByRole("list", { name: /^De otros admins/ });
    const fila = (nombre: string) => deOtros.getByRole("link", { name: new RegExp(nombre) });
    await expect(fila(nombrePagadorAntiguo)).toContainText("$ 25.000");
    await expect(fila(nombrePagadorAntiguo)).toContainText(new RegExp(`De ${asignado.nombre} · Llegó hace 1 h 3\\d min`));
    await expect(fila(nombrePagadorIntermedio)).toContainText(new RegExp(`De ${asignado.nombre} · Llegó hace 2\\d min`));
    await expect(fila(nombrePagadorReciente)).toContainText(new RegExp(`De ${asignado.nombre} · Llegó hace 1\\d min`));
    // Nada de plazos: ninguno de los tres sale como vencido ni con tiempo restante, aunque el primero lleve más de una hora.
    await expect(deOtros.getByText(/Quedan|Vencido/)).toHaveCount(0);

    // El más antiguo va arriba: entre los de este mundo, el orden de las filas es el de llegada.
    const textos = await deOtros.getByRole("listitem").allTextContents();
    const posicion = (nombre: string) => textos.findIndex((texto) => texto.includes(nombre));
    expect(posicion(nombrePagadorAntiguo)).toBeGreaterThanOrEqual(0);
    expect(posicion(nombrePagadorAntiguo)).toBeLessThan(posicion(nombrePagadorIntermedio));
    expect(posicion(nombrePagadorIntermedio)).toBeLessThan(posicion(nombrePagadorReciente));

    // Lleva a la revisión del pago, que le dice de quién es y que ya puede revisarlo él.
    await fila(nombrePagadorReciente).click();
    await expect(page).toHaveURL(/\/admin\/pagos\/[0-9a-f-]{36}$/, ESPERA);
    await expect(
      page.getByText(`Este pago le toca a ${asignado.nombre} según el orden de revisión. Puedes aprobarlo o rechazarlo tú.`, { exact: true }),
    ).toBeVisible(ESPERA);
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
