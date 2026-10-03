import { randomInt, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { diaDelNegocio, formatearDia, formatearFechaHora } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-078: un admin ve un caso P-24 en «Pagos por cobrar o asumir» de su bandeja, lo abre, lo cierra con la confirmación
// y el caso sale de la sección; mientras estuvo abierto, el desembolso de su monitoría esperaba, y cerrado, cuenta el
// pago rechazado. Corre contra el Supabase local (Auth y base) y el servidor de Next con la configuración de .env.local
// (`npm run db:env`). Cada prueba crea y borra su propio admin, el monitor (con su llave), la materia, la franja, el Lead,
// una monitoría realizada hace semanas con un pago aprobado, un pago rechazado en P-24 y su desembolso pendiente.
//
// El rechazo en P-24 por la página de la revisión ya lo recorre e2e/revisar-pagos.spec.ts (con el aviso del criterio
// 5): aquí el pago se inserta ya rechazado, con sus observaciones y la fecha del rechazo, como lo deja revisar_pago. La
// monitoría se inserta ya realizada (el trigger del desembolso es solo de UPDATE) y su desembolso, como lo dejaría el
// trigger con el caso abierto: la foto solo cuenta el pago aprobado (public.comision y public.monto_neto, que la llave
// secreta puede ejecutar). Los casos y los desembolsos ejecutables son de todos los admins y las pruebas corren en
// paralelo: el caso propio se reconoce por el nombre del pagador y el desembolso por un neto al azar.
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

/** Lo que anotó el admin al rechazar el pago (P-24), con un salto de línea que la bandeja conserva. */
const OBSERVACIONES = "Se cobra por fuera: el pagador vuelve a transferir esta semana.\nLlamarlo el lunes.";

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Caso = {
  /** El pago rechazado en P-24. */
  idPago: string;
  nombrePagador: string;
  contacto: string;
  montoRechazado: number;
  rechazadoEn: Date;
  idMonitoria: string;
  /** El lunes de la sesión, de 10:00 a 11:00. */
  fecha: string;
  idDesembolso: string;
  /** La foto del desembolso, con el caso abierto: solo el pago aprobado. */
  netoDeLaFoto: number;
  /** Lo que se transfiere con el caso cerrado: el aprobado más el rechazado, con la misma comisión (D-39, RN-81). */
  netoConElCaso: number;
  /** Lo que nunca debe salir en la pantalla del desembolso: el bruto y la comisión, de la foto y con el caso. */
  prohibidos: number[];
};
type FilaDePago = {
  estado: string;
  observaciones: string | null;
  cierre_rechazo: string | null;
  nota_cierre: string | null;
  id_admin_cierre: string | null;
  fecha_cierre: string | null;
};

type Escenario = {
  /** El admin de la prueba: el único que entra. */
  admin: Cuenta;
  monitor: Cuenta;
  materia: string;
  /** Una individual realizada el lunes de hace `semanas` semanas con un pago aprobado, un pago rechazado en P-24 y su desembolso pendiente. */
  caso(semanas: number): Promise<Caso>;
  leerPago(id: string): Promise<FilaDePago>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const monitor = await cuentas.crearMonitor();
    const creados = {
      desembolsos: [] as string[],
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

    /** Un pago de la monitoría, ya revisado; su comprobante tiene que estar revisado antes (HU-059). */
    async function pagoRevisado(idMonitoria: string, fila: Record<string, unknown>): Promise<string> {
      const comprobante = `${randomUUID()}/${randomUUID()}.png`;
      const { error } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
      if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
      creados.comprobantes.push(comprobante);
      const id = await insertar("pago", { id_monitoria: idMonitoria, id_admin: admin.id, comprobante, ...fila });
      creados.pagos.push(id);
      return id;
    }

    const { data: privado, error: errorLlave } = await cliente.from("monitor_privado").select("llave").eq("id_monitor", monitor.id).single();
    if (errorLlave) throw new Error(`leer la llave del monitor: ${errorLlave.message}`);
    const llave = (privado as { llave: string }).llave;

    const materia = `Materia e2e casos ${randomUUID().slice(0, 6)}`;
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
      materia,
      async caso(semanas) {
        const fecha = lunesDeHace(semanas);
        // Montos al azar, más altos que los de las otras pruebas de desembolsos: el neto reconoce el propio.
        const aprobado = randomInt(110_000, 150_000);
        const montoRechazado = randomInt(20_000, 40_000);
        const idMonitoria = await insertar("monitoria", {
          id_franja: idFranja,
          id_monitor: monitor.id,
          id_materia: idMateria,
          id_lead: idLead,
          fecha,
          valor_total: aprobado + montoRechazado,
          estado: "realizada",
          fecha_finalizacion: `${fecha}T16:30:00+00:00`,
        });
        creados.monitorias.push(idMonitoria);
        await pagoRevisado(idMonitoria, {
          monto: aprobado,
          nombre_pagador: `Pagador aprobado e2e ${randomUUID().slice(0, 6)}`,
          contacto: `pagador-${randomUUID()}@calibra.test`,
          estado: "aprobado",
          fecha_revision: `${fecha}T15:00:00Z`,
        });
        // Rechazado el día de la sesión, a las 3 p. m. de Bogotá: después de que empezó, así que no se canceló (P-24).
        const rechazadoEn = new Date(`${fecha}T20:00:00Z`);
        const nombrePagador = `Pagador por cobrar ${randomUUID().slice(0, 6)}`;
        const contacto = `pagador-${randomUUID()}@calibra.test`;
        const idPago = await pagoRevisado(idMonitoria, {
          monto: montoRechazado,
          nombre_pagador: nombrePagador,
          contacto,
          estado: "rechazado",
          fecha_revision: rechazadoEn.toISOString(),
          id_admin_revisor: admin.id,
          observaciones: OBSERVACIONES,
        });
        const comisionDeLaFoto = await calcular("comision", aprobado);
        const netoDeLaFoto = await calcular("monto_neto", aprobado);
        const idDesembolso = await insertar("desembolso", {
          id_monitoria: idMonitoria,
          monto_bruto: aprobado,
          comision: comisionDeLaFoto,
          monto_neto: netoDeLaFoto,
          llave_destino: llave,
        });
        creados.desembolsos.push(idDesembolso);
        const brutoConElCaso = aprobado + montoRechazado;
        return {
          idPago,
          nombrePagador,
          contacto,
          montoRechazado,
          rechazadoEn,
          idMonitoria,
          fecha,
          idDesembolso,
          netoDeLaFoto,
          netoConElCaso: await calcular("monto_neto", brutoConElCaso),
          prohibidos: [aprobado, comisionDeLaFoto, brutoConElCaso, await calcular("comision", brutoConElCaso)],
        };
      },
      async leerPago(id) {
        const { data, error } = await cliente
          .from("pago")
          .select("estado, observaciones, cierre_rechazo, nota_cierre, id_admin_cierre, fecha_cierre")
          .eq("id", id)
          .single();
        if (error) throw new Error(`leer pago: ${error.message}`);
        return data as FilaDePago;
      },
    });

    // Limpieza en el orden de las llaves foráneas, antes de que `cuentas` borre al admin (desembolso, pago y certificado
    // le apuntan sin cascada, también pago.id_admin_cierre) y al monitor. Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (creados.desembolsos.length) await borrar("desembolsos", cliente.from("desembolso").delete().in("id", creados.desembolsos));
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
const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });
const aviso = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
const casosDeLaBandeja = (page: Page) => page.getByRole("region", { name: /Pagos por cobrar o asumir/ });
const enlaceAlCaso = (page: Page, c: Caso) => casosDeLaBandeja(page).getByRole("link", { name: new RegExp(c.nombrePagador) });
const desembolsosDeLaBandeja = (page: Page) => page.getByRole("region", { name: /Desembolsos ejecutables/ });
const enlaceAlDesembolso = (page: Page, c: Caso) => desembolsosDeLaBandeja(page).getByRole("link", { name: `Transferir ${pesos(c.netoDeLaFoto)}` });
const seccionPago = (page: Page) => page.getByRole("region", { name: "Pago", exact: true });
const seccionCaso = (page: Page) => page.getByRole("region", { name: "Por cobrar o asumir", exact: true });
const abrirConfirmacion = (page: Page) => page.locator("summary", { hasText: "Cerrar el caso" });
const botonCerrar = (page: Page) => page.getByRole("button", { name: "Sí, cerrar el caso" });
const opcionCobrado = (page: Page) => page.getByRole("radio", { name: "Cobrado: el pagador pagó por fuera" });
const opcionAsumido = (page: Page) => page.getByRole("radio", { name: "Asumido: Calibra no lo cobra" });

