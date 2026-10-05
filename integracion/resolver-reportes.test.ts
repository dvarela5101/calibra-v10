import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { cargarDesembolso } from "@/lib/admin/desembolsos";
import { revisarPago } from "@/lib/admin/pagos";
import { cargarReembolso } from "@/lib/admin/reembolsos";
import { cargarAsignacionDeReporte, cargarReporte, resolverReporte } from "@/lib/admin/reportes";
import { puedeResolver, RESULTADOS_DE_RESOLUCION, type ResultadoDeResolucion } from "@/lib/admin/reportes-reglas";
import { desactivarCuenta } from "@/lib/auth/cuentas";
import { procesarAvisosAlMonitor, reconstruirAvisoInasistenciaAceptada } from "@/lib/avisos/servidor";
import { reportarInasistenciaDeMiCita } from "@/lib/citas/reportar";
import { vistaDeCita } from "@/lib/citas/reglas";
import { leerCitaPorToken, leerMiCita, leerMisCitas } from "@/lib/citas/servidor";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { reintentarCorreosFallidos } from "@/lib/correo/reintentos";
import { enviarCorreoDesdeServidor } from "@/lib/correo/servidor";
import { diaDelNegocio, formatearFechaHora } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";
import { diaIsoDeFecha, inicioDeSesion } from "@/lib/plazos/motor";
import { procesarPedidosDeLlave } from "@/lib/reembolsos/pedidos";
import { MOTIVO_INASISTENCIA_ACEPTADA, rutaDeLlave } from "@/lib/reembolsos/reglas";
import { rutaDeResena } from "@/lib/resenas/reglas";
import { procesarInvitacionesResena } from "@/lib/resenas/servidor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-030 contra el Supabase local: el admin asignado abre un reporte de inasistencia y lo acepta o lo rechaza por el mismo
 * código que usan la página y la acción de `/admin/reportes/[id]` (`cargarReporte` y `resolverReporte`, con la sesión de
 * verdad de cada admin), así que también se prueban `public.resolver_reporte_inasistencia`, sus permisos y que nadie escriba
 * esas tablas por su cuenta. Los bordes de cada resultado, con una hora fija, están en `supabase/tests/resolver_reporte.test.sql`.
 *
 * Lo que la base anota al decidir se sigue hasta el correo: el pedido de llave del pagador (HU-025) y el aviso al monitor
 * (`inasistencia_aceptada`) salen por Mailpit con los mismos procesadores que las rutas `/api/procesos/*`; la cita del Lead
 * (`leerCitaPorToken`, `leerMiCita`, `leerMisCitas` y `vistaDeCita`) muestra la decisión; HU-080 reanuda o no la invitación
 * a reseñar. Las carreras (A.5 del SPEC) van con dos conexiones `pg` reales, cada una en su transacción y con el rol y el
 * token de su admin, como en `integracion/desembolsos.test.ts`: la segunda espera el candado de la primera.
 *
 * El reporte se crea por la puerta real de HU-029 (`reportarInasistenciaDeMiCita`, con la sesión anónima del Lead) siempre que
 * la monitoría empezó hace poco; la base se lo asigna al primer admin activo, que en la base local es uno de la semilla (sin
 * sesión aquí), así que se le pasa al admin de la prueba. Los de monitorías de hace semanas (fuera de la ventana de reporte)
 * se insertan con `crearReporte`. Las monitorías confirmadas empezaron hace 2 horas, cada una en su propia franja: el cierre
 * automático (pg_cron) no las alcanza mientras corre la prueba.
 *
 * Tres inicios de sesión con contraseña (los dos admins y el monitor) y una sesión anónima (el Lead): el Auth local deja 30
 * inicios cada 5 minutos para toda la suite. El «admin desactivado» es el admin A al final del archivo, tras `desactivarCuenta`,
 * sin un cuarto inicio. Las carreras usan conexiones `pg` con el token del admin, que no inician sesión.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;

/** Lo que escribe el admin al decidir: termina en punto, así el correo no le agrega otro. */
const OBSERVACIONES = "Hablamos con el monitor y no dio razón de su ausencia.";
const BASE = "El monitor no asistió a la monitoría.";
const MOTIVO = `${BASE} ${OBSERVACIONES}`;
const TEXTO_DEL_PEDIDO = "Revisamos el reporte de que el monitor no asistió a la monitoría y lo aceptamos";
const SOPORTE = "datos-personales@calibra.test";

type Contexto = Awaited<ReturnType<Fixtures["crearContextoDeMonitoria"]>>;
type Lead = Awaited<ReturnType<Fixtures["crearLead"]>>;
type Mensaje = { Subject: string; Text: string; HTML: string };
/** Un monitor con su materia: el compartido de la prueba o uno propio, con un buzón que solo tiene lo de su prueba. */
type Propio = { materia: Contexto["materia"]; monitor: UsuarioPrueba };
type PagoDePrueba = { estado: "aprobado" | "en_revision" | "rechazado"; monto?: number };
type PagoCreado = { id: string; estado: PagoDePrueba["estado"]; monto: number; nombre: string; contacto: string };

let fx: Fixtures;
let bd: pg.Client;
let mailpit: string;
let adminA: UsuarioPrueba;
let adminB: UsuarioPrueba;
let sesionA: Cliente;
let sesionB: Cliente;
let sesionMonitor: Cliente;
/** El monitor y la materia compartidos de la prueba. */
let base: Propio;
/** La sesión anónima del Lead que agendó y reporta, y su Lead. */
let ancla: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
let leadDeAncla: Lead;
let otroLead: Lead;
const monitorias: string[] = [];
const pagos: string[] = [];
const correos = new Set<string>();
const resultadosVistos = new Set<ResultadoDeResolucion>();

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  fx = new Fixtures();
  try {
    adminA = await fx.crearAdmin();
    adminB = await fx.crearAdmin();
    // A y B quedan seguidos en el turno, por encima de los demás admins de la base: lo que A deja al desactivarse (P-44) lo
    // recibe B, y el primer admin activo (D-26), que recibe los reembolsos, no es ninguno de los dos.
    const orden = 2_000_000_000 + randomInt(1_000, 100_000_000);
    exito(await fx.admin.from("admin").update({ orden_revision: orden }).eq("id", adminA.id).select().single(), "ordenar al admin A");
    exito(await fx.admin.from("admin").update({ orden_revision: orden + 1 }).eq("id", adminB.id).select().single(), "ordenar al admin B");
    base = await monitorPropio();
    sesionA = await fx.iniciarSesion(adminA);
    sesionB = await fx.iniciarSesion(adminB);
    sesionMonitor = await fx.iniciarSesion(base.monitor);
    ancla = await fx.crearAnonimo();
    leadDeAncla = await fx.crearLeadDeSesion(ancla.id);
    exito(await fx.admin.from("lead").update({ numero_telefono: "3101234567" }).eq("id", leadDeAncla.id).select().single(), "poner el teléfono del Lead");
    correos.add(leadDeAncla.correo!);
    otroLead = await leadNuevo();
  } catch (error) {
    await bd.end();
    await fx.limpiar();
    throw error;
  }
}, 90_000);

beforeEach(() => {
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
  // Cada prueba deja procesado lo suyo: la siguiente corrida de un proceso no se lo encuentra (toman cualquier pendiente de la
  // base, de a diez).
  const ahora = new Date().toISOString();
  if (monitorias.length) await fx.admin.from("aviso_monitor").update({ procesado_en: ahora }).in("id_monitoria", monitorias).is("procesado_en", null);
  const reembolsos = await reembolsosDePagos();
  if (reembolsos.length) await fx.admin.from("pedido_llave").update({ procesado_en: ahora }).in("id_reembolso", reembolsos).is("procesado_en", null);
});

afterAll(async () => {
  for (const correo of correos) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(() => undefined);
  }
  if (fx) {
    // Los reportes los crearon las funciones: `limpiar()` solo borra los de `crearReporte`, y la llave foránea impide borrar
    // antes la monitoría. Las reseñas cuelgan del pago sin cascada.
    if (monitorias.length) await fx.admin.from("reporte_inasistencia").delete().in("id_monitoria", monitorias);
    if (pagos.length) await fx.admin.from("resena").delete().in("id_pago", pagos);
    // Las filas de `correo_envio` no caen en cascada: las de los avisos al monitor, las de los pedidos de llave (se van con
    // su reembolso) y las de las invitaciones a reseñar. Por lotes: cada clave mide unos 60 caracteres y el filtro viaja en la URL.
    const reembolsos = await reembolsosDePagos();
    const { data: pedidos } = reembolsos.length ? await fx.admin.from("pedido_llave").select("id").in("id_reembolso", reembolsos) : { data: [] };
    const claves = [
      ...monitorias.flatMap((id) => [claveDeCorreo("aviso_monitor_inasistencia_aceptada", id), claveDeCorreo("aviso_monitor_confirmada", id)]),
      ...(pedidos ?? []).map(({ id }) => claveDeCorreo("solicitud_llave_reembolso", id)),
      ...pagos.map((id) => claveDeCorreo("resena_individual", id)),
    ];
    for (let i = 0; i < claves.length; i += 40) await fx.admin.from("correo_envio").delete().in("clave", claves.slice(i, i + 40));
    await fx.limpiar();
  }
  if (bd) await bd.end();
});

// ---------------------------------------------------------------------------------------------------------------
// Fechas y escenario
// ---------------------------------------------------------------------------------------------------------------

