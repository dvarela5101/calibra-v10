import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { procesarAvisosDeRechazoDePago } from "@/lib/admin/avisos-rechazo";
import { autorizarCancelacion, cargarCitaParaAutorizar, cargarCitasSinPlazo } from "@/lib/admin/citas";
import {
  aDevolver,
  RESULTADOS_DE_AUTORIZACION,
  TEXTOS_DE_CATEGORIA,
  TEXTOS_DEL_REGISTRO,
  vistaDeLaCita,
  type Categoria,
  type ResultadoDeAutorizacion,
} from "@/lib/admin/citas-reglas";
import { revisarPago } from "@/lib/admin/pagos";
import { cargarAgenda } from "@/lib/agenda/servidor";
import { desactivarCuenta } from "@/lib/auth/cuentas";
import { procesarAvisosAlMonitor, reconstruirAvisoCancelada } from "@/lib/avisos/servidor";
import { cancelarMiCita, procesarCancelacionesDeCita, reconstruirCancelacionCita } from "@/lib/citas/cancelar";
import { vistaDeCita } from "@/lib/citas/reglas";
import { leerCitaPorToken, leerMiCita, leerMisCitas } from "@/lib/citas/servidor";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { diaDelNegocio } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";
import { procesarPedidosDeLlave } from "@/lib/reembolsos/pedidos";
import { MOTIVO_CANCELACION_A_TIEMPO, MOTIVO_CANCELACION_AUTORIZADA, rutaDeLlave, TEXTO_PAGO_EN_REVISION_AL_CANCELAR } from "@/lib/reembolsos/reglas";
import { diaIsoDeFecha, inicioDeSesion } from "@/lib/plazos/motor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-052 contra el Supabase local: un admin autoriza cancelar una individual confirmada a la que ya se le pasó el plazo de
 * 12 h y todavía no empieza (RN-60, D-60). Se recorre por el mismo código que usan las páginas y la acción de `/admin/citas`
 * (`cargarCitasSinPlazo`, `cargarCitaParaAutorizar` y `autorizarCancelacion`, con la sesión de verdad de cada admin), así que
 * también se prueban `public.autorizar_cancelacion_fuera_de_plazo`, la vista de la lista, sus permisos y que nadie escriba
 * `cancelacion_excepcional` por su cuenta. Los bordes de cada resultado, con una hora fija, están en
 * `supabase/tests/cancelar_fuera_de_plazo.test.sql`.
 *
 * Lo que la base anota al autorizar se sigue hasta el correo con los mismos procesadores que las rutas `/api/procesos/*`: la
 * cancelación al Lead, el aviso al monitor y el pedido de llave de cada pagador salen por Mailpit, y ninguno lleva la nota ni
 * el motivo de la excepción. Las carreras van con dos conexiones `pg` reales, cada una en su transacción y con el rol y el
 * token de su admin, como en `integracion/resolver-reportes.test.ts`: la segunda espera el candado de la primera. Las que
 * necesitan una hora simulada llaman las funciones de `privado` como dueño de la base, con el token del admin.
 *
 * Cada cita se crea `pendiente_pago` y se confirma con un UPDATE (así el trigger de HU-019 le anota su token y el de HU-051 su
 * aviso), en su propia franja, con un inicio relativo a la hora real: dentro de 5 horas, para que el plazo de 12 h ya haya
 * pasado y el cierre automático (pg_cron) no la alcance mientras corre la prueba. El Lead que agendó es la sesión anónima
 * `ancla`; los demás son Leads sueltos. Tres inicios de sesión con contraseña (los dos admins y el monitor) y sesiones
 * anónimas: el Auth local deja 30 inicios cada 5 minutos para toda la suite. El «admin desactivado» es el admin A al final del
 * archivo, tras `desactivarCuenta`, sin un cuarto inicio.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;

/** Lo que escribe el admin: una cadena propia de la prueba, para buscarla en todo lo que ven los demás. */
const nota = () => `Nota privada del caso ${randomUUID()}.`;
const SOPORTE = "datos-personales@calibra.test";
const MOTIVO_DE_OTRO_CONTACTO = "Le escribimos a quien pagó, a su correo, para pedirle la llave y devolverle el dinero.";

type Contexto = Awaited<ReturnType<Fixtures["crearContextoDeMonitoria"]>>;
type Lead = Awaited<ReturnType<Fixtures["crearLead"]>>;
type Mensaje = { Subject: string; Text: string; HTML: string };
/** Un monitor con su materia: el compartido de la prueba o uno propio, con un buzón que solo tiene lo de su prueba. */
type Propio = { materia: Contexto["materia"]; monitor: UsuarioPrueba };
type PagoDePrueba = { estado: "aprobado" | "en_revision" | "rechazado"; monto?: number; delLead?: boolean };
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
/** La sesión anónima del Lead que agendó, y su Lead; otra sesión anónima sin citas; y un Lead suelto sin sesión. */
let ancla: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
let leadDeAncla: Lead;
let otra: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
const monitorias: string[] = [];
const pagos: string[] = [];
const correos = new Set<string>();
const resultadosVistos = new Set<ResultadoDeAutorizacion>();

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
    // A y B quedan seguidos en el turno, por encima de los demás admins de la base: el primer admin activo (D-26), que recibe
    // los reembolsos, no es ninguno de los dos, y mover a B un puesto solo lo intercambia con A.
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
    otra = await fx.crearAnonimo();
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
  if (monitorias.length) {
    for (const tabla of ["aviso_monitor", "cancelacion_cita", "confirmacion_cita"] as const) {
      await fx.admin.from(tabla).update({ procesado_en: ahora }).in("id_monitoria", monitorias).is("procesado_en", null);
    }
  }
  if (pagos.length) await fx.admin.from("aviso_rechazo_pago").update({ procesado_en: ahora }).in("id_pago", pagos).is("procesado_en", null);
  const reembolsos = await reembolsosDePagos();
  if (reembolsos.length) await fx.admin.from("pedido_llave").update({ procesado_en: ahora }).in("id_reembolso", reembolsos).is("procesado_en", null);
});

afterAll(async () => {
  for (const correo of correos) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(() => undefined);
  }
  if (fx) {
    // Los reportes de la carrera con `reportar_inasistencia` no pasan por `fx.crearReporte`: `limpiar()` no los borra y la llave
    // foránea impide borrar antes la monitoría.
    if (monitorias.length) await fx.admin.from("reporte_inasistencia").delete().in("id_monitoria", monitorias);
    // Las filas de `correo_envio` no caen en cascada: las de la cancelación al Lead, los avisos al monitor, los pedidos de llave
    // (se van con su reembolso) y los rechazos sin reembolso. Por lotes: cada clave mide unos 60 caracteres y el filtro viaja en
    // la URL.
    const reembolsos = await reembolsosDePagos();
    const { data: pedidos } = reembolsos.length ? await fx.admin.from("pedido_llave").select("id").in("id_reembolso", reembolsos) : { data: [] };
    const claves = [
      ...monitorias.flatMap((id) => [
        claveDeCorreo("cancelacion_cita", id),
        claveDeCorreo("aviso_monitor_cancelada", id),
        claveDeCorreo("aviso_monitor_confirmada", id),
        claveDeCorreo("aviso_monitor_pago_rechazado", id),
      ]),
      ...(pedidos ?? []).map(({ id }) => claveDeCorreo("solicitud_llave_reembolso", id)),
      ...pagos.flatMap((id) => [claveDeCorreo("pago_rechazado_sin_reembolso", id), claveDeCorreo("pago_rechazado_individual", id)]),
    ];
    for (let i = 0; i < claves.length; i += 40) await fx.admin.from("correo_envio").delete().in("clave", claves.slice(i, i + 40));
    await fx.limpiar();
  }
  if (bd) await bd.end();
});

// ---------------------------------------------------------------------------------------------------------------
// Fechas y escenario
// ---------------------------------------------------------------------------------------------------------------

const formatoDeHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Bogota",
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

/** Un monitor con su contacto y su materia, certificado por el admin A, con un buzón que solo tiene lo de su prueba. */
async function monitorPropio(): Promise<Propio> {
  const materia = await fx.crearMateria(`Materia de prueba ${randomUUID().slice(0, 6)}`);
  const monitor = await fx.crearMonitor({ conContacto: true });
  correos.add(monitor.correo);
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: adminA.id });
  return { materia, monitor };
}

