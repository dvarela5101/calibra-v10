import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/procesos/avisar-rechazos/route";
import { procesarAvisosDeRechazoDePago } from "@/lib/admin/avisos-rechazo";
import { revisarPago } from "@/lib/admin/pagos";
import { procesarAvisosAlMonitor } from "@/lib/avisos/servidor";
import { cancelarCitaPorToken } from "@/lib/citas/cancelar";
import { MAXIMO_DE_INTENTOS } from "@/lib/citas/servidor";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { renderizar } from "@/lib/correo/plantillas";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { reintentarCorreosFallidos } from "@/lib/correo/reintentos";
import { enviarCorreoDesdeServidor } from "@/lib/correo/servidor";
import { diaDelNegocio, formatearFechaHora } from "@/lib/fechas";
import { diaIsoDeFecha, inicioDeSesion } from "@/lib/plazos/motor";
import { exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-076 contra el Supabase local y Mailpit: el admin rechaza un pago por `revisarPago` con su sesión de verdad, la base
 * anota en la misma transacción la fila de `aviso_rechazo_pago` (al pagador) y el aviso `pago_rechazado` de `aviso_monitor`
 * (al monitor), y los procesadores (`procesarAvisosDeRechazoDePago` y `procesarAvisosAlMonitor`, el mismo código de las
 * rutas `/api/procesos/avisar-rechazos` y `/api/procesos/avisar-monitores`) mandan los correos por Mailpit. En local no hay
 * configuración en Vault, así que la base no llama a la app: la prueba llama los procesos.
 *
 * Cada prueba crea y borra su propio monitor (con su buzón), pagos con un contacto que solo existe en ella y la cita del
 * lunes que corresponda; el admin que revisa se crea y entra una sola vez (el Auth local deja 30 inicios cada 5 minutos).
 * Las corridas de los procesos toman cualquier aviso pendiente de la base (lotes de 10): se repiten hasta que el de la
 * prueba queda procesado, y cada prueba borra lo suyo (las filas de la bandeja de salida caen en cascada con el pago).
 */

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;

/** El correo de consultas de datos (CORREO_DATOS_PERSONALES): lo dan los correos del pagador como contacto de soporte. */
const SOPORTE = "datos-personales@calibra.test";

const OBSERVACIONES = "Se cobra por fuera: el pagador vuelve a transferir esta semana.";

const ASUNTO_DEL_MONITOR = "Se canceló tu monitoría de Materia de prueba";
const ASUNTO_SIN_REEMBOLSO = "No pudimos verificar tu pago y no hay reembolso";
const ASUNTO_CITA_CANCELADA = "No pudimos verificar tu pago y la monitoría se canceló";
/** Lo que distingue el aviso del rechazo del aviso de cancelación del estudiante, que tiene el mismo asunto. */
const FRASE_DEL_PAGO = "Fue porque no se pudo verificar el pago.";

type Escenario = Awaited<ReturnType<typeof escenario>>;
type Mensaje = { ID: string; Subject: string; Text: string; HTML: string; To: { Address: string }[] };

let fx: Fixtures;
let cuentas: Fixtures;
let mailpit: string;
let admin: UsuarioPrueba;
let sesionAdmin: Cliente;
/** Buzones de esta prueba (pagadores y monitores) y claves de `correo_envio` que se borran al final de cada una. */
const buzones: string[] = [];
const claves: string[] = [];

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  cuentas = new Fixtures();
  try {
    admin = await cuentas.crearAdmin();
    sesionAdmin = await cuentas.iniciarSesion(admin);
  } catch (error) {
    await cuentas.limpiar();
    throw error;
  }
}, 60_000);

afterAll(async () => {
  // Después de los pagos de cada prueba: pago.id_admin no cae en cascada.
  await cuentas?.limpiar();
});

