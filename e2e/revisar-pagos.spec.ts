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
// HU-034 (D-56): bandeja común. Cualquier admin activo revisa cualquier pago desde que llega, sea quien sea el
// responsable. En esas pruebas los pagos son del otro admin, que nunca entra, y entra el admin de la prueba. Los pagos
// de otros admins los ven todos en la bandeja y la tarjeta cuenta los de las pruebas que corren en paralelo, así que
// no se espera un total exacto: se mira la lista «Asignados a ti» (exacta) y los demás pagos se buscan por el nombre
// del pagador.

const ESPERA = { timeout: 20_000 };
const MINUTO_MS = 60_000;
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
const claveSinReembolso = (idPago: string) => `pago_rechazado_sin_reembolso:${idPago}`;

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Materia = { id: string; nombre: string; codigo: string };
type Pago = { id: string; ruta: string; nombrePagador: string; contacto: string; llegoEn: Date };
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
  /** Un pago en revisión de `idAdmin` que llegó hace `haceMin` minutos (`fecha_pago`), con su comprobante en el bucket. */
  pago(idMonitoria: string, datos: { idAdmin: string; haceMin: number; referencia?: string }): Promise<Pago>;
  leerPago(id: string): Promise<FilaDePago>;
  leerMonitoria(id: string): Promise<FilaDeMonitoria>;
  reembolsosDe(idPago: string): Promise<{ id: string }[]>;
  /** Lo que quedó en `correo_envio` de los avisos de rechazo de un pago (el de la cita cancelada y el de «no hay reembolso»). */
  correosDe(idPago: string): Promise<{ estado: string; destinatario: string }[]>;
  /** HU-076: la fila de la bandeja de salida del pagador que la base anota al rechazar el pago (cae en cascada con el pago). */
  avisosDeRechazo(idPago: string): Promise<{ caso: string; procesado_en: string | null }[]>;
  /** HU-076: los eventos que la base anotó para avisarle al monitor de esa monitoría. */
  avisosAlMonitor(idMonitoria: string): Promise<string[]>;
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
          llegoEn: new Date(Date.now() - haceMin * MINUTO_MS),
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
          // La bandeja ordena por cuándo llegó el pago, y la base lo pone en now(): se fija a mano (HU-034).
          fecha_pago: nuevo.llegoEn.toISOString(),
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
        leer<{ estado: string; destinatario: string }>(
          cliente.from("correo_envio").select("estado, destinatario").in("clave", [clave(idPago), claveSinReembolso(idPago)]),
          "leer correo_envio",
        ),
      avisosDeRechazo: (idPago) =>
        leer<{ caso: string; procesado_en: string | null }>(cliente.from("aviso_rechazo_pago").select("caso, procesado_en").eq("id_pago", idPago), "leer aviso_rechazo_pago"),
      avisosAlMonitor: async (idMonitoria) =>
        (await leer<{ evento: string }>(cliente.from("aviso_monitor").select("evento").eq("id_monitoria", idMonitoria).order("creado_en"), "leer aviso_monitor")).map(
          (a) => a.evento,
        ),
    });

    // Limpieza, antes de que `cuentas` borre a los admins (pago.id_admin no cae en cascada) y al monitor: los correos
    // del rechazo (registro y buzón; la fila de la bandeja de salida cae en cascada con el pago), los pagos, sus comprobantes (el Storage no deja borrar por SQL: con su API) y sus
    // revisados, las monitorías, el Lead, la franja, el certificado y la materia. Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    const pagos = creados.pagos.filter((p) => p.id);
    const rutas = creados.pagos.map((p) => p.ruta);
    if (pagos.length) {
      await borrar("correo_envio", cliente.from("correo_envio").delete().in("clave", pagos.flatMap((p) => [clave(p.id), claveSinReembolso(p.id)])));
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
// Los asignados al admin (la lista no sale si no tiene ninguno). Debajo, en la misma sección, salen «De otros admins»,
// con los pagos de los admins de otras pruebas (HU-034).
const misPagosEnLaBandeja = (page: Page) => pagosDeLaBandeja(page).getByRole("list", { name: "Asignados a ti" });
const pagosDeOtrosEnLaBandeja = (page: Page) => pagosDeLaBandeja(page).getByRole("list", { name: /^De otros admins/ });
/** La fila de un pago de otro admin en la bandeja, buscada por el nombre del pagador. */
const filaDeOtro = (page: Page, pago: Pago) => pagosDeOtrosEnLaBandeja(page).getByRole("link", { name: new RegExp(pago.nombrePagador) });
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
  test("desde la bandeja ve los datos del pago, su monitoría, quién es el responsable y cuándo llegó; el comprobante se firma al tocarlo y carga; al aprobarlo sale de su bandeja; el pago de otro admin, recién llegado, lo ve con sus acciones y la línea de a quién le toca; las páginas respetan las reglas del producto", async ({
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

    await test.step("en la bandeja está su pago entre los asignados a él, el del otro admin aparte, y la tarjeta abre la revisión", async () => {
      await expect(misPagosEnLaBandeja(page).getByRole("listitem")).toHaveCount(1);
      await expect(misPagosEnLaBandeja(page)).toContainText(suyo.nombrePagador);
      await expect(misPagosEnLaBandeja(page)).not.toContainText(ajeno.nombrePagador);
      await expect(misPagosEnLaBandeja(page)).toContainText(/Llegó hace (1[5-9]|2\d) min/);
      // El del otro admin sale en «De otros admins», no en la lista propia, con de quién es y hace cuánto llegó (HU-034).
      await expect(filaDeOtro(page, ajeno)).toContainText(new RegExp(`De ${otroAdmin.nombre} · Llegó hace ([5-9]|1\\d) min`));
      await abrirDesdeLaBandeja(page, suyo);
      await expect(titulo(page, "Revisar el pago")).toBeVisible(ESPERA);
    });

    await test.step("criterio 1: pagador, contacto, monto, referencia, estado, responsable, cuándo llegó y la monitoría", async () => {
      const pago = seccionPago(page);
      await expect(dato(pago, "Pagador")).toHaveText(suyo.nombrePagador);
      await expect(dato(pago, "Contacto")).toHaveText(suyo.contacto);
      await expect(dato(pago, "Monto")).toHaveText(normalizar(formatearPesos(PRECIO)));
      await expect(dato(pago, "Referencia")).toHaveText("M-48213");
      await expect(dato(pago, "Estado")).toHaveText("En revisión");
      // Es el responsable y el pago llegó hace 15 minutos (HU-034): no hay plazo, ni hora del asignado, ni línea de a quién le toca.
      await expect(dato(pago, "Responsable")).toHaveText(admin.nombre);
      await expect(dato(pago, "Llegó")).toHaveText(/^hace (15|16|17|18|19|20) min$/);
      await expect(pago.locator("dt", { hasText: /^Tiempo para revisarlo$/ })).toHaveCount(0);
      await expect(page.getByText(/Este pago le toca a/)).toHaveCount(0);
      await expect(page.getByText(/Este pago está asignado a/)).toHaveCount(0);
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

    await test.step("vuelve a su bandeja: el pago ya no está entre los suyos", async () => {
      await page.getByRole("link", { name: "Volver a mi bandeja" }).click();
      await expect(page).toHaveURL("/admin", ESPERA);
      // Ya no tiene pagos asignados: la lista propia no sale. La tarjeta suma los de todos (los de otras pruebas también).
      await expect(pagosDeLaBandeja(page)).toBeVisible(ESPERA);
      await expect(misPagosEnLaBandeja(page)).toHaveCount(0);
      await expect(pagosDeLaBandeja(page)).not.toContainText(suyo.nombrePagador);
      await expect(page.getByRole("navigation", { name: "Resumen de tu bandeja" }).getByRole("link", { name: /^\d+ Pagos por revisar$/ })).toBeVisible();
    });

    await test.step("criterio 9 (HU-034): el pago de otro admin, recién llegado, se ve con sus datos, quién es el responsable, cuándo llegó y las acciones desde el primer minuto", async () => {
      await page.goto(`/admin/pagos/${ajeno.id}`);
      await expect(titulo(page, "Revisar el pago")).toBeVisible(ESPERA);
      await expect(dato(seccionPago(page), "Pagador")).toHaveText(ajeno.nombrePagador);
      await expect(dato(seccionPago(page), "Referencia")).toHaveText("Sin referencia");
      await expect(dato(seccionPago(page), "Responsable")).toHaveText(otroAdmin.nombre);
      await expect(dato(seccionPago(page), "Llegó")).toHaveText(/^hace ([5-9]|1\d) min$/);
      await expect(
        page.getByText(`Este pago le toca a ${otroAdmin.nombre} según el orden de revisión. Puedes aprobarlo o rechazarlo tú.`, { exact: true }),
      ).toBeVisible();
      // Ya no hay hora del asignado ni «hasta cuándo es suyo».
      await expect(page.getByText(/Este pago está asignado a/)).toHaveCount(0);
      await expect(page.getByText(/hasta el/)).toHaveCount(0);
      await expect(seccionPago(page).locator("dt", { hasText: /^Tiempo para revisarlo$/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Ver comprobante" })).toBeVisible();
      await expect(botonAprobar(page)).toBeVisible();
      await expect(abrirRechazo(page)).toBeVisible();
      expect((await escenario.leerPago(ajeno.id)).estado).toBe("en_revision");
      await expectReglasDelProducto(page, "el pago de otro admin");
    });
  });
});

// ---------------------------------------------------------------------------
// Criterios 3, 5 y 7: rechazar
// ---------------------------------------------------------------------------
test.describe("Criterios 3, 5 y 7 · el admin rechaza un pago", () => {
  test("rechazar pide confirmar y dice qué pasa; cancela la cita, libera la fecha y deja anotados los avisos al pagador y al monitor, sin reembolso; si la monitoría ya se realizó, exige observaciones, no la cancela y no anota ningún aviso (P-24)", async ({
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
          `Se cancela la monitoría del ${formatearDia(fecha)} y esa fecha queda libre para otra persona. Un pago rechazado no se reembolsa. Le avisaremos a ${porCancelar.nombrePagador} por correo, a ${porCancelar.contacto}. También le avisaremos al monitor.`,
        ),
      ).toBeVisible();
      await expect(page.getByLabel("Observaciones (opcionales)")).toBeEditable();
      await expectReglasDelProducto(page, "la revisión con el rechazo abierto");
    });

    await test.step("criterios 3 y 5: confirma; el pago queda rechazado, la cita cancelada por el pago y no hay reembolso", async () => {
      await botonRechazar(page).click();
      await expect(aviso(page, "Rechazaste el pago.")).toHaveText(
        "Rechazaste el pago. Ya no aparece en tu bandeja. Le avisaremos al pagador por correo en unos minutos.",
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

    await test.step("HU-076, criterio 4: la base anotó con el rechazo la fila del pagador y el aviso del monitor; el correo no sale en la acción", async () => {
      expect(await escenario.avisosDeRechazo(porCancelar.id)).toEqual([{ caso: "cita_cancelada", procesado_en: null }]);
      expect(await escenario.avisosAlMonitor(idCita)).toEqual(["pago_rechazado"]);
      // La base local no tiene Vault (pg_cron no llama a los procesos) y los recorridos de HU-048, los únicos que llaman
      // /api/procesos/* con el CRON_SECRETO de prueba, corren después de este proyecto: nadie corrió el proceso.
      expect(await escenario.correosDe(porCancelar.id)).toEqual([]);
      expect(await buzonDe(porCancelar.contacto)).toEqual([]);
    });

    await test.step("criterio 7 (P-24): con la monitoría ya realizada, sin observaciones no se rechaza", async () => {
      await page.goto("/admin");
      await expect(misPagosEnLaBandeja(page).getByRole("listitem")).toHaveCount(1, ESPERA);
      await abrirDesdeLaBandeja(page, deRealizada);
      await expect(dato(seccionMonitoria(page), "Estado")).toHaveText("Realizada", ESPERA);

      await abrirRechazo(page).click();
      await expect(
        page.getByText(
          // HU-078 (D-39): el caso queda por cobrar o asumir y cuenta en el desembolso cuando alguien lo cierra.
          "La monitoría ya se realizó, así que no se cancela y el caso queda en «Pagos por cobrar o asumir»: el pago cuenta en el desembolso del monitor solo cuando alguien lo cierre como cobrado o asumido. Un pago rechazado no se reembolsa y al pagador no le escribimos.",
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
      // HU-078, criterio 5: el pago no sale de la bandeja, pasa a la sección de los casos.
      await expect(aviso(page, "Rechazaste el pago.")).toHaveText(
        "Rechazaste el pago. El caso quedó en «Pagos por cobrar o asumir» de la bandeja hasta que alguien lo cierre como cobrado o asumido.",
        ESPERA,
      );
      await expect(dato(seccionPago(page), "Observaciones")).toHaveText(OBSERVACIONES);
      await expect(dato(seccionMonitoria(page), "Estado")).toHaveText("Realizada");

      expect(await escenario.leerPago(deRealizada.id)).toMatchObject({ estado: "rechazado", observaciones: OBSERVACIONES });
      expect(await escenario.leerMonitoria(idRealizada)).toEqual({ estado: "realizada", motivo_cancelacion: null });
      expect(await escenario.reembolsosDe(deRealizada.id)).toEqual([]);
      // HU-076, criterio 6: la base no anota aviso para el pagador ni para el monitor, y el correo no sale.
      expect(await escenario.avisosDeRechazo(deRealizada.id)).toEqual([]);
      expect(await escenario.avisosAlMonitor(idRealizada)).toEqual([]);
      expect(await escenario.correosDe(deRealizada.id)).toEqual([]);
      expect(await buzonDe(deRealizada.contacto)).toEqual([]);

      await page.getByRole("link", { name: "Volver a mi bandeja" }).click();
      await expect(page).toHaveURL("/admin", ESPERA);
      // Ya no le toca ninguno: la lista «Asignados a ti» no sale. La tarjeta y el título suman los pagos de todos los
      // admins (HU-034), así que no se espera «No hay pagos por revisar.» ni un total exacto. El caso rechazado ya no está
      // en «Pagos por revisar»: pasó a «Pagos por cobrar o asumir».
      await expect(pagosDeLaBandeja(page)).toBeVisible(ESPERA);
      await expect(misPagosEnLaBandeja(page)).toHaveCount(0);
      await expect(pagosDeLaBandeja(page)).not.toContainText(deRealizada.nombrePagador);
    });
  });
});

// ---------------------------------------------------------------------------
// HU-076, criterio 5: rechazar el pago de una cita que el estudiante ya canceló
// ---------------------------------------------------------------------------
test.describe("HU-076 · el admin rechaza el pago de una cita que el estudiante ya canceló", () => {
  test("dice que solo cambia el pago y que se le avisa al pagador que no hay reembolso; la cita no cambia, no hay reembolso, queda anotada la fila «cita ya cancelada» y el monitor no recibe aviso del pago", async ({
    page,
    escenario,
  }) => {
    const { admin } = escenario;
    const fecha = escenario.fecha(1);
    const idCita = await escenario.monitoria(fecha, { estado: "cancelada", motivo_cancelacion: "estudiante" });
    const pago = await escenario.pago(idCita, { idAdmin: admin.id, haceMin: 10 });
    await entrarComoAdmin(page, admin);

    await test.step("antes: la revisión dice que la monitoría ya estaba cancelada y a quién se le avisa", async () => {
      await abrirDesdeLaBandeja(page, pago);
      await expect(titulo(page, "Revisar el pago")).toBeVisible(ESPERA);
      await expect(dato(seccionMonitoria(page), "Estado")).toHaveText("Cancelada: la canceló el estudiante");

      await abrirRechazo(page).click();
      await expect(
        page.getByText(
          `La monitoría ya estaba cancelada: solo cambia el pago. Un pago rechazado no se reembolsa. Le avisaremos a ${pago.nombrePagador} por correo, a ${pago.contacto}, que no hay reembolso.`,
        ),
      ).toBeVisible();
      await expect(page.getByText("También le avisaremos al monitor.")).toHaveCount(0);
      await expectReglasDelProducto(page, "el rechazo de una cita ya cancelada");
    });

    await test.step("confirma: el pago queda rechazado y la página promete el correo en unos minutos", async () => {
      await botonRechazar(page).click();
      await expect(aviso(page, "Rechazaste el pago.")).toHaveText(
        "Rechazaste el pago. Ya no aparece en tu bandeja. Le avisaremos al pagador por correo en unos minutos.",
        ESPERA,
      );
      await expect(titulo(page, "Pago rechazado")).toBeVisible();
      await expect(dato(seccionPago(page), "Estado")).toHaveText("Rechazado");
      await expect(dato(seccionMonitoria(page), "Estado")).toHaveText("Cancelada: la canceló el estudiante");
      await expectReglasDelProducto(page, "el pago rechazado de una cita ya cancelada");
    });

    await test.step("en la base: la cita sigue igual, sin reembolso, con la fila para el correo «no hay reembolso» y sin aviso al monitor", async () => {
      expect(await escenario.leerPago(pago.id)).toMatchObject({ estado: "rechazado", observaciones: null });
      expect(await escenario.leerMonitoria(idCita)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
      expect(await escenario.reembolsosDe(pago.id)).toEqual([]);
      expect(await escenario.avisosDeRechazo(pago.id)).toEqual([{ caso: "cita_ya_cancelada", procesado_en: null }]);
      expect(await escenario.avisosAlMonitor(idCita)).toEqual([]);
      expect(await escenario.correosDe(pago.id)).toEqual([]);
      expect(await buzonDe(pago.contacto)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// HU-034, criterios 8 y 9: cualquier admin activo revisa cualquier pago desde que llega
// ---------------------------------------------------------------------------
test.describe("HU-034 · otro admin revisa un pago que le toca a otro desde que llega", () => {
  test("los encuentra en su bandeja con de quién son y hace cuánto llegaron, el más antiguo arriba; abre el que lleva más de una hora, ve que puede revisarlo, lo aprueba y queda él como revisor; el otro sigue en revisión con su responsable", async ({
    page,
    escenario,
  }) => {
    const { admin, otroAdmin } = escenario;
    // Los dos pagos son del otro admin: uno llegó hace 90 minutos y el otro hace 20. Ninguno está «vencido» ni «en hora»:
    // los dos se pueden revisar ya (D-56).
    const idCita = await escenario.monitoria(escenario.fecha(0));
    const antiguo = await escenario.pago(idCita, { idAdmin: otroAdmin.id, haceMin: 90 });
    const reciente = await escenario.pago(await escenario.monitoria(escenario.fecha(1)), { idAdmin: otroAdmin.id, haceMin: 20 });
    await entrarComoAdmin(page, admin);

    await test.step("no tiene pagos suyos; debajo, los dos del otro admin, con de quién son y hace cuánto llegaron, el más antiguo arriba", async () => {
      // La tarjeta suma los pagos de todos los admins (los dos de esta prueba y los de las otras): sin total exacto.
      const tarjeta = page.getByRole("navigation", { name: "Resumen de tu bandeja" }).getByRole("link", { name: /^\d+ Pagos por revisar$/ });
      await expect(tarjeta).toBeVisible(ESPERA);
      expect(Number((await tarjeta.textContent())!.match(/\d+/)![0])).toBeGreaterThanOrEqual(2);
      await expect(misPagosEnLaBandeja(page)).toHaveCount(0);
      await expect(pagosDeLaBandeja(page).getByRole("heading", { level: 3, name: /^De otros admins \(\d+\)$/ })).toBeVisible();

      await expect(filaDeOtro(page, antiguo)).toContainText(normalizar(formatearPesos(PRECIO)));
      await expect(filaDeOtro(page, antiguo)).toContainText(new RegExp(`De ${otroAdmin.nombre} · Llegó hace 1 h 3\\d min`));
      await expect(filaDeOtro(page, reciente)).toContainText(new RegExp(`De ${otroAdmin.nombre} · Llegó hace 2\\d min`));
      await expect(pagosDeOtrosEnLaBandeja(page).getByText(/Quedan|Vencido/)).toHaveCount(0);
      const filas = await pagosDeOtrosEnLaBandeja(page).getByRole("listitem").allTextContents();
      const posicion = (pago: Pago) => filas.findIndex((texto) => texto.includes(pago.nombrePagador));
      expect(posicion(antiguo)).toBeGreaterThanOrEqual(0);
      expect(posicion(antiguo)).toBeLessThan(posicion(reciente));
      await expectReglasDelProducto(page, "la bandeja con pagos de otro admin");
      await filaDeOtro(page, antiguo).click();
      await expect(page).toHaveURL(`/admin/pagos/${antiguo.id}`, ESPERA);
    });

    await test.step("criterio 9: la revisión dice de quién es y cuándo llegó, y le da las acciones aunque lleve más de una hora", async () => {
      await expect(titulo(page, "Revisar el pago")).toBeVisible(ESPERA);
      await expect(
        page.getByText(`Este pago le toca a ${otroAdmin.nombre} según el orden de revisión. Puedes aprobarlo o rechazarlo tú.`, { exact: true }),
      ).toBeVisible();
      await expect(dato(seccionPago(page), "Pagador")).toHaveText(antiguo.nombrePagador);
      await expect(dato(seccionPago(page), "Responsable")).toHaveText(otroAdmin.nombre);
      await expect(dato(seccionPago(page), "Llegó")).toHaveText(/^hace 1 h 3\d min$/);
      await expect(seccionPago(page).locator("dt", { hasText: /^Tiempo para revisarlo$/ })).toHaveCount(0);
      await expect(page.getByText(/Este pago está asignado a|se le pasó la hora/)).toHaveCount(0);
      await expect(botonAprobar(page)).toBeVisible();
      await expect(abrirRechazo(page)).toBeVisible();
      await expectReglasDelProducto(page, "un pago de otro admin con más de una hora");
    });

    await test.step("criterio 1: lo aprueba; queda él como revisor y el pago sigue con el otro admin como responsable", async () => {
      await botonAprobar(page).click();
      await expect(aviso(page, "Aprobaste el pago.")).toHaveText("Aprobaste el pago. Ya no aparece en tu bandeja.", ESPERA);
      await expect(titulo(page, "Pago aprobado")).toBeVisible();
      await expect(botonAprobar(page)).toHaveCount(0);
      await expect(abrirRechazo(page)).toHaveCount(0);

      const fila = await escenario.leerPago(antiguo.id);
      expect(fila).toMatchObject({ estado: "aprobado", observaciones: null, id_admin: otroAdmin.id, id_admin_revisor: admin.id });
      expect(fila.fecha_revision).not.toBeNull();
      await expect(dato(seccionPago(page), "Estado")).toHaveText("Aprobado");
      await expect(dato(seccionPago(page), "Revisado")).toHaveText(normalizar(formatearFechaHora(new Date(fila.fecha_revision!))));
      await expect(dato(seccionPago(page), "Revisado por")).toHaveText(admin.nombre);
      await expect(dato(seccionPago(page), "Responsable")).toHaveText(otroAdmin.nombre);
      await expect(seccionPago(page).locator("dt", { hasText: /^Asignado a$/ })).toHaveCount(0);
      expect(await escenario.leerMonitoria(idCita)).toEqual({ estado: "confirmada", motivo_cancelacion: null });
      expect(await escenario.correosDe(antiguo.id)).toEqual([]);
      await expectReglasDelProducto(page, "el pago de otro admin ya aprobado");
    });

    await test.step("vuelve a su bandeja: el aprobado ya no está, y el otro sigue en revisión con su responsable", async () => {
      await page.getByRole("link", { name: "Volver a mi bandeja" }).click();
      await expect(page).toHaveURL("/admin", ESPERA);
      await expect(filaDeOtro(page, reciente)).toBeVisible(ESPERA);
      await expect(pagosDeLaBandeja(page)).not.toContainText(antiguo.nombrePagador);
      expect(await escenario.leerPago(reciente.id)).toMatchObject({ estado: "en_revision", id_admin: otroAdmin.id, id_admin_revisor: null });
    });
  });

  test("el admin B abre el pago recién creado del admin A, ve a quién le toca, lo aprueba, y A lo ve aprobado por B con él como responsable; antes, la bandeja de B lo lista en «De otros admins» con «Llegó hace …» desde el primer minuto", async ({
    page,
    browser,
    baseURL,
    viewport,
    escenario,
  }) => {
    // El pago es del admin A (`otroAdmin`) y acaba de llegar. B es el admin de la prueba. Cada uno entra en su navegador.
    const { admin: adminB, otroAdmin: adminA } = escenario;
    const idCita = await escenario.monitoria(escenario.fecha(0));
    const nuevo = await escenario.pago(idCita, { idAdmin: adminA.id, haceMin: 0 });
    const contextoDeA = await browser.newContext({ baseURL, viewport, locale: "es-CO", timezoneId: ZONA_HORARIA_NEGOCIO });
    try {
      const paginaDeA = await contextoDeA.newPage();

      await test.step("A entra y lo tiene entre los asignados a él, con cuánto lleva esperando y sin «De …»", async () => {
        await entrarComoAdmin(paginaDeA, adminA);
        const fila = misPagosEnLaBandeja(paginaDeA).getByRole("listitem").filter({ hasText: nuevo.nombrePagador });
        await expect(fila).toHaveCount(1);
        await expect(fila).toContainText(/Llegó hace (menos de 1 min|[1-3] min)/);
        await expect(fila).not.toContainText(/\bDe /);
      });

      await entrarComoAdmin(page, adminB);

      await test.step("antes de aprobarlo: la bandeja de B lo lista en «De otros admins» con «Llegó hace …» desde el primer minuto", async () => {
        await expect(misPagosEnLaBandeja(page)).toHaveCount(0);
        await expect(pagosDeLaBandeja(page).getByRole("heading", { level: 3, name: /^De otros admins \(\d+\)$/ })).toBeVisible(ESPERA);
        const fila = filaDeOtro(page, nuevo);
        await expect(fila).toContainText(normalizar(formatearPesos(PRECIO)));
        await expect(fila).toContainText(new RegExp(`De ${adminA.nombre} · Llegó hace (menos de 1 min|[1-3] min)`));
        await expect(fila).not.toContainText(/Quedan|Vencido/);
        await expectReglasDelProducto(page, "la bandeja con un pago recién llegado de otro admin");
        await fila.click();
        await expect(page).toHaveURL(`/admin/pagos/${nuevo.id}`, ESPERA);
      });

      await test.step("B abre el pago y ve la línea «Este pago le toca a …»; tiene las acciones aunque no sea el responsable", async () => {
        await expect(titulo(page, "Revisar el pago")).toBeVisible(ESPERA);
        await expect(
          page.getByText(`Este pago le toca a ${adminA.nombre} según el orden de revisión. Puedes aprobarlo o rechazarlo tú.`, { exact: true }),
        ).toBeVisible();
        await expect(dato(seccionPago(page), "Responsable")).toHaveText(adminA.nombre);
        await expect(dato(seccionPago(page), "Llegó")).toHaveText(/^hace (menos de 1 min|[1-3] min)$/);
        await expect(botonAprobar(page)).toBeVisible();
        await expect(abrirRechazo(page)).toBeVisible();
        await expectReglasDelProducto(page, "un pago recién llegado de otro admin");
      });

      await test.step("B lo aprueba y queda como revisor; el responsable sigue siendo A", async () => {
        await botonAprobar(page).click();
        await expect(aviso(page, "Aprobaste el pago.")).toHaveText("Aprobaste el pago. Ya no aparece en tu bandeja.", ESPERA);
        await expect(titulo(page, "Pago aprobado")).toBeVisible();
        expect(await escenario.leerPago(nuevo.id)).toMatchObject({ estado: "aprobado", id_admin: adminA.id, id_admin_revisor: adminB.id });
        await expectReglasDelProducto(page, "el pago recién llegado ya aprobado");
      });

      await test.step("A lo ve aprobado, con «Revisado por» B y «Responsable» A; ya no está en su bandeja", async () => {
        await paginaDeA.goto(`/admin/pagos/${nuevo.id}`);
        await expect(titulo(paginaDeA, "Pago aprobado")).toBeVisible(ESPERA);
        await expect(dato(seccionPago(paginaDeA), "Estado")).toHaveText("Aprobado");
        await expect(dato(seccionPago(paginaDeA), "Revisado por")).toHaveText(adminB.nombre);
        await expect(dato(seccionPago(paginaDeA), "Responsable")).toHaveText(adminA.nombre);
        await expect(botonAprobar(paginaDeA)).toHaveCount(0);
        await expect(abrirRechazo(paginaDeA)).toHaveCount(0);
        await expectReglasDelProducto(paginaDeA, "el pago aprobado por otro admin, visto por el responsable");

        await paginaDeA.goto("/admin");
        await expect(pagosDeLaBandeja(paginaDeA)).toBeVisible(ESPERA);
        await expect(misPagosEnLaBandeja(paginaDeA)).toHaveCount(0);
        await expect(pagosDeLaBandeja(paginaDeA)).not.toContainText(nuevo.nombrePagador);
      });
    } finally {
      await contextoDeA.close();
    }
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
