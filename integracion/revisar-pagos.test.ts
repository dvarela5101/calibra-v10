import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { avisarRechazoAlPagador, cargarPagoParaRevisar, revisarPago } from "@/lib/admin/pagos";
import { casoDeRechazo, pideObservaciones, type CasoDeRechazo, type Decision } from "@/lib/admin/pagos-reglas";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { renderizar } from "@/lib/correo/plantillas";
import { reintentarCorreosDesdeServidor } from "@/lib/correo/procesos";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { SEMANAS_DEL_HORIZONTE } from "@/lib/disponibilidad/reglas";
import { cargarFechasLibres } from "@/lib/disponibilidad/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { diaIsoDeFecha, inicioDeSesion } from "@/lib/plazos/motor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-020 contra el Supabase local, por la misma ruta que la acción `revisar` de la página del pago: `revisarPago` llama
 * a `public.revisar_pago` con la sesión de verdad del admin y, si el rechazo canceló la cita, `avisarRechazoAlPagador`
 * manda el correo por Mailpit y lo anota en `correo_envio`. La acción hace lo mismo y además `exigirRol`,
 * `revalidatePath` y `redirect`, que necesitan a Next. La página lee el pago con `cargarPagoParaRevisar`. Los bordes de
 * cada resultado, con una hora fija, están en `supabase/tests/revisar_pago.test.sql`.
 *
 * Las monitorías se insertan con la llave secreta, ya confirmadas, y los pagos con `crearPagoDe`, asignados al admin de
 * la prueba: `registrar_pago` (HU-018) los asignaría al primer admin activo de la base. La cita futura cae dentro de 2
 * días a las 10:00, dentro del horizonte de la lista de fechas libres. La que ya empezó lo hizo hace 2 horas: el cierre
 * automático (24 h después del fin) no la alcanza durante la prueba.
 *
 * El Auth local deja 30 inicios de sesión cada 5 minutos y el resto de la suite ya usa muchos: este archivo inicia tres,
 * una sola vez (el admin asignado, otro admin y un monitor). Cada prueba crea y borra todo lo demás.
 *
 * Dos revisiones a la vez van con dos conexiones `pg` reales, cada una en su transacción y con el rol y el token del
 * admin, como en `integracion/expirar.test.ts`: la segunda espera el bloqueo de la primera.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;

/** El correo de consultas de datos (CORREO_DATOS_PERSONALES): el correo del rechazo lo da como contacto de soporte. */
const SOPORTE = "datos-personales@calibra.test";

/** Lo que anota el admin en el rechazo de P-24. */
const OBSERVACIONES = "Se cobra por fuera: el pagador vuelve a transferir esta semana.";

/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;

type Cuenta = { usuario: UsuarioPrueba; cliente: Cliente };
type Escenario = Awaited<ReturnType<typeof escenario>>;

let fx: Fixtures;
let cuentas: Fixtures;
let bd: pg.Client;
let mailpit: string;
/** Las tres sesiones del archivo: el admin al que se le asignan los pagos, otro admin activo y un monitor. */
let asignado: Cuenta;
let otroAdmin: Cuenta;
let monitor: Cuenta;
/** Contactos de pagador de esta prueba (buzón de Mailpit) y claves de `correo_envio` que se borran al final. */
const destinatarios: string[] = [];
const claves: string[] = [];

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  cuentas = new Fixtures();
  try {
    const cuenta = async (usuario: UsuarioPrueba): Promise<Cuenta> => ({ usuario, cliente: await cuentas.iniciarSesion(usuario) });
    asignado = await cuenta(await cuentas.crearAdmin());
    otroAdmin = await cuenta(await cuentas.crearAdmin());
    monitor = await cuenta(await cuentas.crearMonitor());
  } catch (error) {
    await cuentas.limpiar();
    throw error;
  }
});

