import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { ZONA_HORARIA_NEGOCIO } from "../src/config/regional";
import { diaDelNegocio, formatearDia, formatearFechaHora } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-026: el admin abre desde su bandeja cada reembolso que tiene asignado y lo gestiona según su estado. En pendiente
// copia la llave de quien pagó, transfiere por fuera y registra la referencia y la fecha (criterio 2); si todavía espera
// la llave, reenvía el enlace (criterio 3); un caso cerrado sin llave solo se muestra y remite a la bandeja para
// reabrirlo (supuesto 11). Otro admin activo ve el caso, pero sin la llave ni el formulario (supuesto 9). Corre contra el
// Supabase local (Auth y base) y el servidor de Next con la configuración de .env.local (`npm run db:env`).
//
// Cada prueba crea y borra su propio admin, el monitor, la materia, la franja, el Lead, las monitorías canceladas con su
// pago aprobado y sus reembolsos, insertados como los crea cualquier HU (los triggers les anotan su token y su pedido). El
// monto es al azar (de $ 30.000 a $ 39.900) y el motivo único, para reconocer el propio. Los correos y las carreras con la
// base los cubre `integracion/gestionar-reembolsos.test.ts`; los bordes de cada resultado, el pgTAP.
//
// Cada prueba inicia una sola sesión: el Auth local deja 30 inicios cada 5 minutos para toda la suite. La parte sin
// JavaScript reusa esa sesión en otro contexto del navegador.

const ESPERA = { timeout: 20_000 };
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
/** P-10: los días para entregar la llave (`public.parametros_reembolso`). */
const DIAS_PARA_ENTREGAR = 7;

const AVISO_REGISTRADO = "Registraste la transferencia. El reembolso sale de tu bandeja y quien pagó ve en su enlace que ya le devolvimos el dinero.";
const AVISO_REENVIADO = "Le mandamos otra vez el enlace a quien pagó. Le llega en unos minutos y el plazo no cambia.";
const ERROR_ANTES_DE_CREARSE = "La fecha de la transferencia no puede ser anterior al día en que se creó el reembolso.";
const REABRIR_DESDE_LA_BANDEJA =
  "Si quien pagó te escribe, reábrelo desde “Cerrados sin llave”, en tu bandeja. Si acaba de vencer, puede tardar hasta 15 minutos en aparecer ahí.";

const hoy = () => diaDelNegocio(new Date());

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Texto con los espacios duros (los pesos y la hora los llevan) como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s+/g, " ");

const pesos = (monto: number) => normalizar(formatearPesos(monto));

/** El fin del plazo para entregar la llave de un ciclo que empezó en `desde` (P-10). */
const venceDe = (desde: Date) => new Date(desde.getTime() + DIAS_PARA_ENTREGAR * DIA);

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type OpcionesDeReembolso = {
  /** Por defecto espera la llave. `pendiente` y `reembolsado` nacen con su llave, como los dejan HU-025 y HU-026. */
  estado?: "esperando_llave" | "pendiente" | "reembolsado";
  /** Pasaron los 7 días: con `cerrado`, además, el trabajo de pg_cron ya lo cerró. */
  plazo?: "abierto" | "vencido" | "cerrado";
  /** Hace cuántos días se creó: la transferencia no puede ser anterior a ese día. */
  creadoHaceDias?: number;
  /**
   * Con los datos más largos que la pantalla puede recibir: la llave de 200 caracteres sin espacios que admite el enlace
   * (HU-025), un motivo con el comentario del admin y una dirección sin espacios (HU-030: la base no les pone tope), un
   * correo largo y un nombre largo. Así las reglas de 390 px miden algo más que textos cortos.
   */
  largo?: boolean;
};

type Reembolso = {
  id: string;
  monto: number;
  /** La comisión que tendría ese monto (`public.comision`): nunca debe asomar en la pantalla. */
  comision: number;
  motivo: string;
  nombrePagador: string;
  contacto: string;
  /** Desde cuándo corren los 7 días (P-10). */
  plazoLlaveDesde: Date;
  /** La llave guardada (pendiente o reembolsado); `null` si todavía espera la llave. */
  llave: string | null;
  /** El lunes de la monitoría cancelada, de 10:00 a 11:00. */
  fechaMonitoria: string;
};

