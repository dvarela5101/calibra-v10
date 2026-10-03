import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { ZONA_HORARIA_NEGOCIO } from "../src/config/regional";
import { diaDelNegocio, formatearDia, formatearDiaConSemana, formatearFechaHora } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { enviarCredenciales, expect, test as base, variable, type Cuenta } from "./utilidades";

// HU-020: el admin asignado revisa un pago contra su comprobante, desde su bandeja. Corre contra el Supabase local
// (Auth, base y Storage), Mailpit y el servidor de Next con la configuración de .env.local (`npm run db:env`). Cada
// prueba crea y borra su propio admin (no el de la semilla: `registrar_pago` le asignaría los pagos al primer admin
// activo), otro admin que nunca entra, el monitor, la materia, la franja, el Lead, las monitorías y los pagos ya
// asignados, cada uno con su comprobante de verdad en el bucket (subido con la llave secreta).
//
// Cada prueba inicia una sola sesión: el Auth local deja 30 inicios cada 5 minutos para toda la suite.
//
// HU-077 (D-38): pasada la hora del asignado, cualquier admin activo revisa el pago. En esa prueba los pagos son del
// otro admin, que nunca entra, y entra el admin de la prueba. Los pagos vencidos de otros admins los ven todos en la
// bandeja, así que cada prueba busca los suyos por el nombre del pagador.

const ESPERA = { timeout: 20_000 };
const MINUTO_MS = 60_000;
/** RN-42: la hora que tiene el admin asignado para revisar un pago, desde que se le asignó. */
const HORA_DE_REVISION_MS = 60 * MINUTO_MS;
const PRECIO = 32_000;

// Un PNG de 2x2 que el navegador sí pinta: la prueba abre el comprobante y mira que la imagen cargue.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGOQ96uU96tkgFAAF84Dme90BVkAAAAASUVORK5CYII=", "base64");

/** Lo que anota el admin al rechazar el pago de una monitoría que ya se realizó (P-24). */
const OBSERVACIONES = "Se cobra por fuera: el pagador vuelve a transferir esta semana.";

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

/** Texto con los espacios duros (los pesos y la hora los llevan) como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s+/g, " ");

const clave = (idPago: string) => `pago_rechazado_individual:${idPago}`;

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Materia = { id: string; nombre: string; codigo: string };
type Pago = { id: string; ruta: string; nombrePagador: string; contacto: string; asignadoEn: Date };
type FilaDePago = { estado: string; fecha_revision: string | null; observaciones: string | null; id_admin: string; id_admin_revisor: string | null };
type FilaDeMonitoria = { estado: string; motivo_cancelacion: string | null };

type Escenario = {
  /** El admin de la prueba: el único que entra, y a quien se le asignan los pagos. */
  admin: Cuenta;
  /** Otro admin activo, que nunca entra. */
  otroAdmin: Cuenta;
  materia: Materia;
  monitor: Cuenta;
  /** La fecha de la franja en la semana `semana`: la 0 cae dentro de 2 días a las 10:00; una negativa, en el pasado. */
  fecha(semana: number): string;
  /** Una monitoría individual del Lead de la prueba, `confirmada` salvo que `extra` diga otra cosa. */
  monitoria(fecha: string, extra?: Record<string, unknown>): Promise<string>;
  /** Un pago en revisión asignado a `idAdmin` hace `haceMin` minutos, con su comprobante en el bucket. */
  pago(idMonitoria: string, datos: { idAdmin: string; haceMin: number; referencia?: string }): Promise<Pago>;
  leerPago(id: string): Promise<FilaDePago>;
  leerMonitoria(id: string): Promise<FilaDeMonitoria>;
  reembolsosDe(idPago: string): Promise<{ id: string }[]>;
  /** Lo que quedó en `correo_envio` del aviso de rechazo de un pago. */
  correosDe(idPago: string): Promise<{ estado: string; destinatario: string }[]>;
};

