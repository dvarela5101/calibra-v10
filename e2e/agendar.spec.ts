import { randomUUID } from "node:crypto";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { ZONA_HORARIA_NEGOCIO } from "../src/config/regional";
import { diaDelNegocio, formatearDiaConSemana, formatearHora } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { esperarSesion, expect, test as base, variable, type Cuenta, type SesionEnCookie } from "./utilidades";

// HU-017: agendar una monitoría individual, de la lista de monitores a la reserva apartada. Corre contra el Supabase
// local con materias, monitores, franjas y Leads que crea y borra cada prueba (la materia lleva un código único: las
// pruebas corren en paralelo y solo se afirma sobre lo propio).
//
// Cada navegador que abre una página pública gasta una sesión anónima (el Auth local limita cuántas por hora), así que
// solo las pruebas que lo necesitan la crean: las demás la bloquean (`sinSesionAnonima`) o miran desde un contexto sin
// sesión. Una sesión "ya es Lead" cuando se le crea el Lead con la llave secreta, igual que si hubiera dejado su
// contacto (HU-068); el flujo de dejarlo por la interfaz lo recorre solo la primera prueba.

const ESPERA = { timeout: 20_000 };
const HORA_MS = 3_600_000;
const PRECIO = 32_000;

const AUTORIZO = /Autorizo a Calibra a tratar mis datos personales/;
const CASILLA_SIN_CANCELACION = "Entiendo que no podré cancelarla";
const AVISO_SIN_CANCELACION = "Faltan menos de 12 horas para esta monitoría: si la apartas, no podrás cancelarla.";
const NO_DISPONIBLE = "Esta fecha ya no está disponible";

const hoy = () => diaDelNegocio(new Date());

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diaIso(fecha: string): number {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return dia === 0 ? 7 : dia;
}

const formatoHoraDelNegocio = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA_HORARIA_NEGOCIO, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });

/**
 * El día y la hora (`HH:MM`) en Bogotá del instante que cae a `horas` de ahora, sacados del mismo instante: si cruza la
 * medianoche, la fecha es la de mañana. Una franja semanal que abra a esa hora, ese día, empieza dentro de `horas`.
 */
function dentroDe(horas: number): { fecha: string; hora: string } {
  const instante = new Date(Date.now() + horas * HORA_MS);
  return { fecha: diaDelNegocio(instante), hora: formatoHoraDelNegocio.format(instante) };
}

/** Texto de la página con los espacios duros (la hora y los pesos los llevan) como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s/g, " ");

/** El valor que muestra el resumen para una etiqueta (Materia, Monitor, Fecha, Hora, Modalidad, Valor). */
const dato = (page: Page, etiqueta: string): Locator =>
  page.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");

const rutaDeAgendar = (idFranja: string, fecha: string, codigoMateria: string) =>
  `/agendar?${new URLSearchParams({ franja: idFranja, fecha, materia: codigoMateria })}`;

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Materia = { id: string; nombre: string; codigo: string };
type Franja = { id: string; lugar: string };
type FilaDeLead = { id: string; nombre: string; correo: string | null; id_sesion_anonima: string | null; acepta_tratamiento_datos: boolean };
type FilaDeMonitoria = {
  id: string;
  id_franja: string;
  id_monitor: string;
  id_materia: string;
  id_lead: string;
  fecha: string;
  estado: string;
  valor_total: number;
  fecha_creacion: string;
  id_diagnostico: string | null;
};

type Escenario = {
  materia(): Promise<Materia>;
  monitor(): Promise<Cuenta>;
  certificar(idMonitor: string, idMateria: string): Promise<void>;
  /** Franja semanal que abre desde hoy el día de `fecha` a `hora` (10:00 si no se dice), presencial por defecto. */
  franja(idMonitor: string, fecha: string, datos?: { hora?: string; precio?: number; duracionMin?: number }): Promise<Franja>;
  /** Un correo que solo existe en esta prueba: si queda como Lead, se borra al terminar. */
  correo(): string;
  /** Espera la sesión anónima que el navegador recibe al abrir una página pública, y la borra al terminar. */
  sesion(context: BrowserContext): Promise<SesionEnCookie>;
  /** Hace Lead a una sesión, como si hubiera dejado su contacto al agendar (HU-068). */
  volverLead(idSesion: string): Promise<FilaDeLead>;
  /** Un Lead que no es de ninguna sesión de la prueba. */
  crearLead(): Promise<FilaDeLead>;
  /** Una monitoría `pendiente_pago` de ese Lead, creada con la llave secreta (ocupa la fecha, RN-33). */
  apartar(franja: Franja, idMonitor: string, idMateria: string, fecha: string, idLead: string): Promise<string>;
  monitoriasDe(idFranja: string): Promise<FilaDeMonitoria[]>;
  leadsConCorreo(correo: string): Promise<FilaDeLead[]>;
};

