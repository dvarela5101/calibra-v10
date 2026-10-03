import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/procesos/pedir-llaves/route";
import { entregarLlave, type EstadoEntregar } from "@/app/reembolso/acciones";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { revisarPago } from "@/lib/admin/pagos";
import { cancelarCitaPorToken, procesarCancelacionesDeCita } from "@/lib/citas/cancelar";
import { MAXIMO_DE_INTENTOS } from "@/lib/citas/servidor";
import { claveDeCorreo } from "@/lib/correo/enviar";
import type { Plantilla } from "@/lib/correo/plantillas";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { reintentarCorreosFallidos } from "@/lib/correo/reintentos";
import { enviarCorreoDesdeServidor } from "@/lib/correo/servidor";
import { diaDelNegocio, formatearFechaHora } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";
import { diaIsoDeFecha } from "@/lib/plazos/motor";
import { correoConsultasDatos } from "@/lib/privacidad/consentimiento";
import { procesarPedidosDeLlave, reconstruirPedidoDeLlave, reconstruirRecordatorioDeLlave } from "@/lib/reembolsos/pedidos";
import { MENSAJE_ENLACE_QUE_NO_SIRVE, MOTIVO_CANCELACION_A_TIEMPO, rutaDeLlave } from "@/lib/reembolsos/reglas";
import { entregarLlavePorToken, leerLlavePorToken, reabrirReembolso } from "@/lib/reembolsos/servidor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente } from "./utilidades";

/**
 * HU-025 contra el Supabase local: quien pagó entrega la llave de su reembolso desde el enlace que le llega (P-10, P-22,
 * D-27). La base anota en `pedido_llave` un correo por cada reembolso que nace esperando la llave, el recordatorio a los
 * 3 días y la reapertura; `procesarPedidosDeLlave` (el mismo código de la ruta `/api/procesos/pedir-llaves`) los manda por
 * Mailpit. En local no hay configuración en Vault, así que la base no llama a la app: la prueba llama el proceso, y corre
 * `privado.vencer_pedidos_de_llave(now())` en lugar de pg_cron.
 *
 * Los plazos se prueban envejeciendo la fila (`plazo_llave_desde` en el pasado), no moviendo el reloj: el trabajo corre
 * con la hora de la base, como en producción, y solo toca lo que ya venció de verdad. Los bordes exactos (7 días justos,
 * P-40) los cubre el pgTAP con p_ahora.
 *
 * Cada reembolso tiene un pago de un contacto propio, así que los correos de cada prueba no se mezclan en Mailpit. Los
 * datos son de la prueba y los borra ella: los reembolsos (y sus pedidos y solicitudes, en cascada) con `limpiar()`; el
 * registro de correos y los buzones de Mailpit, esta prueba. La corrida del proceso toma cualquier pedido pendiente de la
 * base (lotes de 10): se repite hasta que el de la prueba queda procesado, y cada prueba deja procesados los suyos.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
/** P-10: los días para entregar la llave y los del recordatorio (`public.parametros_reembolso`, que fija el pgTAP). */
const DIAS_PARA_ENTREGAR = 7;
const DIAS_PARA_RECORDAR = 3;
const PRECIO = 25_000;
const INICIAL: EstadoEntregar = { error: null, valor: "" };
const TEXTO_INASISTENCIA = "Revisamos el reporte de que el monitor no asistió a la monitoría y lo aceptamos";

type Contexto = Awaited<ReturnType<Fixtures["crearContextoDeMonitoria"]>>;
type Mensaje = { Subject: string; Text: string; HTML: string };

let fx: Fixtures;
let bd: pg.Client;
let mailpit: string;
let e: Awaited<ReturnType<typeof construirEscenario>>;
/** La sesión del admin del escenario: tiene asignados los pagos y los reembolsos de la prueba. */
let sesionAdmin: Cliente;
let sesionMonitor: Cliente;
/** Una sesión anónima cualquiera (rol `authenticated`, sin ser admin). */
let anonima: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
const monitorias: string[] = [];
const reembolsos = new Set<string>();
const pedidos = new Set<string>();
const correos = new Set<string>();

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  fx = new Fixtures();
  try {
    e = await construirEscenario();
    sesionAdmin = await fx.iniciarSesion(e.admin);
    sesionMonitor = await fx.iniciarSesion(e.monitor);
    anonima = await fx.crearAnonimo();
  } catch (error) {
    await bd.end();
    await fx.limpiar();
    throw error;
  }
}, 60_000);

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // Cada prueba deja procesado lo suyo: la siguiente corrida del proceso no se lo encuentra.
  const ahora = new Date().toISOString();
  if (reembolsos.size) {
    await fx.admin.from("pedido_llave").update({ procesado_en: ahora }).in("id_reembolso", [...reembolsos]).is("procesado_en", null);
  }
  if (monitorias.length) {
    await fx.admin.from("cancelacion_cita").update({ procesado_en: ahora }).in("id_monitoria", monitorias).is("procesado_en", null);
    await fx.admin.from("confirmacion_cita").update({ procesado_en: ahora }).in("id_monitoria", monitorias).is("procesado_en", null);
  }
});

afterAll(async () => {
  for (const correo of correos) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(() => undefined);
  }
  if (fx) {
    // Los pedidos se van en cascada con sus reembolsos; el registro de sus correos, no.
    if (reembolsos.size) {
      const { data } = await fx.admin.from("pedido_llave").select("id").in("id_reembolso", [...reembolsos]);
      for (const { id } of data ?? []) pedidos.add(id);
    }
    const claves = [
      ...[...pedidos].flatMap((id) => [claveDeCorreo("solicitud_llave_reembolso", id), claveDeCorreo("recordatorio_llave_reembolso", id)]),
      ...monitorias.map((id) => claveDeCorreo("cancelacion_cita", id)),
    ];
    // Por lotes: cada clave mide unos 60 caracteres y el filtro viaja en la URL.
    for (let i = 0; i < claves.length; i += 40) {
      await fx.admin.from("correo_envio").delete().in("clave", claves.slice(i, i + 40));
    }
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

/** El primer lunes a ocho semanas o más de hoy en Bogotá, más `semanasExtra` semanas: cada monitoría en su semana. */
function lunesLejano(semanasExtra = 0): string {
  let fecha = sumarDias(diaDelNegocio(new Date()), 56 + semanasExtra * 7);
  while (diaIsoDeFecha(fecha) !== 1) fecha = sumarDias(fecha, 1);
  return fecha;
}

async function construirEscenario() {
  const admin = await fx.crearAdmin();
  const { materia } = await fx.crearEvaluacion();
  // Con monitor_privado: su correo existe, y no debe aparecer en nada que reciba quien pagó (P-37).
  const monitor = await fx.crearMonitor({ conContacto: true });
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
  const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: 1, hora: "10:00:00" });
  const lead = await fx.crearLead();
  correos.add(lead.correo!);
  return { admin, materia, monitor, lead, franja, contexto: { materia, monitor, franja, lead } as Contexto };
}