type FilaDeReembolso = {
  estado: string;
  id_admin: string | null;
  llave_destino: string | null;
  referencia_transferencia: string | null;
  fecha_reembolso: string | null;
  cerrado_en: string | null;
};

type Escenario = {
  /** El admin de la prueba: tiene asignados los reembolsos. */
  admin: Cuenta;
  materia: string;
  reembolso(opciones?: OpcionesDeReembolso): Promise<Reembolso>;
  /** El reembolso como lo guarda la base, con la llave (la prueba la lee con la llave secreta para comprobarla). */
  enBd(id: string): Promise<FilaDeReembolso>;
  /** Los correos que la base anotó para el reembolso, por tipo. */
  pedidosDe(id: string): Promise<string[]>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const monitor = await cuentas.crearMonitor();
    const creados = {
      reembolsos: [] as string[],
      pagos: [] as string[],
      comprobantes: [] as string[],
      monitorias: [] as string[],
      franjas: [] as string[],
      leads: [] as string[],
      materias: [] as string[],
    };
    let semana = 0;

    async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
      const { data, error } = await cliente.from(tabla).insert(fila).select("id").single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data.id as string;
    }

    const materia = `Materia e2e reembolsos ${randomUUID().slice(0, 6)}`;
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
      materia,
      async reembolso(opciones = {}) {
        const estado = opciones.estado ?? "esperando_llave";
        const plazo = opciones.plazo ?? "abierto";
        const sufijo = randomBytes(4).toString("hex");

        // Una monitoría cancelada por el estudiante (un lunes por reembolso), con su pago aprobado.
        const fechaMonitoria = new Date(Date.UTC(2030, 0, 7 + 7 * semana++)).toISOString().slice(0, 10);
        const idMonitoria = await insertar("monitoria", {
          id_franja: idFranja,
          id_monitor: monitor.id,
          id_materia: idMateria,
          id_lead: idLead,
          fecha: fechaMonitoria,
          valor_total: 25_000,
          estado: "cancelada",
          motivo_cancelacion: "estudiante",
        });
        creados.monitorias.push(idMonitoria);
        // pago.comprobante es una llave foránea a los comprobantes que el servidor ya revisó (HU-059).
        const comprobante = `${randomUUID()}/${randomUUID()}.png`;
        const { error } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
        if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
        creados.comprobantes.push(comprobante);
        const monto = randomInt(300, 400) * 100;
        const largo = opciones.largo ?? false;
        const nombrePagador = largo ? `Pagador e2e ${sufijo} María Fernanda de los Ángeles Rodríguez Villamizar` : `Pagador e2e ${sufijo}`;
        const contacto = largo
          ? `pagador-${sufijo}-con-un-correo-institucional-largo@estudiantes.facultad-de-ingenieria-de-sistemas.calibra.test`
          : `pagador-${sufijo}@calibra.test`;
        const idPago = await insertar("pago", {
          id_monitoria: idMonitoria,
          monto,
          nombre_pagador: nombrePagador,
          contacto,
          id_admin: admin.id,
          comprobante,
          estado: "aprobado",
          fecha_revision: new Date().toISOString(),
        });
        creados.pagos.push(idPago);

        const plazoLlaveDesde = plazo === "abierto" ? new Date() : new Date(Date.now() - (DIAS_PARA_ENTREGAR + 1) * DIA);
        const llave = estado === "esperando_llave" ? null : largo ? `llave-e2e-${sufijo}-`.padEnd(200, "7") : `llave-e2e-${sufijo}`;
        const motivo = largo
          ? `Cancelación e2e ${sufijo}. Comentario del admin: quien pagó escribió por el chat de soporte y pidió el reembolso completo; el caso está en https://soporte.calibra.test/casos/${"reembolso-de-la-monitoria-cancelada-".repeat(4)}${sufijo}`
          : `Cancelación e2e ${sufijo}`;
        const id = await insertar("reembolso", {
          id_pago: idPago,
          id_admin: admin.id,
          monto,
          motivo,
          estado,
          llave_destino: llave,
          plazo_llave_desde: plazoLlaveDesde.toISOString(),
          cerrado_en: plazo === "cerrado" ? new Date(Date.now() - MINUTO).toISOString() : null,
          fecha_reembolso: estado === "reembolsado" ? new Date().toISOString() : null,
          referencia_transferencia: estado === "reembolsado" ? "REF-E2E" : null,
          ...(opciones.creadoHaceDias ? { fecha_generacion: new Date(Date.now() - opciones.creadoHaceDias * DIA).toISOString() } : {}),
        });
        creados.reembolsos.push(id);

        const { data: comision, error: errorComision } = await cliente.rpc("comision", { p_monto_bruto: monto });
        if (errorComision) throw new Error(`comision: ${errorComision.message}`);
        return { id, monto, comision: comision as number, motivo, nombrePagador, contacto, plazoLlaveDesde, llave, fechaMonitoria };
      },
      async enBd(id) {
        const { data, error } = await cliente
          .from("reembolso")
          .select("estado, id_admin, llave_destino, referencia_transferencia, fecha_reembolso, cerrado_en")
          .eq("id", id)
          .single();
        if (error) throw new Error(`leer el reembolso: ${error.message}`);
        return data as FilaDeReembolso;
      },
      async pedidosDe(id) {
        const { data, error } = await cliente.from("pedido_llave").select("tipo").eq("id_reembolso", id).order("creada_en");
        if (error) throw new Error(`leer los pedidos de la llave: ${error.message}`);
        return (data as { tipo: string }[]).map((p) => p.tipo);
      },
    });

    // Limpieza en el orden de las llaves foráneas, antes de que `cuentas` borre al admin (reembolso, pago y certificado le
    // apuntan sin cascada) y al monitor. La solicitud y los pedidos de cada reembolso se van con él, en cascada. Se
    // intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (creados.reembolsos.length) await borrar("reembolsos", cliente.from("reembolso").delete().in("id", creados.reembolsos));
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

