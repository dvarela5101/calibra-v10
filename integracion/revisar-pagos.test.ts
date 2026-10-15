import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { cargarPagoParaRevisar, reconstruirPagoRechazadoSinReembolso, revisarPago } from "@/lib/admin/pagos";
import { casoDeRechazo, pideObservaciones, type CasoDeRechazo, type Decision } from "@/lib/admin/pagos-reglas";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { SEMANAS_DEL_HORIZONTE } from "@/lib/disponibilidad/reglas";
import { cargarFechasLibres } from "@/lib/disponibilidad/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { diaIsoDeFecha, inicioDeSesion } from "@/lib/plazos/motor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-020 contra el Supabase local, por la misma ruta que la acción `revisar` de la página del pago: `revisarPago` llama
 * a `public.revisar_pago` con la sesión de verdad del admin. La acción hace lo mismo y además `exigirRol`,
 * `revalidatePath` y `redirect`, que necesitan a Next. La página lee el pago con `cargarPagoParaRevisar`. Los bordes de
 * cada resultado, con una hora fija, están en `supabase/tests/revisar_pago.test.sql`.
 *
 * HU-076: la acción ya no manda el correo del rechazo. La base lo anota en la misma transacción del rechazo (la fila de
 * `aviso_rechazo_pago` para el pagador y el aviso `pago_rechazado` de `aviso_monitor`) y lo mandan los procesos: aquí
 * solo se comprueba lo anotado; el envío, el reintento y las rutas están en `integracion/avisos-rechazo.test.ts`.
 *
 * Las monitorías se insertan con la llave secreta, ya confirmadas, y los pagos con `crearPagoDe`, con el admin de la
 * prueba como responsable: `registrar_pago` (HU-018) los asignaría al primer admin activo de la base. La cita futura cae dentro de 2
 * días a las 10:00, dentro del horizonte de la lista de fechas libres. La que ya empezó lo hizo hace 2 horas: el cierre
 * automático (24 h después del fin) no la alcanza durante la prueba.
 *
 * El Auth local deja 30 inicios de sesión cada 5 minutos y el resto de la suite ya usa muchos: este archivo inicia tres,
 * una sola vez (el admin responsable, otro admin y un monitor). Cada prueba crea y borra todo lo demás.
 *
 * Dos revisiones a la vez van con dos conexiones `pg` reales, cada una en su transacción y con el rol y el token del
 * admin, como en `integracion/expirar.test.ts`: la segunda espera el bloqueo de la primera.
 *
 * HU-034 (D-56, que cambia a HU-077): el pago es de una bandeja común. Cualquier admin activo lo aprueba o lo rechaza
 * desde el primer minuto, sea o no su responsable (`pago.id_admin`), y queda quién lo revisó (`pago.id_admin_revisor`).
 * La base nunca responde `no_asignado` y no hay hora: el pago se inserta con `fecha_pago` de ahora, de hace una hora o de
 * hace días, y las reglas son las mismas. Las revisiones a la vez con un tercer admin no necesitan iniciar sesión: la
 * conexión `pg` toma su id. Que un admin desactivado mientras espera el bloqueo recibe `sin_permiso` lo prueba la
 * carrera que lo desactiva, igual que HU-082 en `integracion/gestionar-reembolsos.test.ts`.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** El correo de consultas de datos (CORREO_DATOS_PERSONALES): el correo del rechazo lo da como contacto de soporte. */
const SOPORTE = "datos-personales@calibra.test";

/** Lo que anota el admin en el rechazo de P-24. */
const OBSERVACIONES = "Se cobra por fuera: el pagador vuelve a transferir esta semana.";

/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;

/** El otro admin se llama distinto del responsable, para saber de quién es cada nombre que muestra la página. */
const NOMBRE_DEL_OTRO_ADMIN = "Otro admin de prueba";

/** Unas observaciones que no caben en `pago.observaciones` (500 caracteres). */
const OBSERVACIONES_LARGAS = "a".repeat(501);

type Cuenta = { usuario: UsuarioPrueba; cliente: Cliente };
/** Un admin que solo revisa desde una conexión `pg`: basta su id, sin sesión de Auth. */
type Admin = Pick<Cuenta, "usuario">;
type Escenario = Awaited<ReturnType<typeof escenario>>;

let fx: Fixtures;
let cuentas: Fixtures;
let bd: pg.Client;
let mailpit: string;
/** Las tres sesiones del archivo: el admin responsable de los pagos, otro admin activo y un monitor. */
let asignado: Cuenta;
let otroAdmin: Cuenta;
let monitor: Cuenta;
/** Un tercer admin activo, sin sesión, para dos revisiones a la vez de admins que no son el responsable. */
let tercerAdmin: Admin;
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
    tercerAdmin = { usuario: await cuentas.crearAdmin() };
    exito(
      await cuentas.admin.from("admin").update({ nombre: NOMBRE_DEL_OTRO_ADMIN }).eq("id", otroAdmin.usuario.id).select().single(),
      "nombrar al otro admin",
    );
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
 * Un pago en revisión de esa monitoría, con el admin de la prueba como responsable, con un contacto que solo existe en
 * esta prueba: así la búsqueda en Mailpit no se mezcla con otras. Anota la clave de su correo para borrar la fila al
 * final. `fechaPago`: cuándo llegó (la de la base, la de ahora, si no se dice).
 */
