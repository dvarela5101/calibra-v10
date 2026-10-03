import { randomBytes, randomUUID } from "node:crypto";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { diaDelNegocio, formatearDiaConSemana, formatearFechaHora } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { esperarSesion, leerSesion, test as base, expect, type SesionEnCookie } from "./utilidades";

// HU-019 (P-04, D-19 a D-25): la cita confirmada y su enlace de gestión. El Lead abre el enlace del correo
// (`/cita?token=...`) sin sesión, o vuelve con el mismo navegador con el que agendó (`/cita` y `/cita/[id]`). Corre
// contra el Supabase local con monitores, materias, Leads, monitorías, pagos y confirmaciones que crea y borra cada
// prueba (nombres y correos únicos: las pruebas corren en paralelo y solo se afirma sobre lo propio). El correo en sí
// lo cubre la prueba de integración (`integracion/citas.test.ts`); aquí se prepara la cita por la base, con la llave
// secreta: se aparta `pendiente_pago` y se confirma con un UPDATE, que es lo que anota el token en `confirmacion_cita`
// (una monitoría insertada ya `confirmada` no lo anota).
//
// El enlace del correo y `/cita` viven fuera de las páginas públicas: no crean sesión anónima. Donde no hace falta
// sesión se aborta el alta (`**/auth/v1/signup`) y se comprueba que la página ni lo intentó. Donde hace falta (el mismo
// navegador), la sesión anónima nace al abrir una página pública y la prueba la vuelve Lead, como en pagar.spec.ts.

const ESPERA = { timeout: 20_000 };
const PRECIO = 25_000;
const ENLACE_VIRTUAL = "https://meet.example/e2e-cita";

const TITULO_CONFIRMADA = "Tu monitoría está confirmada";
const TITULO_NO_SIRVE = "Este enlace no sirve";
const TITULO_NO_ENCONTRADA = "No encontramos esta página";
const TEXTO_PAGO_EN_REVISION = "Recibimos tu comprobante. Un admin lo revisa y, si hay algún problema, te avisamos por correo.";

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