const test = base.extend<{ escenario: Escenario; visitante: Page }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const otroAdmin = await cuentas.crearAdmin();
    const monitor = await cuentas.crearMonitor();
    const creados = { materias: [] as string[], franjas: [] as string[], leads: [] as string[], pagos: [] as Pago[] };

    async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
      const { data, error } = await cliente.from(tabla).insert(fila).select("id").single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data.id as string;
    }

    async function leer<T>(consulta: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, contexto: string): Promise<T[]> {
      const { data, error } = await consulta;
      if (error) throw new Error(`${contexto}: ${error.message}`);
      return data ?? [];
    }

    async function una<T>(consulta: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, contexto: string): Promise<T> {
      const [fila] = await leer(consulta, contexto);
      if (!fila) throw new Error(`${contexto}: no existe`);
      return fila;
    }

    const materia: Materia = { id: "", nombre: `Materia e2e revisar ${randomUUID().slice(0, 6)}`, codigo: `E2E-${randomUUID().slice(0, 12)}` };
    materia.id = await insertar("materia", { nombre: materia.nombre, codigo: materia.codigo });
    creados.materias.push(materia.id);
    const { error: errorCertificado } = await cliente.from("certificado").insert({ id_monitor: monitor.id, id_materia: materia.id, id_admin: admin.id });
    if (errorCertificado) throw new Error(`insertar certificado: ${errorCertificado.message}`);
    const primera = sumarDias(hoy(), 2);
    const idFranja = await insertar("franja", {
      id_monitor: monitor.id,
      dia: diaIso(primera),
      hora: "10:00",
      duracion_min: 60,
      presencial: true,
      precio: PRECIO,
      lugar: "Salón e2e",
      enlace: null,
    });
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
      otroAdmin,
      materia,
      monitor,
      fecha: (semana) => sumarDias(primera, 7 * semana),
      monitoria: (fecha, extra = {}) =>
        insertar("monitoria", {
          id_franja: idFranja,
          id_monitor: monitor.id,
          id_materia: materia.id,
          id_lead: idLead,
          fecha,
          valor_total: PRECIO,
          estado: "confirmada",
          ...extra,
        }),
      async pago(idMonitoria, { idAdmin, haceMin, referencia }) {
        // Como lo deja HU-018: el archivo en la carpeta de una sesión, revisado (HU-059) y después el pago que lo usa.
        const ruta = `${randomUUID()}/${randomUUID()}.png`;
        const subida = await cliente.storage.from("comprobantes").upload(ruta, PNG, { contentType: "image/png", upsert: false });
        if (subida.error) throw new Error(`subir comprobante: ${subida.error.message}`);
        const nuevo: Pago = {
          id: "",
          ruta,
          nombrePagador: `Pagador e2e ${randomUUID().slice(0, 6)}`,
          // Un buzón propio en Mailpit: las pruebas corren en paralelo.
          contacto: `pagador-${randomUUID()}@calibra.test`,
          asignadoEn: new Date(Date.now() - haceMin * MINUTO_MS),
        };
        creados.pagos.push(nuevo);
        const { error } = await cliente.from("comprobante_revisado").insert({ ruta, tipo: "image/png" });
        if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
        nuevo.id = await insertar("pago", {
          id_monitoria: idMonitoria,
          monto: PRECIO,
          nombre_pagador: nuevo.nombrePagador,
          contacto: nuevo.contacto,
          id_admin: idAdmin,
          fecha_asignacion: nuevo.asignadoEn.toISOString(),
          comprobante: ruta,
          referencia_transferencia: referencia ?? null,
        });
        return nuevo;
      },
      leerPago: (id) =>
        una<FilaDePago>(cliente.from("pago").select("estado, fecha_revision, observaciones, id_admin, id_admin_revisor").eq("id", id), "leer pago"),
      leerMonitoria: (id) => una<FilaDeMonitoria>(cliente.from("monitoria").select("estado, motivo_cancelacion").eq("id", id), "leer monitoría"),
      reembolsosDe: (idPago) => leer<{ id: string }>(cliente.from("reembolso").select("id").eq("id_pago", idPago), "leer reembolsos"),
      correosDe: (idPago) =>
        leer<{ estado: string; destinatario: string }>(cliente.from("correo_envio").select("estado, destinatario").eq("clave", clave(idPago)), "leer correo_envio"),
    });

    // Limpieza, antes de que `cuentas` borre a los admins (pago.id_admin no cae en cascada) y al monitor: los correos
    // del rechazo (registro y buzón), los pagos, sus comprobantes (el Storage no deja borrar por SQL: con su API) y sus
    // revisados, las monitorías, el Lead, la franja, el certificado y la materia. Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    const pagos = creados.pagos.filter((p) => p.id);
    const rutas = creados.pagos.map((p) => p.ruta);
    if (pagos.length) {
      await borrar("correo_envio", cliente.from("correo_envio").delete().in("clave", pagos.map((p) => clave(p.id))));
      await borrar("pagos", cliente.from("pago").delete().in("id", pagos.map((p) => p.id)));
    }
    for (const { contacto } of creados.pagos) {
      await fetch(`${variable("MAILPIT_URL")}/api/v1/search?query=${encodeURIComponent(`to:"${contacto}"`)}`, { method: "DELETE" }).catch(
        (error: unknown) => fallos.push(`buzón de ${contacto}: ${String(error)}`),
      );
    }
    if (rutas.length) {
      const { error } = await cliente.storage.from("comprobantes").remove(rutas);
      if (error) fallos.push(`comprobantes del Storage: ${error.message}`);
      await borrar("comprobantes revisados", cliente.from("comprobante_revisado").delete().in("ruta", rutas));
    }
    await borrar("monitorías", cliente.from("monitoria").delete().in("id_franja", creados.franjas));
    await borrar("leads", cliente.from("lead").delete().in("id", creados.leads));
    await borrar("franjas", cliente.from("franja").delete().in("id", creados.franjas));
    await borrar("certificados", cliente.from("certificado").delete().eq("id_admin", admin.id));
    await borrar("materias", cliente.from("materia").delete().in("id", creados.materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },

  // Otro navegador sin sesión (sus propias cookies) que mira la lista pública de fechas libres. Sin alta anónima: no
  // gasta el cupo por IP del Auth.
  visitante: async ({ browser, baseURL, viewport }, entregar) => {
    const contexto = await browser.newContext({ baseURL, viewport, locale: "es-CO", timezoneId: ZONA_HORARIA_NEGOCIO });
    await contexto.route("**/auth/v1/signup", (ruta) => ruta.abort());
    await entregar(await contexto.newPage());
    await contexto.close();
  },
});