async function pagoEnRevision(idMonitoria: string, datos: { fechaPago?: string } = {}) {
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
  exito(await fx.admin.from("pago").select("estado, fecha_revision, observaciones, id_admin, id_admin_revisor").eq("id", id).single(), "leer el pago");

/** Un pago que llegó hace `ms` milisegundos. D-56: no cambia nada de quién lo revisa ni cómo, pero sí su lugar en la bandeja. */
const llegoHace = (ms: number) => ({ fechaPago: new Date(Date.now() - ms).toISOString() });

const monitoriaEnBd = async (id: string) =>
  exito(await fx.admin.from("monitoria").select("estado, motivo_cancelacion, fecha_finalizacion").eq("id", id).single(), "leer la monitoría");

/** RN-43: un pago rechazado no se reembolsa. Esta HU no crea reembolsos en ningún caso (el de P-07 es de HU-024). */
const reembolsosDe = async (idPago: string) => exito(await fx.admin.from("reembolso").select("id").eq("id_pago", idPago), "leer los reembolsos");

const correosDe = async (idPago: string) =>
  exito(await fx.admin.from("correo_envio").select("*").eq("clave", claveDeCorreo("pago_rechazado_individual", idPago)), "leer correo_envio");

const avisosDe = async (idMonitoria: string) =>
  exito(await fx.admin.from("aviso_monitor").select("evento").eq("id_monitoria", idMonitoria), "leer los avisos al monitor");

/** HU-076: la fila de la bandeja de salida del pagador que la base anota al rechazar el pago (D-39 d). */
const avisosDeRechazo = async (idPago: string) =>
  exito(await fx.admin.from("aviso_rechazo_pago").select("caso, procesado_en, intentos").eq("id_pago", idPago), "leer aviso_rechazo_pago");

/** Los pagos que el admin responsable tiene entre los suyos en su bandeja (HU-012). */
const pagosDeLaBandeja = async () => (await cargarBandeja(asignado.cliente, asignado.usuario.id)).pagos.map((p) => p.id);

/**
 * La bandeja del otro admin (HU-034): sus pagos y, aparte, los de otros admins. Cualquier admin ve los pagos en revisión
 * de todos, así que de esa lista solo se miran los pagos de esta prueba.
 */
async function bandejaDelOtroAdmin(...deLaPrueba: { id: string }[]) {
  const bandeja = await cargarBandeja(otroAdmin.cliente, otroAdmin.usuario.id, new Date(), { maxFilas: 1_000 });
  return {
    suyos: bandeja.pagos.map((p) => p.id),
    deOtros: bandeja.pagosDeOtros.filter((p) => deLaPrueba.some((q) => q.id === p.id)),
  };
}

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
async function comoAsignado(cliente: pg.Client, admin: Admin = asignado) {
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

/** Una revisión de `admin` en su propia conexión y transacción (basta su id, sin sesión de Auth), como la Data API. */
async function revisarComo(admin: Admin, idPago: string, decision: Decision) {
  const c = await conexion();
  try {
    await c.cliente.query("begin");
    await comoAsignado(c.cliente, admin);
    const revision = await revisarEn(c.cliente, idPago, decision);
    await c.cliente.query("commit");
    return revision;
  } finally {
    await cerrar(c);
  }
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: el admin abre un pago en revisión y ve lo que necesita para revisarlo", () => {
  it("el responsable ve monto, pagador, contacto, referencia, la monitoría y cuándo llegó; otro admin ve lo mismo, con el nombre del responsable", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const ahora = new Date();
    const llegada = new Date(ahora.getTime() - 20 * MINUTO);
    const pago = await pagoEnRevision(monitoria.id, { fechaPago: llegada.toISOString() });

    const leido = await cargarPagoParaRevisar(asignado.cliente, pago.id);

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
      // HU-034: cuándo llegó (`fecha_pago`, que pone la base). Sin plazo: ya no hay hora para revisarlo (D-56).
      llegoEn: llegada,
      fechaRevision: null,
      // HU-077: en revisión todavía nadie lo revisó.
      idAdminRevisor: null,
      nombreAdminRevisor: null,
      observaciones: null,
      // HU-078: en revisión no es un caso P-24, así que no tiene cierre.
      cierre: null,
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

    // Las políticas dejan leer el pago a cualquier admin activo, y la página le da las acciones a todos desde que llega.
    expect(await cargarPagoParaRevisar(otroAdmin.cliente, pago.id)).toEqual(leido);
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
    // HU-077 (criterio 3): queda quién lo revisó; aquí, el mismo asignado.
    expect(enBd).toMatchObject({ estado: "aprobado", observaciones: null, id_admin: asignado.usuario.id, id_admin_revisor: asignado.usuario.id });
    const revisado = new Date(enBd.fecha_revision!).getTime();
    expect(revisado).toBeGreaterThanOrEqual(antes);
    expect(revisado).toBeLessThanOrEqual(despues);

    expect(await monitoriaEnBd(monitoria.id)).toEqual({ estado: "confirmada", motivo_cancelacion: null, fecha_finalizacion: null });
    expect(await reembolsosDe(pago.id)).toEqual([]);
    expect(await correosDe(pago.id)).toEqual([]);
    expect(await pagosDeLaBandeja()).toEqual([]);
    // La página lo pinta ya revisado, con su fecha y (HU-077) quién lo revisó, sin acciones.
    expect(await cargarPagoParaRevisar(asignado.cliente, pago.id)).toMatchObject({
      estado: "aprobado",
      fechaRevision: new Date(enBd.fecha_revision!),
      idAdmin: asignado.usuario.id,
      idAdminRevisor: asignado.usuario.id,
      nombreAdminRevisor: "Admin de prueba",
    });
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
  it("el pago queda rechazado, la cita cancelada por pago_rechazado y su fecha vuelve a la lista; sin reembolso, y en la misma transacción se anotan el aviso del monitor y la fila del pagador (el correo lo manda el proceso, HU-076)", async () => {
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
    expect(enBd).toMatchObject({ estado: "rechazado", observaciones: null, id_admin: asignado.usuario.id, id_admin_revisor: asignado.usuario.id });
    const revisado = new Date(enBd.fecha_revision!).getTime();
    expect(revisado).toBeGreaterThanOrEqual(antes);
    expect(revisado).toBeLessThanOrEqual(despues);
    expect(await monitoriaEnBd(monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "pago_rechazado", fecha_finalizacion: null });

    // HU-076 (criterio 4): la acción ya no manda el correo. La base anotó, con el rechazo, la fila del pagador (cita
    // cancelada por este rechazo) y, para el monitor, el aviso `pago_rechazado` de la cita que estaba confirmada. Nada
    // salió todavía: ni correo registrado ni mensaje en el buzón.
    expect(await avisosDeRechazo(pago.id)).toEqual([{ caso: "cita_cancelada", procesado_en: null, intentos: 0 }]);
    expect(await avisosDe(monitoria.id)).toEqual([{ evento: "pago_rechazado" }]);
    expect(await correosDe(pago.id)).toEqual([]);
    expect(await mensajesPara(pago.contacto)).toEqual([]);

    // La fecha quedó libre para otra persona: el índice y la lista solo cuentan las que no están canceladas.
    expect(await fechasLibresDe(e)).toEqual(e.todas);
    expect(await reembolsosDe(pago.id)).toEqual([]);
    expect(await pagosDeLaBandeja()).toEqual([]);
  });

  it("guarda las observaciones si el admin las escribe, y repetir la acción (ya_revisado) no anota un segundo aviso", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    expect(await revisar(asignado.cliente, pago.id, "rechazar", "  El comprobante es de otra cuenta.  ")).toEqual({ resultado: "rechazado", canceloMonitoria: true });
    expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "rechazado", observaciones: "El comprobante es de otra cuenta." });

    expect(await revisar(asignado.cliente, pago.id, "rechazar", "  El comprobante es de otra cuenta.  ")).toEqual({ resultado: "ya_revisado", canceloMonitoria: false });

    expect(await avisosDeRechazo(pago.id)).toHaveLength(1);
    expect(await avisosDe(monitoria.id)).toEqual([{ evento: "pago_rechazado" }]);
    expect(await correosDe(pago.id)).toEqual([]);
    expect(await mensajesPara(pago.contacto)).toEqual([]);
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
    "%s: sin observaciones responde observaciones_requeridas y no toca nada; con ellas el pago queda rechazado con el caso anotado, la monitoría no cambia y no se anota ningún aviso, ni al pagador ni al monitor",
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

      // HU-076 (criterio 6): la base no anota nada (la cita no se canceló), así que ningún proceso escribe; y aunque
      // HU-065 lo intentara, el reconstructor da null con una cita que no está cancelada.
      expect(await avisosDeRechazo(pago.id)).toEqual([]);
      expect(await avisosDe(monitoria.id)).toEqual([]);
      expect(await RECONSTRUCTORES.pago_rechazado_individual?.(pago.id)).toBeNull();
      expect(await RECONSTRUCTORES.pago_rechazado_sin_reembolso?.(pago.id)).toBeNull();
      expect(await correosDe(pago.id)).toEqual([]);
      expect(await mensajesPara(pago.contacto)).toEqual([]);
      expect(await reembolsosDe(pago.id)).toEqual([]);
    },
  );
});