beforeEach(() => {
  fx = new Fixtures();
  // Nunca Resend ni Gmail (aunque quien corre las pruebas tenga la llave): el correo sale por Mailpit.
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("SMTP_CONTRASENA", "");
  vi.stubEnv("CORREO_REMITENTE", "");
  vi.stubEnv("MAILPIT_URL", mailpit);
  vi.stubEnv("CORREO_DATOS_PERSONALES", SOPORTE);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  const propias = claves.splice(0);
  if (propias.length) await fx.admin.from("correo_envio").delete().in("clave", propias);
  for (const para of buzones.splice(0)) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`, { method: "DELETE" });
  }
  await fx.limpiar();
});

// ---------------------------------------------------------------------------------------------------------------

/** `AAAA-MM-DD` más `dias` días (aritmética de calendario, sin zona). */
function sumarDias(fecha: string, dias: number): string {
  const instante = new Date(`${fecha}T12:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

const hoy = () => diaDelNegocio(new Date());

/** Texto con los espacios duros y los saltos CRLF de Mailpit como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s+/g, " ").trim();

/**
 * Lo que necesita una monitoría individual: materia, monitor certificado por el admin (con su correo en
 * `monitor_privado`, que es adonde va el aviso), franja de las 10:00 y Lead. La cita cae dentro de 2 días: lejos de
 * cualquier proceso programado y a más de 12 h, así que el estudiante todavía puede cancelarla.
 */
async function escenario() {
  const materia = await fx.crearMateria();
  const monitor = await fx.crearMonitor();
  buzones.push(monitor.correo);
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
  const primera = sumarDias(hoy(), 2);
  const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: diaIsoDeFecha(primera), hora: "10:00", abiertaDesde: hoy() });
  const lead = await fx.crearLead();
  const fecha = (semana = 0) => sumarDias(primera, 7 * semana);
  return { contexto: { materia, monitor, franja, lead }, materia, monitor, lead, fecha };
}

/** Una confirmada del escenario cuya sesión empezó hace `haceMs` milisegundos, en su propia franja. */
async function yaEmpezada(e: Escenario, haceMs: number) {
  if (haceMs > 20 * HORA) throw new Error("Una confirmada de la prueba no puede empezar hace más de 20 h: pg_cron la cerraría sola a mitad de la prueba.");
  const instante = new Date(Math.floor(Date.now() / SEGUNDO) * SEGUNDO - haceMs);
  const fecha = diaDelNegocio(instante);
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(instante);
  if (inicioDeSesion(fecha, hora).getTime() !== instante.getTime()) throw new Error(`No se pudo expresar ${instante.toISOString()} como fecha y hora de Bogotá.`);
  const franja = await fx.crearFranja({ idMonitor: e.monitor.id, dia: diaIsoDeFecha(fecha), hora });
  return fx.crearMonitoria({ ...e.contexto, franja }, { fecha });
}

/**
 * Un pago en revisión de esa monitoría, asignado al admin de la prueba, con un contacto que solo existe en esta prueba:
 * así la búsqueda en Mailpit no se mezcla con otras. Anota las claves de sus correos para borrar las filas al final.
 */
async function pagoEnRevision(idMonitoria: string) {
  const pago = await fx.crearPagoDe(idMonitoria, { idAdmin: admin.id });
  const contacto = `pagador-${randomUUID()}@calibra.test`;
  buzones.push(contacto);
  claves.push(claveDeCorreo("pago_rechazado_individual", pago.id), claveDeCorreo("pago_rechazado_sin_reembolso", pago.id));
  claves.push(claveDeCorreo("aviso_monitor_pago_rechazado", idMonitoria), claveDeCorreo("aviso_monitor_cancelada", idMonitoria));
  return exito(await fx.admin.from("pago").update({ contacto }).eq("id", pago.id).select().single(), "poner el contacto del pago");
}

/** Lo mismo que hace la acción con lo que llega del formulario (ya validado por `leerRevision`). */
const rechazar = (idPago: string, observaciones: string | null = null) => revisarPago(sesionAdmin, { idPago, decision: "rechazar", observaciones });

const monitoriaEnBd = async (id: string) =>
  exito(await fx.admin.from("monitoria").select("estado, motivo_cancelacion").eq("id", id).single(), "leer la monitoría");

const reembolsosDe = async (idPago: string) => exito(await fx.admin.from("reembolso").select("id").eq("id_pago", idPago), "leer los reembolsos");

/** La fila de la bandeja de salida del pagador (una por pago rechazado). */
const avisosDeRechazo = async (idPago: string) =>
  exito(await fx.admin.from("aviso_rechazo_pago").select("caso, procesado_en, intentos").eq("id_pago", idPago), "leer aviso_rechazo_pago");

const avisosDelMonitor = async (idMonitoria: string) =>
  exito(await fx.admin.from("aviso_monitor").select("evento, procesado_en, intentos").eq("id_monitoria", idMonitoria).order("creado_en"), "leer aviso_monitor");

const eventosDe = async (idMonitoria: string) => (await avisosDelMonitor(idMonitoria)).map((a) => a.evento);