/** `AAAA-MM-DD` más `dias` días (aritmética de calendario, sin zona). */
function sumarDias(fecha: string, dias: number): string {
  const instante = new Date(`${fecha}T12:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

/** El lunes de hace `semanas` semanas o el anterior: su sesión de las 10:00 terminó hace más de 24 h. */
function lunesDeHace(semanas: number): string {
  let fecha = sumarDias(diaDelNegocio(new Date()), -7 * semanas);
  while (diaIsoDeFecha(fecha) !== 1) fecha = sumarDias(fecha, -1);
  return fecha;
}

const formatoDeHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Día, día de la semana, hora (`HH:MM:SS`) y minuto del día de un instante en Bogotá, tal como los guarda la base. */
function sesionEn(instante: Date): { fecha: string; dia: number; hora: string; minutoDelDia: number } {
  const fecha = diaDelNegocio(instante);
  const hora = formatoDeHora.format(instante);
  if (inicioDeSesion(fecha, hora).getTime() !== instante.getTime()) throw new Error(`No se pudo expresar ${instante.toISOString()} como fecha y hora de Bogotá.`);
  return { fecha, dia: diaIsoDeFecha(fecha), hora, minutoDelDia: Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)) };
}

/** Texto con los espacios duros y los saltos CRLF de Mailpit como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s+/g, " ").trim();

async function leadNuevo() {
  const lead = await fx.crearLead();
  correos.add(lead.correo!);
  return lead;
}

/** Un monitor con su contacto y su materia, certificado por el admin A, con un buzón que solo tiene lo de su prueba. */
async function monitorPropio(): Promise<Propio> {
  const materia = await fx.crearMateria(`Materia de prueba ${randomUUID().slice(0, 6)}`);
  const monitor = await fx.crearMonitor({ conContacto: true });
  correos.add(monitor.correo);
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: adminA.id });
  return { materia, monitor };
}

/** Una franja propia del monitor para ese día y hora (presencial), dentro del día: dura 60 min o lo que quede hasta la medianoche. */
async function franjaEn(dia: number, hora: string, minutoDelDia: number, propio: Propio) {
  return fx.crearFranja({ idMonitor: propio.monitor.id, dia, hora, duracionMin: Math.min(60, 24 * 60 - minutoDelDia) });
}

/** Un pago de la monitoría, asignado al admin A, con el nombre y el contacto de quien paga propios de la prueba. */
async function crearPago(idMonitoria: string, pago: PagoDePrueba): Promise<PagoCreado> {
  const nombre = `Pagador ${randomUUID().slice(0, 6)}`;
  const contacto = `pagador-${randomUUID()}@calibra.test`;
  correos.add(contacto);
  const fila = await fx.crearPagoDe(idMonitoria, { idAdmin: adminA.id, estado: pago.estado, monto: pago.monto, nombrePagador: nombre });
  pagos.push(fila.id);
  exito(await fx.admin.from("pago").update({ contacto }).eq("id", fila.id).select().single(), "poner el contacto del pago");
  return { id: fila.id, estado: pago.estado, monto: fila.monto, nombre, contacto };
}

async function tokenDe(idMonitoria: string): Promise<string> {
  const filas = exito(await fx.admin.from("confirmacion_cita").select("token").eq("id_monitoria", idMonitoria), "leer la confirmación");
  if (!filas[0]) throw new Error(`La monitoría ${idMonitoria} no tiene confirmación anotada.`);
  return filas[0].token;
}

async function pasarARealizada(idMonitoria: string) {
  exito(
    await fx.admin.from("monitoria").update({ estado: "realizada", fecha_finalizacion: new Date().toISOString() }).eq("id", idMonitoria).select().single(),
    "pasar la monitoría a realizada",
  );
}

type Caso = {
  monitoria: Awaited<ReturnType<Fixtures["crearMonitoria"]>>;
  /** El instante exacto en que empezó la sesión. */
  inicio: Date;
  pagos: PagoCreado[];
  idReporte: string;
  token: string;
  propio: Propio;
};

/**
 * Una individual que empezó hace `horas` horas, en su propia franja, con sus pagos y un reporte en revisión asignado al admin
 * A. Nace `pendiente_pago` y se confirma con un UPDATE, como `registrar_pago`: el trigger de HU-019 le anota su token y el de
 * HU-051 su aviso de confirmada. Con `estado: "realizada"` se finaliza después (el trigger de HU-028 le crea el desembolso).
 * El reporte lo crea la puerta de HU-029 con la sesión del Lead que agendó (`leadDeAncla`); con otro Lead, que no tiene
 * sesión aquí, se inserta.
 */
async function caso(
  horas: number,
  opciones: { propio?: Propio; lead?: Lead; pagos?: PagoDePrueba[]; estado?: "confirmada" | "realizada" } = {},
): Promise<Caso> {
  const propio = opciones.propio ?? base;
  const lead = opciones.lead ?? leadDeAncla;
  const inicio = new Date(Math.floor((Date.now() - horas * HORA) / MINUTO) * MINUTO);
  const sesion = sesionEn(inicio);
  const franja = await franjaEn(sesion.dia, sesion.hora, sesion.minutoDelDia, propio);
  const monitoria = await fx.crearMonitoria({ materia: propio.materia, monitor: propio.monitor, franja, lead } as Contexto, {
    fecha: sesion.fecha,
    estado: "pendiente_pago",
  });
  monitorias.push(monitoria.id);
  exito(await fx.admin.from("monitoria").update({ estado: "confirmada" }).eq("id", monitoria.id).select().single(), "confirmar la monitoría");
  const creados: PagoCreado[] = [];
  for (const pago of opciones.pagos ?? [{ estado: "aprobado" }]) creados.push(await crearPago(monitoria.id, pago));
  if (opciones.estado === "realizada") await pasarARealizada(monitoria.id);

  let idReporte: string;
  if (lead.id === leadDeAncla.id) {
    expect(await reportarInasistenciaDeMiCita(ancla.cliente, monitoria.id)).toBe("reportada");
    // La puerta lo asigna al primer admin activo (D-26); aquí lo resuelve el admin de la prueba.
    const [reporte] = await reportesDe(monitoria.id);
    idReporte = reporte.id;
    exito(await fx.admin.from("reporte_inasistencia").update({ id_admin: adminA.id }).eq("id", idReporte).select().single(), "asignar el reporte al admin de la prueba");
  } else {
    idReporte = (await fx.crearReporte({ idMonitoria: monitoria.id, idAdmin: adminA.id, estado: "en_revision" })).id;
  }
  return { monitoria, inicio, pagos: creados, idReporte, token: await tokenDe(monitoria.id), propio };
}

/**
 * Una individual realizada el lunes de hace `semanas` semanas (10:00 a 11:00: ya pasó fin + 24 h, así que ya no se puede
 * reportar por la puerta), con sus pagos, su desembolso y un reporte en revisión asignado al admin A. El desembolso es la foto
 * de `crearDesembolso` (bruto 25.000, comisión 2.500, neto 22.500), como en `integracion/desembolsos.test.ts`.
 */
async function antigua(
  semanas: number,
  opciones: { propio?: Propio; pagos?: PagoDePrueba[]; desembolso?: "pendiente" | "desembolsado" | "anulado" | null } = {},
) {
  const propio = opciones.propio ?? base;
  const fecha = lunesDeHace(semanas);
  const franja = await franjaEn(1, "10:00:00", 600, propio);
  const monitoria = await fx.crearMonitoria({ materia: propio.materia, monitor: propio.monitor, franja, lead: otroLead } as Contexto, {
    fecha,
    estado: "realizada",
    fechaFinalizacion: `${fecha}T16:00:00+00:00`,
  });
  monitorias.push(monitoria.id);
  const creados: PagoCreado[] = [];
  for (const pago of opciones.pagos ?? [{ estado: "aprobado" }]) creados.push(await crearPago(monitoria.id, pago));
  const desembolso =
    opciones.desembolso === null ? null : await fx.crearDesembolso({ idMonitoria: monitoria.id, estado: opciones.desembolso ?? "pendiente", idAdmin: adminA.id });
  const reporte = await fx.crearReporte({ idMonitoria: monitoria.id, idAdmin: adminA.id, estado: "en_revision" });
  return { monitoria, pagos: creados, desembolso, idReporte: reporte.id };
}

// ---------------------------------------------------------------------------------------------------------------
// Lo que hay en la base
// ---------------------------------------------------------------------------------------------------------------

/** Lo mismo que hace la acción con lo que llega del formulario (ya validado por `leerResolucion`). */
async function resolver(cliente: Cliente, idReporte: string, decision: "aceptar" | "rechazar", observaciones: string | null = null) {
  const resultado = await resolverReporte(cliente, { idReporte, decision, observaciones });
  resultadosVistos.add(resultado);
  return resultado;
}

async function reportesDe(idMonitoria: string) {
  return exito(
    await fx.admin.from("reporte_inasistencia").select("id, estado, id_admin, fecha_reporte, fecha_decision, observaciones").eq("id_monitoria", idMonitoria),
    "leer los reportes",
  );
}

async function reporteEnBd(idReporte: string) {
  return exito(
    await fx.admin.from("reporte_inasistencia").select("id, estado, id_admin, fecha_decision, observaciones").eq("id", idReporte).single(),
    "leer el reporte",
  );
}

async function estadoDe(idMonitoria: string) {
  return exito(await fx.admin.from("monitoria").select("estado, motivo_cancelacion, fecha_finalizacion").eq("id", idMonitoria).single(), "leer la monitoría");
}

const COLUMNAS_DEL_DESEMBOLSO = "id, estado, monto_bruto, comision, monto_neto, llave_destino, id_admin, referencia_transferencia, fecha_desembolso";

async function desembolsosDe(idMonitoria: string) {
  return exito(await fx.admin.from("desembolso").select(COLUMNAS_DEL_DESEMBOLSO).eq("id_monitoria", idMonitoria), "leer los desembolsos de la monitoría");
}

async function reembolsosDe(idMonitoria: string) {
  const delaMonitoria = exito(await fx.admin.from("pago").select("id").eq("id_monitoria", idMonitoria), "leer los pagos");
  if (!delaMonitoria.length) return [];
  return exito(
    await fx.admin
      .from("reembolso")
      .select("id, id_pago, id_admin, monto, motivo, estado, llave_destino")
      .in("id_pago", delaMonitoria.map((p) => p.id))
      .order("id_pago"),
    "leer los reembolsos",
  );
}

/** Los reembolsos de todos los pagos de la prueba: sus pedidos de llave se anotan solos y hay que dejarlos procesados. */
async function reembolsosDePagos(): Promise<string[]> {
  if (!pagos.length) return [];
  const { data } = await fx.admin.from("reembolso").select("id").in("id_pago", pagos);
  return (data ?? []).map((r) => r.id);
}

async function solicitudDe(idReembolso: string) {
  return exito(await fx.admin.from("solicitud_llave").select("token").eq("id_reembolso", idReembolso).single(), "leer la solicitud de llave");
}

async function pedidoDe(idReembolso: string) {
  const filas = exito(
    await fx.admin.from("pedido_llave").select("id, tipo, procesado_en, intentos").eq("id_reembolso", idReembolso).eq("tipo", "pedido"),
    "leer el pedido de la llave",
  );
  expect(filas, "un solo pedido de llave por reembolso").toHaveLength(1);
  return filas[0];
}

async function avisosDelMonitor(idMonitoria: string) {
  return exito(await fx.admin.from("aviso_monitor").select("evento, procesado_en").eq("id_monitoria", idMonitoria).order("creado_en"), "leer aviso_monitor");
}

const eventosDe = async (idMonitoria: string) => (await avisosDelMonitor(idMonitoria)).map((a) => a.evento);

async function registroDe(plantilla: "aviso_monitor_inasistencia_aceptada" | "solicitud_llave_reembolso" | "resena_individual", entidad: string) {
  const filas = exito(
    await fx.admin.from("correo_envio").select("estado, destinatario, plantilla").eq("clave", claveDeCorreo(plantilla, entidad)),
    "leer el registro de correos",
  );
  return filas[0] ?? null;
}

/** El primer admin activo de la base (el turno de D-26): quien recibe los reembolsos, sin importar quién decide. */
async function primerAdminActivo(): Promise<string> {
  const { rows } = await bd.query<{ id: string | null }>("select privado.siguiente_admin_activo() as id");
  if (!rows[0].id) throw new Error("La base local no tiene un admin activo.");
  return rows[0].id;
}

/** Todos los números de un valor (sin las fechas): las cifras que le llegan a la pantalla. */
function numerosDe(valor: unknown): number[] {
  if (typeof valor === "number") return [valor];
  if (valor === null || typeof valor !== "object" || valor instanceof Date) return [];
  return Object.values(valor).flatMap(numerosDe);
}

/** Todas las claves de un valor, a cualquier profundidad. */
function clavesDe(valor: unknown): string[] {
  if (valor === null || typeof valor !== "object" || valor instanceof Date) return [];
  return Object.entries(valor).flatMap(([clave, dentro]) => [clave, ...clavesDe(dentro)]);
}

/** Sin filas: el permiso se niega (error) o la RLS no deja ver ninguna; en ningún caso hay filas afectadas. */
function sinFilas(resultado: { data: unknown[] | null; error: { message: string } | null }) {
  expect(resultado.error ? [] : resultado.data).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------------------
// Correo (Mailpit)
// ---------------------------------------------------------------------------------------------------------------

/** Los correos que hay en Mailpit para un destinatario, con su contenido. */
async function correosA(correo: string): Promise<Mensaje[]> {
  correos.add(correo);
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

/** Corre el proceso de pedidos de llave hasta que ese pedido queda procesado (puede haber otros pendientes en la base). */
async function procesarPedidoHasta(idPedido: string) {
  for (let i = 0; i < 10; i++) {
    await procesarPedidosDeLlave({ cliente: fx.admin });
    const { procesado_en } = exito(await fx.admin.from("pedido_llave").select("procesado_en").eq("id", idPedido).single(), "leer el pedido");
    if (procesado_en !== null) return;
  }
  throw new Error(`El pedido de la llave ${idPedido} no se procesó tras 10 corridas.`);
}

/** Lo mismo con el proceso de avisos al monitor, hasta que los avisos de esa monitoría quedan procesados. */
async function procesarAvisosHasta(idMonitoria: string) {
  for (let i = 0; i < 10; i++) {
    await procesarAvisosAlMonitor({ cliente: fx.admin });
    if ((await avisosDelMonitor(idMonitoria)).every((a) => a.procesado_en !== null)) return;
  }
  throw new Error(`Los avisos de la monitoría ${idMonitoria} no se procesaron tras 10 corridas.`);
}

/** Lo mismo con el proceso de invitaciones a reseñar (HU-035, HU-080), hasta que la de ese pago queda procesada. */
async function procesarInvitacionHasta(idPago: string) {
  for (let i = 0; i < 10; i++) {
    await procesarInvitacionesResena({ cliente: fx.admin });
    const [invitacion] = exito(await fx.admin.from("invitacion_resena").select("procesado_en").eq("id_pago", idPago), "leer la invitación");
    if (!invitacion || invitacion.procesado_en !== null) return;
  }
  throw new Error(`La invitación a reseñar del pago ${idPago} no se procesó tras 10 corridas.`);
}

/** El correo del pedido de la llave de un reembolso por inasistencia: dice que se aceptó el reporte, el motivo con el comentario y el enlace. */
function expectPedidoDeLlave(mensaje: Mensaje, pago: PagoCreado, token: string, motivo = MOTIVO) {
  expect(mensaje.Subject).toBe(`Necesitamos tu llave para devolverte ${formatearPesos(pago.monto)}`);
  const texto = normalizar(mensaje.Text);
  expect(texto).toContain(`Hola, ${pago.nombre}.`);
  expect(texto).toContain(TEXTO_DEL_PEDIDO);
  expect(texto).toContain(`Vamos a devolverte ${normalizar(formatearPesos(pago.monto))} de tu pago en Calibra. Motivo: ${motivo}`);
  expect(mensaje.Text).toContain(rutaDeLlave(token));
  expect(mensaje.HTML).toContain("Enviar mi llave");
  expect(mensaje.Text.toLowerCase()).not.toContain("comisi");
}

// ---------------------------------------------------------------------------------------------------------------
// Con `pg`: dos conexiones a la vez, cada una como la sesión de un usuario
// ---------------------------------------------------------------------------------------------------------------

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

/** Dentro de una transacción de `cliente`: lo que sigue corre con el rol `authenticated` y el token de `usuario`. */
async function como(cliente: pg.Client, usuario: UsuarioPrueba) {
  await cliente.query("set local role authenticated");
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: usuario.id, role: "authenticated" })]);
}

/** `public.resolver_reporte_inasistencia`, la misma puerta que usa `resolverReporte`, desde una conexión que ya corre como un admin. */
async function decidirEn(cliente: pg.Client, idReporte: string, decision: "aceptar" | "rechazar", observaciones: string | null = null) {
  const { rows } = await cliente.query<{ r: ResultadoDeResolucion }>("select public.resolver_reporte_inasistencia($1::uuid, $2, $3) as r", [
    idReporte,
    decision,
    observaciones ?? "",
  ]);
  resultadosVistos.add(rows[0].r);
  return rows[0].r;
}

/** `public.revisar_pago` (la puerta de HU-020), desde una conexión que ya corre como el admin. */
async function aprobarEn(cliente: pg.Client, idPago: string) {
  const { rows } = await cliente.query<{ resultado: string; cancelo_monitoria: boolean }>(
    "select resultado, cancelo_monitoria from public.revisar_pago($1::uuid, 'aprobar', null)",
    [idPago],
  );
  return rows[0];
}

/** `public.ejecutar_desembolso`, la puerta de HU-028, desde una conexión que ya corre como el admin. */
async function ejecutarEn(cliente: pg.Client, idDesembolso: string) {
  const { rows } = await cliente.query<{ r: string }>("select public.ejecutar_desembolso($1::uuid, 'TRX-HU030', $2::date, null) as r", [
    idDesembolso,
    diaDelNegocio(new Date()),
  ]);
  return rows[0].r;
}

/** Lo que responde `public.estado_para_ejecutar` (la página del desembolso de HU-028) al admin A. */
async function motivoParaEjecutar(idDesembolso: string): Promise<string | null> {
  const c = await conexion();
  try {
    await c.cliente.query("begin");
    await como(c.cliente, adminA);
    const { rows } = await c.cliente.query<{ motivo: string | null }>("select motivo from public.estado_para_ejecutar($1::uuid)", [idDesembolso]);
    await c.cliente.query("rollback");
    if (rows.length !== 1) throw new Error(`estado_para_ejecutar devolvió ${rows.length} filas para el admin A.`);
    return rows[0].motivo;
  } finally {
    await cerrar(c);
  }
}

/** Corre `ronda` con dos conexiones y las cierra al final, pase lo que pase. */
async function conDosConexiones(ronda: (a: Conexion, b: Conexion) => Promise<void>) {
  const a = await conexion();
  const b = await conexion();
  try {
    await ronda(a, b);
  } finally {
    await cerrar(a, b);
  }
}

/**
 * Una carrera entre dos transacciones: la primera hace lo suyo y queda abierta; la segunda arranca, queda esperando el
 * candado de la primera (se comprueba con pg_blocking_pids) y sigue cuando la primera confirma. Devuelve lo que respondió cada
 * una. `rol` corre esa parte con el rol `authenticated` y el token de ese usuario; sin él, como dueño de la base (como pg_cron).
 */
async function carrera<P, S>(
  primera: { rol?: UsuarioPrueba; hacer: (c: Conexion) => Promise<P> },
  segunda: { rol?: UsuarioPrueba; hacer: (c: Conexion) => Promise<S> },
): Promise<[P, S]> {
  let resultado: [P, S] | null = null;
  await conDosConexiones(async (a, b) => {
    await a.cliente.query("begin");
    if (primera.rol) await como(a.cliente, primera.rol);
    const deLaPrimera = await primera.hacer(a);
    await b.cliente.query("begin");
    if (segunda.rol) await como(b.cliente, segunda.rol);
    const enEspera = enCurso(segunda.hacer(b));
    await esperarBloqueo(b.pid, a.pid, enEspera);
    await a.cliente.query("commit");
    const deLaSegunda = await enEspera.promesa;
    await b.cliente.query("commit");
    resultado = [deLaPrimera, deLaSegunda];
  });
  if (!resultado) throw new Error("La carrera no terminó.");
  return resultado;
}

// ---------------------------------------------------------------------------------------------------------------
// Criterio 1: aceptar cancela la monitoría y anula el desembolso
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1 (RN-65, P-28): aceptar cancela la monitoría por monitor_no_asistio y anula el desembolso", () => {
  it("el admin asignado ve el reporte en su bandeja y abre su detalle; desde una confirmada, aceptarlo cancela la monitoría, y el reporte sale de la bandeja", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });

    // La bandeja de A lo lista y el detalle trae lo que el admin pesa al decidir; B lo ve pero no es suyo.
    const bandeja = await cargarBandeja(sesionA, adminA.id, new Date(), { maxFilas: 1_000 });
    expect(bandeja.reportes.map((r) => r.id)).toContain(c.idReporte);
    const detalle = await cargarReporte(sesionA, c.idReporte);
    expect(detalle).toMatchObject({
      id: c.idReporte,
      estado: "en_revision",
      idAdmin: adminA.id,
      nombreAdmin: "Admin de prueba",
      fechaDecision: null,
      observaciones: null,
      desembolso: null,
      lead: { nombre: "Lead de prueba", correo: leadDeAncla.correo, telefono: "3101234567" },
      monitor: { nombre: "Monitor de prueba", correo: base.monitor.correo, telefono: "3000000000" },
      monitoria: { id: c.monitoria.id, estado: "confirmada", motivoCancelacion: null, nombreMateria: base.materia.nombre, fechaFinalizacion: null, grupal: false },
      pagos: [{ id: c.pagos[0].id, nombrePagador: c.pagos[0].nombre, monto: c.pagos[0].monto, estado: "aprobado", reembolso: null, resena: null }],
    });
    expect(puedeResolver(detalle!, adminA.id)).toBe(true);
    expect(puedeResolver(detalle!, adminB.id)).toBe(false);
    expect(await cargarReporte(sesionB, c.idReporte)).not.toBeNull();
    expect(await cargarAsignacionDeReporte(sesionA, c.idReporte)).toEqual({ idAdmin: adminA.id, estado: "en_revision" });
    expect(await cargarAsignacionDeReporte(sesionA, randomUUID())).toBeNull();
    expect(await cargarReporte(sesionA, randomUUID())).toBeNull();

    expect(await resolver(sesionA, c.idReporte, "aceptar", `  ${OBSERVACIONES}\n`)).toBe("aceptado");

    expect(await estadoDe(c.monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio", fecha_finalizacion: null });
    const [reporte, ...otros] = await reportesDe(c.monitoria.id);
    expect(otros).toEqual([]);
    expect(reporte).toMatchObject({ estado: "aceptado", id_admin: adminA.id, observaciones: OBSERVACIONES });
    // La hora la pone la base (now()), no el navegador.
    expect(Math.abs(new Date(reporte.fecha_decision!).getTime() - Date.now())).toBeLessThan(MINUTO);
    // Todavía no se había realizado: no hay desembolso que anular.
    expect(await desembolsosDe(c.monitoria.id)).toEqual([]);
    // La cita (cita_por_token) lo dice, y el reporte sale de la bandeja.
    expect(await leerCitaPorToken(c.token)).toMatchObject({ estado: "cancelada", motivoCancelacion: "monitor_no_asistio", estadoReporte: "aceptado" });
    expect((await cargarBandeja(sesionA, adminA.id, new Date(), { maxFilas: 1_000 })).reportes.map((r) => r.id)).not.toContain(c.idReporte);
    expect((await cargarReporte(sesionA, c.idReporte))?.estado).toBe("aceptado");
    // La acción anticipa ya_decidido con esta lectura: tiene que decir cómo quedó.
    expect(await cargarAsignacionDeReporte(sesionA, c.idReporte)).toEqual({ idAdmin: adminA.id, estado: "aceptado" });
  });

  it("desde una realizada con su desembolso pendiente: la monitoría queda cancelada con su fecha de finalización, el desembolso anulado con la misma foto, y ya no se puede ejecutar ni lo lista la bandeja", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado", monto: 41_000 }], estado: "realizada" });
    const [desembolso] = await desembolsosDe(c.monitoria.id);
    expect(desembolso).toMatchObject({ estado: "pendiente", monto_bruto: 41_000 });
    const antes = await estadoDe(c.monitoria.id);
    expect(antes).toMatchObject({ estado: "realizada" });
    expect(antes.fecha_finalizacion).not.toBeNull();

    expect(await resolver(sesionA, c.idReporte, "aceptar", OBSERVACIONES)).toBe("aceptado");

    expect(await estadoDe(c.monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio", fecha_finalizacion: antes.fecha_finalizacion });
    // P-28: solo cambia el estado; la foto (montos y llave) queda como estaba.
    expect(await desembolsosDe(c.monitoria.id)).toEqual([{ ...desembolso, estado: "anulado" }]);
    expect(await motivoParaEjecutar(desembolso.id)).toBe("anulado");
    expect(await cargarDesembolso(sesionA, desembolso.id)).toMatchObject({ estado: "anulado", motivo: "anulado", monitoria: { estado: "cancelada", motivoCancelacion: "monitor_no_asistio" } });
    expect((await cargarBandeja(sesionA, adminA.id, new Date(), { maxFilas: 1_000 })).desembolsos.map((d) => d.id)).not.toContain(desembolso.id);
    // El aviso al monitor sale también de una realizada.
    expect(await eventosDe(c.monitoria.id)).toEqual(["confirmada", "inasistencia_aceptada"]);
    expect(await leerCitaPorToken(c.token)).toMatchObject({ estado: "cancelada", motivoCancelacion: "monitor_no_asistio" });
  });

  it("un desembolso ya transferido no se toca (el dinero ya salió): la decisión se guarda igual y la monitoría se cancela", async () => {
    const a = await antigua(5, { desembolso: "desembolsado" });
    const antes = await desembolsosDe(a.monitoria.id);
    expect(antes).toEqual([expect.objectContaining({ estado: "desembolsado", id_admin: adminA.id, referencia_transferencia: "REF-PRUEBA" })]);

    expect(await resolver(sesionA, a.idReporte, "aceptar")).toBe("aceptado");

    expect(await desembolsosDe(a.monitoria.id)).toEqual(antes);
    expect(await estadoDe(a.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" });
    expect((await reporteEnBd(a.idReporte)).estado).toBe("aceptado");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 2: reembolsos (RN-60, D-37, P-07)
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 2 (D-37, P-07): un reembolso por pago aprobado, con el motivo y el comentario del admin", () => {
  it("la constante de la app es el texto base de la base, y el comentario se recorta como lo hace la base", async () => {
    const { rows } = await bd.query<{ base: string; con: string; blanco: string }>(
      "select privado.motivo_de_inasistencia(null) as base, privado.motivo_de_inasistencia($1) as con, privado.motivo_de_inasistencia(E' \\n\\t ') as blanco",
      [`\n  ${OBSERVACIONES} \t`],
    );
    expect(MOTIVO_INASISTENCIA_ACEPTADA).toBe(BASE);
    expect(rows[0]).toEqual({ base: BASE, con: MOTIVO, blanco: BASE });
  });

  it("dos aprobados, dos en revisión y uno rechazado: reembolsos solo para los aprobados, al primer admin activo, con el comentario; el pedido de llave sale por correo; el pago en revisión que se aprueba después recibe el suyo con el mismo motivo y el que se rechaza no deja nada", async () => {
    const c = await caso(2, {
      pagos: [
        { estado: "aprobado", monto: 31_000 },
        { estado: "aprobado", monto: 18_000 },
        { estado: "en_revision", monto: 12_000 },
        { estado: "en_revision", monto: 9_000 },
        { estado: "rechazado", monto: 7_000 },
      ],
    });
    const [aprobado1, aprobado2, aprobarDespues, rechazarDespues, rechazado] = c.pagos;
    const primero = await primerAdminActivo();
    // Para que el mutante «el reembolso va a quien decide» no pase: quien decide no es el primero del turno (D-26).
    expect(primero).not.toBe(adminA.id);

    expect(await resolver(sesionA, c.idReporte, "aceptar", OBSERVACIONES)).toBe("aceptado");

    const esperado = (p: PagoCreado) => ({ id_pago: p.id, id_admin: primero, monto: p.monto, motivo: MOTIVO, estado: "esperando_llave", llave_destino: null });
    const creados = await reembolsosDe(c.monitoria.id);
    expect(creados).toHaveLength(2);
    for (const p of [aprobado1, aprobado2]) expect(creados.find((r) => r.id_pago === p.id)).toEqual(expect.objectContaining(esperado(p)));

    // El pedido de llave (HU-025): la solicitud y el pedido nacen con el reembolso, y sus datos dicen que fue por inasistencia.
    const reembolso1 = creados.find((r) => r.id_pago === aprobado1.id)!;
    const reembolso2 = creados.find((r) => r.id_pago === aprobado2.id)!;
    const pedido1 = await pedidoDe(reembolso1.id);
    expect(pedido1).toMatchObject({ tipo: "pedido", procesado_en: null, intentos: 0 });
    const datos = exito(await fx.admin.rpc("datos_de_pedido_llave", { p_id: pedido1.id }), "datos del pedido");
    expect(datos[0]).toMatchObject({ motivo_cancelacion: "monitor_no_asistio", motivo: MOTIVO, monto: aprobado1.monto, contacto: aprobado1.contacto });
    expect(await correosA(aprobado1.contacto)).toEqual([]);
    await procesarPedidoHasta(pedido1.id);
    await procesarPedidoHasta((await pedidoDe(reembolso2.id)).id);
    const alPrimero = await correosA(aprobado1.contacto);
    expect(alPrimero).toHaveLength(1);
    expectPedidoDeLlave(alPrimero[0], aprobado1, (await solicitudDe(reembolso1.id)).token);
    expect(await registroDe("solicitud_llave_reembolso", pedido1.id)).toEqual({ estado: "enviado", destinatario: aprobado1.contacto, plantilla: "solicitud_llave_reembolso" });
    const alSegundo = await correosA(aprobado2.contacto);
    expect(alSegundo).toHaveLength(1);
    expectPedidoDeLlave(alSegundo[0], aprobado2, (await solicitudDe(reembolso2.id)).token);
    // Ni el pago en revisión ni el rechazado recibieron correo.
    expect(await correosA(aprobarDespues.contacto)).toEqual([]);
    expect(await correosA(rechazado.contacto)).toEqual([]);

    // P-07: el pago en revisión que se aprueba después de aceptar recibe su reembolso, con el mismo motivo.
    expect(await revisarPago(sesionA, { idPago: aprobarDespues.id, decision: "aprobar", observaciones: null })).toEqual({ resultado: "aprobado", canceloMonitoria: false });
    const tardio = (await reembolsosDe(c.monitoria.id)).find((r) => r.id_pago === aprobarDespues.id);
    expect(tardio).toMatchObject({ id_admin: primero, monto: aprobarDespues.monto, motivo: MOTIVO, estado: "esperando_llave", llave_destino: null });
    const pedidoTardio = await pedidoDe(tardio!.id);
    await procesarPedidoHasta(pedidoTardio.id);
    const alTardio = await correosA(aprobarDespues.contacto);
    expect(alTardio).toHaveLength(1);
    expectPedidoDeLlave(alTardio[0], aprobarDespues, (await solicitudDe(tardio!.id)).token);

    // El que se rechaza después no deja reembolso ni aviso al pagador (RN-43); el rechazado de antes tampoco.
    expect(await revisarPago(sesionA, { idPago: rechazarDespues.id, decision: "rechazar", observaciones: null })).toEqual({ resultado: "rechazado", canceloMonitoria: false });
    const finales = await reembolsosDe(c.monitoria.id);
    expect(finales.map((r) => r.id_pago).sort()).toEqual([aprobado1.id, aprobado2.id, aprobarDespues.id].sort());
    expect(exito(await fx.admin.from("aviso_rechazo_pago").select("id").in("id_pago", [rechazarDespues.id, rechazado.id]), "leer los avisos del rechazo")).toEqual([]);
    expect(await correosA(rechazarDespues.contacto)).toEqual([]);

    // El reembolso abre en su página y el primer admin lo tiene en su bandeja.
    expect(await cargarReembolso(sesionA, tardio!.id)).toMatchObject({
      motivo: MOTIVO,
      monto: aprobarDespues.monto,
      estadoVista: "esperando_llave",
      nombrePagador: aprobarDespues.nombre,
      contacto: aprobarDespues.contacto,
      monitoria: { estado: "cancelada", motivoCancelacion: "monitor_no_asistio" },
    });
    const delPrimero = await cargarBandeja(fx.admin, primero, new Date(), { maxFilas: 1_000 });
    expect(delPrimero.reembolsos.esperandoLlave.map((r) => r.id)).toEqual(expect.arrayContaining([reembolso1.id, reembolso2.id, tardio!.id]));
    // El detalle del reporte los muestra enlazados a cada pago.
    const detalle = await cargarReporte(sesionA, c.idReporte);
    expect(detalle?.pagos.find((p) => p.id === aprobado1.id)?.reembolso).toEqual({ id: reembolso1.id, estado: "esperando_llave" });
    expect(detalle?.pagos.find((p) => p.id === rechazado.id)?.reembolso).toBeNull();
  }, 90_000);

  it("sin observaciones, o con puros espacios y saltos de línea, el motivo es el texto base sin espacio final y el reporte queda sin observaciones", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });

    expect(await resolver(sesionA, c.idReporte, "aceptar", "  \n\t ")).toBe("aceptado");

    expect((await reembolsosDe(c.monitoria.id)).map((r) => r.motivo)).toEqual([BASE]);
    expect((await reporteEnBd(c.idReporte)).observaciones).toBeNull();
  });

  it("sin pagos aprobados no se crea ningún reembolso, y lo aprobado en otra monitoría de la misma persona no se toca", async () => {
    const vacia = await caso(2, { pagos: [{ estado: "en_revision" }, { estado: "rechazado" }] });
    const otra = await caso(2, { pagos: [{ estado: "aprobado" }] });

    expect(await resolver(sesionA, vacia.idReporte, "aceptar", OBSERVACIONES)).toBe("aceptado");

    expect(await reembolsosDe(vacia.monitoria.id)).toEqual([]);
    expect(await reembolsosDe(otra.monitoria.id)).toEqual([]);
    expect((await reporteEnBd(otra.idReporte)).estado).toBe("en_revision");
    expect(await estadoDe(otra.monitoria.id)).toMatchObject({ estado: "confirmada" });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 3: el correo al monitor (D-37, P-37)
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 3 (D-37, P-37): al monitor le llega un correo corto, sin el contacto del estudiante", () => {
  it("el trigger anota el aviso; el proceso manda el correo aunque la sesión ya haya empezado y terminado, sin el estudiante, los montos ni las observaciones, y no lo repite", async () => {
    const propio = await monitorPropio();
    const c = await caso(2, { propio, pagos: [{ estado: "aprobado", monto: 33_000 }] });
    // La sesión ya empezó y ya terminó (duraba 60 min): la vigencia de este aviso no mira la hora de inicio.
    expect(c.inicio.getTime() + HORA).toBeLessThan(Date.now());
    expect(await eventosDe(c.monitoria.id)).toEqual(["confirmada"]);

    expect(await resolver(sesionA, c.idReporte, "aceptar", OBSERVACIONES)).toBe("aceptado");

    expect(await eventosDe(c.monitoria.id)).toEqual(["confirmada", "inasistencia_aceptada"]);
    expect(await correosA(propio.monitor.correo)).toEqual([]);
    await procesarAvisosHasta(c.monitoria.id);

    const recibidos = await correosA(propio.monitor.correo);
    expect(recibidos, "solo el aviso de la inasistencia: el de confirmada ya no vale").toHaveLength(1);
    const [correo] = recibidos;
    expect(correo.Subject).toBe(`Se aceptó un reporte de inasistencia en tu monitoría de ${propio.materia.nombre}`);
    const texto = normalizar(correo.Text);
    expect(texto).toContain("Hola, Monitor de prueba.");
    expect(texto).toContain(`La monitoría de ${propio.materia.nombre} del ${normalizar(formatearFechaHora(c.inicio))}`);
    expect(texto).toContain("Quedó cancelada porque un admin aceptó un reporte de inasistencia.");
    expect(texto).toContain("Por eso no se te desembolsa.");
    expect(texto).toContain("/monitor/agenda");
    expect(correo.HTML).toContain("Ver mi agenda");
    // P-37: nada del estudiante, ni de los pagos, ni lo que el admin escribió para otros.
    for (const privado of [leadDeAncla.nombre, leadDeAncla.correo, "3101234567", c.pagos[0].contacto, c.pagos[0].nombre, OBSERVACIONES].filter(Boolean) as string[]) {
      expect(correo.Text, `el texto no lleva ${privado}`).not.toContain(privado);
      expect(correo.HTML, `el HTML no lleva ${privado}`).not.toContain(privado);
    }
    expect(`${correo.Text} ${correo.HTML}`).not.toMatch(/\$|33\.000|comisi|bruto/i);
    expect(await registroDe("aviso_monitor_inasistencia_aceptada", c.monitoria.id)).toEqual({
      estado: "enviado",
      destinatario: propio.monitor.correo,
      plantilla: "aviso_monitor_inasistencia_aceptada",
    });
    expect((await avisosDelMonitor(c.monitoria.id)).every((a) => a.procesado_en !== null)).toBe(true);

    // Otra corrida, o dos a la vez, no lo manda otra vez.
    await Promise.all([procesarAvisosAlMonitor({ cliente: fx.admin }), procesarAvisosAlMonitor({ cliente: fx.admin })]);
    expect(await correosA(propio.monitor.correo)).toHaveLength(1);
  });

  it("rechazar el reporte no anota ningún aviso: al monitor no le llega nada", async () => {
    const propio = await monitorPropio();
    const c = await caso(2, { propio });

    expect(await resolver(sesionA, c.idReporte, "rechazar", OBSERVACIONES)).toBe("rechazado");

    expect(await eventosDe(c.monitoria.id)).toEqual(["confirmada"]);
    await procesarAvisosHasta(c.monitoria.id);
    expect(await correosA(propio.monitor.correo)).toEqual([]);
  });

  it("con el desembolso ya transferido el correo no dice que no se le desembolsa: el dinero ya salió y la decisión no lo anula", async () => {
    const propio = await monitorPropio();
    const a = await antigua(5, { propio, desembolso: "desembolsado" });
    expect(await desembolsosDe(a.monitoria.id)).toEqual([expect.objectContaining({ estado: "desembolsado" })]);

    expect(await resolver(sesionA, a.idReporte, "aceptar", OBSERVACIONES)).toBe("aceptado");

    expect(await desembolsosDe(a.monitoria.id)).toEqual([expect.objectContaining({ estado: "desembolsado" })]);
    expect(await eventosDe(a.monitoria.id)).toEqual(["inasistencia_aceptada"]);
    await procesarAvisosHasta(a.monitoria.id);

    const recibidos = await correosA(propio.monitor.correo);
    expect(recibidos).toHaveLength(1);
    const [correo] = recibidos;
    expect(correo.Subject).toBe(`Se aceptó un reporte de inasistencia en tu monitoría de ${propio.materia.nombre}`);
    const texto = normalizar(correo.Text);
    expect(texto).toContain("Quedó cancelada porque un admin aceptó un reporte de inasistencia.");
    expect(texto).not.toContain("Por eso no se te desembolsa.");
    for (const contenido of [correo.Subject, correo.Text, correo.HTML]) expect(contenido).not.toMatch(/desembols/i);
    expect(correo.HTML).toContain("Ver mi agenda");
    // El reconstructor de HU-065 da el mismo dato si el correo tuviera que reintentarse.
    expect((await reconstruirAvisoInasistenciaAceptada(a.monitoria.id, fx.admin))?.datos).toMatchObject({ desembolsado: true });
  });

  it("el reconstructor (HU-065) da el mismo correo mientras la monitoría siga cancelada por la inasistencia, solo con cuatro datos y si su desembolso ya salió; con otro motivo no aplica", async () => {
    const propio = await monitorPropio();
    const c = await caso(2, { propio });
    expect(await reconstruirAvisoInasistenciaAceptada(c.monitoria.id, fx.admin)).toBeNull();

    expect(await resolver(sesionA, c.idReporte, "aceptar", OBSERVACIONES)).toBe("aceptado");

    const reconstruido = await reconstruirAvisoInasistenciaAceptada(c.monitoria.id, fx.admin);
    expect(reconstruido?.destinatario).toBe(propio.monitor.correo);
    expect(reconstruido?.datos).toMatchObject({ materia: propio.materia.nombre, nombreMonitor: "Monitor de prueba", desembolsado: false });
    expect(Object.keys(reconstruido!.datos).sort()).toEqual(["desembolsado", "enlace", "inicio", "materia", "nombreMonitor"]);
    expect(RECONSTRUCTORES.aviso_monitor_inasistencia_aceptada).toBeDefined();
    expect(await reconstruirAvisoInasistenciaAceptada("no-es-un-uuid", fx.admin)).toBeNull();

    // La monitoría ya está cancelada: cambiarle el motivo no dispara el trigger (el estado no cambia).
    exito(await fx.admin.from("monitoria").update({ motivo_cancelacion: "estudiante" }).eq("id", c.monitoria.id).select().single(), "cambiar el motivo");
    expect(await reconstruirAvisoInasistenciaAceptada(c.monitoria.id, fx.admin)).toBeNull();
  });

  it("con el proveedor caído el correo queda fallido y el proceso de reintentos lo manda una sola vez", async () => {
    const propio = await monitorPropio();
    const c = await caso(2, { propio });
    expect(await resolver(sesionA, c.idReporte, "aceptar")).toBe("aceptado");
    const clave = claveDeCorreo("aviso_monitor_inasistencia_aceptada", c.monitoria.id);

    vi.stubEnv("MAILPIT_URL", "http://127.0.0.1:1");
    const caida = await procesarAvisosAlMonitor({ cliente: fx.admin });
    vi.stubEnv("MAILPIT_URL", mailpit);
    expect(caida.fallidos).toBeGreaterThanOrEqual(1);
    expect(exito(await fx.admin.from("correo_envio").select("estado, reintentable").eq("clave", clave).single(), "leer el registro")).toEqual({ estado: "fallido", reintentable: true });
    expect(await correosA(propio.monitor.correo)).toEqual([]);

    // El reintento toma los fallidos que llevan 2 minutos quietos: se corre con un "ahora" 3 minutos adelante.
    await reintentarCorreosFallidos({
      cliente: fx.admin,
      reconstructores: RECONSTRUCTORES,
      enviar: enviarCorreoDesdeServidor,
      ahora: new Date(Date.now() + 3 * MINUTO),
    });

    expect(exito(await fx.admin.from("correo_envio").select("estado").eq("clave", clave).single(), "leer el registro").estado).toBe("enviado");
    const recibidos = await correosA(propio.monitor.correo);
    expect(recibidos).toHaveLength(1);
    expect(recibidos[0].Subject).toBe(`Se aceptó un reporte de inasistencia en tu monitoría de ${propio.materia.nombre}`);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 4: rechazar
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 4 (RN-83): rechazar no cambia la monitoría y el desembolso vuelve a ser ejecutable pasada la ventana", () => {
  it("con una monitoría de hace semanas: la monitoría, los pagos y el desembolso quedan como estaban, no hay reembolsos ni avisos, y el desembolso deja de esperar el reporte", async () => {
    const a = await antigua(3, { pagos: [{ estado: "aprobado" }] });
    const [desembolsoAntes] = await desembolsosDe(a.monitoria.id);
    expect(await motivoParaEjecutar(desembolsoAntes.id)).toBe("con_reporte");
    expect((await cargarBandeja(sesionA, adminA.id, new Date(), { maxFilas: 1_000 })).desembolsos.map((d) => d.id)).not.toContain(desembolsoAntes.id);
    const monitoriaAntes = await estadoDe(a.monitoria.id);

    expect(await resolver(sesionA, a.idReporte, "rechazar", OBSERVACIONES)).toBe("rechazado");

    expect(await estadoDe(a.monitoria.id)).toEqual(monitoriaAntes);
    expect(await desembolsosDe(a.monitoria.id)).toEqual([desembolsoAntes]);
    expect(await reembolsosDe(a.monitoria.id)).toEqual([]);
    expect(await eventosDe(a.monitoria.id)).toEqual([]);
    expect(await reporteEnBd(a.idReporte)).toMatchObject({ estado: "rechazado", id_admin: adminA.id, observaciones: OBSERVACIONES });
    // RN-83: ya no hay reporte que lo suspenda.
    expect(await motivoParaEjecutar(desembolsoAntes.id)).toBeNull();
    expect((await cargarBandeja(sesionA, adminA.id, new Date(), { maxFilas: 1_000 })).desembolsos.map((d) => d.id)).toContain(desembolsoAntes.id);
    expect(await cargarDesembolso(sesionA, desembolsoAntes.id)).toMatchObject({ estado: "pendiente", motivo: null });
  });

  it("dentro de la ventana de reporte el desembolso espera igual (antes_de_plazo); con un pago todavía en revisión sigue bloqueado por ese pago", async () => {
    const reciente = await caso(2, { pagos: [{ estado: "aprobado" }], estado: "realizada" });
    const [desembolso] = await desembolsosDe(reciente.monitoria.id);
    expect(await resolver(sesionA, reciente.idReporte, "rechazar")).toBe("rechazado");
    expect(await motivoParaEjecutar(desembolso.id)).toBe("antes_de_plazo");
    expect((await desembolsosDe(reciente.monitoria.id))[0].estado).toBe("pendiente");

    const conPagoEnRevision = await antigua(4, { pagos: [{ estado: "aprobado" }, { estado: "en_revision" }] });
    const [otro] = await desembolsosDe(conPagoEnRevision.monitoria.id);
    expect(await resolver(sesionA, conPagoEnRevision.idReporte, "rechazar")).toBe("rechazado");
    expect(await motivoParaEjecutar(otro.id)).toBe("pagos_en_revision");
  });

  it("rechazar sí se puede aunque la monitoría ya esté cancelada, y no la toca", async () => {
    const propio = base;
    const fecha = lunesDeHace(6);
    const franja = await franjaEn(1, "10:00:00", 600, propio);
    const cancelada = await fx.crearMonitoria({ materia: propio.materia, monitor: propio.monitor, franja, lead: otroLead } as Contexto, { fecha, estado: "cancelada" });
    monitorias.push(cancelada.id);
    const reporte = await fx.crearReporte({ idMonitoria: cancelada.id, idAdmin: adminA.id, estado: "en_revision" });

    expect(await resolver(sesionA, reporte.id, "aceptar")).toBe("no_aceptable");
    expect(await reporteEnBd(reporte.id)).toMatchObject({ estado: "en_revision", fecha_decision: null });
    expect(await resolver(sesionA, reporte.id, "rechazar", OBSERVACIONES)).toBe("rechazado");

    expect(await estadoDe(cancelada.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    expect(await reporteEnBd(reporte.id)).toMatchObject({ estado: "rechazado", observaciones: OBSERVACIONES });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 5: la decisión, a la cita del Lead
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 5 (D-37): quedan fecha y observaciones y el Lead las ve en su cita; si se rechaza, sin correo", () => {
  it("rechazado: las tres lecturas de la cita traen el estado y las observaciones recortadas, la página muestra el texto de «no lo aceptó» con ellas, y el Lead no puede reportar otra vez", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });

    expect(await resolver(sesionA, c.idReporte, "rechazar", `  ${OBSERVACIONES}\n`)).toBe("rechazado");

    const reporte = await reporteEnBd(c.idReporte);
    expect(reporte).toMatchObject({ estado: "rechazado", observaciones: OBSERVACIONES });
    expect(Math.abs(new Date(reporte.fecha_decision!).getTime() - Date.now())).toBeLessThan(MINUTO);
    const esperado = { estadoReporte: "rechazado", observacionesReporte: OBSERVACIONES, estado: "confirmada" };
    expect(await leerCitaPorToken(c.token)).toMatchObject(esperado);
    const miCita = await leerMiCita(ancla.cliente, c.monitoria.id);
    expect(miCita).toMatchObject(esperado);
    expect((await leerMisCitas(ancla.cliente)).find((cita) => cita.idMonitoria === c.monitoria.id)).toMatchObject(esperado);

    const vista = vistaDeCita(miCita!, new Date());
    expect(vista.textoDelReporte).toBe("Un admin revisó tu reporte y no lo aceptó: la monitoría sigue como estaba.");
    expect(vista.observacionesDelReporte).toBe(OBSERVACIONES);
    // Un reporte rechazado no se repite: hay uno por monitoría.
    expect(vista.puedeReportar).toBe(false);
    expect(await reportarInasistenciaDeMiCita(ancla.cliente, c.monitoria.id)).toBe("ya_reportada");
    expect(await reportesDe(c.monitoria.id)).toHaveLength(1);
  });

  it("aceptado: la cita dice que se aceptó, la página no muestra las observaciones (son para quien pagó) y tampoco se puede reportar otra vez", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });

    expect(await resolver(sesionA, c.idReporte, "aceptar", OBSERVACIONES)).toBe("aceptado");

    const miCita = await leerMiCita(ancla.cliente, c.monitoria.id);
    expect(miCita).toMatchObject({ estado: "cancelada", motivoCancelacion: "monitor_no_asistio", estadoReporte: "aceptado", observacionesReporte: OBSERVACIONES });
    expect(await leerCitaPorToken(c.token)).toMatchObject({ estadoReporte: "aceptado", motivoCancelacion: "monitor_no_asistio" });
    const vista = vistaDeCita(miCita!, new Date());
    expect(vista.textoDelMotivo).toBe("El monitor no asistió y se aceptó tu reporte.");
    expect(vista.textoDelReporte).toBeNull();
    expect(vista.observacionesDelReporte).toBeNull();
    expect(vista.puedeReportar).toBe(false);
    expect(await reportarInasistenciaDeMiCita(ancla.cliente, c.monitoria.id)).toBe("ya_reportada");
    expect(await reportesDe(c.monitoria.id)).toHaveLength(1);
  });

  it("sin correo de decisión: tras rechazar una confirmada, ni el Lead, ni el pagador, ni el monitor reciben nada, aunque corran todos los procesos", async () => {
    const propio = await monitorPropio();
    const lead = await leadNuevo();
    const c = await caso(2, { propio, lead, pagos: [{ estado: "aprobado" }] });
    expect(await correosA(lead.correo!)).toEqual([]);

    expect(await resolver(sesionA, c.idReporte, "rechazar", OBSERVACIONES)).toBe("rechazado");
    await procesarAvisosHasta(c.monitoria.id);
    await procesarPedidosDeLlave({ cliente: fx.admin });
    await procesarInvitacionesResena({ cliente: fx.admin });

    expect(await correosA(lead.correo!)).toEqual([]);
    expect(await correosA(c.pagos[0].contacto)).toEqual([]);
    expect(await correosA(propio.monitor.correo)).toEqual([]);
    expect(await reembolsosDe(c.monitoria.id)).toEqual([]);
  });

  it("HU-080: con el reporte en revisión no se invita a reseñar; al rechazarlo la invitación sale (el único correo al Lead, y no es de la decisión); al aceptarlo no sale nunca", async () => {
    const leadRechazada = await leadNuevo();
    const leadAceptada = await leadNuevo();
    const rechazada = await caso(2, { lead: leadRechazada, pagos: [{ estado: "aprobado" }], estado: "realizada" });
    const aceptada = await caso(2, { lead: leadAceptada, pagos: [{ estado: "aprobado" }], estado: "realizada" });
    const invitacionDe = async (idPago: string) =>
      exito(await fx.admin.from("invitacion_resena").select("token, procesado_en").eq("id_pago", idPago).single(), "leer la invitación");

    // Con el reporte en revisión, el proceso la deja en espera: no manda correo ni la marca.
    await procesarInvitacionesResena({ cliente: fx.admin });
    expect(await correosA(leadRechazada.correo!)).toEqual([]);
    expect(await correosA(leadAceptada.correo!)).toEqual([]);
    expect((await invitacionDe(rechazada.pagos[0].id)).procesado_en).toBeNull();

    expect(await resolver(sesionA, rechazada.idReporte, "rechazar", OBSERVACIONES)).toBe("rechazado");
    expect(await resolver(sesionA, aceptada.idReporte, "aceptar", OBSERVACIONES)).toBe("aceptado");
    await procesarInvitacionHasta(rechazada.pagos[0].id);
    await procesarInvitacionesResena({ cliente: fx.admin });

    // El rechazo la libera: es la invitación a calificar (HU-035), no un correo con la decisión.
    const alLead = await correosA(leadRechazada.correo!);
    expect(alLead).toHaveLength(1);
    expect(alLead[0].Subject).toBe("¿Cómo te fue con Monitor de prueba?");
    expect(alLead[0].Text).toContain(rutaDeResena((await invitacionDe(rechazada.pagos[0].id)).token));
    expect(alLead[0].Text).not.toContain(OBSERVACIONES);
    expect(await registroDe("resena_individual", rechazada.pagos[0].id)).toMatchObject({ estado: "enviado", destinatario: leadRechazada.correo });
    // Aceptado, el reporte bloquea la invitación para siempre.
    expect(await correosA(leadAceptada.correo!)).toEqual([]);
    expect((await invitacionDe(aceptada.pagos[0].id)).procesado_en).toBeNull();
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Permisos y resultados por la puerta real
// ---------------------------------------------------------------------------------------------------------------

describe("permisos: solo el admin asignado resuelve, y solo por la función", () => {
  it("otro admin lo ve pero recibe no_asignado, también con observaciones de más de 500 caracteres (quién puede va antes que el texto), y nada cambia", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });
    const antes = await reporteEnBd(c.idReporte);

    expect(await cargarReporte(sesionB, c.idReporte)).toMatchObject({ idAdmin: adminA.id, estado: "en_revision" });
    expect(await resolver(sesionB, c.idReporte, "aceptar", OBSERVACIONES)).toBe("no_asignado");
    expect(await resolver(sesionB, c.idReporte, "rechazar")).toBe("no_asignado");
    expect(await resolver(sesionB, c.idReporte, "aceptar", "x".repeat(501))).toBe("no_asignado");

    expect(await reporteEnBd(c.idReporte)).toEqual(antes);
    expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
    expect(await reembolsosDe(c.monitoria.id)).toEqual([]);
    expect(await eventosDe(c.monitoria.id)).toEqual(["confirmada"]);
  });

  it("el monitor y el Lead no ven el reporte (null) y al resolver reciben sin_permiso; sin sesión la base ni ejecuta la función; nada cambia", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });
    const antes = await reporteEnBd(c.idReporte);

    for (const [quien, cliente] of [
      ["el monitor", sesionMonitor],
      ["el Lead", ancla.cliente],
    ] as const) {
      expect(await cargarReporte(cliente, c.idReporte), `${quien} no ve el reporte`).toBeNull();
      expect(await cargarAsignacionDeReporte(cliente, c.idReporte), `${quien} no ve la asignación`).toBeNull();
      expect(await resolver(cliente, c.idReporte, "aceptar", OBSERVACIONES), `${quien} no resuelve`).toBe("sin_permiso");
      expect(await resolver(cliente, c.idReporte, "rechazar"), `${quien} no resuelve`).toBe("sin_permiso");
    }
    const anonimo = crearCliente();
    await expect(resolverReporte(anonimo, { idReporte: c.idReporte, decision: "aceptar", observaciones: null })).rejects.toThrow(/No se pudo resolver el reporte: 42501/);
    expect((await anonimo.rpc("resolver_reporte_inasistencia", { p_id_reporte: c.idReporte, p_decision: "aceptar", p_observaciones: "" })).error?.code).toBe("42501");
    // La versión con la hora de quien llama vive en privado: nadie la ejecuta desde la Data API.
    expect((await sesionA.rpc("resolver_reporte_inasistencia" as never, { p_id_reporte: c.idReporte, p_decision: "aceptar", p_observaciones: "", p_ahora: new Date().toISOString() } as never)).error).not.toBeNull();
    expect(await reporteEnBd(c.idReporte)).toEqual(antes);
    expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "confirmada" });
  });

  it("nadie escribe directo: ni un admin activo con su sesión puede insertar, actualizar o borrar en reporte_inasistencia, monitoria, desembolso ni reembolso por la Data API", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }], estado: "realizada" });
    const [desembolso] = await desembolsosDe(c.monitoria.id);
    const antesDelReporte = await reporteEnBd(c.idReporte);
    const antesDeLaMonitoria = await estadoDe(c.monitoria.id);
    // Un reembolso de otra monitoría, para intentar escribir sobre él (se borra con su pago).
    const otra = await antigua(7, { pagos: [{ estado: "aprobado" }] });
    const reembolso = await fx.crearReembolso({ idPago: otra.pagos[0].id, idAdmin: adminA.id, estado: "esperando_llave" });

    sinFilas(await sesionA.from("reporte_inasistencia").update({ estado: "aceptado", fecha_decision: new Date().toISOString() }).eq("id", c.idReporte).select());
    sinFilas(await sesionA.from("reporte_inasistencia").delete().eq("id", c.idReporte).select());
    expect((await sesionA.from("reporte_inasistencia").insert({ id_monitoria: otra.monitoria.id, id_admin: adminA.id, estado: "rechazado", fecha_decision: new Date().toISOString() }).select()).error).not.toBeNull();
    sinFilas(await sesionA.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" }).eq("id", c.monitoria.id).select());
    sinFilas(await sesionA.from("monitoria").delete().eq("id", c.monitoria.id).select());
    sinFilas(await sesionA.from("desembolso").update({ estado: "anulado" }).eq("id", desembolso.id).select());
    sinFilas(await sesionA.from("desembolso").delete().eq("id", desembolso.id).select());
    sinFilas(await sesionA.from("reembolso").update({ motivo: "Escrito a mano" }).eq("id", reembolso.id).select());
    sinFilas(await sesionA.from("reembolso").delete().eq("id", reembolso.id).select());
    expect((await sesionA.from("reembolso").insert({ id_pago: otra.pagos[0].id, id_admin: adminA.id, monto: 1, motivo: "Escrito a mano" }).select()).error).not.toBeNull();

    expect(await reporteEnBd(c.idReporte)).toEqual(antesDelReporte);
    expect(await estadoDe(c.monitoria.id)).toEqual(antesDeLaMonitoria);
    expect(await desembolsosDe(c.monitoria.id)).toEqual([desembolso]);
    expect((await reembolsosDe(otra.monitoria.id)).map((r) => r.motivo)).toEqual(["Cancelación de prueba"]);
  });

  it("sin sesión de usuario (rol authenticated sin sub) la función responde sin_sesion y no escribe", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });
    const antes = await reporteEnBd(c.idReporte);
    const conn = await conexion();
    try {
      await conn.cliente.query("begin");
      await conn.cliente.query("set local role authenticated");
      await conn.cliente.query("select set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', true)");
      expect(await decidirEn(conn.cliente, c.idReporte, "aceptar", OBSERVACIONES)).toBe("sin_sesion");
      await conn.cliente.query("rollback");
    } finally {
      await cerrar(conn);
    }
    expect(await reporteEnBd(c.idReporte)).toEqual(antes);
  });
});

describe("los resultados por la puerta real: ninguno escribe nada salvo aceptado y rechazado", () => {
  it("decisión inválida, reporte inexistente, observaciones de más de 500 caracteres (en caracteres, no en bytes) y una segunda decisión que no pisa la primera", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });
    const antes = await reporteEnBd(c.idReporte);
    const mala = (decision: string) => resolverReporte(sesionA, { idReporte: c.idReporte, decision: decision as "aceptar", observaciones: null });

    for (const decision of ["x", "ACEPTAR", "", "aceptar "]) {
      const resultado = await mala(decision);
      resultadosVistos.add(resultado);
      expect(resultado, JSON.stringify(decision)).toBe("decision_invalida");
    }
    expect(await resolver(sesionA, randomUUID(), "aceptar")).toBe("no_encontrado");
    expect(await resolver(sesionA, c.idReporte, "aceptar", "x".repeat(501))).toBe("observaciones_invalidas");
    expect(await resolver(sesionA, c.idReporte, "rechazar", "é".repeat(501))).toBe("observaciones_invalidas");
    expect(await reporteEnBd(c.idReporte)).toEqual(antes);
    expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "confirmada" });

    // 500 caracteres de dos bytes caben: el límite cuenta caracteres.
    expect(await resolver(sesionA, c.idReporte, "rechazar", "é".repeat(500))).toBe("rechazado");
    const decidido = await reporteEnBd(c.idReporte);
    expect([...decidido.observaciones!]).toHaveLength(500);

    // Una decisión no se cambia: ni con la otra decisión, ni con otro texto; fecha y observaciones son las de la primera.
    expect(await resolver(sesionA, c.idReporte, "aceptar", OBSERVACIONES)).toBe("ya_decidido");
    expect(await resolver(sesionA, c.idReporte, "rechazar", "Otro texto")).toBe("ya_decidido");
    expect(await reporteEnBd(c.idReporte)).toEqual(decidido);
    expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
    expect(await reembolsosDe(c.monitoria.id)).toEqual([]);
  });

  it("una monitoría grupal responde no_individual (su reporte es de HU-045) y no escribe nada", async () => {
    const grupal = await caso(2, { lead: await leadNuevo(), pagos: [{ estado: "aprobado" }] });
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: grupal.monitoria.id, cupos: 3, modalidad_pago: "dividido", precio_por_persona: 15_000 }).select().single(),
      "volver grupal la monitoría",
    );
    const antes = await reporteEnBd(grupal.idReporte);

    expect(await resolver(sesionA, grupal.idReporte, "aceptar", OBSERVACIONES)).toBe("no_individual");
    expect(await resolver(sesionA, grupal.idReporte, "rechazar")).toBe("no_individual");
    expect(await reporteEnBd(grupal.idReporte)).toEqual(antes);
    expect(await estadoDe(grupal.monitoria.id)).toMatchObject({ estado: "confirmada" });
    expect(await reembolsosDe(grupal.monitoria.id)).toEqual([]);
    // Solo el aviso de confirmada, que se anotó antes de volverla grupal.
    expect(await eventosDe(grupal.monitoria.id)).toEqual(["confirmada"]);

    // Los avisos de las grupales llegan con sus HUs: aunque la monitoría se cancele por la inasistencia, el trigger no anota
    // el del evento nuevo.
    exito(
      await fx.admin.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" }).eq("id", grupal.monitoria.id).select().single(),
      "cancelar la grupal",
    );
    expect(await eventosDe(grupal.monitoria.id)).toEqual(["confirmada"]);
  });

  it("el detalle y la bandeja nunca traen el bruto, la comisión, el neto ni las llaves; los números de la pantalla no incluyen la comisión", async () => {
    // 41.000 aprobados: comisión de 4.100 y neto de 36.900. La foto del desembolso (25.000, 2.500 y 22.500) tampoco debe asomar.
    const a = await antigua(8, { pagos: [{ estado: "aprobado", monto: 41_000 }, { estado: "en_revision", monto: 12_000 }] });
    const comision = exito(await fx.admin.rpc("comision", { p_monto_bruto: 41_000 }), "calcular la comisión");
    const neto = exito(await fx.admin.rpc("monto_neto", { p_monto_bruto: 41_000 }), "calcular el neto");
    expect([comision, neto]).toEqual([4_100, 36_900]);
    const llaveDelMonitor = exito(await fx.admin.from("monitor_privado").select("llave").eq("id_monitor", base.monitor.id).single(), "leer la llave del monitor").llave;

    for (const estado of ["en_revision", "aceptado"] as const) {
      if (estado === "aceptado") expect(await resolver(sesionA, a.idReporte, "aceptar", OBSERVACIONES)).toBe("aceptado");
      const detalle = await cargarReporte(sesionA, a.idReporte);
      expect(detalle?.estado).toBe(estado);
      expect(clavesDe(detalle).filter((clave) => /bruto|comisi|monto_neto|llave/i.test(clave))).toEqual([]);
      expect(numerosDe(detalle).filter((n) => [comision, neto, 25_000 - 2_500, 2_500].includes(n))).toEqual([]);
      const texto = JSON.stringify(detalle);
      expect(texto).not.toContain(llaveDelMonitor);
      expect(texto).not.toContain("llave-de-prueba");
    }
    const bandeja = await cargarBandeja(sesionA, adminA.id, new Date(), { maxFilas: 1_000 });
    expect(clavesDe(bandeja.reportes).filter((clave) => /bruto|comisi|monto_neto|llave/i.test(clave))).toEqual([]);
  });

  it("D-40 (c): la reseña se conserva y el admin la ve al decidir, también después de aceptar", async () => {
    const a = await antigua(9, { pagos: [{ estado: "aprobado" }] });
    exito(
      await fx.admin.from("resena").insert({ id_pago: a.pagos[0].id, calificacion: 2, comentario: "El monitor no apareció <b>nunca</b>." }).select().single(),
      "guardar la reseña",
    );

    expect((await cargarReporte(sesionA, a.idReporte))?.pagos[0].resena).toEqual({ calificacion: 2, comentario: "El monitor no apareció <b>nunca</b>." });
    expect(await resolver(sesionA, a.idReporte, "aceptar")).toBe("aceptado");
    expect((await cargarReporte(sesionA, a.idReporte))?.pagos[0].resena).toEqual({ calificacion: 2, comentario: "El monitor no apareció <b>nunca</b>." });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Carreras con dos conexiones `pg` (A.5): la segunda espera el candado de la primera
// ---------------------------------------------------------------------------------------------------------------

describe("carreras (A.5): quedan en fila por la monitoría y la segunda lee lo que dejó la primera", () => {
  it("doble clic o dos pestañas: la segunda decisión espera, recibe ya_decidido y no pisa nada; un solo reembolso por pago y un solo aviso", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }, { estado: "aprobado" }] });

    const [primera, segunda] = await carrera(
      { rol: adminA, hacer: (conn) => decidirEn(conn.cliente, c.idReporte, "aceptar", "Primera pestaña.") },
      { rol: adminA, hacer: (conn) => decidirEn(conn.cliente, c.idReporte, "aceptar", "Segunda pestaña.") },
    );

    expect([primera, segunda]).toEqual(["aceptado", "ya_decidido"]);
    expect(await reporteEnBd(c.idReporte)).toMatchObject({ estado: "aceptado", observaciones: "Primera pestaña." });
    expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" });
    const creados = await reembolsosDe(c.monitoria.id);
    expect(creados.map((r) => r.id_pago).sort()).toEqual(c.pagos.map((p) => p.id).sort());
    expect(creados.map((r) => r.motivo)).toEqual([`${BASE} Primera pestaña.`, `${BASE} Primera pestaña.`]);
    expect((await eventosDe(c.monitoria.id)).filter((e) => e === "inasistencia_aceptada")).toHaveLength(1);
  }, 60_000);

  it("rechazar y aceptar a la vez: gana la primera y la otra recibe ya_decidido", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });

    const [primera, segunda] = await carrera(
      { rol: adminA, hacer: (conn) => decidirEn(conn.cliente, c.idReporte, "rechazar", "Rechazada primero.") },
      { rol: adminA, hacer: (conn) => decidirEn(conn.cliente, c.idReporte, "aceptar", "Aceptada después.") },
    );

    expect([primera, segunda]).toEqual(["rechazado", "ya_decidido"]);
    expect(await reporteEnBd(c.idReporte)).toMatchObject({ estado: "rechazado", observaciones: "Rechazada primero." });
    expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
    expect(await reembolsosDe(c.monitoria.id)).toEqual([]);
    expect(await eventosDe(c.monitoria.id)).toEqual(["confirmada"]);
  }, 60_000);

  it.each(["la decisión primero", "la aprobación primero"] as const)(
    "contra revisar_pago aprobando un pago en revisión, con %s: siempre un solo reembolso para ese pago, con el motivo y el comentario",
    async (orden) => {
      const c = await caso(2, { pagos: [{ estado: "aprobado" }, { estado: "en_revision", monto: 12_000 }] });
      const [, enRevision] = c.pagos;
      const decidir = { rol: adminA, hacer: (conn: Conexion) => decidirEn(conn.cliente, c.idReporte, "aceptar", OBSERVACIONES) };
      const aprobar = { rol: adminA, hacer: (conn: Conexion) => aprobarEn(conn.cliente, enRevision.id) };

      const [decision, aprobacion] = orden === "la decisión primero" ? await carrera(decidir, aprobar) : (await carrera(aprobar, decidir)).reverse();

      expect(decision).toBe("aceptado");
      expect(aprobacion).toMatchObject({ resultado: "aprobado" });
      const primero = await primerAdminActivo();
      const creados = await reembolsosDe(c.monitoria.id);
      expect(creados.map((r) => r.id_pago).sort()).toEqual(c.pagos.map((p) => p.id).sort());
      expect(creados.filter((r) => r.id_pago === enRevision.id)).toEqual([
        expect.objectContaining({ id_admin: primero, monto: 12_000, motivo: MOTIVO, estado: "esperando_llave" }),
      ]);
      expect(exito(await fx.admin.from("pago").select("estado").eq("id", enRevision.id).single(), "leer el pago").estado).toBe("aprobado");
    },
    60_000,
  );

  it.each(["la decisión primero", "la ejecución primero"] as const)(
    "contra ejecutar_desembolso, con %s: con el reporte en revisión ejecutar responde con_reporte y no escribe; el desembolso termina anulado",
    async (orden) => {
      const a = await antigua(10, { pagos: [{ estado: "aprobado" }] });
      const [desembolso] = await desembolsosDe(a.monitoria.id);
      const decidir = { rol: adminA, hacer: (conn: Conexion) => decidirEn(conn.cliente, a.idReporte, "aceptar", OBSERVACIONES) };
      const ejecutar = { rol: adminA, hacer: (conn: Conexion) => ejecutarEn(conn.cliente, desembolso.id) };

      const [decision, ejecucion] = orden === "la decisión primero" ? await carrera(decidir, ejecutar) : (await carrera(ejecutar, decidir)).reverse();

      // Si la decisión va primero, ejecutar lee un desembolso anulado; si va después, un reporte en revisión (con_reporte).
      expect(decision).toBe("aceptado");
      expect(ejecucion).toBe(orden === "la decisión primero" ? "anulado" : "con_reporte");
      expect(await desembolsosDe(a.monitoria.id)).toEqual([{ ...desembolso, estado: "anulado" }]);
      expect(await estadoDe(a.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" });
    },
    60_000,
  );

  it.each(["la decisión primero", "reasignar primero"] as const)(
    "contra reasignar_casos_de_admin(A), con %s: o la decisión confirma y la reasignación salta el reporte, o el reporte pasa a otro admin y A recibe no_asignado sin escribir",
    async (orden) => {
      const c = await caso(2, { pagos: [{ estado: "aprobado" }] });
      const decidir = { rol: adminA, hacer: (conn: Conexion) => decidirEn(conn.cliente, c.idReporte, "aceptar", OBSERVACIONES) };
      // reasignar_casos_de_admin lo ejecuta service_role (HU-054): aquí, el dueño de la base.
      const reasignar = { hacer: (conn: Conexion) => conn.cliente.query("select public.reasignar_casos_de_admin($1::uuid)", [adminA.id]) };

      const decision = orden === "la decisión primero" ? (await carrera(decidir, reasignar))[0] : (await carrera(reasignar, decidir))[1];

      const reporte = await reporteEnBd(c.idReporte);
      if (orden === "la decisión primero") {
        // reasignar espera la fila del reporte; al confirmar la decisión, vuelve a mirar `estado = 'en_revision'` y la salta.
        expect(decision).toBe("aceptado");
        expect(reporte).toMatchObject({ estado: "aceptado", id_admin: adminA.id, observaciones: OBSERVACIONES });
        expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" });
        expect(await reembolsosDe(c.monitoria.id)).toHaveLength(1);
      } else {
        // El reporte pasó a otro admin entre la lectura y el candado: la decisión de A no escribe nada.
        expect(decision).toBe("no_asignado");
        expect(reporte.id_admin).not.toBe(adminA.id);
        expect(reporte).toMatchObject({ estado: "en_revision", fecha_decision: null, observaciones: null });
        expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
        expect(await reembolsosDe(c.monitoria.id)).toEqual([]);
        expect(await eventosDe(c.monitoria.id)).toEqual(["confirmada"]);
      }
    },
    60_000,
  );

  it.each(["la decisión primero", "finalizar primero"] as const)(
    "contra finalizar_monitoria del monitor, con %s: termina cancelada por la inasistencia; sin desembolso si la decisión llegó primero, y con el desembolso anulado si finalizó primero",
    async (orden) => {
      const c = await caso(2, { pagos: [{ estado: "aprobado", monto: 27_000 }] });
      const decidir = { rol: adminA, hacer: (conn: Conexion) => decidirEn(conn.cliente, c.idReporte, "aceptar", OBSERVACIONES) };
      const finalizar = {
        rol: base.monitor,
        hacer: async (conn: Conexion) => {
          const { rows } = await conn.cliente.query<{ r: string }>("select public.finalizar_monitoria($1::uuid) as r", [c.monitoria.id]);
          return rows[0].r;
        },
      };

      const [decision, finalizacion] = orden === "la decisión primero" ? await carrera(decidir, finalizar) : (await carrera(finalizar, decidir)).reverse();

      expect(decision).toBe("aceptado");
      expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" });
      expect((await reporteEnBd(c.idReporte)).estado).toBe("aceptado");
      if (orden === "la decisión primero") {
        // La monitoría ya estaba cancelada: finalizar no la encuentra confirmada y no crea desembolso.
        expect(finalizacion).toBe("no_confirmada");
        expect(await desembolsosDe(c.monitoria.id)).toEqual([]);
      } else {
        // Finalizó primero: el trigger de HU-028 creó el desembolso y la decisión lo anuló.
        expect(finalizacion).toBe("finalizada");
        expect(await desembolsosDe(c.monitoria.id)).toEqual([expect.objectContaining({ estado: "anulado", monto_bruto: 27_000 })]);
      }
    },
    60_000,
  );

  it.each(["la decisión primero", "el cierre primero"] as const)(
    "contra el cierre automático (pg_cron), con %s: termina cancelada; sin desembolso si la decisión ganó (el cierre no la pasa a realizada), y con el desembolso anulado si el cierre ganó",
    async (orden) => {
      // Empezó hace 23 h: su cierre automático (fin + 24 h) cae dentro de 2 h y, con `p_ahora` en ese instante, ninguna otra
      // confirmada de la prueba (las demás empezaron hace 2 h) lo alcanza. pg_cron tampoco la cierra mientras corre la prueba.
      const c = await caso(23, { pagos: [{ estado: "aprobado", monto: 27_000 }] });
      const { rows } = await bd.query<{ limite: Date }>(
        `select public.cierre_automatico_desde(public.fin_programado(public.inicio_sesion(m.fecha, f.hora), f.duracion_min)) as limite
           from public.monitoria m join public.franja f on f.id = m.id_franja where m.id = $1`,
        [c.monitoria.id],
      );
      const limite = rows[0].limite.toISOString();
      const decidir = { rol: adminA, hacer: (conn: Conexion) => decidirEn(conn.cliente, c.idReporte, "aceptar", OBSERVACIONES) };
      // La otra ruta del cierre: un solo UPDATE ... where estado = 'confirmada' sin `for update` explícito.
      const cerrarSolas = {
        hacer: async (conn: Conexion) => {
          const { rows: cierre } = await conn.cliente.query<{ cerradas: number }>("select privado.cerrar_monitorias_sin_finalizar($1::timestamptz) as cerradas", [limite]);
          return cierre[0].cerradas;
        },
      };

      const [decision, cerradas] = orden === "la decisión primero" ? await carrera(decidir, cerrarSolas) : (await carrera(cerrarSolas, decidir)).reverse();

      expect(decision).toBe("aceptado");
      expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" });
      expect((await reporteEnBd(c.idReporte)).estado).toBe("aceptado");
      if (orden === "la decisión primero") {
        // El cierre esperó, volvió a mirar la fila ya cancelada y la saltó.
        expect(await desembolsosDe(c.monitoria.id)).toEqual([]);
      } else {
        expect(cerradas).toBeGreaterThanOrEqual(1);
        expect(await desembolsosDe(c.monitoria.id)).toEqual([expect.objectContaining({ estado: "anulado", monto_bruto: 27_000 })]);
      }
    },
    60_000,
  );

  it("un admin desactivado mientras espera el candado de la monitoría recibe sin_permiso y no escribe nada, aunque su token siga vigente", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });
    const antes = await reporteEnBd(c.idReporte);

    try {
      await conDosConexiones(async (dueno, a) => {
        await dueno.cliente.query("begin");
        await dueno.cliente.query("select 1 from public.monitoria where id = $1 for update", [c.monitoria.id]);
        await a.cliente.query("begin");
        await como(a.cliente, adminA);
        const decision = enCurso(decidirEn(a.cliente, c.idReporte, "aceptar", OBSERVACIONES));
        await esperarBloqueo(a.pid, dueno.pid, decision);

        // Mientras espera, lo desactivan (RN-23: banear en Auth). privado.es_admin() lee auth.users en cada llamada.
        await bd.query("update auth.users set banned_until = 'infinity' where id = $1", [adminA.id]);
        await dueno.cliente.query("commit");

        expect(await decision.promesa).toBe("sin_permiso");
        await a.cliente.query("commit");
      });
    } finally {
      await bd.query("update auth.users set banned_until = null where id = $1", [adminA.id]);
    }

    expect(await reporteEnBd(c.idReporte)).toEqual(antes);
    expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "confirmada", motivo_cancelacion: null });
    expect(await reembolsosDe(c.monitoria.id)).toEqual([]);
    expect(await eventosDe(c.monitoria.id)).toEqual(["confirmada"]);
    // Restaurado el admin, vuelve a poder resolver.
    expect(await resolver(sesionA, c.idReporte, "rechazar")).toBe("rechazado");
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Al final del archivo: cobertura de resultados y P-44 con la función real (deja desactivado al admin A)
// ---------------------------------------------------------------------------------------------------------------

describe("los once resultados de la función se vieron por la puerta real", () => {
  it("cada uno de RESULTADOS_DE_RESOLUCION salió al menos una vez en este archivo", () => {
    expect([...resultadosVistos].sort()).toEqual([...RESULTADOS_DE_RESOLUCION].sort());
  });
});

describe("P-44 con la función real: al desactivar al admin asignado, su reporte pasa al siguiente y lo resuelve", () => {
  it("el reporte pasa a B; A, desactivado, ya no lo ve ni lo resuelve (sin_permiso) aunque su token siga vigente; B lo acepta", async () => {
    const c = await caso(2, { pagos: [{ estado: "aprobado" }] });
    expect(await cargarAsignacionDeReporte(sesionB, c.idReporte)).toEqual({ idAdmin: adminA.id, estado: "en_revision" });

    await desactivarCuenta(adminA.id);

    expect(await reporteEnBd(c.idReporte)).toMatchObject({ estado: "en_revision", id_admin: adminB.id });
    expect(await cargarReporte(sesionA, c.idReporte)).toBeNull();
    expect(await resolver(sesionA, c.idReporte, "aceptar", OBSERVACIONES)).toBe("sin_permiso");
    expect(await resolver(sesionA, c.idReporte, "rechazar")).toBe("sin_permiso");
    expect(await reporteEnBd(c.idReporte)).toMatchObject({ estado: "en_revision", id_admin: adminB.id });
    expect((await cargarBandeja(sesionB, adminB.id, new Date(), { maxFilas: 1_000 })).reportes.map((r) => r.id)).toContain(c.idReporte);

    expect(await resolver(sesionB, c.idReporte, "aceptar", OBSERVACIONES)).toBe("aceptado");
    expect(await reporteEnBd(c.idReporte)).toMatchObject({ estado: "aceptado", id_admin: adminB.id, observaciones: OBSERVACIONES });
    expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" });
    // Los reembolsos nacen con el primer admin activo, no con quien decide.
    const primero = await primerAdminActivo();
    expect(primero).not.toBe(adminB.id);
    expect((await reembolsosDe(c.monitoria.id)).map((r) => r.id_admin)).toEqual([primero]);
  }, 60_000);
});
