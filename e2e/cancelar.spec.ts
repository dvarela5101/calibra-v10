import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { diaDelNegocio } from "../src/lib/fechas";
import { esperarSesion, test as base, expect, type SesionEnCookie } from "./utilidades";

// HU-024 (RN-60, RN-43, D-26 a D-29): el Lead cancela su monitoría individual confirmada hasta 12 h antes, con el enlace del
// correo de confirmación (`/cita?token=...`, sin sesión) o con el mismo navegador con el que agendó (`/cita/[id]`). Corre
// contra el Supabase local con monitores, materias, Leads, monitorías, pagos y reembolsos que crea y borra cada prueba
// (nombres y correos únicos: las pruebas corren en paralelo y solo se afirma sobre lo propio). El correo de cancelación y los
// reembolsos los cubre la prueba de integración (`integracion/cancelar.test.ts`); aquí se prueba la interfaz: el botón, el
// paso de confirmación, la cita que queda cancelada, repetir la acción, la cita sin plazo y las reglas del producto.
//
// La cita se prepara por la base, con la llave secreta: se aparta `pendiente_pago` y se confirma con un UPDATE, que es lo que
// anota el token en `confirmacion_cita` (como en e2e/cita.spec.ts). El enlace del correo no crea sesión anónima: donde no
// hace falta se aborta el alta (`**/auth/v1/signup`).

const ESPERA = { timeout: 20_000 };
const PRECIO = 25_000;

const TITULO_CANCELADA = "Esta monitoría se canceló";
const PREGUNTA = "¿Cancelar tu monitoría? La fecha queda libre para otra persona.";
const NOTA_APROBADO = "Te devolvemos el valor completo: te pedimos la llave por correo.";
const TEXTO_PAGO_EN_REVISION =
  "Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.";
const TEXTO_DEL_REEMBOLSO = "Vamos a devolverte el dinero. Te escribimos al correo del pago para pedirte la llave.";
const TEXTO_FUERA_DE_PLAZO = "Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin";

// ---------------------------------------------------------------------------
// Fechas (America/Bogota)
// ---------------------------------------------------------------------------
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

/** Día, hora y duración de una franja que empieza dentro de `horas` horas (en Bogotá); la duración no pasa de la medianoche. */
function enHoras(horas: number): { fecha: string; hora: string; duracionMin: number } {
  const inicio = new Date(Math.floor((Date.now() + horas * 3_600_000) / 60_000) * 60_000);
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(inicio);
  const minutosDelDia = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
  return { fecha: diaDelNegocio(inicio), hora, duracionMin: Math.max(1, Math.min(30, 24 * 60 - minutosDelDia)) };
}

/** Texto con los espacios duros como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s/g, " ");

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type OpcionesDeCita = {
  /** El pago de la cita; `null` si no tiene. Por defecto, aprobado (hay reembolso al cancelar). */
  pago?: "en_revision" | "aprobado" | "rechazado" | null;
  fecha?: string;
  /** `HH:MM`. */
  hora?: string;
  duracionMin?: number;
  /** El Lead de la cita; si no, uno suelto, sin sesión. */
  idLead?: string;
};

type Cita = {
  id: string;
  /** El token del enlace del correo de confirmación. */
  token: string;
  materia: string;
  monitor: { nombre: string; correo: string };
  lead: { id: string; nombre: string; correo: string };
  fecha: string;
};

type FilaDeLead = { id: string; nombre: string; correo: string };

