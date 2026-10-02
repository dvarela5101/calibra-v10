import { randomUUID } from "node:crypto";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { diaDelNegocio } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { enviarCredenciales, esperarSesion, expect, test as base, variable, type Cuenta, type SesionEnCookie } from "./utilidades";

// HU-018: el Lead paga por Llave y adjunta el comprobante en la página de su reserva. Corre contra el Supabase local
// (Auth, base y Storage) y el servidor de Next con la configuración de prueba de .env.local (`npm run db:env`): llave,
// titular, QR y proveedor. Materias, monitores, franjas, Leads, reservas, pagos y comprobantes los crea y los borra
// cada prueba (códigos y correos únicos: las pruebas corren en paralelo y solo se afirma sobre lo propio).
//
// Cada navegador que abre una página pública gasta una sesión anónima (el Auth local limita cuántas por hora): cada
// prueba del Lead usa una sola, y la del monitor entra con su cuenta, sin sesión anónima.

const ESPERA = { timeout: 20_000 };
const MINUTO_MS = 60_000;
const PRECIO = 32_000;

// Un PNG mínimo: el Storage no mira el contenido; la app sí (la firma de los primeros bytes, HU-059).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

const EXPIRO = "La reserva expiró: ya no puedes adjuntar el comprobante.";

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

/** Texto con los espacios duros (los pesos los llevan) como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s/g, " ");

/** El valor que muestra el resumen para una etiqueta (Materia, Monitor, Valor...). */
const dato = (page: Page, etiqueta: string): Locator =>
  page.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Materia = { id: string; nombre: string; codigo: string };
type Franja = { id: string };
type FilaDeLead = { id: string; nombre: string; correo: string };
type FilaDePago = {
  id: string;
  monto: number;
  nombre_pagador: string;
  contacto: string;
  estado: string;
  id_admin: string;
  fecha_pago: string;
  fecha_asignacion: string;
  fecha_revision: string | null;
  comprobante: string;
};

type Escenario = {
  materia(): Promise<Materia>;
  monitor(): Promise<Cuenta>;
  certificar(idMonitor: string, idMateria: string): Promise<void>;
  /** Franja semanal que abre desde hoy el día de `fecha`, a las 10:00. */
  franja(idMonitor: string, fecha: string): Promise<Franja>;
  /** Espera la sesión anónima que el navegador recibe al abrir una página pública, y la borra al terminar. */
  sesion(context: BrowserContext): Promise<SesionEnCookie>;
  /** Hace Lead a una sesión, como si hubiera dejado su contacto al agendar (HU-068). Sin sesión, un Lead suelto. */
  lead(idSesion: string | null): Promise<FilaDeLead>;
  /** Una reserva `pendiente_pago` de ese Lead, creada con la llave secreta; `haceMs` corre su `fecha_creacion` hacia atrás. */
  apartar(franja: Franja, idMonitor: string, idMateria: string, fecha: string, idLead: string, haceMs?: number): Promise<string>;
  estadoDe(idMonitoria: string): Promise<string>;
  pagosDe(idMonitoria: string): Promise<FilaDePago[]>;
  esAdmin(id: string): Promise<boolean>;
};

