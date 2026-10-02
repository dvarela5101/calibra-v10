import { randomInt, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { diaDelNegocio, formatearDiaConSemana } from "../src/lib/fechas";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-021: el monitor ve su agenda (próximas y pasadas) con quién agendó y cómo va el pago de cada monitoría. Corre
// contra el Supabase local (Auth y base) con cuentas, materias, Leads, monitorías y pagos que crea y borra cada
// prueba (códigos, nombres y correos únicos: las pruebas corren en paralelo y solo se afirma sobre lo propio). Las
// fechas salen de la zona del negocio (America/Bogota), nunca de la de la máquina.
//
// Cada entrada por /ingresar gasta cupo de Auth: cada prueba entra una vez y recorre sus pasos con `test.step`.

const ESPERA = { timeout: 20_000 };
const MINUTO_MS = 60_000;

// Cifras que la agenda nunca debe mostrar (P-24): lo que vale la monitoría y lo que pagó quien pagó. Son de siete
// cifras para que no se confundan con nada de la página (ni con un número de versión del HTML).
const VALOR_DE_LA_MONITORIA = 1_357_911;
const MONTO_DEL_PAGO = 2_468_024;
const CIFRAS_PROHIBIDAS = ["1357911", "1.357.911", "1,357,911", "2468024", "2.468.024", "2,468,024"];

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

/** La fecha de `semanas` semanas desde hoy (negativas, pasadas): cae siempre en el día de la semana de las franjas de la prueba. */
const enSemanas = (semanas: number) => sumarDias(hoy(), 7 * semanas);

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Materia = { id: string; nombre: string; codigo: string };
type Franja = { id: string };
type Lead = { id: string; nombre: string; correo: string; telefono: string };
type EstadoDeMonitoria = "pendiente_pago" | "confirmada" | "realizada" | "cancelada";
type MotivoDeCancelacion = "reserva_expirada" | "pago_rechazado" | "estudiante";
type EstadoDePagoCreado = "en_revision" | "aprobado" | "rechazado";
type DatosDeMonitoria = {
  estado: EstadoDeMonitoria;
  /** Solo si está cancelada: `estudiante` por defecto. */
  motivo?: MotivoDeCancelacion;
  /** Minutos desde que se apartó: más de 10 en una pendiente de pago es una reserva vencida (RN-34). */
  apartadaHaceMin?: number;
};

type Escenario = {
  materia(): Promise<Materia>;
  /** Un monitor con certificado en esa materia. */
  monitorCertificado(materia: Materia): Promise<Cuenta>;
  /** Franja semanal que cae el mismo día de la semana que hoy (así `enSemanas(n)` es una fecha suya). */
  franja(monitor: Cuenta, datos: { hora: string; duracionMin: number; presencial: boolean }): Promise<Franja>;
  /** Un Lead con correo y teléfono propios; el nombre lleva un sufijo único. */
  lead(nombre: string): Promise<Lead>;
  /** Una monitoría creada con la llave secreta. Devuelve su id. */
  monitoria(monitor: Cuenta, materia: Materia, franja: Franja, lead: Lead, fecha: string, datos: DatosDeMonitoria): Promise<string>;
  /** Un pago de la monitoría (con su comprobante revisado). */
  pago(idMonitoria: string, estado: EstadoDePagoCreado): Promise<void>;
  /** Textos de contacto del pagador: no deben salir en la agenda. */
  readonly pagador: { nombre: string; contacto: string };
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
    const pagador = { nombre: `Pagador e2e ${randomUUID().slice(0, 8)}`, contacto: `pagador-${randomUUID()}@calibra.test` };

    async function insertar(tabla: string, fila: Record<string, unknown>) {
      const { data, error } = await cliente.from(tabla).insert(fila).select().single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data as { id: string };
    }

    await entregar({
      pagador,
      async materia() {
        const nombre = `Materia e2e agenda ${randomUUID().slice(0, 6)}`;
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
      async franja(monitor, datos) {
        const franja = await insertar("franja", {
          id_monitor: monitor.id,
          dia: diaIso(hoy()),
          hora: datos.hora,
          duracion_min: datos.duracionMin,
          presencial: datos.presencial,
          precio: 25_000,
          lugar: datos.presencial ? "Edificio ML, salón 101" : null,
          enlace: datos.presencial ? null : "https://meet.example.com/e2e-agenda",
        });
        return { id: franja.id };
      },
      async lead(nombre) {
        const lead = {
          nombre: `${nombre} e2e ${randomUUID().replaceAll("-", "").slice(0, 8)}`,
          correo: `lead-${randomUUID()}@calibra.test`,
          // Un número de móvil colombiano de siete cifras al azar: se busca tal cual en el HTML.
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
      async monitoria(monitor, materia, franja, lead, fecha, datos) {
        const fila = await insertar("monitoria", {
          id_franja: franja.id,
          id_monitor: monitor.id,
          id_materia: materia.id,
          id_lead: lead.id,
          fecha,
          valor_total: VALOR_DE_LA_MONITORIA,
          estado: datos.estado,
          ...(datos.estado === "cancelada" ? { motivo_cancelacion: datos.motivo ?? "estudiante" } : {}),
          ...(datos.estado === "realizada" ? { fecha_finalizacion: new Date().toISOString() } : {}),
          ...(datos.apartadaHaceMin ? { fecha_creacion: new Date(Date.now() - datos.apartadaHaceMin * MINUTO_MS).toISOString() } : {}),
        });
        return fila.id;
      },
      async pago(idMonitoria, estado) {
        idAdmin ??= (await cuentas.crearAdmin()).id;
        // pago.comprobante es una llave foránea a los comprobantes que el servidor ya revisó (HU-059).
        const comprobante = `${randomUUID()}/${randomUUID()}.png`;
        const { error } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
        if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
        comprobantes.push(comprobante);
        const fila = await insertar("pago", {
          id_monitoria: idMonitoria,
          monto: MONTO_DEL_PAGO,
          nombre_pagador: pagador.nombre,
          contacto: pagador.contacto,
          id_admin: idAdmin,
          comprobante,
          estado,
          fecha_revision: estado === "en_revision" ? null : new Date().toISOString(),
        });
        pagos.push(fila.id);
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
const subtitulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 2, name: nombre });

/**
 * La tarjeta de la monitoría de ese Lead (el nombre lleva un sufijo único) y sus cuatro renglones, en orden:
 * día y hora, materia · duración · modalidad, quién agendó, y estado · pago (este, también con una expresión).
 */
async function expectTarjeta(zona: Locator, lead: Lead, renglones: [string, string, string, string | RegExp]): Promise<Locator> {
  const tarjeta = zona.getByRole("listitem").filter({ hasText: lead.nombre });
  await expect(tarjeta).toHaveCount(1);
  await expect(tarjeta.locator(":scope > span")).toHaveText(renglones);
  return tarjeta;
}

/** El texto que se ve, con los espacios duros como espacios normales. */
const textoVisible = async (page: Page) => (await page.locator("body").innerText()).replace(/\s/g, " ");

/** El HTML que recibe el navegador (con los datos que Next incrusta para hidratar) y el que ya armó la página. */
async function htmlDeLaAgenda(page: Page): Promise<string[]> {
  const respuesta = await page.request.get(RUTA);
  expect(respuesta.status(), "GET /monitor/agenda con la sesión del monitor").toBe(200);
  return [await respuesta.text(), await page.content()];
}

// ---------------------------------------------------------------------------
// Criterios 1, 2 y 4 · la agenda con todos los estados
// ---------------------------------------------------------------------------
test.describe("Criterios 1, 2 y 4 · próximas y pasadas, cada tarjeta con su detalle y sin el contacto del estudiante", () => {
  test("el monitor toca Mi agenda en su panel y ve Próximas (2) y Pasadas (3), cada tarjeta con día y hora, materia, duración, modalidad, quién agendó, estado y pago, sin correo ni teléfono del Lead", async ({
    page,
    escenario,
  }) => {
    const materia = await escenario.materia();
    const monitor = await escenario.monitorCertificado(materia);
    const presencial = await escenario.franja(monitor, { hora: "14:30", duracionMin: 90, presencial: true });
    const virtual = await escenario.franja(monitor, { hora: "18:00", duracionMin: 45, presencial: false });

    // Un nombre largo y sin espacios: la tarjeta tiene que partirlo en vez de desbordar la pantalla.
    const sufijoLargo = randomUUID().replaceAll("-", "");
    const nombreLargo = `Sebastiano${sufijoLargo}${sufijoLargo}`;
    const [confirmada, vigente, realizada, cancelada, vencida] = await Promise.all([
      escenario.lead("Camila"),
      escenario.lead(nombreLargo),
      escenario.lead("Daniela"),
      escenario.lead("Esteban"),
      escenario.lead("Valentina"),
    ]);

    // Próximas: una confirmada (con su pago aprobado) y una apartada que espera el pago.
    const idConfirmada = await escenario.monitoria(monitor, materia, presencial, confirmada, enSemanas(1), { estado: "confirmada" });
    await escenario.pago(idConfirmada, "aprobado");
    await escenario.monitoria(monitor, materia, virtual, vigente, enSemanas(2), { estado: "pendiente_pago" });
    // Pasadas: una realizada, una cancelada por el estudiante y una reserva que venció sin pago (D-12). El proceso
    // de cada minuto de HU-027 puede cancelarla por reserva_expirada antes de que se lea la agenda: sigue entre las
    // pasadas y en el mismo lugar, con el texto de ese estado.
    const idRealizada = await escenario.monitoria(monitor, materia, presencial, realizada, enSemanas(-1), { estado: "realizada" });
    await escenario.pago(idRealizada, "aprobado");
    await escenario.monitoria(monitor, materia, virtual, cancelada, enSemanas(-2), { estado: "cancelada", motivo: "estudiante" });
    await escenario.monitoria(monitor, materia, presencial, vencida, enSemanas(3), { estado: "pendiente_pago", apartadaHaceMin: 11 });

    await test.step("desde su panel toca Mi agenda", async () => {
      await entrar(page, "/monitor", monitor);
      await page.getByRole("link", { name: "Mi agenda" }).click();
      await expect(page).toHaveURL(RUTA, ESPERA);
      await expect(page).toHaveTitle("Mi agenda · Calibra");
      await expect(titulo(page)).toBeVisible(ESPERA);
      await expect(page.getByText("El contacto del estudiante no se muestra.")).toBeVisible();
    });

    const proximas = seccion(page, "Próximas (2)");
    const pasadas = seccion(page, "Pasadas (3)");

    await test.step("Próximas (2): la más cercana primero, con día y hora, materia, duración, modalidad, quién agendó, estado y pago", async () => {
      await expect(subtitulo(page, "Próximas (2)")).toBeVisible();
      await expect(proximas.getByRole("listitem")).toHaveCount(2);
      await expect(proximas.getByRole("listitem").nth(0)).toContainText(confirmada.nombre);
      await expect(proximas.getByRole("listitem").nth(1)).toContainText(vigente.nombre);

      const tarjeta = await expectTarjeta(proximas, confirmada, [
        `${formatearDiaConSemana(enSemanas(1))}, 14:30 a 16:00`,
        `${materia.nombre} · 90 min · Presencial`,
        `Agendó: ${confirmada.nombre}`,
        "Confirmada · Pago aprobado",
      ]);
      await expect(tarjeta.locator("time")).toHaveAttribute("datetime", enSemanas(1));
      await expectTarjeta(proximas, vigente, [
        `${formatearDiaConSemana(enSemanas(2))}, 18:00 a 18:45`,
        `${materia.nombre} · 45 min · Virtual`,
        `Agendó: ${vigente.nombre}`,
        "Reservada, esperando el pago · Sin pagar",
      ]);
    });

    await test.step("Pasadas (3): la más reciente primero; realizada, cancelada con su motivo y reserva vencida", async () => {
      await expect(subtitulo(page, "Pasadas (3)")).toBeVisible();
      await expect(pasadas.getByRole("listitem")).toHaveCount(3);
      // La reserva vencida cae en la semana 3 y va primero; después la realizada (-1) y la cancelada (-2).
      await expect(pasadas.getByRole("listitem").nth(0)).toContainText(vencida.nombre);
      await expect(pasadas.getByRole("listitem").nth(1)).toContainText(realizada.nombre);
      await expect(pasadas.getByRole("listitem").nth(2)).toContainText(cancelada.nombre);

      await expectTarjeta(pasadas, vencida, [
        `${formatearDiaConSemana(enSemanas(3))}, 14:30 a 16:00`,
        `${materia.nombre} · 90 min · Presencial`,
        `Agendó: ${vencida.nombre}`,
        /^(Reserva vencida: no llegó el pago a tiempo|Cancelada: la reserva venció sin pago) · Sin pagar$/,
      ]);
      await expectTarjeta(pasadas, realizada, [
        `${formatearDiaConSemana(enSemanas(-1))}, 14:30 a 16:00`,
        `${materia.nombre} · 90 min · Presencial`,
        `Agendó: ${realizada.nombre}`,
        "Realizada · Pago aprobado",
      ]);
      await expectTarjeta(pasadas, cancelada, [
        `${formatearDiaConSemana(enSemanas(-2))}, 18:00 a 18:45`,
        `${materia.nombre} · 45 min · Virtual`,
        `Agendó: ${cancelada.nombre}`,
        "Cancelada: la canceló el estudiante · Sin pagar",
      ]);
      // La reserva vencida no se cuenta entre las próximas, ni la pendiente vigente entre las pasadas.
      await expect(proximas.getByText(vencida.nombre)).toHaveCount(0);
      await expect(pasadas.getByText(vigente.nombre)).toHaveCount(0);
      await expect(pasadas.locator("details")).toHaveCount(0);
    });

    await test.step("criterio 4 (P-37): el HTML trae el nombre de quien agendó, no su correo ni su teléfono", async () => {
      const leads = [confirmada, vigente, realizada, cancelada, vencida];
      for (const [i, html] of (await htmlDeLaAgenda(page)).entries()) {
        const fuente = i === 0 ? "el HTML que responde el servidor" : "el HTML de la página abierta";
        for (const lead of leads) {
          expect(html, `${fuente} con el nombre de ${lead.nombre}`).toContain(lead.nombre);
          expect(html, `${fuente} sin el correo de ${lead.nombre}`).not.toContain(lead.correo);
          expect(html, `${fuente} sin el teléfono de ${lead.nombre}`).not.toContain(lead.telefono);
        }
        // Tampoco las partes del correo, por si se mostrara cortado.
        expect(html, `${fuente} sin dominios de correo de los Leads`).not.toMatch(/lead-[0-9a-f-]{36}/);
      }
    });

    await test.step("la agenda respeta las reglas de accesibilidad del producto (texto, áreas táctiles, 390 px)", async () => {
      await expectReglasDelProducto(page, "mi agenda con todos los estados");
    });

    await test.step("Volver a mi panel lleva al panel", async () => {
      await page.getByRole("link", { name: "Volver a mi panel" }).click();
      await expect(page).toHaveURL("/monitor", ESPERA);
      // El panel ahora tiene el enlace a la agenda: sus áreas táctiles también cuentan.
      await expect(page.getByRole("link", { name: "Mi agenda" })).toBeVisible();
      await expectReglasDelProducto(page, "el panel con Mi agenda");
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 5 · el estado del pago (P-24, D-11), sin cifras
// ---------------------------------------------------------------------------
test.describe("Criterio 5 · el estado del pago de cada monitoría, sin cifras (P-24, D-11)", () => {
  test("las tarjetas dicen Sin pagar, Pago en revisión, Pago aprobado o Pago rechazado (con varios comprobantes manda el peor) y no aparece ningún $ ni el valor de la monitoría", async ({
    page,
    escenario,
  }) => {
    const materia = await escenario.materia();
    const monitor = await escenario.monitorCertificado(materia);
    const franja = await escenario.franja(monitor, { hora: "09:00", duracionMin: 60, presencial: true });
    const [sinPagar, enRevision, aprobado, rechazado, rechazadoYAprobado, revisionYAprobado] = await Promise.all([
      escenario.lead("Sin pagar"),
      escenario.lead("En revision"),
      escenario.lead("Aprobado"),
      escenario.lead("Rechazado"),
      escenario.lead("Rechazado y aprobado"),
      escenario.lead("Revision y aprobado"),
    ]);

    // Sin comprobantes: sin pagar.
    await escenario.monitoria(monitor, materia, franja, sinPagar, enSemanas(1), { estado: "pendiente_pago" });
    // Un comprobante en revisión.
    const idEnRevision = await escenario.monitoria(monitor, materia, franja, enRevision, enSemanas(2), { estado: "pendiente_pago" });
    await escenario.pago(idEnRevision, "en_revision");
    // Un comprobante aprobado: la monitoría está confirmada.
    const idAprobado = await escenario.monitoria(monitor, materia, franja, aprobado, enSemanas(3), { estado: "confirmada" });
    await escenario.pago(idAprobado, "aprobado");
    // Un comprobante rechazado: RN-43 cancela la cita.
    const idRechazado = await escenario.monitoria(monitor, materia, franja, rechazado, enSemanas(-1), { estado: "cancelada", motivo: "pago_rechazado" });
    await escenario.pago(idRechazado, "rechazado");
    // D-11: con varios comprobantes, rechazado si alguno lo fue...
    const idRechazadoYAprobado = await escenario.monitoria(monitor, materia, franja, rechazadoYAprobado, enSemanas(-2), {
      estado: "cancelada",
      motivo: "pago_rechazado",
    });
    await escenario.pago(idRechazadoYAprobado, "aprobado");
    await escenario.pago(idRechazadoYAprobado, "rechazado");
    // ... si no, en revisión si alguno lo está, aunque otro ya esté aprobado.
    const idRevisionYAprobado = await escenario.monitoria(monitor, materia, franja, revisionYAprobado, enSemanas(4), { estado: "pendiente_pago" });
    await escenario.pago(idRevisionYAprobado, "aprobado");
    await escenario.pago(idRevisionYAprobado, "en_revision");

    await entrar(page, RUTA, monitor);
    await expect(titulo(page)).toBeVisible(ESPERA);
    const proximas = seccion(page, "Próximas (4)");
    const pasadas = seccion(page, "Pasadas (2)");
    await expect(subtitulo(page, "Próximas (4)")).toBeVisible();
    await expect(subtitulo(page, "Pasadas (2)")).toBeVisible();

    await test.step("cada tarjeta dice el estado de su pago", async () => {
      const dia = (semanas: number) => formatearDiaConSemana(enSemanas(semanas));
      const materiaYModalidad = `${materia.nombre} · 60 min · Presencial`;
      await expectTarjeta(proximas, sinPagar, [`${dia(1)}, 09:00 a 10:00`, materiaYModalidad, `Agendó: ${sinPagar.nombre}`, "Reservada, esperando el pago · Sin pagar"]);
      await expectTarjeta(proximas, enRevision, [`${dia(2)}, 09:00 a 10:00`, materiaYModalidad, `Agendó: ${enRevision.nombre}`, "Reservada, esperando el pago · Pago en revisión"]);
      await expectTarjeta(proximas, aprobado, [`${dia(3)}, 09:00 a 10:00`, materiaYModalidad, `Agendó: ${aprobado.nombre}`, "Confirmada · Pago aprobado"]);
      await expectTarjeta(pasadas, rechazado, [
        `${dia(-1)}, 09:00 a 10:00`,
        materiaYModalidad,
        `Agendó: ${rechazado.nombre}`,
        "Cancelada: el pago fue rechazado · Pago rechazado",
      ]);
    });

    await test.step("D-11: con varios comprobantes manda el rechazado, y si no, el que está en revisión", async () => {
      const dia = (semanas: number) => formatearDiaConSemana(enSemanas(semanas));
      await expectTarjeta(pasadas, rechazadoYAprobado, [
        `${dia(-2)}, 09:00 a 10:00`,
        `${materia.nombre} · 60 min · Presencial`,
        `Agendó: ${rechazadoYAprobado.nombre}`,
        "Cancelada: el pago fue rechazado · Pago rechazado",
      ]);
      await expectTarjeta(proximas, revisionYAprobado, [
        `${dia(4)}, 09:00 a 10:00`,
        `${materia.nombre} · 60 min · Presencial`,
        `Agendó: ${revisionYAprobado.nombre}`,
        "Reservada, esperando el pago · Pago en revisión",
      ]);
    });

    await test.step("ninguna cifra: ni un $, ni el valor de la monitoría, ni el monto del pago, ni la comisión, ni el pagador", async () => {
      const visible = await textoVisible(page);
      expect(visible, "ningún $ en el texto de la página").not.toContain("$");
      expect(visible, "ninguna comisión en el texto de la página").not.toMatch(/comisi[oó]n/i);
      for (const [i, html] of (await htmlDeLaAgenda(page)).entries()) {
        const fuente = i === 0 ? "el HTML que responde el servidor" : "el HTML de la página abierta";
        for (const cifra of CIFRAS_PROHIBIDAS) expect(html, `${fuente} sin la cifra ${cifra}`).not.toContain(cifra);
        expect(html, `${fuente} sin el nombre del pagador`).not.toContain(escenario.pagador.nombre);
        expect(html, `${fuente} sin el contacto del pagador`).not.toContain(escenario.pagador.contacto);
        expect(html, `${fuente} sin el nombre de la comisión`).not.toMatch(/comisi[oó]n/i);
      }
      for (const cifra of CIFRAS_PROHIBIDAS) expect(visible).not.toContain(cifra);
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 3 · otro monitor, un visitante o un admin no ven esta agenda
// ---------------------------------------------------------------------------
test.describe("Criterio 3 · la agenda es solo de su monitor", () => {
  test("otro monitor que abre /monitor/agenda no ve las monitorías del primero", async ({ page, escenario }) => {
    const materia = await escenario.materia();
    const duena = await escenario.monitorCertificado(materia);
    const otro = await escenario.monitorCertificado(materia);
    const franja = await escenario.franja(duena, { hora: "16:00", duracionMin: 60, presencial: true });
    const lead = await escenario.lead("Estudiante ajena");
    await escenario.monitoria(duena, materia, franja, lead, enSemanas(1), { estado: "confirmada" });
    await escenario.monitoria(duena, materia, franja, lead, enSemanas(-1), { estado: "cancelada", motivo: "estudiante" });

    await entrar(page, RUTA, otro);
    await expect(titulo(page)).toBeVisible(ESPERA);
    await expect(subtitulo(page, "Próximas (0)")).toBeVisible();
    await expect(page.getByText("No tienes monitorías próximas.")).toBeVisible();
    await expect(subtitulo(page, "Pasadas (0)")).toBeVisible();
    await expect(page.getByText("Todavía no tienes monitorías pasadas.")).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(0);

    const visible = await textoVisible(page);
    expect(visible).not.toContain(lead.nombre);
    expect(visible).not.toContain(materia.nombre);
    for (const html of await htmlDeLaAgenda(page)) {
      expect(html).not.toContain(lead.nombre);
      expect(html).not.toContain(lead.correo);
      expect(html).not.toContain(lead.telefono);
    }
  });

  test("un visitante sin sesión que abre /monitor/agenda termina en /ingresar", async ({ page }) => {
    // Sin alta anónima: la prueba no necesita sesión y así no gasta el cupo por IP de Supabase Auth.
    await page.route("**/auth/v1/signup", (ruta) => ruta.abort());
    await page.goto(RUTA);
    await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(RUTA)}`, ESPERA);
    await expect(page.getByLabel("Correo")).toBeVisible();
    await expect(titulo(page)).toHaveCount(0);
    await expect(page.getByText(/Próximas \(/)).toHaveCount(0);
  });

  test("un admin que abre /monitor/agenda no la ve: va a su panel", async ({ page, cuentas }) => {
    const admin = await cuentas.crearAdmin();
    await page.goto("/ingresar");
    await enviarCredenciales(page, admin.correo, admin.contrasena);
    await expect(page).toHaveURL("/admin", ESPERA);

    await page.goto(RUTA);
    await expect(page).toHaveURL("/admin", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: `Hola, ${admin.nombre}` })).toBeVisible();
    await expect(titulo(page)).toHaveCount(0);
    await expect(page.getByText(/Próximas \(/)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Más de 10 pasadas: se ven 10 y el resto queda en "Ver N monitorías más"
// ---------------------------------------------------------------------------
test.describe("Muchas pasadas · diez a la vista y el resto en Ver N monitorías más", () => {
  test("con 11 pasadas se ven 10 y 1 queda en Ver 1 monitoría más; con 12, Ver 2 monitorías más, que se abre y se lee", async ({ page, escenario }) => {
    const materia = await escenario.materia();
    const monitor = await escenario.monitorCertificado(materia);
    const franja = await escenario.franja(monitor, { hora: "20:00", duracionMin: 60, presencial: false });
    const lead = await escenario.lead("Estudiante frecuente");
    // Una pasada por semana, de la más reciente (semana -1) a la más antigua. Todas canceladas por el estudiante.
    const crear = (semanas: number) => escenario.monitoria(monitor, materia, franja, lead, enSemanas(-semanas), { estado: "cancelada", motivo: "estudiante" });
    for (let semana = 1; semana <= 11; semana++) await crear(semana);

    await entrar(page, RUTA, monitor);
    await expect(titulo(page)).toBeVisible(ESPERA);
    const pasadas = seccion(page, "Pasadas (11)");
    const fechasDe = (zona: Locator) => zona.locator("time").evaluateAll((els) => els.map((el) => el.getAttribute("datetime")));
    const vistas = (n: number) => Array.from({ length: n }, (_, i) => enSemanas(-(i + 1)));

    await test.step("11 pasadas: 10 a la vista y 1 detrás de «Ver 1 monitoría más»", async () => {
      await expect(subtitulo(page, "Pasadas (11)")).toBeVisible();
      await expect(page.getByText("No tienes monitorías próximas.")).toBeVisible();
      await expect(pasadas.locator(":scope > ul > li")).toHaveCount(10);
      expect(await fechasDe(pasadas.locator(":scope > ul"))).toEqual(vistas(10));
      const resto = pasadas.locator("details");
      await expect(resto).toHaveCount(1);
      await expect(resto.locator("summary")).toHaveText("Ver 1 monitoría más");
      await expect(resto.locator("li")).toHaveCount(1);
      await expect(resto.locator("li")).toBeHidden();
    });

    await test.step("se agrega una más y la página dice Ver 2 monitorías más", async () => {
      await crear(12);
      await page.reload();
      await expect(subtitulo(page, "Pasadas (12)")).toBeVisible(ESPERA);
    });

    const pasadas12 = seccion(page, "Pasadas (12)");
    const resto = pasadas12.locator("details");
    await test.step("12 pasadas: 10 a la vista y 2 en el details, cerrado al principio", async () => {
      await expect(pasadas12.locator(":scope > ul > li")).toHaveCount(10);
      expect(await fechasDe(pasadas12.locator(":scope > ul"))).toEqual(vistas(10));
      await expect(resto.locator("summary")).toHaveText("Ver 2 monitorías más");
      await expect(resto).not.toHaveAttribute("open", /.*/);
      await expect(resto.locator("li")).toHaveCount(2);
      await expect(resto.locator("li").first()).toBeHidden();
    });

    await test.step("al abrirlo se leen las 2 más antiguas, con el mismo formato de tarjeta", async () => {
      await resto.locator("summary").click();
      await expect(resto).toHaveAttribute("open", /.*/);
      await expect(resto.locator("li")).toHaveCount(2);
      await expect(resto.locator("li").first()).toBeVisible();
      await expect(resto.locator("li").last()).toBeVisible();
      expect(await fechasDe(resto)).toEqual([enSemanas(-11), enSemanas(-12)]);
      await expect(resto.locator("li").first().locator(":scope > span")).toHaveText([
        `${formatearDiaConSemana(enSemanas(-11))}, 20:00 a 21:00`,
        `${materia.nombre} · 60 min · Virtual`,
        `Agendó: ${lead.nombre}`,
        "Cancelada: la canceló el estudiante · Sin pagar",
      ]);
      // En conjunto, las 12 en orden de la más reciente a la más antigua.
      expect(await fechasDe(pasadas12)).toEqual(vistas(12));
    });

    await test.step("con las 12 a la vista y el details abierto, la página respeta las reglas de accesibilidad del producto", async () => {
      await expectReglasDelProducto(page, "mi agenda con el details abierto");
      await resto.locator("summary").click();
      await expect(resto).not.toHaveAttribute("open", /.*/);
      await expectReglasDelProducto(page, "mi agenda con el details cerrado");
    });
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