/** El instante de inicio de un día `AAAA-MM-DD` a una hora `HH:MM` de Bogotá (UTC-5, sin horario de verano). */
const inicioDe = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00-05:00`);

/** Día, hora y duración de una franja que empieza dentro de `horas` horas (en Bogotá); la duración no pasa de la medianoche. */
function enHoras(horas: number): { fecha: string; hora: string; duracionMin: number } {
  const inicio = new Date(Math.floor((Date.now() + horas * 3_600_000) / 60_000) * 60_000);
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(inicio);
  const minutosDelDia = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
  return { fecha: diaDelNegocio(inicio), hora, duracionMin: Math.max(1, Math.min(30, 24 * 60 - minutosDelDia)) };
}

/** Texto con los espacios duros (la hora y los pesos los llevan) como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s/g, " ");

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type OpcionesDeCita = {
  modalidad?: "presencial" | "virtual";
  /** En qué estado queda la cita. `cancelada` y `realizada` pasan antes por `confirmada` (así se anota el token). */
  estado?: "pendiente_pago" | "confirmada" | "cancelada" | "realizada";
  motivo?: "estudiante" | "pago_rechazado" | "monitor_no_asistio";
  /** El pago de la cita; `null` si no tiene. Por defecto, en revisión (el Lead acaba de adjuntar el comprobante). */
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
  /** El token del enlace del correo; `null` si la cita no pasó por `confirmada` (una por pagar). */
  token: string | null;
  materia: string;
  codigoMateria: string;
  monitor: { nombre: string; correo: string; contrasena: string };
  lead: { id: string; nombre: string; correo: string };
  fecha: string;
  hora: string;
  duracionMin: number;
  lugar: string | null;
  enlaceSesion: string | null;
  inicio: Date;
};

type FilaDeLead = { id: string; nombre: string; correo: string };

type Escenario = {
  cita(opciones?: OpcionesDeCita): Promise<Cita>;
  /** Espera la sesión anónima que el navegador recibe al abrir una página pública, y la borra al terminar. */
  sesion(context: BrowserContext): Promise<SesionEnCookie>;
  /** Hace Lead a una sesión, como si hubiera dejado su contacto al agendar (HU-068). */
  lead(idSesion: string): Promise<FilaDeLead>;
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
          nombre: `Lead e2e cita ${randomUUID().replaceAll("-", "").slice(0, 8)}`,
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
        const estado = opciones.estado ?? "confirmada";
        const pago = opciones.pago === undefined ? "en_revision" : opciones.pago;
        const presencial = (opciones.modalidad ?? "presencial") === "presencial";
        const fecha = opciones.fecha ?? sumarDias(diaDelNegocio(new Date()), 5);
        const hora = opciones.hora ?? "10:00";
        const duracionMin = opciones.duracionMin ?? 60;
        idAdmin ??= (await cuentas.crearAdmin()).id;

        const monitor = await cuentas.crearMonitor();
        monitores.push(monitor.id);
        const nombreMateria = `Materia e2e cita ${randomUUID().slice(0, 6)}`;
        const codigoMateria = `E2E-${randomUUID().slice(0, 12)}`;
        const materia = await insertar("materia", { nombre: nombreMateria, codigo: codigoMateria });
        materias.push(materia.id);
        await insertar("certificado", { id_monitor: monitor.id, id_materia: materia.id, id_admin: idAdmin });

        const lugar = presencial ? `Edificio e2e ${randomUUID().slice(0, 6)}, salón 301` : null;
        const enlaceSesion = presencial ? null : `${ENLACE_VIRTUAL}-${randomUUID().slice(0, 6)}`;
        const franja = await insertar("franja", {
          id_monitor: monitor.id,
          dia: diaIso(fecha),
          hora,
          duracion_min: duracionMin,
          presencial,
          precio: PRECIO,
          lugar,
          enlace: enlaceSesion,
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
        if (estado !== "pendiente_pago") {
          if (pago) {
            // pago.comprobante es una llave foránea a los comprobantes que el servidor ya revisó (HU-059).
            const comprobante = `${randomUUID()}/${randomUUID()}.png`;
            await actualizar("insertar comprobante_revisado", cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" }));
            comprobantes.push(comprobante);
            const creado = await insertar("pago", {
              id_monitoria: monitoria.id,
              monto: PRECIO,
              nombre_pagador: `Pagador e2e ${randomUUID().slice(0, 8)}`,
              contacto: `pagador-${randomUUID()}@calibra.test`,
              id_admin: idAdmin,
              comprobante,
              estado: pago,
              fecha_revision: pago === "en_revision" ? null : new Date().toISOString(),
            });
            pagos.push(creado.id);
          }
          await actualizar("confirmar la monitoría", cliente.from("monitoria").update({ estado: "confirmada" }).eq("id", monitoria.id));
          if (estado === "cancelada") {
            await actualizar(
              "cancelar la monitoría",
              cliente.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: opciones.motivo ?? "estudiante" }).eq("id", monitoria.id),
            );
          } else if (estado === "realizada") {
            await actualizar(
              "pasar la monitoría a realizada",
              cliente.from("monitoria").update({ estado: "realizada", fecha_finalizacion: new Date().toISOString() }).eq("id", monitoria.id),
            );
          }
        }

        const { data: confirmacion, error } = await cliente.from("confirmacion_cita").select("token").eq("id_monitoria", monitoria.id);
        if (error) throw new Error(`leer la confirmación: ${error.message}`);
        const token = (confirmacion as { token: string }[] | null)?.[0]?.token ?? null;
        if (estado !== "pendiente_pago" && !token) throw new Error("La confirmación de la cita no quedó anotada: ¿la monitoría pasó por pendiente_pago a confirmada?");
        return {
          id: monitoria.id,
          token,
          materia: nombreMateria,
          codigoMateria,
          monitor: { nombre: monitor.nombre, correo: monitor.correo, contrasena: monitor.contrasena },
          lead,
          fecha,
          hora,
          duracionMin,
          lugar,
          enlaceSesion,
          inicio: inicioDe(fecha, hora),
        };
      },
      async sesion(context) {
        const sesion = await esperarSesion(context);
        cuentas.borrarAlFinal(sesion.id);
        return sesion;
      },
      lead: (idSesion) => crearLead(idSesion),
    });

    // Limpieza, antes de que la fixture `cuentas` borre a los monitores, al admin y a las sesiones: de las filas dependientes
    // hacia las cuentas. Los pagos no caen con la monitoría; la confirmación sí. Se intenta todo y se avisa de lo que falle.
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

test.describe.configure({ mode: "default", timeout: 120_000 });

// ---------------------------------------------------------------------------
// Ayudas de página
// ---------------------------------------------------------------------------
const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });

/** El valor que muestra el resumen para una etiqueta (Materia, Monitor, Valor...). */
const dato = (page: Page, etiqueta: string): Locator =>
  page.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");

/** El texto que se ve, con los espacios duros como espacios normales. */
const textoVisible = async (page: Page) => normalizar(await page.locator("body").innerText());

const botonesDeCancelar = (page: Page) => page.getByRole("button", { name: /cancelar/i });
/** El botón que abre el paso de confirmación de HU-024; solo está en una confirmada con plazo. */
const botonCancelar = (page: Page) => page.getByRole("button", { name: "Cancelar mi monitoría", exact: true });
const enlacesDeCancelar = (page: Page) => page.getByRole("link", { name: /cancelar/i });

/**
 * Aborta el alta de la sesión anónima (no hace falta y gasta cupo del Auth local) y cuenta cuántas veces la página lo
 * intentó: el enlace del correo no debe crear sesión (va fuera de las páginas públicas, D-20).
 */
async function sinAltaAnonima(page: Page): Promise<{ intentos: number }> {
  const altas = { intentos: 0 };
  await page.route("**/auth/v1/signup", (ruta) => {
    altas.intentos += 1;
    return ruta.abort();
  });
  return altas;
}

/** Abre una página pública y espera la sesión anónima que nace en el navegador. */
async function abrirPublica(page: Page, escenario: Escenario): Promise<SesionEnCookie> {
  await page.goto("/monitores");
  await page.waitForLoadState("networkidle");
  return escenario.sesion(page.context());
}

/** `noindex` y `no-referrer` (el enlace lleva el token): que no quede en buscadores ni se filtre por el Referer. */
async function expectNoIndexNiReferer(page: Page, donde: string): Promise<void> {
  await expect(page.locator('meta[name="robots"]'), `${donde}: robots`).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="referrer"]'), `${donde}: referrer`).toHaveAttribute("content", "no-referrer");
}

// ---------------------------------------------------------------------------
// Criterio 2 · el enlace muestra la cita, su lugar y hasta cuándo se puede cancelar
// ---------------------------------------------------------------------------
test.describe("Criterio 2 · el Lead abre el enlace del correo", () => {
  test("una presencial confirmada: resumen, lugar, hasta cuándo puede cancelarla con el botón de cancelar y el texto del pago; sin sesión ni datos privados", async ({
    page,
    context,
    escenario,
  }) => {
    const altas = await sinAltaAnonima(page);
    const cita = await escenario.cita();

    await page.goto(`/cita?token=${cita.token}`);

    await test.step("el estado y el resumen: materia, monitor, fecha, hora, duración, modalidad y valor", async () => {
      await expect(titulo(page, TITULO_CONFIRMADA)).toBeVisible(ESPERA);
      await expect(page).toHaveTitle("Tu cita · Calibra");
      await expect(dato(page, "Materia")).toHaveText(cita.materia);
      await expect(dato(page, "Monitor")).toHaveText(cita.monitor.nombre);
      await expect(dato(page, "Fecha")).toHaveText(formatearDiaConSemana(cita.fecha));
      await expect(dato(page, "Hora")).toHaveText("10:00 a 11:00 (60 min)");
      await expect(dato(page, "Modalidad")).toHaveText("Presencial");
      await expect(dato(page, "Valor")).toHaveText(normalizar(formatearPesos(PRECIO)));
    });

    await test.step("el lugar llega con la cita confirmada, aunque el pago siga en revisión (D-21)", async () => {
      await expect(dato(page, "Lugar")).toHaveText(cita.lugar!);
      await expect(page.getByText("Enlace de la videollamada")).toHaveCount(0);
    });

    await test.step("dice hasta cuándo puede cancelarla (12 h antes) y, con plazo, ofrece «Cancelar mi monitoría» (HU-024)", async () => {
      const limite = formatearFechaHora(new Date(cita.inicio.getTime() - 12 * 3_600_000));
      const texto = await textoVisible(page);
      // La hora termina en «p. m.»: la frase no repite el punto, y sigue el tiempo que queda.
      expect(texto).toContain(`Puedes cancelarla hasta el ${normalizar(limite)} Quedan `);
      expect(texto).toMatch(/Quedan \d+ d/);
      // El botón solo abre el paso de confirmación; cancelar de verdad lo cubre e2e/cancelar.spec.ts.
      await expect(botonCancelar(page)).toBeVisible();
      await expect(enlacesDeCancelar(page)).toHaveCount(0);
    });

    await test.step("el pago (D-22): lo recibimos, un admin lo revisa", async () => {
      await expect(page.getByText(TEXTO_PAGO_EN_REVISION)).toBeVisible();
    });

    await test.step("nada del contacto del monitor ni del Lead ni cifras de comisión (P-37)", async () => {
      const html = await page.content();
      for (const privado of [cita.monitor.correo, cita.lead.correo, cita.lead.nombre]) expect(html).not.toContain(privado);
      expect(html.toLowerCase()).not.toContain("comisi");
    });

    await test.step("abrir el enlace no crea sesión ni liga el navegador al Lead (D-20)", async () => {
      await page.waitForLoadState("networkidle");
      expect(altas.intentos, "la página no debía intentar crear una sesión anónima").toBe(0);
      expect(leerSesion(await context.cookies()), "el navegador no debía recibir sesión").toBeNull();
      // Y sin sesión, `/cita` no lista nada: el enlace no dejó la cita en este navegador.
      await page.goto("/cita");
      await expect(page.getByText("No tienes citas en este navegador.", { exact: false })).toBeVisible(ESPERA);
    });
  });

  test("una virtual confirmada muestra el enlace de la videollamada (solo https, en otra pestaña) y no un lugar", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita({ modalidad: "virtual" });

    await page.goto(`/cita?token=${cita.token}`);

    await expect(titulo(page, TITULO_CONFIRMADA)).toBeVisible(ESPERA);
    await expect(dato(page, "Modalidad")).toHaveText("Virtual");
    await expect(page.locator("dt", { hasText: /^Lugar$/ })).toHaveCount(0);
    const enlace = page.getByRole("link", { name: "Abrir la videollamada" });
    await expect(enlace).toHaveAttribute("href", cita.enlaceSesion!);
    await expect(enlace).toHaveAttribute("target", "_blank");
    await expect(enlace).toHaveAttribute("rel", /noopener/);
    await expect(enlace).toHaveAttribute("rel", /noreferrer/);
    await expect(botonCancelar(page)).toBeVisible();
  });

  test("agendada con menos de 12 horas (RN-37) dice que el plazo para cancelarla ya terminó; una aprobada lo dice del pago", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita({ ...enHoras(6), pago: "aprobado" });

    await page.goto(`/cita?token=${cita.token}`);

    await expect(titulo(page, TITULO_CONFIRMADA)).toBeVisible(ESPERA);
    const limite = formatearFechaHora(new Date(cita.inicio.getTime() - 12 * 3_600_000));
    const texto = await textoVisible(page);
    expect(texto).toContain(`El plazo para cancelarla terminó el ${normalizar(limite)} `);
    expect(texto).not.toContain("Puedes cancelarla hasta");
    await expect(page.getByText("Tu pago está aprobado.")).toBeVisible();
    await expect(botonesDeCancelar(page)).toHaveCount(0);
    // Sin plazo no hay botón y se explica quién resuelve los casos extremos (HU-024, criterio 3).
    await expect(page.getByText("Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin", { exact: false })).toBeVisible();
  });

  test("una confirmada cuya hora ya pasó dice que terminó y el monitor la marcará como realizada; ya no muestra el lugar", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita({ fecha: sumarDias(diaDelNegocio(new Date()), -3) });

    await page.goto(`/cita?token=${cita.token}`);

    await expect(titulo(page, "Tu monitoría ya terminó")).toBeVisible(ESPERA);
    await expect(page.getByText("El monitor la marcará como realizada.")).toBeVisible();
    await expect(dato(page, "Materia")).toHaveText(cita.materia);
    expect(await page.content()).not.toContain(cita.lugar!);
    await expect(page.locator("dt", { hasText: /^Lugar$/ })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Criterio 3 · un token que no sirve no muestra nada de ninguna cita
// ---------------------------------------------------------------------------
test.describe("Criterio 3 · enlaces que no sirven", () => {
  test("un token inventado, incompleto, vacío, repetido o en mayúsculas dicen Este enlace no sirve, sin datos de ninguna cita", async ({ page, escenario }) => {
    const altas = await sinAltaAnonima(page);
    const cita = await escenario.cita();
    const inventado = randomBytes(32).toString("hex");
    const enlaces = [
      `/cita?token=${inventado}`,
      "/cita?token=abc",
      "/cita?token=",
      `/cita?token=${inventado}&token=${inventado}`,
      // Un token real, pero repetido junto a otro, o con la forma cambiada, tampoco abre la cita.
      `/cita?token=${cita.token}&token=${cita.token}`,
      `/cita?token=${cita.token!.toUpperCase()}`,
      `/cita?token=${cita.token}x`,
      `/cita?token=%20${cita.token}`,
    ];

    for (const ruta of enlaces) {
      await page.goto(ruta);
      await expect(titulo(page, TITULO_NO_SIRVE), ruta).toBeVisible(ESPERA);
      await expect(page.getByText("Está incompleto o no lo reconocemos."), ruta).toBeVisible();
      // Ningún dato de la cita: ni su resumen, ni su materia, ni su lugar.
      await expect(page.locator("dt"), ruta).toHaveCount(0);
      const html = await page.content();
      for (const dato of [cita.materia, cita.monitor.nombre, cita.lugar!]) expect(html, ruta).not.toContain(dato);
      await expect(page.getByRole("link", { name: "Ir al inicio", exact: true }), ruta).toBeVisible();
    }
    expect(altas.intentos).toBe(0);
  });

  test("las páginas del enlace no se indexan ni filtran el token por el Referer", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita();
    for (const [donde, ruta] of [
      ["cita válida", `/cita?token=${cita.token}`],
      ["token inventado", `/cita?token=${randomBytes(32).toString("hex")}`],
      ["mis citas", "/cita"],
    ] as const) {
      await page.goto(ruta);
      await expect(page.getByRole("heading", { level: 1 }), donde).toBeVisible(ESPERA);
      await expectNoIndexNiReferer(page, donde);
    }
    await page.goto(`/cita?token=${cita.token}`);
    await expect(page).toHaveTitle("Tu cita · Calibra");
    await page.goto("/cita");
    await expect(page).toHaveTitle("Mis citas · Calibra");
  });
});

// ---------------------------------------------------------------------------
// D-21 · lo que deja de mostrarse
// ---------------------------------------------------------------------------
test.describe("D-21 · cancelada, realizada o con el pago rechazado: sin lugar ni enlace", () => {
  test("una cancelada (el admin rechazó el pago) dice por qué y no muestra el lugar, aunque la franja lo tenga", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita({ estado: "cancelada", motivo: "pago_rechazado", pago: "rechazado" });

    await page.goto(`/cita?token=${cita.token}`);

    await expect(titulo(page, "Esta monitoría se canceló")).toBeVisible(ESPERA);
    await expect(page.getByText("No pudimos verificar tu pago, así que la monitoría se canceló y no hay reembolso.")).toBeVisible();
    await expect(dato(page, "Materia")).toHaveText(cita.materia);
    await expect(page.locator("dt", { hasText: /^Lugar$/ })).toHaveCount(0);
    expect(await page.content()).not.toContain(cita.lugar!);
    await expect(page.getByText("Puedes cancelarla")).toHaveCount(0);
    await expect(page.getByRole("link", { name: `Ver monitores de ${cita.materia}` })).toBeVisible();
    await expect(botonesDeCancelar(page)).toHaveCount(0);
  });

  test("una virtual cancelada por el Lead no muestra el enlace de la videollamada", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita({ modalidad: "virtual", estado: "cancelada", motivo: "estudiante", pago: "aprobado" });

    await page.goto(`/cita?token=${cita.token}`);

    await expect(titulo(page, "Esta monitoría se canceló")).toBeVisible(ESPERA);
    await expect(page.getByText("La cancelaste tú.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir la videollamada" })).toHaveCount(0);
    expect(await page.content()).not.toContain(cita.enlaceSesion!);
  });

  test("una realizada muestra el estado y el resumen, sin lugar", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita({ estado: "realizada", pago: "aprobado" });

    await page.goto(`/cita?token=${cita.token}`);

    await expect(titulo(page, "Tu monitoría se realizó")).toBeVisible(ESPERA);
    await expect(dato(page, "Monitor")).toHaveText(cita.monitor.nombre);
    expect(await page.content()).not.toContain(cita.lugar!);
    await expect(page.locator("dt", { hasText: /^Lugar$/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: `Ver monitores de ${cita.materia}` })).toBeVisible();
  });

  test("con el pago rechazado, aunque la cita siga confirmada un momento, la página deja de mostrar el lugar", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita({ pago: "rechazado" });

    await page.goto(`/cita?token=${cita.token}`);

    await expect(titulo(page, TITULO_CONFIRMADA)).toBeVisible(ESPERA);
    await expect(page.getByText("No pudimos verificar tu pago.")).toBeVisible();
    await expect(page.locator("dt", { hasText: /^Lugar$/ })).toHaveCount(0);
    expect(await page.content()).not.toContain(cita.lugar!);
  });
});

// ---------------------------------------------------------------------------
// Criterio 4 · el mismo navegador abre la cita sin el enlace
// ---------------------------------------------------------------------------
test.describe("Criterio 4 · el mismo navegador con el que agendó", () => {
  test("Mis citas, desde el pie, lista las suyas y cada una abre su detalle; la reserva lleva a la cita; otra sesión o sin sesión recibe 404 y una lista vacía", async ({
    page,
    browser,
    escenario,
  }, testInfo) => {
    const sesion = await abrirPublica(page, escenario);
    const lead = await escenario.lead(sesion.id);
    const confirmada = await escenario.cita({ idLead: lead.id });
    const porPagar = await escenario.cita({ idLead: lead.id, estado: "pendiente_pago" });
    const ajena = await escenario.cita();

    await test.step("el pie de página trae Mis citas y lleva a la lista del navegador", async () => {
      const enPie = page.getByRole("contentinfo").getByRole("link", { name: "Mis citas" });
      await expect(enPie).toBeVisible();
      await enPie.click();
      await expect(page).toHaveURL(/\/cita$/, ESPERA);
      await expect(titulo(page, "Mis citas")).toBeVisible(ESPERA);
      await expectNoIndexNiReferer(page, "mis citas");
    });

    await test.step("la lista trae la cita confirmada de este navegador; no la que sigue por pagar ni la de otro Lead", async () => {
      const tarjetas = page.locator("main ul > li");
      await expect(tarjetas).toHaveCount(1);
      await expect(tarjetas.first()).toContainText(confirmada.materia);
      await expect(tarjetas.first()).toContainText(`Con ${confirmada.monitor.nombre}`);
      await expect(tarjetas.first()).toContainText("Confirmada");
      const texto = await textoVisible(page);
      for (const otra of [porPagar.materia, ajena.materia]) expect(texto).not.toContain(otra);
      await expectReglasDelProducto(page, "Mis citas");
    });

    await test.step("abrirla muestra la misma cita que el enlace del correo, con un camino de vuelta a la lista", async () => {
      await page.locator("main ul > li a").first().click();
      await expect(page).toHaveURL(new RegExp(`/cita/${confirmada.id}$`), ESPERA);
      await expect(titulo(page, TITULO_CONFIRMADA)).toBeVisible(ESPERA);
      await expect(page).toHaveTitle("Tu cita · Calibra");
      await expect(dato(page, "Materia")).toHaveText(confirmada.materia);
      await expect(dato(page, "Lugar")).toHaveText(confirmada.lugar!);
      await expect(page.getByText(TEXTO_PAGO_EN_REVISION)).toBeVisible();
      await expect(botonCancelar(page)).toBeVisible();
      await expectNoIndexNiReferer(page, "detalle de mi cita");
      await expectReglasDelProducto(page, "detalle de mi cita");
      await page.getByRole("link", { name: "Ver mis citas" }).click();
      await expect(page).toHaveURL(/\/cita$/, ESPERA);
    });

    await test.step("desde la reserva confirmada, «Ver y gestionar mi cita» lleva a la cita", async () => {
      await page.goto(`/agendar/reserva/${confirmada.id}`);
      const enlace = page.getByRole("link", { name: "Ver y gestionar mi cita" });
      await expect(enlace).toBeVisible(ESPERA);
      await enlace.click();
      await expect(page).toHaveURL(new RegExp(`/cita/${confirmada.id}$`), ESPERA);
      await expect(titulo(page, TITULO_CONFIRMADA)).toBeVisible(ESPERA);
    });

    await test.step("una reserva que sigue por pagar no es todavía una cita: /cita/[id] la manda a su reserva", async () => {
      await page.goto(`/cita/${porPagar.id}`);
      await expect(page).toHaveURL(new RegExp(`/agendar/reserva/${porPagar.id}$`), ESPERA);
    });

    await test.step("la cita de otro Lead no se abre desde esta sesión: 404 sin dato alguno", async () => {
      const respuesta = await page.goto(`/cita/${ajena.id}`);
      expect(respuesta?.status()).toBe(404);
      await expect(titulo(page, TITULO_NO_ENCONTRADA)).toBeVisible(ESPERA);
      expect(await page.content()).not.toContain(ajena.materia);
    });

    await test.step("otro navegador, con otra sesión anónima, recibe 404 y no ve la lista", async () => {
      const proyecto = testInfo.project.use;
      const otroContexto = await browser.newContext({
        baseURL: proyecto.baseURL,
        locale: "es-CO",
        timezoneId: "America/Bogota",
        viewport: page.viewportSize() ?? undefined,
      });
      try {
        const otraPagina = await otroContexto.newPage();
        await otraPagina.goto("/monitores");
        await otraPagina.waitForLoadState("networkidle");
        const otraSesion = await escenario.sesion(otroContexto);
        expect(otraSesion.id).not.toBe(sesion.id);

        const respuesta = await otraPagina.goto(`/cita/${confirmada.id}`);
        expect(respuesta?.status()).toBe(404);
        await expect(titulo(otraPagina, TITULO_NO_ENCONTRADA)).toBeVisible(ESPERA);
        expect(await otraPagina.content()).not.toContain(confirmada.materia);

        await otraPagina.goto("/cita");
        await expect(titulo(otraPagina, "Mis citas")).toBeVisible(ESPERA);
        await expect(otraPagina.getByText("No tienes citas en este navegador.", { exact: false })).toBeVisible();
        await expect(otraPagina.locator("main ul > li")).toHaveCount(0);
        // Con el enlace del correo, en cambio, cualquiera que lo tenga abre esa cita (sin ligarse a ella).
        await otraPagina.goto(`/cita?token=${confirmada.token}`);
        await expect(titulo(otraPagina, TITULO_CONFIRMADA)).toBeVisible(ESPERA);
        await otraPagina.goto("/cita");
        await expect(otraPagina.locator("main ul > li")).toHaveCount(0);
      } finally {
        await otroContexto.close();
      }
    });

    await test.step("sin ninguna sesión (no se crea una al abrir /cita): 404 y lista vacía", async () => {
      const sinSesion = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        locale: "es-CO",
        timezoneId: "America/Bogota",
        viewport: page.viewportSize() ?? undefined,
      });
      try {
        const nueva = await sinSesion.newPage();
        const altas = await sinAltaAnonima(nueva);
        const respuesta = await nueva.goto(`/cita/${confirmada.id}`);
        expect(respuesta?.status()).toBe(404);
        await expect(titulo(nueva, TITULO_NO_ENCONTRADA)).toBeVisible(ESPERA);
        await nueva.goto("/cita");
        await expect(nueva.getByText("No tienes citas en este navegador.", { exact: false })).toBeVisible(ESPERA);
        expect(leerSesion(await sinSesion.cookies())).toBeNull();
        expect(altas.intentos).toBe(0);
      } finally {
        await sinSesion.close();
      }
    });
  });

  test("una cuenta de monitor, aunque sea el monitor de la cita, no la abre por /cita/[id]: es 404", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const cita = await escenario.cita();

    await page.goto("/ingresar");
    await page.getByLabel("Correo").fill(cita.monitor.correo);
    await page.getByLabel("Contraseña").fill(cita.monitor.contrasena);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL("/monitor", ESPERA);

    const respuesta = await page.goto(`/cita/${cita.id}`);
    expect(respuesta?.status()).toBe(404);
    await expect(titulo(page, TITULO_NO_ENCONTRADA)).toBeVisible(ESPERA);
    await page.goto("/cita");
    await expect(page.getByText("No tienes citas en este navegador.", { exact: false })).toBeVisible(ESPERA);
  });
});

// ---------------------------------------------------------------------------
// D-24 · «Mis citas» en el pie de todas las páginas
// ---------------------------------------------------------------------------
test.describe("D-24 · Mis citas en el pie", () => {
  test("el pie lo trae en el inicio y en una página del enlace, visible para todos, y lleva a /cita", async ({ page }) => {
    await sinAltaAnonima(page);
    for (const ruta of ["/", "/privacidad", "/cita?token=" + randomBytes(32).toString("hex")]) {
      await page.goto(ruta);
      await expect(page.getByRole("contentinfo").getByRole("link", { name: "Mis citas" }), ruta).toBeVisible(ESPERA);
    }
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "Mis citas" }).click();
    await expect(page).toHaveURL(/\/cita$/, ESPERA);
    await expect(titulo(page, "Mis citas")).toBeVisible(ESPERA);
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (las mismas de resena.spec.ts)
// ---------------------------------------------------------------------------
test.describe("Reglas del producto en la cita", () => {
  test("con la cita presencial, la virtual, la cancelada y el enlace que no sirve a la vista, el texto mide 14 px o más, las áreas táctiles 44 px o más y no hay desbordamiento a 390 px ni en escritorio", async ({
    page,
    escenario,
  }) => {
    await sinAltaAnonima(page);
    const presencial = await escenario.cita();
    const virtual = await escenario.cita({ modalidad: "virtual" });
    const cancelada = await escenario.cita({ estado: "cancelada", motivo: "pago_rechazado", pago: "rechazado" });
    const sinPlazo = await escenario.cita({ ...enHoras(6) });

    await test.step("presencial, con el lugar y el plazo", async () => {
      await page.goto(`/cita?token=${presencial.token}`);
      await expect(titulo(page, TITULO_CONFIRMADA)).toBeVisible(ESPERA);
      await expect(dato(page, "Lugar")).toBeVisible();
      await expectReglasDelProducto(page, "cita presencial");
    });

    await test.step("virtual, con el enlace de la videollamada", async () => {
      await page.goto(`/cita?token=${virtual.token}`);
      await expect(page.getByRole("link", { name: "Abrir la videollamada" })).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "cita virtual");
    });

    await test.step("sin plazo para cancelar", async () => {
      await page.goto(`/cita?token=${sinPlazo.token}`);
      await expect(page.getByText("El plazo para cancelarla terminó el", { exact: false })).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "cita sin plazo");
    });

    await test.step("cancelada", async () => {
      await page.goto(`/cita?token=${cancelada.token}`);
      await expect(titulo(page, "Esta monitoría se canceló")).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "cita cancelada");
    });

    await test.step("Este enlace no sirve", async () => {
      await page.goto(`/cita?token=${randomBytes(32).toString("hex")}`);
      await expect(titulo(page, TITULO_NO_SIRVE)).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "enlace que no sirve");
    });

    await test.step("Mis citas, sin sesión (vacía)", async () => {
      await page.goto("/cita");
      await expect(titulo(page, "Mis citas")).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "mis citas vacía");
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