afterAll(async () => {
  await bd?.end();
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
  for (const para of destinatarios.splice(0)) {
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

/**
 * Lo que necesita una monitoría individual: materia, monitor certificado por el admin asignado, franja y Lead. La
 * franja cae dentro de 2 días a las 10:00 y se abrió hoy, así que sus fechas salen en la lista de fechas libres
 * (HU-016). `fecha(n)` es la de la semana n: de 0 a 3, dentro del horizonte; negativa, en el pasado.
 */
async function escenario() {
  const materia = await fx.crearMateria();
  const monitorDeLaCita = await fx.crearMonitor();
  await fx.crearCertificado({ idMonitor: monitorDeLaCita.id, idMateria: materia.id, idAdmin: asignado.usuario.id });
  const primera = sumarDias(hoy(), 2);
  const franja = await fx.crearFranja({ idMonitor: monitorDeLaCita.id, dia: diaIsoDeFecha(primera), hora: "10:00", abiertaDesde: hoy() });
  const lead = await fx.crearLead();
  const fecha = (semana = 0) => sumarDias(primera, 7 * semana);
  return { contexto: { materia, monitor: monitorDeLaCita, franja, lead }, materia, franja, fecha, todas: [0, 1, 2, 3].map((n) => fecha(n)) };
}

const formatoDeHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Día, día de la semana y hora (`HH:MM:SS`) de un instante en Bogotá, tal como los guarda la base. */
function sesionEn(instante: Date): { fecha: string; dia: number; hora: string } {
  const fecha = diaDelNegocio(instante);
  const hora = formatoDeHora.format(instante);
  if (inicioDeSesion(fecha, hora).getTime() !== instante.getTime()) throw new Error(`No se pudo expresar ${instante.toISOString()} como fecha y hora de Bogotá.`);
  return { fecha, dia: diaIsoDeFecha(fecha), hora };
}

/** Una confirmada del escenario cuya sesión empezó hace `haceMs` milisegundos, en su propia franja. */
async function yaEmpezada(e: Escenario, haceMs: number) {
  if (haceMs > 20 * HORA) throw new Error("Una confirmada de la prueba no puede empezar hace más de 20 h: pg_cron la cerraría sola a mitad de la prueba.");
  const sesion = sesionEn(new Date(Math.floor(Date.now() / SEGUNDO) * SEGUNDO - haceMs));
  const franja = await fx.crearFranja({ idMonitor: e.contexto.monitor.id, dia: sesion.dia, hora: sesion.hora });
  return fx.crearMonitoria({ ...e.contexto, franja }, { fecha: sesion.fecha });
}

/**
 * Un pago en revisión de esa monitoría, asignado al admin de la prueba, con un contacto que solo existe en esta prueba:
 * así la búsqueda en Mailpit no se mezcla con otras. Anota la clave de su correo para borrar la fila al final.
 */
async function pagoEnRevision(idMonitoria: string, datos: { fechaAsignacion?: string } = {}) {
  const pago = await fx.crearPagoDe(idMonitoria, { idAdmin: asignado.usuario.id, ...datos });
  const contacto = `pagador-${randomUUID()}@calibra.test`;
  destinatarios.push(contacto);
  claves.push(claveDeCorreo("pago_rechazado_individual", pago.id));
  return exito(await fx.admin.from("pago").update({ contacto }).eq("id", pago.id).select().single(), "poner el contacto del pago");
}

/** Lo mismo que hace la acción con lo que llega del formulario (ya validado por `leerRevision`). */
const revisar = (cliente: Cliente, idPago: string, decision: Decision, observaciones: string | null = null) =>
  revisarPago(cliente, { idPago, decision, observaciones });

const pagoEnBd = async (id: string) =>
  exito(await fx.admin.from("pago").select("estado, fecha_revision, observaciones, id_admin").eq("id", id).single(), "leer el pago");

const monitoriaEnBd = async (id: string) =>
  exito(await fx.admin.from("monitoria").select("estado, motivo_cancelacion, fecha_finalizacion").eq("id", id).single(), "leer la monitoría");

/** RN-43: un pago rechazado no se reembolsa. Esta HU no crea reembolsos en ningún caso (el de P-07 es de HU-024). */
const reembolsosDe = async (idPago: string) => exito(await fx.admin.from("reembolso").select("id").eq("id_pago", idPago), "leer los reembolsos");

const correosDe = async (idPago: string) =>
  exito(await fx.admin.from("correo_envio").select("*").eq("clave", claveDeCorreo("pago_rechazado_individual", idPago)), "leer correo_envio");

const avisosDe = async (idMonitoria: string) =>
  exito(await fx.admin.from("aviso_monitor").select("evento").eq("id_monitoria", idMonitoria), "leer los avisos al monitor");

/** Los pagos que el admin asignado ve en su bandeja (HU-012). */
const pagosDeLaBandeja = async () => (await cargarBandeja(asignado.cliente, asignado.usuario.id)).pagos.map((p) => p.id);

/** Las fechas de la franja del escenario que ve un visitante sin sesión en la lista de la materia (HU-016). */
async function fechasLibresDe(e: Escenario): Promise<string[]> {
  const libres = await cargarFechasLibres(crearCliente(), e.materia.codigo, SEMANAS_DEL_HORIZONTE);
  return libres.filter((f) => f.idFranja === e.franja.id).map((f) => f.fecha);
}

/** Sin filas: el permiso se niega (error) o la RLS no deja ver ninguna; en ningún caso hay filas afectadas. */
function sinFilas(resultado: { data: unknown[] | null; error: { message: string } | null }) {
  expect(resultado.error ? [] : resultado.data).toEqual([]);
}

/** La hora de la base (la que usa `revisar_pago`), no la del proceso. */
async function relojDeLaBase(): Promise<number> {
  const { rows } = await bd.query<{ ahora: Date }>("select clock_timestamp() as ahora");
  return rows[0].ahora.getTime();
}

type Mensaje = { ID: string; Subject: string; Text: string; To: { Address: string }[] };

/** Los correos que hay en Mailpit para un destinatario, con su contenido. */
async function mensajesPara(correo: string): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

/** El correo que debe recibir el pagador de un pago del escenario (lo arma la plantilla, igual que al enviarlo). */
const correoEsperado = (fechaSesion: string) =>
  renderizar("pago_rechazado_individual", { nombre: "Pagador de prueba", monto: 25_000, fechaSesion, contactoSoporte: SOPORTE });

// ---------------------------------------------------------------------------------------------------------------
// Con `pg`: dos conexiones a la vez, cada una como la sesión del admin

/** Una conexión propia para una de las dos partes de la carrera, con su número de proceso en la base. */
async function conexion() {
  const cliente = new pg.Client({ connectionString: URL_BD });
  await cliente.connect();
  // Si algo no bloquea (o no suelta) como se espera, la consulta falla en vez de colgar la prueba.
  await cliente.query("set lock_timeout = '15s'");
  const { rows } = await cliente.query<{ pid: number }>("select pg_backend_pid() as pid");
  return { cliente, pid: rows[0].pid };
}

type Conexion = Awaited<ReturnType<typeof conexion>>;

/** Cierra las conexiones aunque tengan una consulta esperando: la base revierte su transacción y suelta los bloqueos. */
async function cerrar(...conexiones: Conexion[]) {
  await Promise.allSettled(conexiones.map((c) => c.cliente.end()));
}

/** Una consulta que se deja corriendo: se sabe si ya terminó sin esperarla, y su error no queda sin atender. */
function enCurso<T>(promesa: Promise<T>) {
  const consulta = { terminada: false, promesa };
  promesa.then(
    () => (consulta.terminada = true),
    () => (consulta.terminada = true),
  );
  return consulta;
}

/** Espera a que la conexión `pid` quede bloqueada por la conexión `porPid` (pg_blocking_pids). */
async function esperarBloqueo(pid: number, porPid: number, consulta: { terminada: boolean }) {
  const hasta = Date.now() + ESPERA_MAXIMA;
  while (Date.now() < hasta) {
    if (consulta.terminada) throw new Error(`La consulta de la conexión ${pid} terminó sin esperar a la conexión ${porPid}.`);
    const { rows } = await bd.query<{ bloqueada: boolean }>("select $2::integer = any(pg_blocking_pids($1::integer)) as bloqueada", [pid, porPid]);
    if (rows[0].bloqueada) return;
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  throw new Error(`La conexión ${pid} no quedó esperando a la conexión ${porPid} en ${ESPERA_MAXIMA} ms.`);
}

/**
 * Dentro de una transacción de `cliente`: lo que sigue corre con el rol `authenticated` y el token del admin (el
 * asignado si no se dice otro), como una llamada de la Data API con su sesión.
 */
async function comoAsignado(cliente: pg.Client, admin: Cuenta = asignado) {
  await cliente.query("set local role authenticated");
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.usuario.id, role: "authenticated" })]);
}