test.describe.configure({ mode: "default", timeout: 120_000 });

// Next tiene su propio role="alert" (el anunciador de rutas): se busca por el texto.
const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });
const aviso = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
const seccionPago = (page: Page) => page.getByRole("region", { name: "Pago", exact: true });
const seccionMonitoria = (page: Page) => page.getByRole("region", { name: "Monitoría", exact: true });
const pagosDeLaBandeja = (page: Page) => page.getByRole("region", { name: /Pagos por revisar/ });
// Los asignados al admin. Debajo, en la misma sección, pueden salir pagos vencidos de los admins de otras pruebas (HU-077).
const misPagosEnLaBandeja = (page: Page) => pagosDeLaBandeja(page).getByRole("list", { name: "Asignados a ti" });
const botonAprobar = (page: Page) => page.getByRole("button", { name: "Aprobar pago" });
const abrirRechazo = (page: Page) => page.locator("summary", { hasText: "Rechazar el pago" });
const botonRechazar = (page: Page) => page.getByRole("button", { name: "Sí, rechazar el pago" });
const tarjetaDe = (page: Page, nombre: string) => page.getByRole("region", { name: nombre });

/** El valor de una etiqueta (Pagador, Monto, Estado...) dentro de una sección de la revisión. */
const dato = (seccion: Locator, etiqueta: string): Locator =>
  seccion.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");

async function entrarComoAdmin(page: Page, admin: Cuenta) {
  await page.goto("/admin");
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  await enviarCredenciales(page, admin.correo, admin.contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
}

/** Desde la bandeja, la tarjeta del pago abre su revisión. */
async function abrirDesdeLaBandeja(page: Page, pago: Pago) {
  await pagosDeLaBandeja(page).getByRole("link", { name: new RegExp(pago.nombrePagador) }).click();
  await expect(page).toHaveURL(`/admin/pagos/${pago.id}`, ESPERA);
}

/** Los correos que llegaron a Mailpit para un destinatario, con su texto plano. */
async function buzonDe(destinatario: string): Promise<{ asunto: string; texto: string }[]> {
  const mailpit = variable("MAILPIT_URL");
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${destinatario}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string; Subject: string }[] };
  return Promise.all(
    (messages ?? []).map(async ({ ID, Subject }) => {
      const { Text } = (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as { Text: string };
      return { asunto: Subject, texto: normalizar(Text) };
    }),
  );
}