const registroDe = async (plantilla: "pago_rechazado_individual" | "pago_rechazado_sin_reembolso" | "aviso_monitor_pago_rechazado", entidad: string) =>
  exito(
    await fx.admin.from("correo_envio").select("estado, destinatario, reintentable, intentos, plantilla").eq("clave", claveDeCorreo(plantilla, entidad)),
    "leer correo_envio",
  );

/** Los correos que hay en Mailpit para un destinatario, con su contenido. */
async function mensajesPara(correo: string): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

/** Corre el procesador del pagador hasta que la fila de ese pago queda procesada (puede haber otras pendientes en la base). */
async function procesarRechazosHasta(idPago: string) {
  for (let i = 0; i < 10; i++) {
    await procesarAvisosDeRechazoDePago({ cliente: fx.admin });
    const [fila] = await avisosDeRechazo(idPago);
    if (!fila || fila.procesado_en !== null) return;
  }
  throw new Error(`El aviso del rechazo del pago ${idPago} no se procesó tras 10 corridas.`);
}

/** Lo mismo con el procesador del monitor, hasta que los avisos de esa monitoría quedan procesados. */
async function procesarAvisosDelMonitorHasta(idMonitoria: string) {
  for (let i = 0; i < 10; i++) {
    await procesarAvisosAlMonitor({ cliente: fx.admin });
    if ((await avisosDelMonitor(idMonitoria)).every((a) => a.procesado_en !== null)) return;
  }
  throw new Error(`Los avisos de la monitoría ${idMonitoria} no se procesaron tras 10 corridas.`);
}

/** El correo que debe recibir el pagador cuando la cita se canceló por el rechazo (lo arma la plantilla, igual que al enviarlo). */
const correoDelPagador = (fechaSesion: string) =>
  renderizar("pago_rechazado_individual", { nombre: "Pagador de prueba", monto: 25_000, fechaSesion, contactoSoporte: SOPORTE });

/** El que recibe cuando la cita ya estaba cancelada por el estudiante. */
const correoSinReembolso = (fechaSesion: string) =>
  renderizar("pago_rechazado_sin_reembolso", { nombre: "Pagador de prueba", monto: 25_000, fechaSesion, contactoSoporte: SOPORTE });

/** Confirma el contenido de un mensaje del pagador contra la plantilla (el correo viaja con CRLF: mismo contenido). */
function expectCorreoDelPagador(mensaje: Mensaje, esperado: { asunto: string; texto: string }, destinatario: string) {
  expect(mensaje.To.map((t) => t.Address)).toEqual([destinatario]);
  expect(mensaje.Subject).toBe(esperado.asunto);
  expect(normalizar(mensaje.Text)).toBe(normalizar(esperado.texto));
  expect(mensaje.Text).toContain("Hola, Pagador de prueba");
  expect(mensaje.Text).toContain(SOPORTE);
}