describe("D-56 (HU-034, que cambia a HU-020 y HU-077): cualquier admin activo revisa el pago desde el primer minuto", () => {
  it.each([
    ["recién llegado", 0],
    ["llegó hace 59 min", 59 * MINUTO],
    ["llegó hace 3 días", 3 * DIA],
  ])(
    "%s: otro admin activo, que no es el responsable, aprueba un pago y rechaza otro con las mismas reglas que el responsable; nunca responde no_asignado, también con observaciones que no caben",
    async (_caso, hace) => {
      const e = await escenario();
      const paraAprobar = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(0) });
      const paraRechazar = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(1) });
      const aprobado = await pagoEnRevision(paraAprobar.id, llegoHace(hace));
      const rechazado = await pagoEnRevision(paraRechazar.id, llegoHace(hace));

      // Antes que nada: el texto que no cabe lo dice la base, a este admin como a cualquiera (cambia la nota de D-39).
      expect(await revisar(otroAdmin.cliente, rechazado.id, "rechazar", OBSERVACIONES_LARGAS)).toEqual({ resultado: "observaciones_invalidas", canceloMonitoria: false });
      expect(await pagoEnBd(rechazado.id)).toEqual({ estado: "en_revision", fecha_revision: null, observaciones: null, id_admin: asignado.usuario.id, id_admin_revisor: null });

      expect(await revisar(otroAdmin.cliente, aprobado.id, "aprobar")).toEqual({ resultado: "aprobado", canceloMonitoria: false });
      expect(await revisar(otroAdmin.cliente, rechazado.id, "rechazar")).toEqual({ resultado: "rechazado", canceloMonitoria: true });

      // El responsable no cambia; queda quién revisó.
      expect(await pagoEnBd(aprobado.id)).toMatchObject({ estado: "aprobado", id_admin: asignado.usuario.id, id_admin_revisor: otroAdmin.usuario.id });
      expect(await pagoEnBd(rechazado.id)).toMatchObject({ estado: "rechazado", id_admin: asignado.usuario.id, id_admin_revisor: otroAdmin.usuario.id });
      expect(await monitoriaEnBd(paraAprobar.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
      expect(await monitoriaEnBd(paraRechazar.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });
    },
  );

  it("un monitor recibe sin_permiso y, sin sesión, la base ni siquiera ejecuta la función; nada cambia", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    expect(await revisar(monitor.cliente, pago.id, "aprobar")).toEqual({ resultado: "sin_permiso", canceloMonitoria: false });
    await expect(revisar(crearCliente(), pago.id, "aprobar")).rejects.toThrow(/No se pudo revisar el pago: 42501/);

    expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "en_revision", fecha_revision: null });
  });

  it("un admin desactivado, aunque conserve su token, recibe sin_permiso al aprobar y al rechazar y no cambia nada; al reactivarlo revisa (como HU-082)", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);
    const desactivado: Admin = { usuario: await fx.crearAdmin() };
    const antes = await pagoEnBd(pago.id);

    await bd.query("update auth.users set banned_until = now() + interval '876000 hours' where id = $1", [desactivado.usuario.id]);
    expect(await revisarComo(desactivado, pago.id, "aprobar")).toEqual({ resultado: "sin_permiso", cancelo_monitoria: false });
    expect(await revisarComo(desactivado, pago.id, "rechazar")).toEqual({ resultado: "sin_permiso", cancelo_monitoria: false });
    expect(await pagoEnBd(pago.id)).toEqual(antes);

    await bd.query("update auth.users set banned_until = null where id = $1", [desactivado.usuario.id]);
    expect(await revisarComo(desactivado, pago.id, "aprobar")).toEqual({ resultado: "aprobado", cancelo_monitoria: false });
    expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "aprobado", id_admin: asignado.usuario.id, id_admin_revisor: desactivado.usuario.id });
  });

  it("nadie escribe directo en pago: ni el admin responsable con su sesión puede actualizarlo o borrarlo por la Data API", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    sinFilas(await asignado.cliente.from("pago").update({ estado: "aprobado", fecha_revision: new Date().toISOString() }).eq("id", pago.id).select());
    sinFilas(await asignado.cliente.from("pago").delete().eq("id", pago.id).select());

    expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "en_revision", fecha_revision: null });
  });
});

