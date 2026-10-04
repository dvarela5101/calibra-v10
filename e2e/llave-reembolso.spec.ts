import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { formatearFechaHora } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { enviarCredenciales, leerSesion, test as base, expect } from "./utilidades";

// HU-025 (RN-44, RN-61, P-10, D-27): quien pagó entrega la llave de su reembolso desde el enlace que le llega
// (`/reembolso?token=...`, sin sesión), y un admin reabre desde la bandeja un caso que se cerró a los 7 días sin llave.
// Corre contra el Supabase local con monitores, materias, Leads, monitorías, pagos y reembolsos que crea y borra cada
// prueba (nombres, montos y motivos únicos: las pruebas corren en paralelo y solo se afirma sobre lo propio). Los correos
// que piden la llave, el recordatorio y el cierre de pg_cron los cubre la prueba de integración
// (`integracion/llave-reembolso.test.ts`); aquí se prueba la interfaz: la página del enlace, el formulario (que necesita
// JavaScript; sin él no manda la llave a ningún lado), que la llave nunca vuelva al navegador (criterio 3), los enlaces que
// no sirven y el botón de la bandeja, que sí funciona sin JavaScript.
//
// El reembolso se prepara por la base, con la llave secreta, como lo inserta cualquier HU que lo crea: los triggers le
// anotan su token (`solicitud_llave`) y su pedido. Un caso cerrado se inserta con el plazo empezado hace 8 días y
// `cerrado_en`, como lo deja el trabajo de pg_cron. El enlace no crea sesión anónima: se aborta el alta
// (`**/auth/v1/signup`) y se comprueba que la página ni lo intentó.

const ESPERA = { timeout: 20_000 };
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
/** P-10: los días para entregar la llave (`public.parametros_reembolso`). */
const DIAS_PARA_ENTREGAR = 7;

const TITULO_FORMULARIO = "Envíanos tu llave";
const TITULO_RECIBIDA = "Recibimos tu llave";
const TITULO_DEVUELTO = "Ya te devolvimos el dinero";
const TITULO_CERRADO = "Este caso se cerró";
const TITULO_NO_SIRVE = "Este enlace no sirve";
const ERROR_VACIA = "Escribe tu llave para que podamos devolverte el dinero.";
const ERROR_LARGA = "La llave es demasiado larga: puede tener hasta 200 caracteres.";
/** Supuesto 3: otra llave cuando ya teníamos una. El correo de soporte va solo si `CORREO_DATOS_PERSONALES` lo trae. */
const AVISO_OTRA_LLAVE = /^Ya teníamos una llave para este reembolso y no la cambiamos\.( Si quieres corregirla, escríbenos a \S+@\S+\.)?$/;
const AVISO_REABIERTO =
  "Reabriste el caso: quien pagó tiene otra vez el plazo completo y le mandamos de nuevo el enlace para enviar su llave.";

/** Texto con los espacios duros (la hora y los pesos los llevan) como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s/g, " ");

/** El fin del plazo para entregar la llave de un ciclo que empezó en `desde` (P-10). */
const venceDe = (desde: Date) => new Date(desde.getTime() + DIAS_PARA_ENTREGAR * DIA);

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type OpcionesDeReembolso = {
  /** Por defecto espera la llave. `pendiente` y `reembolsado` nacen con su llave, como los deja HU-025 y HU-026. */
  estado?: "esperando_llave" | "pendiente" | "reembolsado";
  /** Pasaron los 7 días: con `cerrado`, además, el trabajo de pg_cron ya lo cerró. */
  plazo?: "abierto" | "vencido" | "cerrado";
  /** El admin del caso; si no, uno de la prueba. */
  idAdmin?: string;
};

type Reembolso = {
  id: string;
  token: string;
  monto: number;
  motivo: string;
  nombrePagador: string;
  contacto: string;
  /** Desde cuándo corren los 7 días (P-10). */
  plazoLlaveDesde: Date;
  /** La llave guardada (pendiente o reembolsado); `null` si todavía espera la llave. */
  llave: string | null;
};

type EnBd = { estado: string; llave_destino: string | null; cerrado_en: string | null; plazo_llave_desde: string };