/** Un pago de la monitoría, asignado al admin A. El contacto es el correo del Lead o uno propio de la prueba. */
async function crearPago(idMonitoria: string, pago: PagoDePrueba, lead: Lead): Promise<PagoCreado> {
  const nombre = `Pagador ${randomUUID().slice(0, 6)}`;
  const contacto = pago.delLead ? lead.correo! : `pagador-${randomUUID()}@calibra.test`;
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

type Caso = {
  monitoria: Awaited<ReturnType<Fixtures["crearMonitoria"]>>;
  /** El instante exacto en que empieza la sesión. */
  inicio: Date;
  pagos: PagoCreado[];
  token: string;
  propio: Propio;
  lead: Lead;
  contexto: Contexto;
};

/**
 * Una individual que empieza dentro de `horas` horas (negativo: ya empezó), en su propia franja y con sus pagos. Nace
 * `pendiente_pago` y se confirma con un UPDATE, como `registrar_pago`: el trigger de HU-019 le anota su token y el de HU-051
 * su aviso de confirmada. Con `estado: "pendiente_pago"` se queda ahí y sin pagos; con `"realizada"` se finaliza después
 * (el trigger de HU-028 le crea el desembolso), por lo que debe haber empezado.
 */
async function caso(
  horas: number,
  opciones: { propio?: Propio; lead?: Lead; pagos?: PagoDePrueba[]; estado?: "pendiente_pago" | "confirmada" | "realizada" } = {},
): Promise<Caso> {
  const propio = opciones.propio ?? base;
  const lead = opciones.lead ?? leadDeAncla;
  const inicio = new Date(Math.floor((Date.now() + horas * HORA) / MINUTO) * MINUTO);
  const sesion = sesionEn(inicio);
  const franja = await fx.crearFranja({
    idMonitor: propio.monitor.id,
    dia: sesion.dia,
    hora: sesion.hora,
    duracionMin: Math.min(60, 24 * 60 - sesion.minutoDelDia),
  });
  const contexto = { materia: propio.materia, monitor: propio.monitor, franja, lead } as Contexto;
  const monitoria = await fx.crearMonitoria(contexto, { fecha: sesion.fecha, estado: "pendiente_pago" });
  monitorias.push(monitoria.id);
  const estado = opciones.estado ?? "confirmada";
  const creados: PagoCreado[] = [];
  if (estado !== "pendiente_pago") {
    exito(await fx.admin.from("monitoria").update({ estado: "confirmada" }).eq("id", monitoria.id).select().single(), "confirmar la monitoría");
    for (const pago of opciones.pagos ?? [{ estado: "aprobado" }]) creados.push(await crearPago(monitoria.id, pago, lead));
  }
  if (estado === "realizada") {
    exito(
      await fx.admin.from("monitoria").update({ estado: "realizada", fecha_finalizacion: new Date().toISOString() }).eq("id", monitoria.id).select().single(),
      "pasar la monitoría a realizada",
    );
  }
  const token = estado === "pendiente_pago" ? "" : await tokenDe(monitoria.id);
  return { monitoria, inicio, pagos: creados, token, propio, lead, contexto };
}

// ---------------------------------------------------------------------------------------------------------------
// Lo que hay en la base
// ---------------------------------------------------------------------------------------------------------------

/** Lo mismo que hace la acción con lo que llega del formulario (ya validado por `leerAutorizacion`). */
async function autorizar(cliente: Cliente, idMonitoria: string, categoria: Categoria, texto: string | null = null) {
  const resultado = await autorizarCancelacion(cliente, { idMonitoria, categoria, nota: texto });
  resultadosVistos.add(resultado);
  return resultado;
}

async function estadoDe(idMonitoria: string) {
  return exito(await fx.admin.from("monitoria").select("estado, motivo_cancelacion, fecha_finalizacion").eq("id", idMonitoria).single(), "leer la monitoría");
}

async function registroDe(idMonitoria: string) {
  const filas = exito(
    await fx.admin.from("cancelacion_excepcional").select("id_monitoria, id_admin, categoria, nota, autorizada_en").eq("id_monitoria", idMonitoria),
    "leer la autorización",
  );
  return filas[0] ?? null;
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
  return exito(await fx.admin.from("solicitud_llave").select("token, en_correo_de_cancelacion").eq("id_reembolso", idReembolso).single(), "leer la solicitud de llave");
}

async function pedidoDe(idReembolso: string) {
  const filas = exito(
    await fx.admin.from("pedido_llave").select("id, tipo, procesado_en, intentos").eq("id_reembolso", idReembolso).eq("tipo", "pedido"),
    "leer el pedido de la llave",
  );
  expect(filas, "un solo pedido de llave por reembolso").toHaveLength(1);
  return filas[0];
}

async function cancelacionDe(idMonitoria: string) {
  const filas = exito(
    await fx.admin
      .from("cancelacion_cita")
      .select("correo_destino, con_pago_en_revision, reembolso_a_otro_contacto, procesado_en, intentos")
      .eq("id_monitoria", idMonitoria),
    "leer la cancelación",
  );
  return filas[0] ?? null;
}

async function avisosDelMonitor(idMonitoria: string) {
  return exito(await fx.admin.from("aviso_monitor").select("evento, procesado_en").eq("id_monitoria", idMonitoria).order("creado_en"), "leer aviso_monitor");
}

const eventosDe = async (idMonitoria: string) => (await avisosDelMonitor(idMonitoria)).map((a) => a.evento);

async function avisosDeRechazoDe(idPago: string) {
  return exito(await fx.admin.from("aviso_rechazo_pago").select("caso, procesado_en").eq("id_pago", idPago), "leer aviso_rechazo_pago");
}

async function desembolsosDe(idMonitoria: string) {
  return exito(await fx.admin.from("desembolso").select("id, estado").eq("id_monitoria", idMonitoria), "leer los desembolsos de la monitoría");
}

async function registroDeCorreo(plantilla: "cancelacion_cita" | "aviso_monitor_cancelada" | "solicitud_llave_reembolso" | "pago_rechazado_sin_reembolso", entidad: string) {
  const filas = exito(
    await fx.admin.from("correo_envio").select("estado, destinatario, plantilla").eq("clave", claveDeCorreo(plantilla, entidad)),
    "leer el registro de correos",
  );
  return filas[0] ?? null;
}

/** Todo lo que cuelga de una monitoría: lo que no debe cambiar cuando la autorización no la cancela. */
async function foto(idMonitoria: string) {
  return {
    monitoria: await estadoDe(idMonitoria),
    registro: await registroDe(idMonitoria),
    reembolsos: await reembolsosDe(idMonitoria),
    cancelacion: await cancelacionDe(idMonitoria),
    avisos: await eventosDe(idMonitoria),
    pagos: exito(await fx.admin.from("pago").select("id, estado").eq("id_monitoria", idMonitoria).order("id"), "leer los pagos"),
  };
}

/** El primer admin activo de la base (el turno de D-26): quien recibe los reembolsos, sin importar quién autoriza. */
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

/**
 * La comisión y el neto de un monto, que calcula la base (solo `service_role` ejecuta esas funciones): las cifras que ninguna
 * pantalla ni correo de esta HU puede traer (CLAUDE.md, D-59). Los montos de la prueba se eligen para que no coincidan con otro.
 */
async function cifrasProhibidas(monto: number): Promise<number[]> {
  const comision = exito(await fx.admin.rpc("comision", { p_monto_bruto: monto }), "calcular la comisión");
  const neto = exito(await fx.admin.rpc("monto_neto", { p_monto_bruto: monto }), "calcular el neto");
  return [comision, neto];
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

/**
 * El correo de cancelación de una cita: el que lleva un enlace único de la prueba, el de la llave de su reembolso o, sin
 * reembolsos, el de «Ver mi cita». El Lead de la sesión anónima recibe los de todas las citas del archivo.
 */
async function correoCon(destino: string, enlace: string): Promise<Mensaje | undefined> {
  return (await correosA(destino)).find((c) => c.Text.includes(enlace));
}

/** Corre el proceso de cancelaciones hasta que la de esa monitoría queda procesada (puede haber otras pendientes en la base). */
async function procesarCancelacionHasta(idMonitoria: string) {
  for (let i = 0; i < 10; i++) {
    await procesarCancelacionesDeCita({ cliente: fx.admin });
    const cancelacion = await cancelacionDe(idMonitoria);
    if (!cancelacion || cancelacion.procesado_en !== null) return;
  }
  throw new Error(`La cancelación de la monitoría ${idMonitoria} no se procesó tras 10 corridas.`);
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

/** Lo mismo con el proceso de avisos del rechazo de un pago, hasta que el de ese pago queda procesado. */
async function procesarRechazoHasta(idPago: string) {
  for (let i = 0; i < 10; i++) {
    await procesarAvisosDeRechazoDePago({ cliente: fx.admin });
    const [fila] = await avisosDeRechazoDe(idPago);
    if (!fila || fila.procesado_en !== null) return;
  }
  throw new Error(`El aviso del rechazo del pago ${idPago} no se procesó tras 10 corridas.`);
}

/** Lo que ningún correo puede traer: la nota, el motivo de la excepción y cualquier cifra de comisión o de neto (CLAUDE.md). */
function expectSinLoPrivado(mensaje: Mensaje, texto: string, prohibidos: string[]) {
  const contenido = `${mensaje.Subject} ${mensaje.Text} ${mensaje.HTML}`;
  expect(contenido, "el correo no lleva la nota").not.toContain(texto);
  for (const categoria of Object.keys(TEXTOS_DE_CATEGORIA) as Categoria[]) {
    expect(contenido, `el correo no lleva el motivo «${categoria}»`).not.toContain(TEXTOS_DE_CATEGORIA[categoria]);
    // «Otro» a secas es una palabra común de un correo: solo se busca el texto corto de los motivos que dicen algo más.
    if (TEXTOS_DEL_REGISTRO[categoria].length > 5) {
      expect(contenido, `el correo no lleva el motivo corto «${categoria}»`).not.toContain(TEXTOS_DEL_REGISTRO[categoria]);
    }
  }
  expect(contenido.toLowerCase()).not.toMatch(/comisi|bruto/);
  const plano = normalizar(contenido);
  for (const cifra of prohibidos) expect(plano, `el correo no lleva ${cifra}`).not.toContain(cifra);
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
  await conElToken(cliente, usuario);
}

/** Solo el token de `usuario`, sin cambiar de rol: así una función de `privado` (sin grant) corre como el dueño de la base con su `auth.uid()`. */
async function conElToken(cliente: pg.Client, usuario: UsuarioPrueba) {
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: usuario.id, role: "authenticated" })]);
}

/** `public.autorizar_cancelacion_fuera_de_plazo`, la misma puerta que usa `autorizarCancelacion`, desde una conexión que ya corre como un admin. */
async function autorizarEn(cliente: pg.Client, idMonitoria: string, categoria: string, texto: string | null = null) {
  const { rows } = await cliente.query<{ r: ResultadoDeAutorizacion }>("select public.autorizar_cancelacion_fuera_de_plazo($1::uuid, $2, $3) as r", [
    idMonitoria,
    categoria,
    texto ?? "",
  ]);
  resultadosVistos.add(rows[0].r);
  return rows[0].r;
}

/** La versión interna con la hora de quien llama, que ninguna sesión ejecuta: como dueño de la base y con el token del admin. */
async function autorizarConHoraEn(cliente: pg.Client, idMonitoria: string, categoria: string, texto: string | null, ahora: Date) {
  const { rows } = await cliente.query<{ r: ResultadoDeAutorizacion }>(
    "select privado.autorizar_cancelacion_fuera_de_plazo($1::uuid, $2, $3, $4::timestamptz) as r",
    [idMonitoria, categoria, texto, ahora.toISOString()],
  );
  resultadosVistos.add(rows[0].r);
  return rows[0].r;
}

/** La cancelación a tiempo del Lead (HU-024) con una hora simulada: el corazón que nadie ejecuta desde la Data API. */
async function cancelarConHoraEn(cliente: pg.Client, idMonitoria: string, ahora: Date) {
  const { rows } = await cliente.query<{ r: string }>("select privado.cancelar_cita($1::uuid, $2::timestamptz) as r", [idMonitoria, ahora.toISOString()]);
  return rows[0].r;
}

/** `public.revisar_pago` (la puerta de HU-020), desde una conexión que ya corre como el admin. */
async function revisarEn(cliente: pg.Client, idPago: string, decision: "aprobar" | "rechazar", observaciones: string | null = null) {
  const { rows } = await cliente.query<{ resultado: string; cancelo_monitoria: boolean }>(
    "select resultado, cancelo_monitoria from public.revisar_pago($1::uuid, $2, $3)",
    [idPago, decision, observaciones],
  );
  return rows[0];
}