const COLUMNAS_DE_PAGO = "id, monto, nombre_pagador, contacto, estado, id_admin, fecha_pago, fecha_asignacion, fecha_revision, comprobante";

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const creados = { materias: [] as string[], franjas: [] as string[], leads: [] as string[], sesiones: [] as string[] };

    async function leer<T>(consulta: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, contexto: string): Promise<T[]> {
      const { data, error } = await consulta;
      if (error) throw new Error(`${contexto}: ${error.message}`);
      return data ?? [];
    }

    await entregar({
      async materia() {
        const nombre = `Materia e2e pagar ${randomUUID().slice(0, 6)}`;
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
      async franja(idMonitor, fecha) {
        const { data, error } = await cliente
          .from("franja")
          .insert({ id_monitor: idMonitor, dia: diaIso(fecha), hora: "10:00", duracion_min: 60, presencial: true, precio: PRECIO, lugar: "Salón e2e", enlace: null })
          .select("id")
          .single();
        if (error) throw new Error(`insertar franja: ${error.message}`);
        creados.franjas.push(data.id as string);
        return { id: data.id as string };
      },
      async sesion(context) {
        const sesion = await esperarSesion(context);
        cuentas.borrarAlFinal(sesion.id);
        creados.sesiones.push(sesion.id);
        return sesion;
      },
      async lead(idSesion) {
        const { data, error } = await cliente
          .from("lead")
          .insert({
            id_sesion_anonima: idSesion,
            nombre: `Lead e2e ${randomUUID().slice(0, 6)}`,
            correo: `e2e-${randomUUID()}@calibra.test`,
            acepta_tratamiento_datos: true,
            fecha_consentimiento: new Date().toISOString(),
          })
          .select("id, nombre, correo")
          .single();
        if (error) throw new Error(`insertar lead: ${error.message}`);
        creados.leads.push(data.id as string);
        return data as FilaDeLead;
      },
      async apartar(franja, idMonitor, idMateria, fecha, idLead, haceMs) {
        const { data, error } = await cliente
          .from("monitoria")
          .insert({
            id_franja: franja.id,
            id_monitor: idMonitor,
            id_materia: idMateria,
            id_lead: idLead,
            fecha,
            valor_total: PRECIO,
            estado: "pendiente_pago",
            ...(haceMs ? { fecha_creacion: new Date(Date.now() - haceMs).toISOString() } : {}),
          })
          .select("id")
          .single();
        if (error) throw new Error(`insertar monitoria: ${error.message}`);
        return data.id as string;
      },
      async estadoDe(idMonitoria) {
        const [fila] = await leer<{ estado: string }>(cliente.from("monitoria").select("estado").eq("id", idMonitoria), "leer monitoría");
        return fila?.estado ?? "no existe";
      },
      pagosDe: (idMonitoria) => leer<FilaDePago>(cliente.from("pago").select(COLUMNAS_DE_PAGO).eq("id_monitoria", idMonitoria), "leer pagos"),
      async esAdmin(id) {
        return (await leer<{ id: string }>(cliente.from("admin").select("id").eq("id", id), "leer admin")).length === 1;
      },
    });

    // Limpieza, antes de que `cuentas` borre a los monitores, al admin y a las sesiones. De lo que depende hacia lo
    // demás: pagos (no caen con la monitoría), comprobantes (el Storage no deja borrar por SQL: con su API, toda la
    // carpeta de cada sesión, haya pago o no), sus revisados, monitorías (sus avisos al monitor caen con ellas),
    // Leads, franjas, certificados y materias. Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    const monitorias = creados.franjas.length
      ? (await leer<{ id: string }>(cliente.from("monitoria").select("id").in("id_franja", creados.franjas), "buscar monitorías")).map((m) => m.id)
      : [];
    const rutas = new Set<string>();
    if (monitorias.length) {
      const pagos = await leer<{ comprobante: string }>(cliente.from("pago").select("comprobante").in("id_monitoria", monitorias), "buscar pagos");
      for (const { comprobante } of pagos) rutas.add(comprobante);
      await borrar("pagos", cliente.from("pago").delete().in("id_monitoria", monitorias));
    }
    for (const sesion of creados.sesiones) {
      const { data, error } = await cliente.storage.from("comprobantes").list(sesion, { limit: 100 });
      if (error) fallos.push(`listar comprobantes de ${sesion}: ${error.message}`);
      for (const archivo of data ?? []) rutas.add(`${sesion}/${archivo.name}`);
    }
    if (rutas.size) {
      const { error } = await cliente.storage.from("comprobantes").remove([...rutas]);
      if (error) fallos.push(`comprobantes del Storage: ${error.message}`);
      await borrar("comprobantes revisados", cliente.from("comprobante_revisado").delete().in("ruta", [...rutas]));
    }
    if (monitorias.length) await borrar("monitorías", cliente.from("monitoria").delete().in("id", monitorias));
    if (creados.leads.length) await borrar("leads", cliente.from("lead").delete().in("id", creados.leads));
    if (creados.franjas.length) await borrar("franjas", cliente.from("franja").delete().in("id", creados.franjas));
    await borrar("certificados", cliente.from("certificado").delete().eq("id_admin", admin.id));
    if (creados.materias.length) await borrar("materias", cliente.from("materia").delete().in("id", creados.materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 120_000 });

// Next tiene su propio role="alert" (el anunciador de rutas): se busca por el texto.
const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });
const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
const pago = (page: Page) => page.getByRole("region", { name: /^Paga .+ por Llave$/ });
const botonEnviar = (page: Page) => page.getByRole("button", { name: "Enviar comprobante" });
const campoComprobante = (page: Page) => page.getByLabel("Comprobante de la transferencia");