/** `public.revisar_pago`, la misma puerta que usa `revisarPago`, desde una conexión que ya corre como el admin. */
async function revisarEn(cliente: pg.Client, idPago: string, decision: Decision) {
  const { rows } = await cliente.query<{ resultado: string; cancelo_monitoria: boolean }>(
    "select resultado, cancelo_monitoria from public.revisar_pago($1::uuid, $2, null)",
    [idPago, decision],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: el admin abre un pago asignado y ve lo que necesita para revisarlo", () => {
  it("el asignado ve monto, pagador, contacto, referencia, la monitoría y el tiempo restante; otro admin ve lo mismo, con el nombre del asignado", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const ahora = new Date();
    const asignacion = new Date(ahora.getTime() - 20 * MINUTO);
    const pago = await pagoEnRevision(monitoria.id, { fechaAsignacion: asignacion.toISOString() });

    const leido = await cargarPagoParaRevisar(asignado.cliente, pago.id, ahora);

    expect(leido).toEqual({
      id: pago.id,
      monto: 25_000,
      nombrePagador: "Pagador de prueba",
      contacto: pago.contacto,
      // Supuesto 6: nadie la escribe todavía; la página dice "Sin referencia".
      referencia: null,
      estado: "en_revision",
      idAdmin: asignado.usuario.id,
      nombreAdmin: "Admin de prueba",
      // RN-42: una hora desde la asignación (motor de HU-003).
      revisionHasta: new Date(asignacion.getTime() + HORA),
      restante: { texto: "Quedan 40 min", vencido: false },
      fechaRevision: null,
      observaciones: null,
      monitoria: {
        estado: "confirmada",
        motivoCancelacion: null,
        fecha: e.fecha(),
        hora: "10:00:00",
        duracionMin: 60,
        nombreMateria: "Materia de prueba",
        nombreMonitor: "Monitor de prueba",
        inicio: inicioDeSesion(e.fecha(), "10:00"),
        grupal: false,
      },
    });
    // La pantalla anticipa con el inicio que leyó lo mismo que decidirá la base: rechazarlo cancela la cita.
    expect(casoDeRechazo(leido!.monitoria.estado, leido!.monitoria.inicio, ahora)).toBe("cancela_la_cita");

    // Las políticas dejan leer el pago a cualquier admin activo; las acciones solo se las da la página al asignado.
    expect(await cargarPagoParaRevisar(otroAdmin.cliente, pago.id, ahora)).toEqual(leido);
  });

  it("un monitor con su sesión no lo ve, y un pago que no existe tampoco: los dos dan null", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    expect(await cargarPagoParaRevisar(monitor.cliente, pago.id)).toBeNull();
    expect(await cargarPagoParaRevisar(asignado.cliente, randomUUID())).toBeNull();
  });

  it("supuesto 8: el pago de una grupal se marca como grupal, y aprobarlo o rechazarlo responde no_individual sin tocar nada", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: monitoria.id, cupos: 3, modalidad_pago: "unico", precio_por_persona: 10_000 }).select().single(),
      "insertar monitoria_grupal",
    );
    const pago = await pagoEnRevision(monitoria.id);

    expect((await cargarPagoParaRevisar(asignado.cliente, pago.id))?.monitoria.grupal).toBe(true);

    for (const decision of ["aprobar", "rechazar"] as const) {
      expect(await revisar(asignado.cliente, pago.id, decision), decision).toEqual({ resultado: "no_individual", canceloMonitoria: false });
    }
    expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "en_revision", fecha_revision: null, observaciones: null });
    expect(await monitoriaEnBd(monitoria.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
    expect(await correosDe(pago.id)).toEqual([]);
  });
});