type Escenario = {
  cita(opciones?: OpcionesDeCita): Promise<Cita>;
  /** Espera la sesión anónima que el navegador recibe al abrir una página pública, y la borra al terminar. */
  sesion(context: BrowserContext): Promise<SesionEnCookie>;
  /** Hace Lead a una sesión, como si hubiera dejado su contacto al agendar (HU-068). */
  lead(idSesion: string): Promise<FilaDeLead>;
  /** El estado real de la cita en la base. */
  estadoDe(idMonitoria: string): Promise<{ estado: string; motivo_cancelacion: string | null }>;
  /** Los reembolsos que tiene la cita. */
  reembolsosDe(idMonitoria: string): Promise<{ monto: number; estado: string; motivo: string }[]>;
  /** Cambia la fecha de la cita, a otra del mismo día de la semana que su franja (para vencerle el plazo con la página ya abierta). */
  moverA(idMonitoria: string, fecha: string): Promise<void>;
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
    async function actualizar(contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) {
      const { error } = await consulta;
      if (error) throw new Error(`${contexto}: ${error.message}`);
    }

    async function crearLead(idSesion: string | null): Promise<FilaDeLead> {
      const { data, error } = await cliente
        .from("lead")
        .insert({
          id_sesion_anonima: idSesion,
          nombre: `Lead e2e cancelar ${randomUUID().replaceAll("-", "").slice(0, 8)}`,
          correo: `lead-${randomUUID()}@calibra.test`,
          acepta_tratamiento_datos: true,
          fecha_consentimiento: new Date().toISOString(),
        })
        .select("id, nombre, correo")
        .single();
      if (error) throw new Error(`insertar lead: ${error.message}`);
      leads.push(data.id as string);
      return data as FilaDeLead;
    }

    await entregar({
      async cita(opciones = {}) {
        const pago = opciones.pago === undefined ? "aprobado" : opciones.pago;
        const fecha = opciones.fecha ?? sumarDias(diaDelNegocio(new Date()), 5);
        const hora = opciones.hora ?? "10:00";
        idAdmin ??= (await cuentas.crearAdmin()).id;

        const monitor = await cuentas.crearMonitor();
        monitores.push(monitor.id);
        const nombreMateria = `Materia e2e cancelar ${randomUUID().slice(0, 6)}`;
        const materia = await insertar("materia", { nombre: nombreMateria, codigo: `E2E-${randomUUID().slice(0, 12)}` });
        materias.push(materia.id);
        await insertar("certificado", { id_monitor: monitor.id, id_materia: materia.id, id_admin: idAdmin });
        const franja = await insertar("franja", {
          id_monitor: monitor.id,
          dia: diaIso(fecha),
          hora,
          duracion_min: opciones.duracionMin ?? 60,
          presencial: true,
          precio: PRECIO,
          lugar: `Edificio e2e ${randomUUID().slice(0, 6)}, salón 301`,
        });
        const lead = opciones.idLead
          ? await (async () => {
              const { data, error } = await cliente.from("lead").select("id, nombre, correo").eq("id", opciones.idLead).single();
              if (error) throw new Error(`leer lead: ${error.message}`);
              return data as FilaDeLead;
            })()
          : await crearLead(null);

        // Se aparta pendiente de pago, como `agendar_monitoria`, y se confirma con un UPDATE, como `registrar_pago`.
        const monitoria = await insertar("monitoria", {
          id_franja: franja.id,
          id_monitor: monitor.id,
          id_materia: materia.id,
          id_lead: lead.id,
          fecha,
          valor_total: PRECIO,
          estado: "pendiente_pago",
        });
        if (pago) {
          // pago.comprobante es una llave foránea a los comprobantes que el servidor ya revisó (HU-059).
          const comprobante = `${randomUUID()}/${randomUUID()}.png`;
          await actualizar("insertar comprobante_revisado", cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" }));
          comprobantes.push(comprobante);
          const creado = await insertar("pago", {
            id_monitoria: monitoria.id,
            monto: PRECIO,
            nombre_pagador: `Pagador e2e ${randomUUID().slice(0, 8)}`,
            // El pago lo hizo el mismo correo del Lead: el correo de cancelación le pide la llave (D-27).
            contacto: lead.correo,
            id_admin: idAdmin,
            comprobante,
            estado: pago,
            fecha_revision: pago === "en_revision" ? null : new Date().toISOString(),
          });
          pagos.push(creado.id);
        }
        await actualizar("confirmar la monitoría", cliente.from("monitoria").update({ estado: "confirmada" }).eq("id", monitoria.id));

        const { data: confirmacion, error } = await cliente.from("confirmacion_cita").select("token").eq("id_monitoria", monitoria.id);
        if (error) throw new Error(`leer la confirmación: ${error.message}`);
        const token = (confirmacion as { token: string }[] | null)?.[0]?.token;
        if (!token) throw new Error("La confirmación de la cita no quedó anotada: ¿la monitoría pasó por pendiente_pago a confirmada?");
        return {
          id: monitoria.id,
          token,
          materia: nombreMateria,
          monitor: { nombre: monitor.nombre, correo: monitor.correo },
          lead,
          fecha,
        };
      },
      async sesion(context) {
        const sesion = await esperarSesion(context);
        cuentas.borrarAlFinal(sesion.id);
        return sesion;
      },
      lead: (idSesion) => crearLead(idSesion),
      async estadoDe(idMonitoria) {
        const { data, error } = await cliente.from("monitoria").select("estado, motivo_cancelacion").eq("id", idMonitoria).single();
        if (error) throw new Error(`leer la monitoría: ${error.message}`);
        return data as { estado: string; motivo_cancelacion: string | null };
      },
      async reembolsosDe(idMonitoria) {
        const { data: pagosDeLaCita, error } = await cliente.from("pago").select("id").eq("id_monitoria", idMonitoria);
        if (error) throw new Error(`leer los pagos: ${error.message}`);
        const ids = (pagosDeLaCita ?? []).map((p) => p.id as string);
        if (!ids.length) return [];
        const { data, error: errorReembolsos } = await cliente.from("reembolso").select("monto, estado, motivo").in("id_pago", ids);
        if (errorReembolsos) throw new Error(`leer los reembolsos: ${errorReembolsos.message}`);
        return (data ?? []) as { monto: number; estado: string; motivo: string }[];
      },
      moverA: (idMonitoria, fecha) => actualizar("mover la monitoría", cliente.from("monitoria").update({ fecha }).eq("id", idMonitoria)),
    });

    // Limpieza, antes de que la fixture `cuentas` borre a los monitores, al admin y a las sesiones: de las filas dependientes
    // hacia las cuentas. Los pagos y reembolsos no caen con la monitoría (la cancelación y su correo anotado, sí).
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (pagos.length) {
      await borrar("reembolsos", cliente.from("reembolso").delete().in("id_pago", pagos));
      await borrar("pagos", cliente.from("pago").delete().in("id", pagos));
    }
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

test.describe.configure({ mode: "default", timeout: 120_000 });

// ---------------------------------------------------------------------------
// Ayudas de página
// ---------------------------------------------------------------------------
const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
const botonCancelar = (page: Page) => page.getByRole("button", { name: "Cancelar mi monitoría", exact: true });
const botonConfirmar = (page: Page) => page.getByRole("button", { name: "Sí, cancelar", exact: true });
const botonMantener = (page: Page) => page.getByRole("button", { name: "No, mantenerla", exact: true });
const pasoDeConfirmacion = (page: Page) => page.getByRole("group", { name: PREGUNTA });

/** Los mensajes de error de la página (`role="alert"`), sin el anunciador de rutas de Next, que también lo lleva. */
const alertas = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

/** El texto que se ve, con los espacios duros como espacios normales. */
const textoVisible = async (page: Page) => normalizar(await page.locator("body").innerText());

/** Aborta el alta de la sesión anónima (el enlace del correo no la necesita, D-20). */
async function sinAltaAnonima(page: Page): Promise<void> {
  await page.route("**/auth/v1/signup", (ruta) => ruta.abort());
}

/** Anota los errores de JavaScript sin atrapar que tenga la página: tras cancelar no debe haber ninguno. */
function vigilarErrores(page: Page): string[] {
  const errores: string[] = [];
  page.on("pageerror", (error) => errores.push(error.message));
  return errores;
}

/** Abre una página pública y espera la sesión anónima que nace en el navegador. */
async function abrirPublica(page: Page, escenario: Escenario): Promise<SesionEnCookie> {
  await page.goto("/monitores");
  await page.waitForLoadState("networkidle");
  return escenario.sesion(page.context());
}

/** La cita ya cancelada: título, quién la canceló, sin botón de cancelar ni formulario ni error. */
async function expectCitaCancelada(page: Page): Promise<void> {
  await expect(titulo(page, TITULO_CANCELADA)).toBeVisible(ESPERA);
  await expect(page.getByText("La cancelaste tú.")).toBeVisible();
  await expect(botonCancelar(page)).toHaveCount(0);
  await expect(botonConfirmar(page)).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(0);
  await expect(alertas(page)).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Criterio 1 y 2 · cancelar con el enlace del correo
// ---------------------------------------------------------------------------
test.describe("Criterios 1 y 2 · cancelar con el enlace del correo", () => {
  test("con plazo: el botón abre la confirmación, «No, mantenerla» desiste, «Sí, cancelar» cancela y deja la cita cancelada sin errores; el reembolso queda creado", async ({
    page,
    escenario,
  }) => {
    await sinAltaAnonima(page);
    const errores = vigilarErrores(page);
    const cita = await escenario.cita();

    await page.goto(`/cita?token=${cita.token}`);
    await expect(botonCancelar(page)).toBeVisible(ESPERA);
    // El formulario lleva el token del enlace y no un id: la acción sabe por cuál puerta entra.
    await expect(page.locator('form input[type="hidden"][name="token"]')).toHaveValue(cita.token);
    await expect(page.locator('form input[type="hidden"][name="id"]')).toHaveCount(0);

    await test.step("el botón solo abre el paso de confirmación, con la nota del dinero; no cancela", async () => {
      await botonCancelar(page).click();
      await expect(pasoDeConfirmacion(page)).toBeVisible();
      await expect(page.getByText(NOTA_APROBADO)).toBeVisible();
      await expect(botonConfirmar(page)).toBeVisible();
      await expect(botonMantener(page)).toBeFocused();
      await expect(botonCancelar(page)).toHaveCount(0);
      expect((await escenario.estadoDe(cita.id)).estado).toBe("confirmada");
    });

    await test.step("«No, mantenerla» vuelve al botón sin llamar a la base", async () => {
      await botonMantener(page).click();
      await expect(botonCancelar(page)).toBeVisible();
      await expect(botonCancelar(page)).toBeFocused();
      await expect(pasoDeConfirmacion(page)).toHaveCount(0);
      expect((await escenario.estadoDe(cita.id)).estado).toBe("confirmada");
      expect(await escenario.reembolsosDe(cita.id)).toEqual([]);
    });

    await test.step("«Sí, cancelar»: la misma cita, cancelada por el Lead, con el texto del reembolso y sin ningún error", async () => {
      await botonCancelar(page).click();
      await botonConfirmar(page).click();
      await expect(titulo(page, TITULO_CANCELADA)).toBeVisible(ESPERA);
      await expect(page).toHaveURL(new RegExp(`/cita\\?token=${cita.token}$`));
      await expectCitaCancelada(page);
      await expect(page.getByText(TEXTO_DEL_REEMBOLSO)).toBeVisible();
      await expect(page.getByRole("link", { name: `Ver monitores de ${cita.materia}` })).toBeVisible();
      // Ni el fallo de red del cliente ni el genérico: el redirect de la acción no deja ningún mensaje.
      await expect(page.getByText("No pudimos comunicarnos con Calibra")).toHaveCount(0);
      await expect(page.getByText("No pudimos cancelar tu monitoría")).toHaveCount(0);
      expect(errores, "la página no debía lanzar errores de JavaScript").toEqual([]);
    });

    await test.step("en la base: cancelada por el estudiante y un reembolso por el valor completo, esperando la llave", async () => {
      expect(await escenario.estadoDe(cita.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
      expect(await escenario.reembolsosDe(cita.id)).toEqual([
        { monto: PRECIO, estado: "esperando_llave", motivo: "Cancelaste la monitoría dentro del plazo." },
      ]);
    });

    await test.step("recargar la página (o abrir el enlace otra vez) sigue mostrando la cita cancelada", async () => {
      await page.reload();
      await expectCitaCancelada(page);
      await page.goto(`/cita?token=${cita.token}`);
      await expectCitaCancelada(page);
    });
  });

  test("repetir la cancelación (otra pestaña con el paso abierto, el doble clic) no rompe: termina en la cita cancelada, sin error y sin segundo reembolso", async ({
    page,
    context,
    escenario,
  }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita();
    const otraPestana = await context.newPage();
    await sinAltaAnonima(otraPestana);
    const errores = [...vigilarErrores(page), ...vigilarErrores(otraPestana)];

    // Las dos pestañas abren el enlace y ponen el paso de confirmación.
    for (const pestana of [page, otraPestana]) {
      await pestana.goto(`/cita?token=${cita.token}`);
      await botonCancelar(pestana).click();
      await expect(pasoDeConfirmacion(pestana)).toBeVisible(ESPERA);
    }

    await botonConfirmar(page).click();
    await expectCitaCancelada(page);

    // La segunda ya encuentra la cita cancelada (`ya_cancelada`): también termina en la cita cancelada, sin mensaje de error.
    await botonConfirmar(otraPestana).click();
    await expectCitaCancelada(otraPestana);
    await expect(otraPestana).toHaveURL(new RegExp(`/cita\\?token=${cita.token}$`));

    expect(errores).toEqual([]);
    expect(await escenario.estadoDe(cita.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    expect(await escenario.reembolsosDe(cita.id)).toHaveLength(1);
  });

  test("con el pago todavía en revisión (P-07): la nota lo dice antes de cancelar y la cita cancelada lo repite; no hay reembolso todavía", async ({
    page,
    escenario,
  }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita({ pago: "en_revision" });

    await page.goto(`/cita?token=${cita.token}`);
    await botonCancelar(page).click();
    await expect(pasoDeConfirmacion(page)).toBeVisible(ESPERA);
    await expect(page.getByText(TEXTO_PAGO_EN_REVISION)).toBeVisible();
    await expect(page.getByText(NOTA_APROBADO)).toHaveCount(0);
    await botonConfirmar(page).click();

    await expectCitaCancelada(page);
    await expect(page.getByText(TEXTO_PAGO_EN_REVISION)).toBeVisible();
    await expect(page.getByText(TEXTO_DEL_REEMBOLSO)).toHaveCount(0);
    expect(await escenario.estadoDe(cita.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    expect(await escenario.reembolsosDe(cita.id)).toEqual([]);
  });

  test("si el plazo vence con el paso abierto, la base manda: el mensaje de fuera de plazo con role=alert, el paso sigue abierto y la cita sigue confirmada", async ({
    page,
    escenario,
  }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita();

    await page.goto(`/cita?token=${cita.token}`);
    await botonCancelar(page).click();
    await expect(pasoDeConfirmacion(page)).toBeVisible(ESPERA);
    // El plazo se vence en la base mientras la página sigue abierta (el reloj de la base decide, P-40).
    await escenario.moverA(cita.id, sumarDias(cita.fecha, -14));
    await botonConfirmar(page).click();

    const alerta = alertas(page);
    await expect(alerta).toBeVisible(ESPERA);
    await expect(alerta).toContainText(TEXTO_FUERA_DE_PLAZO);
    await expect(pasoDeConfirmacion(page)).toBeVisible();
    await expect(botonConfirmar(page)).toBeEnabled();
    expect((await escenario.estadoDe(cita.id)).estado).toBe("confirmada");
    expect(await escenario.reembolsosDe(cita.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Criterio 1 · cancelar con el mismo navegador con el que agendó
// ---------------------------------------------------------------------------
test.describe("Criterio 1 · cancelar con la sesión del Lead", () => {
  test("desde /cita/[id]: el formulario lleva el id, se cancela y se vuelve a la misma cita cancelada, con «Ver mis citas» y sin error", async ({
    page,
    escenario,
  }) => {
    const errores = vigilarErrores(page);
    const sesion = await abrirPublica(page, escenario);
    const lead = await escenario.lead(sesion.id);
    const cita = await escenario.cita({ idLead: lead.id });

    await page.goto(`/cita/${cita.id}`);
    await expect(botonCancelar(page)).toBeVisible(ESPERA);
    await expect(page.locator('form input[type="hidden"][name="id"]')).toHaveValue(cita.id);
    await expect(page.locator('form input[type="hidden"][name="token"]')).toHaveCount(0);

    await botonCancelar(page).click();
    await expect(pasoDeConfirmacion(page)).toBeVisible();
    await expect(page.getByText(NOTA_APROBADO)).toBeVisible();
    await botonConfirmar(page).click();

    await expect(titulo(page, TITULO_CANCELADA)).toBeVisible(ESPERA);
    await expect(page).toHaveURL(new RegExp(`/cita/${cita.id}$`));
    await expectCitaCancelada(page);
    await expect(page.getByText(TEXTO_DEL_REEMBOLSO)).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver mis citas" })).toBeVisible();
    expect(errores).toEqual([]);

    expect(await escenario.estadoDe(cita.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    expect(await escenario.reembolsosDe(cita.id)).toHaveLength(1);

    // Mis citas la muestra cancelada, y recargar el detalle no rompe nada.
    await page.reload();
    await expectCitaCancelada(page);
    await page.getByRole("link", { name: "Ver mis citas" }).click();
    await expect(page).toHaveURL(/\/cita$/, ESPERA);
    await expect(page.locator("main ul > li").first()).toContainText(cita.materia);
    await expect(page.locator("main ul > li").first()).toContainText("Cancelada");
  });
});

// ---------------------------------------------------------------------------
// Criterio 3 · sin plazo
// ---------------------------------------------------------------------------
test.describe("Criterio 3 · pasó el plazo", () => {
  test("una cita que empieza en menos de 12 horas no ofrece cancelar y explica que los casos de fuerza mayor los resuelve un admin; por el enlace y por la sesión", async ({
    page,
    escenario,
  }) => {
    const sesion = await abrirPublica(page, escenario);
    const lead = await escenario.lead(sesion.id);
    const cita = await escenario.cita({ ...enHoras(6), idLead: lead.id });

    for (const ruta of [`/cita?token=${cita.token}`, `/cita/${cita.id}`]) {
      await page.goto(ruta);
      await expect(page.getByRole("heading", { level: 1, name: "Tu monitoría está confirmada" }), ruta).toBeVisible(ESPERA);
      await expect(botonCancelar(page), ruta).toHaveCount(0);
      await expect(page.locator("form"), ruta).toHaveCount(0);
      const texto = await textoVisible(page);
      expect(texto, ruta).toContain("El plazo para cancelarla terminó el ");
      // Con el correo de soporte configurado lo ofrece; sin él, termina en punto.
      expect(texto, ruta).toMatch(new RegExp(`${TEXTO_FUERA_DE_PLAZO}(: escríbenos a \\S+\\.|\\.)`));
    }
    expect((await escenario.estadoDe(cita.id)).estado).toBe("confirmada");
  });

  test("una cita que ya terminó no muestra el botón ni el texto del plazo", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const pasada = await escenario.cita({ fecha: sumarDias(diaDelNegocio(new Date()), -3) });

    await page.goto(`/cita?token=${pasada.token}`);
    await expect(titulo(page, "Tu monitoría ya terminó")).toBeVisible(ESPERA);
    await expect(botonCancelar(page)).toHaveCount(0);
    await expect(page.getByText(TEXTO_FUERA_DE_PLAZO, { exact: false })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la cancelación (las mismas de e2e/cita.spec.ts)
// ---------------------------------------------------------------------------
test.describe("Reglas del producto en la cancelación", () => {
  test("con el botón, el paso de confirmación, el error de plazo y la cita cancelada a la vista, el texto mide 14 px o más, las áreas táctiles 44 px o más y no hay desbordamiento a 390 px ni en escritorio", async ({
    page,
    escenario,
  }) => {
    await sinAltaAnonima(page);
    const aprobada = await escenario.cita();
    const enRevision = await escenario.cita({ pago: "en_revision" });
    const sinPlazo = await escenario.cita({ ...enHoras(6) });

    await test.step("el botón de cancelar", async () => {
      await page.goto(`/cita?token=${aprobada.token}`);
      await expect(botonCancelar(page)).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "cita con el botón de cancelar");
    });

    await test.step("el paso de confirmación, con la nota del dinero", async () => {
      await botonCancelar(page).click();
      await expect(pasoDeConfirmacion(page)).toBeVisible();
      await expectReglasDelProducto(page, "paso de confirmación");
    });

    await test.step("el paso con el pago en revisión (la nota más larga)", async () => {
      await page.goto(`/cita?token=${enRevision.token}`);
      await botonCancelar(page).click();
      await expect(page.getByText(TEXTO_PAGO_EN_REVISION)).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "paso de confirmación con el pago en revisión");
    });

    await test.step("el mensaje de error de fuera de plazo (role=alert)", async () => {
      await escenario.moverA(enRevision.id, sumarDias(enRevision.fecha, -14));
      await botonConfirmar(page).click();
      await expect(alertas(page)).toContainText(TEXTO_FUERA_DE_PLAZO, ESPERA);
      await expectReglasDelProducto(page, "mensaje de fuera de plazo");
    });

    await test.step("la cita sin plazo, con el texto de los casos de fuerza mayor", async () => {
      await page.goto(`/cita?token=${sinPlazo.token}`);
      await expect(page.getByText(TEXTO_FUERA_DE_PLAZO, { exact: false })).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "cita sin plazo");
    });

    await test.step("la cita ya cancelada", async () => {
      await page.goto(`/cita?token=${aprobada.token}`);
      await botonCancelar(page).click();
      await botonConfirmar(page).click();
      await expectCitaCancelada(page);
      await expectReglasDelProducto(page, "cita cancelada");
    });
  });
});

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

/** Texto, áreas táctiles (enlaces, botones, campos), degradados y nombres. */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
      (el) => visible(el) && [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, summary, textarea, input:not([type=hidden])")].filter(visible);
    // Los enlaces dentro de una frase son texto corrido: quedan fuera.
    const tocables = controles.filter((el) => !(el.tagName === "A" && el.closest("label, p")));
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