/** Abre una página y espera a que termine de cargar e hidratarse: los formularios y la sesión anónima llegan después. */
async function abrir(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta);
  await page.waitForLoadState("networkidle");
}

/** Lo que casi toda prueba necesita: una materia con un monitor certificado y una franja dentro de dos días. */
async function montar(escenario: Escenario) {
  const fecha = sumarDias(hoy(), 2);
  const materia = await escenario.materia();
  const monitor = await escenario.monitor();
  await escenario.certificar(monitor.id, materia.id);
  const franja = await escenario.franja(monitor.id, fecha);
  return { fecha, materia, monitor, franja };
}

/**
 * Abre una página pública, espera la sesión anónima que nace en el navegador y la vuelve Lead (la primera visita
 * corre sin sesión). Después cada prueba abre su reserva, que el servidor ya ve como del Lead.
 */
async function entrarComoLead(page: Page, escenario: Escenario) {
  await abrir(page, "/monitores");
  const sesion = await escenario.sesion(page.context());
  const lead = await escenario.lead(sesion.id);
  return { sesion, lead };
}

// ---------------------------------------------------------------------------
// Criterios 1 y 5 (RN-40): lo que ve el Lead antes de pagar
// ---------------------------------------------------------------------------
test.describe("Criterios 1 y 5 · el Lead ve cómo pagar su reserva", () => {
  test("ve el valor, a quién le paga, el tiempo que le queda, el QR y la llave de la configuración, y la copia con el botón; la página respeta las reglas del producto", async ({
    page,
    context,
    escenario,
  }) => {
    const { fecha, materia, monitor, franja } = await montar(escenario);
    const { lead } = await entrarComoLead(page, escenario);
    const idReserva = await escenario.apartar(franja, monitor.id, materia.id, fecha, lead.id);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await abrir(page, `/agendar/reserva/${idReserva}`);
    await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
    const llave = variable("LLAVE_PLATAFORMA");

    await test.step("el resumen de arriba y el pago: valor, proveedor y tiempo restante", async () => {
      await expect(dato(page, "Valor")).toHaveText(normalizar(formatearPesos(PRECIO)));
      await expect(pago(page).getByRole("heading", { level: 2 })).toHaveText(normalizar(`Paga ${formatearPesos(PRECIO)} por Llave`));
      await expect(pago(page).getByText(/^Le pagas a /)).toHaveText(
        new RegExp(`^Le pagas a ${escapar(variable("PROVEEDOR_NOMBRE"))}, documento ${escapar(variable("PROVEEDOR_DOCUMENTO"))}\\.`),
      );
      // Recién apartada (RN-34, 10 minutos). No se fija la cifra: la reserva nace con el reloj de la base.
      await expect(page.getByRole("timer")).toHaveText(/^Quedan \d{1,2} min para enviar el comprobante\.$/);
      // P-36: nadie escribe el monto.
      await expect(page.getByLabel(/monto|valor/i)).toHaveCount(0);
    });

    await test.step("el QR y la llave salen de la configuración de la plataforma (criterio 5)", async () => {
      const qr = pago(page).getByRole("img", { name: `Código QR para transferir a la llave ${llave}, de ${variable("LLAVE_PLATAFORMA_TITULAR")}` });
      await expect(qr).toBeVisible();
      await expect(qr).toHaveAttribute("src", variable("LLAVE_PLATAFORMA_QR_URL"));
      expect(await qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), "el QR se pudo pintar").toBe(true);
      const campo = pago(page).getByLabel("Llave", { exact: true });
      await expect(campo).toHaveValue(llave);
      await expect(campo).not.toBeEditable();
      await expect(pago(page).getByText(`Titular de la llave: ${variable("LLAVE_PLATAFORMA_TITULAR")}`)).toBeVisible();
    });

    await test.step("copiar deja la llave en el portapapeles y lo anuncia", async () => {
      await pago(page).getByRole("button", { name: "Copiar llave" }).click();
      await expect(pago(page).getByRole("status")).toHaveText("Copiada.");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(llave);
    });

    await test.step("el formulario trae prellenados el nombre y el correo del Lead", async () => {
      await expect(page.getByLabel("Tu nombre")).toHaveValue(lead.nombre);
      await expect(page.getByLabel("Tu correo")).toHaveValue(lead.correo);
      await expect(campoComprobante(page)).toHaveAttribute("accept", "image/jpeg,image/png,application/pdf");
      await expect(botonEnviar(page)).toBeEnabled();
    });

    await expectReglasDelProducto(page, "el pago de la reserva");
  });
});