describe("criterio 2: el admin aprueba un pago en revisión", () => {
  it("queda aprobado con la fecha de revisión de la base; la monitoría no cambia, no hay reembolso ni correo y el pago sale de la bandeja", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    expect(await pagosDeLaBandeja()).toEqual([pago.id]);
    const antes = await relojDeLaBase();

    const revision = await revisar(asignado.cliente, pago.id, "aprobar");

    const despues = await relojDeLaBase();
    expect(revision).toEqual({ resultado: "aprobado", canceloMonitoria: false });
    const enBd = await pagoEnBd(pago.id);
    expect(enBd).toMatchObject({ estado: "aprobado", observaciones: null, id_admin: asignado.usuario.id });
    const revisado = new Date(enBd.fecha_revision!).getTime();
    expect(revisado).toBeGreaterThanOrEqual(antes);
    expect(revisado).toBeLessThanOrEqual(despues);

    expect(await monitoriaEnBd(monitoria.id)).toEqual({ estado: "confirmada", motivo_cancelacion: null, fecha_finalizacion: null });
    expect(await reembolsosDe(pago.id)).toEqual([]);
    expect(await correosDe(pago.id)).toEqual([]);
    expect(await pagosDeLaBandeja()).toEqual([]);
    // La página lo pinta ya revisado, con su fecha (y sin acciones).
    expect(await cargarPagoParaRevisar(asignado.cliente, pago.id)).toMatchObject({ estado: "aprobado", fechaRevision: new Date(enBd.fecha_revision!) });
  });

  it("§5.2, sin vuelta atrás: aprobar otra vez o rechazar después responde ya_revisado y no mueve ni el estado ni la fecha de revisión", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    expect((await revisar(asignado.cliente, pago.id, "aprobar")).resultado).toBe("aprobado");
    const aprobado = await pagoEnBd(pago.id);

    expect(await revisar(asignado.cliente, pago.id, "aprobar")).toEqual({ resultado: "ya_revisado", canceloMonitoria: false });
    expect(await revisar(asignado.cliente, pago.id, "rechazar", OBSERVACIONES)).toEqual({ resultado: "ya_revisado", canceloMonitoria: false });

    expect(await pagoEnBd(pago.id)).toEqual(aprobado);
    expect(await monitoriaEnBd(monitoria.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
  });
});