/** Confirma el aviso al monitor: asunto, la frase del pago, el día y la hora de la cita y el enlace a la agenda; nada del estudiante ni plata (P-37). */
function expectAvisoAlMonitor(mensaje: Mensaje, e: Escenario, fecha: string, pago: { contacto: string }) {
  expect(mensaje.Subject).toBe(ASUNTO_DEL_MONITOR);
  const texto = normalizar(mensaje.Text);
  expect(texto).toContain("Hola, Monitor de prueba.");
  expect(texto).toContain(`Se canceló la monitoría de Materia de prueba del ${normalizar(formatearFechaHora(inicioDeSesion(fecha, "10:00")))}`);
  expect(texto).toContain(FRASE_DEL_PAGO);
  expect(texto).toContain("No tienes que hacer nada: ya no aparece entre tus próximas monitorías.");
  expect(texto).toContain("/monitor/agenda");
  for (const privado of [e.lead.correo, e.lead.nombre, e.lead.numero_telefono, pago.contacto].filter(Boolean) as string[]) {
    expect(mensaje.Text).not.toContain(privado);
    expect(mensaje.HTML).not.toContain(privado);
  }
  expect(mensaje.Text).not.toContain("$");
  expect(mensaje.HTML).not.toContain("$");
  expect(mensaje.Text).not.toContain("25.000");
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterios 1, 2 y 4: rechazar el pago de una cita que no empieza", () => {
  it("anota el aviso del pagador y el del monitor al rechazar, y los procesos mandan un correo a cada uno: al pagador (con soporte) y al monitor (sin contacto del estudiante ni montos); repetir la corrida no los repite", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    expect(await rechazar(pago.id)).toEqual({ resultado: "rechazado", canceloMonitoria: true });

    // Todo se anotó con el rechazo, antes de que ningún proceso corra: el pago, la cita y los dos avisos.
    expect(await monitoriaEnBd(monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });
    expect(await avisosDeRechazo(pago.id)).toEqual([{ caso: "cita_cancelada", procesado_en: null, intentos: 0 }]);
    expect(await eventosDe(monitoria.id)).toEqual(["pago_rechazado"]);
    expect(await registroDe("pago_rechazado_individual", pago.id)).toEqual([]);
    expect(await mensajesPara(pago.contacto)).toEqual([]);
    expect(await mensajesPara(e.monitor.correo)).toEqual([]);
    expect(await reembolsosDe(pago.id)).toEqual([]);

    await procesarRechazosHasta(pago.id);
    await procesarAvisosDelMonitorHasta(monitoria.id);

    const alPagador = await mensajesPara(pago.contacto);
    expect(alPagador).toHaveLength(1);
    expectCorreoDelPagador(alPagador[0], correoDelPagador(e.fecha()), pago.contacto);
    expect(alPagador[0].Subject).toBe(ASUNTO_CITA_CANCELADA);
    expect(await registroDe("pago_rechazado_individual", pago.id)).toEqual([
      { estado: "enviado", destinatario: pago.contacto, reintentable: false, intentos: 1, plantilla: "pago_rechazado_individual" },
    ]);

    const alMonitor = await mensajesPara(e.monitor.correo);
    expect(alMonitor).toHaveLength(1);
    expectAvisoAlMonitor(alMonitor[0], e, e.fecha(), pago);
    expect(await registroDe("aviso_monitor_pago_rechazado", monitoria.id)).toMatchObject([
      { estado: "enviado", destinatario: e.monitor.correo, plantilla: "aviso_monitor_pago_rechazado" },
    ]);

    // Los dos avisos quedaron procesados; otra corrida no manda nada otra vez.
    expect((await avisosDeRechazo(pago.id))[0].procesado_en).not.toBeNull();
    expect((await avisosDelMonitor(monitoria.id)).every((a) => a.procesado_en !== null)).toBe(true);
    await procesarAvisosDeRechazoDePago({ cliente: fx.admin });
    await procesarAvisosAlMonitor({ cliente: fx.admin });
    expect(await mensajesPara(pago.contacto)).toHaveLength(1);
    expect(await mensajesPara(e.monitor.correo)).toHaveLength(1);
    expect(await reembolsosDe(pago.id)).toEqual([]);
  });

  it("dos corridas a la vez sobre los mismos avisos mandan un solo correo al pagador y uno al monitor", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    expect((await rechazar(pago.id)).canceloMonitoria).toBe(true);

    await Promise.all([
      procesarAvisosDeRechazoDePago({ cliente: fx.admin }),
      procesarAvisosDeRechazoDePago({ cliente: fx.admin }),
      procesarAvisosAlMonitor({ cliente: fx.admin }),
      procesarAvisosAlMonitor({ cliente: fx.admin }),
    ]);
    // Si una corrida se topó con la otra, el aviso queda para la siguiente.
    await procesarRechazosHasta(pago.id);
    await procesarAvisosDelMonitorHasta(monitoria.id);

    expect(await mensajesPara(pago.contacto)).toHaveLength(1);
    expect(await mensajesPara(e.monitor.correo)).toHaveLength(1);
    expect(await registroDe("pago_rechazado_individual", pago.id)).toHaveLength(1);
    expect(await registroDe("aviso_monitor_pago_rechazado", monitoria.id)).toHaveLength(1);
  });

  it("supuesto 3: una reserva por pagar (defensivo) avisa al pagador pero no al monitor; supuesto 2: el rechazo de un segundo pago de una cita ya cancelada por el rechazo del primero también avisa al pagador, y el monitor se entera una sola vez", async () => {
    const e = await escenario();
    const porPagar = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(0), estado: "pendiente_pago" });
    const dePorPagar = await pagoEnRevision(porPagar.id);
    expect(await rechazar(dePorPagar.id)).toEqual({ resultado: "rechazado", canceloMonitoria: true });
    expect(await monitoriaEnBd(porPagar.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });
    expect((await avisosDeRechazo(dePorPagar.id)).map((a) => a.caso)).toEqual(["cita_cancelada"]);
    expect(await eventosDe(porPagar.id)).toEqual([]);

    const confirmada = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(1) });
    const primero = await pagoEnRevision(confirmada.id);
    const segundo = await pagoEnRevision(confirmada.id);
    expect((await rechazar(primero.id)).canceloMonitoria).toBe(true);
    expect(await rechazar(segundo.id)).toEqual({ resultado: "rechazado", canceloMonitoria: false });
    expect((await avisosDeRechazo(primero.id)).map((a) => a.caso)).toEqual(["cita_cancelada"]);
    expect((await avisosDeRechazo(segundo.id)).map((a) => a.caso)).toEqual(["cita_cancelada"]);
    expect(await eventosDe(confirmada.id)).toEqual(["pago_rechazado"]);

    for (const pago of [dePorPagar, primero, segundo]) await procesarRechazosHasta(pago.id);
    await procesarAvisosDelMonitorHasta(confirmada.id);

    for (const pago of [dePorPagar, primero, segundo]) {
      const correos = await mensajesPara(pago.contacto);
      expect(correos, pago.id).toHaveLength(1);
      expect(correos[0].Subject).toBe(ASUNTO_CITA_CANCELADA);
    }
    // Solo la confirmada avisó al monitor, y una sola vez.
    const alMonitor = await mensajesPara(e.monitor.correo);
    expect(alMonitor).toHaveLength(1);
    expect(normalizar(alMonitor[0].Text)).toContain(FRASE_DEL_PAGO);
  });
});