// Next tiene su propio role="alert" (el anunciador de rutas): se busca por el texto o se deja fuera.
const aviso = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
const alertas = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
const seccionReembolso = (page: Page) => page.getByRole("region", { name: "Reembolso", exact: true });
const seccionMonitoria = (page: Page) => page.getByRole("region", { name: "Monitoría", exact: true });
const reembolsosDeLaBandeja = (page: Page) => page.getByRole("region", { name: /Reembolsos/ });
const abrirConfirmacion = (page: Page) => page.locator("summary", { hasText: "Registrar la transferencia" });
const botonRegistrar = (page: Page) => page.getByRole("button", { name: "Sí, registrar la transferencia" });
const botonReenviar = (page: Page) => page.getByRole("button", { name: "Reenviar el enlace" });
const rutaDe = (r: { id: string }) => `/admin/reembolsos/${r.id}`;

/** El valor de una etiqueta (Pagador, Estado...) dentro de una sección de la página. */
const dato = (seccion: Locator, etiqueta: string): Locator =>
  seccion.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");

/** Las filas de un grupo de reembolsos de la bandeja («Esperando la llave», «Listos para transferir»). */
const filasDelGrupo = (page: Page, grupo: string) => reembolsosDeLaBandeja(page).locator(`h3:has-text('${grupo}') + ul li`);