describe("criterios 3 y 5: el admin rechaza el pago de una cita que aún no empieza", () => {
  it("el pago queda rechazado, la cita cancelada por pago_rechazado y su fecha vuelve a la lista; sin reembolso ni aviso al monitor, y al pagador le llega el correo con la clave del pago", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    // Confirmada, ocupa su fecha (HU-017).
    expect(await fechasLibresDe(e)).toEqual(e.todas.slice(1));
    const antes = await relojDeLaBase();

    const revision = await revisar(asignado.cliente, pago.id, "rechazar");

    const despues = await relojDeLaBase();
    expect(revision).toEqual({ resultado: "rechazado", canceloMonitoria: true });
    const enBd = await pagoEnBd(pago.id);
    expect(enBd).toMatchObject({ estado: "rechazado", observaciones: null });
    const revisado = new Date(enBd.fecha_revision!).getTime();
    expect(revisado).toBeGreaterThanOrEqual(antes);
    expect(revisado).toBeLessThanOrEqual(despues);
    expect(await monitoriaEnBd(monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "pago_rechazado", fecha_finalizacion: null });

    // Lo que hace la acción después: el aviso al pagador (supuesto 4), solo porque el rechazo canceló la cita.
    expect(await avisarRechazoAlPagador(pago.id)).toBe("enviado");

    const [fila, ...otras] = await correosDe(pago.id);
    expect(otras).toEqual([]);
    expect(fila).toMatchObject({ plantilla: "pago_rechazado_individual", destinatario: pago.contacto, estado: "enviado", intentos: 1, ultimo_error: null });
    const mensajes = await mensajesPara(pago.contacto);
    expect(mensajes).toHaveLength(1);
    expect(fila.id_proveedor).toBe(mensajes[0].ID);
    expect(mensajes[0].To.map((t) => t.Address)).toEqual([pago.contacto]);
    const esperado = correoEsperado(e.fecha());
    expect(mensajes[0].Subject).toBe(esperado.asunto);
    // El correo viaja con saltos de línea CRLF (retorno de carro más salto); el contenido es el mismo.
    expect(mensajes[0].Text.split(String.fromCharCode(13)).join("").trim()).toBe(esperado.texto.trim());

    // La fecha quedó libre para otra persona: el índice y la lista solo cuentan las que no están canceladas.
    expect(await fechasLibresDe(e)).toEqual(e.todas);
    expect(await reembolsosDe(pago.id)).toEqual([]);
    // Supuesto 5: al monitor no se le avisa del rechazo; lo ve en su agenda.
    expect(await avisosDe(monitoria.id)).toEqual([]);
    expect(await pagosDeLaBandeja()).toEqual([]);
  });

  it("guarda las observaciones si el admin las escribe, y un segundo aviso (la acción repetida) no manda otro correo", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    expect(await revisar(asignado.cliente, pago.id, "rechazar", "  El comprobante es de otra cuenta.  ")).toEqual({ resultado: "rechazado", canceloMonitoria: true });
    expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "rechazado", observaciones: "El comprobante es de otra cuenta." });

    expect(await avisarRechazoAlPagador(pago.id)).toBe("enviado");
    expect(await avisarRechazoAlPagador(pago.id)).toBe("enviado");

    expect(await mensajesPara(pago.contacto)).toHaveLength(1);
    expect(await correosDe(pago.id)).toMatchObject([{ estado: "enviado", intentos: 1 }]);
  });
});