/** `public.mover_admin` (HU-054): sube o baja a un admin un puesto, con `for update` sobre todas las filas de `admin`. */
async function moverEn(cliente: pg.Client, idAdmin: string, direccion: "arriba" | "abajo") {
  const { rows } = await cliente.query<{ r: string }>("select public.mover_admin($1::uuid, $2) as r", [idAdmin, direccion]);
  return rows[0].r;
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
 * una. `rol` corre esa parte con el rol `authenticated` y el token de ese usuario; `token` solo con el token de ese usuario,
 * como dueño de la base; sin ninguno, como dueño de la base (como pg_cron).
 */
async function carrera<P, S>(
  primera: { rol?: UsuarioPrueba; token?: UsuarioPrueba; hacer: (c: Conexion) => Promise<P> },
  segunda: { rol?: UsuarioPrueba; token?: UsuarioPrueba; hacer: (c: Conexion) => Promise<S> },
): Promise<[P, S]> {
  let resultado: [P, S] | null = null;
  await conDosConexiones(async (a, b) => {
    await a.cliente.query("begin");
    if (primera.rol) await como(a.cliente, primera.rol);
    if (primera.token) await conElToken(a.cliente, primera.token);
    const deLaPrimera = await primera.hacer(a);
    await b.cliente.query("begin");
    if (segunda.rol) await como(b.cliente, segunda.rol);
    if (segunda.token) await conElToken(b.cliente, segunda.token);
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
// Criterios 1 y 2: la lista y el detalle
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: la lista trae las individuales confirmadas con el plazo vencido que todavía no empiezan, la que empieza primero arriba", () => {
  it("trae las propias en orden de inicio, con materia, monitor, quien agendó y el estado de su pago, y no trae las de 14 h, las por pagar, las canceladas, las realizadas, las grupales ni las ya empezadas", async () => {
    const propio = await monitorPropio();
    const tarde = await caso(5, { propio, pagos: [] });
    const temprano = await caso(3, { propio, pagos: [{ estado: "aprobado", monto: 31_000 }] });
    const medio = await caso(4, { propio, pagos: [{ estado: "aprobado" }, { estado: "en_revision" }] });
    const rechazada = await caso(6, { propio, pagos: [{ estado: "rechazado" }, { estado: "en_revision" }] });
    // Las que no entran: a 14 h todavía hay plazo; por pagar, cancelada por otro motivo, grupal, realizada y empezada hace 6 minutos.
    const conPlazo = await caso(14, { propio });
    const porPagar = await caso(5, { propio, estado: "pendiente_pago" });
    const cancelada = await caso(5, { propio });
    exito(await fx.admin.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" }).eq("id", cancelada.monitoria.id).select().single(), "cancelar");
    const grupal = await caso(5, { propio });
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: grupal.monitoria.id, cupos: 3, modalidad_pago: "dividido", precio_por_persona: 15_000 }).select().single(),
      "volver grupal la monitoría",
    );
    const realizada = await caso(-2, { propio, estado: "realizada" });
    const empezada = await caso(-0.1, { propio });

    const lista = await cargarCitasSinPlazo(sesionA);
    const ids = lista.filas.map((fila) => fila.id);

    expect(ids).toEqual(expect.arrayContaining([tarde, temprano, medio, rechazada].map((c) => c.monitoria.id)));
    for (const fuera of [conPlazo, porPagar, cancelada, grupal, realizada, empezada]) expect(ids).not.toContain(fuera.monitoria.id);
    // La que empieza primero, arriba; entre las propias, el orden de su inicio.
    const propias = ids.filter((id) => [tarde, temprano, medio, rechazada].some((c) => c.monitoria.id === id));
    expect(propias).toEqual([temprano, medio, tarde, rechazada].map((c) => c.monitoria.id));
    for (let i = 1; i < lista.filas.length; i++) {
      expect(lista.filas[i - 1].inicio.getTime(), "la lista va de la que empieza primero a la que empieza última").toBeLessThanOrEqual(lista.filas[i].inicio.getTime());
    }
    expect(lista.total).toBe(lista.filas.length);

    const fila = lista.filas.find((f) => f.id === temprano.monitoria.id);
    expect(fila).toMatchObject({
      nombreMateria: propio.materia.nombre,
      nombreMonitor: "Monitor de prueba",
      lead: { nombre: "Lead de prueba", correo: leadDeAncla.correo, telefono: "3101234567" },
      estadoPago: "aprobado",
      fecha: sesionEn(temprano.inicio).fecha,
      hora: sesionEn(temprano.inicio).hora,
    });
    expect(fila!.inicio.getTime()).toBe(temprano.inicio.getTime());
    // La prioridad de D-11: rechazado, en revisión, aprobado, sin pagar.
    const estadoDePago = (c: Caso) => lista.filas.find((f) => f.id === c.monitoria.id)?.estadoPago;
    expect([estadoDePago(temprano), estadoDePago(medio), estadoDePago(rechazada), estadoDePago(tarde)]).toEqual(["aprobado", "en_revision", "rechazado", "sin_pagar"]);
    // Del monitor, solo su nombre (P-37).
    expect(JSON.stringify(lista)).not.toContain(propio.monitor.correo);
  }, 90_000);

  it("con un tope de filas muestra las primeras y cuenta el total exacto", async () => {
    await caso(3);
    await caso(4);

    const corta = await cargarCitasSinPlazo(sesionA, { maxFilas: 1 });

    expect(corta.filas).toHaveLength(1);
    expect(corta.total).toBeGreaterThanOrEqual(2);
  });

  it("un monitor y un Lead, que sí leen su propia monitoría, reciben la lista vacía; sin sesión y con la llave secreta la vista se niega", async () => {
    const propia = await caso(4, { propio: base });
    expect((await cargarCitasSinPlazo(sesionA)).filas.map((f) => f.id)).toContain(propia.monitoria.id);

    // El monitor y el Lead de esa cita la leen en `monitoria`, pero la vista exige un admin.
    expect(await cargarCitasSinPlazo(sesionMonitor)).toEqual({ filas: [], total: 0 });
    expect(await cargarCitasSinPlazo(ancla.cliente)).toEqual({ filas: [], total: 0 });
    expect(await cargarCitasSinPlazo(otra.cliente)).toEqual({ filas: [], total: 0 });
    // La condición `privado.es_admin()` no la ejecuta `service_role`: la lista se lee con la sesión de un admin.
    await expect(cargarCitasSinPlazo(crearCliente())).rejects.toThrow(/No se pudieron leer las citas sin plazo para cancelar/);
    await expect(cargarCitasSinPlazo(fx.admin)).rejects.toThrow(/No se pudieron leer las citas sin plazo para cancelar/);
  });
});