// ---------------------------------------------------------------------------
// Criterios 1, 2 y 6, y supuesto 1: abrir el pago, ver el comprobante y aprobarlo
// ---------------------------------------------------------------------------
test.describe("Criterios 1, 2 y 6 · el admin abre su pago, ve el comprobante y lo aprueba", () => {
  test("desde la bandeja ve los datos del pago, su monitoría y el tiempo que le queda; el comprobante se firma al tocarlo y carga; al aprobarlo sale de su bandeja; el pago de otro admin, dentro de su hora, lo ve sin acciones y con hasta cuándo es suyo; las páginas respetan las reglas del producto", async ({
    page,
    context,
    request,
    escenario,
  }) => {
    const { admin, otroAdmin, materia, monitor } = escenario;
    const fecha = escenario.fecha(0);
    const idCita = await escenario.monitoria(fecha);
    const suyo = await escenario.pago(idCita, { idAdmin: admin.id, haceMin: 15, referencia: "M-48213" });
    const ajeno = await escenario.pago(await escenario.monitoria(escenario.fecha(1)), { idAdmin: otroAdmin.id, haceMin: 5 });
    await entrarComoAdmin(page, admin);

    await test.step("en la bandeja está solo su pago, y la tarjeta abre la revisión", async () => {
      await expect(misPagosEnLaBandeja(page).getByRole("listitem")).toHaveCount(1);
      await expect(pagosDeLaBandeja(page)).not.toContainText(ajeno.nombrePagador);
      await abrirDesdeLaBandeja(page, suyo);
      await expect(titulo(page, "Revisar el pago")).toBeVisible(ESPERA);
    });

    await test.step("criterio 1: pagador, contacto, monto, referencia, estado, tiempo restante y la monitoría", async () => {
      const pago = seccionPago(page);
      await expect(dato(pago, "Pagador")).toHaveText(suyo.nombrePagador);
      await expect(dato(pago, "Contacto")).toHaveText(suyo.contacto);
      await expect(dato(pago, "Monto")).toHaveText(normalizar(formatearPesos(PRECIO)));
      await expect(dato(pago, "Referencia")).toHaveText("M-48213");
      await expect(dato(pago, "Estado")).toHaveText("En revisión");
      // Se le asignó hace 15 minutos: le quedan unos 45 de su hora (RN-42).
      await expect(dato(pago, "Tiempo para revisarlo")).toHaveText(/^Quedan (42|43|44|45) min$/);
      const monitoria = seccionMonitoria(page);
      await expect(dato(monitoria, "Materia")).toHaveText(materia.nombre);
      await expect(dato(monitoria, "Monitor")).toHaveText(monitor.nombre);
      await expect(dato(monitoria, "Fecha")).toHaveText(formatearDia(fecha));
      await expect(dato(monitoria, "Hora")).toHaveText("10:00 a 11:00");
      await expect(dato(monitoria, "Estado")).toHaveText("Confirmada");
      await expect(botonAprobar(page)).toBeVisible();
      await expect(abrirRechazo(page)).toBeVisible();
      await expectReglasDelProducto(page, "la revisión de un pago");
    });

    await test.step("criterio 6: el comprobante se firma al tocarlo, con un enlace de 60 s, y la imagen carga", async () => {
      // Al pintar la página no se firma nada: el enlace vencería si el admin tarda más de un minuto en abrirlo.
      expect(await page.content()).not.toContain("/storage/v1/object/sign/");
      const enlace = page.getByRole("link", { name: "Ver comprobante" });
      await expect(enlace).toHaveAttribute("href", `/admin/pagos/${suyo.id}/comprobante`);
      await expect(enlace).toHaveAttribute("target", "_blank");

      // El handler redirige al enlace firmado del archivo de este pago, que vence a los 60 s.
      const respuesta = await page.request.get(`/admin/pagos/${suyo.id}/comprobante`, { maxRedirects: 0 });
      expect(respuesta.status()).toBe(307);
      const destino = new URL(respuesta.headers()["location"] ?? "");
      expect(`${destino.origin}${destino.pathname}`).toBe(`${variable("NEXT_PUBLIC_SUPABASE_URL")}/storage/v1/object/sign/comprobantes/${suyo.ruta}`);
      const token = destino.searchParams.get("token") ?? "";
      const firma = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { url: string; iat: number; exp: number };
      expect(firma.url).toBe(`comprobantes/${suyo.ruta}`);
      expect(firma.exp - firma.iat).toBe(60);

      // Sin sesión no se firma: lleva a ingresar y de ahí vuelve al pago.
      const sinSesion = await request.get(`/admin/pagos/${suyo.id}/comprobante`, { maxRedirects: 0 });
      expect(sinSesion.status()).toBe(307);
      expect(sinSesion.headers()["location"]).toMatch(new RegExp(`/ingresar\\?siguiente=${encodeURIComponent(`/admin/pagos/${suyo.id}`)}$`));

      // En el navegador se abre en otra pestaña, con la imagen del comprobante.
      const [pestana] = await Promise.all([context.waitForEvent("page"), enlace.click()]);
      await pestana.waitForLoadState("load");
      expect(pestana.url()).toMatch(new RegExp(`/storage/v1/object/sign/comprobantes/${suyo.ruta}\\?token=`));
      const imagen = await pestana.evaluate(() => {
        const img = document.querySelector("img");
        return { cargada: img?.complete ?? false, ancho: img?.naturalWidth ?? 0 };
      });
      expect(imagen, "la imagen del comprobante se pinta").toEqual({ cargada: true, ancho: 2 });
      await pestana.close();
    });

    await test.step("criterio 2: lo aprueba; queda aprobado con su fecha de revisión y la monitoría no cambia", async () => {
      await botonAprobar(page).click();
      await expect(aviso(page, "Aprobaste el pago.")).toHaveText("Aprobaste el pago. Ya no aparece en tu bandeja.", ESPERA);
      await expect(titulo(page, "Pago aprobado")).toBeVisible();
      await expect(botonAprobar(page)).toHaveCount(0);
      await expect(abrirRechazo(page)).toHaveCount(0);

      const fila = await escenario.leerPago(suyo.id);
      expect(fila.estado).toBe("aprobado");
      expect(fila.fecha_revision).not.toBeNull();
      await expect(dato(seccionPago(page), "Estado")).toHaveText("Aprobado");
      await expect(dato(seccionPago(page), "Revisado")).toHaveText(normalizar(formatearFechaHora(new Date(fila.fecha_revision!))));
      await expect(dato(seccionMonitoria(page), "Estado")).toHaveText("Confirmada");
      expect(await escenario.leerMonitoria(idCita)).toEqual({ estado: "confirmada", motivo_cancelacion: null });
      expect(await escenario.correosDe(suyo.id)).toEqual([]);
      await expectReglasDelProducto(page, "el pago aprobado");
    });

    await test.step("vuelve a su bandeja: el pago ya no está", async () => {
      await page.getByRole("link", { name: "Volver a mi bandeja" }).click();
      await expect(page).toHaveURL("/admin", ESPERA);
      await expect(page.getByRole("navigation", { name: "Resumen de tu bandeja" }).getByRole("link", { name: "0 Pagos por revisar" })).toBeVisible();
      await expect(page.getByText("No tienes pagos por revisar.")).toBeVisible();
    });

    await test.step("supuesto 1, dentro de la hora del otro admin (HU-077, criterio 2): su pago se ve con sus datos y hasta cuándo es suyo, pero sin acciones", async () => {
      await page.goto(`/admin/pagos/${ajeno.id}`);
      await expect(titulo(page, "Revisar el pago")).toBeVisible(ESPERA);
      await expect(dato(seccionPago(page), "Pagador")).toHaveText(ajeno.nombrePagador);
      await expect(dato(seccionPago(page), "Referencia")).toHaveText("Sin referencia");
      // HU-077 (criterio 2): dentro de la hora del asignado, también hasta cuándo es suyo. La hora lleva espacios duros.
      const hasta = formatearFechaHora(new Date(ajeno.asignadoEn.getTime() + HORA_DE_REVISION_MS));
      await expect(
        page.getByText(
          normalizar(`Este pago está asignado a ${otroAdmin.nombre} hasta el ${hasta} Si para entonces no lo ha revisado, podrás aprobarlo o rechazarlo tú.`),
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Ver comprobante" })).toBeVisible();
      await expect(botonAprobar(page)).toHaveCount(0);
      await expect(abrirRechazo(page)).toHaveCount(0);
      await expect(page.locator("form")).toHaveCount(0);
      expect((await escenario.leerPago(ajeno.id)).estado).toBe("en_revision");
      await expectReglasDelProducto(page, "el pago de otro admin");
    });
  });
});

// ---------------------------------------------------------------------------
// Criterios 3, 5 y 7: rechazar
// ---------------------------------------------------------------------------
test.describe("Criterios 3, 5 y 7 · el admin rechaza un pago", () => {
  test("rechazar pide confirmar y dice qué pasa; cancela la cita, libera la fecha y avisa al pagador por correo, sin reembolso; si la monitoría ya se realizó, exige observaciones y no la cancela (P-24)", async ({
    page,
    escenario,
    visitante,
  }) => {
    const { admin, materia, monitor } = escenario;
    const fecha = escenario.fecha(0);
    const idCita = await escenario.monitoria(fecha);
    const porCancelar = await escenario.pago(idCita, { idAdmin: admin.id, haceMin: 20 });
    // Se realizó la semana pasada (P-24).
    const pasada = escenario.fecha(-1);
    const idRealizada = await escenario.monitoria(pasada, { estado: "realizada", fecha_finalizacion: `${pasada}T16:30:00+00:00` });
    const deRealizada = await escenario.pago(idRealizada, { idAdmin: admin.id, haceMin: 10 });

    const fechasLibres = tarjetaDe(visitante, monitor.nombre).getByRole("listitem");
    await test.step("antes: la fecha de la cita no sale libre en la lista pública de la materia", async () => {
      await visitante.goto(`/monitores?materia=${encodeURIComponent(materia.codigo)}`);
      await expect(fechasLibres).toHaveCount(3, ESPERA);
      await expect(tarjetaDe(visitante, monitor.nombre)).not.toContainText(formatearDiaConSemana(fecha));
    });

    await entrarComoAdmin(page, admin);

    await test.step("abre el pago desde la bandeja: el rechazo está cerrado hasta que lo pide, y dice qué va a pasar", async () => {
      await expect(misPagosEnLaBandeja(page).getByRole("listitem")).toHaveCount(2);
      await abrirDesdeLaBandeja(page, porCancelar);
      await expect(titulo(page, "Revisar el pago")).toBeVisible(ESPERA);
      await expect(botonRechazar(page)).toBeHidden();
      await expectReglasDelProducto(page, "la revisión con el rechazo cerrado");

      await abrirRechazo(page).click();
      await expect(botonRechazar(page)).toBeVisible();
      await expect(
        page.getByText(
          `Se cancela la monitoría del ${formatearDia(fecha)} y esa fecha queda libre para otra persona. Un pago rechazado no se reembolsa. Le avisamos a ${porCancelar.nombrePagador} por correo, a ${porCancelar.contacto}.`,
        ),
      ).toBeVisible();
      await expect(page.getByLabel("Observaciones (opcionales)")).toBeEditable();
      await expectReglasDelProducto(page, "la revisión con el rechazo abierto");
    });

    await test.step("criterios 3 y 5: confirma; el pago queda rechazado, la cita cancelada por el pago y no hay reembolso", async () => {
      await botonRechazar(page).click();
      await expect(aviso(page, "Rechazaste el pago.")).toHaveText(
        "Rechazaste el pago. Ya no aparece en tu bandeja. Le avisamos al pagador por correo.",
        ESPERA,
      );
      await expect(titulo(page, "Pago rechazado")).toBeVisible();
      await expect(dato(seccionPago(page), "Estado")).toHaveText("Rechazado");
      await expect(dato(seccionMonitoria(page), "Estado")).toHaveText("Cancelada: el pago fue rechazado");
      await expect(page.locator("form")).toHaveCount(0);

      const fila = await escenario.leerPago(porCancelar.id);
      expect(fila).toMatchObject({ estado: "rechazado", observaciones: null });
      expect(fila.fecha_revision).not.toBeNull();
      expect(await escenario.leerMonitoria(idCita)).toEqual({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });
      expect(await escenario.reembolsosDe(porCancelar.id)).toEqual([]);
      await expectReglasDelProducto(page, "el pago rechazado");
    });

    await test.step("la reserva dice que se canceló y la fecha vuelve a la lista pública", async () => {
      await page.goto(`/agendar/reserva/${idCita}`);
      await expect(titulo(page, "Esta reserva se canceló")).toBeVisible(ESPERA);

      await visitante.reload();
      await expect(fechasLibres).toHaveCount(4, ESPERA);
      await expect(fechasLibres.first()).toContainText(formatearDiaConSemana(fecha));
    });

    await test.step("criterio 3: al pagador le llega un solo correo, a su contacto", async () => {
      await expect.poll(async () => (await buzonDe(porCancelar.contacto)).length, { timeout: 30_000 }).toBe(1);
      const [correo] = await buzonDe(porCancelar.contacto);
      expect(correo.asunto).toBe("No pudimos verificar tu pago y la monitoría se canceló");
      expect(correo.texto).toContain(`Hola, ${porCancelar.nombrePagador}`);
      expect(correo.texto).toContain(
        `No pudimos verificar tu pago de ${normalizar(formatearPesos(PRECIO))}, así que la monitoría del ${formatearDia(fecha)} quedó cancelada.`,
      );
      expect(correo.texto).toContain("Como el pago no se aprobó, no hay reembolso.");
      expect(await escenario.correosDe(porCancelar.id)).toEqual([{ estado: "enviado", destinatario: porCancelar.contacto }]);
    });

    await test.step("criterio 7 (P-24): con la monitoría ya realizada, sin observaciones no se rechaza", async () => {
      await page.goto("/admin");
      await expect(misPagosEnLaBandeja(page).getByRole("listitem")).toHaveCount(1, ESPERA);
      await abrirDesdeLaBandeja(page, deRealizada);
      await expect(dato(seccionMonitoria(page), "Estado")).toHaveText("Realizada", ESPERA);

      await abrirRechazo(page).click();
      await expect(
        page.getByText(
          "La monitoría ya se realizó, así que no se cancela y el pago queda fuera del desembolso del monitor. Un pago rechazado no se reembolsa y al pagador no le escribimos.",
        ),
      ).toBeVisible();
      await expect(page.getByText("Obligatorias: escribe qué se hará con ese cobro, si cobrarlo por fuera o asumirlo. Hasta 500 caracteres.")).toBeVisible();
      await expect(page.getByLabel("Observaciones", { exact: true })).toBeEditable();
      await expectReglasDelProducto(page, "el rechazo con observaciones obligatorias");

      await botonRechazar(page).click();
      await expect(alerta(page, "La sesión de esta monitoría ya empezó, así que no se cancela.")).toBeVisible(ESPERA);
      await expect(botonRechazar(page)).toBeVisible();
      expect((await escenario.leerPago(deRealizada.id)).estado).toBe("en_revision");
    });

    await test.step("criterio 7 (P-24): con observaciones, el pago queda rechazado, la monitoría sigue realizada y no se le escribe al pagador", async () => {
      await page.getByLabel("Observaciones", { exact: true }).fill(OBSERVACIONES);
      await botonRechazar(page).click();
      await expect(aviso(page, "Rechazaste el pago.")).toHaveText("Rechazaste el pago. Ya no aparece en tu bandeja.", ESPERA);
      await expect(dato(seccionPago(page), "Observaciones")).toHaveText(OBSERVACIONES);
      await expect(dato(seccionMonitoria(page), "Estado")).toHaveText("Realizada");

      expect(await escenario.leerPago(deRealizada.id)).toMatchObject({ estado: "rechazado", observaciones: OBSERVACIONES });
      expect(await escenario.leerMonitoria(idRealizada)).toEqual({ estado: "realizada", motivo_cancelacion: null });
      expect(await escenario.reembolsosDe(deRealizada.id)).toEqual([]);
      // El correo se manda antes de volver a la página: si saliera, ya estaría anotado.
      expect(await escenario.correosDe(deRealizada.id)).toEqual([]);
      expect(await buzonDe(deRealizada.contacto)).toEqual([]);

      await page.getByRole("link", { name: "Volver a mi bandeja" }).click();
      await expect(page).toHaveURL("/admin", ESPERA);
      await expect(page.getByText("No tienes pagos por revisar.")).toBeVisible();
    });
  });
});

// ---------------------------------------------------------------------------
// HU-077, criterios 1 y 3: pasada la hora del asignado, otro admin revisa el pago
// ---------------------------------------------------------------------------
test.describe("HU-077 · otro admin revisa un pago al que se le pasó la hora al asignado", () => {
  test("lo encuentra en su bandeja con de quién es y desde cuándo está vencido, ve que puede revisarlo, lo aprueba y queda él como revisor; el que sigue en hora no le sale", async ({
    page,
    escenario,
  }) => {
    const { admin, otroAdmin } = escenario;
    // Los dos pagos son del otro admin: uno se le venció hace 30 minutos (RN-42) y el otro todavía está en su hora.
    const idCita = await escenario.monitoria(escenario.fecha(0));
    const vencido = await escenario.pago(idCita, { idAdmin: otroAdmin.id, haceMin: 90 });
    const enHora = await escenario.pago(await escenario.monitoria(escenario.fecha(1)), { idAdmin: otroAdmin.id, haceMin: 20 });
    await entrarComoAdmin(page, admin);

    await test.step("supuesto 2: no tiene pagos suyos; debajo, el vencido del otro admin, con de quién es y desde cuándo; el que sigue en hora no", async () => {
      await expect(page.getByRole("navigation", { name: "Resumen de tu bandeja" }).getByRole("link", { name: "0 Pagos por revisar" })).toBeVisible(ESPERA);
      await expect(pagosDeLaBandeja(page).getByText("No tienes pagos por revisar.")).toBeVisible();
      const fila = pagosDeLaBandeja(page)
        .getByRole("list", { name: /Vencidos de otros admins/ })
        .getByRole("link", { name: new RegExp(vencido.nombrePagador) });
      await expect(fila).toContainText(normalizar(formatearPesos(PRECIO)));
      await expect(fila).toContainText(new RegExp(`De ${otroAdmin.nombre} · Vencido hace (30|31|32|33) min`));
      await expect(pagosDeLaBandeja(page)).not.toContainText(enHora.nombrePagador);
      await expectReglasDelProducto(page, "la bandeja con un pago vencido de otro admin");
      await abrirDesdeLaBandeja(page, vencido);
    });

    await test.step("criterio 1: la revisión dice que al asignado se le pasó la hora y le da las acciones", async () => {
      await expect(titulo(page, "Revisar el pago")).toBeVisible(ESPERA);
      const vencio = formatearFechaHora(new Date(vencido.asignadoEn.getTime() + HORA_DE_REVISION_MS));
      await expect(
        page.getByText(normalizar(`Este pago está asignado a ${otroAdmin.nombre}, pero se le pasó la hora el ${vencio} Puedes aprobarlo o rechazarlo tú.`), {
          exact: true,
        }),
      ).toBeVisible();
      await expect(dato(seccionPago(page), "Pagador")).toHaveText(vencido.nombrePagador);
      await expect(dato(seccionPago(page), "Tiempo para revisarlo")).toHaveText(/^Vencido hace (30|31|32|33) min$/);
      await expect(botonAprobar(page)).toBeVisible();
      await expect(abrirRechazo(page)).toBeVisible();
      await expectReglasDelProducto(page, "un pago vencido de otro admin");
    });

    await test.step("criterio 3: lo aprueba; queda él como revisor y el pago sigue asignado al otro admin (supuesto 4)", async () => {
      await botonAprobar(page).click();
      await expect(aviso(page, "Aprobaste el pago.")).toHaveText("Aprobaste el pago. Ya no aparece en tu bandeja.", ESPERA);
      await expect(titulo(page, "Pago aprobado")).toBeVisible();
      await expect(botonAprobar(page)).toHaveCount(0);
      await expect(abrirRechazo(page)).toHaveCount(0);

      const fila = await escenario.leerPago(vencido.id);
      expect(fila).toMatchObject({ estado: "aprobado", observaciones: null, id_admin: otroAdmin.id, id_admin_revisor: admin.id });
      expect(fila.fecha_revision).not.toBeNull();
      await expect(dato(seccionPago(page), "Estado")).toHaveText("Aprobado");
      await expect(dato(seccionPago(page), "Revisado")).toHaveText(normalizar(formatearFechaHora(new Date(fila.fecha_revision!))));
      await expect(dato(seccionPago(page), "Revisado por")).toHaveText(admin.nombre);
      await expect(dato(seccionPago(page), "Asignado a")).toHaveText(otroAdmin.nombre);
      expect(await escenario.leerMonitoria(idCita)).toEqual({ estado: "confirmada", motivo_cancelacion: null });
      expect(await escenario.correosDe(vencido.id)).toEqual([]);
      await expectReglasDelProducto(page, "el pago vencido ya aprobado");
    });

    await test.step("vuelve a su bandeja: el pago ya no está, y el que sigue en hora sigue en revisión con el otro admin", async () => {
      await page.getByRole("link", { name: "Volver a mi bandeja" }).click();
      await expect(page).toHaveURL("/admin", ESPERA);
      await expect(pagosDeLaBandeja(page).getByText("No tienes pagos por revisar.")).toBeVisible();
      await expect(pagosDeLaBandeja(page)).not.toContainText(vencido.nombrePagador);
      await expect(pagosDeLaBandeja(page)).not.toContainText(enHora.nombrePagador);
      expect(await escenario.leerPago(enHora.id)).toMatchObject({ estado: "en_revision", id_admin: otroAdmin.id, id_admin_revisor: null });
    });
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (copia de e2e/agendar.spec.ts, que además mide `summary` y
// `textarea`: esta página los tiene)
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