describe("criterio 7 (P-24, supuestos 2 y 3): rechazar el pago de una monitoría realizada o que ya empezó", () => {
  const casos: [string, (e: Escenario) => Promise<{ id: string }>, CasoDeRechazo][] = [
    [
      "realizada",
      (e) => fx.crearMonitoria(e.contexto, { fecha: e.fecha(-4), estado: "realizada", fechaFinalizacion: `${e.fecha(-4)}T16:00:00+00:00` }),
      "ya_realizada",
    ],
    ["confirmada que empezó hace 2 horas", (e) => yaEmpezada(e, 2 * HORA), "ya_empezo"],
  ];

  it.each(casos)(
    "%s: sin observaciones responde observaciones_requeridas y no toca nada; con ellas el pago queda rechazado con el caso anotado, la monitoría no cambia y no se escribe al pagador",
    async (_monitoria, crear, caso) => {
      const e = await escenario();
      const monitoria = await crear(e);
      const pago = await pagoEnRevision(monitoria.id);
      const antes = await monitoriaEnBd(monitoria.id);
      // La pantalla pide las observaciones por lo mismo que las exige la base.
      const leido = await cargarPagoParaRevisar(asignado.cliente, pago.id);
      expect(casoDeRechazo(leido!.monitoria.estado, leido!.monitoria.inicio, new Date())).toBe(caso);
      expect(pideObservaciones(caso)).toBe(true);

      expect(await revisar(asignado.cliente, pago.id, "rechazar")).toEqual({ resultado: "observaciones_requeridas", canceloMonitoria: false });
      expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "en_revision", fecha_revision: null, observaciones: null });
      expect(await monitoriaEnBd(monitoria.id)).toEqual(antes);

      expect(await revisar(asignado.cliente, pago.id, "rechazar", OBSERVACIONES)).toEqual({ resultado: "rechazado", canceloMonitoria: false });
      const enBd = await pagoEnBd(pago.id);
      expect(enBd).toMatchObject({ estado: "rechazado", observaciones: OBSERVACIONES });
      expect(enBd.fecha_revision).not.toBeNull();
      expect(await monitoriaEnBd(monitoria.id)).toEqual(antes);

      // La acción no llama al aviso (no canceló la cita); aunque se llamara, o lo reintentara HU-065, no aplica.
      expect(await avisarRechazoAlPagador(pago.id)).toBeNull();
      expect(await correosDe(pago.id)).toEqual([]);
      expect(await mensajesPara(pago.contacto)).toEqual([]);
      expect(await reembolsosDe(pago.id)).toEqual([]);
    },
  );
});