let semana = 0;

/** Un correo propio de la prueba (Mailpit separa los buzones por destinatario). */
function correoNuevo(prefijo = "pagador"): string {
  const correo = `${prefijo}-${randomBytes(6).toString("hex")}@calibra.test`;
  correos.add(correo);
  return correo;
}

/** Un Lead propio: su buzón solo tiene los correos de esta prueba. */
async function leadNuevo() {
  const lead = await fx.crearLead();
  correos.add(lead.correo!);
  return lead;
}

const nombreNuevo = () => `Pagador ${randomBytes(3).toString("hex")}`;

/** Una individual que pasó de `pendiente_pago` a `confirmada` (así se anota su token de confirmación, HU-019). */
async function confirmada(contexto: Contexto) {
  const monitoria = await fx.crearMonitoria(contexto, { fecha: lunesLejano(semana++), estado: "pendiente_pago" });
  monitorias.push(monitoria.id);
  exito(await fx.admin.from("monitoria").update({ estado: "confirmada" }).eq("id", monitoria.id).select().single(), "confirmar la monitoría");
  return monitoria;
}

async function tokenDeCita(idMonitoria: string): Promise<string> {
  const filas = exito(await fx.admin.from("confirmacion_cita").select("token").eq("id_monitoria", idMonitoria), "leer la confirmación");
  if (!filas[0]) throw new Error(`La monitoría ${idMonitoria} no tiene confirmación anotada.`);
  return filas[0].token;
}

/** Un pago de la monitoría, asignado al admin del escenario, con el correo y el nombre de quien pagó. */
async function pagoDe(idMonitoria: string, estado: "en_revision" | "aprobado", contacto: string, nombrePagador = nombreNuevo()) {
  const pago = await fx.crearPagoDe(idMonitoria, { idAdmin: e.admin.id, estado, nombrePagador });
  exito(await fx.admin.from("pago").update({ contacto }).eq("id", pago.id).select().single(), "poner el contacto del pago");
  return pago;
}

/**
 * Un reembolso que espera la llave, insertado directo, como lo hace cualquier HU que lo crea (HU-024, P-07, HU-030): los
 * triggers le anotan su solicitud (el token) y su pedido. Su pago aprobado es de un contacto propio.
 */
async function esperando(opciones: { motivoCancelacion?: "estudiante" | "monitor_no_asistio" } = {}) {
  const monitoria = await fx.crearMonitoria(e.contexto, { fecha: lunesLejano(semana++), estado: "cancelada" });
  monitorias.push(monitoria.id);
  if (opciones.motivoCancelacion === "monitor_no_asistio") {
    exito(
      await fx.admin.from("monitoria").update({ motivo_cancelacion: "monitor_no_asistio" }).eq("id", monitoria.id).select().single(),
      "cancelar por inasistencia",
    );
  }
  const contacto = correoNuevo();
  const nombrePagador = nombreNuevo();
  const pago = await pagoDe(monitoria.id, "aprobado", contacto, nombrePagador);
  const reembolso = await fx.crearReembolso({ idPago: pago.id, idAdmin: e.admin.id, estado: "esperando_llave" });
  reembolsos.add(reembolso.id);
  const { token } = await solicitudDe(reembolso.id);
  return { id: reembolso.id, contacto, nombrePagador, token, motivo: reembolso.motivo };
}

async function reembolsosDe(idMonitoria: string) {
  const pagos = exito(await fx.admin.from("pago").select("id").eq("id_monitoria", idMonitoria), "leer los pagos");
  if (!pagos.length) return [];
  const filas = exito(
    await fx.admin
      .from("reembolso")
      .select("id, id_pago, monto, motivo, estado")
      .in("id_pago", pagos.map((p) => p.id))
      .order("fecha_generacion")
      .order("id"),
    "leer los reembolsos",
  );
  for (const fila of filas) reembolsos.add(fila.id);
  return filas;
}

/** Lo que la base guarda del reembolso. Con la llave secreta: aquí sí se lee la llave, para comprobarla. */
async function reembolsoEnBd(id: string) {
  return exito(
    await fx.admin.from("reembolso").select("estado, llave_destino, cerrado_en, plazo_llave_desde, id_admin").eq("id", id).single(),
    "leer el reembolso",
  );
}

async function solicitudDe(idReembolso: string) {
  return exito(
    await fx.admin.from("solicitud_llave").select("token, en_correo_de_cancelacion").eq("id_reembolso", idReembolso).single(),
    "leer la solicitud de llave",
  );
}

async function pedidosDe(idReembolso: string) {
  const filas = exito(
    await fx.admin
      .from("pedido_llave")
      .select("id, tipo, plazo_desde, procesado_en, intentos")
      .eq("id_reembolso", idReembolso)
      .order("creada_en")
      .order("id"),
    "leer los pedidos de la llave",
  );
  for (const fila of filas) pedidos.add(fila.id);
  return filas;
}

/** El único pedido de ese tipo del reembolso. */
async function pedidoDe(idReembolso: string, tipo: "pedido" | "recordatorio" | "reapertura" | "reenvio") {
  const filas = (await pedidosDe(idReembolso)).filter((p) => p.tipo === tipo);
  expect(filas, `un solo pedido de tipo ${tipo}`).toHaveLength(1);
  return filas[0];
}

async function pedido(id: string) {
  return exito(await fx.admin.from("pedido_llave").select("procesado_en, intentos").eq("id", id).single(), "leer el pedido");
}

async function registroDe(plantilla: Plantilla, entidad: string) {
  const filas = exito(
    await fx.admin.from("correo_envio").select("estado, destinatario, plantilla").eq("clave", claveDeCorreo(plantilla, entidad)),
    "leer el registro de correos",
  );
  return filas[0] ?? null;
}

/** El fin del plazo para entregar la llave de un ciclo que empezó en `desde` (P-10). */
const venceDe = (desde: string | Date) => new Date(new Date(desde).getTime() + DIAS_PARA_ENTREGAR * DIA);

