import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/procesos/reintentar-correos/route";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { autorizaProceso, LARGO_MINIMO_DEL_SECRETO, reintentarCorreosDesdeServidor } from "@/lib/correo/procesos";
import { buscarInvitacion, invitarMonitor } from "@/lib/monitores/servidor";
import { exigirSupabaseLocal, exito, Fixtures } from "./utilidades";

// HU-065 contra el Supabase LOCAL: los correos que fallaron se reintentan solos sobre la misma fila y la misma
// clave. El correo sale de verdad por Mailpit y las filas son las de la tabla real. Cada prueba crea sus
// propias filas, destinatarios e invitaciones, y las borra al final; otras filas que haya en la base no se
// tocan (el proceso reintenta todo lo pendiente, así que las pruebas miran solo las suyas).

let fx: Fixtures;
let mailpit: string;
/** Destinatarios de esta prueba (correo_envio, invitaciones y buzón). */
const correos: string[] = [];
/** Claves de correo_envio de esta prueba. */
const claves: string[] = [];

const MINUTO = 60_000;
const HORA = 3_600_000;
const DIA = 86_400_000;
const hace = (milisegundos: number) => new Date(Date.now() - milisegundos).toISOString();
const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
});

beforeEach(() => {
  fx = new Fixtures();
  // Nunca Resend (aunque quien corre las pruebas tenga la llave) y un sitio conocido para los enlaces.
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("SMTP_CONTRASENA", "");
  vi.stubEnv("CORREO_REMITENTE", "");
  vi.stubEnv("MAILPIT_URL", mailpit);
  vi.stubEnv("SITIO_URL", "https://calibra.test");
  // Los fallos esperados (proveedor sin configurar, ruta con error) se anotan en la consola; aquí no ensucian la salida.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  const destinatarios = correos.splice(0);
  const clavesPropias = claves.splice(0);
  if (clavesPropias.length) await fx.admin.from("correo_envio").delete().in("clave", clavesPropias);
  if (destinatarios.length) {
    await fx.admin.from("correo_envio").delete().in("destinatario", destinatarios);
    await fx.admin.from("invitacion_monitor").delete().in("correo", destinatarios);
    for (const correo of destinatarios) {
      await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" });
    }
  }
  await fx.limpiar();
});

function correoNuevo(): string {
  const correo = `reintento-${randomUUID()}@calibra.test`;
  correos.push(correo);
  return correo;
}

type Mensaje = { ID: string; Subject: string; Text: string };

async function mensajesPara(correo: string): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all(
    (messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje),
  );
}

/** El token del enlace de registro que trae el correo (la única copia del token que existe). */
function tokenDe(mensaje: Mensaje): string {
  const token = /\/monitores\/registro\?token=([0-9a-f]{64})/.exec(mensaje.Text)?.[1];
  if (!token) throw new Error(`El correo no trae el enlace de registro:\n${mensaje.Text}`);
  return token;
}

async function filaDe(clave: string) {
  return exito(await fx.admin.from("correo_envio").select("*").eq("clave", clave).single(), `leer correo_envio ${clave}`);
}

async function invitacionDe(id: string) {
  return exito(await fx.admin.from("invitacion_monitor").select("*").eq("id", id).single(), `leer invitación ${id}`);
}

/**
 * Deja la fila quieta desde hace un rato. El proceso solo toma un fallido que lleva 2 minutos sin tocarse
 * (y un pendiente que lleva 5): una fila recién fallida espera, así que las pruebas que esperan que se
 * reintente la envejecen antes.
 */
async function envejecer(clave: string, milisegundos = 3 * MINUTO) {
  exito(await fx.admin.from("correo_envio").update({ actualizado_en: hace(milisegundos) }).eq("clave", clave).select("id").single(), `envejecer ${clave}`);
}

/**
 * Una invitación cuyo correo no salió: el proveedor no está configurado en ese momento (sin_proveedor, que es
 * temporal), así que la fila de correo_envio queda `fallido` y `reintentable`. Luego vuelve Mailpit. Por
 * defecto la fila queda con 3 minutos de quieta, lista para que el proceso la tome.
 */
async function invitacionQueNoSalio(idAdmin: string, { esperada = true }: { esperada?: boolean } = {}) {
  const correo = correoNuevo();
  vi.stubEnv("MAILPIT_URL", "");
  const resultado = await invitarMonitor(idAdmin, correo);
  vi.stubEnv("MAILPIT_URL", mailpit);
  expect(resultado).toEqual({ ok: true, correoEnviado: false });

  const invitacion = exito(await fx.admin.from("invitacion_monitor").select("*").eq("correo", correo).single(), "leer invitación");
  const clave = `invitacion_monitor:${invitacion.id}`;
  claves.push(clave);
  const recien = await filaDe(clave);
  expect(recien).toMatchObject({ estado: "fallido", reintentable: true, intentos: 0, destinatario: correo, enviado_en: null, id_proveedor: null });
  expect(recien.ultimo_error).toContain("RESEND_API_KEY");
  expect(await mensajesPara(correo)).toEqual([]);
  if (esperada) await envejecer(clave);
  return { correo, invitacion, clave, envio: await filaDe(clave) };
}

/**
 * Deja la fila como la de un envío que se cortó a la mitad: `pendiente`, sin fallo anotado, tocada por
 * última vez hace `hace` milisegundos (el proceso que la reservó murió).
 */
async function dejarPendiente(clave: string, hace_: number) {
  exito(
    await fx.admin
      .from("correo_envio")
      .update({ estado: "pendiente", reintentable: false, ultimo_error: null, intentos: 0, actualizado_en: hace(hace_) })
      .eq("clave", clave)
      .select("id")
      .single(),
    `dejar pendiente ${clave}`,
  );
}

