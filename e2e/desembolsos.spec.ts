import { randomInt, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { diaDelNegocio, formatearDia, formatearFechaHora } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-028: el admin abre un desembolso ejecutable desde su bandeja, le transfiere al monitor y registra la referencia y
// la fecha. Corre contra el Supabase local (Auth y base) y el servidor de Next con la configuración de .env.local
// (`npm run db:env`). Cada prueba crea y borra su propio admin, el monitor (con su llave en monitor_privado), la
// materia, la franja, el Lead, las monitorías realizadas hace semanas con su pago aprobado y su desembolso.
//
// La monitoría se inserta ya realizada (el trigger que crea el desembolso es solo de UPDATE) y su desembolso, como lo
// dejaría el trigger: los montos los calcula la base (public.comision y public.monto_neto, que la llave secreta puede
// ejecutar) y la llave es la del monitor. Así la bandeja (la foto) y la página (el neto de ahora, P-29) dicen lo mismo.
// Los desembolsos ejecutables son de todos los admins y las pruebas corren en paralelo: el propio se reconoce por un
// neto al azar.
//
// Cada prueba inicia una sola sesión: el Auth local deja 30 inicios cada 5 minutos para toda la suite.

const ESPERA = { timeout: 20_000 };

const hoy = () => diaDelNegocio(new Date());

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El lunes de hace `semanas` semanas o el anterior: su sesión de las 10:00 terminó hace más de 24 h. */
function lunesDeHace(semanas: number): string {
  let fecha = sumarDias(hoy(), -7 * semanas);
  while (new Date(`${fecha}T12:00:00Z`).getUTCDay() !== 1) fecha = sumarDias(fecha, -1);
  return fecha;
}

/** Texto con los espacios duros (los pesos y la hora los llevan) como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s+/g, " ");

const pesos = (monto: number) => normalizar(formatearPesos(monto));

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Desembolso = {
  id: string;
  idMonitoria: string;
  /** El lunes de la sesión, de 10:00 a 11:00. */
  fecha: string;
  bruto: number;
  comision: number;
  neto: number;
};
type FilaDeDesembolso = {
  estado: string;
  id_admin: string | null;
  referencia_transferencia: string | null;
  fecha_desembolso: string | null;
  monto_bruto: number;
  comision: number;
  monto_neto: number;
  llave_destino: string;
};