/** Corre el proceso hasta que ese pedido queda procesado (puede haber otros pendientes en la base). */
async function procesarHasta(idPedido: string) {
  for (let i = 0; i < 10; i++) {
    await procesarPedidosDeLlave({ cliente: fx.admin });
    if ((await pedido(idPedido)).procesado_en !== null) return;
  }
  throw new Error(`El pedido de la llave ${idPedido} no se procesó tras 10 corridas.`);
}

/** Corre el proceso de HU-024 hasta que la cancelación de esa monitoría queda procesada. */
async function procesarCancelacionHasta(idMonitoria: string) {
  for (let i = 0; i < 10; i++) {
    await procesarCancelacionesDeCita({ cliente: fx.admin });
    const filas = exito(await fx.admin.from("cancelacion_cita").select("procesado_en").eq("id_monitoria", idMonitoria), "leer la cancelación");
    if (!filas[0] || filas[0].procesado_en !== null) return;
  }
  throw new Error(`La cancelación de la monitoría ${idMonitoria} no se procesó tras 10 corridas.`);
}

async function correosA(correo: string): Promise<Mensaje[]> {
  correos.add(correo);
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

// ---------------------------------------------------------------------------------------------------------------
// Con `pg`, como dueño de la base: lo que hace pg_cron y lo que la prueba no puede esperar días para ver
// ---------------------------------------------------------------------------------------------------------------

/**
 * Mueve el inicio del plazo de la llave `minutos` hacia atrás de la hora de la base. Devuelve el nuevo inicio, en
 * milisegundos exactos: así `pg` y la Data API leen el mismo instante (cada una redondea los microsegundos a su modo).
 */
async function envejecer(idReembolso: string, minutos: number): Promise<Date> {
  const { rows } = await bd.query<{ desde: Date }>(
    "update public.reembolso set plazo_llave_desde = date_trunc('milliseconds', now() - make_interval(mins => $2)) where id = $1 returning plazo_llave_desde as desde",
    [idReembolso, minutos],
  );
  if (rows.length !== 1) throw new Error(`No se pudo envejecer el reembolso ${idReembolso}.`);
  return rows[0].desde;
}

/** El trabajo de pg_cron `calibra-vencer-llaves`, con la hora de la base. */
async function vencer(): Promise<{ cerrados: number; recordatorios: number }> {
  const { rows } = await bd.query<{ cerrados: number; recordatorios: number }>("select cerrados, recordatorios from privado.vencer_pedidos_de_llave(now())");
  return rows[0];
}

async function horaDeLaBase(): Promise<Date> {
  const { rows } = await bd.query<{ ahora: Date }>("select clock_timestamp() as ahora");
  return rows[0].ahora;
}

// ---------------------------------------------------------------------------------------------------------------
// La acción de la página y la ruta
// ---------------------------------------------------------------------------------------------------------------

/** La acción del formulario de la página. Si redirige, devuelve a dónde y cómo (el `digest` del error de Next). */
async function enviarFormulario(campos: Record<string, string>) {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  try {
    return { estado: await entregarLlave(INICIAL, datos), redireccion: null };
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
      // NEXT_REDIRECT;<tipo>;<ruta>;<código>;
      const [, tipo, ...resto] = digest.split(";");
      return { estado: null, redireccion: { tipo, ruta: resto.slice(0, -2).join(";") } };
    }
    throw error;
  }
}

const SECRETO = randomBytes(32).toString("hex");

const llamarRuta = (encabezado?: string) =>
  POST(
    new Request("http://localhost:3000/api/procesos/pedir-llaves", {
      method: "POST",
      headers: encabezado === undefined ? {} : { authorization: encabezado },
      body: "{}",
    }),
  );

/** La fila de un admin en la pantalla del equipo (HU-054, HU-074), leída con la sesión del admin del escenario. */
async function casosAbiertosDe(idAdmin: string): Promise<number> {
  const equipo = exito(await sesionAdmin.rpc("equipo_de_admins"), "leer el equipo de admins");
  const fila = equipo.find((a) => a.id === idAdmin);
  if (!fila) throw new Error(`El admin ${idAdmin} no está en el equipo.`);
  return fila.casos_abiertos;
}