/** Una fila de correo_envio hecha a mano, para probar lo que ve el admin sin depender del envío. */
async function insertarCorreo(datos: {
  plantilla: string;
  estado: "pendiente" | "enviado" | "fallido";
  reintentable?: boolean;
  /** Cuánto hace que se creó. */
  hace?: number;
  /** Cuánto hace que se tocó por última vez. Por defecto, lo mismo que `hace`. */
  tocadaHace?: number;
  error?: string;
}) {
  const clave = `${datos.plantilla}:${randomUUID()}`;
  claves.push(clave);
  const creado = hace(datos.hace ?? 0);
  return exito(
    await fx.admin
      .from("correo_envio")
      .insert({
        clave,
        plantilla: datos.plantilla,
        destinatario: correoNuevo(),
        estado: datos.estado,
        reintentable: datos.reintentable ?? false,
        intentos: datos.estado === "pendiente" ? 0 : 3,
        ultimo_error: datos.estado === "fallido" ? (datos.error ?? "Resend 503: caído") : null,
        creado_en: creado,
        actualizado_en: datos.tocadaHace === undefined ? creado : hace(datos.tocadaHace),
        enviado_en: datos.estado === "enviado" ? creado : null,
      })
      .select()
      .single(),
    "insertar correo_envio",
  );
}

/** Sesión de un admin recién creado y su id, para leer la bandeja con RLS de verdad. */
async function sesionDeAdmin() {
  const admin = await fx.crearAdmin();
  return { admin, cliente: await fx.iniciarSesion(admin) };
}

// ---------------------------------------------------------------------------------------------------------------
// La autorización de la ruta: sin base ni red, pero en este archivo porque `procesos.ts` es solo de servidor.