async function entrarComoAdmin(page: Page, admin: Cuenta) {
  await page.goto("/admin");
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  await enviarCredenciales(page, admin.correo, admin.contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
}

/** Ninguna cifra de comisión llega a la pantalla (CLAUDE.md): ni la palabra, ni la comisión ni lo que quedaría sin ella. */
async function expectSinComision(page: Page, r: Reembolso) {
  const cuerpo = page.locator("body");
  await expect(cuerpo).not.toContainText(/comisi[oó]n/i);
  await expect(cuerpo).not.toContainText(/bruto/i);
  await expect(cuerpo).not.toContainText(pesos(r.comision));
  await expect(cuerpo).not.toContainText(pesos(r.monto - r.comision));
}

/**
 * Junta todo lo que el servidor le manda al navegador (las páginas y las respuestas de las acciones) para buscar la llave
 * ahí, no solo en lo que se ve (supuesto 9), como `e2e/llave-reembolso.spec.ts`.
 */
function vigilarRespuestas(page: Page): () => Promise<string> {
  const cuerpos: Promise<string>[] = [];
  page.on("response", (respuesta) => {
    const tipo = respuesta.headers()["content-type"] ?? "";
    if (/text\/html|text\/x-component/.test(tipo)) cuerpos.push(respuesta.text().catch(() => ""));
  });
  return async () => (await Promise.all(cuerpos)).join("\n");
}

// ---------------------------------------------------------------------------
// Criterios 1 y 2: abrir un pendiente desde la bandeja y registrar la transferencia
// ---------------------------------------------------------------------------
test.describe("Criterios 1 y 2 · el admin asignado abre un reembolso pendiente y registra la transferencia", () => {
  test("desde la bandeja ve quién pagó, su correo, el monto, el motivo, la monitoría y la llave (y la copia), sin comisión; con la confirmación cerrada Enter no registra nada; al abrirla lee qué registra y la fecha viene con hoy, entre el día en que se creó y hoy; un error conserva lo escrito; al confirmar queda reembolsado con su nombre y sale de la bandeja; la página respeta las reglas del producto", async ({
    page,
    context,
    escenario,
  }) => {
    const { admin, materia } = escenario;
    const r = await escenario.reembolso({ estado: "pendiente", creadoHaceDias: 3, largo: true });
    const creado = sumarDias(hoy(), -3);
    // La más larga que acepta (100 caracteres), sin espacios: también se mide a 390 px una vez registrada.
    const referencia = `TRX-${randomUUID().slice(0, 8)}-`.padEnd(100, "7");
    // La que escribe y no confirma: si llegara a la base, la fila final no tendría `referencia`.
    const referenciaSinConfirmar = `SIN-CONFIRMAR-${randomUUID().slice(0, 8)}`;
    // El portapapeles de Chromium sin cabeza pide permiso, como en e2e/pagar.spec.ts.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await entrarComoAdmin(page, admin);

    await test.step("criterio 1: la bandeja lo lista en «Listos para transferir» con un enlace a su gestión", async () => {
      const reembolsos = reembolsosDeLaBandeja(page);
      await expect(reembolsos.getByRole("heading", { level: 3, name: "Listos para transferir (1)" })).toBeVisible(ESPERA);
      await expect(filasDelGrupo(page, "Listos para transferir")).toContainText(r.motivo);
      const enlace = reembolsos.getByRole("link", { name: r.motivo });
      await expect(enlace).toContainText(pesos(r.monto));
      await enlace.click();
      await expect(page).toHaveURL(rutaDe(r), ESPERA);
      await expect(titulo(page, "Transferir el reembolso")).toBeVisible(ESPERA);
      await expect(page).toHaveTitle("Gestionar un reembolso · Calibra");
    });

    await test.step("quién pagó, su correo, el monto, el motivo, el estado y a quién está asignado; la monitoría; la llave para transferir", async () => {
      const datos = seccionReembolso(page);
      await expect(dato(datos, "Pagador")).toHaveText(r.nombrePagador);
      await expect(dato(datos, "Correo de quien pagó")).toHaveText(r.contacto);
      await expect(dato(datos, "Monto")).toHaveText(pesos(r.monto));
      await expect(dato(datos, "Motivo")).toHaveText(r.motivo);
      await expect(dato(datos, "Estado")).toHaveText("Listo para transferir");
      await expect(dato(datos, "Asignado a")).toHaveText(admin.nombre);
      const monitoria = seccionMonitoria(page);
      await expect(dato(monitoria, "Materia")).toHaveText(materia);
      await expect(dato(monitoria, "Fecha")).toHaveText(formatearDia(r.fechaMonitoria));
      await expect(dato(monitoria, "Hora")).toHaveText("10:00 a 11:00");
      await expect(dato(monitoria, "Estado")).toHaveText("Cancelada: la canceló el estudiante");
      await expect(page.getByRole("heading", { level: 2, name: `Transferir ${pesos(r.monto)}` })).toBeVisible();
      await expect(page.getByLabel("Llave de quien pagó")).toHaveValue(r.llave!);
      await expectSinComision(page, r);
      // La confirmación está cerrada hasta que la pide.
      await expect(botonRegistrar(page)).toBeHidden();
      await expectReglasDelProducto(page, "un reembolso pendiente");
    });

    await test.step("copiar deja la llave en el portapapeles y lo anuncia", async () => {
      await page.getByRole("button", { name: "Copiar llave" }).click();
      await expect(aviso(page, "Copiada.")).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(r.llave);
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
      // botón de confirmar aunque esté oculto). Ninguna petición sale de la página y el reembolso sigue pendiente.
      const envio = page.waitForRequest((peticion) => peticion.method() === "POST", { timeout: 3_000 }).catch(() => null);
      await page.locator("form").evaluate((formulario: HTMLFormElement) => formulario.requestSubmit());
      expect(await envio, "un envío con la confirmación cerrada no llega a la acción").toBeNull();
      await expect(page).toHaveURL(rutaDe(r));
      expect(await escenario.enBd(r.id)).toMatchObject({ estado: "pendiente", referencia_transferencia: null, fecha_reembolso: null });
    });

    await test.step("supuesto 4: al abrirla, la confirmación dice antes qué se registra; supuesto 3: la fecha viene con hoy, sin pasar de hoy ni del día en que se creó", async () => {
      await abrirConfirmacion(page).click();
      await expect(page.getByText(`Registra la transferencia de ${pesos(r.monto)} a ${r.llave}. No se puede deshacer.`)).toBeVisible();
      await expect(botonRegistrar(page)).toBeVisible();
      const fecha = page.getByLabel("Fecha de la transferencia");
      await expect(fecha).toHaveValue(hoy());
      await expect(fecha).toHaveAttribute("max", hoy());
      await expect(fecha).toHaveAttribute("min", creado);
      await expectReglasDelProducto(page, "la confirmación abierta");
    });

    await test.step("una fecha anterior al día en que se creó no se registra: el error se anuncia (role=alert) y lo escrito se conserva", async () => {
      await page.getByLabel("Referencia de la transferencia").fill(referencia);
      await page.getByLabel("Fecha de la transferencia").fill(sumarDias(creado, -1));
      await botonRegistrar(page).click();
      await expect(alertas(page)).toHaveText(ERROR_ANTES_DE_CREARSE, ESPERA);
      await expect(page.getByLabel("Referencia de la transferencia")).toHaveValue(referencia);
      await expect(page.getByLabel("Fecha de la transferencia")).toHaveValue(sumarDias(creado, -1));
      await expect(botonRegistrar(page)).toBeVisible();
      await expectReglasDelProducto(page, "el error de la fecha");
      expect(await escenario.enBd(r.id)).toMatchObject({ estado: "pendiente", referencia_transferencia: null, fecha_reembolso: null });
    });

    await test.step("criterio 2: al confirmar con la fecha de hoy queda reembolsado con su id, la referencia y la fecha; la página lo dice arriba (role=status) y lo pinta registrado", async () => {
      await page.getByLabel("Fecha de la transferencia").fill(hoy());
      await botonRegistrar(page).click();
      await expect(aviso(page, "Registraste la transferencia.")).toHaveText(AVISO_REGISTRADO, ESPERA);
      await expect(page).toHaveURL(`${rutaDe(r)}?registrado=reembolsado`);
      await expect(titulo(page, "Reembolso registrado")).toBeVisible();
      const datos = seccionReembolso(page);
      await expect(dato(datos, "Estado")).toHaveText("Reembolsado");
      await expect(dato(datos, "Referencia")).toHaveText(referencia);
      await expect(dato(datos, "Fecha de la transferencia")).toHaveText(formatearDia(hoy()));
      await expect(dato(datos, "Registrado por")).toHaveText(admin.nombre);
      // Quien lo registró sigue viendo a qué llave transfirió (supuesto 9).
      await expect(dato(datos, "Llave de quien pagó")).toHaveText(r.llave!);
      await expect(page.locator("form")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Copiar llave" })).toHaveCount(0);
      await expectSinComision(page, r);
      await expectReglasDelProducto(page, "el reembolso registrado");

      const fila = await escenario.enBd(r.id);
      expect({ ...fila, fecha_reembolso: new Date(fila.fecha_reembolso!).getTime() }).toEqual({
        estado: "reembolsado",
        id_admin: admin.id,
        llave_destino: r.llave,
        referencia_transferencia: referencia,
        // Mediodía de Bogotá (UTC-5) del día de la transferencia.
        fecha_reembolso: new Date(`${hoy()}T17:00:00Z`).getTime(),
        cerrado_en: null,
      });
    });

    await test.step("vuelve a su bandeja: el reembolso ya no está", async () => {
      await page.getByRole("link", { name: "Volver a mi bandeja" }).click();
      await expect(page).toHaveURL("/admin", ESPERA);
      const reembolsos = reembolsosDeLaBandeja(page);
      await expect(reembolsos.getByText("No tienes reembolsos por atender.")).toBeVisible(ESPERA);
      await expect(reembolsos.getByRole("link", { name: r.motivo })).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 3 y supuesto 11: esperando la llave y cerrado sin llave
// ---------------------------------------------------------------------------
test.describe("Criterio 3 · esperando la llave se reenvía el enlace; un caso cerrado solo se muestra", () => {
  test("esperando: sin formulario de registro ni llave; «Reenviar el enlace» avisa y deja un solo reenvío aunque se pulse otra vez, también sin JavaScript; cerrado por pg_cron o solo vencido: sin ningún formulario, con cuándo terminó el plazo y la indicación de reabrirlo desde la bandeja", async ({
    page,
    browser,
    baseURL,
    context,
    escenario,
  }) => {
    const { admin } = escenario;
    const esperando = await escenario.reembolso({ largo: true });
    const cerrado = await escenario.reembolso({ plazo: "cerrado", largo: true });
    const vencido = await escenario.reembolso({ plazo: "vencido" });
    const vence = normalizar(formatearFechaHora(venceDe(esperando.plazoLlaveDesde)));
    await entrarComoAdmin(page, admin);

    await test.step("criterio 1: la bandeja lo lista en «Esperando la llave del pagador» con un enlace a su gestión", async () => {
      await expect(filasDelGrupo(page, "Esperando la llave").filter({ hasText: esperando.motivo })).toHaveCount(1, ESPERA);
      await reembolsosDeLaBandeja(page).getByRole("link", { name: esperando.motivo }).click();
      await expect(page).toHaveURL(rutaDe(esperando), ESPERA);
      await expect(titulo(page, "Esperando la llave")).toBeVisible(ESPERA);
      await expect(page.getByText("Le pedimos la llave a quien pagó. Cuando la envíe, el reembolso queda listo para transferir.")).toBeVisible();
    });

    await test.step("el plazo y lo que hace el botón, sin la llave ni el formulario de registro", async () => {
      const datos = seccionReembolso(page);
      await expect(dato(datos, "Estado")).toHaveText("Esperando la llave");
      await expect(dato(datos, "Plazo para enviar la llave")).toHaveText(`Hasta el ${vence}`);
      await expect(dato(datos, "Asignado a")).toHaveText(admin.nombre);
      await expect(page.getByText(`Le volvemos a mandar el enlace a ${esperando.contacto}. El plazo no cambia: sigue venciendo el ${vence}.`)).toBeVisible();
      await expect(abrirConfirmacion(page)).toHaveCount(0);
      await expect(page.getByLabel("Llave de quien pagó")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Copiar llave" })).toHaveCount(0);
      await expectSinComision(page, esperando);
      await expectReglasDelProducto(page, "un reembolso esperando la llave");
    });

    await test.step("reenviar: vuelve con el aviso arriba (role=status) y la base anota un solo reenvío, aunque lo pulse otra vez", async () => {
      await botonReenviar(page).click();
      await expect(page).toHaveURL(`${rutaDe(esperando)}?reenvio=reenviado`, ESPERA);
      await expect(aviso(page, AVISO_REENVIADO)).toBeVisible();
      expect(await escenario.pedidosDe(esperando.id)).toEqual(["pedido", "reenvio"]);
      // Otra vez, con el reenvío todavía en cola: la acción responde lo mismo y la base no anota otro.
      const respuesta = page.waitForResponse((recibida) => recibida.request().method() === "POST", ESPERA);
      await botonReenviar(page).click();
      await respuesta;
      await expect(aviso(page, AVISO_REENVIADO)).toBeVisible(ESPERA);
      expect(await escenario.pedidosDe(esperando.id)).toEqual(["pedido", "reenvio"]);
      await expectReglasDelProducto(page, "el aviso del reenvío");
    });

    await test.step("sin JavaScript el botón también reenvía, porque es un formulario común, y vuelve con el aviso", async () => {
      // La misma sesión en otro contexto: el Auth local limita los inicios de sesión.
      const sinJavaScript = await browser.newContext({
        baseURL,
        javaScriptEnabled: false,
        storageState: await context.storageState(),
        viewport: page.viewportSize() ?? undefined,
        locale: "es-CO",
        timezoneId: ZONA_HORARIA_NEGOCIO,
      });
      try {
        const otra = await sinJavaScript.newPage();
        await otra.goto(rutaDe(esperando));
        await expect(titulo(otra, "Esperando la llave")).toBeVisible(ESPERA);
        await botonReenviar(otra).click();
        await expect(otra).toHaveURL(`${rutaDe(esperando)}?reenvio=reenviado`, ESPERA);
        await expect(otra.getByText(AVISO_REENVIADO)).toBeVisible();
      } finally {
        await sinJavaScript.close();
      }
      expect(await escenario.pedidosDe(esperando.id)).toEqual(["pedido", "reenvio"]);
    });

    await test.step("supuesto 11: cerrado por pg_cron, sin ningún formulario (ni registrar, ni reenviar, ni reabrir), con cuándo terminó el plazo y cuándo se cerró, y la indicación de reabrirlo desde la bandeja", async () => {
      const { cerrado_en } = await escenario.enBd(cerrado.id);
      await page.goto(rutaDe(cerrado));
      await expect(titulo(page, "Caso cerrado sin llave")).toBeVisible(ESPERA);
      await expect(page.getByText("Pasó el plazo sin que quien pagó enviara su llave.")).toBeVisible();
      const datos = seccionReembolso(page);
      await expect(dato(datos, "Estado")).toHaveText("Cerrado sin llave");
      await expect(dato(datos, "Plazo para enviar la llave")).toHaveText(`Terminó el ${normalizar(formatearFechaHora(venceDe(cerrado.plazoLlaveDesde)))}`);
      await expect(dato(datos, "Cierre")).toHaveText(`Se cerró el ${normalizar(formatearFechaHora(new Date(cerrado_en!)))}`);
      await expect(page.getByText(REABRIR_DESDE_LA_BANDEJA)).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
      await expect(botonReenviar(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Reabrir y reenviar el enlace" })).toHaveCount(0);
      await expect(abrirConfirmacion(page)).toHaveCount(0);
      await expect(page.getByLabel("Llave de quien pagó")).toHaveCount(0);
      await expectSinComision(page, cerrado);
      await expectReglasDelProducto(page, "un caso cerrado sin llave");
    });

    await test.step("vencido sin que pg_cron lo haya cerrado: la página ya lo da por cerrado (con la hora de la base) y tampoco ofrece reenviar", async () => {
      await page.goto(rutaDe(vencido));
      await expect(titulo(page, "Caso cerrado sin llave")).toBeVisible(ESPERA);
      await expect(dato(seccionReembolso(page), "Plazo para enviar la llave")).toHaveText(
        `Terminó el ${normalizar(formatearFechaHora(venceDe(vencido.plazoLlaveDesde)))}`,
      );
      await expect(page.getByText(REABRIR_DESDE_LA_BANDEJA)).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Supuestos 1 y 9: otro admin activo
// ---------------------------------------------------------------------------
test.describe("Supuestos 1 y 9 · otro admin activo ve el caso, pero sin la llave ni el formulario", () => {
  test("su bandeja no los lista; el pendiente del otro admin se ve sin la llave (ni en el HTML ni en las respuestas) y sin formulario, con quién lo registra; el registrado, sin la llave; uno que espera la llave sí lo puede reenviar", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const { admin } = escenario;
    const otro = await cuentas.crearAdmin();
    const pendiente = await escenario.reembolso({ estado: "pendiente" });
    const reembolsado = await escenario.reembolso({ estado: "reembolsado" });
    const esperando = await escenario.reembolso();
    const respuestas = vigilarRespuestas(page);
    await entrarComoAdmin(page, otro);

    await test.step("su bandeja no los lista: los tiene asignados otro admin", async () => {
      const reembolsos = reembolsosDeLaBandeja(page);
      await expect(reembolsos.getByText("No tienes reembolsos por atender.")).toBeVisible(ESPERA);
      for (const r of [pendiente, reembolsado, esperando]) await expect(reembolsos.getByRole("link", { name: r.motivo })).toHaveCount(0);
    });

    await test.step("pendiente: quién lo tiene, sin la llave ni el formulario", async () => {
      await page.goto(rutaDe(pendiente));
      await expect(titulo(page, "Transferir el reembolso")).toBeVisible(ESPERA);
      await expect(dato(seccionReembolso(page), "Asignado a")).toHaveText(admin.nombre);
      await expect(dato(seccionReembolso(page), "Monto")).toHaveText(pesos(pendiente.monto));
      await expect(page.getByText(`Lo tiene asignado ${admin.nombre}: solo esa persona registra la transferencia.`)).toBeVisible();
      await expect(page.getByText("Transfiere el monto a la llave de quien pagó")).toHaveCount(0);
      await expect(page.locator("form")).toHaveCount(0);
      await expect(abrirConfirmacion(page)).toHaveCount(0);
      await expect(page.getByLabel("Llave de quien pagó")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Copiar llave" })).toHaveCount(0);
      expect(await page.content()).not.toContain(pendiente.llave!);
      await expectSinComision(page, pendiente);
      await expectReglasDelProducto(page, "un pendiente de otro admin");
    });

    await test.step("reembolsado: quién lo registró, sin la llave", async () => {
      await page.goto(rutaDe(reembolsado));
      await expect(titulo(page, "Reembolso registrado")).toBeVisible(ESPERA);
      const datos = seccionReembolso(page);
      await expect(dato(datos, "Registrado por")).toHaveText(admin.nombre);
      await expect(dato(datos, "Referencia")).toHaveText("REF-E2E");
      await expect(datos.locator("dt", { hasText: /^Llave de quien pagó$/ })).toHaveCount(0);
      expect(await page.content()).not.toContain(reembolsado.llave!);
    });

    await test.step("esperando la llave: reenviar es de cualquier admin activo", async () => {
      await page.goto(rutaDe(esperando));
      await expect(titulo(page, "Esperando la llave")).toBeVisible(ESPERA);
      await botonReenviar(page).click();
      await expect(page).toHaveURL(`${rutaDe(esperando)}?reenvio=reenviado`, ESPERA);
      await expect(aviso(page, AVISO_REENVIADO)).toBeVisible();
      expect(await escenario.pedidosDe(esperando.id)).toEqual(["pedido", "reenvio"]);
    });

    await test.step("ninguna llave llegó al navegador, en ninguna página ni respuesta", async () => {
      const todo = await respuestas();
      expect(todo).not.toContain(pendiente.llave!);
      expect(todo).not.toContain(reembolsado.llave!);
    });
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (copia de e2e/desembolsos.spec.ts, que mide `summary` e `input`:
// esta página los tiene; los desbordes se miden distinto, ver `medir`)
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
  expect(medidas.desbordes, `${donde}: nada se sale del ancho de la ventana`).toEqual([]);
  expect(medidas.menorTexto, `${donde}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
  expect(medidas.degradados, `${donde}: sin degradados`).toBe(0);
  expect(medidas.tactilesChicos, `${donde}: áreas táctiles de 44 px o más`).toEqual([]);
  expect(medidas.controlesSinNombre, `${donde}: todo control tiene nombre`).toEqual([]);
}

/**
 * Texto, áreas táctiles, degradados, nombres y desbordes. De las casillas cuenta su etiqueta, que también las marca.
 *
 * globals.css pone `overflow-x: hidden` en html y en body: body recorta lo que se sale y el documento nunca mide más que
 * la ventana, así que medir `document.documentElement` no puede fallar. Se mide el ancho de body y, además, cada caja y
 * cada línea de texto visibles contra el ancho de la ventana: un texto largo sin espacios que no se parte sale ahí,
 * aunque body lo esconda.
 */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const ancho = document.documentElement.clientWidth;
    const seSale = (caja: DOMRect) => caja.width > 0 && caja.height > 0 && (caja.left < -0.5 || caja.right > ancho + 0.5);
    const desbordes = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => seSale(el.getBoundingClientRect()))
      .map((el) => `<${el.tagName.toLowerCase()}> ${(el.textContent ?? "").trim().slice(0, 40)}`);
    const textos = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let nodo = textos.nextNode(); nodo; nodo = textos.nextNode()) {
      const contenido = nodo.textContent?.trim();
      if (!contenido) continue;
      const rango = document.createRange();
      rango.selectNodeContents(nodo);
      if ([...rango.getClientRects()].some(seSale)) desbordes.push(`texto: ${contenido.slice(0, 40)}`);
    }
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
      (el) => visible(el) && [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden]), textarea, summary")].filter(visible);
    // Los enlaces dentro de una frase son texto corrido: quedan fuera.
    const tocables = controles
      .filter((el) => !(el.tagName === "A" && el.closest("label, p")))
      .map((el) => (el instanceof HTMLInputElement && el.type === "checkbox" ? (el.labels?.[0] ?? el) : el));
    return {
      sinScrollHorizontal: document.body.scrollWidth <= document.body.clientWidth && document.documentElement.scrollWidth <= ancho,
      desbordes,
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