describe("criterio 5: rechazar el pago de una cita que el estudiante ya canceló", () => {
  /** Una cita que el estudiante canceló con el enlace de su correo de confirmación, con un pago que sigue en revisión. */
  async function canceladaPorElEstudiante(e: Escenario) {
    // Pendiente de pago y luego confirmada, como lo hace `registrar_pago`: el trigger de HU-019 le anota su token.
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(), estado: "pendiente_pago" });
    exito(await fx.admin.from("monitoria").update({ estado: "confirmada" }).eq("id", monitoria.id).select().single(), "confirmar la monitoría");
    const pago = await pagoEnRevision(monitoria.id);
    const { token } = exito(await fx.admin.from("confirmacion_cita").select("token").eq("id_monitoria", monitoria.id).single(), "leer la confirmación");
    expect(await cancelarCitaPorToken(token)).toBe("cancelada");
    expect(await monitoriaEnBd(monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    return { monitoria, pago };
  }

  it("el pago se rechaza sin tocar la cita y sin reembolso; el pagador recibe el correo corto «no hay reembolso» y el monitor no recibe el del pago (ya se enteró con la cancelación del estudiante)", async () => {
    const e = await escenario();
    const { monitoria, pago } = await canceladaPorElEstudiante(e);
    // Se confirmó y el estudiante la canceló: el monitor tiene los avisos de HU-051 (el de confirmada ya no vale), y ninguno del pago.
    expect(await eventosDe(monitoria.id)).toEqual(["confirmada", "cancelada"]);

    expect(await rechazar(pago.id)).toEqual({ resultado: "rechazado", canceloMonitoria: false });

    expect(await monitoriaEnBd(monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    expect(await avisosDeRechazo(pago.id)).toEqual([{ caso: "cita_ya_cancelada", procesado_en: null, intentos: 0 }]);
    expect(await eventosDe(monitoria.id)).toEqual(["confirmada", "cancelada"]);
    expect(await reembolsosDe(pago.id)).toEqual([]);

    await procesarRechazosHasta(pago.id);
    await procesarAvisosDelMonitorHasta(monitoria.id);

    const alPagador = await mensajesPara(pago.contacto);
    expect(alPagador).toHaveLength(1);
    expectCorreoDelPagador(alPagador[0], correoSinReembolso(e.fecha()), pago.contacto);
    expect(alPagador[0].Subject).toBe(ASUNTO_SIN_REEMBOLSO);
    expect(await registroDe("pago_rechazado_sin_reembolso", pago.id)).toEqual([
      { estado: "enviado", destinatario: pago.contacto, reintentable: false, intentos: 1, plantilla: "pago_rechazado_sin_reembolso" },
    ]);
    // La plantilla de la cita cancelada por el rechazo no sale: aquí la cancelación fue otra.
    expect(await registroDe("pago_rechazado_individual", pago.id)).toEqual([]);

    // El monitor recibió el aviso de la cancelación del estudiante, y ninguno del pago (criterio 3 de HU-051, sin cambios).
    const alMonitor = await mensajesPara(e.monitor.correo);
    expect(alMonitor.some((m) => normalizar(m.Text).includes(FRASE_DEL_PAGO))).toBe(false);
    expect(await registroDe("aviso_monitor_pago_rechazado", monitoria.id)).toEqual([]);
    expect(await reembolsosDe(pago.id)).toEqual([]);
  });
});

describe("criterio 6 (P-24): rechazar el pago de una sesión que ya empezó o se realizó", () => {
  const casos: [string, (e: Escenario) => Promise<{ id: string }>][] = [
    ["realizada", (e) => fx.crearMonitoria(e.contexto, { fecha: e.fecha(-4), estado: "realizada", fechaFinalizacion: `${e.fecha(-4)}T16:00:00+00:00` })],
    ["confirmada que empezó hace 2 horas", (e) => yaEmpezada(e, 2 * HORA)],
  ];

  it.each(casos)("%s: ni fila para el pagador ni aviso para el monitor, y los procesos no mandan ningún correo", async (_caso, crear) => {
    const e = await escenario();
    const monitoria = await crear(e);
    const pago = await pagoEnRevision(monitoria.id);
    const antes = await monitoriaEnBd(monitoria.id);

    expect(await rechazar(pago.id, OBSERVACIONES)).toEqual({ resultado: "rechazado", canceloMonitoria: false });

    expect(await monitoriaEnBd(monitoria.id)).toEqual(antes);
    expect(await avisosDeRechazo(pago.id)).toEqual([]);
    expect(await avisosDelMonitor(monitoria.id)).toEqual([]);

    await procesarAvisosDeRechazoDePago({ cliente: fx.admin });
    await procesarAvisosAlMonitor({ cliente: fx.admin });

    expect(await mensajesPara(pago.contacto)).toEqual([]);
    expect(await mensajesPara(e.monitor.correo)).toEqual([]);
    expect(await registroDe("pago_rechazado_individual", pago.id)).toEqual([]);
    expect(await registroDe("pago_rechazado_sin_reembolso", pago.id)).toEqual([]);
    expect(await registroDe("aviso_monitor_pago_rechazado", monitoria.id)).toEqual([]);
    expect(await reembolsosDe(pago.id)).toEqual([]);
  });
});

describe("criterio 3: el aviso al monitor, con retraso, solo sale si todavía vale", () => {
  it("si la sesión ya empezó cuando corre el proceso, el aviso se descarta y se marca procesado, sin correo", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    expect((await rechazar(pago.id)).canceloMonitoria).toBe(true);
    expect(await eventosDe(monitoria.id)).toEqual(["pago_rechazado"]);

    // El proceso tardó: la sesión pasó (se mueve la fecha de la cita, que ya está cancelada, a hace dos semanas).
    exito(await fx.admin.from("monitoria").update({ fecha: e.fecha(-2) }).eq("id", monitoria.id).select().single(), "mover la fecha a una pasada");

    await procesarAvisosDelMonitorHasta(monitoria.id);

    expect(await mensajesPara(e.monitor.correo)).toEqual([]);
    expect(await registroDe("aviso_monitor_pago_rechazado", monitoria.id)).toEqual([]);
    const [aviso] = await avisosDelMonitor(monitoria.id);
    expect(aviso.procesado_en).not.toBeNull();
  });

  it("si la cita quedó cancelada por otro motivo, el aviso se descarta y se marca procesado, sin correo", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    expect((await rechazar(pago.id)).canceloMonitoria).toBe(true);

    exito(
      await fx.admin.from("monitoria").update({ motivo_cancelacion: "monitor_no_asistio" }).eq("id", monitoria.id).select().single(),
      "cambiar el motivo de la cancelación",
    );

    await procesarAvisosDelMonitorHasta(monitoria.id);

    expect(await mensajesPara(e.monitor.correo)).toEqual([]);
    expect((await avisosDelMonitor(monitoria.id)).map((a) => a.evento)).toEqual(["pago_rechazado"]);
    expect((await avisosDelMonitor(monitoria.id))[0].procesado_en).not.toBeNull();
  });
});