describe("autorizaProceso: solo el proceso programado con su secreto", () => {
  const SECRETO = randomBytes(32).toString("hex"); // 64 caracteres
  const entorno = { CRON_SECRETO: SECRETO };

  it("el secreto exigido mide al menos 32 caracteres", () => {
    expect(LARGO_MINIMO_DEL_SECRETO).toBe(32);
  });

  it("sin CRON_SECRETO nadie pasa, ni con un encabezado que parezca correcto", () => {
    for (const vacio of [{}, { CRON_SECRETO: undefined }, { CRON_SECRETO: "" }, { CRON_SECRETO: "   " }]) {
      expect(autorizaProceso(`Bearer ${SECRETO}`, vacio)).toBe(false);
      expect(autorizaProceso("Bearer ", vacio)).toBe(false);
      expect(autorizaProceso("Bearer undefined", vacio)).toBe(false);
      expect(autorizaProceso("Bearer", vacio)).toBe(false);
    }
  });

  it("con un secreto de menos de 32 caracteres nadie pasa, ni con el secreto exacto", () => {
    const corto = "c".repeat(LARGO_MINIMO_DEL_SECRETO - 1);
    expect(autorizaProceso(`Bearer ${corto}`, { CRON_SECRETO: corto })).toBe(false);
    expect(autorizaProceso("Bearer x", { CRON_SECRETO: "x" })).toBe(false);
    // Los espacios no cuentan para el largo: 31 letras con espacios alrededor siguen siendo 31.
    expect(autorizaProceso(`Bearer ${corto}`, { CRON_SECRETO: `  ${corto}  ` })).toBe(false);
  });

  it("con un secreto de exactamente 32 caracteres, sí", () => {
    const justo = "j".repeat(LARGO_MINIMO_DEL_SECRETO);
    expect(autorizaProceso(`Bearer ${justo}`, { CRON_SECRETO: justo })).toBe(true);
  });

  it("sin encabezado Authorization, no", () => {
    expect(autorizaProceso(null, entorno)).toBe(false);
    expect(autorizaProceso("", entorno)).toBe(false);
    expect(autorizaProceso("   ", entorno)).toBe(false);
  });

  it("con otro secreto, no: del mismo largo, más corto, más largo o solo el prefijo correcto", () => {
    expect(autorizaProceso(`Bearer ${"0".repeat(SECRETO.length)}`, entorno)).toBe(false);
    // Difiere en el último carácter.
    const ultimo = SECRETO.endsWith("a") ? "b" : "a";
    expect(autorizaProceso(`Bearer ${SECRETO.slice(0, -1)}${ultimo}`, entorno)).toBe(false);
    expect(autorizaProceso(`Bearer ${SECRETO.slice(0, -1)}`, entorno)).toBe(false);
    expect(autorizaProceso(`Bearer ${SECRETO}0`, entorno)).toBe(false);
    expect(autorizaProceso(`Bearer ${SECRETO.slice(0, 32)}`, entorno)).toBe(false);
  });

  it("sin la palabra Bearer (o con otro esquema), no", () => {
    expect(autorizaProceso(SECRETO, entorno)).toBe(false);
    expect(autorizaProceso(`Basic ${SECRETO}`, entorno)).toBe(false);
    expect(autorizaProceso(`bearer ${SECRETO}`, entorno)).toBe(false);
    expect(autorizaProceso(`Bearer${SECRETO}`, entorno)).toBe(false);
    expect(autorizaProceso(`Bearer  ${SECRETO}`, entorno)).toBe(false);
    expect(autorizaProceso(`Token ${SECRETO}`, entorno)).toBe(false);
  });

  it("con Bearer y el secreto exacto, sí; y tolera espacios alrededor del encabezado o del secreto configurado", () => {
    expect(autorizaProceso(`Bearer ${SECRETO}`, entorno)).toBe(true);
    expect(autorizaProceso(`  Bearer ${SECRETO}  `, entorno)).toBe(true);
    expect(autorizaProceso(`Bearer ${SECRETO}\n`, entorno)).toBe(true);
    expect(autorizaProceso(`Bearer ${SECRETO}`, { CRON_SECRETO: `  ${SECRETO}\n` })).toBe(true);
  });

  it("sin pasarle el entorno, lee process.env", () => {
    vi.stubEnv("CRON_SECRETO", "");
    expect(autorizaProceso(`Bearer ${SECRETO}`)).toBe(false);
    vi.stubEnv("CRON_SECRETO", SECRETO);
    expect(autorizaProceso(`Bearer ${SECRETO}`)).toBe(true);
    expect(autorizaProceso("Bearer otra-cosa")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: un correo fallido por una causa temporal se reintenta sobre la misma fila, sin duplicar", () => {
  it("una invitación que no salió sale en la corrida siguiente, con la misma clave y un enlace nuevo que sirve", async () => {
    const { admin } = await sesionDeAdmin();
    const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id);

    const resumen = await reintentarCorreosDesdeServidor();

    expect(resumen.revisados).toBeGreaterThanOrEqual(1);
    expect(resumen.enviados).toBeGreaterThanOrEqual(1);

    // La misma fila (mismo id, misma clave), ahora enviada. `intentos` sigue contando: 0 antes, 1 ahora.
    const despues = await filaDe(clave);
    expect(despues).toMatchObject({ id: envio.id, clave, plantilla: "invitacion_monitor", destinatario: correo, estado: "enviado", intentos: 1, ultimo_error: null, reintentable: false });
    expect(despues.enviado_en).not.toBeNull();
    const { data: filas } = await fx.admin.from("correo_envio").select("id").eq("destinatario", correo);
    expect(filas).toHaveLength(1);

    // Exactamente un correo en el buzón, con el asunto y el enlace de la invitación.
    const mensajes = await mensajesPara(correo);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].Subject).toBe("Crea tu cuenta de monitor en Calibra");
    expect(despues.id_proveedor).toBe(mensajes[0].ID);
    const token = tokenDe(mensajes[0]);
    expect(mensajes[0].Text).toContain(`https://calibra.test/monitores/registro?token=${token}`);

    // El enlace nuevo sirve para esa invitación y el hash guardado cambió: el token viejo (que nunca llegó) ya no vale.
    expect(await buscarInvitacion(token)).toMatchObject({ vigente: true, correo });
    const invitacionDespues = await invitacionDe(invitacion.id);
    expect(invitacionDespues.token_hash).toBe(sha256(token));
    expect(invitacionDespues.token_hash).not.toBe(invitacion.token_hash);
    // Es la misma invitación: no se creó otra, no se alargó y sigue sin usar.
    expect(invitacionDespues).toMatchObject({ id: invitacion.id, correo, id_admin: admin.id, vence_en: invitacion.vence_en, creada_en: invitacion.creada_en, usada_en: null });
    const { data: invitaciones } = await fx.admin.from("invitacion_monitor").select("id").eq("correo", correo);
    expect(invitaciones).toHaveLength(1);
  });

  it("otra corrida no manda un segundo correo ni vuelve a tocar el enlace", async () => {
    const { admin } = await sesionDeAdmin();
    const { correo, invitacion, clave } = await invitacionQueNoSalio(admin.id);
    await reintentarCorreosDesdeServidor();
    const [mensaje] = await mensajesPara(correo);
    const hashEnviado = (await invitacionDe(invitacion.id)).token_hash;
    expect(hashEnviado).toBe(sha256(tokenDe(mensaje)));

    const otra = await reintentarCorreosDesdeServidor();

    expect(otra.enviados).toBe(0);
    expect(await mensajesPara(correo)).toHaveLength(1);
    expect(await filaDe(clave)).toMatchObject({ estado: "enviado", intentos: 1 });
    // Si la volviera a reconstruir, el enlace del correo que ya salió dejaría de servir.
    expect((await invitacionDe(invitacion.id)).token_hash).toBe(hashEnviado);
    expect(await buscarInvitacion(tokenDe(mensaje))).toMatchObject({ vigente: true, correo });
  });

  it("si el proveedor sigue caído, la fila sigue fallida y reintentable (con sus intentos sumados); cuando vuelve, sale una sola vez", async () => {
    const { admin } = await sesionDeAdmin();
    const { correo, clave, envio } = await invitacionQueNoSalio(admin.id);

    // Mailpit caído: tres intentos dentro de la llamada (con sus esperas reales de unos 2 segundos).
    vi.stubEnv("MAILPIT_URL", "http://127.0.0.1:1");
    const caida = await reintentarCorreosDesdeServidor();
    expect(caida.siguenFallando).toBeGreaterThanOrEqual(1);
    const fallida = await filaDe(clave);
    expect(fallida).toMatchObject({ id: envio.id, estado: "fallido", reintentable: true, intentos: 3, enviado_en: null });
    expect(fallida.ultimo_error).toContain("Mailpit no respondió");
    expect(await mensajesPara(correo)).toEqual([]);

    // Vuelve el proveedor, pero la fila acaba de fallar: el proceso espera 2 minutos antes de volver a tomarla.
    vi.stubEnv("MAILPIT_URL", mailpit);
    await reintentarCorreosDesdeServidor();
    expect(await filaDe(clave)).toMatchObject({ estado: "fallido", reintentable: true, intentos: 3 });
    expect(await mensajesPara(correo)).toEqual([]);

    // Pasada la espera, la corrida lo manda, sobre la misma fila, y suma sus intentos.
    await envejecer(clave);
    const vuelta = await reintentarCorreosDesdeServidor();
    expect(vuelta.enviados).toBeGreaterThanOrEqual(1);
    expect(await filaDe(clave)).toMatchObject({ id: envio.id, estado: "enviado", intentos: 4, ultimo_error: null, reintentable: false });
    expect(await mensajesPara(correo)).toHaveLength(1);
    const { data: filas } = await fx.admin.from("correo_envio").select("id").eq("destinatario", correo);
    expect(filas).toHaveLength(1);
  });

  it("dos corridas a la vez sobre la misma invitación: sale un solo correo y su enlace sirve", async () => {
    const { admin } = await sesionDeAdmin();
    let tomadosPorOtro = 0;

    // Se repite: la carrera depende de cómo se intercalen las dos corridas, y antes del arreglo el enlace
    // quedaba muerto casi siempre (la corrida que no mandaba el correo cambiaba el hash después).
    for (let vuelta = 1; vuelta <= 5; vuelta++) {
      const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id);

      const [a, b] = await Promise.all([reintentarCorreosDesdeServidor(), reintentarCorreosDesdeServidor()]);
      tomadosPorOtro += a.tomadosPorOtro + b.tomadosPorOtro;

      const mensajes = await mensajesPara(correo);
      expect(mensajes, `vuelta ${vuelta}: un solo correo`).toHaveLength(1);
      const token = tokenDe(mensajes[0]);
      expect(await buscarInvitacion(token), `vuelta ${vuelta}: el enlace del correo sirve`).toMatchObject({ vigente: true, correo });
      expect((await invitacionDe(invitacion.id)).token_hash, `vuelta ${vuelta}: el hash es el del correo`).toBe(sha256(token));
      expect(await filaDe(clave), `vuelta ${vuelta}: una sola fila, enviada una vez`).toMatchObject({
        id: envio.id,
        estado: "enviado",
        intentos: 1,
        reintentable: false,
      });
      const { data: filas } = await fx.admin.from("correo_envio").select("id").eq("destinatario", correo);
      expect(filas).toHaveLength(1);
    }

    // Que las corridas lleguen a disputarse la fila depende del azar del solape: se anota, no se exige,
    // para que la prueba no falle al azar en CI. Lo que se exige arriba vale en cualquier orden.
    console.info(`[prueba] corridas que encontraron la fila tomada por la otra: ${tomadosPorOtro}`);
  }, 90_000);

  it("un fallido que acaba de fallar espera: con menos de 2 minutos no se toca, y pasado ese tiempo sale", async () => {
    const { admin } = await sesionDeAdmin();
    const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id, { esperada: false });

    await reintentarCorreosDesdeServidor();
    expect(await filaDe(clave)).toMatchObject({ estado: "fallido", reintentable: true, intentos: 0, actualizado_en: envio.actualizado_en });
    expect((await invitacionDe(invitacion.id)).token_hash).toBe(invitacion.token_hash);
    expect(await mensajesPara(correo)).toEqual([]);

    // Con 1 minuto 50 segundos todavía espera.
    await envejecer(clave, 2 * MINUTO - 10_000);
    await reintentarCorreosDesdeServidor();
    expect(await filaDe(clave)).toMatchObject({ estado: "fallido", intentos: 0 });
    expect(await mensajesPara(correo)).toEqual([]);

    // Con 2 minutos 10 segundos ya le toca.
    await envejecer(clave, 2 * MINUTO + 10_000);
    await reintentarCorreosDesdeServidor();
    expect(await filaDe(clave)).toMatchObject({ estado: "enviado", intentos: 1 });
    expect(await mensajesPara(correo)).toHaveLength(1);
  });

  it("no toca los correos que ya salieron", async () => {
    const enviado = await insertarCorreo({ plantilla: "invitacion_monitor", estado: "enviado", reintentable: true, tocadaHace: 10 * MINUTO });

    await reintentarCorreosDesdeServidor();

    expect(await filaDe(enviado.clave)).toMatchObject({ estado: "enviado", intentos: 3, ultimo_error: null });
    expect(await mensajesPara(enviado.destinatario)).toEqual([]);
  });

  it("un pendiente reciente (hace 1 minuto, o hasta 4) es de otro proceso que sigue enviando: no se toca", async () => {
    const { admin } = await sesionDeAdmin();
    for (const minutos of [1, 4]) {
      const { correo, invitacion, clave } = await invitacionQueNoSalio(admin.id, { esperada: false });
      await dejarPendiente(clave, minutos * MINUTO);

      await reintentarCorreosDesdeServidor();

      expect(await filaDe(clave), `${minutos} min`).toMatchObject({ estado: "pendiente", intentos: 0, enviado_en: null });
      expect((await invitacionDe(invitacion.id)).token_hash, `${minutos} min`).toBe(invitacion.token_hash);
      expect(await mensajesPara(correo), `${minutos} min`).toEqual([]);
    }
  });

  it("un pendiente abandonado (hace 6 minutos) de una invitación vigente se reintenta y sale una sola vez", async () => {
    const { admin } = await sesionDeAdmin();
    const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id, { esperada: false });
    // El envío se cortó a la mitad: la fila quedó pendiente, sin fallo anotado (ni `reintentable`).
    await dejarPendiente(clave, 6 * MINUTO);

    const resumen = await reintentarCorreosDesdeServidor();

    expect(resumen.enviados).toBeGreaterThanOrEqual(1);
    expect(await filaDe(clave)).toMatchObject({ id: envio.id, estado: "enviado", intentos: 1, ultimo_error: null, reintentable: false });
    const mensajes = await mensajesPara(correo);
    expect(mensajes).toHaveLength(1);
    const token = tokenDe(mensajes[0]);
    expect(await buscarInvitacion(token)).toMatchObject({ vigente: true, correo });
    expect((await invitacionDe(invitacion.id)).token_hash).toBe(sha256(token));

    // Otra corrida no lo manda de nuevo.
    await reintentarCorreosDesdeServidor();
    expect(await mensajesPara(correo)).toHaveLength(1);
    expect(await filaDe(clave)).toMatchObject({ estado: "enviado", intentos: 1 });
  });

  it("dos corridas a la vez sobre un pendiente abandonado: sale un solo correo y su enlace sirve", async () => {
    const { admin } = await sesionDeAdmin();
    const { correo, invitacion, clave } = await invitacionQueNoSalio(admin.id, { esperada: false });
    await dejarPendiente(clave, 6 * MINUTO);

    await Promise.all([reintentarCorreosDesdeServidor(), reintentarCorreosDesdeServidor()]);

    const mensajes = await mensajesPara(correo);
    expect(mensajes).toHaveLength(1);
    const token = tokenDe(mensajes[0]);
    expect(await buscarInvitacion(token)).toMatchObject({ vigente: true, correo });
    expect((await invitacionDe(invitacion.id)).token_hash).toBe(sha256(token));
    expect(await filaDe(clave)).toMatchObject({ estado: "enviado", intentos: 1 });
  });
});