type Escenario = {
  /** El admin de la prueba: el único que entra. */
  admin: Cuenta;
  monitor: Cuenta;
  /** La llave del monitor, que se copia al desembolso (RN-80). */
  llave: string;
  materia: string;
  /** Una individual realizada el lunes de hace `semanas` semanas, con un pago aprobado de un monto al azar y su desembolso pendiente. */
  desembolso(semanas: number): Promise<Desembolso>;
  /** Un reporte de inasistencia en revisión de esa monitoría (HU-029). */
  reporte(idMonitoria: string): Promise<void>;
  leerDesembolso(id: string): Promise<FilaDeDesembolso>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const monitor = await cuentas.crearMonitor();
    const creados = {
      desembolsos: [] as string[],
      reportes: [] as string[],
      pagos: [] as string[],
      comprobantes: [] as string[],
      monitorias: [] as string[],
      franjas: [] as string[],
      leads: [] as string[],
      materias: [] as string[],
    };

    async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
      const { data, error } = await cliente.from(tabla).insert(fila).select("id").single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data.id as string;
    }

    async function calcular(funcion: "comision" | "monto_neto", bruto: number): Promise<number> {
      const { data, error } = await cliente.rpc(funcion, { p_monto_bruto: bruto });
      if (error) throw new Error(`${funcion}: ${error.message}`);
      return data as number;
    }

    const { data: privado, error: errorLlave } = await cliente.from("monitor_privado").select("llave").eq("id_monitor", monitor.id).single();
    if (errorLlave) throw new Error(`leer la llave del monitor: ${errorLlave.message}`);
    const llave = (privado as { llave: string }).llave;

    const materia = `Materia e2e desembolsos ${randomUUID().slice(0, 6)}`;
    const idMateria = await insertar("materia", { nombre: materia, codigo: `E2E-${randomUUID().slice(0, 12)}` });
    creados.materias.push(idMateria);
    const { error: errorCertificado } = await cliente.from("certificado").insert({ id_monitor: monitor.id, id_materia: idMateria, id_admin: admin.id });
    if (errorCertificado) throw new Error(`insertar certificado: ${errorCertificado.message}`);
    const idFranja = await insertar("franja", { id_monitor: monitor.id, dia: 1, hora: "10:00", duracion_min: 60, presencial: true, precio: 25_000, lugar: "Salón e2e" });
    creados.franjas.push(idFranja);
    const idLead = await insertar("lead", {
      nombre: `Lead e2e ${randomUUID().slice(0, 6)}`,
      correo: `e2e-${randomUUID()}@calibra.test`,
      acepta_tratamiento_datos: true,
      fecha_consentimiento: new Date().toISOString(),
    });
    creados.leads.push(idLead);

    await entregar({
      admin,
      monitor,
      llave,
      materia,
      async desembolso(semanas) {
        const fecha = lunesDeHace(semanas);
        // Al azar entre 50.000 y 99.999: el neto reconoce el propio entre los de todos los admins.
        const bruto = randomInt(50_000, 100_000);
        const idMonitoria = await insertar("monitoria", {
          id_franja: idFranja,
          id_monitor: monitor.id,
          id_materia: idMateria,
          id_lead: idLead,
          fecha,
          valor_total: bruto,
          estado: "realizada",
          fecha_finalizacion: `${fecha}T16:30:00+00:00`,
        });
        creados.monitorias.push(idMonitoria);
        // pago.comprobante es una llave foránea a los comprobantes que el servidor ya revisó (HU-059).
        const comprobante = `${randomUUID()}/${randomUUID()}.png`;
        const { error } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
        if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
        creados.comprobantes.push(comprobante);
        creados.pagos.push(
          await insertar("pago", {
            id_monitoria: idMonitoria,
            monto: bruto,
            nombre_pagador: `Pagador e2e ${randomUUID().slice(0, 6)}`,
            contacto: `pagador-${randomUUID()}@calibra.test`,
            id_admin: admin.id,
            comprobante,
            estado: "aprobado",
            fecha_revision: new Date().toISOString(),
          }),
        );
        const comision = await calcular("comision", bruto);
        const neto = await calcular("monto_neto", bruto);
        const id = await insertar("desembolso", { id_monitoria: idMonitoria, monto_bruto: bruto, comision, monto_neto: neto, llave_destino: llave });
        creados.desembolsos.push(id);
        return { id, idMonitoria, fecha, bruto, comision, neto };
      },
      async reporte(idMonitoria) {
        creados.reportes.push(await insertar("reporte_inasistencia", { id_monitoria: idMonitoria, id_admin: admin.id, estado: "en_revision" }));
      },
      async leerDesembolso(id) {
        const { data, error } = await cliente
          .from("desembolso")
          .select("estado, id_admin, referencia_transferencia, fecha_desembolso, monto_bruto, comision, monto_neto, llave_destino")
          .eq("id", id)
          .single();
        if (error) throw new Error(`leer desembolso: ${error.message}`);
        return data as FilaDeDesembolso;
      },
    });

    // Limpieza en el orden de las llaves foráneas, antes de que `cuentas` borre al admin (desembolso, pago, reporte y
    // certificado le apuntan sin cascada) y al monitor. Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (creados.desembolsos.length) await borrar("desembolsos", cliente.from("desembolso").delete().in("id", creados.desembolsos));
    if (creados.reportes.length) await borrar("reportes", cliente.from("reporte_inasistencia").delete().in("id", creados.reportes));
    if (creados.pagos.length) await borrar("pagos", cliente.from("pago").delete().in("id", creados.pagos));
    // Después de los pagos, que les apuntan.
    if (creados.comprobantes.length) await borrar("comprobantes revisados", cliente.from("comprobante_revisado").delete().in("ruta", creados.comprobantes));
    if (creados.monitorias.length) await borrar("monitorías", cliente.from("monitoria").delete().in("id", creados.monitorias));
    await borrar("franjas", cliente.from("franja").delete().in("id", creados.franjas));
    await borrar("certificados", cliente.from("certificado").delete().eq("id_admin", admin.id));
    await borrar("leads", cliente.from("lead").delete().in("id", creados.leads));
    await borrar("materias", cliente.from("materia").delete().in("id", creados.materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 120_000 });

// Next tiene su propio role="alert" (el anunciador de rutas): se busca por el texto.
const aviso = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
const seccionDesembolso = (page: Page) => page.getByRole("region", { name: "Desembolso", exact: true });
const seccionMonitoria = (page: Page) => page.getByRole("region", { name: "Monitoría", exact: true });
const desembolsosDeLaBandeja = (page: Page) => page.getByRole("region", { name: /Desembolsos ejecutables/ });
const enlaceDe = (page: Page, d: Desembolso) => desembolsosDeLaBandeja(page).getByRole("link", { name: `Transferir ${pesos(d.neto)}` });
const abrirConfirmacion = (page: Page) => page.locator("summary", { hasText: "Registrar la transferencia" });
const botonRegistrar = (page: Page) => page.getByRole("button", { name: "Sí, registrar la transferencia" });

