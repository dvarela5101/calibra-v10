import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { diaDelNegocio, formatearDia } from "../src/lib/fechas";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-014: el admin certifica a un monitor por materia y el monitor ve sus materias certificadas. Corre contra
// el Supabase local (Auth y base) con cuentas y datos que crea y borra cada prueba. Las fechas salen de la zona
// del negocio. La lista de certificados emitidos es de todos los admins: otras pruebas en paralelo agregan los
// suyos, así que de la lista solo se comprueba que aparezca el propio y no su tamaño.

const ESPERA = { timeout: 20_000 };

// ---------------------------------------------------------------------------
// Fechas (America/Bogota, nunca la zona de la máquina que corre la prueba)
// ---------------------------------------------------------------------------
const hoy = () => diaDelNegocio(new Date());

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Escenario: monitores con contacto, materias y certificados que la prueba borra al terminar
// ---------------------------------------------------------------------------
type Materia = { id: string; nombre: string; codigo: string };
type Certificado = { id_materia: string; id_admin: string; fecha_emision: string; fecha_evaluacion: string };

type Escenario = {
  /** Un monitor con su contacto (`monitor_privado`), como el que crea la invitación de HU-013. Sin certificados. */
  monitor(): Promise<Cuenta>;
  /** Una materia con nombre y código únicos, para reconocerla entre las de las demás pruebas. */
  materia(): Promise<Materia>;
  /** Un certificado emitido con el cliente de confianza, con la fecha de la evaluación que se pida. */
  certificar(datos: { idMonitor: string; idMateria: string; idAdmin: string; fechaEvaluacion: string }): Promise<void>;
  /** Lo que la base guardó para ese monitor. */
  certificadosDe(idMonitor: string): Promise<Certificado[]>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const monitores: string[] = [];
    const materias: string[] = [];

    await entregar({
      async monitor() {
        // La fixture ya lo crea con su contacto y su llave en `monitor_privado`.
        const monitor = await cuentas.crearMonitor();
        monitores.push(monitor.id);
        return monitor;
      },
      async materia() {
        const nombre = `Materia e2e certificados ${randomUUID().slice(0, 6)}`;
        const codigo = `E2E-${randomUUID().slice(0, 12)}`;
        const { data, error } = await cliente.from("materia").insert({ nombre, codigo }).select("id").single();
        if (error) throw new Error(`insertar materia: ${error.message}`);
        materias.push(data.id as string);
        return { id: data.id as string, nombre, codigo };
      },
      async certificar(datos) {
        const { error } = await cliente.from("certificado").insert({
          id_monitor: datos.idMonitor,
          id_materia: datos.idMateria,
          id_admin: datos.idAdmin,
          fecha_evaluacion: datos.fechaEvaluacion,
        });
        if (error) throw new Error(`insertar certificado: ${error.message}`);
      },
      async certificadosDe(idMonitor) {
        const { data, error } = await cliente
          .from("certificado")
          .select("id_materia, id_admin, fecha_emision, fecha_evaluacion")
          .eq("id_monitor", idMonitor)
          .order("id_materia");
        if (error) throw new Error(`leer certificados: ${error.message}`);
        return data as Certificado[];
      },
    });

    // Limpieza, antes de que la fixture `cuentas` borre a los monitores y al admin (certificado.id_admin no cae en
    // cascada). Los certificados que emitió la interfaz se buscan por monitor y por materia.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (monitores.length) await borrar("certificados de los monitores", cliente.from("certificado").delete().in("id_monitor", monitores));
    if (materias.length) {
      await borrar("certificados de las materias", cliente.from("certificado").delete().in("id_materia", materias));
      await borrar("materias", cliente.from("materia").delete().in("id", materias));
    }
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 90_000 });

/** Entra por /ingresar a la ruta pedida: sin sesión, la página protegida manda a iniciar sesión. */
async function entrar(page: Page, ruta: string, cuenta: Cuenta): Promise<void> {
  await page.goto(ruta);
  await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
  await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
  await expect(page).toHaveURL(ruta, ESPERA);
}

const estado = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });

/** Los campos del formulario de certificar. Se piden a la página cada vez: el formulario se vuelve a montar tras un error. */
const formulario = (page: Page) => ({
  monitor: page.getByLabel("Monitor", { exact: true }),
  materia: page.getByLabel("Materia", { exact: true }),
  fecha: page.getByLabel("Fecha de la evaluación presencial"),
  certificar: page.getByRole("button", { name: "Certificar", exact: true }),
});

const etiquetaDelMonitor = (monitor: Cuenta) => `${monitor.nombre} · ${monitor.correo}`;
const etiquetaDeLaMateria = (materia: Materia) => `${materia.nombre} (${materia.codigo})`;

// ---------------------------------------------------------------------------
// Criterios 1 a 3: el admin certifica, no repite y el monitor ve sus materias
// ---------------------------------------------------------------------------
test.describe("Criterios 1 a 3 · el admin certifica a un monitor y el monitor ve sus materias certificadas", () => {
  test("el admin certifica desde su bandeja, la segunda vez en la misma materia se impide y el monitor ve sus materias y sus franjas", async ({
    page,
    browser,
    baseURL,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    const monitor = await escenario.monitor();
    const [calculo, fisica] = [await escenario.materia(), await escenario.materia()];
    const evaluacion = sumarDias(hoy(), -3);

    // Desde su bandeja llega a Certificar monitores.
    await entrar(page, "/admin", admin);
    await page.getByRole("link", { name: "Certificar monitores" }).click();
    await expect(page).toHaveURL("/admin/certificados", ESPERA);
    await expect(page).toHaveTitle("Certificar monitores · Calibra");
    await expect(page.getByRole("heading", { level: 1, name: "Certificar monitores" })).toBeVisible();
    // Los campos no dependen de React, pero el envío sí: hay que esperar a que la página termine de hidratarse.
    await page.waitForLoadState("networkidle");

    // El formulario parte con la evaluación en hoy y no deja elegir un día posterior.
    let campos = formulario(page);
    await expect(campos.fecha).toHaveValue(hoy());
    await expect(campos.fecha).toHaveAttribute("max", hoy());
    await expect(campos.monitor.locator("option", { hasText: etiquetaDelMonitor(monitor) })).toHaveCount(1);

    // Criterio 1: elige al monitor (con su correo), la materia y el día de su evaluación presencial, y certifica.
    const antes = hoy();
    await campos.monitor.selectOption({ label: etiquetaDelMonitor(monitor) });
    await campos.materia.selectOption({ label: etiquetaDeLaMateria(calculo) });
    await campos.fecha.fill(evaluacion);
    await campos.certificar.click();

    await expect(estado(page, "quedó certificado")).toHaveText(
      `${monitor.nombre} quedó certificado en ${calculo.nombre}. Ya puede abrir sus franjas.`,
      ESPERA,
    );
    const despues = hoy();
    const [emitido] = await escenario.certificadosDe(monitor.id);
    expect(emitido).toMatchObject({ id_materia: calculo.id, id_admin: admin.id, fecha_evaluacion: evaluacion });
    // La fecha de emisión la pone la base (hoy en Bogotá; el día de al lado solo si la prueba cruzó la medianoche).
    expect([antes, despues]).toContain(emitido.fecha_emision);

    // El monitor aparece entre los certificados emitidos: la materia, el día de la evaluación, el de la emisión y el admin.
    const emitidos = page.getByRole("region", { name: /^Certificados emitidos \(\d+\)$/ });
    const deLaLista = emitidos.getByRole("listitem").filter({ hasText: monitor.nombre });
    await expect(deLaLista).toContainText(
      `${etiquetaDeLaMateria(calculo)}: evaluación del ${formatearDia(evaluacion)}, certificado el ${formatearDia(emitido.fecha_emision)} por ${admin.nombre}`,
      ESPERA,
    );

    // Criterio 2: certificarlo de nuevo en la misma materia se impide, con el aviso, y el formulario conserva lo elegido.
    campos = formulario(page);
    await campos.monitor.selectOption({ label: etiquetaDelMonitor(monitor) });
    await campos.materia.selectOption({ label: etiquetaDeLaMateria(calculo) });
    await campos.fecha.fill(evaluacion);
    await campos.certificar.click();

    await expect(alerta(page, "Ese monitor ya está certificado en esa materia.")).toBeVisible(ESPERA);
    await expect(estado(page, "quedó certificado")).toHaveCount(0);
    campos = formulario(page);
    await expect(campos.monitor).toHaveValue(monitor.id);
    await expect(campos.materia).toHaveValue(calculo.id);
    await expect(campos.fecha).toHaveValue(evaluacion);
    expect(await escenario.certificadosDe(monitor.id)).toEqual([emitido]);

    // Varias materias por monitor: sin volver a elegir al monitor, cambia la materia y certifica.
    await campos.materia.selectOption({ label: etiquetaDeLaMateria(fisica) });
    await campos.certificar.click();

    await expect(estado(page, "quedó certificado")).toHaveText(
      `${monitor.nombre} quedó certificado en ${fisica.nombre}. Ya puede abrir sus franjas.`,
      ESPERA,
    );
    await expect(alerta(page, "Ese monitor ya está certificado")).toHaveCount(0);
    const certificados = await escenario.certificadosDe(monitor.id);
    expect(certificados.map((c) => c.id_materia).sort()).toEqual([calculo.id, fisica.id].sort());
    // Un solo renglón por monitor, con una línea por materia.
    await expect(deLaLista).toHaveCount(1);
    await expect(deLaLista).toContainText(etiquetaDeLaMateria(calculo), ESPERA);
    await expect(deLaLista).toContainText(etiquetaDeLaMateria(fisica), ESPERA);

    // Criterio 3: el monitor entra y ve sus materias certificadas, con la fecha, y el enlace a sus franjas.
    const contexto = await browser.newContext({ baseURL, viewport: page.viewportSize() ?? undefined });
    try {
      const delMonitor = await contexto.newPage();
      await entrar(delMonitor, "/monitor", monitor);
      await expect(delMonitor.getByRole("heading", { level: 1, name: `Hola, ${monitor.nombre}` })).toBeVisible();
      await expect(delMonitor.getByText("Aún no tienes materias certificadas")).toHaveCount(0);

      const materias = delMonitor.getByRole("region", { name: "Tus materias certificadas" });
      await expect(materias.getByRole("listitem")).toHaveCount(2);
      for (const materia of [calculo, fisica]) {
        const propio = certificados.find((c) => c.id_materia === materia.id)!;
        await expect(materias.getByRole("listitem").filter({ hasText: materia.codigo })).toContainText(
          `${etiquetaDeLaMateria(materia)} · desde el ${formatearDia(propio.fecha_emision)}`,
        );
      }

      // Con certificado ya puede abrir franjas (el mensaje del admin lo promete).
      await delMonitor.getByRole("link", { name: "Mis franjas" }).click();
      await expect(delMonitor).toHaveURL("/monitor/franjas", ESPERA);
      await expect(delMonitor.getByRole("button", { name: "Abrir franja" })).toBeVisible(ESPERA);
      await expect(delMonitor.getByText(/necesitas al menos un certificado/)).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });

  test("el formulario pide cada dato y no acepta una evaluación posterior a hoy", async ({ page, cuentas, escenario }) => {
    const admin = await cuentas.crearAdmin();
    const monitor = await escenario.monitor();
    const materia = await escenario.materia();

    await entrar(page, "/admin/certificados", admin);
    await page.waitForLoadState("networkidle");

    // Sin elegir nada.
    await formulario(page).certificar.click();
    await expect(alerta(page, "Elige el monitor que vas a certificar.")).toBeVisible(ESPERA);

    // Con el monitor, pero sin materia.
    await formulario(page).monitor.selectOption({ label: etiquetaDelMonitor(monitor) });
    await formulario(page).certificar.click();
    await expect(alerta(page, "Elige la materia.")).toBeVisible(ESPERA);
    await expect(formulario(page).monitor).toHaveValue(monitor.id);

    // Sin fecha.
    await formulario(page).materia.selectOption({ label: etiquetaDeLaMateria(materia) });
    await formulario(page).fecha.fill("");
    await formulario(page).certificar.click();
    await expect(alerta(page, "Escribe la fecha de la evaluación presencial.")).toBeVisible(ESPERA);

    // Con una fecha posterior a hoy: el campo no la ofrece, pero si llega igual, el servidor la rechaza.
    await formulario(page).fecha.fill(sumarDias(hoy(), 1));
    await formulario(page).certificar.click();
    await expect(alerta(page, "La fecha de la evaluación no puede ser posterior a hoy.")).toBeVisible(ESPERA);
    await expect(formulario(page).materia).toHaveValue(materia.id);

    expect(await escenario.certificadosDe(monitor.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Certificar es solo del admin
// ---------------------------------------------------------------------------
test.describe("Certificar es solo del admin", () => {
  test("sin sesión pide iniciar sesión y un monitor termina en su panel, sin ver el formulario", async ({ page, cuentas, escenario }) => {
    const monitor = await escenario.monitor();

    // Sin sesión: /ingresar, con la ruta pedida para volver a ella si su rol la permite.
    await page.goto("/admin/certificados");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin%2Fcertificados", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: "Inicia sesión" })).toBeVisible();

    // El monitor entra, y la ruta de otro rol lo lleva a su panel.
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);

    // Con la sesión abierta, tampoco: vuelve a su panel y ni el formulario ni la lista llegan a la pantalla.
    await page.goto("/admin/certificados");
    await expect(page).toHaveURL("/monitor", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: `Hola, ${monitor.nombre}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Certificar monitores|Certificados emitidos/ })).toHaveCount(0);
    await expect(formulario(page).certificar).toHaveCount(0);
    await expect(formulario(page).fecha).toHaveCount(0);
    expect(await escenario.certificadosDe(monitor.id)).toEqual([]);
    void cuentas;
  });
});

// ---------------------------------------------------------------------------
// Accesibilidad del producto
// ---------------------------------------------------------------------------
test.describe("Accesibilidad", () => {
  test("Certificar monitores, con la lista y con un aviso a la vista, respeta las reglas de accesibilidad del producto", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    const monitor = await escenario.monitor();
    const materia = await escenario.materia();
    await escenario.certificar({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id, fechaEvaluacion: sumarDias(hoy(), -10) });

    await entrar(page, "/admin/certificados", admin);
    await expect(page.getByRole("heading", { level: 2, name: /^Certificados emitidos \(\d+\)$/ })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: monitor.nombre })).toContainText(etiquetaDeLaMateria(materia));
    await page.waitForLoadState("networkidle");
    const enReposo = await medir(page);

    // Con el aviso de error a la vista.
    await formulario(page).certificar.click();
    await expect(alerta(page, "Elige el monitor que vas a certificar.")).toBeVisible(ESPERA);
    const conAviso = await medir(page);

    for (const [pantalla, medidas] of [
      ["en reposo", enReposo],
      ["con un aviso", conAviso],
    ] as const) {
      expect(medidas.sinScrollHorizontal, `${pantalla}: sin scroll horizontal`).toBe(true);
      expect(medidas.menorTexto, `${pantalla}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
      expect(medidas.degradados, `${pantalla}: sin degradados`).toBe(0);
      expect(medidas.tactilesChicos, `${pantalla}: áreas táctiles de 44 px o más`).toEqual([]);
      expect(medidas.controlesSinNombre, `${pantalla}: todo control tiene nombre`).toEqual([]);
    }
  });
});

/** Las reglas del producto sobre la página abierta: texto, áreas táctiles, degradados y nombres (como en franjas.spec.ts). */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) =>
      [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    // Enlaces, botones y campos.
    const tocables = [...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden])")].filter(visible);
    return {
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
      degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length,
      tactilesChicos: tocables
        .map((el) => ({ texto: (el.textContent || el.id || el.tagName).trim().slice(0, 40), alto: Math.round(el.getBoundingClientRect().height) }))
        .filter((el) => el.alto < 44),
      controlesSinNombre: tocables
        .filter((el) => {
          const etiqueta = (el as HTMLInputElement).labels?.length ?? 0;
          return !(el.textContent?.trim() || el.getAttribute("aria-label") || etiqueta);
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    };
  });
}
