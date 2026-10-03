import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/procesos/avisar-cancelaciones/route";
import { revisarPago } from "@/lib/admin/pagos";
import { cancelarCitaPorToken, cancelarMiCita, procesarCancelacionesDeCita, reconstruirCancelacionCita } from "@/lib/citas/cancelar";
import { rutaDeCita } from "@/lib/citas/reglas";
import { MAXIMO_DE_INTENTOS } from "@/lib/citas/servidor";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { reintentarCorreosFallidos } from "@/lib/correo/reintentos";
import { enviarCorreoDesdeServidor } from "@/lib/correo/servidor";
import { diaDelNegocio, formatearFechaHora } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";
import { diaIsoDeFecha } from "@/lib/plazos/motor";
import { MOTIVO_CANCELACION_A_TIEMPO, rutaDeLlave, TEXTO_PAGO_EN_REVISION_AL_CANCELAR } from "@/lib/reembolsos/reglas";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente } from "./utilidades";

/**
 * HU-024 contra el Supabase local: el Lead cancela su individual confirmada hasta 12 h antes, con el enlace del correo de
 * confirmación (`cancelarCitaPorToken`, con la llave secreta) o con su sesión (`cancelarMiCita`, sin ella). La base decide
 * todo en `privado.cancelar_cita`: la cita pasa a `cancelada` por `estudiante`, la fecha queda libre, cada pago aprobado
 * recibe su reembolso en `esperando_llave` (al primer admin activo, o sin admin, D-28) con su `solicitud_llave`, y se
 * anota el correo de cancelación (D-27). `procesarCancelacionesDeCita` (el mismo código de la ruta
 * `/api/procesos/avisar-cancelaciones`) lo manda por Mailpit. En local no hay configuración en Vault, así que la base no
 * llama a la app: la prueba llama el proceso.
 *
 * Cada cita se crea `pendiente_pago` y se confirma con un UPDATE, como en `integracion/citas.test.ts` (así el trigger de
 * HU-019 le anota su token). Los datos son de la prueba y los borra ella: los reembolsos que crea la cancelación los borra
 * `limpiar()` junto con los pagos; el registro de correos y los buzones de Mailpit, esta prueba. La corrida del proceso
 * toma cualquier cancelación pendiente de la base (lotes de 10): se repite hasta que la de la prueba queda procesada, y cada
 * prueba deja procesadas las suyas.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MINUTO = 60_000;
const PRECIO = 25_000;
/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;
const MOTIVO_DE_OTRO_CONTACTO = "Le escribimos a quien pagó, a su correo, para pedirle la llave y devolverle el dinero.";

type Lead = Awaited<ReturnType<Fixtures["crearLeadDeSesion"]>>;
type Contexto = Awaited<ReturnType<Fixtures["crearContextoDeMonitoria"]>>;

let fx: Fixtures;
let bd: pg.Client;
let mailpit: string;
let e: Awaited<ReturnType<typeof construirEscenario>>;
let sesionMonitor: Cliente;
/** La sesión del admin del escenario: el que tiene asignados los pagos de la prueba y los revisa (HU-020). */
let sesionAdmin: Cliente;
/** La sesión anónima que es Lead (la que agendó) y otra sin Lead. */
let ancla: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
let leadDeAncla: Lead;
let otra: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
const monitorias: string[] = [];
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
    sesionMonitor = await fx.iniciarSesion(e.monitor);
    sesionAdmin = await fx.iniciarSesion(e.admin);
    ancla = await fx.crearAnonimo();
    leadDeAncla = await fx.crearLeadDeSesion(ancla.id);
    correos.add(leadDeAncla.correo!);
    otra = await fx.crearAnonimo();
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
  if (monitorias.length) {
    const ahora = new Date().toISOString();
    await fx.admin.from("cancelacion_cita").update({ procesado_en: ahora }).in("id_monitoria", monitorias).is("procesado_en", null);
    await fx.admin.from("confirmacion_cita").update({ procesado_en: ahora }).in("id_monitoria", monitorias).is("procesado_en", null);
  }
});