/** El valor de una etiqueta (Pagador, Caso, Cerrado por...) dentro de una sección de la página. */
const dato = (seccion: Locator, etiqueta: string): Locator =>
  seccion.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");

async function entrarComoAdmin(page: Page, admin: Cuenta) {
  await page.goto("/admin");
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  await enviarCredenciales(page, admin.correo, admin.contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
}

/** Ni el bruto ni la comisión llegan a la pantalla del desembolso (CLAUDE.md): ni la palabra ni la cifra. */
async function expectSinComision(page: Page, c: Caso) {
  const cuerpo = page.locator("body");
  await expect(cuerpo).not.toContainText(/comisi[oó]n/i);
  await expect(cuerpo).not.toContainText(/bruto/i);
  for (const monto of c.prohibidos) await expect(cuerpo).not.toContainText(pesos(monto));
}

// ---------------------------------------------------------------------------
// Criterios 1 a 4: ver el caso, cerrarlo y que el desembolso lo cuente
// ---------------------------------------------------------------------------
test.describe("Criterios 1 a 4 · el admin ve un pago por cobrar o asumir en su bandeja y lo cierra", () => {
  test("en la bandeja ve el caso con el pagador, su contacto, el monto, la monitoría y las observaciones, y el desembolso de esa monitoría espera; lo abre, la confirmación cerrada no envía nada, sin elegir cómo se resolvió no se cierra; lo cierra como cobrado con una nota, la página dice cómo, quién y cuándo, sale de la sección y el desembolso se puede ejecutar con el pago rechazado incluido; las páginas respetan las reglas del producto", async ({
    page,
    escenario,
  }) => {
    const { admin, monitor, materia } = escenario;
    const c = await escenario.caso(3);
    const nota = `Pagó por fuera con la referencia M-${randomUUID().slice(0, 6)}.`;
    await entrarComoAdmin(page, admin);

    await test.step("criterio 1: la bandeja cuenta los casos arriba y lista el suyo con el pagador, el contacto, el monto, la monitoría, la fecha del rechazo y las observaciones", async () => {
      await expect(page.getByRole("navigation", { name: "Resumen de tu bandeja" }).getByRole("link", { name: /^\d+ Pagos por cobrar o asumir$/ })).toBeVisible(ESPERA);
      const fila = enlaceAlCaso(page, c);
      await expect(fila).toBeVisible(ESPERA);
      await expect(fila).toHaveAttribute("href", `/admin/pagos/${c.idPago}`);
      await expect(fila).toContainText(`${c.nombrePagador} · ${pesos(c.montoRechazado)}`);
      await expect(fila).toContainText(c.contacto);
      await expect(fila).toContainText(`${materia} con ${monitor.nombre} · Sesión del ${formatearDia(c.fecha)}`);
      await expect(fila).toContainText(`Rechazado el ${normalizar(formatearFechaHora(c.rechazadoEn))}`);
      await expect(fila).toContainText(`Observaciones: ${normalizar(OBSERVACIONES)}`);
      // Criterio 4: con el caso abierto, el desembolso de su monitoría no está entre los ejecutables.
      await expect(desembolsosDeLaBandeja(page)).toBeVisible();
      await expect(enlaceAlDesembolso(page, c)).toHaveCount(0);
      await expectReglasDelProducto(page, "la bandeja con un caso por cobrar o asumir");
    });

    await test.step("criterio 4: la página del desembolso dice que espera a que se cierre el caso, sin el neto ni formulario", async () => {
      await page.goto(`/admin/desembolsos/${c.idDesembolso}`);
      await expect(titulo(page, "Ejecutar el desembolso")).toBeVisible(ESPERA);
      await expect(page.getByText("Espera a que se cierre el caso del pago rechazado en «Pagos por cobrar o asumir».")).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Transferir/ })).toHaveCount(0);
      await expect(page.locator("form")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(pesos(c.netoDeLaFoto));
      await expectSinComision(page, c);
    });

    await test.step("desde la bandeja abre el caso: la página explica qué pasó, que el desembolso espera, y trae la confirmación cerrada", async () => {
      await page.goto("/admin");
      await enlaceAlCaso(page, c).click();
      await expect(page).toHaveURL(`/admin/pagos/${c.idPago}`, ESPERA);
      await expect(titulo(page, "Pago rechazado")).toBeVisible(ESPERA);
      await expect(dato(seccionPago(page), "Pagador")).toHaveText(c.nombrePagador);
      await expect(dato(seccionPago(page), "Observaciones")).toHaveText(OBSERVACIONES);
      await expect(seccionCaso(page)).toContainText("Mientras siga abierto, el desembolso de esta monitoría no se puede ejecutar.");
      await expect(abrirConfirmacion(page)).toBeVisible();
      await expect(botonCerrar(page)).toBeHidden();
      await expect(opcionCobrado(page)).toBeHidden();
      await expectReglasDelProducto(page, "un caso abierto");
    });

    await test.step("criterio 2 (D-38): con la confirmación cerrada nada se envía: Enter solo la abre y un envío con ella cerrada no llega a la acción", async () => {
      await abrirConfirmacion(page).press("Enter");
      await expect(botonCerrar(page)).toBeVisible();
      await abrirConfirmacion(page).click();
      await expect(botonCerrar(page)).toBeHidden();
      // El navegador envía con el botón de confirmar aunque esté oculto: la página lo impide.
      const envio = page.waitForRequest((peticion) => peticion.method() === "POST", { timeout: 3_000 }).catch(() => null);
      await page.locator("form").evaluate((formulario: HTMLFormElement) => formulario.requestSubmit());
      expect(await envio, "un envío con la confirmación cerrada no llega a la acción").toBeNull();
      await expect(page).toHaveURL(`/admin/pagos/${c.idPago}`);
      expect(await escenario.leerPago(c.idPago)).toMatchObject({ estado: "rechazado", cierre_rechazo: null, id_admin_cierre: null });
    });

    await test.step("criterio 2: al abrirla dice que no se deshace; sin elegir cómo se resolvió no se cierra y lo escrito se conserva", async () => {
      await abrirConfirmacion(page).click();
      await expect(
        page.getByText("Cerrar el caso no se puede deshacer. Sale de «Pagos por cobrar o asumir», el pago sigue rechazado y su monto cuenta en el desembolso del monitor."),
      ).toBeVisible();
      await expect(opcionCobrado(page)).not.toBeChecked();
      await expect(opcionAsumido(page)).not.toBeChecked();
      await page.getByLabel("Nota (opcional)").fill(nota);
      await expectReglasDelProducto(page, "la confirmación abierta");

      await botonCerrar(page).click();
      await expect(alerta(page, "Elige si el pago se cobró por fuera o si Calibra lo asume.")).toBeVisible(ESPERA);
      await expect(page.getByLabel("Nota (opcional)")).toHaveValue(nota);
      expect(await escenario.leerPago(c.idPago)).toMatchObject({ cierre_rechazo: null, id_admin_cierre: null });
    });

    await test.step("criterio 2: lo cierra como cobrado con la nota; la página dice cómo, quién, cuándo y la nota, y queda guardado", async () => {
      await opcionCobrado(page).check();
      await botonCerrar(page).click();
      await expect(aviso(page, "Cerraste el caso")).toHaveText("Cerraste el caso como cobrado. Ya no aparece en «Pagos por cobrar o asumir».", ESPERA);
      await expect(page).toHaveURL(`/admin/pagos/${c.idPago}?caso=cerrado`);

      const fila = await escenario.leerPago(c.idPago);
      expect(fila).toMatchObject({ estado: "rechazado", observaciones: OBSERVACIONES, cierre_rechazo: "cobrado", nota_cierre: nota, id_admin_cierre: admin.id });
      expect(fila.fecha_cierre).not.toBeNull();

      const caso = seccionCaso(page);
      await expect(dato(caso, "Caso")).toHaveText("Cerrado. Cobrado: el pagador pagó por fuera");
      await expect(dato(caso, "Cerrado por")).toHaveText(admin.nombre);
      await expect(dato(caso, "Cerrado")).toHaveText(normalizar(formatearFechaHora(new Date(fila.fecha_cierre!))));
      await expect(dato(caso, "Nota")).toHaveText(nota);
      await expect(page.locator("form")).toHaveCount(0);
      await expect(abrirConfirmacion(page)).toHaveCount(0);
      await expectReglasDelProducto(page, "el caso cerrado");
    });

    await test.step("vuelve a su bandeja: el caso ya no está en la sección y el desembolso de su monitoría ya es ejecutable", async () => {
      await page.getByRole("link", { name: "Volver a mi bandeja" }).click();
      await expect(page).toHaveURL("/admin", ESPERA);
      await expect(casosDeLaBandeja(page)).toBeVisible();
      await expect(enlaceAlCaso(page, c)).toHaveCount(0);
      await expect(enlaceAlDesembolso(page, c)).toBeVisible();
    });

    await test.step("criterio 3: el desembolso transfiere el neto con el pago rechazado incluido, sin mostrar la comisión", async () => {
      await enlaceAlDesembolso(page, c).click();
      await expect(page).toHaveURL(`/admin/desembolsos/${c.idDesembolso}`, ESPERA);
      await expect(page.getByRole("heading", { level: 2, name: `Transferir ${pesos(c.netoConElCaso)}` })).toBeVisible(ESPERA);
      await expect(page.getByText("Espera a que se cierre el caso")).toHaveCount(0);
      await expectSinComision(page, c);
    });
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (copia de e2e/desembolsos.spec.ts; de los radios, como de las casillas,
// cuenta su etiqueta, que es lo que se toca: e2e/franjas.spec.ts)
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

/** Texto, áreas táctiles, degradados y nombres. De las casillas y los radios cuenta su etiqueta, que también los marca. */
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
      .map((el) => (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.labels?.[0] ?? el) : el));
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
