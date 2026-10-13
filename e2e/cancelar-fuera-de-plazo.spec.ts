import { randomInt, randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { diaDelNegocio, formatearDia, formatearFechaHora } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { enviarCredenciales, expect, test as base, usarTurnstileDePrueba, type Cuenta } from "./utilidades";

// HU-052 (RN-60, D-60): un admin activo abre «Citas sin plazo para cancelar» desde su bandeja, escoge una cita confirmada a la
// que ya se le pasó el plazo de 12 h y todavía no empieza, la autoriza cancelar con un motivo de la lista y una nota, y la cita
// queda cancelada con reembolso. Corre contra el Supabase local y el servidor de Next con la configuración de .env.local
// (`npm run db:env`). Cada prueba crea y borra su propio admin, su monitor (con su llave), la materia, las franjas, el Lead y las
// monitorías con sus pagos: nombres y correos únicos, porque las pruebas corren en paralelo (móvil y escritorio) y solo se
// afirma sobre lo propio. Los correos los manda la app con sus procesadores, que recorre `integracion/cancelar-fuera-de-plazo.test.ts`
// hasta Mailpit: aquí no corre ninguno.
//
// La cita se prepara por la base, con la llave secreta: se aparta `pendiente_pago` y se confirma con un UPDATE, que es lo que
// anota el token en `confirmacion_cita` (el enlace de la cita del Lead). Empieza dentro de 5 horas, así que su plazo de 12 h ya
// pasó y el cierre automático no la alcanza mientras corre la prueba. Cada prueba inicia una sola sesión de admin (y la del
// monitor, si lo pide): el Auth local deja 30 inicios cada 5 minutos para toda la suite.

const ESPERA = { timeout: 20_000 };
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const MOTIVO_AUTORIZADO = "Cancelaste la monitoría y un admin autorizó hacerlo fuera del plazo.";

const MOTIVOS = {
  fuerza_mayor: "Fuerza mayor de quien agendó (urgencia de salud, accidente o calamidad familiar)",
  falla_de_calibra: "Una falla de Calibra impidió cancelar a tiempo",
  otro: "Otro (la nota es obligatoria)",
} as const;
const AYUDA_DE_LA_NOTA = "Escribe solo lo necesario para recordar el caso. No incluyas diagnósticos ni datos de salud.";
const ADVERTENCIA = "Antes de autorizar, comprueba que quien te escribió usó el mismo correo o teléfono que ves aquí.";
const PAGO_EN_REVISION = "Un pago sigue en revisión: si se aprueba, recibe su reembolso; si se rechaza, no hay reembolso.";

/** Texto con los espacios duros (los pesos y la hora los llevan) como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s+/g, " ");

const pesos = (monto: number) => normalizar(formatearPesos(monto));

// ---------------------------------------------------------------------------
// Fechas (America/Bogota)
// ---------------------------------------------------------------------------

/** Día ISO (1 = lunes ... 7 = domingo) de un día de calendario, como `franja.dia`. */
function diaIso(fecha: string): number {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * El inicio de una sesión que empieza dentro de `horas` horas (negativo: empezó hace), con su día, su hora (`HH:MM`) y una
 * duración que no pasa de la medianoche.
 */
function enHoras(horas: number): { inicio: Date; fecha: string; hora: string; duracionMin: number } {
  const inicio = new Date(Math.floor((Date.now() + horas * HORA) / MINUTO) * MINUTO);
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(inicio);
  const minutosDelDia = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
  return { inicio, fecha: diaDelNegocio(inicio), hora, duracionMin: Math.max(1, Math.min(30, 24 * 60 - minutosDelDia)) };
}

/** La hora en que termina una franja de `HH:MM` con esa duración, en `HH:MM`. */
function horaDeFin(hora: string, duracionMin: number): string {
  const total = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)) + duracionMin;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type PagoDeCita = { estado: "aprobado" | "en_revision"; monto?: number; nombre?: string };

type OpcionesDeCita = {
  /** Dentro de cuántas horas empieza; negativo, hace cuántas empezó. Por defecto, 5. */
  horas?: number;
  /** Sus pagos. Por defecto, uno aprobado. */
  pagos?: PagoDeCita[];
  /** El Lead que agendó: por defecto, uno con nombre, correo y teléfono propios. */
  lead?: Partial<{ nombre: string; correo: string; telefono: string }>;
};

type Pago = { id: string; nombre: string; monto: number; estado: PagoDeCita["estado"] };

type Cita = {
  id: string;
  /** El token del enlace de la cita del Lead (`/cita?token=`). */
  token: string;
  materia: string;
  /** El día de la sesión y su hora (`HH:MM`). */
  fecha: string;
  hora: string;
  duracionMin: number;
  inicio: Date;
  lead: { nombre: string; correo: string; telefono: string };
  pagos: Pago[];
  /** Lo que nunca debe salir en la pantalla: la comisión y el neto de cada pago (CLAUDE.md). */
  prohibidos: number[];
};

type Escenario = {
  /** El admin de la prueba: el único que entra. */
  admin: Cuenta;
  /** El monitor de todas las citas de la prueba, con su llave (`monitor_privado`). */
  monitor: Cuenta;
  cita(opciones?: OpcionesDeCita): Promise<Cita>;
  leerMonitoria(id: string): Promise<{ estado: string; motivo_cancelacion: string | null; fecha_finalizacion: string | null }>;
  leerAutorizacion(idMonitoria: string): Promise<{ id_admin: string; categoria: string; nota: string | null; autorizada_en: string } | null>;
  leerReembolsos(idMonitoria: string): Promise<{ id: string; id_pago: string; id_admin: string | null; monto: number; motivo: string; estado: string }[]>;
  leerEventosDeAviso(idMonitoria: string): Promise<string[]>;
  leerPedidosDeLlave(idReembolso: string): Promise<string[]>;
  leerCancelacion(idMonitoria: string): Promise<{ con_pago_en_revision: boolean; reembolso_a_otro_contacto: boolean } | null>;
  leerDesembolsos(idMonitoria: string): Promise<number>;
  leerPago(id: string): Promise<{ estado: string }>;
  /** Cancela la cita por la base, como si otra persona lo hubiera hecho mientras el admin miraba. */
  cancelarPorElEstudiante(idMonitoria: string): Promise<void>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const monitor = await cuentas.crearMonitor();
    const creados = {
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

    async function actualizar(tabla: string, id: string, cambios: Record<string, unknown>): Promise<void> {
      const { error } = await cliente.from(tabla).update(cambios).eq("id", id);
      if (error) throw new Error(`actualizar ${tabla}: ${error.message}`);
    }

    async function calcular(funcion: "comision" | "monto_neto", bruto: number): Promise<number> {
      const { data, error } = await cliente.rpc(funcion, { p_monto_bruto: bruto });
      if (error) throw new Error(`${funcion}: ${error.message}`);
      return data as number;
    }

    /** Un pago de la monitoría; su comprobante tiene que estar revisado antes (HU-059). */
    async function crearPago(idMonitoria: string, pago: PagoDeCita): Promise<Pago> {
      const comprobante = `${randomUUID()}/${randomUUID()}.png`;
      const { error } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
      if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
      creados.comprobantes.push(comprobante);
      const nombre = pago.nombre ?? `Pagador ${pago.estado === "aprobado" ? "aprobado" : "en revisión"} e2e ${randomUUID().slice(0, 6)}`;
      const monto = pago.monto ?? randomInt(110_000, 150_000);
      const id = await insertar("pago", {
        id_monitoria: idMonitoria,
        id_admin: admin.id,
        comprobante,
        monto,
        nombre_pagador: nombre,
        contacto: `pagador-${randomUUID()}@calibra.test`,
        estado: pago.estado,
        ...(pago.estado === "aprobado" ? { fecha_revision: new Date().toISOString() } : {}),
      });
      creados.pagos.push(id);
      return { id, nombre, monto, estado: pago.estado };
    }

    const materia = `Materia e2e citas ${randomUUID().slice(0, 6)}`;
    const idMateria = await insertar("materia", { nombre: materia, codigo: `E2E-${randomUUID().slice(0, 12)}` });
    creados.materias.push(idMateria);
    const { error: errorCertificado } = await cliente.from("certificado").insert({ id_monitor: monitor.id, id_materia: idMateria, id_admin: admin.id });
    if (errorCertificado) throw new Error(`insertar certificado: ${errorCertificado.message}`);

    await entregar({
      admin,
      monitor,
      async cita({ horas = 5, pagos = [{ estado: "aprobado" } satisfies PagoDeCita], lead: datosDelLead = {} } = {}) {
        const sesion = enHoras(horas);
        const idFranja = await insertar("franja", {
          id_monitor: monitor.id,
          dia: diaIso(sesion.fecha),
          hora: sesion.hora,
          duracion_min: sesion.duracionMin,
          presencial: true,
          lugar: `Salón e2e ${randomUUID().slice(0, 6)}`,
          precio: 25_000,
        });
        creados.franjas.push(idFranja);
        const lead = {
          nombre: datosDelLead.nombre ?? `Lead e2e ${randomUUID().slice(0, 6)}`,
          correo: datosDelLead.correo ?? `lead-${randomUUID()}@calibra.test`,
          telefono: datosDelLead.telefono ?? `31${randomInt(10_000_000, 99_999_999)}`,
        };
        const idLead = await insertar("lead", {
          nombre: lead.nombre,
          correo: lead.correo,
          numero_telefono: lead.telefono,
          acepta_tratamiento_datos: true,
          fecha_consentimiento: new Date().toISOString(),
        });
        creados.leads.push(idLead);

        // Se aparta pendiente de pago, como `agendar_monitoria`, y se confirma con un UPDATE, como `registrar_pago`.
        const idMonitoria = await insertar("monitoria", {
          id_franja: idFranja,
          id_monitor: monitor.id,
          id_materia: idMateria,
          id_lead: idLead,
          fecha: sesion.fecha,
          valor_total: 25_000,
          estado: "pendiente_pago",
        });
        creados.monitorias.push(idMonitoria);
        await actualizar("monitoria", idMonitoria, { estado: "confirmada" });
        const sus: Pago[] = [];
        for (const pago of pagos) sus.push(await crearPago(idMonitoria, pago));

        const { data: confirmacion, error } = await cliente.from("confirmacion_cita").select("token").eq("id_monitoria", idMonitoria).single();
        if (error) throw new Error(`leer el token de la cita: ${error.message}`);
        const prohibidos: number[] = [];
        for (const pago of sus) prohibidos.push(await calcular("comision", pago.monto), await calcular("monto_neto", pago.monto));
        return {
          id: idMonitoria,
          token: (confirmacion as { token: string }).token,
          materia,
          fecha: sesion.fecha,
          hora: sesion.hora,
          duracionMin: sesion.duracionMin,
          inicio: sesion.inicio,
          lead,
          pagos: sus,
          prohibidos,
        };
      },
      async leerMonitoria(id) {
        const { data, error } = await cliente.from("monitoria").select("estado, motivo_cancelacion, fecha_finalizacion").eq("id", id).single();
        if (error) throw new Error(`leer monitoria: ${error.message}`);
        return data;
      },
      async leerAutorizacion(idMonitoria) {
        const { data, error } = await cliente
          .from("cancelacion_excepcional")
          .select("id_admin, categoria, nota, autorizada_en")
          .eq("id_monitoria", idMonitoria)
          .maybeSingle();
        if (error) throw new Error(`leer cancelacion_excepcional: ${error.message}`);
        return data;
      },
      async leerReembolsos(idMonitoria) {
        const { data: pagosDeLaCita, error: errorPagos } = await cliente.from("pago").select("id").eq("id_monitoria", idMonitoria);
        if (errorPagos) throw new Error(`leer pagos: ${errorPagos.message}`);
        const { data, error } = await cliente
          .from("reembolso")
          .select("id, id_pago, id_admin, monto, motivo, estado")
          .in("id_pago", (pagosDeLaCita ?? []).map((p) => p.id as string))
          .order("id_pago");
        if (error) throw new Error(`leer reembolsos: ${error.message}`);
        return data ?? [];
      },
      async leerEventosDeAviso(idMonitoria) {
        const { data, error } = await cliente.from("aviso_monitor").select("evento").eq("id_monitoria", idMonitoria).order("creado_en");
        if (error) throw new Error(`leer aviso_monitor: ${error.message}`);
        return (data ?? []).map((fila) => fila.evento as string);
      },
      async leerPedidosDeLlave(idReembolso) {
        const { data, error } = await cliente.from("pedido_llave").select("tipo").eq("id_reembolso", idReembolso);
        if (error) throw new Error(`leer pedido_llave: ${error.message}`);
        return (data ?? []).map((fila) => fila.tipo as string);
      },
      async leerCancelacion(idMonitoria) {
        const { data, error } = await cliente
          .from("cancelacion_cita")
          .select("con_pago_en_revision, reembolso_a_otro_contacto")
          .eq("id_monitoria", idMonitoria)
          .maybeSingle();
        if (error) throw new Error(`leer cancelacion_cita: ${error.message}`);
        return data;
      },
      async leerDesembolsos(idMonitoria) {
        const { data, error } = await cliente.from("desembolso").select("id").eq("id_monitoria", idMonitoria);
        if (error) throw new Error(`leer desembolso: ${error.message}`);
        return (data ?? []).length;
      },
      async leerPago(id) {
        const { data, error } = await cliente.from("pago").select("estado").eq("id", id).single();
        if (error) throw new Error(`leer pago: ${error.message}`);
        return data;
      },
      cancelarPorElEstudiante: (idMonitoria) => actualizar("monitoria", idMonitoria, { estado: "cancelada", motivo_cancelacion: "estudiante" }),
    });

    // Limpieza en el orden de las llaves foráneas, antes de que `cuentas` borre al admin y al monitor (pago y certificado les
    // apuntan sin cascada). Los reembolsos que creó la autorización cuelgan de los pagos; su solicitud y su pedido de llave se
    // van con ellos, y la autorización, la cancelación anotada, el aviso al monitor y el token de la cita, con la monitoría.
    // Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (creados.pagos.length) await borrar("reembolsos", cliente.from("reembolso").delete().in("id_pago", creados.pagos));
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
const seccion = (page: Page, nombre: string) => page.getByRole("region", { name: nombre, exact: true });
const filaDeLaLista = (page: Page, c: Cita) => page.locator(`a[href="/admin/citas/${c.id}"]`);
/** El `<details>` de la confirmación: cerrado, esconde las consecuencias, el formulario y el botón. */
const abrir = (page: Page) => page.locator("summary", { hasText: "Autorizar la cancelación" });
const confirmacion = (page: Page) => page.locator("details", { has: page.locator("#autorizar-consecuencias") });
const consecuencias = (page: Page) => page.locator("#autorizar-consecuencias");
const botonDeConfirmar = (page: Page) => page.getByRole("button", { name: "Sí, cancelar la monitoría" });
const campoDeNota = (page: Page) => page.locator("#nota");
const motivo = (page: Page, cual: keyof typeof MOTIVOS) => page.getByLabel(MOTIVOS[cual], { exact: true });

/** El valor de una etiqueta (Materia, Estado...) dentro de una sección de la página. */
const dato = (donde: Locator, etiqueta: string): Locator =>
  donde.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");

async function entrarComoAdmin(page: Page, admin: Cuenta) {
  await page.goto("/admin");
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  await enviarCredenciales(page, admin.correo, admin.contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
}

/** Ni el bruto ni la comisión llegan a las pantallas de esta HU (CLAUDE.md, D-59): ni la palabra ni las cifras del pago. */
async function expectSinComision(page: Page, c: Cita) {
  const cuerpo = page.locator("body");
  await expect(cuerpo).not.toContainText(/comisi[oó]n/i);
  await expect(cuerpo).not.toContainText(/bruto/i);
  for (const monto of c.prohibidos) await expect(cuerpo).not.toContainText(pesos(monto));
}

/**
 * Detiene la petición de la acción del servidor (un POST con la cabecera `Next-Action`) hasta que la prueba la suelta: mientras
 * está en vuelo, el botón tiene que mostrar su estado de envío. Devuelve la función que la suelta.
 */
async function retenerLaAccion(page: Page): Promise<() => void> {
  let soltar!: () => void;
  const soltada = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  await page.route("**/admin/citas/*", async (route) => {
    const peticion = route.request();
    if (peticion.method() === "POST" && "next-action" in peticion.headers()) await soltada;
    await route.continue();
  });
  return soltar;
}

/** El contexto de otra persona (el Lead, el monitor): sin sesión de admin, con el mismo tamaño de pantalla y sin el reto real de Turnstile. */
async function otroContexto(browser: Browser, page: Page, baseURL: string | undefined): Promise<BrowserContext> {
  const contexto = await browser.newContext({ baseURL, locale: "es-CO", timezoneId: "America/Bogota", viewport: page.viewportSize() ?? undefined });
  await usarTurnstileDePrueba(contexto);
  return contexto;
}

/** 500 caracteres con 11 saltos de línea y un tramo largo sin espacios; el campo (que cuenta cada salto como uno) los deja escribir. */
function notaLarga(marca: string): string {
  const cabeza = `${[`caso ${marca}`, ...Array.from({ length: 10 }, (_, i) => `línea ${String(i + 1).padStart(2, "0")}`)].join("\n")}\n`;
  return `${cabeza}${"M".repeat(500 - cabeza.length)}`;
}

// ---------------------------------------------------------------------------
// El flujo completo: de la bandeja a la cita cancelada con su registro
// ---------------------------------------------------------------------------
test.describe("Autorizar · del enlace de la bandeja a la cita cancelada", () => {
  test("la bandeja enlaza la lista; la cita aparece con sus datos; el detalle trae los pagos y cuánto se devolvería; Enter con la confirmación cerrada no envía; el formulario inválido vuelve con su error y lo escrito; al confirmar la cita se cancela con su reembolso y su registro, y ni el Lead ni el monitor ven la nota", async ({
    page,
    browser,
    escenario,
  }, testInfo) => {
    const { admin, monitor } = escenario;
    const montoAprobado = randomInt(110_000, 150_000);
    const montoEnRevision = randomInt(20_000, 40_000);
    const c = await escenario.cita({ pagos: [{ estado: "aprobado", monto: montoAprobado }, { estado: "en_revision", monto: montoEnRevision }] });
    const conPlazo = await escenario.cita({ horas: 14 });
    const yaEmpezada = await escenario.cita({ horas: -0.1 });
    const [aprobado, enRevision] = c.pagos;
    const nota = notaLarga(randomUUID().slice(0, 8));
    expect(nota).toHaveLength(500);
    expect(nota.split("\n")).toHaveLength(12);
    const baseURL = testInfo.project.use.baseURL;
    await entrarComoAdmin(page, admin);

    await test.step("el enlace de la bandeja lleva a la lista", async () => {
      await page.getByRole("link", { name: "Citas sin plazo para cancelar" }).click();
      await expect(page).toHaveURL("/admin/citas", ESPERA);
      await expect(page).toHaveTitle("Citas sin plazo para cancelar · Calibra");
      await expect(titulo(page, "Citas sin plazo para cancelar")).toBeVisible();
      await expect(
        page.getByText(
          "Son las monitorías individuales confirmadas a las que ya se les pasó el plazo para cancelar y todavía no empiezan. Abre una para autorizar su cancelación en un caso extremo.",
        ),
      ).toBeVisible();
    });

    await test.step("la lista trae la cita con su día y hora, materia, monitor, quien agendó con su contacto y el estado del pago; no trae la de 14 h ni la que ya empezó; nunca comisión", async () => {
      const fila = filaDeLaLista(page, c);
      await expect(fila).toBeVisible(ESPERA);
      await expect(fila).toContainText(`${formatearDia(c.fecha)} a las ${c.hora}`);
      await expect(fila).toContainText(`${c.materia} · ${monitor.nombre}`);
      await expect(fila).toContainText(`Agendó ${c.lead.nombre} · ${c.lead.correo} · ${c.lead.telefono}`);
      await expect(fila).toContainText("Pago en revisión");
      // Del monitor, solo el nombre: su correo no sale.
      await expect(page.locator("body")).not.toContainText(monitor.correo);
      await expect(filaDeLaLista(page, conPlazo)).toHaveCount(0);
      await expect(filaDeLaLista(page, yaEmpezada)).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Volver a mi bandeja" })).toBeVisible();
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "la lista de citas");
      await fila.click();
      await expect(page).toHaveURL(`/admin/citas/${c.id}`, ESPERA);
      await expect(page).toHaveTitle("Autorizar una cancelación · Calibra");
    });

    await test.step("el detalle muestra la cita, los pagos con su estado, cuánto se devolvería, el pago en revisión y la advertencia; el formulario está cerrado", async () => {
      await expect(titulo(page, "Autorizar la cancelación")).toBeVisible(ESPERA);
      const cita = seccion(page, "Cita");
      await expect(dato(cita, "Materia")).toHaveText(c.materia);
      await expect(dato(cita, "Fecha")).toHaveText(formatearDia(c.fecha));
      await expect(dato(cita, "Hora")).toHaveText(`${c.hora} a ${horaDeFin(c.hora, c.duracionMin)}`);
      await expect(dato(cita, "Monitor")).toHaveText(monitor.nombre);
      await expect(dato(cita, "Quién agendó")).toHaveText(c.lead.nombre);
      await expect(dato(cita, "Contacto de quien agendó")).toHaveText(`${c.lead.correo} · ${c.lead.telefono}`);
      await expect(dato(cita, "Estado")).toHaveText("Confirmada");
      await expect(dato(cita, "Plazo para cancelar")).toHaveText(`Terminó el ${normalizar(formatearFechaHora(new Date(c.inicio.getTime() - 12 * HORA)))}`);

      const pagos = seccion(page, "Pagos");
      await expect(pagos).toContainText(aprobado.nombre);
      await expect(pagos).toContainText(`${pesos(aprobado.monto)} · Aprobado`);
      await expect(pagos).toContainText(enRevision.nombre);
      await expect(pagos).toContainText(`${pesos(enRevision.monto)} · En revisión`);
      await expect(pagos).not.toContainText("Abrir el reembolso");
      await expect(pagos).toContainText(`Se devolverían ${pesos(aprobado.monto)}.`);
      await expect(pagos).toContainText(PAGO_EN_REVISION);
      await expect(page.getByText(ADVERTENCIA)).toBeVisible();
      await expect(abrir(page)).toBeVisible();
      await expect(botonDeConfirmar(page)).toBeHidden();
      await expect(campoDeNota(page)).toBeHidden();
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "el detalle con la confirmación cerrada");
    });

    await test.step("Enter sobre «Autorizar la cancelación» solo abre la confirmación: no cambia nada", async () => {
      await abrir(page).press("Enter");
      await expect(botonDeConfirmar(page)).toBeVisible();
      await abrir(page).click();
      await expect(botonDeConfirmar(page)).toBeHidden();
      expect((await escenario.leerMonitoria(c.id)).estado).toBe("confirmada");
      await expect(page).toHaveURL(`/admin/citas/${c.id}`);
    });

    await test.step("al abrirla se lee qué va a pasar antes del botón, los tres motivos y la frase de la nota", async () => {
      await abrir(page).click();
      await expect(consecuencias(page)).toHaveText(
        `La monitoría de ${c.materia} del ${formatearDia(c.fecha)} a las ${c.hora} se cancela. Esto no se puede deshacer. ` +
          `Se devuelven ${pesos(aprobado.monto)} a quien pagó y se le pide la llave por correo. ` +
          `${PAGO_EN_REVISION} ` +
          "Quien agendó y el monitor reciben un correo. Ninguno dice el motivo ni la nota. El monitor no cobra esta sesión.",
      );
      for (const texto of Object.values(MOTIVOS)) await expect(page.getByLabel(texto, { exact: true })).toBeVisible();
      await expect(page.getByLabel("Nota (hasta 500 caracteres)")).toBeVisible();
      await expect(page.getByText(AYUDA_DE_LA_NOTA)).toBeVisible();
      await expect(botonDeConfirmar(page)).toHaveAttribute("aria-describedby", "autorizar-consecuencias");
      await expect(campoDeNota(page)).toHaveAttribute("maxlength", "500");
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "la confirmación abierta");
    });

    await test.step("sin motivo vuelve con el error y no cambia nada", async () => {
      await botonDeConfirmar(page).click();
      await expect(alerta(page, "Escoge el motivo de la lista.")).toBeVisible(ESPERA);
      await expect(confirmacion(page)).toHaveJSProperty("open", true);
      expect((await escenario.leerMonitoria(c.id)).estado).toBe("confirmada");
      expect(await escenario.leerAutorizacion(c.id)).toBeNull();
      await expectReglasDelProducto(page, "el error por falta de motivo");
    });

    await test.step("«Otro» sin nota (o con puros espacios) vuelve con el error y conserva lo escrito", async () => {
      await motivo(page, "otro").check();
      await campoDeNota(page).fill("   ");
      await botonDeConfirmar(page).click();
      await expect(alerta(page, "Con “Otro” la nota es obligatoria: cuenta qué pasó.")).toBeVisible(ESPERA);
      await expect(motivo(page, "otro")).toBeChecked();
      await expect(campoDeNota(page)).toHaveValue("   ");
      expect((await escenario.leerMonitoria(c.id)).estado).toBe("confirmada");
      await expectReglasDelProducto(page, "el error por «Otro» sin nota");
    });

    await test.step("con más de 500 caracteres vuelve con el error y conserva lo escrito", async () => {
      // 501 caracteres, con los 11 saltos de línea de la nota larga: uno más de lo que el campo deja escribir.
      const demasiado = `${nota}x`;
      // El campo limita lo que se escribe a 500 (y `fill` lo respeta): para que llegue a la acción lo que el navegador no dejaría
      // escribir, se le quita el límite, como haría un cliente que se lo salta.
      await campoDeNota(page).evaluate((campo: HTMLTextAreaElement) => campo.removeAttribute("maxlength"));
      await motivo(page, "fuerza_mayor").check();
      await campoDeNota(page).fill(demasiado);
      await botonDeConfirmar(page).click();
      await expect(alerta(page, "La nota puede tener hasta 500 caracteres.")).toBeVisible(ESPERA);
      await expect(motivo(page, "fuerza_mayor")).toBeChecked();
      await expect(campoDeNota(page)).toHaveValue(demasiado);
      expect((await escenario.leerMonitoria(c.id)).estado).toBe("confirmada");
      expect(await escenario.leerAutorizacion(c.id)).toBeNull();
      await expectReglasDelProducto(page, "el error por una nota larga");
    });

    await test.step("Enter sobre un motivo no envía el formulario: solo lo envía el botón de confirmar; en la nota, Enter sigue escribiendo un salto de línea", async () => {
      // Con motivo y nota válidos: si Enter sobre el motivo enviara el formulario (el envío implícito del navegador), la monitoría
      // quedaría cancelada sin pulsar «Sí, cancelar la monitoría». La petición se retiene para que un envío se vea: el botón queda
      // inactivo diciendo «Cancelando…».
      await motivo(page, "falla_de_calibra").check();
      await campoDeNota(page).fill(nota);
      const soltar = await retenerLaAccion(page);
      try {
        await motivo(page, "falla_de_calibra").press("Enter");
        // Dos cuadros de dibujo después del Enter: React ya pintó lo que el envío hubiera cambiado.
        await page.evaluate(() => new Promise<void>((resolver) => requestAnimationFrame(() => requestAnimationFrame(() => resolver()))));
        await expect(page.getByRole("button", { name: "Cancelando…" })).toHaveCount(0);
        await expect(botonDeConfirmar(page)).toBeEnabled();
        await expect(page).toHaveURL(`/admin/citas/${c.id}`);
        await expect(motivo(page, "falla_de_calibra")).toBeChecked();
        await expect(campoDeNota(page)).toHaveValue(nota);
        expect((await escenario.leerMonitoria(c.id)).estado).toBe("confirmada");
        expect(await escenario.leerAutorizacion(c.id)).toBeNull();
      } finally {
        soltar();
        await page.unroute("**/admin/citas/*");
      }
      // Las flechas siguen moviendo el motivo y Enter en la nota sigue escribiendo: solo el envío desde el motivo está frenado.
      await motivo(page, "falla_de_calibra").press("ArrowDown");
      await expect(motivo(page, "otro")).toBeChecked();
      await campoDeNota(page).fill("Primera línea");
      await campoDeNota(page).press("Enter");
      await campoDeNota(page).pressSequentially("Segunda línea");
      await expect(campoDeNota(page)).toHaveValue("Primera línea\nSegunda línea");
      await expect(page.getByRole("button", { name: "Cancelando…" })).toHaveCount(0);
      expect((await escenario.leerMonitoria(c.id)).estado).toBe("confirmada");
      expect(await escenario.leerAutorizacion(c.id)).toBeNull();
    });

    await test.step("con 500 caracteres y 11 saltos de línea (511 en el envío) la acción acepta: el botón dice «Cancelando…» mientras la petición está en vuelo y el aviso dice lo que quedó", async () => {
      await motivo(page, "falla_de_calibra").check();
      await campoDeNota(page).fill(nota);
      await expect(campoDeNota(page)).toHaveValue(nota);
      const soltar = await retenerLaAccion(page);
      await botonDeConfirmar(page).click();
      // Con la petición en vuelo el botón está inactivo y dice «Cancelando…»: no hay doble clic.
      await expect(page.getByRole("button", { name: "Cancelando…" })).toBeDisabled(ESPERA);
      expect((await escenario.leerMonitoria(c.id)).estado).toBe("confirmada");
      soltar();

      await expect(aviso(page, "Autorizaste la cancelación")).toHaveText(
        "Autorizaste la cancelación. La monitoría quedó cancelada. Creamos 1 reembolso y le pedimos la llave a quien pagó. " +
          "El pago en revisión recibirá su reembolso cuando se apruebe. Quien agendó y el monitor reciben un correo.",
        ESPERA,
      );
      await expect(alerta(page, "La nota puede tener hasta 500 caracteres.")).toHaveCount(0);
      await expect(page).toHaveURL(`/admin/citas/${c.id}?autorizada=1`);
    });

    await test.step("la página pasa a «Cancelación autorizada» con quién, cuándo, el motivo y la nota entera, y ya no ofrece formulario", async () => {
      await expect(titulo(page, "Cancelación autorizada")).toBeVisible();
      await expect(dato(seccion(page, "Cita"), "Estado")).toHaveText("Cancelada: la canceló el estudiante");
      const autorizacion = seccion(page, "Autorización");
      await expect(dato(autorizacion, "Autorizó")).toHaveText(admin.nombre);
      await expect(dato(autorizacion, "Cuándo")).toBeVisible();
      await expect(dato(autorizacion, "Motivo")).toHaveText("Una falla de Calibra impidió cancelar a tiempo");
      expect(await dato(autorizacion, "Nota").innerText()).toBe(nota);
      await expect(page.locator("form")).toHaveCount(0);
      await expect(abrir(page)).toHaveCount(0);
      await expect(page.getByText(ADVERTENCIA)).toHaveCount(0);
      // El aviso de un pago en revisión sigue a la vista: cuando se apruebe, recibe su reembolso.
      await expect(seccion(page, "Pagos")).toContainText(PAGO_EN_REVISION);
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "la cancelación autorizada");
    });

    const reembolso = await test.step("la base quedó bien: cancelada por el estudiante, el registro con la nota entera, un reembolso con el motivo exacto, el aviso al monitor y sin desembolso", async () => {
      expect(await escenario.leerMonitoria(c.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante", fecha_finalizacion: null });
      const registro = await escenario.leerAutorizacion(c.id);
      expect(registro).toMatchObject({ id_admin: admin.id, categoria: "falla_de_calibra", nota });
      expect(registro!.nota).toHaveLength(500);
      expect(registro!.nota).not.toContain("\r");
      expect(Math.abs(new Date(registro!.autorizada_en).getTime() - Date.now())).toBeLessThan(5 * MINUTO);
      // Un reembolso por el pago aprobado, completo, y ninguno por el que sigue en revisión (P-07).
      const reembolsos = await escenario.leerReembolsos(c.id);
      expect(reembolsos).toEqual([
        expect.objectContaining({ id_pago: aprobado.id, monto: aprobado.monto, motivo: MOTIVO_AUTORIZADO, estado: "esperando_llave" }),
      ]);
      expect(reembolsos[0].id_admin).not.toBe(admin.id);
      expect((await escenario.leerPago(enRevision.id)).estado).toBe("en_revision");
      expect(await escenario.leerPedidosDeLlave(reembolsos[0].id)).toEqual(["pedido"]);
      expect(await escenario.leerCancelacion(c.id)).toEqual({ con_pago_en_revision: true, reembolso_a_otro_contacto: true });
      expect(await escenario.leerEventosDeAviso(c.id)).toEqual(["confirmada", "cancelada"]);
      expect(await escenario.leerDesembolsos(c.id)).toBe(0);
      return reembolsos[0];
    });

    await test.step("la página enlaza el reembolso, que lleva el motivo exacto y no el de la excepción", async () => {
      const enlace = seccion(page, "Pagos").getByRole("link", { name: "Abrir el reembolso" });
      await expect(enlace).toHaveCount(1);
      await expect(enlace).toHaveAttribute("href", `/admin/reembolsos/${reembolso.id}`);
      await enlace.click();
      await expect(page).toHaveURL(`/admin/reembolsos/${reembolso.id}`, ESPERA);
      const datos = seccion(page, "Reembolso");
      await expect(dato(datos, "Pagador")).toHaveText(aprobado.nombre);
      await expect(dato(datos, "Monto")).toHaveText(pesos(aprobado.monto));
      await expect(dato(datos, "Motivo")).toHaveText(MOTIVO_AUTORIZADO);
      await expect(dato(datos, "Estado")).toHaveText("Esperando la llave");
      await expect(page.locator("body")).not.toContainText(nota.slice(0, 40));
    });

    await test.step("la cita sale de la lista", async () => {
      await page.goto("/admin/citas");
      await expect(titulo(page, "Citas sin plazo para cancelar")).toBeVisible(ESPERA);
      await expect(filaDeLaLista(page, c)).toHaveCount(0);
    });

    await test.step("el Lead, con el enlace de su cita, la ve cancelada como siempre; la nota no está en la página, ni en sus scripts ni en la respuesta", async () => {
      const contexto = await otroContexto(browser, page, baseURL);
      try {
        const suPagina = await contexto.newPage();
        // El enlace del correo no necesita sesión anónima (D-20): se aborta el alta.
        await suPagina.route("**/auth/v1/signup", (ruta) => ruta.abort());
        const respuesta = await suPagina.goto(`/cita?token=${c.token}`);
        await expect(titulo(suPagina, "Esta monitoría se canceló")).toBeVisible(ESPERA);
        await expect(suPagina.getByText("La cancelaste tú.")).toBeVisible();
        await expect(suPagina.getByText("Vamos a devolverte el dinero. Te escribimos al correo del pago para pedirte la llave.")).toBeVisible();
        // Los scripts de la carga de Next son donde se filtraría: se mira el HTML entero y la respuesta tal cual.
        const html = await suPagina.content();
        const crudo = await respuesta!.text();
        for (const contenido of [html, crudo]) {
          expect(contenido).not.toContain(nota.slice(0, 20));
          expect(contenido).not.toContain("M".repeat(40));
          expect(contenido).not.toContain(MOTIVOS.falla_de_calibra);
          expect(contenido).not.toContain("autorizó hacerlo fuera del plazo");
        }
        await expectReglasDelProducto(suPagina, "la cita del Lead cancelada");
      } finally {
        await contexto.close();
      }
    });

    await test.step("el monitor ve la monitoría cancelada en su agenda, sin la nota", async () => {
      const contexto = await otroContexto(browser, page, baseURL);
      try {
        const suPagina = await contexto.newPage();
        await suPagina.goto("/monitor/agenda");
        await expect(suPagina).toHaveURL("/ingresar?siguiente=%2Fmonitor%2Fagenda", ESPERA);
        await enviarCredenciales(suPagina, monitor.correo, monitor.contrasena);
        await expect(suPagina).toHaveURL("/monitor/agenda", ESPERA);
        await expect(suPagina.getByText(c.materia).first()).toBeVisible(ESPERA);
        await expect(suPagina.getByText(/Cancelada/).first()).toBeVisible();
        const html = await suPagina.content();
        expect(html).not.toContain(nota.slice(0, 20));
        expect(html).not.toContain(MOTIVOS.falla_de_calibra);
        await expect(suPagina.locator("body")).not.toContainText(/comisi[oó]n/i);
      } finally {
        await contexto.close();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Lo que cambió mientras el admin miraba, y las citas que no se pueden autorizar
// ---------------------------------------------------------------------------
test.describe("Autorizar · una cita que cambió o que no se puede autorizar dice por qué y no ofrece formulario", () => {
  test("otra persona la cancela antes de enviar: la página vuelve con «ya estaba cancelada», una sola vez, sin formulario y sin registro", async ({ page, escenario }) => {
    const { admin } = escenario;
    const c = await escenario.cita();
    await entrarComoAdmin(page, admin);
    await page.goto(`/admin/citas/${c.id}`);
    await expect(titulo(page, "Autorizar la cancelación")).toBeVisible(ESPERA);
    await abrir(page).click();
    await motivo(page, "fuerza_mayor").check();

    // Mientras el admin tenía el formulario abierto, el Lead (o el otro admin) la cancela.
    await escenario.cancelarPorElEstudiante(c.id);
    await botonDeConfirmar(page).click();

    const mensaje = "Esta monitoría ya estaba cancelada (la canceló quien agendó o la autorizó otro admin). No se cambió nada.";
    await expect(titulo(page, "No se puede autorizar esta cancelación")).toBeVisible(ESPERA);
    await expect(page).toHaveURL(`/admin/citas/${c.id}?error=ya_cancelada`);
    await expect(alerta(page, mensaje)).toBeVisible();
    // El mismo texto no sale dos veces.
    await expect(page.getByText(mensaje)).toHaveCount(1);
    await expect(page.locator("form")).toHaveCount(0);
    await expect(abrir(page)).toHaveCount(0);
    await expect(aviso(page, "Autorizaste")).toHaveCount(0);
    expect(await escenario.leerAutorizacion(c.id)).toBeNull();
    expect(await escenario.leerReembolsos(c.id)).toEqual([]);
    await expectSinComision(page, c);
    await expectReglasDelProducto(page, "la cita que otra persona canceló");
  });

  test("una cita que ya empezó, una con el plazo vigente y un id que no existe: cada una con su mensaje, sin formulario y sin comisión", async ({ page, escenario }) => {
    const { admin } = escenario;
    const empezada = await escenario.cita({ horas: -0.1 });
    const conPlazo = await escenario.cita({ horas: 14 });
    await entrarComoAdmin(page, admin);

    await test.step("la que ya empezó: desde el inicio solo cabe el reporte de inasistencia", async () => {
      await page.goto(`/admin/citas/${empezada.id}`);
      await expect(titulo(page, "No se puede autorizar esta cancelación")).toBeVisible(ESPERA);
      await expect(
        page.getByText(
          "La sesión ya empezó, así que no se puede cancelar con esta autorización. Si el monitor no llegó, quien agendó puede reportar la inasistencia desde su cita.",
        ),
      ).toBeVisible();
      await expect(dato(seccion(page, "Cita"), "Plazo para cancelar")).toContainText("Terminó el");
      await expect(page.locator("form")).toHaveCount(0);
      await expect(abrir(page)).toHaveCount(0);
      // El aviso de P-07 es solo de donde se cancela: aquí no se cancela nada.
      await expect(page.locator("body")).not.toContainText("Un pago sigue en revisión");
      await expect(page.locator("body")).not.toContainText("Se devolverían");
      await expectSinComision(page, empezada);
      await expectReglasDelProducto(page, "la cita que ya empezó");
    });

    await test.step("la del plazo vigente: se cancela sola desde su cita, con reembolso", async () => {
      await page.goto(`/admin/citas/${conPlazo.id}`);
      await expect(titulo(page, "No se puede autorizar esta cancelación")).toBeVisible(ESPERA);
      await expect(
        page.getByText("Todavía hay plazo para cancelar: quien agendó la puede cancelar desde su cita, con reembolso. No hace falta autorizar nada."),
      ).toBeVisible();
      await expect(dato(seccion(page, "Cita"), "Plazo para cancelar")).toContainText("Termina el");
      await expect(page.locator("form")).toHaveCount(0);
      await expectSinComision(page, conPlazo);
      await expectReglasDelProducto(page, "la cita con el plazo vigente");
    });

    await test.step("un id inventado o con forma inválida es «no encontrada»", async () => {
      for (const ruta of [`/admin/citas/${randomUUID()}`, "/admin/citas/no-es-un-uuid"]) {
        await page.goto(ruta);
        await expect(titulo(page, "No encontramos esta página")).toBeVisible(ESPERA);
      }
    });

    expect((await escenario.leerMonitoria(empezada.id)).estado).toBe("confirmada");
    expect((await escenario.leerMonitoria(conPlazo.id)).estado).toBe("confirmada");
  });
});

// ---------------------------------------------------------------------------
// Textos largos: lo que escriben quienes agendan, pagan y el admin no tiene un largo corto
// ---------------------------------------------------------------------------
/** Quien pagó, 120 caracteres (el máximo de su nombre): palabras y un tramo sin espacios que solo `overflow-wrap` puede partir. */
const NOMBRE_LARGO = `${"Nombre ".repeat(8)}${"N".repeat(64)}`.slice(0, 120);

test.describe("Autorizar · textos largos", () => {
  test("un correo de más de 60 caracteres sin espacios y un nombre de 120 caracteres se leen enteros en la lista y el detalle, y una nota de 500 letras sin espacios se lee entera sin salirse de la pantalla", async ({
    page,
    escenario,
  }) => {
    expect(NOMBRE_LARGO).toHaveLength(120);
    const { admin } = escenario;
    const correoLargo = `lead-${"c".repeat(60)}-${randomUUID()}@calibra.test`;
    const nombreLargo = `Lead ${"L".repeat(100)}`;
    const notaDe500Letras = "Ñ".repeat(500);
    const c = await escenario.cita({ lead: { correo: correoLargo, nombre: nombreLargo }, pagos: [{ estado: "aprobado", nombre: NOMBRE_LARGO }] });
    await entrarComoAdmin(page, admin);

    await test.step("la lista muestra el correo y el nombre largos enteros sin que ningún elemento se salga de la pantalla", async () => {
      await page.goto("/admin/citas");
      const fila = filaDeLaLista(page, c);
      await expect(fila).toBeVisible(ESPERA);
      await expect(fila).toContainText(`Agendó ${nombreLargo} · ${correoLargo}`);
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "la lista con un correo largo");
    });

    await test.step("el detalle, cerrado y con la confirmación abierta, lee el pago y el contacto largos enteros", async () => {
      await page.goto(`/admin/citas/${c.id}`);
      await expect(titulo(page, "Autorizar la cancelación")).toBeVisible(ESPERA);
      await expect(dato(seccion(page, "Cita"), "Contacto de quien agendó")).toContainText(correoLargo);
      await expect(seccion(page, "Pagos")).toContainText(NOMBRE_LARGO);
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "el detalle con textos largos");
      await abrir(page).click();
      await expectReglasDelProducto(page, "la confirmación abierta con textos largos");
    });

    await test.step("una nota de 500 letras sin espacios se acepta y se lee entera, partida dentro de su caja", async () => {
      await motivo(page, "otro").check();
      await campoDeNota(page).fill(notaDe500Letras);
      await botonDeConfirmar(page).click();
      await expect(aviso(page, "Autorizaste la cancelación")).toBeVisible(ESPERA);
      await expect(alerta(page, "La nota puede tener hasta 500 caracteres.")).toHaveCount(0);
      await expect(titulo(page, "Cancelación autorizada")).toBeVisible();
      const nota = dato(seccion(page, "Autorización"), "Nota");
      expect(await nota.innerText()).toBe(notaDe500Letras);
      await expect(dato(seccion(page, "Autorización"), "Motivo")).toHaveText("Otro");
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "la cancelación autorizada con una nota de 500 letras");
    });

    expect(await escenario.leerAutorizacion(c.id)).toMatchObject({ categoria: "otro", nota: notaDe500Letras });
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (copia de e2e/resolver-reportes.spec.ts, que mide cada elemento: `html` y `body`
// llevan `overflow-x: hidden` y `scrollWidth` solo no delata un desborde; de los radios cuenta su etiqueta, que es lo que se toca)
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
  expect(medidas.desbordados, `${donde}: ningún elemento se sale de la pantalla`).toEqual([]);
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
    // `html` y `body` llevan `overflow-x: hidden` (globals.css): el scroll horizontal nunca aparece aunque el contenido se
    // desborde, así que `scrollWidth` de la página no lo delata. Se mide cada elemento a la vista: que su caja no se salga de
    // la ventana y que su contenido (un texto largo sin espacios, por ejemplo) no se salga de su propia caja.
    const ancho = window.innerWidth;
    const desbordados = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => visible(el) && !el.closest("nextjs-portal"))
      .flatMap((el) => {
        const caja = el.getBoundingClientRect();
        const fueraDeLaVentana = caja.right > ancho + 1 || caja.left < -1;
        const contenidoFueraDeSuCaja = el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
        if (!fueraDeLaVentana && !contenidoFueraDeSuCaja) return [];
        return [
          {
            elemento: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
            texto: (el.textContent ?? "").trim().slice(0, 40),
            izquierda: Math.round(caja.left),
            derecha: Math.round(caja.right),
            anchoDeLaCaja: el.clientWidth,
            anchoDelContenido: el.scrollWidth,
          },
        ];
      });
    return {
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      desbordados,
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