describe("criterio 4: si el envío falla, HU-065 lo reintenta", () => {
  const SIN_PROVEEDOR = "http://127.0.0.1:1";

  /** El reintento toma los fallidos que llevan 2 minutos quietos: se corre con un "ahora" 3 minutos adelante. */
  const reintentar = () =>
    reintentarCorreosFallidos({ cliente: fx.admin, reconstructores: RECONSTRUCTORES, enviar: enviarCorreoDesdeServidor, ahora: new Date(Date.now() + 3 * MINUTO) });

  it("con el proveedor caído quedan fallidos el correo al pagador y el del monitor, con sus avisos procesados; la corrida de reintentos manda cada uno una sola vez, sobre la misma fila", async () => {
    // Los fallos esperados (proveedor caído) se anotan en la consola; aquí no ensucian la salida.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    expect((await rechazar(pago.id)).canceloMonitoria).toBe(true);

    vi.stubEnv("MAILPIT_URL", SIN_PROVEEDOR);
    await procesarRechazosHasta(pago.id);
    await procesarAvisosDelMonitorHasta(monitoria.id);
    vi.stubEnv("MAILPIT_URL", mailpit);

    // Ya procesados (el registro de correos tiene el fallido) y sin mensajes en el buzón.
    expect((await avisosDeRechazo(pago.id))[0].procesado_en).not.toBeNull();
    expect(await mensajesPara(pago.contacto)).toEqual([]);
    expect(await mensajesPara(e.monitor.correo)).toEqual([]);
    const [fallidoPagador] = await registroDe("pago_rechazado_individual", pago.id);
    const [fallidoMonitor] = await registroDe("aviso_monitor_pago_rechazado", monitoria.id);
    expect(fallidoPagador).toMatchObject({ estado: "fallido", reintentable: true, destinatario: pago.contacto });
    expect(fallidoMonitor).toMatchObject({ estado: "fallido", reintentable: true, destinatario: e.monitor.correo });

    const resumen = await reintentar();
    expect(resumen.enviados).toBeGreaterThanOrEqual(2);

    // La misma fila: el reintento suma un intento a los que ya llevaba.
    expect(await registroDe("pago_rechazado_individual", pago.id)).toMatchObject([{ estado: "enviado", intentos: fallidoPagador.intentos + 1 }]);
    expect(await registroDe("aviso_monitor_pago_rechazado", monitoria.id)).toMatchObject([{ estado: "enviado", intentos: fallidoMonitor.intentos + 1 }]);
    const alPagador = await mensajesPara(pago.contacto);
    expect(alPagador).toHaveLength(1);
    expectCorreoDelPagador(alPagador[0], correoDelPagador(e.fecha()), pago.contacto);
    const alMonitor = await mensajesPara(e.monitor.correo);
    expect(alMonitor).toHaveLength(1);
    expectAvisoAlMonitor(alMonitor[0], e, e.fecha(), pago);

    // Otra corrida de reintentos no los manda otra vez.
    await reintentar();
    expect(await mensajesPara(pago.contacto)).toHaveLength(1);
    expect(await mensajesPara(e.monitor.correo)).toHaveLength(1);
  }, 60_000);

  it("el correo «no hay reembolso» de una cita ya cancelada por el estudiante también se reconstruye y se manda una sola vez", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(), estado: "pendiente_pago" });
    exito(await fx.admin.from("monitoria").update({ estado: "confirmada" }).eq("id", monitoria.id).select().single(), "confirmar la monitoría");
    const pago = await pagoEnRevision(monitoria.id);
    const { token } = exito(await fx.admin.from("confirmacion_cita").select("token").eq("id_monitoria", monitoria.id).single(), "leer la confirmación");
    expect(await cancelarCitaPorToken(token)).toBe("cancelada");
    expect(await rechazar(pago.id)).toEqual({ resultado: "rechazado", canceloMonitoria: false });

    vi.stubEnv("MAILPIT_URL", SIN_PROVEEDOR);
    await procesarRechazosHasta(pago.id);
    vi.stubEnv("MAILPIT_URL", mailpit);
    const [fallido] = await registroDe("pago_rechazado_sin_reembolso", pago.id);
    expect(fallido).toMatchObject({ estado: "fallido", reintentable: true, destinatario: pago.contacto });
    expect(await mensajesPara(pago.contacto)).toEqual([]);

    await reintentar();

    expect(await registroDe("pago_rechazado_sin_reembolso", pago.id)).toMatchObject([{ estado: "enviado", intentos: fallido.intentos + 1 }]);
    const alPagador = await mensajesPara(pago.contacto);
    expect(alPagador).toHaveLength(1);
    expectCorreoDelPagador(alPagador[0], correoSinReembolso(e.fecha()), pago.contacto);
  }, 60_000);

  it("los reconstructores registrados dan null cuando el aviso ya no aplica: un pago aprobado, uno que no existe y un id que no es uuid", async () => {
    const reconstruirIndividual = RECONSTRUCTORES.pago_rechazado_individual;
    const reconstruirSinReembolso = RECONSTRUCTORES.pago_rechazado_sin_reembolso;
    const reconstruirDelMonitor = RECONSTRUCTORES.aviso_monitor_pago_rechazado;
    if (!reconstruirIndividual || !reconstruirSinReembolso || !reconstruirDelMonitor) throw new Error("Falta un reconstructor del rechazo de pago.");
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    expect((await revisarPago(sesionAdmin, { idPago: pago.id, decision: "aprobar", observaciones: null })).resultado).toBe("aprobado");

    for (const reconstruir of [reconstruirIndividual, reconstruirSinReembolso]) {
      expect(await reconstruir(pago.id)).toBeNull();
      expect(await reconstruir(randomUUID())).toBeNull();
      expect(await reconstruir("no-es-un-uuid")).toBeNull();
    }
    // La cita sigue confirmada: no hay nada que avisarle al monitor.
    expect(await reconstruirDelMonitor(monitoria.id)).toBeNull();
    expect(await reconstruirDelMonitor(randomUUID())).toBeNull();
    expect(await reconstruirDelMonitor("no-es-un-uuid")).toBeNull();
  });

  it("sin registro de correos el aviso del pagador queda pendiente y suma un intento; al llegar al máximo se abandona", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    expect((await rechazar(pago.id)).canceloMonitoria).toBe(true);
    const sinRegistro = async () => ({ ok: false as const, motivo: "fallo_del_registro" as const, error: "sin conexión", intentos: 0 });
    const intentosDe = async () => ({ ...(await avisosDeRechazo(pago.id))[0] }) as { intentos: number; procesado_en: string | null };

    const primera = await procesarAvisosDeRechazoDePago({ cliente: fx.admin, enviar: sinRegistro });
    expect(primera.conError).toBeGreaterThanOrEqual(1);
    expect(await intentosDe()).toMatchObject({ intentos: 1, procesado_en: null });

    for (let i = 1; i < MAXIMO_DE_INTENTOS; i++) await procesarAvisosDeRechazoDePago({ cliente: fx.admin, enviar: sinRegistro });
    const final = await intentosDe();
    expect(final.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(final.procesado_en).not.toBeNull();
    expect(await mensajesPara(pago.contacto)).toEqual([]);
  });
});