describe("HU-034 (D-56): la bandeja común, y lo que queda de HU-077 (quién lo revisó)", () => {
  it("criterios 1 y 3: el pago de A le sale a otro admin en «de otros», desde que llega y también si es viejo; lo aprueba por la misma ruta, queda él como revisor, A sigue de responsable y el pago sale de las dos bandejas", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(0) });
    const reciente = await pagoEnRevision(monitoria.id);
    const viejo = await pagoEnRevision((await fx.crearMonitoria(e.contexto, { fecha: e.fecha(1) })).id, llegoHace(2 * DIA));

    // Los dos le salen aparte de los suyos, el que lleva más tiempo esperando primero, con el nombre del responsable.
    const antes = await bandejaDelOtroAdmin(reciente, viejo);
    expect(antes.deOtros.map((p) => p.id)).toEqual([viejo.id, reciente.id]);
    expect(antes.deOtros[0]).toMatchObject({ nombreAdmin: "Admin de prueba", espera: "hace 2 d" });
    expect(antes.deOtros[1].espera).toMatch(/^hace (menos de 1|\d+) min$/);
    expect(antes.suyos).not.toContain(viejo.id);
    expect(antes.suyos).not.toContain(reciente.id);
    // Y a A, en los suyos.
    expect(await pagosDeLaBandeja()).toEqual([viejo.id, reciente.id]);
    const reloj = await relojDeLaBase();

    expect(await revisar(otroAdmin.cliente, viejo.id, "aprobar")).toEqual({ resultado: "aprobado", canceloMonitoria: false });

    const despues = await relojDeLaBase();
    const enBd = await pagoEnBd(viejo.id);
    // Criterio 3: queda quién lo revisó. Supuesto 4: revisarlo no se lo reasigna.
    expect(enBd).toMatchObject({ estado: "aprobado", observaciones: null, id_admin: asignado.usuario.id, id_admin_revisor: otroAdmin.usuario.id });
    const revisado = new Date(enBd.fecha_revision!).getTime();
    expect(revisado).toBeGreaterThanOrEqual(reloj);
    expect(revisado).toBeLessThanOrEqual(despues);
    expect(await monitoriaEnBd(monitoria.id)).toEqual({ estado: "confirmada", motivo_cancelacion: null, fecha_finalizacion: null });
    expect(await reembolsosDe(viejo.id)).toEqual([]);
    expect(await correosDe(viejo.id)).toEqual([]);
    // La página lo pinta revisado por el otro admin, y con A de responsable.
    expect(await cargarPagoParaRevisar(asignado.cliente, viejo.id)).toMatchObject({
      estado: "aprobado",
      idAdmin: asignado.usuario.id,
      nombreAdmin: "Admin de prueba",
      idAdminRevisor: otroAdmin.usuario.id,
      nombreAdminRevisor: NOMBRE_DEL_OTRO_ADMIN,
    });

    // Sale de las dos bandejas; el reciente sigue en las dos.
    expect((await bandejaDelOtroAdmin(viejo, reciente)).deOtros.map((p) => p.id)).toEqual([reciente.id]);
    expect(await pagosDeLaBandeja()).toEqual([reciente.id]);
    // §5.2: ni el responsable lo cambia después.
    expect(await revisar(asignado.cliente, viejo.id, "rechazar", OBSERVACIONES)).toEqual({ resultado: "ya_revisado", canceloMonitoria: false });
    expect(await pagoEnBd(viejo.id)).toEqual(enBd);
  });

  it("criterio 1, con las mismas reglas que el responsable: el rechazo cancela la cita que no empezó y se anota el aviso al pagador; con la monitoría realizada (P-24) pide observaciones, que tienen que caber, y no la cancela", async () => {
    const e = await escenario();
    const futura = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(0) });
    const deFutura = await pagoEnRevision(futura.id);
    const realizada = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(-4), estado: "realizada", fechaFinalizacion: `${e.fecha(-4)}T16:00:00+00:00` });
    const deRealizada = await pagoEnRevision(realizada.id, llegoHace(DIA));

    expect(await revisar(otroAdmin.cliente, deFutura.id, "rechazar")).toEqual({ resultado: "rechazado", canceloMonitoria: true });
    expect(await pagoEnBd(deFutura.id)).toMatchObject({ estado: "rechazado", observaciones: null, id_admin: asignado.usuario.id, id_admin_revisor: otroAdmin.usuario.id });
    expect(await monitoriaEnBd(futura.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "pago_rechazado", fecha_finalizacion: null });
    // Igual que si lo hubiera rechazado el responsable: la base anota el aviso al pagador (quién rechaza no cambia el correo).
    expect(await avisosDeRechazo(deFutura.id)).toEqual([{ caso: "cita_cancelada", procesado_en: null, intentos: 0 }]);
    expect(await avisosDe(futura.id)).toEqual([{ evento: "pago_rechazado" }]);
    expect(await reembolsosDe(deFutura.id)).toEqual([]);

    const antes = await monitoriaEnBd(realizada.id);
    expect(await revisar(otroAdmin.cliente, deRealizada.id, "rechazar")).toEqual({ resultado: "observaciones_requeridas", canceloMonitoria: false });
    // Al que revisa se le dice que el texto no cabe, sea o no el responsable.
    expect(await revisar(otroAdmin.cliente, deRealizada.id, "rechazar", OBSERVACIONES_LARGAS)).toEqual({ resultado: "observaciones_invalidas", canceloMonitoria: false });
    expect(await pagoEnBd(deRealizada.id)).toMatchObject({ estado: "en_revision", fecha_revision: null, observaciones: null, id_admin_revisor: null });

    expect(await revisar(otroAdmin.cliente, deRealizada.id, "rechazar", OBSERVACIONES)).toEqual({ resultado: "rechazado", canceloMonitoria: false });
    expect(await pagoEnBd(deRealizada.id)).toMatchObject({
      estado: "rechazado",
      observaciones: OBSERVACIONES,
      id_admin: asignado.usuario.id,
      id_admin_revisor: otroAdmin.usuario.id,
    });
    expect(await monitoriaEnBd(realizada.id)).toEqual(antes);
    expect(await avisosDeRechazo(deRealizada.id)).toEqual([]);
    expect(await avisosDe(realizada.id)).toEqual([]);
    expect(await mensajesPara(deRealizada.contacto)).toEqual([]);
    expect(await reembolsosDe(deRealizada.id)).toEqual([]);
  });

  it("el responsable lo revisa igual y queda él como revisor; un monitor, no", async () => {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id, llegoHace(3 * HORA));

    expect(await revisar(monitor.cliente, pago.id, "aprobar")).toEqual({ resultado: "sin_permiso", canceloMonitoria: false });
    expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "en_revision", id_admin_revisor: null });

    expect(await revisar(asignado.cliente, pago.id, "aprobar")).toEqual({ resultado: "aprobado", canceloMonitoria: false });
    expect(await pagoEnBd(pago.id)).toMatchObject({ estado: "aprobado", id_admin: asignado.usuario.id, id_admin_revisor: asignado.usuario.id });
    expect(await cargarPagoParaRevisar(otroAdmin.cliente, pago.id)).toMatchObject({ idAdminRevisor: asignado.usuario.id, nombreAdminRevisor: "Admin de prueba" });
  });
});