describe("el lote: cada corrida toma los más antiguos, hasta 10", () => {
  it("con más de 10 candidatos en espera, una corrida revisa 10 y deja el más nuevo para la siguiente", async () => {
    // Doce fallidos de una plantilla sin reconstructor (se descartan sin enviar nada), del más viejo al más nuevo.
    const filas: Awaited<ReturnType<typeof insertarCorreo>>[] = [];
    for (let i = 0; i < 12; i++) {
      filas.push(await insertarCorreo({ plantilla: "solicitud_llave_reembolso", estado: "fallido", reintentable: true, tocadaHace: (60 - i) * MINUTO }));
    }
    const masNueva = filas[filas.length - 1];
    const reintentables = async () =>
      (await fx.admin.from("correo_envio").select("id").in("id", filas.map((f) => f.id)).eq("reintentable", true)).data?.length ?? -1;

    const primera = await reintentarCorreosDesdeServidor();

    expect(primera.revisados).toBe(10);
    expect(await filaDe(masNueva.clave)).toMatchObject({ estado: "fallido", reintentable: true });
    expect(await reintentables()).toBeGreaterThanOrEqual(2);

    // Las corridas siguientes terminan con el resto.
    for (let vuelta = 0; vuelta < 3 && (await reintentables()) > 0; vuelta++) await reintentarCorreosDesdeServidor();
    expect(await reintentables()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("criterio 2: lo definitivo, o lo que sigue fallando después de 24 horas, no se reintenta y lo ve el admin", () => {
  it("un correo fallido reintentable de hace más de 24 horas no se reintenta y aparece en la bandeja del admin", async () => {
    const { admin, cliente } = await sesionDeAdmin();
    const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id);
    await fx.admin.from("correo_envio").update({ creado_en: hace(25 * HORA) }).eq("clave", clave);

    await reintentarCorreosDesdeServidor();

    // Ni se reconstruyó (el enlace de la invitación sigue igual) ni se mandó.
    expect(await filaDe(clave)).toMatchObject({ id: envio.id, estado: "fallido", reintentable: true, intentos: 0, ultimo_error: envio.ultimo_error });
    expect((await invitacionDe(invitacion.id)).token_hash).toBe(invitacion.token_hash);
    expect(await mensajesPara(correo)).toEqual([]);

    const bandeja = await cargarBandeja(cliente, admin.id, new Date(), { maxFilas: 1_000 });
    const propio = bandeja.correosSinEnviar.find((c) => c.id === envio.id);
    expect(propio).toMatchObject({ tipo: "Invitación de monitor", destinatario: correo, error: envio.ultimo_error });
    expect(propio?.creadoEn).toEqual(new Date((await filaDe(clave)).creado_en));
  });

  it("un pendiente abandonado de hace más de 24 horas tampoco se reintenta: lo ve el admin", async () => {
    const { admin, cliente } = await sesionDeAdmin();
    const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id, { esperada: false });
    await dejarPendiente(clave, 25 * HORA);
    await fx.admin.from("correo_envio").update({ creado_en: hace(25 * HORA) }).eq("clave", clave);

    await reintentarCorreosDesdeServidor();

    expect(await filaDe(clave)).toMatchObject({ id: envio.id, estado: "pendiente", intentos: 0 });
    expect((await invitacionDe(invitacion.id)).token_hash).toBe(invitacion.token_hash);
    expect(await mensajesPara(correo)).toEqual([]);
    const bandeja = await cargarBandeja(cliente, admin.id, new Date(), { maxFilas: 1_000 });
    expect(bandeja.correosSinEnviar.find((c) => c.id === envio.id)).toMatchObject({ tipo: "Invitación de monitor", destinatario: correo, error: null });
  });

  it("la ventana se mide desde la creación: a 23 horas sí se reintenta; con el reloj 2 horas adelante ya no", async () => {
    const { admin, cliente } = await sesionDeAdmin();
    const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id);
    await fx.admin.from("correo_envio").update({ creado_en: hace(23 * HORA) }).eq("clave", clave);
    const dosHorasDespues = new Date(Date.now() + 2 * HORA);

    // Con el reloj 2 horas adelante lleva 25 horas: fuera de la ventana. No se toca y ya lo ve el admin.
    await reintentarCorreosDesdeServidor(dosHorasDespues);
    expect(await filaDe(clave)).toMatchObject({ estado: "fallido", reintentable: true, intentos: 0 });
    expect((await invitacionDe(invitacion.id)).token_hash).toBe(invitacion.token_hash);
    expect(await mensajesPara(correo)).toEqual([]);
    const tarde = await cargarBandeja(cliente, admin.id, dosHorasDespues, { maxFilas: 1_000 });
    expect(tarde.correosSinEnviar.map((c) => c.id)).toContain(envio.id);
    // Con el reloj de verdad todavía está dentro de la ventana: el admin no lo ve y el proceso sí lo manda.
    const ahora = await cargarBandeja(cliente, admin.id, new Date(), { maxFilas: 1_000 });
    expect(ahora.correosSinEnviar.map((c) => c.id)).not.toContain(envio.id);

    await reintentarCorreosDesdeServidor();
    expect(await filaDe(clave)).toMatchObject({ estado: "enviado", intentos: 1 });
    expect(await mensajesPara(correo)).toHaveLength(1);
  });

  it("la bandeja lista los fallidos definitivos, los vencidos y los pendientes de más de 24 horas; no los reintentables recientes, ni los enviados, ni los pendientes recientes", async () => {
    const definitivo = await insertarCorreo({ plantilla: "pago_rechazado_individual", estado: "fallido", reintentable: false, error: "Resend 401 invalid_api_key" });
    const definitivoViejo = await insertarCorreo({ plantilla: "escalamiento_pago", estado: "fallido", reintentable: false, hace: 30 * HORA });
    const vencido = await insertarCorreo({ plantilla: "resena_individual", estado: "fallido", reintentable: true, hace: 25 * HORA });
    const reciente = await insertarCorreo({ plantilla: "resena_individual", estado: "fallido", reintentable: true, hace: 1 * HORA });
    const casiVencido = await insertarCorreo({ plantilla: "resena_individual", estado: "fallido", reintentable: true, hace: 23 * HORA });
    const enviado = await insertarCorreo({ plantilla: "resena_individual", estado: "enviado", reintentable: false });
    const pendiente = await insertarCorreo({ plantilla: "resena_individual", estado: "pendiente" });
    const pendienteReciente = await insertarCorreo({ plantilla: "resena_individual", estado: "pendiente", hace: 1 * HORA });
    const pendienteViejo = await insertarCorreo({ plantilla: "resena_individual", estado: "pendiente", hace: 25 * HORA });
    const desconocido = await insertarCorreo({ plantilla: "plantilla_de_otra_epoca", estado: "fallido", reintentable: false });
    const { admin, cliente } = await sesionDeAdmin();

    const bandeja = await cargarBandeja(cliente, admin.id, new Date(), { maxFilas: 1_000 });

    const ids = bandeja.correosSinEnviar.map((c) => c.id);
    for (const fila of [definitivo, definitivoViejo, vencido, pendienteViejo, desconocido]) expect(ids, fila.clave).toContain(fila.id);
    for (const fila of [reciente, casiVencido, enviado, pendiente, pendienteReciente]) expect(ids, fila.clave).not.toContain(fila.id);
    expect(bandeja.contadores.correosSinEnviar).toBeGreaterThanOrEqual(5);
    expect(bandeja.contadores.correosSinEnviar).toBe(bandeja.correosSinEnviar.length); // maxFilas alto: cabe todo

    // Cada uno con su nombre legible, su destinatario, su fecha y su error.
    const propio = (id: string) => bandeja.correosSinEnviar.find((c) => c.id === id);
    expect(propio(definitivo.id)).toEqual({
      id: definitivo.id,
      tipo: "Pago rechazado (individual)",
      destinatario: definitivo.destinatario,
      creadoEn: new Date(definitivo.creado_en),
      error: "Resend 401 invalid_api_key",
    });
    expect(propio(vencido.id)?.tipo).toBe("Reseña de la monitoría");
    // Un pendiente de hace más de 24 horas es un envío que murió y ya no se reintenta: se muestra sin error.
    expect(propio(pendienteViejo.id)).toMatchObject({ tipo: "Reseña de la monitoría", destinatario: pendienteViejo.destinatario, error: null });
    expect(propio(definitivoViejo.id)?.tipo).toBe("Pago escalado a otro admin");
    // Una plantilla que ya no existe se muestra tal cual, en vez de romper la bandeja.
    expect(propio(desconocido.id)?.tipo).toBe("plantilla_de_otra_epoca");

    // Los más recientes primero.
    const fechas = bandeja.correosSinEnviar.map((c) => c.creadoEn.getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
  });

  it("todos los admins ven los mismos correos sin enviar; un monitor no ve ninguno", async () => {
    const definitivo = await insertarCorreo({ plantilla: "pago_rechazado_grupal", estado: "fallido", reintentable: false });
    const { admin: uno, cliente: deUno } = await sesionDeAdmin();
    const { admin: otro, cliente: deOtro } = await sesionDeAdmin();
    const monitor = await fx.crearMonitor();

    const delUno = await cargarBandeja(deUno, uno.id, new Date(), { maxFilas: 1_000 });
    const delOtro = await cargarBandeja(deOtro, otro.id, new Date(), { maxFilas: 1_000 });
    expect(delUno.correosSinEnviar.map((c) => c.id)).toContain(definitivo.id);
    expect(delOtro.correosSinEnviar.map((c) => c.id)).toContain(definitivo.id);

    // Las políticas de la base solo dejan leer correo_envio a los admins: el monitor recibe la lista vacía.
    const delMonitor = await cargarBandeja(await fx.iniciarSesion(monitor), uno.id, new Date());
    expect(delMonitor.correosSinEnviar).toEqual([]);
    expect(delMonitor.contadores.correosSinEnviar).toBe(0);
  });

  it("el corte de la lista no cambia el contador", async () => {
    for (let i = 0; i < 3; i++) await insertarCorreo({ plantilla: "resena_individual", estado: "fallido", reintentable: false });
    const { admin, cliente } = await sesionDeAdmin();

    const bandeja = await cargarBandeja(cliente, admin.id, new Date(), { maxFilas: 2 });

    expect(bandeja.correosSinEnviar).toHaveLength(2);
    expect(bandeja.contadores.correosSinEnviar).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("criterio 3: cada plantilla se reconstruye desde su entidad, y si la entidad ya no aplica el correo se descarta", () => {
  it("una invitación ya usada: el correo se descarta, no se manda, y el admin lo ve", async () => {
    const { admin, cliente } = await sesionDeAdmin();
    const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id);
    const usadaEn = new Date().toISOString();
    exito(await fx.admin.from("invitacion_monitor").update({ usada_en: usadaEn }).eq("id", invitacion.id).select().single(), "usar la invitación");

    const resumen = await reintentarCorreosDesdeServidor();

    expect(resumen.descartados).toBeGreaterThanOrEqual(1);
    const despues = await filaDe(clave);
    expect(despues).toMatchObject({ id: envio.id, estado: "fallido", reintentable: false, intentos: 0, enviado_en: null });
    expect(despues.ultimo_error).toContain("ya no aplica");
    expect(despues.ultimo_error!.length).toBeLessThanOrEqual(300);
    expect(await mensajesPara(correo)).toEqual([]);
    // La invitación queda como estaba: ni enlace nuevo ni se reabre.
    expect(await invitacionDe(invitacion.id)).toMatchObject({ token_hash: invitacion.token_hash, usada_en: expect.any(String) });

    // Y como ya no se reintenta, es del admin.
    const bandeja = await cargarBandeja(cliente, admin.id, new Date(), { maxFilas: 1_000 });
    expect(bandeja.correosSinEnviar.find((c) => c.id === envio.id)).toMatchObject({ tipo: "Invitación de monitor", destinatario: correo, error: despues.ultimo_error });

    // Otra corrida no vuelve a mirarlo.
    const otra = await reintentarCorreosDesdeServidor();
    expect(otra.enviados).toBe(0);
    expect(await filaDe(clave)).toMatchObject({ reintentable: false, ultimo_error: despues.ultimo_error });
  });

  it("una invitación vencida: el correo se descarta y no se manda", async () => {
    const { admin } = await sesionDeAdmin();
    const { correo, invitacion, clave } = await invitacionQueNoSalio(admin.id);
    // vence_en debe seguir siendo posterior a creada_en (check de la tabla).
    exito(
      await fx.admin.from("invitacion_monitor").update({ creada_en: hace(10 * DIA), vence_en: hace(3 * DIA) }).eq("id", invitacion.id).select().single(),
      "vencer la invitación",
    );

    const resumen = await reintentarCorreosDesdeServidor();

    expect(resumen.descartados).toBeGreaterThanOrEqual(1);
    const despues = await filaDe(clave);
    expect(despues).toMatchObject({ estado: "fallido", reintentable: false, intentos: 0 });
    expect(despues.ultimo_error).toContain("ya no aplica");
    expect(await mensajesPara(correo)).toEqual([]);
    expect((await invitacionDe(invitacion.id)).token_hash).toBe(invitacion.token_hash);
    expect(await buscarInvitacion("a".repeat(64))).toEqual({ vigente: false });
  });

  it("un pendiente abandonado cuya invitación ya se usó: queda fallido y sin reintento, y el admin lo ve", async () => {
    const { admin, cliente } = await sesionDeAdmin();
    const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id, { esperada: false });
    await dejarPendiente(clave, 6 * MINUTO);
    exito(await fx.admin.from("invitacion_monitor").update({ usada_en: new Date().toISOString() }).eq("id", invitacion.id).select().single(), "usar la invitación");

    const resumen = await reintentarCorreosDesdeServidor();

    expect(resumen.descartados).toBeGreaterThanOrEqual(1);
    // Ya no está `pendiente` (no se queda en el limbo): el descarte lo deja `fallido`, sin reintento, con el motivo.
    const despues = await filaDe(clave);
    expect(despues).toMatchObject({ id: envio.id, estado: "fallido", reintentable: false, intentos: 0, enviado_en: null });
    expect(despues.ultimo_error).toContain("ya no aplica");
    expect(await mensajesPara(correo)).toEqual([]);
    expect((await invitacionDe(invitacion.id)).token_hash).toBe(invitacion.token_hash);

    const bandeja = await cargarBandeja(cliente, admin.id, new Date(), { maxFilas: 1_000 });
    expect(bandeja.correosSinEnviar.find((c) => c.id === envio.id)).toMatchObject({ tipo: "Invitación de monitor", destinatario: correo, error: despues.ultimo_error });
  });

  it("otras causas de descarte: invitación borrada, entidad que no es un id, plantilla sin reconstructor o desconocida", async () => {
    const { admin } = await sesionDeAdmin();
    const borrada = await invitacionQueNoSalio(admin.id);
    await fx.admin.from("invitacion_monitor").delete().eq("id", borrada.invitacion.id);
    // La entidad de la clave no es un id de invitación.
    const claveSinId = `invitacion_monitor:esto-no-es-un-id-${randomUUID()}`;
    claves.push(claveSinId);
    const filaSinId = exito(
      await fx.admin
        .from("correo_envio")
        .insert({ clave: claveSinId, plantilla: "invitacion_monitor", destinatario: correoNuevo(), estado: "fallido", reintentable: true, ultimo_error: "x", actualizado_en: hace(3 * MINUTO) })
        .select()
        .single(),
      "insertar correo con entidad inválida",
    );
    const sinReconstructor = await insertarCorreo({ plantilla: "solicitud_llave_reembolso", estado: "fallido", reintentable: true, tocadaHace: 3 * MINUTO });
    const desconocida = await insertarCorreo({ plantilla: "plantilla_de_otra_epoca", estado: "fallido", reintentable: true, tocadaHace: 3 * MINUTO });
    // La clave no es de su plantilla.
    const claveAjena = `resena_individual:${randomUUID()}`;
    claves.push(claveAjena);
    const filaAjena = exito(
      await fx.admin
        .from("correo_envio")
        .insert({ clave: claveAjena, plantilla: "invitacion_monitor", destinatario: correoNuevo(), estado: "fallido", reintentable: true, ultimo_error: "x", actualizado_en: hace(3 * MINUTO) })
        .select()
        .single(),
      "insertar correo con clave de otra plantilla",
    );

    const resumen = await reintentarCorreosDesdeServidor();

    expect(resumen.descartados).toBeGreaterThanOrEqual(4);
    expect(await filaDe(borrada.clave)).toMatchObject({ estado: "fallido", reintentable: false });
    expect((await filaDe(borrada.clave)).ultimo_error).toContain("ya no aplica");
    expect(await filaDe(claveSinId)).toMatchObject({ id: filaSinId.id, estado: "fallido", reintentable: false });
    expect((await filaDe(claveSinId)).ultimo_error).toContain("ya no aplica");
    expect(await filaDe(sinReconstructor.clave)).toMatchObject({ estado: "fallido", reintentable: false });
    expect((await filaDe(sinReconstructor.clave)).ultimo_error).toContain("No hay cómo reconstruir");
    expect(await filaDe(desconocida.clave)).toMatchObject({ estado: "fallido", reintentable: false });
    expect((await filaDe(desconocida.clave)).ultimo_error).toContain("No se reconoce la plantilla");
    expect(await filaDe(claveAjena)).toMatchObject({ id: filaAjena.id, estado: "fallido", reintentable: false });
    expect((await filaDe(claveAjena)).ultimo_error).toContain("No se reconoce la plantilla o la clave");
    // Nada salió a ningún buzón.
    for (const destinatario of [borrada.correo, sinReconstructor.destinatario, desconocida.destinatario, filaSinId.destinatario, filaAjena.destinatario]) {
      expect(await mensajesPara(destinatario), destinatario).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("la ruta /api/procesos/reintentar-correos", () => {
  const SECRETO = randomBytes(32).toString("hex");
  const llamar = (encabezado?: string) =>
    POST(
      new Request("http://localhost:3000/api/procesos/reintentar-correos", {
        method: "POST",
        headers: encabezado === undefined ? {} : { authorization: encabezado },
        body: "{}",
      }),
    );

  it("sin CRON_SECRETO responde 401, aunque traiga un encabezado, y no llega a tocar la base", async () => {
    vi.stubEnv("CRON_SECRETO", "");
    // Si la ruta siguiera adelante, sin la llave de la base respondería 500: el 401 prueba que se detuvo antes.
    vi.stubEnv("SUPABASE_SECRET_KEY", "");

    const respuesta = await llamar(`Bearer ${SECRETO}`);

    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ error: "No autorizado." });
  });

  it("con CRON_SECRETO pero sin encabezado, con otro secreto o con un secreto corto, responde 401", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    for (const encabezado of [undefined, "", "Bearer ", `Bearer ${"0".repeat(SECRETO.length)}`, SECRETO, `Basic ${SECRETO}`]) {
      const respuesta = await llamar(encabezado);
      expect(respuesta.status, String(encabezado)).toBe(401);
      expect(await respuesta.json(), String(encabezado)).toEqual({ error: "No autorizado." });
    }

    const corto = "c".repeat(LARGO_MINIMO_DEL_SECRETO - 1);
    vi.stubEnv("CRON_SECRETO", corto);
    expect((await llamar(`Bearer ${corto}`)).status).toBe(401);
  });

  it("con el secreto correcto responde 200 con el resumen de la corrida", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);

    const respuesta = await llamar(`Bearer ${SECRETO}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toContain("application/json");
    const resumen = await respuesta.json();
    expect(Object.keys(resumen).sort()).toEqual(["conError", "descartados", "enviados", "pospuestos", "revisados", "siguenFallando", "tomadosPorOtro"]);
    for (const cantidad of Object.values(resumen)) expect(cantidad).toEqual(expect.any(Number));
    expect(resumen.revisados).toBe(
      resumen.enviados + resumen.siguenFallando + resumen.descartados + resumen.conError + resumen.tomadosPorOtro + resumen.pospuestos,
    );
  });

  it("la corrida por la ruta reintenta de verdad: la invitación que no salió sale, una sola vez", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    const { admin } = await sesionDeAdmin();
    const { correo, invitacion, clave } = await invitacionQueNoSalio(admin.id);

    const respuesta = await llamar(`  Bearer ${SECRETO}  `);

    expect(respuesta.status).toBe(200);
    expect((await respuesta.json()).enviados).toBeGreaterThanOrEqual(1);
    expect(await filaDe(clave)).toMatchObject({ estado: "enviado", intentos: 1 });
    const mensajes = await mensajesPara(correo);
    expect(mensajes).toHaveLength(1);
    expect(await buscarInvitacion(tokenDe(mensajes[0]))).toMatchObject({ vigente: true, correo });
    expect((await invitacionDe(invitacion.id)).token_hash).not.toBe(invitacion.token_hash);

    // Si el proceso programado llama otra vez, no hay nada más que mandar.
    const otra = await llamar(`Bearer ${SECRETO}`);
    expect(otra.status).toBe(200);
    expect((await otra.json()).enviados).toBe(0);
    expect(await mensajesPara(correo)).toHaveLength(1);
  });

  it("si la base no está disponible responde 500 sin contar por qué", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    vi.stubEnv("SUPABASE_SECRET_KEY", "");

    const respuesta = await llamar(`Bearer ${SECRETO}`);

    expect(respuesta.status).toBe(500);
    expect(await respuesta.json()).toEqual({ error: "No se pudo reintentar." });
  });
});