// ---------------------------------------------------------------------------------------------------------------
// Criterio 1: el pedido de la llave
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: al crearse el reembolso, quien pagó recibe en su contacto un enlace con token", () => {
  it("P-07 por las puertas reales: el Lead cancela con el pago en revisión, el admin lo aprueba con su sesión y la ruta /api/procesos/pedir-llaves manda el pedido a pago.contacto con /reembolso?token=<el de su solicitud> y la fecha en que vence; otra corrida no lo repite", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    const lead = await leadNuevo();
    const monitoria = await confirmada({ ...e.contexto, lead } as Contexto);
    const nombrePagador = nombreNuevo();
    const pago = await pagoDe(monitoria.id, "en_revision", lead.correo!, nombrePagador);
    expect(await cancelarCitaPorToken(await tokenDeCita(monitoria.id))).toBe("cancelada");
    expect(await reembolsosDe(monitoria.id)).toEqual([]);

    expect(await revisarPago(sesionAdmin, { idPago: pago.id, decision: "aprobar", observaciones: null })).toEqual({ resultado: "aprobado", canceloMonitoria: false });

    const [reembolso] = await reembolsosDe(monitoria.id);
    expect(reembolso).toMatchObject({ id_pago: pago.id, monto: PRECIO, motivo: MOTIVO_CANCELACION_A_TIEMPO, estado: "esperando_llave" });
    const solicitud = await solicitudDe(reembolso.id);
    // El correo de cancelación salió (o saldrá) sin esta llave: la pide HU-025 (D-27).
    expect(solicitud.en_correo_de_cancelacion).toBe(false);
    const { plazo_llave_desde } = await reembolsoEnBd(reembolso.id);
    const anotados = await pedidosDe(reembolso.id);
    expect(anotados).toHaveLength(1);
    expect(anotados[0]).toMatchObject({ tipo: "pedido", procesado_en: null, intentos: 0 });
    expect(new Date(anotados[0].plazo_desde).getTime()).toBe(new Date(plazo_llave_desde).getTime());

    const respuesta = await llamarRuta(`Bearer ${SECRETO}`);
    expect(respuesta.status).toBe(200);
    const resumen = await respuesta.json();
    expect(resumen.revisadas).toBe(resumen.enviadas + resumen.descartadas + resumen.fallidas + resumen.tomadasPorOtro + resumen.conError + resumen.pospuestas);
    expect(resumen.enviadas).toBeGreaterThanOrEqual(1);
    await procesarHasta(anotados[0].id);

    const recibidos = (await correosA(lead.correo!)).filter((c) => c.Text.includes(rutaDeLlave(solicitud.token)));
    expect(recibidos, "debía llegar un solo correo con el enlace de la llave de este reembolso").toHaveLength(1);
    const [correo] = recibidos;
    expect(correo.Subject).toBe(`Necesitamos tu llave para devolverte ${formatearPesos(PRECIO)}`);
    expect(correo.Text).toContain(`Hola, ${nombrePagador}.`);
    expect(correo.Text).toContain(`Vamos a devolverte ${formatearPesos(PRECIO)} de tu pago en Calibra. Motivo: ${MOTIVO_CANCELACION_A_TIEMPO}`);
    expect(correo.Text).toContain(`Tienes hasta el ${formatearFechaHora(venceDe(plazo_llave_desde))} para enviarla.`);
    expect(correo.HTML).toContain(`href="${new URL(rutaDeLlave(solicitud.token), process.env.SITIO_URL ?? "http://localhost:3000").href}"`);
    expect(correo.HTML).toContain("Enviar mi llave");
    // No es un reembolso por inasistencia (D-37), y ni el contacto del monitor ni la comisión salen (P-37, D-6).
    expect(correo.Text).not.toContain(TEXTO_INASISTENCIA);
    expect(correo.Text).not.toContain(e.monitor.correo);
    expect(correo.HTML).not.toContain(e.monitor.correo);
    expect(correo.Text.toLowerCase()).not.toContain("comisi");

    // El registro de correos lleva la clave `solicitud_llave_reembolso:<id del pedido>`.
    expect(await registroDe("solicitud_llave_reembolso", anotados[0].id)).toEqual({
      estado: "enviado",
      destinatario: lead.correo,
      plantilla: "solicitud_llave_reembolso",
    });

    // Otra corrida no lo manda otra vez.
    await procesarPedidosDeLlave({ cliente: fx.admin });
    expect((await correosA(lead.correo!)).filter((c) => c.Text.includes(rutaDeLlave(solicitud.token)))).toHaveLength(1);
  });

  it("D-27: si el correo de cancelación ya pidió la llave, el pedido aparte se descarta y queda un solo correo con ese enlace; el pago de otro contacto sí recibe el suyo", async () => {
    const lead = await leadNuevo();
    const monitoria = await confirmada({ ...e.contexto, lead } as Contexto);
    const delLead = await pagoDe(monitoria.id, "aprobado", lead.correo!);
    const otro = correoNuevo("otro-pagador");
    const deOtro = await pagoDe(monitoria.id, "aprobado", otro);

    expect(await cancelarCitaPorToken(await tokenDeCita(monitoria.id))).toBe("cancelada");
    const creados = await reembolsosDe(monitoria.id);
    expect(creados).toHaveLength(2);
    const conElLead = creados.find((r) => r.id_pago === delLead.id)!;
    const conOtro = creados.find((r) => r.id_pago === deOtro.id)!;
    const solicitudDelLead = await solicitudDe(conElLead.id);
    const solicitudDeOtro = await solicitudDe(conOtro.id);
    expect(solicitudDelLead.en_correo_de_cancelacion).toBe(true);
    expect(solicitudDeOtro.en_correo_de_cancelacion).toBe(false);
    // Los dos nacen con su pedido anotado: la marca se decide después, en la misma transacción de la cancelación.
    const pedidoDelLead = await pedidoDe(conElLead.id, "pedido");
    const pedidoDeOtro = await pedidoDe(conOtro.id, "pedido");

    await procesarCancelacionHasta(monitoria.id);
    await procesarHasta(pedidoDelLead.id);
    await procesarHasta(pedidoDeOtro.id);

    // Al Lead le llega un solo correo con el enlace de su llave: el de la cancelación (HU-024).
    const alLead = (await correosA(lead.correo!)).filter((c) => c.Text.includes(rutaDeLlave(solicitudDelLead.token)));
    expect(alLead).toHaveLength(1);
    expect(alLead[0].Subject).toBe(`Cancelaste tu monitoría de ${e.materia.nombre}`);
    expect(await registroDe("solicitud_llave_reembolso", pedidoDelLead.id)).toBeNull();
    expect((await pedido(pedidoDelLead.id)).procesado_en).not.toBeNull();

    // A quien pagó con otro correo, el pedido aparte, solo con su enlace.
    const alOtro = await correosA(otro);
    expect(alOtro).toHaveLength(1);
    expect(alOtro[0].Subject).toBe(`Necesitamos tu llave para devolverte ${formatearPesos(PRECIO)}`);
    expect(alOtro[0].Text).toContain(rutaDeLlave(solicitudDeOtro.token));
    expect(alOtro[0].Text).not.toContain(rutaDeLlave(solicitudDelLead.token));
    expect(await registroDe("solicitud_llave_reembolso", pedidoDeOtro.id)).toEqual({ estado: "enviado", destinatario: otro, plantilla: "solicitud_llave_reembolso" });
  });

  it("D-37: el pedido de un reembolso por inasistencia del monitor empieza diciendo que se aceptó el reporte", async () => {
    const r = await esperando({ motivoCancelacion: "monitor_no_asistio" });
    await procesarHasta((await pedidoDe(r.id, "pedido")).id);

    const recibidos = await correosA(r.contacto);
    expect(recibidos).toHaveLength(1);
    expect(recibidos[0].Text).toContain(TEXTO_INASISTENCIA);
    expect(recibidos[0].Text).toContain(rutaDeLlave(r.token));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterios 2 y 3: entregar la llave, y que nadie más la vea
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 2: quien pagó escribe su llave en la página del enlace", () => {
  it("la página muestra el monto, el motivo y hasta cuándo; la acción guarda la llave normalizada, el reembolso pasa a pendiente y vuelve a la página con replace; después el enlace ya no la cambia", async () => {
    const r = await esperando();
    const { plazo_llave_desde } = await reembolsoEnBd(r.id);
    expect(await leerLlavePorToken(r.token)).toEqual({ estado: "esperando_llave", monto: PRECIO, motivo: r.motivo, venceEn: venceDe(plazo_llave_desde) });

    expect(await enviarFormulario({ token: r.token, llave: "  300   123\t4567 " })).toEqual({
      estado: null,
      redireccion: { tipo: "replace", ruta: rutaDeLlave(r.token) },
    });
    expect(await reembolsoEnBd(r.id)).toMatchObject({ estado: "pendiente", llave_destino: "300 123 4567", cerrado_en: null });
    const vista = await leerLlavePorToken(r.token);
    expect(vista).toMatchObject({ estado: "pendiente", monto: PRECIO, motivo: r.motivo });
    expect(JSON.stringify(vista)).not.toContain("300 123 4567");

    // Otra pestaña o el doble clic: vuelve a la página, que dice que ya la recibimos, y la llave no cambia (supuesto 3).
    expect(await enviarFormulario({ token: r.token, llave: "otra-llave" })).toEqual({
      estado: null,
      redireccion: { tipo: "replace", ruta: rutaDeLlave(r.token) },
    });
    expect(await entregarLlavePorToken(r.token, "otra-llave")).toBe("ya_entregada");
    expect(await reembolsoEnBd(r.id)).toMatchObject({ estado: "pendiente", llave_destino: "300 123 4567" });
    // Entregar no anota ningún correo, y el token no cambia.
    expect((await pedidosDe(r.id)).map((p) => p.tipo)).toEqual(["pedido"]);
    expect((await solicitudDe(r.id)).token).toBe(r.token);
  });

  it("una llave vacía o de más de 200 caracteres no se guarda: la acción lo dice sin llamar a la base, y la base responde llave_invalida; con 200 (contados como la base) sí", async () => {
    const r = await esperando();

    expect(await enviarFormulario({ token: r.token, llave: " \t\n " })).toEqual({
      estado: { error: "Escribe tu llave para que podamos devolverte el dinero.", valor: "" },
      redireccion: null,
    });
    // Un carácter fuera del plano básico ocupa dos unidades en JavaScript y uno para la base (char_length).
    const larga = "𝟘".repeat(201);
    expect(await enviarFormulario({ token: r.token, llave: larga })).toEqual({
      estado: { error: "La llave es demasiado larga: puede tener hasta 200 caracteres.", valor: larga },
      redireccion: null,
    });
    expect(await entregarLlavePorToken(r.token, " \t\n ")).toBe("llave_invalida");
    expect(await entregarLlavePorToken(r.token, larga)).toBe("llave_invalida");
    expect(await entregarLlavePorToken(r.token, "x".repeat(201))).toBe("llave_invalida");
    expect(await reembolsoEnBd(r.id)).toMatchObject({ estado: "esperando_llave", llave_destino: null });

    const justa = "𝟘".repeat(200);
    expect((await enviarFormulario({ token: r.token, llave: justa })).redireccion).toEqual({ tipo: "replace", ruta: rutaDeLlave(r.token) });
    expect(await reembolsoEnBd(r.id)).toMatchObject({ estado: "pendiente", llave_destino: justa });
  });

  it("con un token inventado o sin forma de token no se lee ni se guarda nada, y la acción dice que el enlace no sirve", async () => {
    const r = await esperando();
    const casiReal = `${r.token.slice(0, 63)}${r.token.endsWith("0") ? "1" : "0"}`;

    for (const malo of [randomBytes(32).toString("hex"), "", "abc", r.token.toUpperCase(), ` ${r.token}`, `${r.token}x`, casiReal, "' or 1=1 --"]) {
      expect(await leerLlavePorToken(malo), JSON.stringify(malo)).toBeNull();
      expect(await entregarLlavePorToken(malo, "3001234567"), JSON.stringify(malo)).toBe("no_existe");
    }
    // La acción recorta los espacios del campo oculto: ahí se prueban los que siguen sin servir después de recortarlos.
    for (const malo of [randomBytes(32).toString("hex"), "", "abc", r.token.toUpperCase(), casiReal]) {
      expect(await enviarFormulario({ token: malo, llave: "3001234567" }), JSON.stringify(malo)).toEqual({
        estado: { error: MENSAJE_ENLACE_QUE_NO_SIRVE, valor: "3001234567" },
        redireccion: null,
      });
    }
    expect(await reembolsoEnBd(r.id)).toMatchObject({ estado: "esperando_llave", llave_destino: null });
  });
});