/** El valor de una etiqueta (Monitor, Estado...) dentro de una sección de la página. */
const dato = (seccion: Locator, etiqueta: string): Locator =>
  seccion.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");

async function entrarComoAdmin(page: Page, admin: Cuenta) {
  await page.goto("/admin");
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  await enviarCredenciales(page, admin.correo, admin.contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
}

/** Ni el bruto ni la comisión llegan a la pantalla (CLAUDE.md, supuesto 4): ni la palabra ni la cifra. */
async function expectSinComision(page: Page, d: Desembolso) {
  const cuerpo = page.locator("body");
  await expect(cuerpo).not.toContainText(/comisi[oó]n/i);
  await expect(cuerpo).not.toContainText(/bruto/i);
  await expect(cuerpo).not.toContainText(pesos(d.bruto));
  await expect(cuerpo).not.toContainText(pesos(d.comision));
}

/** Es ejecutable después del fin más 24 h: la sesión del lunes termina a las 11:00 de Bogotá (16:00 UTC). */
const ejecutableDespuesDe = (fecha: string) => new Date(`${sumarDias(fecha, 1)}T16:00:00Z`);

// ---------------------------------------------------------------------------
// Criterios 1, 3 y 4: abrir el desembolso desde la bandeja y registrar la transferencia
// ---------------------------------------------------------------------------
test.describe("Criterios 1, 3 y 4 · el admin abre un desembolso ejecutable y registra la transferencia", () => {
  test("desde la bandeja ve el neto, la llave del monitor (y la copia) y la monitoría, sin la comisión; con la confirmación cerrada, Enter no registra nada; la abre, registra la referencia y la fecha y queda desembolsado con su nombre; sale de la bandeja; la página respeta las reglas del producto", async ({
    page,
    context,
    escenario,
  }) => {
    const { admin, monitor, llave, materia } = escenario;
    const d = await escenario.desembolso(3);
    const referencia = `TRX-${randomUUID().slice(0, 8)}`;
    // La que escribe y no confirma: si llegara a la base, la fila final no tendría `referencia`.
    const referenciaSinConfirmar = `SIN-CONFIRMAR-${randomUUID().slice(0, 8)}`;
    // El portapapeles de Chromium sin cabeza pide permiso, como en e2e/pagar.spec.ts.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await entrarComoAdmin(page, admin);

    await test.step("en la bandeja está su desembolso, con su neto, y abre la ejecución", async () => {
      await expect(enlaceDe(page, d)).toBeVisible(ESPERA);
      await enlaceDe(page, d).click();
      await expect(page).toHaveURL(`/admin/desembolsos/${d.id}`, ESPERA);
      await expect(titulo(page, "Ejecutar el desembolso")).toBeVisible(ESPERA);
    });

    await test.step("criterio 1: el monitor, el estado, desde cuándo es ejecutable, el neto y la llave copiada; la monitoría", async () => {
      const desembolso = seccionDesembolso(page);
      await expect(dato(desembolso, "Monitor")).toHaveText(monitor.nombre);
      await expect(dato(desembolso, "Estado")).toHaveText("Pendiente");
      await expect(dato(desembolso, "Ejecutable")).toHaveText(`Después del ${normalizar(formatearFechaHora(ejecutableDespuesDe(d.fecha)))}`);
      await expect(page.getByRole("heading", { level: 2, name: `Transferir ${pesos(d.neto)}` })).toBeVisible();
      await expect(page.getByLabel("Llave del monitor")).toHaveValue(llave);
      const monitoria = seccionMonitoria(page);
      await expect(dato(monitoria, "Materia")).toHaveText(materia);
      await expect(dato(monitoria, "Fecha")).toHaveText(formatearDia(d.fecha));
      await expect(dato(monitoria, "Hora")).toHaveText("10:00 a 11:00");
      await expect(dato(monitoria, "Estado")).toHaveText("Realizada");
      await expectSinComision(page, d);
      // La confirmación está cerrada hasta que la pide.
      await expect(botonRegistrar(page)).toBeHidden();
      await expectReglasDelProducto(page, "un desembolso ejecutable");
    });

    await test.step("copiar deja la llave en el portapapeles y lo anuncia", async () => {
      await page.getByRole("button", { name: "Copiar llave" }).click();
      await expect(aviso(page, "Copiada.")).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(llave);
    });

    await test.step("con la confirmación cerrada nada se registra: la referencia está dentro de ella, Enter solo la abre y un envío con ella cerrada no llega a la acción", async () => {
      const campo = page.getByLabel("Referencia de la transferencia");
      // Cerrada, no hay dónde escribir la referencia: el formulario entero está dentro de la confirmación.
      await expect(campo).toBeHidden();
      await expect(page.getByLabel("Fecha de la transferencia")).toBeHidden();
      // Escribe una referencia y vuelve a cerrar la confirmación sin confirmar.
      await abrirConfirmacion(page).click();
      await campo.fill(referenciaSinConfirmar);
      await abrirConfirmacion(page).click();
      await expect(campo).toBeHidden();
      // Pulsa Enter sobre lo único que se puede pulsar: la confirmación se abre, nada se envía.
      await abrirConfirmacion(page).press("Enter");
      await expect(botonRegistrar(page)).toBeVisible();
      await abrirConfirmacion(page).click();
      await expect(botonRegistrar(page)).toBeHidden();
      // Lo que hacía Enter en la referencia: enviar el formulario con la confirmación cerrada (el navegador usa el
      // botón de confirmar aunque esté oculto). Ninguna petición sale de la página y el desembolso sigue pendiente.
      const envio = page.waitForRequest((peticion) => peticion.method() === "POST", { timeout: 3_000 }).catch(() => null);
      await page.locator("form").evaluate((formulario: HTMLFormElement) => formulario.requestSubmit());
      expect(await envio, "un envío con la confirmación cerrada no llega a la acción").toBeNull();
      await expect(page).toHaveURL(`/admin/desembolsos/${d.id}`);
      expect(await escenario.leerDesembolso(d.id)).toMatchObject({ estado: "pendiente", id_admin: null, referencia_transferencia: null });
    });

    await test.step("criterio 4 y supuesto 3: al abrirla, la confirmación dice antes qué se registra; escribe la referencia; la fecha viene con hoy y no acepta una futura ni anterior a la sesión", async () => {
      await abrirConfirmacion(page).click();
      await expect(page.getByText(`Registra la transferencia de ${pesos(d.neto)} a ${llave}. No se puede deshacer.`)).toBeVisible();
      await expect(botonRegistrar(page)).toBeVisible();
      await page.getByLabel("Referencia de la transferencia").fill(referencia);
      const fecha = page.getByLabel("Fecha de la transferencia");
      await expect(fecha).toHaveValue(hoy());
      await expect(fecha).toHaveAttribute("max", hoy());
      await expect(fecha).toHaveAttribute("min", d.fecha);
      await expectReglasDelProducto(page, "la confirmación abierta");
    });

    await test.step("criterio 4: al confirmar queda desembolsado con su id, la referencia y la fecha", async () => {
      await botonRegistrar(page).click();
      await expect(aviso(page, "Registraste la transferencia.")).toHaveText("Registraste la transferencia. El desembolso ya no aparece en la bandeja.", ESPERA);
      await expect(page).toHaveURL(`/admin/desembolsos/${d.id}?ejecutado=desembolsado`);
      await expect(titulo(page, "Desembolso registrado")).toBeVisible();
      const desembolso = seccionDesembolso(page);
      await expect(dato(desembolso, "Estado")).toHaveText("Desembolsado");
      await expect(dato(desembolso, "Monto transferido")).toHaveText(pesos(d.neto));
      await expect(dato(desembolso, "Llave destino")).toHaveText(llave);
      await expect(dato(desembolso, "Referencia")).toHaveText(referencia);
      await expect(dato(desembolso, "Fecha de la transferencia")).toHaveText(formatearDia(hoy()));
      await expect(dato(desembolso, "Registrado por")).toHaveText(admin.nombre);
      await expect(page.locator("form")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Copiar llave" })).toHaveCount(0);
      await expectSinComision(page, d);
      await expectReglasDelProducto(page, "el desembolso registrado");

      const fila = await escenario.leerDesembolso(d.id);
      expect({ ...fila, fecha_desembolso: new Date(fila.fecha_desembolso!).getTime() }).toEqual({
        estado: "desembolsado",
        id_admin: admin.id,
        referencia_transferencia: referencia,
        // Mediodía de Bogotá (UTC-5) del día de la transferencia.
        fecha_desembolso: new Date(`${hoy()}T17:00:00Z`).getTime(),
        monto_bruto: d.bruto,
        comision: d.comision,
        monto_neto: d.neto,
        llave_destino: llave,
      });
    });

    await test.step("vuelve a su bandeja: el desembolso ya no está", async () => {
      await page.getByRole("link", { name: "Volver a mi bandeja" }).click();
      await expect(page).toHaveURL("/admin", ESPERA);
      await expect(desembolsosDeLaBandeja(page)).toBeVisible();
      await expect(enlaceDe(page, d)).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 2: con un reporte en revisión no se ejecuta
// ---------------------------------------------------------------------------
test.describe("Criterio 2 · un desembolso con un reporte en revisión no se puede ejecutar", () => {
  test("no sale en la bandeja; su página dice por qué, con la llave como dato y sin formulario ni botón de copiar", async ({ page, escenario }) => {
    const { admin, llave } = escenario;
    const conReporte = await escenario.desembolso(4);
    await escenario.reporte(conReporte.idMonitoria);
    await entrarComoAdmin(page, admin);

    await expect(desembolsosDeLaBandeja(page)).toBeVisible(ESPERA);
    await expect(enlaceDe(page, conReporte)).toHaveCount(0);

    await page.goto(`/admin/desembolsos/${conReporte.id}`);
    await expect(titulo(page, "Ejecutar el desembolso")).toBeVisible(ESPERA);
    await expect(
      page.getByText("La monitoría tiene un reporte de inasistencia en revisión o aceptado, así que no se transfiere mientras no se resuelva."),
    ).toBeVisible();
    const desembolso = seccionDesembolso(page);
    await expect(dato(desembolso, "Estado")).toHaveText("Pendiente");
    await expect(dato(desembolso, "Llave destino")).toHaveText(llave);
    await expect(page.getByRole("heading", { name: /^Transferir/ })).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copiar llave" })).toHaveCount(0);
    await expect(abrirConfirmacion(page)).toHaveCount(0);
    // Mientras no se pueda ejecutar, el neto tampoco se muestra: todavía puede cambiar (P-29).
    await expect(page.locator("body")).not.toContainText(pesos(conReporte.neto));
    await expectSinComision(page, conReporte);
    await expectReglasDelProducto(page, "un desembolso con un reporte en revisión");

    expect(await escenario.leerDesembolso(conReporte.id)).toMatchObject({ estado: "pendiente", id_admin: null, referencia_transferencia: null });
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (copia de e2e/revisar-pagos.spec.ts, que mide `summary` e `input`:
// esta página los tiene)
// ---------------------------------------------------------------------------

/** Con el tamaño de la prueba y, si es más ancho, también a 390 px (el ancho de referencia del teléfono). */
async function expectReglasDelProducto(page: Page, donde: string): Promise<void> {
  await expectReglas(page, donde);
  const original = page.viewportSize();
  if (original && original.width > 390) {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectReglas(page, `${donde} (390 px)`);
    await page.setViewportSize(original);
  }
}

async function expectReglas(page: Page, donde: string): Promise<void> {
  const medidas = await medir(page);
  expect(medidas.sinScrollHorizontal, `${donde}: sin scroll horizontal`).toBe(true);
  expect(medidas.menorTexto, `${donde}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
  expect(medidas.degradados, `${donde}: sin degradados`).toBe(0);
  expect(medidas.tactilesChicos, `${donde}: áreas táctiles de 44 px o más`).toEqual([]);
  expect(medidas.controlesSinNombre, `${donde}: todo control tiene nombre`).toEqual([]);
}

/** Texto, áreas táctiles, degradados y nombres. De las casillas cuenta su etiqueta, que también las marca. */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
      (el) => visible(el) && [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden]), textarea, summary")].filter(visible);
    // Los enlaces dentro de una frase son texto corrido: quedan fuera.
    const tocables = controles
      .filter((el) => !(el.tagName === "A" && el.closest("label, p")))
      .map((el) => (el instanceof HTMLInputElement && el.type === "checkbox" ? (el.labels?.[0] ?? el) : el));
    return {
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
      degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length,
      tactilesChicos: tocables
        .map((el) => ({ texto: (el.textContent || el.id || el.tagName).trim().slice(0, 40), alto: Math.round(el.getBoundingClientRect().height) }))
        .filter((el) => el.alto < 44),
      controlesSinNombre: controles
        .filter((el) => {
          const etiquetas = (el as HTMLInputElement).labels?.length ?? 0;
          return !(el.textContent?.trim() || el.getAttribute("aria-label") || etiquetas);
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    };
  });
}