afterAll(async () => {
  for (const correo of correos) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(() => undefined);
  }
  if (fx) {
    if (monitorias.length) {
      await fx.admin.from("correo_envio").delete().in("clave", monitorias.map((id) => claveDeCorreo("cancelacion_cita", id)));
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

/**
 * El primer lunes a ocho semanas o más de hoy en Bogotá, más `semanasExtra` semanas: lejos de las fechas de
 * `citas.test.ts` (cuatro semanas) para que ninguna cita se pise con otra aunque una limpieza falle.
 */
function lunesLejano(semanasExtra = 0): string {
  let fecha = sumarDias(diaDelNegocio(new Date()), 56 + semanasExtra * 7);
  while (diaIsoDeFecha(fecha) !== 1) fecha = sumarDias(fecha, 1);
  return fecha;
}

/** El lunes más reciente que ya pasó (a las 10:00 de Bogotá la sesión ya terminó). */
function lunesPasado(): string {
  let fecha = sumarDias(diaDelNegocio(new Date()), -7);
  while (diaIsoDeFecha(fecha) !== 1) fecha = sumarDias(fecha, -1);
  return fecha;
}

/** El instante de inicio de una fecha a las 10:00 de Bogotá (UTC-5, sin horario de verano). */
const inicioDe = (fecha: string) => new Date(`${fecha}T15:00:00Z`);

async function construirEscenario() {
  const admin = await fx.crearAdmin();
  const { materia } = await fx.crearEvaluacion();
  // Con monitor_privado: su correo existe, y no debe aparecer en nada que reciba el Lead (P-37).
  const monitor = await fx.crearMonitor({ conContacto: true });
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
  const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: 1, hora: "10:00:00" });
  const lead = await fx.crearLead();
  correos.add(lead.correo!);
  return { admin, materia, monitor, lead, franja, contexto: { materia, monitor, franja, lead } as Contexto };
}

let semana = 0;

/** Una individual `pendiente_pago` de la franja del lunes, cada una en una semana distinta. */
async function pendiente(opciones: { contexto?: Contexto; fecha?: string } = {}) {
  const monitoria = await fx.crearMonitoria(opciones.contexto ?? e.contexto, {
    fecha: opciones.fecha ?? lunesLejano(semana++),
    estado: "pendiente_pago",
  });
  monitorias.push(monitoria.id);
  return monitoria;
}

/** Lo que hace `registrar_pago` (HU-018) en la misma transacción: confirmar con un UPDATE de `estado`. */
async function confirmar(id: string) {
  exito(await fx.admin.from("monitoria").update({ estado: "confirmada" }).eq("id", id).select().single(), "confirmar la monitoría");
}

/** Una individual que ya pasó de `pendiente_pago` a `confirmada`, con su token de confirmación anotado. */
async function confirmada(opciones: { contexto?: Contexto; fecha?: string } = {}) {
  const monitoria = await pendiente(opciones);
  await confirmar(monitoria.id);
  return monitoria;
}

async function tokenDe(idMonitoria: string): Promise<string> {
  const filas = exito(await fx.admin.from("confirmacion_cita").select("token").eq("id_monitoria", idMonitoria), "leer la confirmación");
  if (!filas[0]) throw new Error(`La monitoría ${idMonitoria} no tiene confirmación anotada.`);
  return filas[0].token;
}

/** Un pago de la monitoría; `contacto` es el correo de quien pagó (por defecto, uno que no es el del Lead). */
async function pagoDe(idMonitoria: string, estado: "en_revision" | "aprobado" | "rechazado", contacto?: string) {
  const pago = await fx.crearPagoDe(idMonitoria, { idAdmin: e.admin.id, estado });
  if (contacto) {
    exito(await fx.admin.from("pago").update({ contacto }).eq("id", pago.id).select().single(), "poner el contacto del pago");
  }
  return pago;
}

async function estadoDe(idMonitoria: string) {
  return exito(await fx.admin.from("monitoria").select("estado, motivo_cancelacion").eq("id", idMonitoria).single(), "leer la monitoría");
}

async function reembolsosDe(idMonitoria: string) {
  const pagos = exito(await fx.admin.from("pago").select("id").eq("id_monitoria", idMonitoria), "leer los pagos");
  if (!pagos.length) return [];
  return exito(
    await fx.admin
      .from("reembolso")
      .select("id, id_pago, id_admin, monto, motivo, estado, llave_destino")
      .in("id_pago", pagos.map((p) => p.id))
      .order("fecha_generacion")
      .order("id"),
    "leer los reembolsos",
  );
}

async function solicitudDe(idReembolso: string) {
  return exito(
    await fx.admin.from("solicitud_llave").select("token, en_correo_de_cancelacion").eq("id_reembolso", idReembolso).single(),
    "leer la solicitud de llave",
  );
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

async function registroDe(idMonitoria: string) {
  const filas = exito(
    await fx.admin.from("correo_envio").select("estado, destinatario, plantilla").eq("clave", claveDeCorreo("cancelacion_cita", idMonitoria)),
    "leer el registro de correos",
  );
  return filas[0] ?? null;
}

/** El primer admin activo de la base (el turno de D-26): puede ser uno de la semilla o el de la prueba. */
async function primerAdminActivo(): Promise<string | null> {
  const { rows } = await bd.query<{ id: string | null }>("select privado.siguiente_admin_activo() as id");
  return rows[0].id;
}

type Mensaje = { Subject: string; Text: string; HTML: string };

async function correosA(correo: string): Promise<Mensaje[]> {
  correos.add(correo);
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

/** Corre el proceso hasta que la cancelación de esa monitoría queda procesada (puede haber otras pendientes en la base). */
async function procesarHasta(idMonitoria: string) {
  for (let i = 0; i < 10; i++) {
    await procesarCancelacionesDeCita({ cliente: fx.admin });
    const cancelacion = await cancelacionDe(idMonitoria);
    if (!cancelacion || cancelacion.procesado_en !== null) return;
  }
  throw new Error(`La cancelación de la monitoría ${idMonitoria} no se procesó tras 10 corridas.`);
}

/** El correo de cancelación de una cita: el que lleva ese texto (un enlace único de la prueba). */
async function correoCon(destino: string, enlace: string): Promise<Mensaje | undefined> {
  return (await correosA(destino)).find((c) => c.Text.includes(enlace));
}

// ---------------------------------------------------------------------------------------------------------------
// Con `pg`: dos conexiones a la vez (la cancelación y la revisión del pago), como en `integracion/revisar-pagos.test.ts`

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

/** Dentro de una transacción de `cliente`: lo que sigue corre con el rol `authenticated` y el token del admin del escenario. */
async function comoAdmin(cliente: pg.Client) {
  await cliente.query("set local role authenticated");
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: e.admin.id, role: "authenticated" })]);
}

