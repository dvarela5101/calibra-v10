import { randomInt, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { diaDelNegocio, formatearDiaConSemana, formatearFechaHora } from "../src/lib/fechas";
import { horaDeFin } from "../src/lib/franjas/reglas";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-023: el monitor marca como realizada una monitoría confirmada que ya empezó (D-13), la agenda y el panel se lo
// recuerdan (D-15) y la base no deja finalizar lo que aún no empieza ni lo que es de otro monitor. Corre contra el
// Supabase local (Auth y base) con cuentas, materias, Leads, monitorías y pagos que crea y borra cada prueba (códigos,
// nombres y correos únicos: las pruebas corren en paralelo y solo se afirma sobre lo propio). Las fechas salen de la
// zona del negocio (America/Bogota), nunca de la de la máquina.
//
// Cada entrada por /ingresar gasta cupo de Auth: cada prueba entra una vez y recorre sus pasos con `test.step`.
//
// Las confirmadas "que ya empezaron" empezaron hace 90 minutos (la fecha y la hora, del mismo instante en Bogotá; la
// duración se recorta para no pasar de la medianoche). No son "de ayer" a propósito: pg_cron corre cada 15 minutos
// `calibra-cerrar-monitorias`, que pasa a realizada toda individual confirmada cuyo fin programado + 24 h ya pasó
// (D-14), también en la base local y en la de CI. Una confirmada de ayer o de días atrás podría cerrarse sola en
// medio de la prueba y volverla intermitente; con inicio hace 90 minutos su cierre automático queda a más de 21 horas
// a cualquier hora del día y el proceso no la toca. Lo mismo vale para cualquier otra confirmada pasada que se cree.

const ESPERA = { timeout: 20_000 };
const MINUTO_MS = 60_000;

/** Cuánto hace que empezó la sesión que ya se puede finalizar, y lo que dura (si no cruza la medianoche). */
const HACE_MIN = 90;
const DURACION_MAXIMA_MIN = 30;
/** D-14: una individual sin finalizar se cierra sola 24 h después de su fin programado (`cierre_automatico_min`). */
const CIERRE_AUTOMATICO_MIN = 1440;

const MENSAJE_NO_EMPEZO = "Esa monitoría todavía no empieza: podrás finalizarla desde su hora de inicio.";
const MENSAJE_NO_ENCONTRADA = "No encontramos esa monitoría en tu agenda.";
const MENSAJE_FINALIZADA = "Marcaste la monitoría como realizada.";

// ---------------------------------------------------------------------------
// Fechas (America/Bogota)
// ---------------------------------------------------------------------------
const hoy = () => diaDelNegocio(new Date());

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Día ISO (1 = lunes ... 7 = domingo) de un día de calendario, como `franja.dia`. */
function diaIso(fecha: string): number {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** La fecha de `semanas` semanas desde hoy: siempre futura si `semanas` es positiva. */
const enSemanas = (semanas: number) => sumarDias(hoy(), 7 * semanas);

/** Una sesión de Bogotá: su fecha, su hora (`HH:MM`), cuánto dura y desde cuándo se cierra sola (D-14). */
type Sesion = { fecha: string; hora: string; duracionMin: number; cierre: Date };

/**
 * La sesión que empezó hace 90 minutos, calculada una vez por prueba. Bogotá es UTC-5 todo el año (sin horario de
 * verano), así que correr el reloj 5 horas da la fecha y la hora de pared sin depender de la zona de la máquina.
 */
function sesionQueYaEmpezo(): Sesion {
  const inicioMs = Math.floor((Date.now() - HACE_MIN * MINUTO_MS) / MINUTO_MS) * MINUTO_MS;
  const pared = new Date(inicioMs - 5 * 60 * MINUTO_MS).toISOString();
  const minutosDelDia = Number(pared.slice(11, 13)) * 60 + Number(pared.slice(14, 16));
  // La franja termina el mismo día (la regla de la base para franjas): si falta poco para la medianoche, se acorta.
  const duracionMin = Math.min(DURACION_MAXIMA_MIN, 24 * 60 - minutosDelDia);
  return {
    fecha: pared.slice(0, 10),
    hora: pared.slice(11, 16),
    duracionMin,
    cierre: new Date(inicioMs + (duracionMin + CIERRE_AUTOMATICO_MIN) * MINUTO_MS),
  };
}

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Materia = { id: string; nombre: string; codigo: string };
type Franja = { id: string };
type Lead = { id: string; nombre: string; correo: string; telefono: string };
type EstadoEnBase = { estado: string; fecha_finalizacion: string | null };

type Escenario = {
  materia(): Promise<Materia>;
  /** Un monitor con certificado en esa materia. */
  monitorCertificado(materia: Materia): Promise<Cuenta>;
  /** Franja semanal que cae el mismo día de la semana que `fecha`. */
  franja(monitor: Cuenta, fecha: string, datos: { hora: string; duracionMin: number; presencial: boolean }): Promise<Franja>;
  /** Un Lead con correo y teléfono propios; el nombre lleva un sufijo único. */
  lead(nombre: string): Promise<Lead>;
  /** Una monitoría confirmada, con su pago aprobado, creada con la llave secreta. Devuelve su id. */
  confirmada(monitor: Cuenta, materia: Materia, franja: Franja, lead: Lead, fecha: string): Promise<string>;
  /** Lo que dice la base de esa monitoría, leída con la llave secreta. */
  enBase(idMonitoria: string): Promise<EstadoEnBase>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const monitores: string[] = [];
    const materias: string[] = [];
    const leads: string[] = [];
    const pagos: string[] = [];
    const comprobantes: string[] = [];
    let idAdmin: string | undefined;

    async function insertar(tabla: string, fila: Record<string, unknown>) {
      const { data, error } = await cliente.from(tabla).insert(fila).select().single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data as { id: string };
    }

    await entregar({
      async materia() {
        const nombre = `Materia e2e finalizar ${randomUUID().slice(0, 6)}`;
        const codigo = `E2E-${randomUUID().slice(0, 12)}`;
        const materia = await insertar("materia", { nombre, codigo });
        materias.push(materia.id);
        return { id: materia.id, nombre, codigo };
      },
      async monitorCertificado(materia) {
        idAdmin ??= (await cuentas.crearAdmin()).id;
        const monitor = await cuentas.crearMonitor();
        monitores.push(monitor.id);
        await insertar("certificado", { id_monitor: monitor.id, id_materia: materia.id, id_admin: idAdmin });
        return monitor;
      },
      async franja(monitor, fecha, datos) {
        const franja = await insertar("franja", {
          id_monitor: monitor.id,
          dia: diaIso(fecha),
          hora: datos.hora,
          duracion_min: datos.duracionMin,
          presencial: datos.presencial,
          precio: 25_000,
          lugar: datos.presencial ? "Edificio ML, salón 101" : null,
          enlace: datos.presencial ? null : "https://meet.example.com/e2e-finalizar",
        });
        return { id: franja.id };
      },
      async lead(nombre) {
        const lead = {
          nombre: `${nombre} e2e ${randomUUID().replaceAll("-", "").slice(0, 8)}`,
          correo: `lead-${randomUUID()}@calibra.test`,
          telefono: `310${randomInt(1_000_000, 9_999_999)}`,
        };
        const fila = await insertar("lead", {
          nombre: lead.nombre,
          correo: lead.correo,
          numero_telefono: lead.telefono,
          acepta_tratamiento_datos: true,
          fecha_consentimiento: new Date().toISOString(),
        });
        leads.push(fila.id);
        return { id: fila.id, ...lead };
      },
      async confirmada(monitor, materia, franja, lead, fecha) {
        idAdmin ??= (await cuentas.crearAdmin()).id;
        const monitoria = await insertar("monitoria", {
          id_franja: franja.id,
          id_monitor: monitor.id,
          id_materia: materia.id,
          id_lead: lead.id,
          fecha,
          valor_total: 1_357_911,
          estado: "confirmada",
        });
        // Una confirmada tiene su pago aprobado. pago.comprobante es una llave foránea a los comprobantes que el
        // servidor ya revisó (HU-059).
        const comprobante = `${randomUUID()}/${randomUUID()}.png`;
        const { error } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
        if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
        comprobantes.push(comprobante);
        const pago = await insertar("pago", {
          id_monitoria: monitoria.id,
          monto: 2_468_024,
          nombre_pagador: `Pagador e2e ${randomUUID().slice(0, 8)}`,
          contacto: `pagador-${randomUUID()}@calibra.test`,
          id_admin: idAdmin,
          comprobante,
          estado: "aprobado",
          fecha_revision: new Date().toISOString(),
        });
        pagos.push(pago.id);
        return monitoria.id;
      },
      async enBase(idMonitoria) {
        const { data, error } = await cliente.from("monitoria").select("estado, fecha_finalizacion").eq("id", idMonitoria).single();
        if (error) throw new Error(`leer la monitoría ${idMonitoria}: ${error.message}`);
        return data as EstadoEnBase;
      },
    });

    // Limpieza, antes de que la fixture `cuentas` borre a los monitores y al admin: de las filas dependientes
    // hacia las cuentas. Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (pagos.length) await borrar("pagos", cliente.from("pago").delete().in("id", pagos));
    if (comprobantes.length) await borrar("comprobantes revisados", cliente.from("comprobante_revisado").delete().in("ruta", comprobantes));
    if (monitores.length) {
      await borrar("monitorías", cliente.from("monitoria").delete().in("id_monitor", monitores));
      await borrar("franjas", cliente.from("franja").delete().in("id_monitor", monitores));
      await borrar("certificados", cliente.from("certificado").delete().in("id_monitor", monitores));
    }
    if (leads.length) await borrar("leads", cliente.from("lead").delete().in("id", leads));
    if (materias.length) await borrar("materias", cliente.from("materia").delete().in("id", materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 90_000 });

/** Lo que tienen en común las pruebas: un monitor con una confirmada que ya empezó y una confirmada de la próxima semana. */
async function monitorConEmpezadaYFutura(escenario: Escenario, nombreDeLaEmpezada = "Camila") {
  const sesion = sesionQueYaEmpezo();
  const materia = await escenario.materia();
  const monitor = await escenario.monitorCertificado(materia);
  const franjaEmpezada = await escenario.franja(monitor, sesion.fecha, { hora: sesion.hora, duracionMin: sesion.duracionMin, presencial: true });
  const franjaFutura = await escenario.franja(monitor, enSemanas(1), { hora: "14:30", duracionMin: 90, presencial: false });
  const [leadEmpezada, leadFutura] = await Promise.all([escenario.lead(nombreDeLaEmpezada), escenario.lead("Daniela")]);
  const idEmpezada = await escenario.confirmada(monitor, materia, franjaEmpezada, leadEmpezada, sesion.fecha);
  const idFutura = await escenario.confirmada(monitor, materia, franjaFutura, leadFutura, enSemanas(1));
  return { sesion, materia, monitor, leadEmpezada, leadFutura, idEmpezada, idFutura };
}

// ---------------------------------------------------------------------------
// Ayudas de página
// ---------------------------------------------------------------------------
const RUTA = "/monitor/agenda";

/** Entra por /ingresar a la ruta pedida: sin sesión, la página protegida manda a iniciar sesión. */
async function entrar(page: Page, ruta: string, cuenta: Cuenta): Promise<void> {
  await page.goto(ruta);
  await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
  await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
  await expect(page).toHaveURL(ruta, ESPERA);
}

const titulo = (page: Page) => page.getByRole("heading", { level: 1, name: "Mi agenda" });
const seccion = (page: Page, nombre: string) => page.getByRole("region", { name: nombre });
const subtitulo = (page: Page, nombre: string | RegExp) => page.getByRole("heading", { level: 2, name: nombre });
const botonDeFinalizar = (zona: Page | Locator) => zona.getByRole("button", { name: "Marcar como realizada" });
/** El aviso de la agenda: `status` si salió bien, `alert` si no. (En desarrollo Next suma su propio `alert` vacío.) */
const aviso = (page: Page, rol: "status" | "alert", texto: string) => page.getByRole(rol).filter({ hasText: texto });

/**
 * La tarjeta de la monitoría de ese Lead (el nombre lleva un sufijo único) y sus renglones, en orden: día y hora,
 * materia · duración · modalidad, quién agendó, estado · pago y, en "Por finalizar", cuándo se cierra sola.
 */
async function expectTarjeta(zona: Locator, lead: Lead, renglones: string[]): Promise<Locator> {
  const tarjeta = zona.getByRole("listitem").filter({ hasText: lead.nombre });
  await expect(tarjeta).toHaveCount(1);
  await expect(tarjeta.locator(":scope > span")).toHaveText(renglones);
  return tarjeta;
}

/** Los cinco renglones de la tarjeta de la que ya empezó, en "Por finalizar". */
function renglonesDeLaEmpezada(materia: Materia, sesion: Sesion, lead: Lead): string[] {
  return [
    `${formatearDiaConSemana(sesion.fecha)}, ${sesion.hora} a ${horaDeFin(sesion.hora, sesion.duracionMin)}`,
    `${materia.nombre} · ${sesion.duracionMin} min · Presencial`,
    `Agendó: ${lead.nombre}`,
    "Confirmada · Pago aprobado",
    `Si no la finalizas, se cierra sola a partir del ${formatearFechaHora(sesion.cierre)}.`,
  ];
}

/** Los renglones de la confirmada de la próxima semana: la que ya empezó lleva uno más. */
function renglonesDeLaFutura(materia: Materia, lead: Lead): string[] {
  return [
    `${formatearDiaConSemana(enSemanas(1))}, 14:30 a 16:00`,
    `${materia.nombre} · 90 min · Virtual`,
    `Agendó: ${lead.nombre}`,
    "Confirmada · Pago aprobado",
  ];
}

/**
 * Cambia a mano el id que lleva el formulario de finalizar (lo que haría quien arma la petición) y lo envía con el
 * botón de la tarjeta. Hay un solo formulario en la página.
 */
async function enviarConId(page: Page, id: string): Promise<void> {
  const campo = page.locator('input[name="monitoria"]');
  await expect(campo).toHaveCount(1);
  await campo.evaluate((el, valor) => {
    (el as HTMLInputElement).value = valor;
  }, id);
  await botonDeFinalizar(page).click();
}

/** El texto que se ve, con los espacios duros como espacios normales. */
const textoVisible = async (page: Page) => (await page.locator("body").innerText()).replace(/\s/g, " ");

// ---------------------------------------------------------------------------
// Criterio 1 y D-15 · finalizar una monitoría que ya empezó
// ---------------------------------------------------------------------------
test.describe("Criterio 1 y D-15 · el monitor finaliza una confirmada cuyo inicio ya pasó", () => {
  test("con una confirmada que ya empezó y una futura, el panel le recuerda finalizar; en Por finalizar toca Marcar como realizada y la monitoría pasa a Realizada con su fecha de finalización", async ({
    page,
    escenario,
  }) => {
    const { sesion, materia, monitor, leadEmpezada, leadFutura, idEmpezada, idFutura } = await monitorConEmpezadaYFutura(escenario);

    await test.step("D-15: el panel dice Tienes 1 monitoría por finalizar y lleva a Mi agenda", async () => {
      await entrar(page, "/monitor", monitor);
      await expect(page.getByRole("heading", { level: 1, name: `Hola, ${monitor.nombre}` })).toBeVisible(ESPERA);
      // Solo cuenta la que ya empezó: la de la próxima semana no hace parte del recordatorio.
      await expect(page.getByRole("status")).toHaveText("Tienes 1 monitoría por finalizar. Márcala como realizada en tu agenda; si no, se cierra sola.");
      await page.getByRole("link", { name: "Mi agenda" }).click();
      await expect(page).toHaveURL(RUTA, ESPERA);
      await expect(titulo(page)).toBeVisible(ESPERA);
    });

    const porFinalizar = seccion(page, "Por finalizar (1)");
    const proximas = seccion(page, "Próximas (1)");

    await test.step("Mi agenda: Por finalizar (1) con la tarjeta de la que ya empezó, cuándo se cierra sola y el botón; la futura, en Próximas, sin botón", async () => {
      await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible();
      await expect(page.getByText("Márcalas como realizadas cuando termines la sesión. Si no, se cierran solas.")).toBeVisible();
      await expect(porFinalizar.getByRole("listitem")).toHaveCount(1);
      const tarjeta = await expectTarjeta(porFinalizar, leadEmpezada, renglonesDeLaEmpezada(materia, sesion, leadEmpezada));
      await expect(tarjeta.locator("time")).toHaveAttribute("datetime", sesion.fecha);
      await expect(tarjeta).toContainText("Si no la finalizas, se cierra sola a partir del");
      await expect(botonDeFinalizar(tarjeta)).toBeVisible();
      await expect(botonDeFinalizar(page)).toHaveCount(1);

      await expect(subtitulo(page, "Próximas (1)")).toBeVisible();
      await expect(proximas.getByRole("listitem")).toHaveCount(1);
      await expectTarjeta(proximas, leadFutura, renglonesDeLaFutura(materia, leadFutura));
      await expect(proximas.getByRole("button")).toHaveCount(0);
      await expect(proximas.getByText("Si no la finalizas")).toHaveCount(0);
      await expect(subtitulo(page, "Pasadas (0)")).toBeVisible();
      await expect(page.getByText("Todavía no tienes monitorías pasadas.")).toBeVisible();
      // Antes de tocar nada: la que ya empezó sigue confirmada y sin fecha de finalización.
      expect(await escenario.enBase(idEmpezada)).toEqual({ estado: "confirmada", fecha_finalizacion: null });
    });

    let antes = 0;
    await test.step("toca Marcar como realizada: vuelve a la agenda con Marcaste la monitoría como realizada", async () => {
      antes = Date.now();
      await botonDeFinalizar(porFinalizar).click();
      await expect(page).toHaveURL(`${RUTA}?finalizada=1`, ESPERA);
      await expect(aviso(page, "status", MENSAJE_FINALIZADA)).toBeVisible(ESPERA);
      await expect(aviso(page, "status", MENSAJE_FINALIZADA)).toHaveCount(1);
      await expect(aviso(page, "alert", MENSAJE_NO_EMPEZO)).toHaveCount(0);
      await expect(aviso(page, "alert", MENSAJE_NO_ENCONTRADA)).toHaveCount(0);
    });

    await test.step("la sección Por finalizar ya no está y la monitoría aparece en Pasadas como Realizada; la futura sigue en Próximas", async () => {
      await expect(subtitulo(page, /Por finalizar/)).toHaveCount(0);
      await expect(page.getByRole("region", { name: /Por finalizar/ })).toHaveCount(0);
      await expect(page.getByText("Si no la finalizas")).toHaveCount(0);
      await expect(botonDeFinalizar(page)).toHaveCount(0);

      await expect(subtitulo(page, "Pasadas (1)")).toBeVisible();
      const realizadas = seccion(page, "Pasadas (1)");
      const tarjeta = await expectTarjeta(realizadas, leadEmpezada, [
        `${formatearDiaConSemana(sesion.fecha)}, ${sesion.hora} a ${horaDeFin(sesion.hora, sesion.duracionMin)}`,
        `${materia.nombre} · ${sesion.duracionMin} min · Presencial`,
        `Agendó: ${leadEmpezada.nombre}`,
        "Realizada · Pago aprobado",
      ]);
      await expect(tarjeta.locator("time")).toHaveAttribute("datetime", sesion.fecha);
      await expect(subtitulo(page, "Próximas (1)")).toBeVisible();
      await expectTarjeta(seccion(page, "Próximas (1)"), leadFutura, renglonesDeLaFutura(materia, leadFutura));
    });

    await test.step("en la base la monitoría quedó realizada con su fecha de finalización (la de ahora); la futura sigue confirmada", async () => {
      const finalizada = await escenario.enBase(idEmpezada);
      expect(finalizada.estado).toBe("realizada");
      expect(finalizada.fecha_finalizacion, "fecha_finalizacion guardada").not.toBeNull();
      const momento = new Date(finalizada.fecha_finalizacion!).getTime();
      expect(momento, "finalizada después de tocar el botón").toBeGreaterThanOrEqual(antes - MINUTO_MS);
      expect(momento, "finalizada antes de que termine el paso").toBeLessThanOrEqual(Date.now() + MINUTO_MS);
      expect(await escenario.enBase(idFutura)).toEqual({ estado: "confirmada", fecha_finalizacion: null });
    });

    await test.step("D-15: de vuelta en el panel ya no hay recordatorio", async () => {
      await page.getByRole("link", { name: "Volver a mi panel" }).click();
      await expect(page).toHaveURL("/monitor", ESPERA);
      await expect(page.getByRole("heading", { level: 1, name: `Hola, ${monitor.nombre}` })).toBeVisible(ESPERA);
      await expect(page.getByRole("link", { name: "Mi agenda" })).toBeVisible();
      await expect(page.getByText(/por finalizar/i)).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 2 · una monitoría que aún no empieza no se finaliza (D-13)
// ---------------------------------------------------------------------------
test.describe("Criterio 2 · una monitoría que aún no empieza no se puede finalizar (D-13)", () => {
  test("no hay botón para la futura, una URL armada a mano no la finaliza y si se fuerza el envío con su id la agenda dice que todavía no empieza y sigue confirmada", async ({
    page,
    escenario,
  }) => {
    const { sesion, materia, monitor, leadEmpezada, leadFutura, idEmpezada, idFutura } = await monitorConEmpezadaYFutura(escenario);
    const porFinalizar = seccion(page, "Por finalizar (1)");
    const proximas = seccion(page, "Próximas (1)");

    await test.step("el monitor entra: solo la tarjeta de la que ya empezó tiene botón; su formulario no lleva el id de la futura", async () => {
      await entrar(page, RUTA, monitor);
      await expect(titulo(page)).toBeVisible(ESPERA);
      await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible();
      await expect(botonDeFinalizar(page)).toHaveCount(1);
      await expect(botonDeFinalizar(porFinalizar)).toHaveCount(1);
      await expectTarjeta(proximas, leadFutura, renglonesDeLaFutura(materia, leadFutura));
      await expect(proximas.getByRole("button")).toHaveCount(0);
      await expect(proximas.locator("form, input")).toHaveCount(0);
      // El único campo del formulario lleva el id de la que ya empezó: el de la futura no está en la página.
      await expect(page.locator('input[name="monitoria"]')).toHaveCount(1);
      await expect(page.locator('input[name="monitoria"]')).toHaveValue(idEmpezada);
      await expect(page.locator(`[value="${idFutura}"]`)).toHaveCount(0);
    });

    await test.step("una URL armada a mano no finaliza nada: la agenda es de solo lectura por GET", async () => {
      for (const consulta of [`monitoria=${idFutura}`, `finalizar=${idFutura}`, `id=${idFutura}&estado=realizada`]) {
        await page.goto(`${RUTA}?${consulta}`);
        await expect(titulo(page)).toBeVisible(ESPERA);
        await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible();
        await expect(page.getByRole("status")).toHaveCount(0);
        await expect(aviso(page, "alert", MENSAJE_NO_EMPEZO)).toHaveCount(0);
        await expect(aviso(page, "alert", MENSAJE_NO_ENCONTRADA)).toHaveCount(0);
        await expect(botonDeFinalizar(page)).toHaveCount(1);
        await expect(proximas.getByRole("listitem")).toContainText(leadFutura.nombre);
      }
      expect(await escenario.enBase(idFutura)).toEqual({ estado: "confirmada", fecha_finalizacion: null });
      expect(await escenario.enBase(idEmpezada)).toEqual({ estado: "confirmada", fecha_finalizacion: null });
    });

    await test.step("se fuerza el envío del formulario con el id de la futura: Esa monitoría todavía no empieza", async () => {
      await page.goto(RUTA);
      await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible(ESPERA);
      await enviarConId(page, idFutura);
      await expect(page).toHaveURL(`${RUTA}?no_finalizada=no_empezo`, ESPERA);
      await expect(aviso(page, "alert", MENSAJE_NO_EMPEZO)).toBeVisible(ESPERA);
      await expect(aviso(page, "alert", MENSAJE_NO_EMPEZO)).toHaveCount(1);
      await expect(page.getByRole("status")).toHaveCount(0);
    });

    await test.step("nada cambió: la futura sigue confirmada en Próximas, sin botón, y la que ya empezó sigue en Por finalizar", async () => {
      expect(await escenario.enBase(idFutura)).toEqual({ estado: "confirmada", fecha_finalizacion: null });
      expect(await escenario.enBase(idEmpezada)).toEqual({ estado: "confirmada", fecha_finalizacion: null });
      await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible();
      await expectTarjeta(porFinalizar, leadEmpezada, renglonesDeLaEmpezada(materia, sesion, leadEmpezada));
      await expectTarjeta(proximas, leadFutura, renglonesDeLaFutura(materia, leadFutura));
      await expect(proximas.getByRole("button")).toHaveCount(0);
      await expect(subtitulo(page, "Pasadas (0)")).toBeVisible();
    });

    await test.step("D-13: con el aviso a la vista, tocar el botón de la que ya empezó sí la finaliza (el rechazo no deja la agenda trabada)", async () => {
      await botonDeFinalizar(porFinalizar).click();
      await expect(page).toHaveURL(`${RUTA}?finalizada=1`, ESPERA);
      await expect(aviso(page, "status", MENSAJE_FINALIZADA)).toBeVisible(ESPERA);
      await expect(aviso(page, "alert", MENSAJE_NO_EMPEZO)).toHaveCount(0);
      expect((await escenario.enBase(idEmpezada)).estado).toBe("realizada");
      expect(await escenario.enBase(idFutura)).toEqual({ estado: "confirmada", fecha_finalizacion: null });
    });
  });
});

// ---------------------------------------------------------------------------
// Monitoría ajena · la monitoría de otro monitor no se finaliza
// ---------------------------------------------------------------------------
test.describe("Monitoría ajena · un monitor no puede finalizar la monitoría de otro", () => {
  test("otro monitor que fuerza el envío con el id de una monitoría ajena (o inexistente) ve No encontramos esa monitoría en tu agenda y nada cambia", async ({
    page,
    escenario,
  }) => {
    const materia = await escenario.materia();
    const duena = await escenario.monitorCertificado(materia);
    const otro = await escenario.monitorCertificado(materia);
    const sesion = sesionQueYaEmpezo();
    const franjaDeLaDuena = await escenario.franja(duena, sesion.fecha, { hora: sesion.hora, duracionMin: sesion.duracionMin, presencial: true });
    const franjaDelOtro = await escenario.franja(otro, sesion.fecha, { hora: sesion.hora, duracionMin: sesion.duracionMin, presencial: true });
    const [leadDeLaDuena, leadDelOtro] = await Promise.all([escenario.lead("Estudiante ajena"), escenario.lead("Estudiante propia")]);
    // La ajena ya empezó (hace 90 minutos, sin riesgo de que el cierre automático la toque): si fuera suya se podría finalizar. Así el rechazo es por de quién es y no por la hora.
    const idAjena = await escenario.confirmada(duena, materia, franjaDeLaDuena, leadDeLaDuena, sesion.fecha);
    const idPropia = await escenario.confirmada(otro, materia, franjaDelOtro, leadDelOtro, sesion.fecha);

    const sinCambios = async (donde: string) => {
      expect(await escenario.enBase(idAjena), `${donde}: la ajena sigue confirmada`).toEqual({ estado: "confirmada", fecha_finalizacion: null });
      expect(await escenario.enBase(idPropia), `${donde}: la propia sigue confirmada`).toEqual({ estado: "confirmada", fecha_finalizacion: null });
    };

    await test.step("el otro monitor entra y en Por finalizar solo ve la suya", async () => {
      await entrar(page, RUTA, otro);
      await expect(titulo(page)).toBeVisible(ESPERA);
      await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible();
      await expectTarjeta(seccion(page, "Por finalizar (1)"), leadDelOtro, renglonesDeLaEmpezada(materia, sesion, leadDelOtro));
      await expect(page.getByText(leadDeLaDuena.nombre)).toHaveCount(0);
      await expect(page.locator('input[name="monitoria"]')).toHaveValue(idPropia);
    });

    await test.step("fuerza el envío con el id de la monitoría de la otra monitora: No encontramos esa monitoría en tu agenda", async () => {
      await enviarConId(page, idAjena);
      await expect(page).toHaveURL(`${RUTA}?no_finalizada=no_encontrada`, ESPERA);
      await expect(aviso(page, "alert", MENSAJE_NO_ENCONTRADA)).toBeVisible(ESPERA);
      await expect(aviso(page, "alert", MENSAJE_NO_ENCONTRADA)).toHaveCount(1);
      await expect(page.getByRole("status")).toHaveCount(0);
      await sinCambios("con el id de la ajena");
      // Tampoco se filtra nada de la ajena: ni el nombre de quien agendó ni su correo ni su teléfono.
      expect(await textoVisible(page)).not.toContain(leadDeLaDuena.nombre);
      const html = await page.content();
      expect(html).not.toContain(leadDeLaDuena.nombre);
      expect(html).not.toContain(leadDeLaDuena.correo);
      expect(html).not.toContain(leadDeLaDuena.telefono);
      // Su propia monitoría sigue donde estaba, lista para finalizar.
      await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible();
      await expectTarjeta(seccion(page, "Por finalizar (1)"), leadDelOtro, renglonesDeLaEmpezada(materia, sesion, leadDelOtro));
    });

    await test.step("con un id que no existe, o que ni es un id, el mensaje es el mismo: no se dice si existe", async () => {
      for (const valor of [randomUUID(), "no-es-un-id", ""]) {
        // Cada envío parte de la agenda limpia: sin esto el URL ya es el del aviso anterior y la prueba no sabría
        // cuándo terminó el envío (y React devuelve el formulario a su valor al terminar cada acción).
        await page.goto(RUTA);
        await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible(ESPERA);
        await enviarConId(page, valor);
        await expect(page).toHaveURL(`${RUTA}?no_finalizada=no_encontrada`, ESPERA);
        await expect(aviso(page, "alert", MENSAJE_NO_ENCONTRADA)).toBeVisible(ESPERA);
        await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible();
      }
      await sinCambios("con ids que no existen");
    });

    await test.step("su propia monitoría sí se finaliza: la ajena sigue confirmada", async () => {
      await botonDeFinalizar(seccion(page, "Por finalizar (1)")).click();
      await expect(page).toHaveURL(`${RUTA}?finalizada=1`, ESPERA);
      await expect(aviso(page, "status", MENSAJE_FINALIZADA)).toBeVisible(ESPERA);
      expect((await escenario.enBase(idPropia)).estado).toBe("realizada");
      expect(await escenario.enBase(idAjena)).toEqual({ estado: "confirmada", fecha_finalizacion: null });
    });
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre lo nuevo: Por finalizar, sus avisos y el recordatorio del panel
// ---------------------------------------------------------------------------
test.describe("Accesibilidad · Por finalizar, sus avisos y el recordatorio del panel respetan las reglas del producto", () => {
  test("con la sección Por finalizar y cada aviso a la vista (y el panel con el recordatorio), el texto mide 14 px o más, las áreas táctiles 44 px o más y no hay desbordamiento a 390 px", async ({
    page,
    escenario,
  }) => {
    // Un nombre largo y sin espacios: la tarjeta tiene que partirlo en vez de desbordar la pantalla.
    const sufijoLargo = randomUUID().replaceAll("-", "");
    const { sesion, materia, monitor, leadEmpezada, leadFutura } = await monitorConEmpezadaYFutura(escenario, `Sebastiano${sufijoLargo}${sufijoLargo}`);

    await test.step("el panel con el recordatorio", async () => {
      await entrar(page, "/monitor", monitor);
      await expect(page.getByRole("status")).toHaveText("Tienes 1 monitoría por finalizar. Márcala como realizada en tu agenda; si no, se cierra sola.");
      await expect(page.getByRole("link", { name: "Mi agenda" })).toBeVisible();
      await expectReglasDelProducto(page, "el panel con el recordatorio");
    });

    await test.step("Mi agenda con Por finalizar (el botón y los enlaces miden 44 px o más; la tarjeta parte el nombre largo)", async () => {
      await page.getByRole("link", { name: "Mi agenda" }).click();
      await expect(page).toHaveURL(RUTA, ESPERA);
      await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible(ESPERA);
      await expect(botonDeFinalizar(page)).toBeVisible();
      await expect(seccion(page, "Por finalizar (1)")).toContainText(leadEmpezada.nombre);
      await expect(seccion(page, "Próximas (1)")).toContainText(leadFutura.nombre);
      await expectReglasDelProducto(page, "mi agenda con Por finalizar");
    });

    await test.step("con el aviso de que todavía no empieza (alert) y Por finalizar a la vista", async () => {
      await page.goto(`${RUTA}?no_finalizada=no_empezo`);
      await expect(aviso(page, "alert", MENSAJE_NO_EMPEZO)).toBeVisible(ESPERA);
      await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible();
      await expect(botonDeFinalizar(page)).toBeVisible();
      await expectReglasDelProducto(page, "mi agenda con Por finalizar y el aviso de que no empieza");
    });

    await test.step("con el aviso de que no la encontró (alert) y Por finalizar a la vista", async () => {
      await page.goto(`${RUTA}?no_finalizada=no_encontrada`);
      await expect(aviso(page, "alert", MENSAJE_NO_ENCONTRADA)).toBeVisible(ESPERA);
      await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible();
      await expectReglasDelProducto(page, "mi agenda con Por finalizar y el aviso de que no la encontró");
    });

    await test.step("con el aviso de éxito (status) y Por finalizar a la vista", async () => {
      await page.goto(`${RUTA}?finalizada=1`);
      await expect(aviso(page, "status", MENSAJE_FINALIZADA)).toBeVisible(ESPERA);
      await expect(subtitulo(page, "Por finalizar (1)")).toBeVisible();
      await expectReglasDelProducto(page, "mi agenda con Por finalizar y el aviso de éxito");
    });

    await test.step("el nombre largo se parte dentro de la tarjeta (390 px) y la agenda mantiene sus textos", async () => {
      await expectTarjeta(seccion(page, "Por finalizar (1)"), leadEmpezada, renglonesDeLaEmpezada(materia, sesion, leadEmpezada));
    });
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (las mismas de agenda.spec.ts)
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

/** Texto, áreas táctiles (enlaces, botones, campos y el resumen de un details), degradados y nombres. */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
      (el) => visible(el) && [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, summary, input:not([type=hidden])")].filter(visible);
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