describe("dos revisiones del mismo pago a la vez (doble clic, dos pestañas o, desde HU-077, dos admins) y otras carreras", () => {
  // Dos conexiones, cada una en su transacción con el rol y el token de un admin: el responsable en las dos, si no se
  // dice otra cosa. La primera revisa y se queda con los bloqueos de la monitoría y del pago; la segunda espera el de la
  // monitoría y, cuando la primera confirma, lee el pago ya revisado y responde ya_revisado sin tocar nada.
  async function carrera(primera: Decision, segunda: Decision, { quienes = [asignado, asignado] }: { quienes?: [Admin, Admin] } = {}) {
    const e = await escenario();
    const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
    const pago = await pagoEnRevision(monitoria.id);

    const a = await conexion();
    const b = await conexion();
    try {
      await a.cliente.query("begin");
      await comoAsignado(a.cliente, quienes[0]);
      const ganadora = await revisarEn(a.cliente, pago.id, primera);

      await b.cliente.query("begin");
      await comoAsignado(b.cliente, quienes[1]);
      const perdedora = enCurso(revisarEn(b.cliente, pago.id, segunda));
      await esperarBloqueo(b.pid, a.pid, perdedora);

      await a.cliente.query("commit");
      const trasLaGanadora = await pagoEnBd(pago.id);
      expect(await perdedora.promesa).toEqual({ resultado: "ya_revisado", cancelo_monitoria: false });
      await b.cliente.query("commit");
      // Vale la primera: ni la fecha de revisión ni el revisor cambian con la segunda.
      const final = await pagoEnBd(pago.id);
      expect(final).toEqual(trasLaGanadora);
      expect(final.id_admin_revisor).toBe(quienes[0].usuario.id);
      return { ganadora, pago: final, monitoria: await monitoriaEnBd(monitoria.id) };
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
    "HU-077, criterio 4: dos admins que no son el responsable: vale la aprobación del primero, y el rechazo del otro espera el bloqueo y responde ya_revisado",
    async () => {
      const { ganadora, pago, monitoria } = await carrera("aprobar", "rechazar", { quienes: [otroAdmin, tercerAdmin] });

      expect(ganadora).toEqual({ resultado: "aprobado", cancelo_monitoria: false });
      // Queda el primero como revisor; el responsable no cambia (supuesto 4).
      expect(pago).toMatchObject({ estado: "aprobado", observaciones: null, id_admin: asignado.usuario.id, id_admin_revisor: otroAdmin.usuario.id });
      expect(pago.fecha_revision).not.toBeNull();
      expect(monitoria).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
    },
    60_000,
  );

  it(
    "HU-077, criterio 4: otro admin rechaza primero, y la aprobación que el responsable manda a la vez espera el bloqueo y responde ya_revisado",
    async () => {
      const { ganadora, pago, monitoria } = await carrera("rechazar", "aprobar", { quienes: [otroAdmin, asignado] });

      expect(ganadora).toEqual({ resultado: "rechazado", cancelo_monitoria: true });
      expect(pago).toMatchObject({ estado: "rechazado", id_admin: asignado.usuario.id, id_admin_revisor: otroAdmin.usuario.id });
      expect(monitoria).toMatchObject({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });
    },
    60_000,
  );

  it(
    "HU-074 y HU-034: si reasignan el pago mientras otro admin espera su fila, ese admin revisa igual: id_admin es el nuevo responsable e id_admin_revisor es él (ya no hay regla de quién revisa que volver a mirar)",
    async () => {
      // La reasignación le pasa los pagos del responsable al admin activo que le sigue en el turno: aquí, `siguiente`.
      const siguiente = await fx.crearAdmin();
      const { orden_revision } = exito(await fx.admin.from("admin").select("orden_revision").eq("id", asignado.usuario.id).single(), "leer el turno del responsable");
      exito(await fx.admin.from("admin").update({ orden_revision: orden_revision + 1 }).eq("id", siguiente.id).select().single(), "poner al siguiente en el turno");
      const e = await escenario();
      const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
      const pago = await pagoEnRevision(monitoria.id, llegoHace(2 * HORA));

      const r = await conexion();
      const b = await conexion();
      try {
        // R hace lo que desactivarCuenta() (HU-074) con la llave secreta: reasigna y, sin confirmar, deja bloqueada la
        // fila del pago, ya con el nuevo admin.
        await r.cliente.query("begin");
        await r.cliente.query("set local role service_role");
        const { rows } = await r.cliente.query<{ movidos: number }>("select public.reasignar_casos_de_admin($1::uuid) as movidos", [asignado.usuario.id]);
        expect(rows[0].movidos).toBe(1);

        // B (que no es el responsable ni el nuevo) pasa su primera mirada y se queda esperando la fila del pago.
        await b.cliente.query("begin");
        await comoAsignado(b.cliente, otroAdmin);
        const revision = enCurso(revisarEn(b.cliente, pago.id, "aprobar"));
        await esperarBloqueo(b.pid, r.pid, revision);

        await r.cliente.query("commit");
        // No hay nada que volver a mirar de quién es el pago: B revisa.
        expect(await revision.promesa).toEqual({ resultado: "aprobado", cancelo_monitoria: false });
        await b.cliente.query("commit");
      } finally {
        await cerrar(r, b);
      }
      const enBd = await pagoEnBd(pago.id);
      expect(enBd).toMatchObject({ estado: "aprobado", observaciones: null, id_admin: siguiente.id, id_admin_revisor: otroAdmin.usuario.id });
      expect(enBd.fecha_revision).not.toBeNull();
      expect(await monitoriaEnBd(monitoria.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
    },
    60_000,
  );

  it(
    "mientras el responsable revisa, otro admin no recibe no_asignado sin esperar: espera el bloqueo y, cuando el responsable confirma, responde ya_revisado sin cambiar la fecha de revisión ni el revisor",
    async () => {
      const { ganadora, pago, monitoria } = await carrera("rechazar", "aprobar", { quienes: [asignado, otroAdmin] });

      expect(ganadora).toEqual({ resultado: "rechazado", cancelo_monitoria: true });
      expect(pago).toMatchObject({ estado: "rechazado", id_admin: asignado.usuario.id, id_admin_revisor: asignado.usuario.id });
      expect(pago.fecha_revision).not.toBeNull();
      expect(monitoria).toMatchObject({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });
    },
    60_000,
  );

  it(
    "HU-082 y HU-034: un admin al que desactivan mientras espera el bloqueo del pago recibe sin_permiso (la base lo vuelve a mirar con el pago bloqueado) y no escribe nada",
    async () => {
      const e = await escenario();
      const monitoria = await fx.crearMonitoria(e.contexto, { fecha: e.fecha() });
      const pago = await pagoEnRevision(monitoria.id);
      const viejo: Admin = { usuario: await fx.crearAdmin() };
      const antes = await pagoEnBd(pago.id);

      const a = await conexion();
      const b = await conexion();
      try {
        // A toma la fila del pago y, antes de confirmar, desactiva al admin viejo (como al desactivarlo desde el equipo).
        await a.cliente.query("begin");
        await a.cliente.query("select id from public.pago where id = $1 for update", [pago.id]);

        // B es el viejo, todavía activo: pasa la primera mirada, toma la monitoría y espera la fila del pago.
        await b.cliente.query("begin");
        await comoAsignado(b.cliente, viejo);
        const revision = enCurso(revisarEn(b.cliente, pago.id, "aprobar"));
        await esperarBloqueo(b.pid, a.pid, revision);

        await a.cliente.query("update auth.users set banned_until = now() + interval '876000 hours' where id = $1", [viejo.usuario.id]);
        await a.cliente.query("commit");
        expect(await revision.promesa).toEqual({ resultado: "sin_permiso", cancelo_monitoria: false });
        await b.cliente.query("commit");
      } finally {
        await cerrar(a, b);
      }
      expect(await pagoEnBd(pago.id)).toEqual(antes);
      expect(await monitoriaEnBd(monitoria.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
    },
    60_000,
  );
});

describe("HU-065 y HU-076: los correos del rechazo se reconstruyen para mandarlos o reintentarlos", () => {
  it("el reconstructor de la cita cancelada por el rechazo arma el correo (también con el rechazo de un segundo pago de la misma cita) y da null para uno aprobado, uno con la cita cancelada por el estudiante y uno que no existe", async () => {
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
    // Supuesto 2 de HU-076: el segundo pago de una cita que ya canceló el rechazo del primero también recibe este correo.
    const segundo = await pagoEnRevision(cancelada.id);
    expect(await revisar(asignado.cliente, segundo.id, "rechazar")).toEqual({ resultado: "rechazado", canceloMonitoria: false });
    expect(await avisosDeRechazo(segundo.id)).toMatchObject([{ caso: "cita_cancelada" }]);
    expect(await reconstruir(segundo.id)).toEqual({
      destinatario: segundo.contacto,
      datos: { nombre: "Pagador de prueba", monto: 25_000, fechaSesion: e.fecha(0), contactoSoporte: SOPORTE },
    });

    const confirmada = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(1) });
    const aprobado = await pagoEnRevision(confirmada.id);
    expect((await revisar(asignado.cliente, aprobado.id, "aprobar")).resultado).toBe("aprobado");
    expect(await reconstruir(aprobado.id)).toBeNull();

    // Con la cita cancelada por el estudiante solo cambia el pago: este correo no aplica (le toca el de «no hay reembolso»).
    const delEstudiante = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(2), estado: "cancelada" });
    const deCanceladaPorEstudiante = await pagoEnRevision(delEstudiante.id);
    expect(await revisar(asignado.cliente, deCanceladaPorEstudiante.id, "rechazar")).toEqual({ resultado: "rechazado", canceloMonitoria: false });
    expect(await monitoriaEnBd(delEstudiante.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    expect(await reconstruir(deCanceladaPorEstudiante.id)).toBeNull();
    expect(await reembolsosDe(deCanceladaPorEstudiante.id)).toEqual([]);

    expect(await reconstruir(randomUUID())).toBeNull();
    expect(await reconstruir("no-es-un-uuid")).toBeNull();
  });

  it("D-39 d: el reconstructor del correo «no hay reembolso» lo arma solo con la cita cancelada por el estudiante y el pago rechazado, y da null para la cancelada por el rechazo, uno aprobado y uno que no existe", async () => {
    const reconstruir = RECONSTRUCTORES.pago_rechazado_sin_reembolso;
    if (!reconstruir) throw new Error("pago_rechazado_sin_reembolso no tiene reconstructor.");
    const e = await escenario();

    const delEstudiante = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(0), estado: "cancelada" });
    const enRevision = await pagoEnRevision(delEstudiante.id);
    // Sin rechazar todavía: el pago sigue en revisión y no hay nada que avisar.
    expect(await reconstruir(enRevision.id)).toBeNull();
    expect(await revisar(asignado.cliente, enRevision.id, "rechazar")).toEqual({ resultado: "rechazado", canceloMonitoria: false });
    const datos = { nombre: "Pagador de prueba", monto: 25_000, fechaSesion: e.fecha(0), contactoSoporte: SOPORTE };
    expect(await reconstruir(enRevision.id)).toEqual({ destinatario: enRevision.contacto, datos });
    // Lo mismo por la función que usa el procesador, con la llave secreta de la prueba.
    expect(await reconstruirPagoRechazadoSinReembolso(enRevision.id, fx.admin)).toEqual({ destinatario: enRevision.contacto, datos });

    const porElRechazo = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(1) });
    const rechazado = await pagoEnRevision(porElRechazo.id);
    expect((await revisar(asignado.cliente, rechazado.id, "rechazar")).canceloMonitoria).toBe(true);
    expect(await reconstruir(rechazado.id)).toBeNull();

    const confirmada = await fx.crearMonitoria(e.contexto, { fecha: e.fecha(2) });
    const aprobado = await pagoEnRevision(confirmada.id);
    expect((await revisar(asignado.cliente, aprobado.id, "aprobar")).resultado).toBe("aprobado");
    expect(await reconstruir(aprobado.id)).toBeNull();

    expect(await reconstruir(randomUUID())).toBeNull();
    expect(await reconstruir("no-es-un-uuid")).toBeNull();
  });
});