type Escenario = {
  reembolso(opciones?: OpcionesDeReembolso): Promise<Reembolso>;
  /** El reembolso como lo guarda la base, con la llave (la prueba la lee con la llave secreta para comprobarla). */
  enBd(id: string): Promise<EnBd>;
  /** Pasan los 7 días con la página abierta: el plazo empieza 8 días antes (el trabajo de pg_cron todavía no lo cierra). */
  vencer(id: string): Promise<void>;
  /** Los correos que la base anotó para el reembolso, por tipo. */
  pedidosDe(id: string): Promise<string[]>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const reembolsos: string[] = [];
    const pagos: string[] = [];
    const comprobantes: string[] = [];
    const monitorias: string[] = [];
    const leads: string[] = [];
    const materias: string[] = [];
    let comun: { idAdmin: string; idMonitor: string; idMateria: string; idFranja: string; idLead: string } | undefined;
    let semana = 0;

    async function insertar(tabla: string, fila: Record<string, unknown>) {
      const { data, error } = await cliente.from(tabla).insert(fila).select().single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data as { id: string };
    }

    /** Monitor, materia, certificado, franja de los lunes y Lead: uno por prueba, para todas sus monitorías. */
    async function contexto() {
      if (comun) return comun;
      const admin = await cuentas.crearAdmin();
      const monitor = await cuentas.crearMonitor();
      const materia = await insertar("materia", { nombre: `Materia e2e llave ${randomUUID().slice(0, 6)}`, codigo: `E2E-${randomUUID().slice(0, 12)}` });
      materias.push(materia.id);
      await insertar("certificado", { id_monitor: monitor.id, id_materia: materia.id, id_admin: admin.id });
      const franja = await insertar("franja", { id_monitor: monitor.id, dia: 1, hora: "10:00", duracion_min: 60, presencial: true, precio: 25_000, lugar: "Salón e2e" });
      const lead = await insertar("lead", {
        nombre: "Lead e2e llave",
        correo: `lead-${randomUUID()}@calibra.test`,
        acepta_tratamiento_datos: true,
        fecha_consentimiento: new Date().toISOString(),
      });
      leads.push(lead.id);
      comun = { idAdmin: admin.id, idMonitor: monitor.id, idMateria: materia.id, idFranja: franja.id, idLead: lead.id };
      return comun;
    }

    await entregar({
      async reembolso(opciones = {}) {
        const c = await contexto();
        const estado = opciones.estado ?? "esperando_llave";
        const plazo = opciones.plazo ?? "abierto";
        const sufijo = randomBytes(4).toString("hex");

        // Una monitoría cancelada por el estudiante (un lunes por reembolso), con su pago aprobado.
        const fecha = new Date(Date.UTC(2030, 0, 7 + 7 * semana++)).toISOString().slice(0, 10);
        const monitoria = await insertar("monitoria", {
          id_franja: c.idFranja,
          id_monitor: c.idMonitor,
          id_materia: c.idMateria,
          id_lead: c.idLead,
          fecha,
          valor_total: 25_000,
          estado: "cancelada",
          motivo_cancelacion: "estudiante",
        });
        monitorias.push(monitoria.id);
        // pago.comprobante es una llave foránea a los comprobantes que el servidor ya revisó (HU-059).
        const comprobante = `${randomUUID()}/${randomUUID()}.png`;
        const { error } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
        if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
        comprobantes.push(comprobante);
        // Un monto propio (de $ 30.000 a $ 39.900) para reconocer el reembolso en la página y en la bandeja.
        const monto = randomInt(300, 400) * 100;
        const nombrePagador = `Pagador e2e ${sufijo}`;
        const contacto = `pagador-${sufijo}@calibra.test`;
        const pago = await insertar("pago", {
          id_monitoria: monitoria.id,
          monto,
          nombre_pagador: nombrePagador,
          contacto,
          id_admin: c.idAdmin,
          comprobante,
          estado: "aprobado",
          fecha_revision: new Date().toISOString(),
        });
        pagos.push(pago.id);

        const plazoLlaveDesde = plazo === "abierto" ? new Date() : new Date(Date.now() - (DIAS_PARA_ENTREGAR + 1) * DIA);
        const llave = estado === "esperando_llave" ? null : `llave-e2e-${sufijo}`;
        const motivo = `Cancelación e2e ${sufijo}`;
        const reembolso = await insertar("reembolso", {
          id_pago: pago.id,
          id_admin: opciones.idAdmin ?? c.idAdmin,
          monto,
          motivo,
          estado,
          llave_destino: llave,
          plazo_llave_desde: plazoLlaveDesde.toISOString(),
          cerrado_en: plazo === "cerrado" ? new Date(Date.now() - MINUTO).toISOString() : null,
          fecha_reembolso: estado === "reembolsado" ? new Date().toISOString() : null,
          referencia_transferencia: estado === "reembolsado" ? "REF-E2E" : null,
        });
        reembolsos.push(reembolso.id);

        const { data: solicitud, error: errorSolicitud } = await cliente.from("solicitud_llave").select("token").eq("id_reembolso", reembolso.id).single();
        if (errorSolicitud) throw new Error(`leer la solicitud de la llave: ${errorSolicitud.message}`);
        return { id: reembolso.id, token: (solicitud as { token: string }).token, monto, motivo, nombrePagador, contacto, plazoLlaveDesde, llave };
      },
      async enBd(id) {
        const { data, error } = await cliente.from("reembolso").select("estado, llave_destino, cerrado_en, plazo_llave_desde").eq("id", id).single();
        if (error) throw new Error(`leer el reembolso: ${error.message}`);
        return data as EnBd;
      },
      async vencer(id) {
        const desde = new Date(Date.now() - (DIAS_PARA_ENTREGAR + 1) * DIA).toISOString();
        const { error } = await cliente.from("reembolso").update({ plazo_llave_desde: desde }).eq("id", id);
        if (error) throw new Error(`vencer el plazo: ${error.message}`);
      },
      async pedidosDe(id) {
        const { data, error } = await cliente.from("pedido_llave").select("tipo").eq("id_reembolso", id).order("creada_en");
        if (error) throw new Error(`leer los pedidos de la llave: ${error.message}`);
        return (data as { tipo: string }[]).map((p) => p.tipo);
      },
    });

    // Limpieza, antes de que la fixture `cuentas` borre al monitor y al admin: de las filas dependientes hacia arriba. La
    // solicitud y los pedidos de cada reembolso se van con él, en cascada.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (reembolsos.length) await borrar("reembolsos", cliente.from("reembolso").delete().in("id", reembolsos));
    if (pagos.length) await borrar("pagos", cliente.from("pago").delete().in("id", pagos));
    if (comprobantes.length) await borrar("comprobantes revisados", cliente.from("comprobante_revisado").delete().in("ruta", comprobantes));
    if (monitorias.length) await borrar("monitorías", cliente.from("monitoria").delete().in("id", monitorias));
    if (comun) {
      await borrar("franja", cliente.from("franja").delete().eq("id", comun.idFranja));
      await borrar("certificado", cliente.from("certificado").delete().eq("id_monitor", comun.idMonitor));
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
const campoLlave = (page: Page) => page.getByLabel("Tu llave");
const botonEnviar = (page: Page) => page.getByRole("button", { name: "Enviar mi llave", exact: true });

/** El valor que muestra el resumen para una etiqueta (Monto, Motivo, Envíala hasta el). */
const dato = (page: Page, etiqueta: string): Locator =>
  page.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");

/** Los mensajes de la página (`role="alert"`), sin el anunciador de rutas de Next, que también lo lleva. */
const alertas = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

/** El texto que se ve, con los espacios duros como espacios normales. */
const textoVisible = async (page: Page) => normalizar(await page.locator("body").innerText());

const rutaDe = (token: string) => `/reembolso?token=${token}`;
/** La dirección exacta del enlace, sin nada más: `replace` vuelve a ella. */
const direccionDe = (token: string) => new RegExp(`/reembolso\\?token=${token}$`);

/**
 * Aborta el alta de la sesión anónima y cuenta cuántas veces la página lo intentó: el enlace del correo no debe crear
 * sesión (la página vive fuera de las páginas públicas, como /cita).
 */
async function sinAltaAnonima(page: Page): Promise<{ intentos: number }> {
  const altas = { intentos: 0 };
  await page.route("**/auth/v1/signup", (ruta) => {
    altas.intentos += 1;
    return ruta.abort();
  });
  return altas;
}

/** Anota los errores de JavaScript sin atrapar que tenga la página. */
function vigilarErrores(page: Page): string[] {
  const errores: string[] = [];
  page.on("pageerror", (error) => errores.push(error.message));
  return errores;
}

/**
 * Junta todo lo que el servidor le manda al navegador (las páginas y las respuestas de las acciones) para buscar la llave
 * ahí, no solo en lo que se ve: el criterio 3 dice que nadie más que un admin la ve.
 */
function vigilarRespuestas(page: Page): () => Promise<string> {
  const cuerpos: Promise<string>[] = [];
  page.on("response", (respuesta) => {
    const tipo = respuesta.headers()["content-type"] ?? "";
    if (/text\/html|text\/x-component/.test(tipo)) cuerpos.push(respuesta.text().catch(() => ""));
  });
  return async () => (await Promise.all(cuerpos)).join("\n");
}

/** `noindex` y `no-referrer` (el enlace lleva el token): que no quede en buscadores ni se filtre por el Referer. */
async function expectNoIndexNiReferer(page: Page, donde: string): Promise<void> {
  await expect(page.locator('meta[name="robots"]'), `${donde}: robots`).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="referrer"]'), `${donde}: referrer`).toHaveAttribute("content", "no-referrer");
}

/** El formulario con lo que la persona necesita para enviar la llave: monto, motivo y hasta cuándo. */
async function expectFormulario(page: Page, r: Reembolso, desde = r.plazoLlaveDesde): Promise<void> {
  await expect(titulo(page, TITULO_FORMULARIO)).toBeVisible(ESPERA);
  await expect(dato(page, "Monto")).toHaveText(normalizar(formatearPesos(r.monto)));
  await expect(dato(page, "Motivo")).toHaveText(r.motivo);
  await expect(dato(page, "Envíala hasta el")).toHaveText(normalizar(formatearFechaHora(venceDe(desde))));
  await expect(campoLlave(page)).toBeVisible();
  await expect(botonEnviar(page)).toBeEnabled();
}

/** Ya la recibimos: sin formulario ni errores, y sin la llave. */
async function expectRecibida(page: Page, r: Reembolso): Promise<void> {
  await expect(titulo(page, TITULO_RECIBIDA)).toBeVisible(ESPERA);
  expect(await textoVisible(page)).toContain(`Te vamos a transferir ${normalizar(formatearPesos(r.monto))}. No tienes que hacer nada más.`);
  await expect(page.locator("form")).toHaveCount(0);
  await expect(campoLlave(page)).toHaveCount(0);
  await expect(alertas(page)).toHaveCount(0);
}

async function entrarComoAdmin(page: Page, correo: string, contrasena: string) {
  await page.goto("/admin");
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  await enviarCredenciales(page, correo, contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
}

// ---------------------------------------------------------------------------
// Criterios 1 a 3 · entregar la llave con el enlace del correo
// ---------------------------------------------------------------------------
test.describe("Criterios 1 a 3 · quien pagó entrega su llave con el enlace", () => {
  test("el enlace muestra el monto, el motivo y hasta cuándo; con la llave escrita la guarda, vuelve a la misma dirección y dice «Recibimos tu llave», sin la llave en nada de lo que llega al navegador; abrir el enlace no crea sesión", async ({
    page,
    context,
    escenario,
  }) => {
    const altas = await sinAltaAnonima(page);
    const errores = vigilarErrores(page);
    const respuestas = vigilarRespuestas(page);
    const r = await escenario.reembolso();
    const sufijo = randomBytes(4).toString("hex");
    const escrita = `  ana.${sufijo}@banco.test   llave `;
    const guardada = `ana.${sufijo}@banco.test llave`;

    await page.goto(rutaDe(r.token));

    await test.step("el formulario, con el monto, el motivo, hasta cuándo y la ayuda", async () => {
      await expect(page).toHaveTitle("Tu reembolso · Calibra");
      await expectFormulario(page, r);
      // El formulario lleva el token del enlace en un campo oculto.
      await expect(page.locator('form input[type="hidden"][name="token"]')).toHaveValue(r.token);
      await expect(page.getByText("Revísala antes de enviarla: desde este enlace no se puede cambiar después.", { exact: false })).toBeVisible();
      await expect(page.getByText("Solo te pedimos la llave. Calibra nunca te pide claves del banco ni datos de tu tarjeta.")).toBeVisible();
      // Nada del contacto ni del nombre de quien pagó (la página es de quien tenga el enlace).
      const html = await page.content();
      for (const privado of [r.contacto, r.nombrePagador]) expect(html).not.toContain(privado);
    });

    await test.step("enviar: vuelve a la misma dirección, que dice que la recibimos", async () => {
      await campoLlave(page).fill(escrita);
      await botonEnviar(page).click();
      await expectRecibida(page, r);
      await expect(page).toHaveURL(direccionDe(r.token));
      expect(errores, "la página no debía lanzar errores de JavaScript").toEqual([]);
    });

    await test.step("en la base: la llave normalizada y el reembolso pendiente, en el mismo paso", async () => {
      expect(await escenario.enBd(r.id)).toMatchObject({ estado: "pendiente", llave_destino: guardada, cerrado_en: null });
    });

    await test.step("criterio 3: la llave no está en la página ni en ninguna respuesta del servidor", async () => {
      const html = await page.content();
      expect(html).not.toContain(sufijo);
      expect(await respuestas()).not.toContain(sufijo);
    });

    await test.step("recargar no repite nada: sigue diciendo que la recibimos", async () => {
      await page.reload();
      await expectRecibida(page, r);
      expect((await escenario.enBd(r.id)).llave_destino).toBe(guardada);
    });

    await test.step("abrir el enlace no crea sesión anónima ni la intenta", async () => {
      await page.waitForLoadState("networkidle");
      expect(altas.intentos, "la página no debía intentar crear una sesión anónima").toBe(0);
      expect(leerSesion(await context.cookies()), "el navegador no debía recibir sesión").toBeNull();
    });
  });

  test("una llave vacía o demasiado larga no se guarda: el mensaje se anuncia (role=alert), el campo queda marcado y conserva lo escrito; después, una llave válida sí", async ({
    page,
    escenario,
  }) => {
    await sinAltaAnonima(page);
    const r = await escenario.reembolso();
    await page.goto(rutaDe(r.token));
    await expectFormulario(page, r);

    await test.step("vacía (solo espacios)", async () => {
      await campoLlave(page).fill("    ");
      await botonEnviar(page).click();
      await expect(alertas(page)).toHaveText(ERROR_VACIA, ESPERA);
      await expect(campoLlave(page)).toHaveAttribute("aria-invalid", "true");
      await expect(campoLlave(page)).toHaveAttribute("aria-describedby", "llave-ayuda llave-error");
      await expect(titulo(page, TITULO_FORMULARIO)).toBeVisible();
    });

    await test.step("de 201 caracteres: conserva lo escrito", async () => {
      const larga = "a".repeat(201);
      await campoLlave(page).fill(larga);
      await botonEnviar(page).click();
      await expect(alertas(page)).toHaveText(ERROR_LARGA, ESPERA);
      await expect(campoLlave(page)).toHaveValue(larga);
      await expect(campoLlave(page)).toHaveAttribute("aria-invalid", "true");
    });

    expect(await escenario.enBd(r.id)).toMatchObject({ estado: "esperando_llave", llave_destino: null });

    await test.step("una válida se guarda y el error desaparece", async () => {
      await campoLlave(page).fill("3001234567");
      await botonEnviar(page).click();
      await expectRecibida(page, r);
      expect(await escenario.enBd(r.id)).toMatchObject({ estado: "pendiente", llave_destino: "3001234567" });
    });
  });

  test("dos pestañas con el formulario abierto: la primera guarda; si la segunda manda otra llave, el formulario dice que no se cambió (no «Recibimos tu llave») y la base conserva la primera; con la misma llave, la segunda termina en «Recibimos tu llave»", async ({
    page,
    context,
    escenario,
  }) => {
    await sinAltaAnonima(page);
    const otraPestana = await context.newPage();
    await sinAltaAnonima(otraPestana);
    // Cada pestaña anota en su propio arreglo: copiarlos ahora daría una lista vacía que nunca cambia.
    const erroresA = vigilarErrores(page);
    const erroresB = vigilarErrores(otraPestana);
    const r = await escenario.reembolso();

    for (const pestana of [page, otraPestana]) {
      await pestana.goto(rutaDe(r.token));
      await expectFormulario(pestana, r);
    }

    await test.step("la primera pestaña guarda su llave", async () => {
      await campoLlave(page).fill("primera-llave");
      await botonEnviar(page).click();
      await expectRecibida(page, r);
    });

    await test.step("la segunda, con otra llave: se queda en el formulario con el aviso y lo escrito, y la base conserva la primera", async () => {
      await campoLlave(otraPestana).fill("segunda-llave");
      await botonEnviar(otraPestana).click();
      await expect(alertas(otraPestana)).toHaveText(AVISO_OTRA_LLAVE, ESPERA);
      await expect(titulo(otraPestana, TITULO_RECIBIDA)).toHaveCount(0);
      await expect(titulo(otraPestana, TITULO_FORMULARIO)).toBeVisible();
      await expect(campoLlave(otraPestana)).toHaveValue("segunda-llave");
      await expect(otraPestana).toHaveURL(direccionDe(r.token));
      expect(await escenario.enBd(r.id)).toMatchObject({ estado: "pendiente", llave_destino: "primera-llave" });
    });

    await test.step("la segunda, con la misma llave (con otros espacios): termina en «Recibimos tu llave»", async () => {
      await campoLlave(otraPestana).fill("  primera-llave ");
      await botonEnviar(otraPestana).click();
      await expectRecibida(otraPestana, r);
      await expect(otraPestana).toHaveURL(direccionDe(r.token));
    });

    expect([...erroresA, ...erroresB], "ninguna pestaña debía lanzar errores de JavaScript").toEqual([]);
    expect(await escenario.enBd(r.id)).toMatchObject({ estado: "pendiente", llave_destino: "primera-llave" });
  });

  test("si el plazo vence con la página abierta, la base manda: al enviar, la página dice que el caso se cerró y la llave no se guarda", async ({
    page,
    escenario,
  }) => {
    await sinAltaAnonima(page);
    const r = await escenario.reembolso();
    await page.goto(rutaDe(r.token));
    await expectFormulario(page, r);

    // Pasan los 7 días mientras la página sigue abierta (el reloj de la base decide, P-40).
    await escenario.vencer(r.id);
    await campoLlave(page).fill("3001234567");
    await botonEnviar(page).click();

    await expect(titulo(page, TITULO_CERRADO)).toBeVisible(ESPERA);
    await expect(page).toHaveURL(direccionDe(r.token));
    await expect(page.locator("form")).toHaveCount(0);
    await expect(alertas(page)).toHaveCount(0);
    expect(await escenario.enBd(r.id)).toMatchObject({ estado: "esperando_llave", llave_destino: null });
  });
});

test.describe("Criterio 3 · sin JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  // El formulario necesita JavaScript, como cancelar la cita (ver FormularioDeLlave.tsx): sin él, el botón no envía nada.
  // Lo que importa es que la llave no salga hacia ningún lado: ni a la base ni a la dirección de la página.
  test("sin JavaScript el formulario no manda la llave a ningún lado: no hay petición, la dirección no cambia y el reembolso sigue esperando", async ({
    page,
    escenario,
  }) => {
    const r = await escenario.reembolso();
    await page.goto(rutaDe(r.token));
    await expectFormulario(page, r);
    const peticiones: string[] = [];
    page.on("request", (peticion) => peticiones.push(`${peticion.method()} ${peticion.url()}`));

    await campoLlave(page).fill("3001234567");
    await botonEnviar(page).click();
    await page.waitForLoadState("networkidle");

    expect(peticiones, "el botón no debía pedir nada al servidor").toEqual([]);
    await expect(page).toHaveURL(direccionDe(r.token));
    expect(page.url()).not.toContain("3001234567");
    await expect(titulo(page, TITULO_FORMULARIO)).toBeVisible();
    expect(await escenario.enBd(r.id)).toMatchObject({ estado: "esperando_llave", llave_destino: null });
  });
});

// ---------------------------------------------------------------------------
// Lo que muestra el enlace en cada estado
// ---------------------------------------------------------------------------
test.describe("Los estados del enlace", () => {
  test("recibida, devuelta, cerrada por el trabajo o vencida sin cerrar: cada una con su texto, sin formulario y sin la llave", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const pendiente = await escenario.reembolso({ estado: "pendiente" });
    const reembolsado = await escenario.reembolso({ estado: "reembolsado" });
    const cerrado = await escenario.reembolso({ plazo: "cerrado" });
    const vencido = await escenario.reembolso({ plazo: "vencido" });

    await test.step("pendiente: «Recibimos tu llave», sin mostrarla", async () => {
      await page.goto(rutaDe(pendiente.token));
      await expectRecibida(page, pendiente);
      expect(await page.content()).not.toContain(pendiente.llave!);
    });

    await test.step("reembolsado: «Ya te devolvimos el dinero», sin mostrar la llave", async () => {
      await page.goto(rutaDe(reembolsado.token));
      await expect(titulo(page, TITULO_DEVUELTO)).toBeVisible(ESPERA);
      expect(await textoVisible(page)).toContain(`Transferimos ${normalizar(formatearPesos(reembolsado.monto))} a la llave que nos diste.`);
      await expect(page.locator("form")).toHaveCount(0);
      expect(await page.content()).not.toContain(reembolsado.llave!);
    });

    for (const [donde, r] of [
      ["cerrado por el trabajo de pg_cron", cerrado],
      ["vencido, sin que el trabajo haya corrido", vencido],
    ] as const) {
      await test.step(`${donde}: «Este caso se cerró», con la fecha en que terminó el plazo`, async () => {
        await page.goto(rutaDe(r.token));
        await expect(titulo(page, TITULO_CERRADO), donde).toBeVisible(ESPERA);
        expect(await textoVisible(page), donde).toContain(
          `El plazo para enviarnos tu llave terminó el ${normalizar(formatearFechaHora(venceDe(r.plazoLlaveDesde)))}, así que cerramos el caso.`,
        );
        expect(await textoVisible(page), donde).toContain("Si todavía necesitas el reembolso");
        await expect(page.locator("form"), donde).toHaveCount(0);
        await expect(dato(page, "Monto"), donde).toHaveText(normalizar(formatearPesos(r.monto)));
        await expect(page.locator("dt", { hasText: /^Envíala hasta el$/ }), donde).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Ir al inicio", exact: true }), donde).toBeVisible();
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Enlaces que no sirven y metadatos
// ---------------------------------------------------------------------------
test.describe("Enlaces que no sirven", () => {
  test("un token inventado, incompleto, vacío, repetido, en mayúsculas o sin token dicen «Este enlace no sirve», sin datos de ningún reembolso", async ({ page, escenario }) => {
    const altas = await sinAltaAnonima(page);
    const r = await escenario.reembolso();
    const inventado = randomBytes(32).toString("hex");
    const enlaces = [
      `/reembolso?token=${inventado}`,
      "/reembolso?token=abc",
      "/reembolso?token=",
      "/reembolso",
      `/reembolso?token=${inventado}&token=${inventado}`,
      // Un token real, pero repetido o con la forma cambiada, tampoco abre el reembolso.
      `/reembolso?token=${r.token}&token=${r.token}`,
      `/reembolso?token=${r.token.toUpperCase()}`,
      `/reembolso?token=${r.token}x`,
      `/reembolso?token=%20${r.token}`,
    ];

    for (const ruta of enlaces) {
      await page.goto(ruta);
      await expect(titulo(page, TITULO_NO_SIRVE), ruta).toBeVisible(ESPERA);
      await expect(page.getByText("Está incompleto o no lo reconocemos."), ruta).toBeVisible();
      await expect(page.locator("dt"), ruta).toHaveCount(0);
      await expect(page.locator("form"), ruta).toHaveCount(0);
      const html = await page.content();
      for (const privado of [r.motivo, normalizar(formatearPesos(r.monto)), formatearPesos(r.monto)]) expect(html, ruta).not.toContain(privado);
      await expect(page.getByRole("link", { name: "Ir al inicio", exact: true }), ruta).toBeVisible();
    }
    expect(altas.intentos).toBe(0);
    expect(await escenario.enBd(r.id)).toMatchObject({ estado: "esperando_llave", llave_destino: null });
  });

  test("la página del enlace no se indexa ni filtra el token por el Referer: con el formulario, con un token inventado y ya recibida", async ({ page, escenario }) => {
    await sinAltaAnonima(page);
    const r = await escenario.reembolso();
    const recibida = await escenario.reembolso({ estado: "pendiente" });
    for (const [donde, ruta] of [
      ["con el formulario", rutaDe(r.token)],
      ["token inventado", rutaDe(randomBytes(32).toString("hex"))],
      ["ya recibida", rutaDe(recibida.token)],
    ] as const) {
      await page.goto(ruta);
      await expect(page.getByRole("heading", { level: 1 }), donde).toBeVisible(ESPERA);
      await expectNoIndexNiReferer(page, donde);
      await expect(page, donde).toHaveTitle("Tu reembolso · Calibra");
    }
  });
});

// ---------------------------------------------------------------------------
// Criterio 5 · el admin reabre un caso cerrado desde la bandeja
// ---------------------------------------------------------------------------
test.describe("Criterio 5 · reabrir desde la bandeja un caso cerrado sin llave", () => {
  test("«Cerrados sin llave» lo lista con quién pagó, su correo, el motivo y cuándo se cerró; «Reabrir y reenviar el enlace» lo reabre, avisa arriba y lo pasa a «Esperando la llave»; el enlace vuelve a pedir la llave con el plazo nuevo", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    const r = await escenario.reembolso({ plazo: "cerrado", idAdmin: admin.id });
    await entrarComoAdmin(page, admin.correo, admin.contrasena);

    const resumen = page.getByRole("navigation", { name: "Resumen de tu bandeja" });
    const reembolsos = page.getByRole("region", { name: /Reembolsos/ });
    const cerrados = reembolsos.getByRole("list", { name: /Cerrados sin llave/ });
    const fila = cerrados.getByRole("listitem").filter({ hasText: r.nombrePagador });

    await test.step("el caso cerrado, con lo que el admin necesita para reconocerlo, y que no cuenta como reembolso por atender", async () => {
      await expect(reembolsos.getByRole("heading", { level: 3, name: /^Cerrados sin llave \(\d+\)$/ })).toBeVisible(ESPERA);
      await expect(fila).toHaveCount(1);
      await expect(fila).toContainText(normalizar(formatearPesos(r.monto)));
      await expect(fila).toContainText(r.contacto);
      await expect(fila).toContainText(r.motivo);
      await expect(fila).toContainText("Se cerró el");
      // Es el único caso de este admin y está cerrado: no hay nada que esperar ni que transferir.
      await expect(resumen.getByRole("link", { name: "0 Reembolsos" })).toBeVisible();
      await expect(reembolsos.getByText("No tienes reembolsos por atender.")).toBeVisible();
      await expect(reembolsos.getByRole("heading", { level: 3, name: /^Esperando la llave del pagador/ })).toHaveCount(0);
      await expectReglasDelProducto(page, "bandeja con un caso cerrado");
    });

    const antes = Date.now();
    await fila.getByRole("button", { name: "Reabrir y reenviar el enlace" }).click();

    await test.step("vuelve a la bandeja con el aviso, y el caso pasa a «Esperando la llave»", async () => {
      await expect(page).toHaveURL("/admin?reembolso=reabierto", ESPERA);
      await expect(page.getByRole("status").filter({ hasText: AVISO_REABIERTO })).toBeVisible();
      await expect(fila).toHaveCount(0);
      await expect(resumen.getByRole("link", { name: "1 Reembolsos" })).toBeVisible();
      await expect(reembolsos.getByRole("heading", { level: 3, name: "Esperando la llave del pagador (1)" })).toBeVisible();
      await expect(reembolsos.locator("h3:has-text('Esperando la llave') + ul li")).toContainText(r.motivo);
    });

    const enBd = await escenario.enBd(r.id);
    await test.step("en la base: abierto, con el plazo desde ahora y el correo de la reapertura anotado", async () => {
      expect(enBd).toMatchObject({ estado: "esperando_llave", cerrado_en: null, llave_destino: null });
      expect(new Date(enBd.plazo_llave_desde).getTime()).toBeGreaterThan(antes - 5 * MINUTO);
      expect(await escenario.pedidosDe(r.id)).toEqual(["pedido", "reapertura"]);
    });

    await test.step("el mismo enlace vuelve a pedir la llave, con el plazo nuevo", async () => {
      await page.goto(rutaDe(r.token));
      await expectFormulario(page, r, new Date(enBd.plazo_llave_desde));
    });
  });
});

test.describe("Criterio 5 · reabrir sin JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("el botón de la bandeja es un formulario común: sin JavaScript también reabre el caso y vuelve con el aviso", async ({ page, cuentas, escenario }) => {
    const admin = await cuentas.crearAdmin();
    const r = await escenario.reembolso({ plazo: "cerrado", idAdmin: admin.id });
    await entrarComoAdmin(page, admin.correo, admin.contrasena);

    const fila = page.getByRole("list", { name: /Cerrados sin llave/ }).getByRole("listitem").filter({ hasText: r.nombrePagador });
    await expect(fila).toHaveCount(1, ESPERA);
    await fila.getByRole("button", { name: "Reabrir y reenviar el enlace" }).click();

    await expect(page).toHaveURL("/admin?reembolso=reabierto", ESPERA);
    await expect(page.getByText(AVISO_REABIERTO)).toBeVisible();
    await expect(fila).toHaveCount(0);
    expect(await escenario.enBd(r.id)).toMatchObject({ estado: "esperando_llave", cerrado_en: null });
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página del enlace (las mismas de e2e/cita.spec.ts)
// ---------------------------------------------------------------------------
test.describe("Reglas del producto en la página de la llave", () => {
  test("con el formulario, el error, la llave recibida, el caso cerrado y el enlace que no sirve a la vista, el texto mide 14 px o más, las áreas táctiles 44 px o más y no hay desbordamiento a 390 px ni en escritorio", async ({
    page,
    escenario,
  }) => {
    await sinAltaAnonima(page);
    const r = await escenario.reembolso();
    const cerrado = await escenario.reembolso({ plazo: "cerrado" });

    await test.step("el formulario", async () => {
      await page.goto(rutaDe(r.token));
      await expectFormulario(page, r);
      await expectReglasDelProducto(page, "formulario");
    });

    await test.step("el error de la llave (role=alert), con lo escrito", async () => {
      await campoLlave(page).fill("b".repeat(201));
      await botonEnviar(page).click();
      await expect(alertas(page)).toHaveText(ERROR_LARGA, ESPERA);
      await expectReglasDelProducto(page, "error de la llave");
    });

    await test.step("la llave recibida", async () => {
      await campoLlave(page).fill("3001234567");
      await botonEnviar(page).click();
      await expectRecibida(page, r);
      await expectReglasDelProducto(page, "llave recibida");
    });

    await test.step("el caso cerrado", async () => {
      await page.goto(rutaDe(cerrado.token));
      await expect(titulo(page, TITULO_CERRADO)).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "caso cerrado");
    });

    await test.step("el enlace que no sirve", async () => {
      await page.goto(rutaDe(randomBytes(32).toString("hex")));
      await expect(titulo(page, TITULO_NO_SIRVE)).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "enlace que no sirve");
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