describe("criterio 2: el detalle trae los datos, los pagos y cuánto se devolvería", () => {
  it("la cita con quién agendó, el monitor sin su contacto, los pagos sin reembolso todavía, la suma de los aprobados y el aviso de qué muestra la página", async () => {
    const propio = await monitorPropio();
    const c = await caso(5, {
      propio,
      pagos: [
        { estado: "aprobado", monto: 31_000 },
        { estado: "aprobado", monto: 18_000 },
        { estado: "en_revision", monto: 12_000 },
        { estado: "rechazado", monto: 7_000 },
      ],
    });

    const detalle = await cargarCitaParaAutorizar(sesionA, c.monitoria.id);

    expect(detalle).toMatchObject({
      id: c.monitoria.id,
      estado: "confirmada",
      motivoCancelacion: null,
      fecha: sesionEn(c.inicio).fecha,
      hora: sesionEn(c.inicio).hora,
      nombreMateria: propio.materia.nombre,
      nombreMonitor: "Monitor de prueba",
      lead: { nombre: "Lead de prueba", correo: leadDeAncla.correo, telefono: "3101234567" },
      grupal: false,
      autorizacion: null,
    });
    expect(detalle!.inicio.getTime()).toBe(c.inicio.getTime());
    // RN-60: se cancela solo hasta 12 h antes del inicio.
    expect(detalle!.cancelableHasta.getTime()).toBe(c.inicio.getTime() - 12 * HORA);
    expect([...detalle!.pagos].map((p) => p.id).sort()).toEqual(c.pagos.map((p) => p.id).sort());
    for (const pago of detalle!.pagos) {
      const creado = c.pagos.find((p) => p.id === pago.id)!;
      expect(pago).toEqual({ id: creado.id, nombrePagador: creado.nombre, monto: creado.monto, estado: creado.estado, reembolso: null });
    }
    // Lo que se devolvería: la suma de lo que pagaron los pagos aprobados (RN-60).
    expect(aDevolver(detalle!.pagos)).toEqual({ cuantos: 2, suma: 49_000 });
    expect(vistaDeLaCita(detalle!, new Date())).toBe("autorizar");
    expect(JSON.stringify(detalle)).not.toContain(propio.monitor.correo);
    expect(JSON.stringify(detalle)).not.toContain("3000000000");
  });

  it("una cita que no existe o que la sesión no lee es null: un id inventado, y una sesión anónima que no es de esa cita", async () => {
    const c = await caso(5);

    expect(await cargarCitaParaAutorizar(sesionA, randomUUID())).toBeNull();
    expect(await cargarCitaParaAutorizar(otra.cliente, c.monitoria.id)).toBeNull();
  });

  it("nada de lo que traen la lista y el detalle lleva comisión, bruto, neto ni llaves, ni las cifras de la comisión de cada pago", async () => {
    // 41.000 de un pago aprobado: comisión de 4.100 y neto de 36.900. 33.000 de uno en revisión: 3.300 y 29.700.
    const c = await caso(5, { pagos: [{ estado: "aprobado", monto: 41_000 }, { estado: "en_revision", monto: 33_000 }] });
    const prohibidas = [...(await cifrasProhibidas(41_000)), ...(await cifrasProhibidas(33_000))];
    expect(prohibidas).toEqual([4_100, 36_900, 3_300, 29_700]);

    const detalle = await cargarCitaParaAutorizar(sesionA, c.monitoria.id);
    const lista = await cargarCitasSinPlazo(sesionA);

    for (const valor of [detalle, lista]) {
      expect(clavesDe(valor).filter((clave) => /bruto|neto|comisi|llave/i.test(clave))).toEqual([]);
      expect(numerosDe(valor).filter((n) => prohibidas.includes(n))).toEqual([]);
    }
    expect(JSON.stringify(detalle)).not.toMatch(/comisi|bruto/i);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterios 3 a 7: autorizar
// ---------------------------------------------------------------------------------------------------------------

describe("criterios 4 a 7: autorizar cancela la monitoría, libera la fecha, guarda quién y por qué, reembolsa y avisa", () => {
  it("con la sesión de B: cancelada por el estudiante, fecha libre, el registro con la nota recortada y la hora de la base, un reembolso por pago aprobado al primer admin activo con el motivo exacto, y sin desembolso", async () => {
    const propio = await monitorPropio();
    const texto = nota();
    const c = await caso(5, {
      propio,
      pagos: [
        { estado: "aprobado", monto: 31_000, delLead: true },
        { estado: "aprobado", monto: 18_000 },
        { estado: "en_revision", monto: 12_000 },
        { estado: "rechazado", monto: 7_000 },
      ],
    });
    const [aprobado1, aprobado2, enRevision, rechazado] = c.pagos;
    const primero = await primerAdminActivo();
    // Para que el mutante «el reembolso va a quien autoriza» no pase: quien autoriza no es el primero del turno (D-26).
    expect(primero).not.toBe(adminB.id);
    // Mientras está confirmada, su fecha está ocupada (el índice de fechas activas).
    await expect(fx.crearMonitoria(c.contexto, { fecha: c.monitoria.fecha, estado: "pendiente_pago" })).rejects.toThrow(/insertar monitoria/);

    expect(await autorizar(sesionB, c.monitoria.id, "falla_de_calibra", `  \n${texto}\n `)).toBe("autorizada");

    expect(await estadoDe(c.monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante", fecha_finalizacion: null });
    // Quién, cuándo (la hora de la base), el motivo y la nota sin los espacios ni saltos de los bordes.
    const registro = await registroDe(c.monitoria.id);
    expect(registro).toMatchObject({ id_monitoria: c.monitoria.id, id_admin: adminB.id, categoria: "falla_de_calibra", nota: texto });
    expect(Math.abs(new Date(registro!.autorizada_en).getTime() - Date.now())).toBeLessThan(MINUTO);
    // La fecha quedó libre (RN-33): otra persona puede reservarla.
    const libre = await fx.crearMonitoria(c.contexto, { fecha: c.monitoria.fecha, estado: "pendiente_pago" });
    monitorias.push(libre.id);
    expect((await estadoDe(libre.id)).estado).toBe("pendiente_pago");

    // Un reembolso por pago aprobado, monto completo; ninguno por el pago rechazado ni por el que sigue en revisión.
    const esperado = (p: PagoCreado) => ({ id_pago: p.id, id_admin: primero, monto: p.monto, motivo: MOTIVO_CANCELACION_AUTORIZADA, estado: "esperando_llave", llave_destino: null });
    const creados = await reembolsosDe(c.monitoria.id);
    expect(creados).toHaveLength(2);
    for (const p of [aprobado1, aprobado2]) expect(creados.find((r) => r.id_pago === p.id)).toEqual(expect.objectContaining(esperado(p)));
    expect(creados.map((r) => r.id_pago)).not.toContain(enRevision.id);
    expect(creados.map((r) => r.id_pago)).not.toContain(rechazado.id);
    // Cada reembolso nace con la solicitud de su llave, de 256 bits, y los pagos no cambian de estado.
    for (const r of creados) expect((await solicitudDe(r.id)).token).toMatch(/^[0-9a-f]{64}$/);
    expect(exito(await fx.admin.from("pago").select("id, estado").eq("id_monitoria", c.monitoria.id).order("id"), "leer los pagos").map((p) => p.estado).sort()).toEqual([
      "aprobado",
      "aprobado",
      "en_revision",
      "rechazado",
    ]);
    // El monitor no cobra esa sesión (D-60 c): no nace desembolso.
    expect(await desembolsosDe(c.monitoria.id)).toEqual([]);
    // La cancelación al Lead y el aviso al monitor quedan anotados, una vez cada uno.
    expect(await cancelacionDe(c.monitoria.id)).toMatchObject({
      correo_destino: leadDeAncla.correo,
      con_pago_en_revision: true,
      reembolso_a_otro_contacto: true,
      procesado_en: null,
    });
    expect(await eventosDe(c.monitoria.id)).toEqual(["confirmada", "cancelada"]);
    // Y la página la ve cancelada y autorizada, con el registro.
    const detalle = await cargarCitaParaAutorizar(sesionA, c.monitoria.id);
    expect(detalle).toMatchObject({
      estado: "cancelada",
      motivoCancelacion: "estudiante",
      autorizacion: { categoria: "falla_de_calibra", nota: texto, idAdmin: adminB.id, nombreAdmin: "Admin de prueba" },
    });
    expect(vistaDeLaCita(detalle!, new Date())).toBe("autorizada");
    expect(detalle!.pagos.find((p) => p.id === aprobado1.id)?.reembolso).toEqual({ id: creados.find((r) => r.id_pago === aprobado1.id)!.id, estado: "esperando_llave" });
    expect(detalle!.pagos.find((p) => p.id === enRevision.id)?.reembolso).toBeNull();
    // Ya no está en la lista.
    expect((await cargarCitasSinPlazo(sesionA)).filas.map((f) => f.id)).not.toContain(c.monitoria.id);
  }, 90_000);

  it("cada motivo de la lista se guarda como es: «fuerza mayor» sin nota, «una falla de Calibra» con nota y «otro» con nota; 500 caracteres de dos bytes caben", async () => {
    const sinNota = await caso(5);
    const conNota = await caso(5);
    const otro = await caso(5);
    const largo = await caso(5);

    expect(await autorizar(sesionA, sinNota.monitoria.id, "fuerza_mayor")).toBe("autorizada");
    expect(await autorizar(sesionA, conNota.monitoria.id, "falla_de_calibra", "El enlace del correo no abría.")).toBe("autorizada");
    expect(await autorizar(sesionB, otro.monitoria.id, "otro", "  Un caso que no cabe en la lista.  ")).toBe("autorizada");
    expect(await autorizar(sesionB, largo.monitoria.id, "fuerza_mayor", "é".repeat(500))).toBe("autorizada");

    expect(await registroDe(sinNota.monitoria.id)).toMatchObject({ id_admin: adminA.id, categoria: "fuerza_mayor", nota: null });
    expect(await registroDe(conNota.monitoria.id)).toMatchObject({ categoria: "falla_de_calibra", nota: "El enlace del correo no abría." });
    expect(await registroDe(otro.monitoria.id)).toMatchObject({ id_admin: adminB.id, categoria: "otro", nota: "Un caso que no cabe en la lista." });
    expect([...(await registroDe(largo.monitoria.id))!.nota!]).toHaveLength(500);
  }, 60_000);

  it("la constante de la app es el texto que escribe la base, con y sin autorización, y la cancelación a tiempo conserva el suyo", async () => {
    const autorizada = await caso(5, { pagos: [{ estado: "aprobado" }] });
    const aTiempo = await caso(14, { pagos: [{ estado: "aprobado" }] });
    const motivoDe = async (id: string) => (await bd.query<{ m: string }>("select privado.motivo_de_cancelacion_del_estudiante($1::uuid) as m", [id])).rows[0].m;
    expect(await motivoDe(autorizada.monitoria.id)).toBe(MOTIVO_CANCELACION_A_TIEMPO);

    expect(await autorizar(sesionB, autorizada.monitoria.id, "fuerza_mayor")).toBe("autorizada");
    expect(await cancelarMiCita(ancla.cliente, aTiempo.monitoria.id)).toBe("cancelada");

    expect(await motivoDe(autorizada.monitoria.id)).toBe(MOTIVO_CANCELACION_AUTORIZADA);
    expect(await motivoDe(aTiempo.monitoria.id)).toBe(MOTIVO_CANCELACION_A_TIEMPO);
    expect((await reembolsosDe(autorizada.monitoria.id)).map((r) => r.motivo)).toEqual([MOTIVO_CANCELACION_AUTORIZADA]);
    expect((await reembolsosDe(aTiempo.monitoria.id)).map((r) => r.motivo)).toEqual([MOTIVO_CANCELACION_A_TIEMPO]);
    // La cancelación a tiempo no deja registro de excepción.
    expect(await registroDe(aTiempo.monitoria.id)).toBeNull();
  });

  it("los correos: el Lead recibe el de cancelación con la llave de su pago, el otro pagador el pedido con el motivo, y el monitor el aviso; ninguno trae la nota ni el motivo de la excepción y cada uno sale una vez", async () => {
    const propio = await monitorPropio();
    const texto = nota();
    const c = await caso(5, {
      propio,
      pagos: [
        { estado: "aprobado", monto: 31_000, delLead: true },
        { estado: "aprobado", monto: 18_000 },
        { estado: "en_revision", monto: 12_000 },
      ],
    });
    const [delLead, deOtro, enRevision] = c.pagos;
    // La comisión y el neto del pago del Lead (31.000) y del otro pagador (18.000): ningún correo las trae.
    const cifrasDeComision = [...(await cifrasProhibidas(31_000)), ...(await cifrasProhibidas(18_000))].map((cifra) => normalizar(formatearPesos(cifra)));

    expect(await autorizar(sesionB, c.monitoria.id, "falla_de_calibra", texto)).toBe("autorizada");
    const reembolsoDelLead = (await reembolsosDe(c.monitoria.id)).find((r) => r.id_pago === delLead.id)!;
    const reembolsoDeOtro = (await reembolsosDe(c.monitoria.id)).find((r) => r.id_pago === deOtro.id)!;
    const llaveDelLead = (await solicitudDe(reembolsoDelLead.id)).token;
    const llaveDeOtro = (await solicitudDe(reembolsoDeOtro.id)).token;
    // Antes de que corra ningún proceso no ha salido nada.
    expect(await correoCon(leadDeAncla.correo!, rutaDeLlave(llaveDelLead))).toBeUndefined();
    expect(await correosA(propio.monitor.correo)).toEqual([]);
    expect(await correosA(deOtro.contacto)).toEqual([]);

    await procesarCancelacionHasta(c.monitoria.id);
    await procesarAvisosHasta(c.monitoria.id);
    await procesarPedidoHasta((await pedidoDe(reembolsoDeOtro.id)).id);

    // Al Lead: «Cancelaste tu monitoría…», con el enlace de la llave de su pago, el aviso del pago en revisión y el de quien pagó aparte.
    const alLead = (await correosA(leadDeAncla.correo!)).filter((m) => m.Text.includes(rutaDeLlave(llaveDelLead)));
    expect(alLead).toHaveLength(1);
    expect(alLead[0].Subject).toBe(`Cancelaste tu monitoría de ${propio.materia.nombre}`);
    const textoDelLead = normalizar(alLead[0].Text);
    expect(textoDelLead).toContain("Tu monitoría quedó cancelada");
    expect(textoDelLead).toContain(`Vamos a devolverte ${normalizar(formatearPesos(31_000))}.`);
    expect(alLead[0].Text).toContain(rutaDeLlave(llaveDelLead));
    expect(alLead[0].Text).not.toContain(rutaDeLlave(llaveDeOtro));
    expect(textoDelLead).toContain(MOTIVO_DE_OTRO_CONTACTO);
    expect(textoDelLead).toContain(TEXTO_PAGO_EN_REVISION_AL_CANCELAR);
    expectSinLoPrivado(alLead[0], texto, cifrasDeComision);
    expect(alLead[0].Text).not.toContain(propio.monitor.correo);
    expect(await registroDeCorreo("cancelacion_cita", c.monitoria.id)).toEqual({ estado: "enviado", destinatario: leadDeAncla.correo, plantilla: "cancelacion_cita" });

    // Al monitor: el aviso de siempre, que dice que el estudiante canceló, sin el contacto de quien agendó ni montos ni la nota.
    const alMonitor = await correosA(propio.monitor.correo);
    expect(alMonitor, "solo el aviso de la cancelación: el de confirmada ya no vale").toHaveLength(1);
    expect(alMonitor[0].Subject).toBe(`Se canceló tu monitoría de ${propio.materia.nombre}`);
    expect(normalizar(alMonitor[0].Text)).toContain("Lead de prueba canceló la monitoría de");
    expect(alMonitor[0].Text).toContain("/monitor/agenda");
    expectSinLoPrivado(alMonitor[0], texto, cifrasDeComision);
    for (const privado of [leadDeAncla.correo, "3101234567", delLead.contacto, delLead.nombre, deOtro.contacto]) {
      expect(alMonitor[0].Text).not.toContain(privado!);
      expect(alMonitor[0].HTML).not.toContain(privado!);
    }
    expect(await registroDeCorreo("aviso_monitor_cancelada", c.monitoria.id)).toMatchObject({ estado: "enviado", destinatario: propio.monitor.correo });

    // A quien pagó con otro contacto: el pedido de la llave, con el motivo de la autorización y sin la nota.
    const alPagador = await correosA(deOtro.contacto);
    expect(alPagador).toHaveLength(1);
    expect(alPagador[0].Subject).toBe(`Necesitamos tu llave para devolverte ${formatearPesos(18_000)}`);
    const textoDelPagador = normalizar(alPagador[0].Text);
    expect(textoDelPagador).toContain(`Hola, ${deOtro.nombre}.`);
    expect(textoDelPagador).toContain(`Vamos a devolverte ${normalizar(formatearPesos(18_000))} de tu pago en Calibra. Motivo: ${MOTIVO_CANCELACION_AUTORIZADA}`);
    expect(alPagador[0].Text).toContain(rutaDeLlave(llaveDeOtro));
    expectSinLoPrivado(alPagador[0], texto, cifrasDeComision);
    // Al pagador del pago en revisión no le llega nada todavía.
    expect(await correosA(enRevision.contacto)).toEqual([]);

    // Ninguno se manda dos veces: ni otra corrida, ni dos a la vez.
    await Promise.all([procesarCancelacionesDeCita({ cliente: fx.admin }), procesarCancelacionesDeCita({ cliente: fx.admin })]);
    await Promise.all([procesarAvisosAlMonitor({ cliente: fx.admin }), procesarAvisosAlMonitor({ cliente: fx.admin })]);
    await procesarPedidosDeLlave({ cliente: fx.admin });
    expect((await correosA(leadDeAncla.correo!)).filter((m) => m.Text.includes(rutaDeLlave(llaveDelLead)))).toHaveLength(1);
    expect(await correosA(propio.monitor.correo)).toHaveLength(1);
    expect(await correosA(deOtro.contacto)).toHaveLength(1);
    expect(exito(await fx.admin.from("pedido_llave").select("id").eq("id_reembolso", reembolsoDeOtro.id).eq("tipo", "pedido"), "leer").length).toBe(1);
  }, 90_000);

  it("D-19: si el Lead no tiene correo, el de cancelación sale al contacto del primer pago", async () => {
    const leadSinCorreo = await fx.crearLead();
    exito(await fx.admin.from("lead").update({ correo: null, numero_telefono: "3001234567" }).eq("id", leadSinCorreo.id).select().single(), "dejar al Lead solo con teléfono");
    const propio = await monitorPropio();
    const c = await caso(5, { propio, lead: { ...leadSinCorreo, correo: null }, pagos: [{ estado: "aprobado", monto: 22_000 }] });
    const texto = nota();

    expect(await autorizar(sesionA, c.monitoria.id, "otro", texto)).toBe("autorizada");

    expect(await cancelacionDe(c.monitoria.id)).toMatchObject({ correo_destino: c.pagos[0].contacto, reembolso_a_otro_contacto: false });
    const [reembolso] = await reembolsosDe(c.monitoria.id);
    const llave = (await solicitudDe(reembolso.id)).token;
    await procesarCancelacionHasta(c.monitoria.id);
    const alPrimero = await correosA(c.pagos[0].contacto);
    expect(alPrimero).toHaveLength(1);
    expect(alPrimero[0].Text).toContain(rutaDeLlave(llave));
    expectSinLoPrivado(alPrimero[0], texto, []);
  });

  it("límite conocido (aviso 4 de A2, lo decide dvarela5101): si el aviso al monitor se procesa cuando la sesión ya empezó no sale, y el correo al Lead sí", async () => {
    // La autorización corrió un segundo antes del inicio (hora simulada) y los procesos de correo llegan después, con la hora real:
    // lo que pasa cuando el pedido inmediato a la app no sale y el reintento de pg_cron (cada 5 minutos) llega con la sesión empezada.
    // `avisoVigente` (HU-051) descarta entonces el aviso `cancelada`; `cancelacionVigente` no mira la hora. Si dvarela5101 decide que
    // el aviso salga hasta el fin de la sesión, esta prueba cambia a «el monitor recibe el aviso»: es el punto que hay que revisar.
    const propio = await monitorPropio();
    const c = await caso(-0.1, { propio, pagos: [{ estado: "aprobado", monto: 26_000, delLead: true }] });
    const conn = await conexion();
    try {
      await conn.cliente.query("begin");
      await conElToken(conn.cliente, adminB);
      expect(await autorizarConHoraEn(conn.cliente, c.monitoria.id, "otro", nota(), new Date(c.inicio.getTime() - SEGUNDO))).toBe("autorizada");
      await conn.cliente.query("commit");
    } finally {
      await cerrar(conn);
    }
    expect(Date.now()).toBeGreaterThan(c.inicio.getTime());
    expect(await eventosDe(c.monitoria.id)).toEqual(["confirmada", "cancelada"]);
    const [reembolso] = await reembolsosDe(c.monitoria.id);
    const llave = (await solicitudDe(reembolso.id)).token;

    await procesarCancelacionHasta(c.monitoria.id);
    await procesarAvisosHasta(c.monitoria.id);

    const alLead = (await correosA(leadDeAncla.correo!)).filter((m) => m.Text.includes(rutaDeLlave(llave)));
    expect(alLead, "el correo de cancelación al Lead sale aunque la sesión ya haya empezado").toHaveLength(1);
    expect(await correosA(propio.monitor.correo), "el aviso al monitor se descarta: la sesión ya empezó").toEqual([]);
  }, 60_000);

  it("el reintento (HU-065) reconstruye los mismos correos desde lo anotado, sin la nota", async () => {
    const propio = await monitorPropio();
    const texto = nota();
    const c = await caso(5, { propio, pagos: [{ estado: "aprobado", monto: 27_000, delLead: true }] });
    expect(await autorizar(sesionB, c.monitoria.id, "falla_de_calibra", texto)).toBe("autorizada");
    const [reembolso] = await reembolsosDe(c.monitoria.id);
    const llave = (await solicitudDe(reembolso.id)).token;

    const cancelacion = await reconstruirCancelacionCita(c.monitoria.id, fx.admin);

    expect(cancelacion?.destinatario).toBe(leadDeAncla.correo);
    expect(cancelacion?.datos).toMatchObject({ nombre: "Lead de prueba", materia: propio.materia.nombre, reembolsos: [{ monto: 27_000, enlace: expect.stringContaining(rutaDeLlave(llave)) }] });
    // Determinismo: el reintento da el mismo cuerpo (si no, el proveedor respondería 409 por la misma clave).
    expect(await reconstruirCancelacionCita(c.monitoria.id, fx.admin)).toEqual(cancelacion);
    expect(await RECONSTRUCTORES.cancelacion_cita?.(c.monitoria.id)).toEqual(cancelacion);
    const aviso = await reconstruirAvisoCancelada(c.monitoria.id, fx.admin);
    expect(aviso?.destinatario).toBe(propio.monitor.correo);
    for (const reconstruido of [cancelacion, aviso]) {
      expect(JSON.stringify(reconstruido)).not.toContain(texto);
      expect(JSON.stringify(reconstruido)).not.toMatch(/falla de Calibra|autoriz/i);
    }
  });

  it("P-07: el pago en revisión que se aprueba después de autorizar recibe su reembolso con el motivo de la autorización y su pedido de llave; el que se rechaza manda «no hay reembolso»", async () => {
    const c = await caso(5, { pagos: [{ estado: "aprobado" }, { estado: "en_revision", monto: 12_000 }, { estado: "en_revision", monto: 9_000 }] });
    const [, aprobarDespues, rechazarDespues] = c.pagos;
    const primero = await primerAdminActivo();
    expect(await autorizar(sesionB, c.monitoria.id, "fuerza_mayor")).toBe("autorizada");
    expect((await reembolsosDe(c.monitoria.id)).map((r) => r.id_pago)).not.toContain(aprobarDespues.id);

    expect(await revisarPago(sesionA, { idPago: aprobarDespues.id, decision: "aprobar", observaciones: null })).toEqual({ resultado: "aprobado", canceloMonitoria: false });
    expect(await revisarPago(sesionA, { idPago: rechazarDespues.id, decision: "rechazar", observaciones: null })).toEqual({ resultado: "rechazado", canceloMonitoria: false });

    const tardio = (await reembolsosDe(c.monitoria.id)).find((r) => r.id_pago === aprobarDespues.id);
    expect(tardio).toMatchObject({ id_admin: primero, monto: 12_000, motivo: MOTIVO_CANCELACION_AUTORIZADA, estado: "esperando_llave", llave_destino: null });
    await procesarPedidoHasta((await pedidoDe(tardio!.id)).id);
    const alTardio = await correosA(aprobarDespues.contacto);
    expect(alTardio).toHaveLength(1);
    expect(normalizar(alTardio[0].Text)).toContain(`Motivo: ${MOTIVO_CANCELACION_AUTORIZADA}`);
    // El rechazado no deja reembolso (RN-43); la monitoría sigue cancelada por el estudiante y quien pagó recibe el correo de HU-076.
    expect((await reembolsosDe(c.monitoria.id)).map((r) => r.id_pago)).not.toContain(rechazarDespues.id);
    expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    expect(await avisosDeRechazoDe(rechazarDespues.id)).toEqual([expect.objectContaining({ caso: "cita_ya_cancelada" })]);
    await procesarRechazoHasta(rechazarDespues.id);
    const alRechazado = await correosA(rechazarDespues.contacto);
    expect(alRechazado).toHaveLength(1);
    expect(alRechazado[0].Subject).toBe("No pudimos verificar tu pago y no hay reembolso");
    expect(await registroDeCorreo("pago_rechazado_sin_reembolso", rechazarDespues.id)).toMatchObject({ estado: "enviado", destinatario: rechazarDespues.contacto });
  }, 60_000);

  it("lo de HU-024 sigue igual: la cancelación a tiempo del Lead no deja registro de excepción, dice «La cancelaste tú.» y un pago aprobado después recibe el motivo de siempre", async () => {
    const c = await caso(14, { pagos: [{ estado: "aprobado" }, { estado: "en_revision", monto: 12_000 }] });

    expect(await cancelarMiCita(ancla.cliente, c.monitoria.id)).toBe("cancelada");
    expect(await revisarPago(sesionA, { idPago: c.pagos[1].id, decision: "aprobar", observaciones: null })).toEqual({ resultado: "aprobado", canceloMonitoria: false });

    expect(await registroDe(c.monitoria.id)).toBeNull();
    expect((await reembolsosDe(c.monitoria.id)).map((r) => r.motivo)).toEqual([MOTIVO_CANCELACION_A_TIEMPO, MOTIVO_CANCELACION_A_TIEMPO]);
    const miCita = await leerMiCita(ancla.cliente, c.monitoria.id);
    expect(miCita).toMatchObject({ estado: "cancelada", motivoCancelacion: "estudiante" });
    expect(vistaDeCita(miCita!, new Date()).textoDelMotivo).toBe("La cancelaste tú.");
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 11: lo que ven el Lead y el monitor, y quién escribe la tabla
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 11: el Lead y el monitor no ven el motivo ni la nota, y nadie con sesión escribe la tabla", () => {
  it("la cita del Lead (por el enlace, por su sesión y en «mis citas») dice lo de siempre; la agenda del monitor y los datos de los correos no traen la nota; la tabla no devuelve filas al Lead, al monitor ni a otra sesión", async () => {
    const texto = nota();
    // De la monitora compartida, que tiene sesión en este archivo: así se lee su agenda.
    const c = await caso(5, { propio: base, pagos: [{ estado: "aprobado", delLead: true }] });
    expect(await autorizar(sesionB, c.monitoria.id, "falla_de_calibra", texto)).toBe("autorizada");

    // El Lead, en sus tres lecturas: la cancelación que él hizo, el reembolso, y nada de la autorización.
    const lecturas = [
      await leerCitaPorToken(c.token),
      await leerMiCita(ancla.cliente, c.monitoria.id),
      (await leerMisCitas(ancla.cliente)).find((cita) => cita.idMonitoria === c.monitoria.id),
    ];
    for (const cita of lecturas) {
      expect(cita).toMatchObject({ estado: "cancelada", motivoCancelacion: "estudiante", estadoReembolso: "esperando_llave" });
      expect(JSON.stringify(cita)).not.toContain(texto);
      expect(JSON.stringify(cita)).not.toMatch(/falla de Calibra|fuera del plazo|autoriz|admin/i);
    }
    const vista = vistaDeCita(lecturas[1]!, new Date());
    expect(vista.textoDelMotivo).toBe("La cancelaste tú.");
    expect(vista.textoDelReembolso).toBe("Vamos a devolverte el dinero. Te escribimos al correo del pago para pedirte la llave.");
    expect(JSON.stringify(vista)).not.toContain(texto);

    // El monitor, en su agenda y en los datos de su aviso.
    const agenda = await cargarAgenda(sesionMonitor);
    expect(agenda.find((m) => m.idMonitoria === c.monitoria.id)).toMatchObject({ estado: "cancelada", motivoCancelacion: "estudiante" });
    expect(JSON.stringify(agenda)).not.toContain(texto);
    const datosDelAviso = exito(await fx.admin.rpc("datos_de_aviso_monitor", { p_id_monitoria: c.monitoria.id }), "datos del aviso");
    const datosDeLaCancelacion = exito(await fx.admin.rpc("datos_de_cancelacion_cita", { p_id_monitoria: c.monitoria.id }), "datos de la cancelación");
    for (const datos of [datosDelAviso, datosDeLaCancelacion]) {
      expect(JSON.stringify(datos)).not.toContain(texto);
      expect(JSON.stringify(datos)).not.toMatch(/falla_de_calibra|categoria/i);
    }

    // La tabla: el admin la lee; el Lead, el monitor y otra sesión no ven ninguna fila, y sin sesión se niega.
    expect(exito(await sesionA.from("cancelacion_excepcional").select("id_monitoria, nota").eq("id_monitoria", c.monitoria.id), "leer con el admin")).toEqual([
      { id_monitoria: c.monitoria.id, nota: texto },
    ]);
    for (const [quien, cliente] of [
      ["el Lead", ancla.cliente],
      ["el monitor", sesionMonitor],
      ["otra sesión", otra.cliente],
      ["sin sesión", crearCliente()],
    ] as const) {
      const leido = await cliente.from("cancelacion_excepcional").select("*");
      expect(leido.error ? [] : leido.data, `${quien} no lee la tabla`).toEqual([]);
    }
  }, 60_000);

  it("nadie escribe directo: ni un admin activo con su sesión, ni la llave secreta, ni el Lead pueden insertar, actualizar o borrar en cancelacion_excepcional", async () => {
    const c = await caso(5);
    expect(await autorizar(sesionB, c.monitoria.id, "fuerza_mayor")).toBe("autorizada");
    const otraCita = await caso(5);
    const antes = await registroDe(c.monitoria.id);

    for (const [quien, cliente] of [
      ["un admin", sesionA],
      ["la llave secreta", fx.admin],
      ["el Lead", ancla.cliente],
      ["sin sesión", crearCliente()],
    ] as const) {
      const insertado = await cliente
        .from("cancelacion_excepcional")
        .insert({ id_monitoria: otraCita.monitoria.id, id_admin: adminA.id, categoria: "fuerza_mayor" })
        .select();
      expect(insertado.error, `${quien} no inserta`).not.toBeNull();
      sinFilas(await cliente.from("cancelacion_excepcional").update({ categoria: "otro", nota: "Escrito a mano" }).eq("id_monitoria", c.monitoria.id).select());
      sinFilas(await cliente.from("cancelacion_excepcional").delete().eq("id_monitoria", c.monitoria.id).select());
    }
    expect(await registroDe(c.monitoria.id)).toEqual(antes);
    expect(await registroDe(otraCita.monitoria.id)).toBeNull();
    // Las funciones de `privado` no las ejecuta nadie desde la Data API: ni el núcleo, ni la versión con hora, ni el motivo.
    const llamadas: [string, object][] = [
      ["cancelar_cita_con_permiso", { p_id_monitoria: otraCita.monitoria.id, p_ahora: new Date().toISOString(), p_id_admin: adminA.id, p_categoria: "otro", p_nota: "x" }],
      ["motivo_de_cancelacion_del_estudiante", { p_id_monitoria: otraCita.monitoria.id }],
      ["autorizar_cancelacion_fuera_de_plazo", { p_id_monitoria: otraCita.monitoria.id, p_categoria: "fuerza_mayor", p_nota: "", p_ahora: new Date().toISOString() }],
    ];
    for (const [nombre, argumentos] of llamadas) {
      expect((await sesionA.rpc(nombre as never, argumentos as never)).error, `${nombre} no se ejecuta desde la sesión de un admin`).not.toBeNull();
    }
    expect(await estadoDe(otraCita.monitoria.id)).toMatchObject({ estado: "confirmada" });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterios 8, 9 y 10: quién puede y qué responde cuando no se autoriza
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 8: sin sesión, un Lead, un monitor o un admin desactivado no autorizan, y nada cambia", () => {
  it("sin sesión la base ni ejecuta la función; el monitor y el Lead reciben sin_permiso; sin usuario en el token, sin_sesion; la versión con hora y la llave secreta no llegan", async () => {
    const c = await caso(5, { pagos: [{ estado: "aprobado" }] });
    const antes = await foto(c.monitoria.id);

    for (const [quien, cliente] of [
      ["el monitor", sesionMonitor],
      ["el Lead", ancla.cliente],
      ["otra sesión anónima", otra.cliente],
    ] as const) {
      expect(await autorizar(cliente, c.monitoria.id, "fuerza_mayor"), `${quien} no autoriza`).toBe("sin_permiso");
      // Quién puede va antes que el texto: a quien no puede no se le explican las reglas de la nota.
      expect(await autorizar(cliente, c.monitoria.id, "otro", "x".repeat(501)), `${quien}, con una nota inválida`).toBe("sin_permiso");
    }
    const anonimo = crearCliente();
    await expect(autorizarCancelacion(anonimo, { idMonitoria: c.monitoria.id, categoria: "fuerza_mayor", nota: null })).rejects.toThrow(/No se pudo autorizar la cancelación: 42501/);
    expect((await anonimo.rpc("autorizar_cancelacion_fuera_de_plazo", { p_id_monitoria: c.monitoria.id, p_categoria: "fuerza_mayor", p_nota: "" })).error?.code).toBe("42501");
    // service_role no tiene `auth.uid()`: tampoco ejecuta la puerta.
    expect((await fx.admin.rpc("autorizar_cancelacion_fuera_de_plazo", { p_id_monitoria: c.monitoria.id, p_categoria: "fuerza_mayor", p_nota: "" })).error).not.toBeNull();
    // La versión con la hora de quien llama vive en privado: nadie la ejecuta desde la Data API.
    const conHora = { p_id_monitoria: c.monitoria.id, p_categoria: "fuerza_mayor", p_nota: "", p_ahora: new Date().toISOString() };
    expect((await sesionB.rpc("autorizar_cancelacion_fuera_de_plazo" as never, conHora as never)).error).not.toBeNull();

    // Un rol authenticated sin usuario en el token: sin_sesion.
    const conn = await conexion();
    try {
      await conn.cliente.query("begin");
      await conn.cliente.query("set local role authenticated");
      await conn.cliente.query("select set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', true)");
      expect(await autorizarEn(conn.cliente, c.monitoria.id, "fuerza_mayor")).toBe("sin_sesion");
      await conn.cliente.query("rollback");
    } finally {
      await cerrar(conn);
    }

    expect(await foto(c.monitoria.id)).toEqual(antes);
    // Y quien sí puede, puede: cualquier admin activo, sin turno (RN-60).
    expect(await autorizar(sesionB, c.monitoria.id, "fuerza_mayor")).toBe("autorizada");
  });
});

describe("criterios 9 y 10: una cita que no cumple no se cancela y dice por qué; un formulario inválido tampoco", () => {
  it("cada resultado por la puerta real coincide con lo que la página anticipa, y ninguno escribe nada", async () => {
    // El pago aprobado de cada una: si algo se cancelara, habría un reembolso que ver.
    const dentro = await caso(14, { pagos: [{ estado: "aprobado" }] });
    const empezada = await caso(-0.1, { pagos: [{ estado: "aprobado" }] });
    const porPagar = await caso(5, { estado: "pendiente_pago" });
    const realizada = await caso(-2, { estado: "realizada", pagos: [{ estado: "aprobado" }] });
    const otroMotivo = await caso(5, { pagos: [{ estado: "aprobado" }] });
    exito(await fx.admin.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" }).eq("id", otroMotivo.monitoria.id).select().single(), "cancelar");
    const delLead = await caso(14, { pagos: [{ estado: "aprobado" }] });
    expect(await cancelarMiCita(ancla.cliente, delLead.monitoria.id)).toBe("cancelada");
    const grupal = await caso(5, { pagos: [{ estado: "aprobado" }] });
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: grupal.monitoria.id, cupos: 3, modalidad_pago: "dividido", precio_por_persona: 15_000 }).select().single(),
      "volver grupal la monitoría",
    );

    const esperados: [string, Caso, ResultadoDeAutorizacion][] = [
      ["con el plazo vigente", dentro, "dentro_de_plazo"],
      ["que ya empezó", empezada, "ya_empezo"],
      ["por pagar", porPagar, "no_cancelable"],
      ["ya realizada", realizada, "no_cancelable"],
      ["cancelada por otro motivo", otroMotivo, "no_cancelable"],
      ["cancelada por quien agendó", delLead, "ya_cancelada"],
      ["grupal", grupal, "no_individual"],
    ];
    for (const [cual, c, resultado] of esperados) {
      const antes = await foto(c.monitoria.id);
      expect(await autorizar(sesionB, c.monitoria.id, "fuerza_mayor", "No debería guardarse."), cual).toBe(resultado);
      expect(await foto(c.monitoria.id), `${cual}: no cambia nada`).toEqual(antes);
      // La página anticipa lo mismo que decide la base.
      expect(vistaDeLaCita((await cargarCitaParaAutorizar(sesionB, c.monitoria.id))!, new Date()), `${cual}: lo que muestra la página`).toEqual({ motivo: resultado });
    }
    // Un id que no existe.
    expect(await autorizar(sesionB, randomUUID(), "fuerza_mayor")).toBe("no_existe");
    // La realizada conserva su desembolso y la de otro motivo sigue sin reembolso.
    expect(await desembolsosDe(realizada.monitoria.id)).toHaveLength(1);
    expect(await reembolsosDe(otroMotivo.monitoria.id)).toEqual([]);
  }, 90_000);

  it("la categoría fuera de la lista o vacía y la nota de más de 500 caracteres o ausente con «otro» no cancelan nada; la categoría se mira antes que la nota", async () => {
    const c = await caso(5, { pagos: [{ estado: "aprobado" }] });
    const antes = await foto(c.monitoria.id);
    const llamar = async (categoria: string, texto: string) => {
      const { data, error } = await sesionB.rpc("autorizar_cancelacion_fuera_de_plazo", { p_id_monitoria: c.monitoria.id, p_categoria: categoria, p_nota: texto });
      expect(error).toBeNull();
      resultadosVistos.add(data as ResultadoDeAutorizacion);
      return data;
    };

    for (const categoria of ["x", "FUERZA_MAYOR", "fuerza_mayor ", ""]) expect(await llamar(categoria, ""), JSON.stringify(categoria)).toBe("categoria_invalida");
    // La categoría va antes que la nota.
    expect(await llamar("x", "x".repeat(501))).toBe("categoria_invalida");
    expect(await llamar("fuerza_mayor", "x".repeat(501))).toBe("nota_invalida");
    expect(await llamar("otro", "é".repeat(501))).toBe("nota_invalida");
    expect(await llamar("otro", "")).toBe("nota_invalida");
    expect(await llamar("otro", " \n\t \n ")).toBe("nota_invalida");
    // El id se mira al final: con una nota inválida, un id que no es de nadie también responde nota_invalida.
    const { data } = await sesionB.rpc("autorizar_cancelacion_fuera_de_plazo", { p_id_monitoria: randomUUID(), p_categoria: "otro", p_nota: "x".repeat(501) });
    expect(data).toBe("nota_invalida");

    expect(await foto(c.monitoria.id)).toEqual(antes);
  });
});

/** Deja a A antes que B, como los dejó `beforeAll`: la prueba de `mover_admin` los intercambia. */
async function restaurarElOrdenDeAYB() {
  const { rows } = await bd.query<{ id: string }>("select id from public.admin where id = any($1::uuid[]) order by orden_revision limit 1", [[adminA.id, adminB.id]]);
  if (rows[0].id === adminA.id) return;
  const conn = await conexion();
  try {
    await conn.cliente.query("begin");
    await como(conn.cliente, adminA);
    await moverEn(conn.cliente, adminB.id, "abajo");
    await conn.cliente.query("commit");
  } finally {
    await cerrar(conn);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Carreras con dos conexiones `pg` (3.7 del SPEC): la segunda espera el candado de la primera
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 12 y carreras: quedan en fila por la monitoría y la segunda lee lo que dejó la primera", () => {
  it("dos admins a la vez, o el doble clic de uno: la segunda espera y recibe ya_cancelada; una fila de registro, un reembolso por pago, una cancelación y un aviso", async () => {
    const c = await caso(5, { pagos: [{ estado: "aprobado" }, { estado: "aprobado", monto: 18_000 }] });

    const [primera, segunda] = await carrera(
      { rol: adminA, hacer: (conn) => autorizarEn(conn.cliente, c.monitoria.id, "fuerza_mayor", "Primera pestaña.") },
      { rol: adminB, hacer: (conn) => autorizarEn(conn.cliente, c.monitoria.id, "otro", "Segunda pestaña.") },
    );

    expect([primera, segunda]).toEqual(["autorizada", "ya_cancelada"]);
    expect(await registroDe(c.monitoria.id)).toMatchObject({ id_admin: adminA.id, categoria: "fuerza_mayor", nota: "Primera pestaña." });
    expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    const creados = await reembolsosDe(c.monitoria.id);
    expect(creados.map((r) => r.id_pago).sort()).toEqual(c.pagos.map((p) => p.id).sort());
    expect(creados.every((r) => r.motivo === MOTIVO_CANCELACION_AUTORIZADA)).toBe(true);
    expect(exito(await fx.admin.from("cancelacion_cita").select("id").eq("id_monitoria", c.monitoria.id), "leer")).toHaveLength(1);
    expect((await eventosDe(c.monitoria.id)).filter((e) => e === "cancelada")).toHaveLength(1);
    // Y por la puerta real, ya cancelada, el mismo resultado sin pisar nada.
    expect(await autorizar(sesionB, c.monitoria.id, "otro", "Tercera pestaña.")).toBe("ya_cancelada");
    expect(await registroDe(c.monitoria.id)).toMatchObject({ id_admin: adminA.id, nota: "Primera pestaña." });
  }, 60_000);

  it.each(["la autorización primero", "la cancelación del Lead primero"] as const)(
    "contra la cancelación a tiempo del Lead (hora simulada), con %s: gana una y la otra recibe ya_cancelada; un solo juego de reembolsos y de correos, con el motivo de quien ganó",
    async (orden) => {
      const c = await caso(5, { pagos: [{ estado: "aprobado" }] });
      const dentroDelPlazo = new Date(c.inicio.getTime() - 14 * HORA);
      const autorizacion = { rol: adminB, hacer: (conn: Conexion) => autorizarEn(conn.cliente, c.monitoria.id, "fuerza_mayor", "Gana la autorización.") };
      const cancelacion = { hacer: (conn: Conexion) => cancelarConHoraEn(conn.cliente, c.monitoria.id, dentroDelPlazo) };

      const [autorizo, cancelo] = orden === "la autorización primero" ? await carrera(autorizacion, cancelacion) : (await carrera(cancelacion, autorizacion)).reverse();

      expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "estudiante" });
      expect((await reembolsosDe(c.monitoria.id)).map((r) => r.motivo)).toEqual([orden === "la autorización primero" ? MOTIVO_CANCELACION_AUTORIZADA : MOTIVO_CANCELACION_A_TIEMPO]);
      expect(exito(await fx.admin.from("cancelacion_cita").select("id").eq("id_monitoria", c.monitoria.id), "leer")).toHaveLength(1);
      expect((await eventosDe(c.monitoria.id)).filter((e) => e === "cancelada")).toHaveLength(1);
      if (orden === "la autorización primero") {
        expect([autorizo, cancelo]).toEqual(["autorizada", "ya_cancelada"]);
        expect(await registroDe(c.monitoria.id)).toMatchObject({ id_admin: adminB.id });
      } else {
        expect([autorizo, cancelo]).toEqual(["ya_cancelada", "cancelada"]);
        expect(await registroDe(c.monitoria.id)).toBeNull();
      }
    },
    60_000,
  );

  it.each(["la autorización primero", "la aprobación primero"] as const)(
    "contra revisar_pago aprobando un pago en revisión, con %s: un solo reembolso para ese pago, con el motivo de la autorización",
    async (orden) => {
      const c = await caso(5, { pagos: [{ estado: "aprobado" }, { estado: "en_revision", monto: 12_000 }] });
      const [, enRevision] = c.pagos;
      const autorizacion = { rol: adminB, hacer: (conn: Conexion) => autorizarEn(conn.cliente, c.monitoria.id, "fuerza_mayor") };
      const aprobacion = { rol: adminA, hacer: (conn: Conexion) => revisarEn(conn.cliente, enRevision.id, "aprobar") };

      const [autorizo, aprobo] = orden === "la autorización primero" ? await carrera(autorizacion, aprobacion) : (await carrera(aprobacion, autorizacion)).reverse();

      expect(autorizo).toBe("autorizada");
      expect(aprobo).toMatchObject({ resultado: "aprobado" });
      const primero = await primerAdminActivo();
      const creados = await reembolsosDe(c.monitoria.id);
      expect(creados.map((r) => r.id_pago).sort()).toEqual(c.pagos.slice(0, 2).map((p) => p.id).sort());
      expect(creados.filter((r) => r.id_pago === enRevision.id)).toEqual([
        expect.objectContaining({ id_admin: primero, monto: 12_000, motivo: MOTIVO_CANCELACION_AUTORIZADA, estado: "esperando_llave" }),
      ]);
      expect(creados.every((r) => r.motivo === MOTIVO_CANCELACION_AUTORIZADA)).toBe(true);
      expect(exito(await fx.admin.from("pago").select("estado").eq("id", enRevision.id).single(), "leer el pago").estado).toBe("aprobado");
    },
    60_000,
  );

  it.each(["la autorización primero", "el rechazo primero"] as const)(
    "contra revisar_pago rechazando un pago en revisión, con %s: ese pago nunca tiene reembolso; si la autorización va primero, el pagador recibe «no hay reembolso» (cita_ya_cancelada); si el rechazo va primero, la cita se cancela por el pago y la autorización responde no_cancelable",
    async (orden) => {
      const c = await caso(5, { pagos: [{ estado: "aprobado" }, { estado: "en_revision", monto: 12_000 }] });
      const [, enRevision] = c.pagos;
      const autorizacion = { rol: adminB, hacer: (conn: Conexion) => autorizarEn(conn.cliente, c.monitoria.id, "fuerza_mayor") };
      const rechazo = { rol: adminA, hacer: (conn: Conexion) => revisarEn(conn.cliente, enRevision.id, "rechazar") };

      type Rechazo = Awaited<ReturnType<typeof revisarEn>>;
      const [autorizo, rechazo2] =
        orden === "la autorización primero"
          ? await carrera(autorizacion, rechazo)
          : ((await carrera(rechazo, autorizacion)).reverse() as [ResultadoDeAutorizacion, Rechazo]);

      expect(rechazo2).toMatchObject({ resultado: "rechazado" });
      expect((await reembolsosDe(c.monitoria.id)).map((r) => r.id_pago)).not.toContain(enRevision.id);
      expect(exito(await fx.admin.from("pago").select("estado").eq("id", enRevision.id).single(), "leer el pago").estado).toBe("rechazado");
      if (orden === "la autorización primero") {
        expect(autorizo).toBe("autorizada");
        expect(rechazo2.cancelo_monitoria).toBe(false);
        expect(await avisosDeRechazoDe(enRevision.id)).toEqual([expect.objectContaining({ caso: "cita_ya_cancelada" })]);
        await procesarRechazoHasta(enRevision.id);
        const alPagador = await correosA(enRevision.contacto);
        expect(alPagador.map((m) => m.Subject)).toEqual(["No pudimos verificar tu pago y no hay reembolso"]);
        expect((await reembolsosDe(c.monitoria.id)).map((r) => r.id_pago)).toEqual([c.pagos[0].id]);
      } else {
        // El rechazo cancela la cita por el pago (HU-020): no queda nada que autorizar ni registro alguno.
        expect(autorizo).toBe("no_cancelable");
        expect(rechazo2.cancelo_monitoria).toBe(true);
        expect(await estadoDe(c.monitoria.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });
        expect(await registroDe(c.monitoria.id)).toBeNull();
        expect(await avisosDeRechazoDe(enRevision.id)).toEqual([expect.objectContaining({ caso: "cita_cancelada" })]);
      }
    },
    60_000,
  );

  it("un admin desactivado mientras espera el candado de la monitoría recibe sin_permiso y no escribe nada, aunque su token siga vigente", async () => {
    const c = await caso(5, { pagos: [{ estado: "aprobado" }] });
    const antes = await foto(c.monitoria.id);

    try {
      await conDosConexiones(async (dueno, b) => {
        await dueno.cliente.query("begin");
        await dueno.cliente.query("select 1 from public.monitoria where id = $1 for update", [c.monitoria.id]);
        await b.cliente.query("begin");
        await como(b.cliente, adminB);
        const autorizacion = enCurso(autorizarEn(b.cliente, c.monitoria.id, "fuerza_mayor", "Mientras espera."));
        await esperarBloqueo(b.pid, dueno.pid, autorizacion);

        // Mientras espera, lo desactivan (RN-23: banear en Auth). privado.es_admin() lee auth.users en cada llamada.
        await bd.query("update auth.users set banned_until = 'infinity' where id = $1", [adminB.id]);
        await dueno.cliente.query("commit");

        // La puerta ya había dicho que podía: es el núcleo, con el candado tomado, el que vuelve a mirar.
        expect(await autorizacion.promesa).toBe("sin_permiso");
        await b.cliente.query("commit");
      });
    } finally {
      await bd.query("update auth.users set banned_until = null where id = $1", [adminB.id]);
    }

    expect(await foto(c.monitoria.id)).toEqual(antes);
    // Restaurado el admin, vuelve a poder autorizar.
    expect(await autorizar(sesionB, c.monitoria.id, "fuerza_mayor")).toBe("autorizada");
  }, 60_000);

  it.each(["la autorización primero", "mover primero"] as const)(
    "contra mover_admin (for update sobre todos los admins), con %s: ninguna se interbloquea; la autorización toma dos filas de admin (la del registro y la del reembolso)",
    async (orden) => {
      const c = await caso(5, { pagos: [{ estado: "aprobado" }] });
      const primero = await primerAdminActivo();
      expect(primero).not.toBe(adminB.id);
      const autorizacion = { rol: adminB, hacer: (conn: Conexion) => autorizarEn(conn.cliente, c.monitoria.id, "fuerza_mayor") };
      const mover = { rol: adminA, hacer: (conn: Conexion) => moverEn(conn.cliente, adminB.id, "arriba") };

      try {
        const [autorizo, movio] = orden === "la autorización primero" ? await carrera(autorizacion, mover) : (await carrera(mover, autorizacion)).reverse();
        expect([autorizo, movio]).toEqual(["autorizada", "movido"]);
      } finally {
        await restaurarElOrdenDeAYB();
      }

      expect(await registroDe(c.monitoria.id)).toMatchObject({ id_admin: adminB.id });
      expect((await reembolsosDe(c.monitoria.id)).map((r) => r.id_admin)).toEqual([primero]);
    },
    60_000,
  );

  it("contra reportar_inasistencia con horas simuladas: la autorización que empezó un segundo antes del inicio y espera detrás de un reporte creado en el inicio responde ya_empezo, sin cancelar la cita que ya tiene un reporte", async () => {
    const c = await caso(5, { pagos: [{ estado: "aprobado" }] });
    const antes = await foto(c.monitoria.id);
    const alReportar = new Date(c.inicio.getTime() + SEGUNDO);
    const alAutorizar = new Date(c.inicio.getTime() - SEGUNDO);

    // La conexión 1 reporta en el instante siguiente al inicio y queda sin confirmar (tiene la monitoría); la 2 autoriza con una
    // hora anterior al inicio, como si su transacción hubiera empezado un segundo antes, y espera.
    const [reporte, autorizo] = await carrera(
      {
        hacer: async (conn) => (await conn.cliente.query<{ r: string }>("select privado.reportar_inasistencia($1::uuid, $2::timestamptz) as r", [c.monitoria.id, alReportar.toISOString()])).rows[0].r,
      },
      { token: adminB, hacer: (conn) => autorizarConHoraEn(conn.cliente, c.monitoria.id, "otro", nota(), alAutorizar) },
    );

    expect(reporte).toBe("reportada");
    expect(autorizo).toBe("ya_empezo");
    // Nada cambió salvo el reporte, que quedó en revisión sobre una cita que sigue confirmada.
    expect(await foto(c.monitoria.id)).toEqual(antes);
    const reportes = exito(await fx.admin.from("reporte_inasistencia").select("estado").eq("id_monitoria", c.monitoria.id), "leer el reporte");
    expect(reportes).toEqual([{ estado: "en_revision" }]);
    expect(await reembolsosDe(c.monitoria.id)).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Al final del archivo: cobertura de resultados y el admin desactivado (deja desactivado al admin A)
// ---------------------------------------------------------------------------------------------------------------

describe("los once resultados de la función se vieron por la puerta real", () => {
  it("cada uno de RESULTADOS_DE_AUTORIZACION salió al menos una vez en este archivo", () => {
    expect([...resultadosVistos].sort()).toEqual([...RESULTADOS_DE_AUTORIZACION].sort());
  });
});

describe("criterio 8: un admin desactivado no autoriza, aunque su token siga vigente", () => {
  it("A, desactivado (RN-23), recibe sin_permiso, no ve la lista, y lo que autorizó antes se conserva", async () => {
    const hecha = await caso(5, { pagos: [{ estado: "aprobado" }] });
    expect(await autorizar(sesionA, hecha.monitoria.id, "fuerza_mayor", "Antes de irse.")).toBe("autorizada");
    const pendiente = await caso(5, { pagos: [{ estado: "aprobado" }] });
    const antes = await foto(pendiente.monitoria.id);

    await desactivarCuenta(adminA.id);

    expect(await autorizar(sesionA, pendiente.monitoria.id, "fuerza_mayor")).toBe("sin_permiso");
    expect(await cargarCitasSinPlazo(sesionA)).toEqual({ filas: [], total: 0 });
    expect(await foto(pendiente.monitoria.id)).toEqual(antes);
    // La fila de quien autorizó antes de irse se conserva: a un admin se le desactiva y no se borra.
    expect(await registroDe(hecha.monitoria.id)).toMatchObject({ id_admin: adminA.id, nota: "Antes de irse." });
    // Otro admin activo sigue pudiendo.
    expect(await autorizar(sesionB, pendiente.monitoria.id, "fuerza_mayor")).toBe("autorizada");
  }, 60_000);
});