// ---------------------------------------------------------------------------
// Criterios 2, 3, 6 y 7: adjuntar el comprobante crea el pago y confirma la monitoría
// ---------------------------------------------------------------------------
test.describe("Criterios 2, 3, 6 y 7 · adjuntar el comprobante", () => {
  test("sin archivo o con un correo inválido no sube nada; con el comprobante se crea un pago en revisión por el valor de la reserva, asignado a un admin, y la monitoría queda confirmada", async ({
    page,
    escenario,
  }) => {
    const { fecha, materia, monitor, franja } = await montar(escenario);
    const { sesion, lead } = await entrarComoLead(page, escenario);
    const idReserva = await escenario.apartar(franja, monitor.id, materia.id, fecha, lead.id);
    await abrir(page, `/agendar/reserva/${idReserva}`);
    await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
    await expect(page.getByLabel("Tu nombre")).toHaveValue(lead.nombre);
    await expect(page.getByLabel("Tu correo")).toHaveValue(lead.correo);

    await test.step("sin archivo, o con un correo que no es correo, lo dice y no crea nada", async () => {
      await botonEnviar(page).click();
      await expect(alerta(page, "Elige la captura o el PDF del comprobante")).toBeVisible(ESPERA);

      await campoComprobante(page).setInputFiles({ name: "comprobante.png", mimeType: "image/png", buffer: PNG });
      await page.getByLabel("Tu correo").fill("no-es-un-correo");
      await botonEnviar(page).click();
      await expect(alerta(page, "Escribe un correo válido")).toBeVisible(ESPERA);
      expect(await escenario.pagosDe(idReserva)).toEqual([]);
      await page.getByLabel("Tu correo").fill(lead.correo);
    });

    const antes = Date.now();
    await test.step("con el comprobante: la página queda confirmada y dice que lo recibimos", async () => {
      await botonEnviar(page).click();
      await expect(titulo(page, "Tu monitoría está confirmada")).toBeVisible(ESPERA);
      await expect(page.getByRole("status").filter({ hasText: "Recibimos tu comprobante de pago." })).toBeVisible();
      await expect(botonEnviar(page)).toHaveCount(0);
      await expect(pago(page)).toHaveCount(0);
      expect(page.url()).toMatch(new RegExp(`/agendar/reserva/${idReserva}$`));
    });

    await test.step("en la base: un solo pago en revisión, por el valor de la reserva, con el admin y la fecha de asignación, y la monitoría confirmada (RN-38)", async () => {
      const pagos = await escenario.pagosDe(idReserva);
      expect(pagos).toHaveLength(1);
      const [creado] = pagos;
      expect(creado).toMatchObject({ estado: "en_revision", monto: PRECIO, nombre_pagador: lead.nombre, contacto: lead.correo, fecha_revision: null });
      // Criterio 7: el comprobante está en la carpeta de la sesión que pagó.
      expect(creado.comprobante).toMatch(new RegExp(`^${sesion.id}/[0-9a-f-]{36}\\.png$`));
      expect(await escenario.esAdmin(creado.id_admin), "el pago queda asignado a un admin").toBe(true);
      // La hora la pone la base: se admite un margen por si su reloj y el de la máquina no coinciden al segundo.
      expect(Date.parse(creado.fecha_asignacion)).toBeGreaterThan(antes - MINUTO_MS);
      expect(creado.fecha_asignacion).toBe(creado.fecha_pago);
      expect(await escenario.estadoDe(idReserva)).toBe("confirmada");
    });
  });

  test("si la llamada al servidor falla (la red, un despliegue), el formulario sigue en pie y el reintento usa el comprobante ya subido", async ({
    page,
    escenario,
  }) => {
    const { fecha, materia, monitor, franja } = await montar(escenario);
    const { lead } = await entrarComoLead(page, escenario);
    const idReserva = await escenario.apartar(franja, monitor.id, materia.id, fecha, lead.id);
    await abrir(page, `/agendar/reserva/${idReserva}`);
    await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);

    // Cuántas veces sube el navegador un comprobante al Storage (cada subida gasta una de las 5 del día).
    let subidas = 0;
    page.on("request", (pedido) => {
      if (pedido.method() === "POST" && pedido.url().includes("/storage/v1/object/comprobantes/")) subidas += 1;
    });
    // La acción del servidor es un POST a la misma página con el encabezado next-action: se corta la red.
    const ruta = `**/agendar/reserva/${idReserva}`;
    await page.route(ruta, (pedido) =>
      pedido.request().method() === "POST" && pedido.request().headers()["next-action"] ? pedido.abort("internetdisconnected") : pedido.continue(),
    );

    await test.step("sin respuesta del servidor: lo dice, no tumba la página y no hay pago", async () => {
      await campoComprobante(page).setInputFiles({ name: "comprobante.png", mimeType: "image/png", buffer: PNG });
      await botonEnviar(page).click();
      await expect(alerta(page, "No pudimos comunicarnos con Calibra")).toBeVisible(ESPERA);
      await expect(titulo(page, "Apartamos tu fecha")).toBeVisible();
      await expect(botonEnviar(page)).toBeEnabled();
      expect(subidas).toBe(1);
      expect(await escenario.pagosDe(idReserva)).toEqual([]);
    });

    await test.step("vuelve la red: el reintento confirma sin subir otra vez el comprobante", async () => {
      await page.unroute(ruta);
      await botonEnviar(page).click();
      await expect(titulo(page, "Tu monitoría está confirmada")).toBeVisible(ESPERA);
      expect(subidas).toBe(1);
      expect(await escenario.pagosDe(idReserva)).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 4 (RN-34): la reserva vencida ya no recibe el comprobante
// ---------------------------------------------------------------------------
test.describe("Criterio 4 · la reserva vencida", () => {
  test("una reserva de hace 11 minutos dice que expiró y no trae formulario; una que vence con la página abierta deja de ofrecerlo", async ({ page, escenario }) => {
    const { fecha, materia, monitor, franja } = await montar(escenario);
    const { lead } = await entrarComoLead(page, escenario);

    await test.step("apartada hace 11 minutos", async () => {
      const idVencida = await escenario.apartar(franja, monitor.id, materia.id, fecha, lead.id, 11 * MINUTO_MS);
      await abrir(page, `/agendar/reserva/${idVencida}`);
      await expect(titulo(page, "Tu reserva venció")).toBeVisible(ESPERA);
      await expect(page.getByText(EXPIRO)).toBeVisible();
      await expect(botonEnviar(page)).toHaveCount(0);
      await expect(campoComprobante(page)).toHaveCount(0);
      await expect(pago(page)).toHaveCount(0);
      expect(await page.content()).not.toContain(variable("LLAVE_PLATAFORMA"));
      await expectReglasDelProducto(page, "la reserva vencida");
    });

    await test.step("le quedan 25 segundos: el contador llega a cero y la página ya no trae el formulario", async () => {
      // Otra fecha de la misma franja: la vencida sigue ocupando la suya hasta que HU-027 la cancele.
      const idCasiVencida = await escenario.apartar(franja, monitor.id, materia.id, sumarDias(fecha, 7), lead.id, 10 * MINUTO_MS - 25_000);
      await abrir(page, `/agendar/reserva/${idCasiVencida}`);
      await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
      await expect(page.getByRole("timer")).toHaveText("Queda menos de 1 min para enviar el comprobante.");
      await expect(botonEnviar(page)).toBeVisible();

      // El contador mira cada 15 s: a los 30 s ya venció y pide la página de nuevo.
      await expect(titulo(page, "Tu reserva venció")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText(EXPIRO)).toBeVisible();
      await expect(botonEnviar(page)).toHaveCount(0);
      expect(await escenario.pagosDe(idCasiVencida)).toEqual([]);
    });

    await test.step("se va a ver monitores y vuelve con Atrás después de que venció: la página no revive el formulario", async () => {
      // Next reutiliza la página al volver con Atrás; el contador no puede seguir desde la hora de entonces.
      const idOtra = await escenario.apartar(franja, monitor.id, materia.id, sumarDias(fecha, 14), lead.id, 10 * MINUTO_MS - 12_000);
      await abrir(page, `/agendar/reserva/${idOtra}`);
      await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
      await expect(botonEnviar(page)).toBeVisible();
      await page.getByRole("link", { name: /^Ver monitores de/ }).click();
      await expect(page).toHaveURL(/\/monitores/, ESPERA);
      await page.waitForTimeout(15_000);
      await page.goBack();
      // Sin esperar al siguiente tick de 15 s: al reaparecer, la página se pide de nuevo.
      await expect(titulo(page, "Tu reserva venció")).toBeVisible({ timeout: 8_000 });
      await expect(botonEnviar(page)).toHaveCount(0);
      expect(await escenario.pagosDe(idOtra)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Solo el Lead paga: su monitor ve la reserva sin el pago
// ---------------------------------------------------------------------------
test.describe("Solo paga el Lead", () => {
  test("el monitor de la reserva la abre con su cuenta: ve la reserva, pero ni la llave ni el formulario", async ({ page, escenario }) => {
    const { fecha, materia, monitor, franja } = await montar(escenario);
    const lead = await escenario.lead(null);
    const idReserva = await escenario.apartar(franja, monitor.id, materia.id, fecha, lead.id);

    await page.goto("/monitor");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fmonitor", ESPERA);
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);

    await abrir(page, `/agendar/reserva/${idReserva}`);
    await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
    await expect(dato(page, "Materia")).toHaveText(materia.nombre);
    await expect(pago(page)).toHaveCount(0);
    await expect(botonEnviar(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copiar llave" })).toHaveCount(0);
    expect(await page.content()).not.toContain(variable("LLAVE_PLATAFORMA"));
  });
});

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (copia de e2e/agendar.spec.ts)
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