/** El corazón de la cancelación, que nadie ejecuta desde la Data API (la prueba lo corre como dueño de la base). */
async function cancelarEn(cliente: pg.Client, idMonitoria: string) {
  const { rows } = await cliente.query<{ r: string }>("select privado.cancelar_cita($1::uuid, now()) as r", [idMonitoria]);
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

// ---------------------------------------------------------------------------------------------------------------
// Criterio 1: cancelar y la fecha queda libre
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: cancelar con el enlace del correo (token, llave secreta)", () => {
  it("la cita pasa a cancelada por el estudiante y la fecha queda libre; repetirlo da ya_cancelada y no cambia nada", async () => {
    const monitoria = await confirmada();
    const token = await tokenDe(monitoria.id);

    // Mientras está confirmada, la fecha está ocupada (el índice de fechas activas).
    await expect(fx.crearMonitoria(e.contexto, { fecha: monitoria.fecha, estado: "pendiente_pago" })).rejects.toThrow(/insertar monitoria/);

    expect(await cancelarCitaPorToken(token)).toBe("cancelada");
    expect(await estadoDe(monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    expect(await cancelacionDe(monitoria.id)).toMatchObject({ procesado_en: null, intentos: 0, con_pago_en_revision: false, reembolso_a_otro_contacto: false });

    // Un doble clic o el mismo enlace en otra pestaña: no pasa nada más, ni una segunda cancelación anotada.
    expect(await cancelarCitaPorToken(token)).toBe("ya_cancelada");
    expect(await estadoDe(monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    expect(exito(await fx.admin.from("cancelacion_cita").select("id").eq("id_monitoria", monitoria.id), "leer")).toHaveLength(1);

    // La fecha quedó libre: otra persona puede reservarla.
    const libre = await fx.crearMonitoria(e.contexto, { fecha: monitoria.fecha, estado: "pendiente_pago" });
    monitorias.push(libre.id);
    expect((await estadoDe(libre.id)).estado).toBe("pendiente_pago");
  });

  it("un token inventado, vacío o con forma inválida es no_existe y no toca ninguna cita", async () => {
    const monitoria = await confirmada();
    const real = await tokenDe(monitoria.id);
    const casiReal = `${real.slice(0, 63)}${real.endsWith("0") ? "1" : "0"}`;

    for (const malo of [randomBytes(32).toString("hex"), "", "abc", real.toUpperCase(), ` ${real}`, casiReal, "' or 1=1 --"]) {
      expect(await cancelarCitaPorToken(malo), JSON.stringify(malo)).toBe("no_existe");
    }
    expect((await estadoDe(monitoria.id)).estado).toBe("confirmada");
    expect(await cancelacionDe(monitoria.id)).toBeNull();
  });
});

describe("criterio 1: cancelar con la sesión del Lead (sin llave secreta)", () => {
  it("la sesión del Lead que agendó la cancela; otra sesión, el monitor y un admin reciben no_existe y la cita sigue confirmada", async () => {
    const monitoria = await confirmada({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    const admin = await fx.iniciarSesion(e.admin);

    for (const [quien, cliente] of [
      ["otra sesión", otra.cliente],
      ["el monitor", sesionMonitor],
      ["un admin", admin],
    ] as const) {
      expect(await cancelarMiCita(cliente, monitoria.id), quien).toBe("no_existe");
    }
    expect(await cancelarMiCita(ancla.cliente, "00000000-0000-4000-8000-000000000000")).toBe("no_existe");
    expect(await cancelarMiCita(ancla.cliente, "no-es-un-uuid")).toBe("no_existe");
    expect((await estadoDe(monitoria.id)).estado).toBe("confirmada");
    expect(await cancelacionDe(monitoria.id)).toBeNull();

    expect(await cancelarMiCita(ancla.cliente, monitoria.id)).toBe("cancelada");
    expect(await estadoDe(monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    // El doble clic.
    expect(await cancelarMiCita(ancla.cliente, monitoria.id)).toBe("ya_cancelada");
    expect(exito(await fx.admin.from("cancelacion_cita").select("id").eq("id_monitoria", monitoria.id), "leer")).toHaveLength(1);
  });

  it("sin sesión (anon) la base ni la ejecuta; con sesión no se llama la puerta del token, y la llave secreta no llama la de la sesión", async () => {
    const monitoria = await confirmada({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    const token = await tokenDe(monitoria.id);
    const anonimo = crearCliente();

    await expect(cancelarMiCita(anonimo, monitoria.id)).rejects.toThrow(/No se pudo cancelar la cita/);
    expect((await anonimo.rpc("cancelar_cita_por_token", { p_token: token })).error).not.toBeNull();
    expect((await ancla.cliente.rpc("cancelar_cita_por_token", { p_token: token })).error).not.toBeNull();
    expect((await fx.admin.rpc("cancelar_mi_cita", { p_id_monitoria: monitoria.id })).error).not.toBeNull();
    // El corazón no lo ejecuta nadie desde la Data API (vive en privado).
    expect((await ancla.cliente.rpc("cancelar_cita" as never, { p_id_monitoria: monitoria.id, p_ahora: new Date().toISOString() } as never)).error).not.toBeNull();
    expect((await estadoDe(monitoria.id)).estado).toBe("confirmada");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 3 y lo que no se cancela
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 3: pasó el plazo, y lo que no se puede cancelar", () => {
  it("una cita que ya empezó o terminó da fuera_de_plazo por las dos puertas: sigue confirmada, sin reembolso y sin correo", async () => {
    const monitoria = await confirmada({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto, fecha: lunesPasado() });
    await pagoDe(monitoria.id, "aprobado");
    const token = await tokenDe(monitoria.id);

    expect(await cancelarCitaPorToken(token)).toBe("fuera_de_plazo");
    expect(await cancelarMiCita(ancla.cliente, monitoria.id)).toBe("fuera_de_plazo");

    expect((await estadoDe(monitoria.id)).estado).toBe("confirmada");
    expect(await reembolsosDe(monitoria.id)).toEqual([]);
    expect(await cancelacionDe(monitoria.id)).toBeNull();
  });

  it("una cita que empieza en menos de 12 horas (RN-60) tampoco se cancela; una que empieza en 14 horas sí", async () => {
    // Un monitor y una franja propios: la hora de inicio depende del reloj de la prueba (unas 6 h adelante, y 14 h adelante).
    const monitorProximo = await fx.crearMonitor();
    await fx.crearCertificado({ idMonitor: monitorProximo.id, idMateria: e.materia.id, idAdmin: e.admin.id });
    const fechaYHora = (horas: number) => {
      const inicio = new Date(Math.floor((Date.now() + horas * 60 * MINUTO) / 1000) * 1000);
      const fecha = diaDelNegocio(inicio);
      const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(inicio);
      const minutosDelDia = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
      return { fecha, hora, duracionMin: Math.min(30, 24 * 60 - minutosDelDia) };
    };
    const cita = async (horas: number) => {
      const { fecha, hora, duracionMin } = fechaYHora(horas);
      const franja = await fx.crearFranja({ idMonitor: monitorProximo.id, dia: diaIsoDeFecha(fecha), hora, duracionMin });
      return confirmada({ contexto: { ...e.contexto, monitor: monitorProximo, franja } as Contexto, fecha });
    };

    const cerca = await cita(6);
    expect(await cancelarCitaPorToken(await tokenDe(cerca.id))).toBe("fuera_de_plazo");
    expect((await estadoDe(cerca.id)).estado).toBe("confirmada");

    const lejos = await cita(14);
    expect(await cancelarCitaPorToken(await tokenDe(lejos.id))).toBe("cancelada");
  });

  it("una por pagar o una cancelada por otro motivo es no_cancelable (D-29); una grupal, no_individual; nada cambia", async () => {
    const porPagar = await pendiente({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    expect(await cancelarMiCita(ancla.cliente, porPagar.id)).toBe("no_cancelable");
    expect((await estadoDe(porPagar.id)).estado).toBe("pendiente_pago");

    const rechazada = await confirmada({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    exito(await fx.admin.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" }).eq("id", rechazada.id).select().single(), "cancelar");
    expect(await cancelarMiCita(ancla.cliente, rechazada.id)).toBe("no_cancelable");
    expect(await estadoDe(rechazada.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });

    const grupal = await confirmada({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: grupal.id, cupos: 3, modalidad_pago: "unico", precio_por_persona: 10_000 }).select().single(),
      "insertar monitoria_grupal",
    );
    expect(await cancelarMiCita(ancla.cliente, grupal.id)).toBe("no_individual");
    expect((await estadoDe(grupal.id)).estado).toBe("confirmada");
    expect(await cancelacionDe(grupal.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 2: reembolsos
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 2: un reembolso por cada pago aprobado, asignado y con su solicitud de llave", () => {
  it("crea el reembolso (monto completo, motivo exacto, esperando la llave) al primer admin activo; ninguno por rechazados ni en revisión; la solicitud lleva un token de 256 bits", async () => {
    const monitoria = await confirmada({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    const grande = await pagoDe(monitoria.id, "aprobado", leadDeAncla.correo!);
    const chico = await fx.crearPagoDe(monitoria.id, { idAdmin: e.admin.id, estado: "aprobado", monto: 8_000 });
    const enRevision = await pagoDe(monitoria.id, "en_revision");
    const rechazado = await pagoDe(monitoria.id, "rechazado");
    const turno = await primerAdminActivo();
    expect(turno, "debe haber al menos un admin activo (el de la prueba)").not.toBeNull();

    expect(await cancelarMiCita(ancla.cliente, monitoria.id)).toBe("cancelada");

    const reembolsos = await reembolsosDe(monitoria.id);
    expect(reembolsos).toHaveLength(2);
    expect(reembolsos.map((r) => r.id_pago).sort()).toEqual([grande.id, chico.id].sort());
    for (const r of reembolsos) {
      expect(r).toMatchObject({ motivo: MOTIVO_CANCELACION_A_TIEMPO, estado: "esperando_llave", llave_destino: null, id_admin: turno });
      expect(r.monto).toBe(r.id_pago === grande.id ? PRECIO : 8_000);
    }
    expect(reembolsos.map((r) => r.id_pago)).not.toContain(enRevision.id);
    expect(reembolsos.map((r) => r.id_pago)).not.toContain(rechazado.id);

    const solicitudes = await Promise.all(reembolsos.map((r) => solicitudDe(r.id)));
    for (const s of solicitudes) expect(s.token).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(solicitudes.map((s) => s.token)).size).toBe(2);
    // Solo el pago hecho desde el correo del Lead entra al correo de cancelación (D-27); el otro lo pide HU-025.
    expect(await Promise.all(reembolsos.map(async (r) => [r.id_pago, (await solicitudDe(r.id)).en_correo_de_cancelacion]))).toEqual(
      expect.arrayContaining([
        [grande.id, true],
        [chico.id, false],
      ]),
    );
    // La foto anotada: había un pago en revisión y un reembolso a otro contacto.
    expect(await cancelacionDe(monitoria.id)).toMatchObject({
      correo_destino: leadDeAncla.correo,
      con_pago_en_revision: true,
      reembolso_a_otro_contacto: true,
    });
    // Los pagos no cambian de estado.
    expect(exito(await fx.admin.from("pago").select("id, estado").eq("id_monitoria", monitoria.id), "leer los pagos").map((p) => p.estado).sort()).toEqual([
      "aprobado",
      "aprobado",
      "en_revision",
      "rechazado",
    ]);
  });

  it("repetir la cancelación no duplica reembolsos ni solicitudes", async () => {
    const monitoria = await confirmada();
    await pagoDe(monitoria.id, "aprobado", e.lead.correo!);

    expect(await cancelarCitaPorToken(await tokenDe(monitoria.id))).toBe("cancelada");
    const [primero] = await reembolsosDe(monitoria.id);
    const solicitud = await solicitudDe(primero.id);
    expect(await cancelarCitaPorToken(await tokenDe(monitoria.id))).toBe("ya_cancelada");

    expect(await reembolsosDe(monitoria.id)).toEqual([primero]);
    expect(await solicitudDe(primero.id)).toEqual(solicitud);
  });

  it("service_role lee las llaves del correo (monto y token), con los datos de la cancelación; no son visibles para una sesión", async () => {
    const monitoria = await confirmada({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    await pagoDe(monitoria.id, "aprobado", leadDeAncla.correo!);
    expect(await cancelarMiCita(ancla.cliente, monitoria.id)).toBe("cancelada");
    const [reembolso] = await reembolsosDe(monitoria.id);
    const { token } = await solicitudDe(reembolso.id);

    expect((await fx.admin.rpc("llaves_de_cancelacion", { p_id_monitoria: monitoria.id })).data).toEqual([
      { id_reembolso: reembolso.id, monto: PRECIO, token },
    ]);
    const datos = exito(await fx.admin.rpc("datos_de_cancelacion_cita", { p_id_monitoria: monitoria.id }), "datos de la cancelación");
    expect(datos).toHaveLength(1);
    expect(datos[0]).toMatchObject({ correo_destino: leadDeAncla.correo, estado: "cancelada", motivo_cancelacion: "estudiante", grupal: false });

    for (const [quien, cliente] of [
      ["el Lead", ancla.cliente],
      ["otra sesión", otra.cliente],
      ["el monitor", sesionMonitor],
      ["anon", crearCliente()],
    ] as const) {
      expect((await cliente.rpc("llaves_de_cancelacion", { p_id_monitoria: monitoria.id })).error, `${quien}: llaves_de_cancelacion`).not.toBeNull();
      expect((await cliente.rpc("datos_de_cancelacion_cita", { p_id_monitoria: monitoria.id })).error, `${quien}: datos_de_cancelacion_cita`).not.toBeNull();
      expect((await cliente.from("solicitud_llave").select("token")).error, `${quien}: solicitud_llave`).not.toBeNull();
      expect((await cliente.from("cancelacion_cita").select("id")).error, `${quien}: cancelacion_cita`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// El correo de cancelación (D-27)
// ---------------------------------------------------------------------------------------------------------------

describe("D-27: el correo de cancelación sale una sola vez, con el enlace de la llave o con la explicación", () => {
  it("con un pago aprobado del correo del Lead: pide la llave con /reembolso?token=<el del reembolso>; no repite en otra corrida; sin comisión ni contacto del monitor", async () => {
    const monitoria = await confirmada();
    await pagoDe(monitoria.id, "aprobado", e.lead.correo!);
    const antes = (await correosA(e.lead.correo!)).length;

    expect(await cancelarCitaPorToken(await tokenDe(monitoria.id))).toBe("cancelada");
    const [reembolso] = await reembolsosDe(monitoria.id);
    const { token } = await solicitudDe(reembolso.id);

    const resumen = await procesarCancelacionesDeCita({ cliente: fx.admin });
    expect(resumen.enviadas).toBeGreaterThanOrEqual(1);
    expect(resumen.conError).toBe(0);
    await procesarHasta(monitoria.id);

    const despues = await correosA(e.lead.correo!);
    expect(despues).toHaveLength(antes + 1);
    const correo = despues.find((c) => c.Text.includes(rutaDeLlave(token)));
    expect(correo, "debía llegar el correo de cancelación con el enlace de la llave de este reembolso").toBeDefined();
    expect(correo!.Subject).toBe(`Cancelaste tu monitoría de ${e.materia.nombre}`);

    const texto = correo!.Text;
    expect(texto).toContain("Tu monitoría quedó cancelada");
    expect(texto).toContain(`Hola, ${e.lead.nombre}.`);
    // La fecha termina en «a. m.»: la plantilla no le suma otro punto, así que se mira por partes.
    expect(texto).toContain(`Cancelaste tu monitoría de ${e.materia.nombre} del ${formatearFechaHora(inicioDe(monitoria.fecha))}`);
    expect(texto).toContain("La fecha quedó libre.");
    expect(texto).toContain(`Vamos a devolverte ${formatearPesos(PRECIO)}.`);
    // El enlace de la llave, con el token guardado: en el texto y en el botón «Enviar mi llave».
    expect(texto).toContain(rutaDeLlave(token));
    expect(correo!.HTML).toContain(`href="${new URL(rutaDeLlave(token), process.env.SITIO_URL ?? "http://localhost:3000").href}"`);
    expect(correo!.HTML).toContain("Enviar mi llave");
    expect(texto).not.toContain(MOTIVO_DE_OTRO_CONTACTO);
    expect(texto).not.toContain(TEXTO_PAGO_EN_REVISION_AL_CANCELAR);
    // P-37 y D-6: el contacto del monitor y la comisión no salen.
    expect(texto).not.toContain(e.monitor.correo);
    expect(correo!.HTML).not.toContain(e.monitor.correo);
    expect(texto.toLowerCase()).not.toContain("comisi");

    // El registro de correos lleva la clave `cancelacion_cita:<id>`; la cancelación queda procesada.
    expect(await registroDe(monitoria.id)).toEqual({ estado: "enviado", destinatario: e.lead.correo, plantilla: "cancelacion_cita" });
    expect((await cancelacionDe(monitoria.id))!.procesado_en).not.toBeNull();

    // Otra corrida no lo manda otra vez.
    await procesarCancelacionesDeCita({ cliente: fx.admin });
    expect(await correosA(e.lead.correo!)).toHaveLength(antes + 1);
  });

  it("con el pago todavía en revisión (P-07): no hay reembolso que pedir y el correo dice que la llave se pide solo si se aprueba, con el enlace «Ver mi cita»", async () => {
    const monitoria = await confirmada();
    const tokenDeCita = await tokenDe(monitoria.id);
    await pagoDe(monitoria.id, "en_revision", e.lead.correo!);

    expect(await cancelarCitaPorToken(tokenDeCita)).toBe("cancelada");
    expect(await reembolsosDe(monitoria.id)).toEqual([]);
    expect(await cancelacionDe(monitoria.id)).toMatchObject({ con_pago_en_revision: true, reembolso_a_otro_contacto: false });
    await procesarHasta(monitoria.id);

    const correo = await correoCon(e.lead.correo!, rutaDeCita(tokenDeCita));
    expect(correo, "debía llegar el correo de cancelación con el enlace de la cita").toBeDefined();
    expect(correo!.Subject).toBe(`Cancelaste tu monitoría de ${e.materia.nombre}`);
    expect(correo!.Text).toContain(TEXTO_PAGO_EN_REVISION_AL_CANCELAR);
    expect(correo!.Text).not.toContain("/reembolso?token=");
    expect(correo!.Text).not.toContain("Vamos a devolverte");
    expect(correo!.HTML).toContain("Ver mi cita");
    expect(await registroDe(monitoria.id)).toEqual({ estado: "enviado", destinatario: e.lead.correo, plantilla: "cancelacion_cita" });
  });

  it("sin ningún pago el correo solo confirma la cancelación: ni llave ni texto de pago en revisión", async () => {
    const monitoria = await confirmada();
    const tokenDeCita = await tokenDe(monitoria.id);
    expect(await cancelarCitaPorToken(tokenDeCita)).toBe("cancelada");
    await procesarHasta(monitoria.id);

    const correo = await correoCon(e.lead.correo!, rutaDeCita(tokenDeCita));
    expect(correo).toBeDefined();
    expect(correo!.Text).not.toContain("/reembolso?token=");
    expect(correo!.Text).not.toContain(TEXTO_PAGO_EN_REVISION_AL_CANCELAR);
    expect(correo!.Text).toContain("Puedes agendar otra monitoría cuando quieras.");
  });

  it("con el pago de otro contacto: el correo no pide esa llave (la pide HU-025) y lo dice; la solicitud queda sin marcar", async () => {
    const monitoria = await confirmada();
    const tokenDeCita = await tokenDe(monitoria.id);
    const otroCorreo = `pagador-${randomBytes(6).toString("hex")}@calibra.test`;
    await pagoDe(monitoria.id, "aprobado", otroCorreo);

    expect(await cancelarCitaPorToken(tokenDeCita)).toBe("cancelada");
    const [reembolso] = await reembolsosDe(monitoria.id);
    const solicitud = await solicitudDe(reembolso.id);
    expect(solicitud.en_correo_de_cancelacion).toBe(false);
    expect(await cancelacionDe(monitoria.id)).toMatchObject({ correo_destino: e.lead.correo, reembolso_a_otro_contacto: true });
    expect((await fx.admin.rpc("llaves_de_cancelacion", { p_id_monitoria: monitoria.id })).data).toEqual([]);
    await procesarHasta(monitoria.id);

    const correo = await correoCon(e.lead.correo!, rutaDeCita(tokenDeCita));
    expect(correo, "debía llegar el correo al Lead, con el enlace de la cita").toBeDefined();
    expect(correo!.Text).toContain(MOTIVO_DE_OTRO_CONTACTO);
    expect(correo!.Text).not.toContain(rutaDeLlave(solicitud.token));
    expect(correo!.Text).not.toContain("/reembolso?token=");
    expect(correo!.Text).not.toContain("Vamos a devolverte");
    // No sale copia al otro contacto desde HU-024: ese pedido lo manda HU-025.
    expect(await correosA(otroCorreo)).toEqual([]);
    expect(await registroDe(monitoria.id)).toEqual({ estado: "enviado", destinatario: e.lead.correo, plantilla: "cancelacion_cita" });
  });

  it("D-19: si el Lead no tiene correo, sale al contacto del primer pago; sin correo ni pago no hay a quién escribirle y se descarta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const leadSinCorreo = await fx.crearLead();
    exito(await fx.admin.from("lead").update({ correo: null, numero_telefono: "3001234567" }).eq("id", leadSinCorreo.id).select().single(), "dejar al Lead solo con teléfono");
    const contexto = { ...e.contexto, lead: { ...leadSinCorreo, correo: null } } as Contexto;
    const primero = `primer-pago-${randomBytes(6).toString("hex")}@calibra.test`;

    const monitoria = await confirmada({ contexto });
    await pagoDe(monitoria.id, "aprobado", primero);
    expect(await cancelarCitaPorToken(await tokenDe(monitoria.id))).toBe("cancelada");
    expect(await cancelacionDe(monitoria.id)).toMatchObject({ correo_destino: primero, reembolso_a_otro_contacto: false });
    const [reembolso] = await reembolsosDe(monitoria.id);
    const { token } = await solicitudDe(reembolso.id);
    await procesarHasta(monitoria.id);

    const delPrimero = await correosA(primero);
    expect(delPrimero).toHaveLength(1);
    expect(delPrimero[0].Text).toContain(rutaDeLlave(token));
    expect(await registroDe(monitoria.id)).toEqual({ estado: "enviado", destinatario: primero, plantilla: "cancelacion_cita" });

    // Sin correo y sin pago: la cancelación vale, pero no hay a quién escribirle.
    const sinNadie = await confirmada({ contexto });
    expect(await cancelarCitaPorToken(await tokenDe(sinNadie.id))).toBe("cancelada");
    expect(await reconstruirCancelacionCita(sinNadie.id, fx.admin)).toBeNull();
    await procesarHasta(sinNadie.id);
    expect(await registroDe(sinNadie.id)).toBeNull();
    expect((await cancelacionDe(sinNadie.id))!.procesado_en).not.toBeNull();
  });

  it("dos corridas a la vez sobre la misma cancelación mandan un solo correo", async () => {
    const monitoria = await confirmada();
    const tokenDeCita = await tokenDe(monitoria.id);
    expect(await cancelarCitaPorToken(tokenDeCita)).toBe("cancelada");

    await Promise.all([procesarCancelacionesDeCita({ cliente: fx.admin }), procesarCancelacionesDeCita({ cliente: fx.admin })]);
    await procesarHasta(monitoria.id);

    expect((await correosA(e.lead.correo!)).filter((c) => c.Text.includes(rutaDeCita(tokenDeCita)))).toHaveLength(1);
    expect((await registroDe(monitoria.id))?.estado).toBe("enviado");
  });
});

describe("el reintento (HU-065) reconstruye el correo desde lo anotado al cancelar", () => {
  it("reconstruirCancelacionCita da siempre los mismos datos; el mapa de reconstructores lo usa; después cambiar el Lead no cambia el correo", async () => {
    const monitoria = await confirmada();
    const tokenDeCita = await tokenDe(monitoria.id);
    await pagoDe(monitoria.id, "aprobado", e.lead.correo!);
    expect(await cancelarCitaPorToken(tokenDeCita)).toBe("cancelada");
    const [reembolso] = await reembolsosDe(monitoria.id);
    const { token } = await solicitudDe(reembolso.id);

    const primera = await reconstruirCancelacionCita(monitoria.id, fx.admin);

    expect(primera?.destinatario).toBe(e.lead.correo);
    expect(primera?.datos).toEqual({
      nombre: e.lead.nombre,
      materia: e.materia.nombre,
      inicio: inicioDe(monitoria.fecha).toISOString(),
      reembolsos: [{ monto: PRECIO, enlace: expect.stringContaining(rutaDeLlave(token)) }],
      conPagoEnRevision: false,
      reembolsoAOtroContacto: false,
      enlaceCita: expect.stringContaining(rutaDeCita(tokenDeCita)),
    });
    // Determinismo: el reintento da el mismo cuerpo (si no, el proveedor respondería 409 por la misma clave).
    expect(await reconstruirCancelacionCita(monitoria.id, fx.admin)).toEqual(primera);
    const reconstructor = RECONSTRUCTORES.cancelacion_cita;
    expect(typeof reconstructor).toBe("function");
    expect(await reconstructor?.(monitoria.id)).toEqual(primera);

    // La foto no cambia aunque después cambie el correo del Lead.
    exito(await fx.admin.from("lead").update({ correo: `otro-${randomBytes(6).toString("hex")}@calibra.test` }).eq("id", e.lead.id).select().single(), "cambiar el correo del Lead");
    try {
      expect((await reconstruirCancelacionCita(monitoria.id, fx.admin))?.destinatario).toBe(e.lead.correo);
    } finally {
      exito(await fx.admin.from("lead").update({ correo: e.lead.correo }).eq("id", e.lead.id).select().single(), "restaurar el correo del Lead");
    }
  });

  it("es null si no hay cancelación anotada, si el id no es un uuid, si la cancelación fue de otro motivo o es de una grupal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sinCancelar = await confirmada();
    expect(await reconstruirCancelacionCita(sinCancelar.id, fx.admin)).toBeNull();
    expect(await reconstruirCancelacionCita("no-es-un-uuid", fx.admin)).toBeNull();

    // Anotada pero la cita ya no está cancelada por el estudiante (no pasa con las puertas; el reconstructor no la manda).
    const cancelada = await confirmada();
    expect(await cancelarCitaPorToken(await tokenDe(cancelada.id))).toBe("cancelada");
    expect(await reconstruirCancelacionCita(cancelada.id, fx.admin)).not.toBeNull();
    exito(await fx.admin.from("monitoria").update({ motivo_cancelacion: "monitor_no_asistio" }).eq("id", cancelada.id).select().single(), "cambiar el motivo");
    expect(await reconstruirCancelacionCita(cancelada.id, fx.admin)).toBeNull();

    const grupal = await confirmada();
    expect(await cancelarCitaPorToken(await tokenDe(grupal.id))).toBe("cancelada");
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: grupal.id, cupos: 3, modalidad_pago: "unico", precio_por_persona: 10_000 }).select().single(),
      "insertar monitoria_grupal",
    );
    expect(await reconstruirCancelacionCita(grupal.id, fx.admin)).toBeNull();
  });

  it("con el proveedor caído el correo queda fallido, y el proceso de reintentos lo manda una sola vez con el mismo enlace de la llave", async () => {
    const monitoria = await confirmada();
    await pagoDe(monitoria.id, "aprobado", e.lead.correo!);
    expect(await cancelarCitaPorToken(await tokenDe(monitoria.id))).toBe("cancelada");
    const [reembolso] = await reembolsosDe(monitoria.id);
    const { token } = await solicitudDe(reembolso.id);
    const clave = claveDeCorreo("cancelacion_cita", monitoria.id);
    const antes = (await correosA(e.lead.correo!)).length;

    vi.stubEnv("MAILPIT_URL", "http://127.0.0.1:1");
    const caida = await procesarCancelacionesDeCita({ cliente: fx.admin });
    vi.unstubAllEnvs();
    expect(caida.fallidas).toBeGreaterThanOrEqual(1);
    expect(exito(await fx.admin.from("correo_envio").select("estado, reintentable").eq("clave", clave).single(), "leer el registro")).toEqual({
      estado: "fallido",
      reintentable: true,
    });
    expect((await cancelacionDe(monitoria.id))!.procesado_en).not.toBeNull();
    expect(await correosA(e.lead.correo!)).toHaveLength(antes);

    // El reintento toma los fallidos que llevan 2 minutos quietos: se corre con un "ahora" 3 minutos adelante.
    await reintentarCorreosFallidos({
      cliente: fx.admin,
      reconstructores: RECONSTRUCTORES,
      enviar: enviarCorreoDesdeServidor,
      ahora: new Date(Date.now() + 3 * MINUTO),
    });

    expect(exito(await fx.admin.from("correo_envio").select("estado").eq("clave", clave).single(), "leer el registro").estado).toBe("enviado");
    const despues = await correosA(e.lead.correo!);
    expect(despues).toHaveLength(antes + 1);
    expect(despues.find((c) => c.Text.includes(rutaDeLlave(token)))).toBeDefined();
  }, 60_000);

  it("sin registro de correos la cancelación queda pendiente y suma un intento; al llegar al máximo se abandona", async () => {
    const monitoria = await confirmada();
    expect(await cancelarCitaPorToken(await tokenDe(monitoria.id))).toBe("cancelada");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sinRegistro = async () => ({ ok: false as const, motivo: "fallo_del_registro" as const, error: "sin conexión", intentos: 0 });
    const estado = async () => (await cancelacionDe(monitoria.id))!;

    const primera = await procesarCancelacionesDeCita({ cliente: fx.admin, enviar: sinRegistro });
    expect(primera.conError).toBeGreaterThanOrEqual(1);
    expect(await estado()).toMatchObject({ intentos: 1, procesado_en: null });

    for (let i = 1; i < MAXIMO_DE_INTENTOS; i++) await procesarCancelacionesDeCita({ cliente: fx.admin, enviar: sinRegistro });
    const final = await estado();
    expect(final.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(final.procesado_en).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// P-07 y D-28
// ---------------------------------------------------------------------------------------------------------------

describe("P-07: el pago que se aprueba después de cancelar también se reembolsa", () => {
  it("aprobar con una actualización directa crea el reembolso (primer admin activo, esperando la llave) y su solicitud sin marcar; rechazar no crea nada; aprobar otra vez no duplica", async () => {
    const monitoria = await confirmada();
    const aprobable = await pagoDe(monitoria.id, "en_revision", e.lead.correo!);
    const rechazable = await pagoDe(monitoria.id, "en_revision", e.lead.correo!);
    expect(await cancelarCitaPorToken(await tokenDe(monitoria.id))).toBe("cancelada");
    expect(await reembolsosDe(monitoria.id)).toEqual([]);
    const turno = await primerAdminActivo();

    // El admin aprueba uno y rechaza el otro, después de la cancelación.
    const ahora = new Date().toISOString();
    exito(await fx.admin.from("pago").update({ estado: "aprobado", fecha_revision: ahora }).eq("id", aprobable.id).select().single(), "aprobar el pago");
    exito(await fx.admin.from("pago").update({ estado: "rechazado", fecha_revision: ahora }).eq("id", rechazable.id).select().single(), "rechazar el pago");

    const reembolsos = await reembolsosDe(monitoria.id);
    expect(reembolsos).toHaveLength(1);
    expect(reembolsos[0]).toMatchObject({
      id_pago: aprobable.id,
      monto: PRECIO,
      motivo: MOTIVO_CANCELACION_A_TIEMPO,
      estado: "esperando_llave",
      id_admin: turno,
    });
    // La solicitud nace sin marcar: el correo de cancelación ya salió (o saldrá) sin ella; la pide HU-025.
    expect((await solicitudDe(reembolsos[0].id)).en_correo_de_cancelacion).toBe(false);
    expect((await fx.admin.rpc("llaves_de_cancelacion", { p_id_monitoria: monitoria.id })).data).toEqual([]);

    // Devolverlo a revisión y aprobarlo otra vez no duplica el reembolso.
    exito(await fx.admin.from("pago").update({ estado: "en_revision", fecha_revision: null }).eq("id", aprobable.id).select().single(), "devolver a revisión");
    exito(await fx.admin.from("pago").update({ estado: "aprobado", fecha_revision: ahora }).eq("id", aprobable.id).select().single(), "aprobar otra vez");
    expect(await reembolsosDe(monitoria.id)).toHaveLength(1);

    // Y el correo de cancelación (que salió con el pago en revisión) no pide esa llave aunque se reintente después.
    await procesarHasta(monitoria.id);
    const tokenDeCita = await tokenDe(monitoria.id);
    const correo = await correoCon(e.lead.correo!, rutaDeCita(tokenDeCita));
    expect(correo).toBeDefined();
    expect(correo!.Text).not.toContain("/reembolso?token=");
  });

  it("con la puerta real de HU-020: cancelar con el pago en revisión y luego aprobarlo (el admin asignado, con su sesión) crea un solo reembolso, con su solicitud sin marcar", async () => {
    const monitoria = await confirmada();
    const pago = await pagoDe(monitoria.id, "en_revision", e.lead.correo!);
    expect(await cancelarCitaPorToken(await tokenDe(monitoria.id))).toBe("cancelada");
    expect(await reembolsosDe(monitoria.id)).toEqual([]);
    const turno = await primerAdminActivo();

    expect(await revisarPago(sesionAdmin, { idPago: pago.id, decision: "aprobar", observaciones: null })).toEqual({ resultado: "aprobado", canceloMonitoria: false });

    expect(await estadoDe(monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
    const reembolsos = await reembolsosDe(monitoria.id);
    expect(reembolsos).toHaveLength(1);
    expect(reembolsos[0]).toMatchObject({ id_pago: pago.id, monto: PRECIO, motivo: MOTIVO_CANCELACION_A_TIEMPO, estado: "esperando_llave", id_admin: turno });
    expect((await solicitudDe(reembolsos[0].id)).en_correo_de_cancelacion).toBe(false);

    // Una segunda aprobación ya no pasa por el trigger: el pago está revisado y no se duplica nada.
    expect(await revisarPago(sesionAdmin, { idPago: pago.id, decision: "aprobar", observaciones: null })).toEqual({ resultado: "ya_revisado", canceloMonitoria: false });
    expect(await reembolsosDe(monitoria.id)).toHaveLength(1);
  });

  // Dos conexiones, cada una en su transacción: la primera se queda con los bloqueos de la monitoría y del pago (las dos
  // operaciones toman primero la monitoría y después los pagos); la segunda espera. Salga quien salga primero, hay un
  // solo reembolso.
  async function carreraCancelarYAprobar(primera: "cancelar" | "aprobar") {
    const monitoria = await confirmada();
    const pago = await pagoDe(monitoria.id, "en_revision", e.lead.correo!);
    const a = await conexion();
    const b = await conexion();
    try {
      const ejecutar = async (conn: Conexion, quien: "cancelar" | "aprobar") => {
        await conn.cliente.query("begin");
        if (quien === "aprobar") await comoAdmin(conn.cliente);
        return quien === "cancelar" ? cancelarEn(conn.cliente, monitoria.id) : aprobarEn(conn.cliente, pago.id);
      };
      const segunda = primera === "cancelar" ? "aprobar" : "cancelar";
      const ganadora = await ejecutar(a, primera);
      const perdedora = enCurso(ejecutar(b, segunda));
      await esperarBloqueo(b.pid, a.pid, perdedora);
      await a.cliente.query("commit");
      const resultadoPerdedora = await perdedora.promesa;
      await b.cliente.query("commit");
      return { ganadora, perdedora: resultadoPerdedora, monitoria: monitoria.id, pago: pago.id };
    } finally {
      await cerrar(a, b);
    }
  }

  it(
    "carrera: la cancelación llega primero y la aprobación espera; al soltarse, el trigger crea el único reembolso, sin marcar en el correo",
    async () => {
      const r = await carreraCancelarYAprobar("cancelar");

      expect(r.ganadora).toBe("cancelada");
      expect(r.perdedora).toEqual({ resultado: "aprobado", cancelo_monitoria: false });
      const reembolsos = await reembolsosDe(r.monitoria);
      expect(reembolsos).toHaveLength(1);
      expect(reembolsos[0]).toMatchObject({ id_pago: r.pago, monto: PRECIO, motivo: MOTIVO_CANCELACION_A_TIEMPO, estado: "esperando_llave" });
      expect((await solicitudDe(reembolsos[0].id)).en_correo_de_cancelacion).toBe(false);
    },
    60_000,
  );

  it(
    "carrera: la aprobación llega primero y la cancelación espera; al soltarse, ve el pago aprobado y crea el único reembolso, ya en el correo",
    async () => {
      const r = await carreraCancelarYAprobar("aprobar");

      expect(r.ganadora).toEqual({ resultado: "aprobado", cancelo_monitoria: false });
      expect(r.perdedora).toBe("cancelada");
      const reembolsos = await reembolsosDe(r.monitoria);
      expect(reembolsos).toHaveLength(1);
      expect(reembolsos[0]).toMatchObject({ id_pago: r.pago, monto: PRECIO, motivo: MOTIVO_CANCELACION_A_TIEMPO, estado: "esperando_llave" });
      expect((await solicitudDe(reembolsos[0].id)).en_correo_de_cancelacion).toBe(true);
    },
    60_000,
  );

  it("aprobar un pago de una cita que sigue confirmada, o cancelada por otro motivo, no crea reembolso", async () => {
    const confirmadaAun = await confirmada();
    const pagoA = await pagoDe(confirmadaAun.id, "en_revision");
    exito(await fx.admin.from("pago").update({ estado: "aprobado", fecha_revision: new Date().toISOString() }).eq("id", pagoA.id).select().single(), "aprobar");
    expect(await reembolsosDe(confirmadaAun.id)).toEqual([]);

    const otroMotivo = await confirmada();
    const pagoB = await pagoDe(otroMotivo.id, "en_revision");
    exito(await fx.admin.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" }).eq("id", otroMotivo.id).select().single(), "cancelar");
    exito(await fx.admin.from("pago").update({ estado: "aprobado", fecha_revision: new Date().toISOString() }).eq("id", pagoB.id).select().single(), "aprobar");
    expect(await reembolsosDe(otroMotivo.id)).toEqual([]);
  });
});

describe("D-28: sin admin activo el Lead igual cancela; el reembolso queda sin admin hasta que haya uno", () => {
  it("cancela, el reembolso nace con id_admin nulo y su solicitud de llave, y la asignación diferida se lo da al primer admin activo", async () => {
    const monitoria = await confirmada();
    await pagoDe(monitoria.id, "aprobado", e.lead.correo!);

    // Se banean (dentro de la prueba y se restauran al final) todos los admins: ninguno activo. Las pruebas de
    // integración corren una a la vez, así que nadie más usa la base ahora.
    const { rows: previos } = await bd.query<{ id: string; banned_until: string | null }>(
      "select u.id, u.banned_until from auth.users u join public.admin a on a.id = u.id",
    );
    try {
      await bd.query("update auth.users set banned_until = 'infinity' where id in (select id from public.admin)");
      expect(await primerAdminActivo()).toBeNull();

      expect(await cancelarCitaPorToken(await tokenDe(monitoria.id))).toBe("cancelada");
      expect(await estadoDe(monitoria.id)).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
      const [reembolso] = await reembolsosDe(monitoria.id);
      expect(reembolso).toMatchObject({ monto: PRECIO, motivo: MOTIVO_CANCELACION_A_TIEMPO, estado: "esperando_llave", id_admin: null });
      expect((await solicitudDe(reembolso.id)).token).toMatch(/^[0-9a-f]{64}$/);

      // El trabajo de pg_cron sin admin activo no hace nada.
      const { rows: sinAdmin } = await bd.query<{ n: number }>("select privado.asignar_reembolsos_sin_admin() as n");
      expect(sinAdmin[0].n).toBe(0);
      expect((await reembolsosDe(monitoria.id))[0].id_admin).toBeNull();
    } finally {
      for (const previo of previos) {
        await bd.query("update auth.users set banned_until = $2 where id = $1", [previo.id, previo.banned_until]);
      }
    }

    // Vuelve (o llega) un admin: el trabajo se lo asigna al primer admin activo.
    const turno = await primerAdminActivo();
    expect(turno).not.toBeNull();
    const { rows: asignados } = await bd.query<{ n: number }>("select privado.asignar_reembolsos_sin_admin() as n");
    expect(asignados[0].n).toBeGreaterThanOrEqual(1);
    expect((await reembolsosDe(monitoria.id))[0].id_admin).toBe(turno);
    // Y no repite.
    const { rows: otraVez } = await bd.query<{ n: number }>("select privado.asignar_reembolsos_sin_admin() as n");
    expect(otraVez[0].n).toBe(0);

    // El correo salió con la llave aunque no hubiera admin: la persona no espera por eso.
    await procesarHasta(monitoria.id);
    const { token } = await solicitudDe((await reembolsosDe(monitoria.id))[0].id);
    expect(await correoCon(e.lead.correo!, rutaDeLlave(token))).toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// La ruta
// ---------------------------------------------------------------------------------------------------------------

describe("la ruta /api/procesos/avisar-cancelaciones", () => {
  const SECRETO = randomBytes(32).toString("hex");
  const llamar = (encabezado?: string) =>
    POST(
      new Request("http://localhost:3000/api/procesos/avisar-cancelaciones", {
        method: "POST",
        headers: encabezado === undefined ? {} : { authorization: encabezado },
        body: "{}",
      }),
    );

  it("sin el secreto del proceso programado, o con otro, responde 401 y no manda nada", async () => {
    const monitoria = await confirmada();
    expect(await cancelarCitaPorToken(await tokenDe(monitoria.id))).toBe("cancelada");
    vi.stubEnv("CRON_SECRETO", "");
    expect((await llamar(`Bearer ${SECRETO}`)).status).toBe(401);
    vi.stubEnv("CRON_SECRETO", SECRETO);
    for (const encabezado of [undefined, "", `Bearer ${"0".repeat(SECRETO.length)}`, SECRETO]) {
      const respuesta = await llamar(encabezado);
      expect(respuesta.status, String(encabezado)).toBe(401);
      expect(await respuesta.json()).toEqual({ error: "No autorizado." });
    }
    vi.unstubAllEnvs();
    expect((await cancelacionDe(monitoria.id))!.procesado_en).toBeNull();
    expect(await registroDe(monitoria.id)).toBeNull();
  });

  it("con el secreto correcto procesa las cancelaciones, manda el correo y responde el resumen", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    const monitoria = await confirmada();
    const tokenDeCita = await tokenDe(monitoria.id);
    expect(await cancelarCitaPorToken(tokenDeCita)).toBe("cancelada");

    const respuesta = await llamar(`Bearer ${SECRETO}`);

    expect(respuesta.status).toBe(200);
    const resumen = await respuesta.json();
    expect(Object.keys(resumen).sort()).toEqual(["conError", "descartadas", "enviadas", "fallidas", "pospuestas", "revisadas", "tomadasPorOtro"]);
    expect(resumen.revisadas).toBe(
      resumen.enviadas + resumen.descartadas + resumen.fallidas + resumen.tomadasPorOtro + resumen.conError + resumen.pospuestas,
    );
    expect(resumen.enviadas).toBeGreaterThanOrEqual(1);
    await procesarHasta(monitoria.id);
    expect(await correoCon(e.lead.correo!, rutaDeCita(tokenDeCita))).toBeDefined();
  });
});