describe("la ruta /api/procesos/avisar-rechazos", () => {
  const SECRETO = randomBytes(32).toString("hex");
  const llamar = (encabezado?: string) =>
    POST(
      new Request("http://localhost:3000/api/procesos/avisar-rechazos", {
        method: "POST",
        headers: encabezado === undefined ? {} : { authorization: encabezado },
        body: "{}",
      }),
    );

  it("sin el secreto del proceso programado, o con otro, responde 401 y no toca la base", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("CRON_SECRETO", "");
    expect((await llamar(`Bearer ${SECRETO}`)).status).toBe(401);
    vi.stubEnv("CRON_SECRETO", SECRETO);
    for (const encabezado of [undefined, "", `Bearer ${"0".repeat(SECRETO.length)}`, SECRETO]) {
      const respuesta = await llamar(encabezado);
      expect(respuesta.status, String(encabezado)).toBe(401);
      expect(await respuesta.json()).toEqual({ error: "No autorizado." });
    }
  });

  it("con el secreto correcto procesa los avisos del rechazo y responde el resumen", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    expect((await rechazar(pago.id)).canceloMonitoria).toBe(true);

    const respuesta = await llamar(`Bearer ${SECRETO}`);

    expect(respuesta.status).toBe(200);
    const resumen = await respuesta.json();
    expect(Object.keys(resumen).sort()).toEqual(["conError", "descartadas", "enviadas", "fallidas", "pospuestas", "revisadas", "tomadasPorOtro"]);
    expect(resumen.revisadas).toBe(resumen.enviadas + resumen.descartadas + resumen.fallidas + resumen.tomadasPorOtro + resumen.conError + resumen.pospuestas);
    // El lote es de 10 y pueden quedar avisos de otras pruebas: se completa hasta que el de esta queda procesado.
    await procesarRechazosHasta(pago.id);
    expect((await avisosDeRechazo(pago.id))[0].procesado_en).not.toBeNull();
    expect(await mensajesPara(pago.contacto)).toHaveLength(1);
  });
});