type OtroContexto = (opciones?: { sinSesion?: boolean }) => Promise<BrowserContext>;

const COLUMNAS_DE_LEAD = "id, nombre, correo, id_sesion_anonima, acepta_tratamiento_datos";
const COLUMNAS_DE_MONITORIA =
  "id, id_franja, id_monitor, id_materia, id_lead, fecha, estado, valor_total, fecha_creacion, id_diagnostico";

const test = base.extend<{ escenario: Escenario; otroContexto: OtroContexto }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const creados = {
      materias: [] as string[],
      franjas: [] as string[],
      leads: [] as string[],
      sesiones: [] as string[],
      correos: [] as string[],
    };

    async function leer<T>(consulta: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, contexto: string): Promise<T[]> {
      const { data, error } = await consulta;
      if (error) throw new Error(`${contexto}: ${error.message}`);
      return data ?? [];
    }

    async function insertarLead(idSesion: string | null): Promise<FilaDeLead> {
      const correo = `e2e-${randomUUID()}@calibra.test`;
      const { data, error } = await cliente
        .from("lead")
        .insert({
          id_sesion_anonima: idSesion,
          nombre: "Lead e2e",
          correo,
          acepta_tratamiento_datos: true,
          fecha_consentimiento: new Date().toISOString(),
        })
        .select(COLUMNAS_DE_LEAD)
        .single();
      if (error) throw new Error(`insertar lead: ${error.message}`);
      creados.leads.push(data.id as string);
      return data as FilaDeLead;
    }

    await entregar({
      async materia() {
        const nombre = `Materia e2e agendar ${randomUUID().slice(0, 6)}`;
        const codigo = `E2E-${randomUUID().slice(0, 12)}`;
        const { data, error } = await cliente.from("materia").insert({ nombre, codigo }).select("id").single();
        if (error) throw new Error(`insertar materia: ${error.message}`);
        creados.materias.push(data.id as string);
        return { id: data.id as string, nombre, codigo };
      },
      monitor: () => cuentas.crearMonitor(),
      async certificar(idMonitor, idMateria) {
        const { error } = await cliente.from("certificado").insert({ id_monitor: idMonitor, id_materia: idMateria, id_admin: admin.id });
        if (error) throw new Error(`insertar certificado: ${error.message}`);
      },
      async franja(idMonitor, fecha, datos = {}) {
        const lugar = `Salón secreto ${randomUUID().slice(0, 8)}`;
        const hora = datos.hora ?? "10:00";
        const [h, m] = hora.split(":").map(Number);
        // Una franja termina el mismo día (P-30): si la hora cae a última hora del día, dura menos.
        const duracionMin = datos.duracionMin ?? Math.min(60, 24 * 60 - (h * 60 + m));
        const { data, error } = await cliente
          .from("franja")
          .insert({
            id_monitor: idMonitor,
            dia: diaIso(fecha),
            hora,
            duracion_min: duracionMin,
            presencial: true,
            precio: datos.precio ?? PRECIO,
            lugar,
            enlace: null,
          })
          .select("id")
          .single();
        if (error) throw new Error(`insertar franja: ${error.message}`);
        creados.franjas.push(data.id as string);
        return { id: data.id as string, lugar };
      },
      correo() {
        const correo = `e2e-${randomUUID()}@calibra.test`;
        creados.correos.push(correo);
        return correo;
      },
      async sesion(context) {
        const sesion = await esperarSesion(context);
        cuentas.borrarAlFinal(sesion.id);
        creados.sesiones.push(sesion.id);
        return sesion;
      },
      volverLead: (idSesion) => insertarLead(idSesion),
      crearLead: () => insertarLead(null),
      async apartar(franja, idMonitor, idMateria, fecha, idLead) {
        const { data, error } = await cliente
          .from("monitoria")
          .insert({ id_franja: franja.id, id_monitor: idMonitor, id_materia: idMateria, id_lead: idLead, fecha, valor_total: PRECIO, estado: "pendiente_pago" })
          .select("id")
          .single();
        if (error) throw new Error(`insertar monitoria: ${error.message}`);
        return data.id as string;
      },
      monitoriasDe: (idFranja) =>
        leer<FilaDeMonitoria>(cliente.from("monitoria").select(COLUMNAS_DE_MONITORIA).eq("id_franja", idFranja).order("fecha_creacion"), "leer monitorías"),
      leadsConCorreo: (correo) => leer<FilaDeLead>(cliente.from("lead").select(COLUMNAS_DE_LEAD).eq("correo", correo), "leer Leads por correo"),
    });

    // Limpieza en orden (monitorías antes que Lead, franjas y certificados), antes de que `cuentas` borre a los
    // monitores, al admin y a las sesiones. Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    const leads = new Set(creados.leads);
    if (creados.correos.length) {
      const porCorreo = await leer<{ id: string }>(cliente.from("lead").select("id").in("correo", creados.correos), "buscar Leads por correo");
      for (const { id } of porCorreo) leads.add(id);
    }
    if (creados.sesiones.length) {
      const porSesion = await leer<{ id: string }>(cliente.from("lead").select("id").in("id_sesion_anonima", creados.sesiones), "buscar Leads por sesión");
      for (const { id } of porSesion) leads.add(id);
    }
    if (creados.franjas.length) await borrar("monitorías de las franjas", cliente.from("monitoria").delete().in("id_franja", creados.franjas));
    if (leads.size) {
      await borrar("monitorías de los Leads", cliente.from("monitoria").delete().in("id_lead", [...leads]));
      await borrar("leads", cliente.from("lead").delete().in("id", [...leads]));
    }
    if (creados.correos.length) {
      await borrar("correo_envio por destinatario", cliente.from("correo_envio").delete().in("destinatario", creados.correos));
      for (const correo of creados.correos) {
        await fetch(`${variable("MAILPIT_URL")}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(
          (error: unknown) => fallos.push(`buzón de ${correo}: ${String(error)}`),
        );
      }
    }
    if (creados.franjas.length) await borrar("franjas", cliente.from("franja").delete().in("id", creados.franjas));
    await borrar("certificados", cliente.from("certificado").delete().eq("id_admin", admin.id));
    if (creados.materias.length) await borrar("materias", cliente.from("materia").delete().in("id", creados.materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },

  // Otro navegador (otro contexto, sus propias cookies), con o sin la sesión anónima que nace al abrir una página pública.
  otroContexto: async ({ browser, baseURL, viewport }, entregar) => {
    const abiertos: BrowserContext[] = [];
    await entregar(async ({ sinSesion = false } = {}) => {
      const contexto = await browser.newContext({ baseURL, viewport, locale: "es-CO", timezoneId: ZONA_HORARIA_NEGOCIO });
      if (sinSesion) await contexto.route("**/auth/v1/signup", (ruta) => ruta.abort());
      abiertos.push(contexto);
      return contexto;
    });
    for (const contexto of abiertos) await contexto.close();
  },
});

test.describe.configure({ mode: "default", timeout: 120_000 });

/** Sin alta anónima: estas pruebas no necesitan sesión y así no gastan el cupo por IP de Supabase Auth. */
async function sinSesionAnonima(page: Page) {
  await page.route("**/auth/v1/signup", (ruta) => ruta.abort());
}

// Next tiene su propio role="alert" (el anunciador de rutas): se busca por el texto.
const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });
const botonApartar = (page: Page) => page.getByRole("button", { name: "Apartar esta fecha" });
const tarjetaDe = (page: Page, nombre: string) => page.getByRole("region", { name: nombre });
const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });

/** Abre una página y espera a que termine de cargar e hidratarse: los formularios y la sesión anónima llegan después. */
async function abrir(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta);
  await page.waitForLoadState("networkidle");
}

/**
 * Abre una página pública, espera la sesión anónima que nace en el navegador, la vuelve Lead y recarga para que el
 * servidor la vea como Lead (la primera visita corre sin sesión).
 */
async function entrarComoLead(page: Page, escenario: Escenario, ruta: string) {
  await abrir(page, ruta);
  const sesion = await escenario.sesion(page.context());
  const lead = await escenario.volverLead(sesion.id);
  await page.reload();
  await page.waitForLoadState("networkidle");
  return { sesion, lead };
}

/** Lo que una prueba necesita casi siempre: una materia con un monitor certificado y una franja semanal. */
async function montar(escenario: Escenario, fecha: string, datos: { hora?: string; precio?: number; duracionMin?: number } = {}) {
  const materia = await escenario.materia();
  const monitor = await escenario.monitor();
  await escenario.certificar(monitor.id, materia.id);
  const franja = await escenario.franja(monitor.id, fecha, datos);
  return { materia, monitor, franja };
}

const RESERVA = /\/agendar\/reserva\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// ---------------------------------------------------------------------------
// Criterios 1 y 6 (D-3): un visitante nuevo, de la lista a la reserva
// ---------------------------------------------------------------------------
test.describe("Criterios 1 y 6 · un visitante nuevo agenda desde la lista", () => {
  test("toca Agendar en una fecha, confirma los datos, deja su contacto con autorización y aparta la fecha: queda una monitoría por pagar con el precio de la franja", async ({
    page,
    context,
    escenario,
  }) => {
    const fecha = sumarDias(hoy(), 2);
    const { materia, monitor, franja } = await montar(escenario, fecha, { precio: PRECIO, duracionMin: 90 });
    const correo = escenario.correo();
    const rutaAgendar = rutaDeAgendar(franja.id, fecha, materia.codigo);

    await abrir(page, `/monitores?materia=${encodeURIComponent(materia.codigo)}`);
    // La sesión anónima del visitante nace en el navegador: sin ella no habría a quién ligar su contacto.
    const sesion = await escenario.sesion(context);
    expect(sesion.esAnonimo).toBe(true);

    await test.step("cada fecha libre de la lista es un enlace Agendar a la página de confirmar", async () => {
      const fechas = tarjetaDe(page, monitor.nombre).getByRole("listitem");
      await expect(fechas).toHaveCount(4);
      await expect(fechas.getByText("Agendar", { exact: true })).toHaveCount(4);
      const enlace = tarjetaDe(page, monitor.nombre).getByRole("link", { name: new RegExp(formatearDiaConSemana(fecha)) });
      await expect(enlace).toHaveAttribute("href", rutaAgendar);
      await enlace.click();
      await expect(page).toHaveURL(rutaAgendar, ESPERA);
    });

    await test.step("confirma materia, monitor, fecha, hora, modalidad y valor; como no es Lead, se le pide dejar sus datos", async () => {
      await expect(titulo(page, "Confirma tu monitoría")).toBeVisible(ESPERA);
      await expect(dato(page, "Materia")).toHaveText(materia.nombre);
      await expect(dato(page, "Monitor")).toHaveText(monitor.nombre);
      await expect(dato(page, "Fecha")).toHaveText(formatearDiaConSemana(fecha));
      await expect(dato(page, "Hora")).toHaveText("10:00 a 11:30 (90 min)");
      await expect(dato(page, "Modalidad")).toHaveText("Presencial");
      await expect(dato(page, "Valor")).toHaveText(normalizar(formatearPesos(PRECIO)));
      await expect(page.getByText("El lugar te llega con la cita confirmada.")).toBeVisible();
      // D-5: el lugar de la franja solo llega con la cita confirmada.
      expect(await page.content()).not.toContain(franja.lugar);

      await expect(page.getByRole("link", { name: "Dejar mis datos y seguir" })).toBeVisible();
      await expect(botonApartar(page)).toHaveCount(0);
      expect(await escenario.monitoriasDe(franja.id)).toEqual([]);
    });

    await test.step("deja su contacto con la autorización de datos y vuelve a confirmar la misma fecha", async () => {
      await page.getByRole("link", { name: "Dejar mis datos y seguir" }).click();
      await expect(page).toHaveURL(/\/agendar\/contacto\?/, ESPERA);
      expect(new URL(page.url()).searchParams.get("siguiente")).toBe(rutaAgendar);
      await expect(titulo(page, "Tus datos para agendar")).toBeVisible(ESPERA);
      await page.waitForLoadState("networkidle");

      await page.getByLabel("Tu nombre", { exact: true }).fill("Camila Rojas");
      await page.getByLabel("Tu correo", { exact: true }).fill(correo);
      await page.getByLabel(AUTORIZO).check();
      await page.getByRole("button", { name: "Seguir" }).click();

      await expect(page).toHaveURL(rutaAgendar, ESPERA);
      await expect(titulo(page, "Confirma tu monitoría")).toBeVisible(ESPERA);
      await expect(page.getByRole("link", { name: "Dejar mis datos y seguir" })).toHaveCount(0);
      await expect(page.getByText(/queda a tu nombre por 10 minutos/)).toBeVisible();
      // Faltan más de 12 horas: no hay aviso de cancelación.
      await expect(page.getByLabel(CASILLA_SIN_CANCELACION)).toHaveCount(0);
      const [lead, ...otros] = await escenario.leadsConCorreo(correo);
      expect(otros, "el correo debía tener un solo Lead").toEqual([]);
      expect(lead).toMatchObject({ nombre: "Camila Rojas", id_sesion_anonima: sesion.id, acepta_tratamiento_datos: true });
    });

    await test.step("aparta la fecha: llega a su reserva, que dice hasta cuándo queda apartada y el valor", async () => {
      await page.waitForLoadState("networkidle");
      await botonApartar(page).click();
      await expect(page).toHaveURL(RESERVA, ESPERA);
      await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);

      const [lead] = await escenario.leadsConCorreo(correo);
      const monitorias = await escenario.monitoriasDe(franja.id);
      expect(monitorias).toHaveLength(1);
      const [monitoria] = monitorias;
      expect(monitoria).toMatchObject({
        id: RESERVA.exec(page.url())![1],
        id_lead: lead.id,
        id_monitor: monitor.id,
        id_materia: materia.id,
        fecha,
        estado: "pendiente_pago",
        valor_total: PRECIO,
        id_diagnostico: null,
      });

      // RN-34: queda apartada 10 minutos desde que se creó.
      const hasta = new Date(Date.parse(monitoria.fecha_creacion) + 10 * 60_000);
      await expect(page.getByRole("status").filter({ hasText: "La fecha queda a tu nombre hasta las" })).toHaveText(
        `La fecha queda a tu nombre hasta las ${normalizar(formatearHora(hasta))}. Si para entonces no llega el comprobante de pago, la reserva vence.`,
      );
      await expect(dato(page, "Materia")).toHaveText(materia.nombre);
      await expect(dato(page, "Monitor")).toHaveText(monitor.nombre);
      await expect(dato(page, "Fecha")).toHaveText(formatearDiaConSemana(fecha));
      await expect(dato(page, "Hora")).toHaveText("10:00 a 11:30 (90 min)");
      await expect(dato(page, "Valor")).toHaveText(normalizar(formatearPesos(PRECIO)));
      await expect(page.getByText("no se puede cancelar")).toHaveCount(0);
      expect(await page.content()).not.toContain(franja.lugar);
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 5 (RN-34): la fecha apartada aparece ocupada
// ---------------------------------------------------------------------------
test.describe("Criterio 5 (RN-34) · una fecha apartada deja de estar libre para los demás", () => {
  test("después de apartar, la lista de la materia (sin sesión) ya no muestra esa fecha ni deja confirmarla", async ({
    page,
    escenario,
    otroContexto,
  }) => {
    const fecha = sumarDias(hoy(), 2);
    const { materia, monitor, franja } = await montar(escenario, fecha);
    const rutaLista = `/monitores?materia=${encodeURIComponent(materia.codigo)}`;
    const rutaAgendar = rutaDeAgendar(franja.id, fecha, materia.codigo);

    // Un visitante sin sesión mira la lista antes y después.
    const visitante = await (await otroContexto({ sinSesion: true })).newPage();
    await visitante.goto(rutaLista);
    const fechas = tarjetaDe(visitante, monitor.nombre).getByRole("listitem");
    await expect(fechas).toHaveCount(4, ESPERA);
    await expect(fechas.first()).toContainText(formatearDiaConSemana(fecha));

    // Otra persona, ya Lead, aparta la primera.
    await entrarComoLead(page, escenario, rutaAgendar);
    await expect(botonApartar(page)).toBeVisible(ESPERA);
    await botonApartar(page).click();
    await expect(page).toHaveURL(RESERVA, ESPERA);

    await visitante.reload();
    await expect(fechas).toHaveCount(3, ESPERA);
    await expect(tarjetaDe(visitante, monitor.nombre)).not.toContainText(formatearDiaConSemana(fecha));
    await expect(visitante.locator(`a[href="${rutaAgendar}"]`)).toHaveCount(0);
    await expect(visitante.locator(`a[href="${rutaDeAgendar(franja.id, sumarDias(fecha, 7), materia.codigo)}"]`)).toHaveCount(1);

    // Y si abre el enlace de esa fecha, la página lo dice.
    await visitante.goto(rutaAgendar);
    await expect(titulo(visitante, NO_DISPONIBLE)).toBeVisible(ESPERA);
    await expect(botonApartar(visitante)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Criterio 4 (RN-33): dos personas, una misma fecha
// ---------------------------------------------------------------------------
test.describe("Criterio 4 (RN-33) · dos personas confirman la misma fecha", () => {
  test("solo la primera la aparta; la otra ve que ya no está disponible", async ({ page, escenario, otroContexto }) => {
    const fecha = sumarDias(hoy(), 3);
    const { materia, monitor, franja } = await montar(escenario, fecha);
    const rutaAgendar = rutaDeAgendar(franja.id, fecha, materia.codigo);

    // Las dos abren la misma fecha y ven el botón: ninguna sabe todavía de la otra.
    const paginaA = page;
    const paginaB = await (await otroContexto()).newPage();
    const a = await entrarComoLead(paginaA, escenario, rutaAgendar);
    const b = await entrarComoLead(paginaB, escenario, rutaAgendar);
    expect(a.sesion.id).not.toBe(b.sesion.id);
    await expect(botonApartar(paginaA)).toBeVisible(ESPERA);
    await expect(botonApartar(paginaB)).toBeVisible(ESPERA);

    await test.step("la primera confirma y llega a su reserva", async () => {
      await botonApartar(paginaA).click();
      await expect(paginaA).toHaveURL(RESERVA, ESPERA);
      await expect(titulo(paginaA, "Apartamos tu fecha")).toBeVisible(ESPERA);
    });

    await test.step("la segunda confirma después: se le dice que alguien acaba de apartarla y no se crea otra reserva", async () => {
      await botonApartar(paginaB).click();
      await expect(alerta(paginaB, "Alguien acaba de apartar esta fecha. Elige otra.")).toHaveText("Alguien acaba de apartar esta fecha. Elige otra.", ESPERA);
      await expect(paginaB).toHaveURL(rutaAgendar);

      const monitorias = await escenario.monitoriasDe(franja.id);
      expect(monitorias).toHaveLength(1);
      expect(monitorias[0]).toMatchObject({ id_lead: a.lead.id, fecha, estado: "pendiente_pago" });
    });

    await test.step("si recarga, la fecha ya no aparece y puede ver otras", async () => {
      await paginaB.reload();
      await expect(titulo(paginaB, NO_DISPONIBLE)).toBeVisible(ESPERA);
      const otras = paginaB.getByRole("link", { name: "Ver otras fechas" });
      await expect(otras).toHaveAttribute("href", `/monitores?materia=${encodeURIComponent(materia.codigo)}`);
      await otras.click();
      await expect(tarjetaDe(paginaB, monitor.nombre)).toBeVisible(ESPERA);
      await expect(tarjetaDe(paginaB, monitor.nombre)).not.toContainText(formatearDiaConSemana(fecha));
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 3 (RN-37, D-10): con menos de 12 horas se avisa y hay que aceptarlo
// ---------------------------------------------------------------------------
test.describe("Criterio 3 (RN-37, D-10) · con menos de 12 horas, el aviso y la casilla", () => {
  test("sin marcar la casilla no aparta; marcándola llega a la reserva, que dice que no se puede cancelar", async ({ page, escenario }) => {
    // Una franja que empieza dentro de 6 horas, en Bogotá (si cruza la medianoche, es la de mañana).
    const { fecha, hora } = dentroDe(6);
    const { materia, franja } = await montar(escenario, fecha, { hora });
    const rutaAgendar = rutaDeAgendar(franja.id, fecha, materia.codigo);

    await entrarComoLead(page, escenario, rutaAgendar);
    await expect(titulo(page, "Confirma tu monitoría")).toBeVisible(ESPERA);

    await test.step("la página avisa que no podrá cancelarla y pide marcar la casilla", async () => {
      await expect(page.getByText(AVISO_SIN_CANCELACION)).toBeVisible(ESPERA);
      const casilla = page.getByLabel(CASILLA_SIN_CANCELACION);
      await expect(casilla).toBeVisible();
      await expect(casilla).not.toBeChecked();
      await expect(casilla).toHaveAccessibleDescription(AVISO_SIN_CANCELACION);
    });

    await test.step("sin marcarla, Apartar esta fecha no aparta: lo dice y no se crea la monitoría", async () => {
      await botonApartar(page).click();
      await expect(alerta(page, "Faltan menos de 12 horas")).toHaveText(
        `Faltan menos de 12 horas para esta monitoría y no podrás cancelarla. Si quieres apartarla, marca "${CASILLA_SIN_CANCELACION}".`,
        ESPERA,
      );
      await expect(page).toHaveURL(rutaAgendar);
      await expect(page.getByLabel(CASILLA_SIN_CANCELACION)).not.toBeChecked();
      expect(await escenario.monitoriasDe(franja.id)).toEqual([]);
    });

    await test.step("marcándola, aparta y la reserva dice que no se puede cancelar", async () => {
      await page.getByLabel(CASILLA_SIN_CANCELACION).check();
      await botonApartar(page).click();
      await expect(page).toHaveURL(RESERVA, ESPERA);
      await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
      await expect(page.getByText("Faltan menos de 12 horas: esta monitoría no se puede cancelar.")).toBeVisible();
      await expect(dato(page, "Hora")).toHaveText(new RegExp(`^${hora} a `));

      const monitorias = await escenario.monitoriasDe(franja.id);
      expect(monitorias).toHaveLength(1);
      expect(monitorias[0]).toMatchObject({ fecha, estado: "pendiente_pago", valor_total: PRECIO });
    });
  });
});

// ---------------------------------------------------------------------------
// D-8: una sola reserva por pagar a la vez
// ---------------------------------------------------------------------------
test.describe("D-8 · un Lead con una reserva por pagar no aparta otra fecha", () => {
  test("al intentarlo ve que ya tiene una y un enlace a ella; no se crea otra monitoría", async ({ page, escenario }) => {
    const primera = sumarDias(hoy(), 2);
    const segunda = sumarDias(primera, 7);
    const { materia, franja } = await montar(escenario, primera);

    const { lead } = await entrarComoLead(page, escenario, rutaDeAgendar(franja.id, primera, materia.codigo));
    await expect(botonApartar(page)).toBeVisible(ESPERA);
    await botonApartar(page).click();
    await expect(page).toHaveURL(RESERVA, ESPERA);
    const rutaDeLaReserva = new URL(page.url()).pathname;

    await abrir(page, rutaDeAgendar(franja.id, segunda, materia.codigo));
    await expect(titulo(page, "Confirma tu monitoría")).toBeVisible(ESPERA);
    await botonApartar(page).click();

    await expect(alerta(page, "Ya tienes una reserva por pagar")).toHaveText(
      "Ya tienes una reserva por pagar. Termínala o espera a que venza para apartar otra fecha.",
      ESPERA,
    );
    const enlace = page.getByRole("link", { name: "Ver la reserva que tengo por pagar" });
    await expect(enlace).toHaveAttribute("href", rutaDeLaReserva);
    const monitorias = await escenario.monitoriasDe(franja.id);
    expect(monitorias.map((m) => ({ fecha: m.fecha, id_lead: m.id_lead }))).toEqual([{ fecha: primera, id_lead: lead.id }]);

    await enlace.click();
    await expect(page).toHaveURL(rutaDeLaReserva, ESPERA);
    await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
    await expect(dato(page, "Fecha")).toHaveText(formatearDiaConSemana(primera));
  });
});

// ---------------------------------------------------------------------------
// La reserva es privada, y lo que no se puede confirmar se dice
// ---------------------------------------------------------------------------
test.describe("Reserva privada · solo la ve quien la apartó", () => {
  test("otra sesión, quien no tiene sesión y un id que no existe reciben la página 404 de Next", async ({ page, escenario, otroContexto }) => {
    const fecha = sumarDias(hoy(), 2);
    const { materia, monitor, franja } = await montar(escenario, fecha);

    // La dueña, ya Lead, con una reserva por pagar.
    const { lead } = await entrarComoLead(page, escenario, "/monitores");
    const idReserva = await escenario.apartar(franja, monitor.id, materia.id, fecha, lead.id);
    const rutaDeLaReserva = `/agendar/reserva/${idReserva}`;
    await page.goto(rutaDeLaReserva);
    await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
    await expect(dato(page, "Materia")).toHaveText(materia.nombre);

    const sinPagina = async (otra: Page, ruta: string, donde: string) => {
      const respuesta = await otra.goto(ruta);
      expect(respuesta?.status(), `${donde}: debía responder 404`).toBe(404);
      await expect(otra.getByText("This page could not be found.")).toBeVisible(ESPERA);
      await expect(otra.getByRole("heading", { name: "Apartamos tu fecha" })).toHaveCount(0);
      const html = await otra.content();
      for (const privado of [materia.nombre, monitor.nombre, "Apartamos tu fecha"]) {
        expect(html, `${donde}: sin datos de la reserva`).not.toContain(privado);
      }
    };

    await test.step("otra sesión, aunque también sea Lead", async () => {
      const otra = await (await otroContexto()).newPage();
      await entrarComoLead(otra, escenario, "/monitores");
      await sinPagina(otra, rutaDeLaReserva, "otra sesión");
    });

    await test.step("alguien sin sesión", async () => {
      const anonima = await (await otroContexto({ sinSesion: true })).newPage();
      await sinPagina(anonima, rutaDeLaReserva, "sin sesión");
    });

    await test.step("un id que no tiene forma de id, o que no existe, ni siquiera para su dueña", async () => {
      await sinPagina(page, "/agendar/reserva/no-es-un-id", "id sin forma");
      await sinPagina(page, `/agendar/reserva/${randomUUID()}`, "id que no existe");
    });

    // Sigue siendo suya.
    await page.goto(rutaDeLaReserva);
    await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
  });
});

test.describe("Fechas que no se pueden confirmar", () => {
  test("sin sesión: un enlace con datos inválidos dice que no se encontró la fecha; una ocupada, muy próxima, lejana o inexistente, que ya no está disponible (RN-33, RN-35, D-9)", async ({
    page,
    escenario,
  }) => {
    await sinSesionAnonima(page);
    const fecha = sumarDias(hoy(), 2);
    const { materia, monitor, franja } = await montar(escenario, fecha);
    // RN-35: una segunda franja que empieza dentro de 1 hora (mañana, si cruza la medianoche): faltan menos de 3 h.
    const proxima = dentroDe(1);
    const franjaProxima = await escenario.franja(monitor.id, proxima.fecha, { hora: proxima.hora });
    const ocupante = await escenario.crearLead();
    await escenario.apartar(franja, monitor.id, materia.id, fecha, ocupante.id);

    await test.step("sin fecha, o con una franja, un día o una materia que no tienen forma", async () => {
      const invalidos = [
        "/agendar",
        `/agendar?${new URLSearchParams({ franja: "no-es-un-id", fecha, materia: materia.codigo })}`,
        `/agendar?${new URLSearchParams({ franja: franja.id, fecha: "2026-02-30", materia: materia.codigo })}`,
        `/agendar?${new URLSearchParams({ franja: franja.id, fecha })}`,
        `/agendar?${new URLSearchParams({ franja: franja.id, fecha, materia: "X".repeat(60) })}`,
      ];
      for (const ruta of invalidos) {
        await page.goto(ruta);
        await expect(titulo(page, "No encontramos esa fecha"), ruta).toBeVisible(ESPERA);
        await expect(page.getByText("Elige una fecha en la lista de monitores certificados.")).toBeVisible();
        await expect(page.getByRole("link", { name: "Ver monitores certificados" })).toHaveAttribute("href", "/monitores");
        await expect(botonApartar(page)).toHaveCount(0);
      }
    });

    await test.step("una fecha que ya apartó otra persona", async () => {
      await page.goto(rutaDeAgendar(franja.id, fecha, materia.codigo));
      await expect(titulo(page, NO_DISPONIBLE)).toBeVisible(ESPERA);
      await expect(page.getByRole("status").filter({ hasText: "Alguien la apartó" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Ver otras fechas" })).toHaveAttribute("href", `/monitores?materia=${encodeURIComponent(materia.codigo)}`);
      await expect(botonApartar(page)).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Dejar mis datos y seguir" })).toHaveCount(0);
    });

    await test.step("una fecha con menos de 3 horas de antelación: no está en la lista ni se puede confirmar (RN-35)", async () => {
      await page.goto(rutaDeAgendar(franjaProxima.id, proxima.fecha, materia.codigo));
      await expect(titulo(page, NO_DISPONIBLE)).toBeVisible(ESPERA);
      await expect(botonApartar(page)).toHaveCount(0);

      await page.goto(`/monitores?materia=${encodeURIComponent(materia.codigo)}`);
      await expect(tarjetaDe(page, monitor.nombre)).toBeVisible(ESPERA);
      await expect(page.locator(`a[href="${rutaDeAgendar(franjaProxima.id, proxima.fecha, materia.codigo)}"]`)).toHaveCount(0);
      // La semana siguiente de la misma franja sí está libre.
      await expect(page.locator(`a[href="${rutaDeAgendar(franjaProxima.id, sumarDias(proxima.fecha, 7), materia.codigo)}"]`)).toHaveCount(1);
    });

    await test.step("una fecha fuera de las 4 semanas de la lista (D-9)", async () => {
      await page.goto(rutaDeAgendar(franja.id, sumarDias(fecha, 28), materia.codigo));
      await expect(titulo(page, NO_DISPONIBLE)).toBeVisible(ESPERA);
    });

    await test.step("una franja que no existe, o una materia que no existe", async () => {
      await page.goto(rutaDeAgendar(randomUUID(), fecha, materia.codigo));
      await expect(titulo(page, NO_DISPONIBLE)).toBeVisible(ESPERA);
      await page.goto(rutaDeAgendar(franja.id, sumarDias(fecha, 7), "NO-EXISTE-E2E"));
      await expect(titulo(page, NO_DISPONIBLE)).toBeVisible(ESPERA);
    });
  });
});

// ---------------------------------------------------------------------------
// Accesibilidad del producto
// ---------------------------------------------------------------------------
test.describe("Accesibilidad", () => {
  test("confirmar con el aviso y la casilla, el mensaje de error y la reserva respetan las reglas de accesibilidad del producto", async ({
    page,
    escenario,
  }) => {
    const { fecha, hora } = dentroDe(6);
    const { materia, franja } = await montar(escenario, fecha, { hora });

    await entrarComoLead(page, escenario, rutaDeAgendar(franja.id, fecha, materia.codigo));
    await expect(page.getByText(AVISO_SIN_CANCELACION)).toBeVisible(ESPERA);
    await expect(page.getByLabel(CASILLA_SIN_CANCELACION)).toBeVisible();
    await expectReglasDelProducto(page, "confirmar con el aviso y la casilla");

    await botonApartar(page).click();
    await expect(alerta(page, "Faltan menos de 12 horas")).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "confirmar con el mensaje de error");

    await page.getByLabel(CASILLA_SIN_CANCELACION).check();
    await botonApartar(page).click();
    await expect(page).toHaveURL(RESERVA, ESPERA);
    await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
    await expect(page.getByText("Faltan menos de 12 horas: esta monitoría no se puede cancelar.")).toBeVisible();
    await expectReglasDelProducto(page, "la reserva apartada");
  });

  test("las páginas de confirmar para quien no es Lead, sin fecha y con una fecha que ya no está disponible las respetan", async ({ page, escenario }) => {
    await sinSesionAnonima(page);
    const fecha = sumarDias(hoy(), 2);
    const { materia, franja } = await montar(escenario, fecha);

    await page.goto(rutaDeAgendar(franja.id, fecha, materia.codigo));
    await expect(page.getByRole("link", { name: "Dejar mis datos y seguir" })).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "confirmar como visitante que no es Lead");

    await page.goto("/agendar");
    await expect(titulo(page, "No encontramos esa fecha")).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "la página sin fecha");

    await page.goto(rutaDeAgendar(franja.id, sumarDias(fecha, 28), materia.codigo));
    await expect(titulo(page, NO_DISPONIBLE)).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "la página de una fecha que ya no está disponible");
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta
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
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden])")].filter(visible);
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