describe("criterio 3: la llave solo la ve un admin", () => {
  it("guardada, la lee un admin activo; ni sin sesión, ni con una sesión cualquiera, ni el monitor; las puertas del enlace y del correo son solo del servidor y no la devuelven", async () => {
    const r = await esperando();
    const p = await pedidoDe(r.id, "pedido");
    const llave = `llave-${randomBytes(6).toString("hex")}`;
    expect(await entregarLlavePorToken(r.token, llave)).toBe("entregada");

    expect(exito(await sesionAdmin.from("reembolso").select("llave_destino").eq("id", r.id), "el admin lee el reembolso")).toEqual([{ llave_destino: llave }]);
    expect((await crearCliente().from("reembolso").select("llave_destino").eq("id", r.id)).error, "anon").not.toBeNull();
    for (const [quien, cliente] of [
      ["una sesión anónima", anonima.cliente],
      ["el monitor", sesionMonitor],
    ] as const) {
      expect(exito(await cliente.from("reembolso").select("llave_destino").eq("id", r.id), quien), quien).toEqual([]);
    }

    for (const [quien, cliente] of [
      ["anon", crearCliente()],
      ["una sesión anónima", anonima.cliente],
      ["el monitor", sesionMonitor],
      ["un admin", sesionAdmin],
    ] as const) {
      expect((await cliente.rpc("datos_de_llave", { p_token: r.token })).error, `${quien}: datos_de_llave`).not.toBeNull();
      expect((await cliente.rpc("entregar_llave", { p_token: r.token, p_llave: "otra" })).error, `${quien}: entregar_llave`).not.toBeNull();
      expect((await cliente.rpc("datos_de_pedido_llave", { p_id: p.id })).error, `${quien}: datos_de_pedido_llave`).not.toBeNull();
      expect((await cliente.from("pedido_llave").select("id")).error, `${quien}: pedido_llave`).not.toBeNull();
      expect((await cliente.from("solicitud_llave").select("token")).error, `${quien}: solicitud_llave`).not.toBeNull();
    }

    // Con la llave secreta, lo que leen la página y el correo tampoco la trae.
    const paraLaPagina = exito(await fx.admin.rpc("datos_de_llave", { p_token: r.token }), "datos de la llave");
    const paraElCorreo = exito(await fx.admin.rpc("datos_de_pedido_llave", { p_id: p.id }), "datos del pedido");
    expect(paraLaPagina).toHaveLength(1);
    expect(paraElCorreo).toHaveLength(1);
    expect(JSON.stringify([paraLaPagina, paraElCorreo])).not.toContain(llave);
    expect(await reembolsoEnBd(r.id)).toMatchObject({ estado: "pendiente", llave_destino: llave });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterios 4 y 5: el recordatorio, el cierre y reabrir
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 4: a los 3 días sin llave sale un recordatorio", () => {
  it("con la fila envejecida, el trabajo de pg_cron anota el recordatorio, que sale con su plantilla, el mismo enlace y la fecha del plazo; correrlo otra vez no lo repite y la llave todavía se entrega", async () => {
    const r = await esperando();
    await procesarHasta((await pedidoDe(r.id, "pedido")).id);
    expect(await correosA(r.contacto)).toHaveLength(1);

    // Sin cumplir 3 días, el trabajo no le anota nada.
    await vencer();
    expect((await pedidosDe(r.id)).map((p) => p.tipo)).toEqual(["pedido"]);

    const desde = await envejecer(r.id, DIAS_PARA_RECORDAR * 24 * 60 + 1);
    expect((await vencer()).recordatorios).toBeGreaterThanOrEqual(1);
    const recordatorio = await pedidoDe(r.id, "recordatorio");
    expect(new Date(recordatorio.plazo_desde).getTime()).toBe(desde.getTime());
    await procesarHasta(recordatorio.id);

    const recibidos = await correosA(r.contacto);
    expect(recibidos).toHaveLength(2);
    const correo = recibidos.find((c) => c.Subject.startsWith("Todavía"));
    expect(correo?.Subject).toBe(`Todavía necesitamos tu llave para devolverte ${formatearPesos(PRECIO)}`);
    expect(correo!.Text).toContain(`Hola, ${r.nombrePagador}.`);
    expect(correo!.Text).toContain(rutaDeLlave(r.token));
    expect(correo!.Text).toContain(`Tienes hasta el ${formatearFechaHora(venceDe(desde))} para enviarla.`);
    expect(correo!.HTML).toContain("Enviar mi llave");
    expect(await registroDe("recordatorio_llave_reembolso", recordatorio.id)).toEqual({
      estado: "enviado",
      destinatario: r.contacto,
      plantilla: "recordatorio_llave_reembolso",
    });

    // pg_cron lo corre cada 15 minutos: otra corrida no anota otro recordatorio del mismo ciclo.
    await vencer();
    expect((await pedidosDe(r.id)).filter((p) => p.tipo === "recordatorio")).toHaveLength(1);
    expect(await leerLlavePorToken(r.token)).toMatchObject({ estado: "esperando_llave", venceEn: venceDe(desde) });
    expect(await entregarLlavePorToken(r.token, "3001234567")).toBe("entregada");
  });

  it("si la llave llega antes de que salga el recordatorio, el recordatorio ya no se manda", async () => {
    const r = await esperando();
    await procesarHasta((await pedidoDe(r.id, "pedido")).id);
    await envejecer(r.id, DIAS_PARA_RECORDAR * 24 * 60 + 1);
    await vencer();
    const recordatorio = await pedidoDe(r.id, "recordatorio");

    expect(await entregarLlavePorToken(r.token, "3001234567")).toBe("entregada");
    expect(await reconstruirRecordatorioDeLlave(recordatorio.id, fx.admin)).toBeNull();
    await procesarHasta(recordatorio.id);

    expect(await registroDe("recordatorio_llave_reembolso", recordatorio.id)).toBeNull();
    expect((await correosA(r.contacto)).map((c) => c.Subject)).toEqual([`Necesitamos tu llave para devolverte ${formatearPesos(PRECIO)}`]);
  });
});

describe("criterio 5: a los 7 días sin llave el caso se cierra y un admin puede reabrirlo", () => {
  it("vencido, la página ya dice cerrado y entregar responde cerrado aunque el trabajo no haya corrido; el trabajo lo cierra sin mandar correo; sale de «Esperando la llave», entra en «Cerrados sin llave» de cualquier admin y deja de contar como caso abierto", async () => {
    const r = await esperando();
    await procesarHasta((await pedidoDe(r.id, "pedido")).id);
    const antes = await cargarBandeja(sesionAdmin, e.admin.id, new Date());
    expect(antes.reembolsos.esperandoLlave.map((x) => x.id)).toContain(r.id);
    expect(antes.reembolsosCerrados.map((x) => x.id)).not.toContain(r.id);
    const abiertosAntes = await casosAbiertosDe(e.admin.id);

    // Un minuto después de los 7 días (el instante exacto, P-40, lo prueba el pgTAP con p_ahora).
    const desde = await envejecer(r.id, DIAS_PARA_ENTREGAR * 24 * 60 + 1);
    expect(await leerLlavePorToken(r.token)).toEqual({ estado: "cerrado", monto: PRECIO, motivo: r.motivo, venceEn: venceDe(desde) });
    expect(await entregarLlavePorToken(r.token, "3001234567")).toBe("cerrado");
    // La acción vuelve a la página, que dice que se cerró; no guarda nada.
    expect((await enviarFormulario({ token: r.token, llave: "3001234567" })).redireccion).toEqual({ tipo: "replace", ruta: rutaDeLlave(r.token) });
    expect(await reembolsoEnBd(r.id)).toMatchObject({ estado: "esperando_llave", llave_destino: null, cerrado_en: null });

    expect((await vencer()).cerrados).toBeGreaterThanOrEqual(1);
    const cerrado = await reembolsoEnBd(r.id);
    expect(cerrado).toMatchObject({ estado: "esperando_llave", llave_destino: null });
    expect(cerrado.cerrado_en).not.toBeNull();
    // El cierre no manda correo ni anota recordatorio (ya pasó el plazo).
    expect((await pedidosDe(r.id)).map((p) => p.tipo)).toEqual(["pedido"]);
    expect(await correosA(r.contacto)).toHaveLength(1);
    expect(await leerLlavePorToken(r.token)).toMatchObject({ estado: "cerrado" });

    const despues = await cargarBandeja(sesionAdmin, e.admin.id, new Date());
    expect(despues.reembolsos.esperandoLlave.map((x) => x.id)).not.toContain(r.id);
    expect(despues.reembolsosCerrados.find((x) => x.id === r.id)).toEqual({
      id: r.id,
      nombrePagador: r.nombrePagador,
      contacto: r.contacto,
      monto: PRECIO,
      motivo: r.motivo,
      cerradoEn: new Date(cerrado.cerrado_en!),
    });
    expect(despues.contadores.reembolsosEsperandoLlave).toBe(antes.contadores.reembolsosEsperandoLlave - 1);
    // Cualquier admin activo lo ve, para reabrirlo (supuesto 4); el monitor no.
    const otroAdmin = await fx.crearAdmin();
    const deOtro = await cargarBandeja(await fx.iniciarSesion(otroAdmin), otroAdmin.id, new Date());
    expect(deOtro.reembolsosCerrados.map((x) => x.id)).toContain(r.id);
    expect((await cargarBandeja(sesionMonitor, e.monitor.id, new Date())).reembolsosCerrados).toEqual([]);
    // Un caso cerrado deja de ser un caso abierto de su admin (P-44, HU-074).
    expect(await casosAbiertosDe(e.admin.id)).toBe(abiertosAntes - 1);
  });

  it("reabrir con la sesión de un admin activo (la acción de la bandeja): vuelven a correr los 7 días, sale un pedido de reapertura con el mismo enlace y la fecha nueva, el pedido del ciclo anterior ya no sale y la persona ya puede entregar la llave", async () => {
    // El pedido de la creación se queda sin procesar: es de un ciclo que ya no es el actual.
    const r = await esperando();
    const pedidoViejo = await pedidoDe(r.id, "pedido");
    await envejecer(r.id, (DIAS_PARA_ENTREGAR + 1) * 24 * 60);
    await vencer();
    expect((await reembolsoEnBd(r.id)).cerrado_en).not.toBeNull();

    // Solo un admin activo: una sesión cualquiera y el monitor reciben sin_permiso; sin sesión la base ni la ejecuta.
    expect(await reabrirReembolso(anonima.cliente, r.id)).toBe("sin_permiso");
    expect(await reabrirReembolso(sesionMonitor, r.id)).toBe("sin_permiso");
    await expect(reabrirReembolso(crearCliente(), r.id)).rejects.toThrow(/No se pudo reabrir el reembolso/);
    expect(await reabrirReembolso(sesionAdmin, randomUUID())).toBe("no_encontrado");
    expect(await reabrirReembolso(sesionAdmin, "no-es-un-uuid")).toBe("no_encontrado");
    expect((await reembolsoEnBd(r.id)).cerrado_en).not.toBeNull();

    const antes = await horaDeLaBase();
    expect(await reabrirReembolso(sesionAdmin, r.id)).toBe("reabierto");
    const despues = await horaDeLaBase();
    const reabierto = await reembolsoEnBd(r.id);
    expect(reabierto).toMatchObject({ estado: "esperando_llave", cerrado_en: null, llave_destino: null, id_admin: e.admin.id });
    const nuevoDesde = new Date(reabierto.plazo_llave_desde);
    expect(nuevoDesde.getTime()).toBeGreaterThanOrEqual(antes.getTime());
    expect(nuevoDesde.getTime()).toBeLessThanOrEqual(despues.getTime());
    // El doble clic: ya no está cerrado.
    expect(await reabrirReembolso(sesionAdmin, r.id)).toBe("no_cerrado");

    const reapertura = await pedidoDe(r.id, "reapertura");
    expect(new Date(reapertura.plazo_desde).getTime()).toBe(nuevoDesde.getTime());
    expect((await pedidosDe(r.id)).map((p) => p.tipo)).toEqual(["pedido", "reapertura"]);
    // El enlace es el mismo: el token no cambia.
    expect((await solicitudDe(r.id)).token).toBe(r.token);

    await procesarHasta(pedidoViejo.id);
    await procesarHasta(reapertura.id);
    const recibidos = await correosA(r.contacto);
    expect(recibidos, "solo el correo de la reapertura").toHaveLength(1);
    expect(recibidos[0].Subject).toBe(`Necesitamos tu llave para devolverte ${formatearPesos(PRECIO)}`);
    expect(recibidos[0].Text).toContain(rutaDeLlave(r.token));
    expect(recibidos[0].Text).toContain(`Tienes hasta el ${formatearFechaHora(venceDe(nuevoDesde))} para enviarla.`);
    expect(await registroDe("solicitud_llave_reembolso", pedidoViejo.id)).toBeNull();
    expect(await registroDe("solicitud_llave_reembolso", reapertura.id)).toEqual({ estado: "enviado", destinatario: r.contacto, plantilla: "solicitud_llave_reembolso" });

    // Vuelve a «Esperando la llave» y sale de los cerrados; la página vuelve al formulario y la llave se entrega.
    const bandeja = await cargarBandeja(sesionAdmin, e.admin.id, new Date());
    expect(bandeja.reembolsos.esperandoLlave.map((x) => x.id)).toContain(r.id);
    expect(bandeja.reembolsosCerrados.map((x) => x.id)).not.toContain(r.id);
    expect(await leerLlavePorToken(r.token)).toMatchObject({ estado: "esperando_llave", venceEn: venceDe(nuevoDesde) });
    expect(await entregarLlavePorToken(r.token, "3001234567")).toBe("entregada");
    expect(await reabrirReembolso(sesionAdmin, r.id)).toBe("no_cerrado");
  });

  it("reenviar el enlace sin reabrir (la función de la base para HU-026): un doble clic anota un solo reenvío, que sale con el mismo enlace y el mismo plazo", async () => {
    const r = await esperando();
    await procesarHasta((await pedidoDe(r.id, "pedido")).id);
    const { plazo_llave_desde } = await reembolsoEnBd(r.id);

    expect(exito(await sesionMonitor.rpc("reenviar_pedido_llave", { p_id_reembolso: r.id }), "el monitor reenvía")).toBe("sin_permiso");
    expect(exito(await sesionAdmin.rpc("reenviar_pedido_llave", { p_id_reembolso: r.id }), "reenviar")).toBe("reenviado");
    expect(exito(await sesionAdmin.rpc("reenviar_pedido_llave", { p_id_reembolso: r.id }), "reenviar otra vez")).toBe("reenviado");
    const reenvio = await pedidoDe(r.id, "reenvio");
    expect(new Date(reenvio.plazo_desde).getTime()).toBe(new Date(plazo_llave_desde).getTime());
    await procesarHasta(reenvio.id);

    const recibidos = await correosA(r.contacto);
    expect(recibidos).toHaveLength(2);
    for (const correo of recibidos) {
      expect(correo.Text).toContain(rutaDeLlave(r.token));
      expect(correo.Text).toContain(`Tienes hasta el ${formatearFechaHora(venceDe(plazo_llave_desde))} para enviarla.`);
    }
    expect((await reembolsoEnBd(r.id)).plazo_llave_desde).toBe(plazo_llave_desde);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// El reintento (HU-065) y la bandeja de salida
// ---------------------------------------------------------------------------------------------------------------

describe("el reintento (HU-065) reconstruye el correo desde el pedido anotado", () => {
  it("reconstruir da siempre lo mismo y el mapa lo usa; con el proveedor caído queda fallido y el reintento lo manda una sola vez con el mismo enlace y la misma fecha", async () => {
    const r = await esperando();
    const p = await pedidoDe(r.id, "pedido");
    const { plazo_llave_desde } = await reembolsoEnBd(r.id);
    const soporte = correoConsultasDatos();

    const primera = await reconstruirPedidoDeLlave(p.id, fx.admin);
    expect(primera).toEqual({
      destinatario: r.contacto,
      datos: {
        nombre: r.nombrePagador,
        monto: PRECIO,
        motivo: r.motivo,
        enlace: expect.stringContaining(rutaDeLlave(r.token)),
        venceEn: venceDe(plazo_llave_desde).toISOString(),
        reporteAceptado: false,
        ...(soporte ? { contactoSoporte: soporte } : {}),
      },
    });
    // Determinismo: el reintento da el mismo cuerpo (si no, el proveedor respondería 409 por la misma clave).
    expect(await reconstruirPedidoDeLlave(p.id, fx.admin)).toEqual(primera);
    expect(await RECONSTRUCTORES.solicitud_llave_reembolso?.(p.id)).toEqual(primera);
    // Un pedido no es un recordatorio, y una entidad que no es un pedido no reconstruye nada.
    expect(await reconstruirRecordatorioDeLlave(p.id, fx.admin)).toBeNull();
    expect(await reconstruirPedidoDeLlave("no-es-un-uuid", fx.admin)).toBeNull();
    expect(await reconstruirPedidoDeLlave(randomUUID(), fx.admin)).toBeNull();

    const clave = claveDeCorreo("solicitud_llave_reembolso", p.id);
    vi.stubEnv("MAILPIT_URL", "http://127.0.0.1:1");
    const caida = await procesarPedidosDeLlave({ cliente: fx.admin });
    vi.unstubAllEnvs();
    expect(caida.fallidas).toBeGreaterThanOrEqual(1);
    expect(exito(await fx.admin.from("correo_envio").select("estado, reintentable").eq("clave", clave).single(), "leer el registro")).toEqual({
      estado: "fallido",
      reintentable: true,
    });
    expect((await pedido(p.id)).procesado_en).not.toBeNull();
    expect(await correosA(r.contacto)).toEqual([]);

    // El reintento toma los fallidos que llevan 2 minutos quietos: se corre con un "ahora" 3 minutos adelante.
    await reintentarCorreosFallidos({ cliente: fx.admin, reconstructores: RECONSTRUCTORES, enviar: enviarCorreoDesdeServidor, ahora: new Date(Date.now() + 3 * MINUTO) });

    expect(exito(await fx.admin.from("correo_envio").select("estado").eq("clave", clave).single(), "leer el registro").estado).toBe("enviado");
    const recibidos = await correosA(r.contacto);
    expect(recibidos).toHaveLength(1);
    expect(recibidos[0].Text).toContain(rutaDeLlave(r.token));
    expect(recibidos[0].Text).toContain(`Tienes hasta el ${formatearFechaHora(venceDe(plazo_llave_desde))} para enviarla.`);
  }, 60_000);

  it("si el caso se cerró antes del reintento, el reintento ya no lo manda", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await esperando();
    const p = await pedidoDe(r.id, "pedido");
    const clave = claveDeCorreo("solicitud_llave_reembolso", p.id);
    vi.stubEnv("MAILPIT_URL", "http://127.0.0.1:1");
    await procesarHasta(p.id);
    vi.unstubAllEnvs();
    expect(exito(await fx.admin.from("correo_envio").select("estado").eq("clave", clave).single(), "leer el registro").estado).toBe("fallido");

    await envejecer(r.id, (DIAS_PARA_ENTREGAR + 1) * 24 * 60);
    await vencer();
    expect(await reconstruirPedidoDeLlave(p.id, fx.admin)).toBeNull();
    await reintentarCorreosFallidos({ cliente: fx.admin, reconstructores: RECONSTRUCTORES, enviar: enviarCorreoDesdeServidor, ahora: new Date(Date.now() + 3 * MINUTO) });

    expect(exito(await fx.admin.from("correo_envio").select("estado, reintentable").eq("clave", clave).single(), "leer el registro")).toEqual({
      estado: "fallido",
      reintentable: false,
    });
    expect(await correosA(r.contacto)).toEqual([]);
  }, 60_000);

  it("sin registro de correos el pedido queda pendiente y suma un intento; al llegar al máximo se abandona", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await esperando();
    const p = await pedidoDe(r.id, "pedido");
    const sinRegistro = async () => ({ ok: false as const, motivo: "fallo_del_registro" as const, error: "sin conexión", intentos: 0 });

    const primera = await procesarPedidosDeLlave({ cliente: fx.admin, enviar: sinRegistro });
    expect(primera.conError).toBeGreaterThanOrEqual(1);
    expect(await pedido(p.id)).toEqual({ intentos: 1, procesado_en: null });

    for (let i = 1; i < MAXIMO_DE_INTENTOS; i++) await procesarPedidosDeLlave({ cliente: fx.admin, enviar: sinRegistro });
    const final = await pedido(p.id);
    expect(final.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(final.procesado_en).not.toBeNull();
    expect(await correosA(r.contacto)).toEqual([]);
  });
});

describe("la ruta /api/procesos/pedir-llaves", () => {
  it("sin el secreto del proceso programado, o con otro, responde 401 y no manda nada", async () => {
    const r = await esperando();
    const p = await pedidoDe(r.id, "pedido");
    vi.stubEnv("CRON_SECRETO", "");
    expect((await llamarRuta(`Bearer ${SECRETO}`)).status).toBe(401);
    vi.stubEnv("CRON_SECRETO", SECRETO);
    for (const encabezado of [undefined, "", `Bearer ${"0".repeat(SECRETO.length)}`, SECRETO]) {
      const respuesta = await llamarRuta(encabezado);
      expect(respuesta.status, String(encabezado)).toBe(401);
      expect(await respuesta.json()).toEqual({ error: "No autorizado." });
    }
    vi.unstubAllEnvs();
    expect((await pedido(p.id)).procesado_en).toBeNull();
    expect(await registroDe("solicitud_llave_reembolso", p.id)).toBeNull();
  });
});