describe("supuesto 1: solo revisa el admin asignado", () => {
  it("otro admin activo recibe no_asignado al aprobar y al rechazar, y nada cambia", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    expect(await revisar(otroAdmin.cliente, pago.id, "aprobar")).toEqual({ resultado: "no_asignado", canceloMonitoria: false });
    expect(await revisar(otroAdmin.cliente, pago.id, "rechazar", OBSERVACIONES)).toEqual({ resultado: "no_asignado", canceloMonitoria: false });

    expect(await pagoEnBd(pago.id)).toEqual({ estado: "en_revision", fecha_revision: null, observaciones: null, id_admin: asignado.usuario.id });
    expect(await monitoriaEnBd(monitoria.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
  });

  it("un monitor recibe sin_permiso y, sin sesión, la base ni siquiera ejecuta la función; nada cambia", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    expect(await revisar(monitor.cliente, pago.id, "aprobar")).toEqual({ resultado: "sin_permiso", canceloMonitoria: false });
    await expect(revisar(crearCliente(), pago.id, "aprobar")).rejects.toThrow(/No se pudo revisar el pago: 42501/);

    expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "en_revision", fecha_revision: null });
  });

  it("nadie escribe directo en pago: ni el admin asignado con su sesión puede actualizarlo o borrarlo por la Data API", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    sinFilas(await asignado.cliente.from("pago").update({ estado: "aprobado", fecha_revision: new Date().toISOString() }).eq("id", pago.id).select());
    sinFilas(await asignado.cliente.from("pago").delete().eq("id", pago.id).select());

    expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "en_revision", fecha_revision: null });
  });
});

describe("dos revisiones del mismo pago a la vez (doble clic o dos pestañas)", () => {
  // Dos conexiones, cada una en su transacción con el rol y el token del admin asignado. La primera revisa y se queda
  // con los bloqueos de la monitoría y del pago; la segunda espera el de la monitoría y, cuando la primera confirma,
  // lee el pago ya revisado.
  async function carrera(primera: Decision, segunda: Decision) {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    const a = await conexion();
    const b = await conexion();
    try {
      await a.cliente.query("begin");
      await comoAsignado(a.cliente);
      const ganadora = await revisarEn(a.cliente, pago.id, primera);

      await b.cliente.query("begin");
      await comoAsignado(b.cliente);
      const perdedora = enCurso(revisarEn(b.cliente, pago.id, segunda));
      await esperarBloqueo(b.pid, a.pid, perdedora);

      await a.cliente.query("commit");
      expect(await perdedora.promesa).toEqual({ resultado: "ya_revisado", cancelo_monitoria: false });
      await b.cliente.query("commit");
      return { ganadora, pago: await pagoEnBd(pago.id), monitoria: await monitoriaEnBd(monitoria.id) };
    } finally {
      await cerrar(a, b);
    }
  }

  it(
    "la aprobación llega primero: el rechazo espera el bloqueo y responde ya_revisado; el pago queda aprobado y la cita sigue confirmada",
    async () => {
      const { ganadora, pago, monitoria } = await carrera("aprobar", "rechazar");

      expect(ganadora).toEqual({ resultado: "aprobado", cancelo_monitoria: false });
      expect(pago).toMatchObject({ estado: "aprobado", observaciones: null });
      expect(pago.fecha_revision).not.toBeNull();
      expect(monitoria).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
    },
    60_000,
  );

  it(
    "el rechazo llega primero: la aprobación espera el bloqueo y responde ya_revisado; el pago queda rechazado y la cita cancelada por pago_rechazado",
    async () => {
      const { ganadora, pago, monitoria } = await carrera("rechazar", "aprobar");

      expect(ganadora).toEqual({ resultado: "rechazado", cancelo_monitoria: true });
      expect(pago).toMatchObject({ estado: "rechazado" });
      expect(pago.fecha_revision).not.toBeNull();
      expect(monitoria).toMatchObject({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });
    },
    60_000,
  );

  it(
    "supuesto 1: mientras el asignado revisa, otro admin recibe no_asignado sin esperar sus bloqueos (la autorización se lee sin candado)",
    async () => {
      const e = await escenario();
      const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
      const pago = await pagoEnRevision(monitoria.id);

      const a = await conexion();
      const b = await conexion();
      try {
        await a.cliente.query("begin");
        await comoAsignado(a.cliente);
        expect(await revisarEn(a.cliente, pago.id, "rechazar")).toEqual({ resultado: "rechazado", cancelo_monitoria: true });

        // A tiene la monitoría y el pago bloqueados. Si B intentara tomarlos, el lock_timeout corto lo haría fallar
        // con 55P03 en vez de responder.
        await b.cliente.query("begin");
        await b.cliente.query("set local lock_timeout = '500ms'");
        await comoAsignado(b.cliente, otroAdmin);
        expect(await revisarEn(b.cliente, pago.id, "aprobar")).toEqual({ resultado: "no_asignado", cancelo_monitoria: false });
        await b.cliente.query("commit");

        await a.cliente.query("commit");
      } finally {
        await cerrar(a, b);
      }
      expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "rechazado", id_admin: asignado.usuario.id });
    },
    60_000,
  );
});

describe("HU-065: el correo del rechazo se reconstruye para reintentarlo", () => {
  it("el reconstructor registrado arma el correo del pago rechazado; da null para uno aprobado, uno con la cita ya cancelada por el estudiante y uno que no existe", async () => {
    const reconstruir = RECONSTRUCTORES.pago_rechazado_individual;
    if (!reconstruir) throw new Error("pago_rechazado_individual no tiene reconstructor.");
    const e = await escenario();

    const cancelada = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(0) });
    const rechazado = await pagoEnRevision(cancelada.id);
    expect((await revisar(asignado.cliente, rechazado.id, "rechazar")).canceloMonitoria).toBe(true);
    expect(await reconstruir(rechazado.id)).toEqual({
      destinatario: rechazado.contacto,
      datos: { nombre: "Pagador de prueba", monto: 25_000, fechaSesion: e.fecha(0), contactoSoporte: SOPORTE },
    });

    const confirmada = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(1) });
    const aprobado = await pagoEnRevision(confirmada.id);
    expect((await revisar(asignado.cliente, aprobado.id, "aprobar")).resultado).toBe("aprobado");
    expect(await reconstruir(aprobado.id)).toBeNull();

    // docs/reparto.md (2-oct): con la cita ya cancelada por el estudiante solo cambia el pago, y no se le escribe.
    const delEstudiante = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(2), estado: "cancelada" });
    const deCanceladaPorEstudiante = await pagoEnRevision(delEstudiante.id);
    expect(await revisar(asignado.cliente, deCanceladaPorEstudiante.id, "rechazar")).toEqual({ resultado: "rechazado", canceloMonitoria: false });
    expect(await monitoriaEnBd(delEstudiante.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    expect(await reconstruir(deCanceladaPorEstudiante.id)).toBeNull();
    expect(await reembolsosDe(deCanceladaPorEstudiante.id)).toEqual([]);

    expect(await reconstruir(randomUUID())).toBeNull();
    expect(await reconstruir("no-es-un-uuid")).toBeNull();
  });

  it("si el correo no sale (sin proveedor), queda por reintentar y la corrida de HU-065 lo manda una sola vez, sobre la misma fila", async () => {
    // Los fallos esperados (proveedor sin configurar) se anotan en la consola; aquí no ensucian la salida.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    expect((await revisar(asignado.cliente, pago.id, "rechazar")).canceloMonitoria).toBe(true);

    vi.stubEnv("MAILPIT_URL", "");
    expect(await avisarRechazoAlPagador(pago.id)).toBe("por_reintentar");
    vi.stubEnv("MAILPIT_URL", mailpit);
    const [fallida] = await correosDe(pago.id);
    expect(fallida).toMatchObject({ estado: "fallido", reintentable: true, intentos: 0, destinatario: pago.contacto, enviado_en: null });
    expect(await mensajesPara(pago.contacto)).toEqual([]);

    // El proceso solo toma un fallido que lleva 2 minutos sin tocarse.
    exito(
      await fx.admin
        .from("correo_envio")
        .update({ actualizado_en: new Date(Date.now() - 3 * MINUTO).toISOString() })
        .eq("id", fallida.id)
        .select("id")
        .single(),
      "envejecer el correo",
    );
    const resumen = await reintentarCorreosDesdeServidor();

    expect(resumen.enviados).toBeGreaterThanOrEqual(1);
    const filas = await correosDe(pago.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: fallida.id, estado: "enviado", intentos: 1, ultimo_error: null });
    const mensajes = await mensajesPara(pago.contacto);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].Subject).toBe(correoEsperado(e.fecha()).asunto);
  });
});
