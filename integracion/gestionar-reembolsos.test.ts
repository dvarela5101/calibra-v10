import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reenviar } from "@/app/admin/reembolsos/[id]/acciones";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { cargarReembolso, ejecutarReembolso } from "@/lib/admin/reembolsos";
import type { EstadoDeLaVista, ResultadoDeRegistro } from "@/lib/admin/reembolsos-reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { diaDelNegocio, formatearFechaHora } from "@/lib/fechas";
import { diaIsoDeFecha, inicioDeSesion } from "@/lib/plazos/motor";
import { procesarPedidosDeLlave } from "@/lib/reembolsos/pedidos";
import { rutaDeLlave } from "@/lib/reembolsos/reglas";
import { leerLlavePorToken, reenviarPedidoDeLlave } from "@/lib/reembolsos/servidor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-026 y HU-082 contra el Supabase local, por la misma ruta que la página y las acciones de `/admin/reembolsos/[id]`:
 * `cargarReembolso` y `ejecutarReembolso` con la sesión de verdad de cada admin, así que también se prueban
 * `public.estado_de_reembolso`, `public.ejecutar_reembolso`, sus permisos y que nadie escriba `reembolso` por su cuenta.
 * La acción `registrar` hace lo mismo y además `exigirRol`, la lectura del formulario, `revalidatePath` y `redirect`, que
 * necesitan a Next (los cubre `src/app/admin/reembolsos/[id]/acciones.test.ts`). La acción `reenviar` sí corre aquí, con
 * la sesión real del admin: solo se reemplazan `exigirRol` y el cliente de las cookies, que necesitan una petición de
 * Next, por la sesión de la prueba. Los bordes de cada resultado, con una hora fija, están en
 * `supabase/tests/gestionar_reembolsos.test.sql`.
 *
 * Criterio 4 (al crearse queda asignado al primer admin activo, D-26, D-28): no se duplica. Ya lo prueban las puertas
 * reales en `integracion/cancelar.test.ts:474` (cancelar a tiempo), `:866` (P-07 con `revisarPago`) y `:958` (D-28).
 *
 * HU-082 (D-48): cualquier admin activo registra la transferencia, no solo el asignado. `id_admin` no cambia y
 * `id_admin_registro` guarda quién la registró.
 *
 * Los reembolsos se insertan directo, como los crea cualquier HU (HU-024, P-07, HU-030): los triggers les anotan su
 * solicitud (el token) y, si esperan la llave, su pedido. Un caso vencido o cerrado se prepara moviendo el plazo hacia
 * atrás (y `cerrado_en`, como lo deja pg_cron). Cada pago es de un contacto propio, así los correos de cada prueba no se
 * mezclan en Mailpit. En local no hay configuración en Vault, así que la base no llama a la app: la prueba corre
 * `procesarPedidosDeLlave` (el código de `/api/procesos/pedir-llaves`) hasta que su pedido sale.
 *
 * El Auth local deja 30 inicios de sesión cada 5 minutos y el resto de la suite ya usa muchos: este archivo inicia tres,
 * una sola vez (el admin asignado, otro admin activo y un monitor). Cada prueba crea y borra todo lo demás.
 *
 * Dos operaciones a la vez van con dos conexiones `pg` reales, cada una en su transacción, como en
 * `integracion/desembolsos.test.ts`: la segunda espera el candado de la fila que tomó la primera.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;
/** P-10: los días para entregar la llave (`public.parametros_reembolso`). */
const DIAS_PARA_ENTREGAR = 7;

/** Lo que deja `Fixtures.crearReembolso`. */
const MONTO = 25_000;
const LLAVE = "llave-de-prueba";
const MOTIVO = "Cancelación de prueba";

type Cuenta = { usuario: UsuarioPrueba; cliente: Cliente };
type Contexto = Awaited<ReturnType<Fixtures["crearContextoDeMonitoria"]>>;
type Mensaje = { Subject: string; Text: string; HTML: string };

/**
 * La sesión con la que corre la acción `reenviar`. En Next, `exigirRol` y `crearClienteServidor` la leen de las cookies
 * de la petición; aquí es la sesión real de una cuenta del archivo, iniciada con su contraseña.
 */
const accion = vi.hoisted(() => ({ cliente: null as unknown, idUsuario: "" }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => accion.cliente }));
vi.mock("@/lib/auth/sesion", () => ({ exigirRol: vi.fn(async () => ({ idUsuario: accion.idUsuario, rol: "admin" })) }));

let fx: Fixtures;
let cuentas: Fixtures;
let bd: pg.Client;
let mailpit: string;
/** Las tres sesiones del archivo: el admin asignado, otro admin activo y un monitor. */
let admin: Cuenta;
let otroAdmin: Cuenta;
let monitor: Cuenta;
/** Monitor, materia, franja de los lunes y Lead de la prueba: uno por prueba, para todas sus monitorías. */
let contexto: Contexto | undefined;
let semana = 0;
const reembolsosDeLaPrueba = new Set<string>();
const pedidos = new Set<string>();
const correos = new Set<string>();

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
    admin = await cuenta(await cuentas.crearAdmin());
    otroAdmin = await cuenta(await cuentas.crearAdmin());
    monitor = await cuenta(await cuentas.crearMonitor());
  } catch (error) {
    await cuentas.limpiar();
    throw error;
  }
}, 60_000);

beforeEach(() => {
  fx = new Fixtures();
  contexto = undefined;
  semana = 0;
  reembolsosDeLaPrueba.clear();
});

afterEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  // Los pedidos se van en cascada con sus reembolsos; el registro de sus correos, no: se anotan antes de borrar.
  if (reembolsosDeLaPrueba.size) {
    const { data } = await fx.admin.from("pedido_llave").select("id").in("id_reembolso", [...reembolsosDeLaPrueba]);
    for (const { id } of data ?? []) pedidos.add(id);
  }
  await fx.limpiar();
});

afterAll(async () => {
  for (const correo of correos) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(() => undefined);
  }
  if (cuentas) {
    const claves = [...pedidos].flatMap((id) => [claveDeCorreo("solicitud_llave_reembolso", id), claveDeCorreo("recordatorio_llave_reembolso", id)]);
    // Por lotes: cada clave mide unos 60 caracteres y el filtro viaja en la URL.
    for (let i = 0; i < claves.length; i += 40) {
      await cuentas.admin.from("correo_envio").delete().in("clave", claves.slice(i, i + 40));
    }
  }
  await bd?.end();
  // Después de los reembolsos de cada prueba: reembolso.id_admin no cae en cascada.
  await cuentas?.limpiar();
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

const hoy = () => diaDelNegocio(new Date());

/** El primer lunes a ocho semanas o más de hoy en Bogotá, más `semanasExtra` semanas: cada monitoría en su semana. */
function lunesLejano(semanasExtra = 0): string {
  let fecha = sumarDias(hoy(), 56 + semanasExtra * 7);
  while (diaIsoDeFecha(fecha) !== 1) fecha = sumarDias(fecha, 1);
  return fecha;
}

/** El instante del mediodía de ese día en Bogotá, como guarda la base la fecha de la transferencia. */
const mediodiaEnBogota = (fecha: string) => inicioDeSesion(fecha, "12:00");

/** El fin del plazo para entregar la llave de un ciclo que empezó en `desde` (P-10). */
const venceDe = (desde: string | Date) => new Date(new Date(desde).getTime() + DIAS_PARA_ENTREGAR * DIA);

/** Un correo propio de la prueba (Mailpit separa los buzones por destinatario). */
function correoNuevo(): string {
  const correo = `pagador-${randomBytes(6).toString("hex")}@calibra.test`;
  correos.add(correo);
  return correo;
}

type Reembolso = { id: string; token: string; contacto: string; nombrePagador: string; fecha: string };

/**
 * Un reembolso de un pago aprobado de una monitoría cancelada por el estudiante (un lunes lejano por reembolso), con lo
 * que su estado exige (`Fixtures.crearReembolso`). Lo tiene asignado `de`, por defecto el admin del archivo.
 */
async function reembolso(estado: "esperando_llave" | "pendiente" | "reembolsado", de: Cuenta = admin): Promise<Reembolso> {
  contexto ??= await fx.crearContextoDeMonitoria(admin.usuario.id);
  const fecha = lunesLejano(semana++);
  const monitoria = await fx.crearMonitoria(contexto, { fecha, estado: "cancelada" });
  const contacto = correoNuevo();
  const nombrePagador = `Pagador ${randomBytes(3).toString("hex")}`;
  const pago = await fx.crearPagoDe(monitoria.id, { idAdmin: admin.usuario.id, estado: "aprobado", nombrePagador });
  exito(await fx.admin.from("pago").update({ contacto }).eq("id", pago.id).select().single(), "poner el contacto del pago");
  const creado = await fx.crearReembolso({ idPago: pago.id, idAdmin: de.usuario.id, estado });
  reembolsosDeLaPrueba.add(creado.id);
  const { token } = exito(await fx.admin.from("solicitud_llave").select("token").eq("id_reembolso", creado.id).single(), "leer la solicitud de la llave");
  return { id: creado.id, token, contacto, nombrePagador, fecha };
}

/** Pasaron los 7 días sin llave, pero el trabajo de pg_cron todavía no lo cierra. */
async function vencer(r: Reembolso): Promise<Reembolso> {
  const desde = new Date(Date.now() - (DIAS_PARA_ENTREGAR + 1) * DIA).toISOString();
  exito(await fx.admin.from("reembolso").update({ plazo_llave_desde: desde }).eq("id", r.id).select().single(), "vencer el plazo");
  return r;
}

/** Pasaron los 7 días sin llave y el trabajo de pg_cron ya lo cerró. */
async function cerrarSinLlave(r: Reembolso): Promise<Reembolso> {
  const desde = new Date(Date.now() - (DIAS_PARA_ENTREGAR + 1) * DIA).toISOString();
  const cerrado = new Date(Date.now() - MINUTO).toISOString();
  exito(
    await fx.admin.from("reembolso").update({ plazo_llave_desde: desde, cerrado_en: cerrado }).eq("id", r.id).select().single(),
    "cerrar el caso",
  );
  return r;
}

const COLUMNAS = "estado, llave_destino, id_admin, id_admin_registro, referencia_transferencia, fecha_reembolso, monto, motivo, cerrado_en, plazo_llave_desde";

/** Lo que la base guarda del reembolso. Con la llave secreta: aquí sí se lee la llave, para comprobarla. */
const reembolsoEnBd = async (id: string) => exito(await fx.admin.from("reembolso").select(COLUMNAS).eq("id", id).single(), "leer el reembolso");

/** Lo mismo que hace la acción con lo que llega del formulario (ya validado por `leerRegistro`). */
const registrar = (cuenta: Cuenta | Cliente, idReembolso: string, opciones: { referencia?: string; fecha?: string } = {}) =>
  ejecutarReembolso("usuario" in cuenta ? cuenta.cliente : cuenta, {
    idReembolso,
    referencia: opciones.referencia ?? `TRX-${randomUUID().slice(0, 8)}`,
    fecha: opciones.fecha ?? hoy(),
  });

/** La bandeja del admin (HU-012), sin el corte de la lista: que uno falte es por la vista. */
const bandejaDe = (cuenta: Cuenta) => cargarBandeja(cuenta.cliente, cuenta.usuario.id, new Date(), { maxFilas: 1_000 });

async function pedidosDe(idReembolso: string) {
  const filas = exito(
    await fx.admin.from("pedido_llave").select("id, tipo, plazo_desde, procesado_en").eq("id_reembolso", idReembolso).order("creada_en").order("id"),
    "leer los pedidos de la llave",
  );
  for (const fila of filas) pedidos.add(fila.id);
  return filas;
}

/** El único pedido de ese tipo del reembolso. */
async function pedidoDe(idReembolso: string, tipo: "pedido" | "reenvio") {
  const filas = (await pedidosDe(idReembolso)).filter((p) => p.tipo === tipo);
  expect(filas, `un solo pedido de tipo ${tipo}`).toHaveLength(1);
  return filas[0];
}

/** Corre el proceso hasta que ese pedido queda procesado (puede haber otros pendientes en la base). */
async function procesarHasta(idPedido: string) {
  for (let i = 0; i < 10; i++) {
    await procesarPedidosDeLlave({ cliente: fx.admin });
    const fila = exito(await fx.admin.from("pedido_llave").select("procesado_en").eq("id", idPedido).single(), "leer el pedido");
    if (fila.procesado_en !== null) return;
  }
  throw new Error(`El pedido de la llave ${idPedido} no se procesó tras 10 corridas.`);
}

async function correosA(correo: string): Promise<Mensaje[]> {
  correos.add(correo);
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

/** Sin filas: el permiso se niega (error) o la RLS no deja ver ninguna; en ningún caso hay filas afectadas. */
function sinFilas(resultado: { data: unknown[] | null; error: { message: string } | null }) {
  expect(resultado.error ? [] : resultado.data).toEqual([]);
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

// ---------------------------------------------------------------------------------------------------------------
// La acción `reenviar` de la página
// ---------------------------------------------------------------------------------------------------------------

/** La acción del formulario «Reenviar el enlace», con la sesión de `cuenta`. Devuelve a dónde redirige. */
async function reenviarConLaAccion(cuenta: Cuenta, idReembolso: string): Promise<string> {
  accion.cliente = cuenta.cliente;
  accion.idUsuario = cuenta.usuario.id;
  const datos = new FormData();
  datos.set("id_reembolso", idReembolso);
  try {
    await reenviar(datos);
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
      // NEXT_REDIRECT;<tipo>;<ruta>;<código>;
      return digest.split(";").slice(2, -2).join(";");
    }
    throw error;
  }
  throw new Error("La acción reenviar siempre redirige.");
}

const paginaCon = (idReembolso: string, reenvio: string) => `/admin/reembolsos/${idReembolso}?reenvio=${reenvio}`;

// ---------------------------------------------------------------------------------------------------------------
// Con `pg`: dos conexiones a la vez
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

/** Dentro de una transacción de `cliente`: lo que sigue corre con el rol `authenticated` y el token de `cuenta`. */
async function como(cliente: pg.Client, cuenta: Cuenta | null) {
  await cliente.query("set local role authenticated");
  const claims = cuenta ? { sub: cuenta.usuario.id, role: "authenticated" } : { role: "authenticated" };
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
}

/** `public.ejecutar_reembolso`, la misma puerta que usa `ejecutarReembolso`, desde una conexión que ya corre como alguien. */
async function registrarEn(cliente: pg.Client, idReembolso: string, referencia: string) {
  const { rows } = await cliente.query<{ resultado: string }>("select public.ejecutar_reembolso($1::uuid, $2, $3::date) as resultado", [
    idReembolso,
    referencia,
    hoy(),
  ]);
  return rows[0].resultado;
}

/** P-44 (HU-074): pasa los casos abiertos de un admin al siguiente activo, como al desactivarlo. Como dueño de la base. */
async function reasignarCasosDe(cliente: pg.Client, cuenta: Cuenta) {
  const { rows } = await cliente.query<{ movidos: number }>("select privado.reasignar_casos_de_admin($1::uuid) as movidos", [cuenta.usuario.id]);
  return rows[0].movidos;
}

// ---------------------------------------------------------------------------------------------------------------
// Criterio 1: los suyos, agrupados por estado
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: el admin ve los reembolsos que tiene asignados, agrupados por estado", () => {
  it("la bandeja lista sus esperando y sus pendientes, cada uno en su grupo, y no los de otro admin, los reembolsados ni los cerrados; cada fila se abre con cargarReembolso en el estado de su grupo", async () => {
    const esperando = await reembolso("esperando_llave");
    const pendiente = await reembolso("pendiente");
    const reembolsado = await reembolso("reembolsado");
    const cerrado = await cerrarSinLlave(await reembolso("esperando_llave"));
    const deOtro = await reembolso("pendiente", otroAdmin);

    const bandeja = await bandejaDe(admin);
    // El admin del archivo solo tiene los de esta prueba (cada prueba borra los suyos).
    expect(bandeja.reembolsos.esperandoLlave.map((r) => r.id)).toEqual([esperando.id]);
    expect(bandeja.reembolsos.pendientes.map((r) => r.id)).toEqual([pendiente.id]);
    expect(bandeja.contadores).toMatchObject({ reembolsos: 2, reembolsosEsperandoLlave: 1, reembolsosPendientes: 1 });
    // El cerrado va con los de todos los admins (HU-025), para reabrirlo; el de otro admin, en la bandeja de ese admin.
    expect(bandeja.reembolsosCerrados.map((r) => r.id)).toContain(cerrado.id);
    expect((await bandejaDe(otroAdmin)).reembolsos.pendientes.map((r) => r.id)).toEqual([deOtro.id]);
    // HU-082: el pendiente de otro admin sale aparte, sin sumar a los propios (ver integracion/bandeja.test.ts).
    expect(bandeja.reembolsos.pendientesDeOtros.map((r) => r.id)).toEqual([deOtro.id]);
    expect(bandeja.contadores.reembolsosPendientesDeOtros).toBe(1);

    const grupos: [EstadoDeLaVista, { id: string }[]][] = [
      ["esperando_llave", bandeja.reembolsos.esperandoLlave],
      ["pendiente", bandeja.reembolsos.pendientes],
    ];
    for (const [estado, filas] of grupos) {
      for (const fila of filas) {
        expect(await cargarReembolso(admin.cliente, fila.id), fila.id).toMatchObject({ id: fila.id, estadoVista: estado, asignado: { id: admin.usuario.id } });
      }
    }
    expect((await cargarReembolso(admin.cliente, reembolsado.id))?.estadoVista).toBe("reembolsado");
    expect((await cargarReembolso(admin.cliente, cerrado.id))?.estadoVista).toBe("cerrado");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 2: registrar la transferencia
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 2: en pendiente, el admin registra la referencia y la fecha y pasa a reembolsado", () => {
  it("con su sesión queda reembolsado con la referencia recortada, la fecha a mediodía de Bogotá y su id; sale de «Listos para transferir»; la página lo pinta registrado; otro intento suyo, y el de otro admin, responden ya_reembolsado; el enlace de quien pagó dice que ya le devolvimos el dinero", async () => {
    const r = await reembolso("pendiente");
    const antes = await reembolsoEnBd(r.id);
    const bandejaAntes = await bandejaDe(admin);
    expect(bandejaAntes.reembolsos.pendientes.map((x) => x.id)).toContain(r.id);

    const leido = await cargarReembolso(admin.cliente, r.id);
    expect(leido).toEqual({
      id: r.id,
      estadoVista: "pendiente",
      venceEn: venceDe(antes.plazo_llave_desde),
      cerradoEn: null,
      monto: MONTO,
      motivo: MOTIVO,
      nombrePagador: r.nombrePagador,
      contacto: r.contacto,
      llaveDestino: LLAVE,
      asignado: { id: admin.usuario.id, nombre: "Admin de prueba" },
      registradoPor: null,
      fechaMinima: hoy(),
      transferencia: null,
      monitoria: { estado: "cancelada", motivoCancelacion: "estudiante", fecha: r.fecha, hora: "10:00:00", duracionMin: 60, nombreMateria: "Materia de prueba" },
    });
    // Cualquier admin activo lo lee (la política «admin lee»); a quién se le pinta la llave lo decide la página.
    expect(await cargarReembolso(otroAdmin.cliente, r.id)).toEqual(leido);

    const referencia = `TRX-${randomUUID().slice(0, 8)}`;
    const dia = hoy();
    // La base recorta los espacios de los bordes, también los saltos y tabuladores.
    expect(await registrar(admin, r.id, { referencia: `  ${referencia}\t\n`, fecha: dia })).toBe("reembolsado");

    const enBd = await reembolsoEnBd(r.id);
    expect({ ...enBd, fecha_reembolso: new Date(enBd.fecha_reembolso!).getTime() }).toEqual({
      ...antes,
      estado: "reembolsado",
      referencia_transferencia: referencia,
      fecha_reembolso: mediodiaEnBogota(dia).getTime(),
      // id_admin no cambia; id_admin_registro es quien registró.
      id_admin: admin.usuario.id,
      id_admin_registro: admin.usuario.id,
      llave_destino: LLAVE,
    });
    const bandejaDespues = await bandejaDe(admin);
    expect(bandejaDespues.reembolsos.pendientes.map((x) => x.id)).not.toContain(r.id);
    expect(bandejaDespues.contadores.reembolsosPendientes).toBe(bandejaAntes.contadores.reembolsosPendientes - 1);
    expect(await cargarReembolso(admin.cliente, r.id)).toMatchObject({
      estadoVista: "reembolsado",
      asignado: { id: admin.usuario.id, nombre: "Admin de prueba" },
      registradoPor: { id: admin.usuario.id, nombre: "Admin de prueba" },
      transferencia: { referencia, fecha: mediodiaEnBogota(dia) },
    });

    // Sin vuelta atrás: el mismo admin y otro admin activo reciben ya_reembolsado.
    expect(await registrar(admin, r.id)).toBe("ya_reembolsado");
    expect(await registrar(otroAdmin, r.id)).toBe("ya_reembolsado");
    expect(await reembolsoEnBd(r.id)).toEqual(enBd);

    // Quien pagó lo ve en su enlace: «Ya te devolvimos el dinero».
    expect(await leerLlavePorToken(r.token)).toMatchObject({ estado: "reembolsado", monto: MONTO, motivo: MOTIVO });
  });

  const negativos: [string, EstadoDeLaVista, ResultadoDeRegistro, () => Promise<Reembolso>][] = [
    ["espera la llave", "esperando_llave", "sin_llave", () => reembolso("esperando_llave")],
    ["venció sin llave y pg_cron todavía no lo cierra", "cerrado", "sin_llave", async () => vencer(await reembolso("esperando_llave"))],
    ["se cerró sin llave", "cerrado", "sin_llave", async () => cerrarSinLlave(await reembolso("esperando_llave"))],
  ];

  it.each(negativos)("%s: cargarReembolso lo da en %s, registrar responde %s y nada cambia", async (_caso, estadoVista, resultado, crear) => {
    const r = await crear();
    const antes = await reembolsoEnBd(r.id);

    expect((await cargarReembolso(admin.cliente, r.id))?.estadoVista).toBe(estadoVista);
    expect(await registrar(admin, r.id)).toBe(resultado);
    expect(await reembolsoEnBd(r.id)).toEqual(antes);
  });

  it("HU-082: otro admin activo registra un pendiente asignado a alguien más: queda reembolsado, id_admin no cambia, id_admin_registro es quien lo registró, y la página lo nombra", async () => {
    const r = await reembolso("pendiente", admin);
    const antes = await reembolsoEnBd(r.id);
    expect(antes).toMatchObject({ id_admin: admin.usuario.id, id_admin_registro: null });

    // El embed con dos llaves a admin (sería PGRST201 sin el nombre de la relación) y la llave que lee cualquier admin.
    expect(await cargarReembolso(otroAdmin.cliente, r.id)).toMatchObject({ estadoVista: "pendiente", llaveDestino: LLAVE, asignado: { id: admin.usuario.id }, registradoPor: null });

    expect(await registrar(otroAdmin, r.id, { referencia: "TRX-OTRO" })).toBe("reembolsado");
    const enBd = await reembolsoEnBd(r.id);
    expect(enBd).toMatchObject({
      estado: "reembolsado",
      referencia_transferencia: "TRX-OTRO",
      id_admin: admin.usuario.id,
      id_admin_registro: otroAdmin.usuario.id,
      llave_destino: LLAVE,
      monto: MONTO,
      motivo: MOTIVO,
    });
    for (const cuenta of [otroAdmin, admin]) {
      expect(await cargarReembolso(cuenta.cliente, r.id)).toMatchObject({
        estadoVista: "reembolsado",
        asignado: { id: admin.usuario.id },
        registradoPor: { id: otroAdmin.usuario.id, nombre: "Admin de prueba" },
        transferencia: { referencia: "TRX-OTRO" },
      });
    }
    // Ni el asignado ni otro pueden registrarlo otra vez.
    expect(await registrar(admin, r.id)).toBe("ya_reembolsado");
    expect(await registrar(otroAdmin, r.id)).toBe("ya_reembolsado");
    expect(await reembolsoEnBd(r.id)).toEqual(enBd);
    // Sale de las dos bandejas: de los propios del asignado y de «De otros admins» del otro.
    expect((await bandejaDe(admin)).reembolsos.pendientes.map((x) => x.id)).not.toContain(r.id);
    expect((await bandejaDe(otroAdmin)).reembolsos.pendientesDeOtros.map((x) => x.id)).not.toContain(r.id);
  });

  it("HU-082 (D-28): un pendiente sin admin asignado lo registra cualquier admin activo; id_admin sigue nulo", async () => {
    const r = await reembolso("pendiente");
    exito(await fx.admin.from("reembolso").update({ id_admin: null }).eq("id", r.id).select().single(), "quitar el admin");

    expect(await cargarReembolso(otroAdmin.cliente, r.id)).toMatchObject({ estadoVista: "pendiente", asignado: null, llaveDestino: LLAVE });
    expect(await registrar(otroAdmin, r.id)).toBe("reembolsado");
    expect(await reembolsoEnBd(r.id)).toMatchObject({ estado: "reembolsado", id_admin: null, id_admin_registro: otroAdmin.usuario.id });
    expect(await cargarReembolso(admin.cliente, r.id)).toMatchObject({ asignado: null, registradoPor: { id: otroAdmin.usuario.id } });
  });

  it("HU-082 (criterio 5): un admin desactivado, aunque conserve su token, recibe sin_permiso y no cambia nada; al reactivarlo registra", async () => {
    const r = await reembolso("pendiente");
    const usuario = await fx.crearAdmin();
    const desactivado: Cuenta = { usuario, cliente: await fx.iniciarSesion(usuario) };
    const antes = await reembolsoEnBd(r.id);

    await bd.query("update auth.users set banned_until = now() + interval '876000 hours' where id = $1", [usuario.id]);
    expect(await registrar(desactivado, r.id)).toBe("sin_permiso");
    expect(await cargarReembolso(desactivado.cliente, r.id)).toBeNull();
    expect(await reembolsoEnBd(r.id)).toEqual(antes);

    await bd.query("update auth.users set banned_until = null where id = $1", [usuario.id]);
    expect(await registrar(desactivado, r.id)).toBe("reembolsado");
    expect(await reembolsoEnBd(r.id)).toMatchObject({ id_admin: admin.usuario.id, id_admin_registro: usuario.id });
  });

  it("HU-082: el reembolso y su llave no salen para un Lead anónimo, un estudiante ni un monitor (cargarReembolso da null)", async () => {
    const r = await reembolso("pendiente");
    const reembolsado = await reembolso("reembolsado");
    const anonimo = await fx.crearAnonimo();
    await fx.crearLeadDeSesion(anonimo.id);
    const estudiante = await fx.crearEstudiante();
    const clienteEstudiante = await fx.iniciarSesion(estudiante);

    for (const [quien, cliente] of [
      ["lead anónimo", anonimo.cliente],
      ["estudiante", clienteEstudiante],
      ["monitor", monitor.cliente],
    ] as const) {
      for (const x of [r, reembolsado]) {
        expect(await cargarReembolso(cliente, x.id), `${quien} ${x.id}`).toBeNull();
      }
      sinFilas(await cliente.from("reembolso").select("llave_destino, id_admin_registro").eq("id", r.id));
    }
  });

  it("con la referencia o la fecha mal responde referencia_invalida o fecha_invalida sin tocar nada; un id que no existe, no_encontrado; la fecha del día en que se creó y 100 caracteres (contados como la base) sí se registran", async () => {
    const r = await reembolso("pendiente");
    // Se creó hace 3 días a las 11:30 p. m. en Bogotá, cuando en UTC ya era el día siguiente: la transferencia no puede
    // ser anterior a ese día en Bogotá, y la página tiene que dar el mismo día que la base, no el de UTC.
    const creado = sumarDias(hoy(), -3);
    exito(
      await fx.admin.from("reembolso").update({ fecha_generacion: `${creado}T23:30:00-05:00` }).eq("id", r.id).select().single(),
      "mover la creación",
    );
    expect((await cargarReembolso(admin.cliente, r.id))!.fechaMinima).toBe(creado);
    const antes = await reembolsoEnBd(r.id);

    for (const referencia of ["", "   ", " \n\t ", "x".repeat(101), "𝄞".repeat(101)]) {
      expect(await registrar(admin, r.id, { referencia }), JSON.stringify(referencia)).toBe("referencia_invalida");
    }
    for (const fecha of [sumarDias(hoy(), 1), sumarDias(creado, -1)]) {
      expect(await registrar(admin, r.id, { fecha }), fecha).toBe("fecha_invalida");
    }
    expect(await registrar(admin, randomUUID())).toBe("no_encontrado");
    expect(await reembolsoEnBd(r.id)).toEqual(antes);

    // U+1D11E ocupa dos unidades en JavaScript y un carácter para la base (char_length), como cuenta leerRegistro.
    const larga = "𝄞".repeat(100);
    expect(await registrar(admin, r.id, { referencia: larga, fecha: creado })).toBe("reembolsado");
    const enBd = await reembolsoEnBd(r.id);
    expect(enBd).toMatchObject({ estado: "reembolsado", referencia_transferencia: larga });
    expect(new Date(enBd.fecha_reembolso!).getTime()).toBe(mediodiaEnBogota(creado).getTime());
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 3: reenviar el enlace
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 3: en esperando la llave, el admin reenvía la solicitud a quien pagó", () => {
  it("la acción reenviar con la sesión del admin vuelve a la página con ?reenvio=reenviado; el doble clic, y otro admin activo, dejan un solo reenvío, que sale a Mailpit con el mismo enlace y el mismo plazo; el plazo no cambia", async () => {
    const r = await reembolso("esperando_llave");
    await procesarHasta((await pedidoDe(r.id, "pedido")).id);
    const { plazo_llave_desde } = await reembolsoEnBd(r.id);

    expect(await reenviarConLaAccion(admin, r.id)).toBe(paginaCon(r.id, "reenviado"));
    // La acción se protege sola, con la ruta del reembolso.
    expect(vi.mocked(exigirRol)).toHaveBeenCalledWith("admin", `/admin/reembolsos/${r.id}`);
    expect(await reenviarConLaAccion(admin, r.id)).toBe(paginaCon(r.id, "reenviado"));
    // Reenviar es de cualquier admin activo, no solo del asignado (como dejó HU-025).
    expect(await reenviarConLaAccion(otroAdmin, r.id)).toBe(paginaCon(r.id, "reenviado"));
    const reenvio = await pedidoDe(r.id, "reenvio");
    expect(new Date(reenvio.plazo_desde).getTime()).toBe(new Date(plazo_llave_desde).getTime());

    await procesarHasta(reenvio.id);
    const recibidos = await correosA(r.contacto);
    expect(recibidos, "el pedido de la creación y un solo reenvío").toHaveLength(2);
    for (const correo of recibidos) {
      expect(correo.Text).toContain(rutaDeLlave(r.token));
      expect(correo.Text).toContain(`Tienes hasta el ${formatearFechaHora(venceDe(plazo_llave_desde))} para enviarla.`);
      expect(correo.Text.toLowerCase()).not.toContain("comisi");
    }
    expect(await reembolsoEnBd(r.id)).toMatchObject({ estado: "esperando_llave", plazo_llave_desde, cerrado_en: null, llave_destino: null });
  });

  it("la acción no reenvía si ya llegó la llave (ya_entregada) o si venció o se cerró (cerrado), y lo dice en la página; si no existe (no_encontrado) lo dice en la bandeja, porque la página sería un 404; un id que no es un uuid vuelve a /admin sin consultar la base", async () => {
    const inexistente = randomUUID();
    const casos: [string, Reembolso, string][] = [
      ["pendiente", await reembolso("pendiente"), "ya_entregada"],
      ["reembolsado", await reembolso("reembolsado"), "ya_entregada"],
      ["vencido sin cerrar", await vencer(await reembolso("esperando_llave")), "cerrado"],
      ["cerrado", await cerrarSinLlave(await reembolso("esperando_llave")), "cerrado"],
    ];
    for (const [caso, r, desenlace] of casos) {
      expect(await reenviarConLaAccion(admin, r.id), caso).toBe(paginaCon(r.id, desenlace));
    }
    expect(await reenviarConLaAccion(admin, inexistente), "inexistente").toBe("/admin?reenvio=no_encontrado");
    for (const id of reembolsosDeLaPrueba) {
      expect((await pedidosDe(id)).map((p) => p.tipo), id).not.toContain("reenvio");
    }

    const consultas = vi.spyOn(admin.cliente, "rpc");
    expect(await reenviarConLaAccion(admin, "no-es-un-uuid")).toBe("/admin");
    expect(vi.mocked(exigirRol)).toHaveBeenLastCalledWith("admin", "/admin");
    expect(consultas).not.toHaveBeenCalled();
  });

  it("reenviarPedidoDeLlave: un monitor recibe sin_permiso, sin sesión la base ni la ejecuta y un id que no es un uuid es no_encontrado sin consultar; nada se anota", async () => {
    const r = await reembolso("esperando_llave");

    expect(await reenviarPedidoDeLlave(monitor.cliente, r.id)).toBe("sin_permiso");
    await expect(reenviarPedidoDeLlave(crearCliente(), r.id)).rejects.toThrow(/No se pudo reenviar el enlace/);
    const consultas = vi.spyOn(admin.cliente, "rpc");
    expect(await reenviarPedidoDeLlave(admin.cliente, "no-es-un-uuid")).toBe("no_encontrado");
    expect(consultas).not.toHaveBeenCalled();
    expect((await pedidosDe(r.id)).map((p) => p.tipo)).toEqual(["pedido"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------------------------------------------

describe("cualquier admin activo registra, y solo por la función", () => {
  it("un monitor no ve el reembolso (null) y al registrar recibe sin_permiso; sin sesión la base ni siquiera ejecuta las funciones; una sesión sin usuario recibe sin_sesion; nada cambia", async () => {
    const r = await reembolso("pendiente");
    const antes = await reembolsoEnBd(r.id);

    expect(await cargarReembolso(monitor.cliente, r.id)).toBeNull();
    expect(exito(await monitor.cliente.rpc("estado_de_reembolso", { p_id_reembolso: r.id }), "estado_de_reembolso del monitor")).toEqual([]);
    expect(await registrar(monitor, r.id)).toBe("sin_permiso");

    await expect(registrar(crearCliente(), r.id)).rejects.toThrow(/No se pudo registrar el reembolso: 42501/);
    expect((await crearCliente().rpc("estado_de_reembolso", { p_id_reembolso: r.id })).error?.code).toBe("42501");

    // El rol authenticated sin `sub` no llega por la Data API con una sesión de verdad: se prueba con `pg`.
    const c = await conexion();
    try {
      await c.cliente.query("begin");
      await como(c.cliente, null);
      expect(await registrarEn(c.cliente, r.id, "TRX-SIN-SESION")).toBe("sin_sesion");
      await c.cliente.query("rollback");
    } finally {
      await cerrar(c);
    }

    expect(await reembolsoEnBd(r.id)).toEqual(antes);
    expect(await cargarReembolso(admin.cliente, randomUUID())).toBeNull();
  });

  it("nadie escribe directo en reembolso: ni el admin asignado con su sesión puede insertarlo, actualizarlo o borrarlo por la Data API", async () => {
    const r = await reembolso("pendiente");
    const antes = await reembolsoEnBd(r.id);

    sinFilas(
      await admin.cliente
        .from("reembolso")
        .update({ estado: "reembolsado", referencia_transferencia: "TRX-DIRECTA", fecha_reembolso: new Date().toISOString() })
        .eq("id", r.id)
        .select(),
    );
    sinFilas(await admin.cliente.from("reembolso").delete().eq("id", r.id).select());
    const pago = exito(await fx.admin.from("reembolso").select("id_pago").eq("id", r.id).single(), "leer el pago del reembolso");
    const insertado = await admin.cliente
      .from("reembolso")
      .insert({ id_pago: pago.id_pago, id_admin: admin.usuario.id, monto: 1, motivo: "Directo", estado: "reembolsado", llave_destino: "x", referencia_transferencia: "TRX-DIRECTA", fecha_reembolso: new Date().toISOString() })
      .select();
    expect(insertado.error).not.toBeNull();

    expect(await reembolsoEnBd(r.id)).toEqual(antes);
    expect(exito(await fx.admin.from("reembolso").select("id").eq("id_pago", pago.id_pago), "contar los reembolsos del pago")).toHaveLength(1);
  });

  it("supuesto 9 y CLAUDE.md: lo que lee la pantalla trae el monto completo y nunca la comisión ni el neto, ni antes ni después de registrar", async () => {
    const r = await reembolso("pendiente");
    const comision = exito(await fx.admin.rpc("comision", { p_monto_bruto: MONTO }), "calcular la comisión");
    const prohibidos = [comision, MONTO - comision];

    const crudo = exito(await admin.cliente.rpc("estado_de_reembolso", { p_id_reembolso: r.id }), "estado_de_reembolso del admin");
    expect(crudo).toEqual([{ estado: "pendiente", vence_en: expect.any(String) }]);

    const antes = await cargarReembolso(admin.cliente, r.id);
    expect(antes?.monto).toBe(MONTO);
    expect(numerosDe(antes).filter((n) => prohibidos.includes(n))).toEqual([]);
    expect(clavesDe(antes).filter((clave) => /bruto|comisi|neto/i.test(clave))).toEqual([]);

    expect(await registrar(admin, r.id)).toBe("reembolsado");
    const despues = await cargarReembolso(admin.cliente, r.id);
    expect(despues?.monto).toBe(MONTO);
    expect(numerosDe(despues).filter((n) => prohibidos.includes(n))).toEqual([]);
    expect(clavesDe(despues).filter((clave) => /bruto|comisi|neto/i.test(clave))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Carreras: dos conexiones a la vez sobre la misma fila
// ---------------------------------------------------------------------------------------------------------------

describe("dos operaciones a la vez sobre el mismo reembolso (A.4 del diseño)", () => {
  it(
    "dos admins a la vez (el asignado y otro): el primer registro bloquea la fila; el segundo espera, recibe ya_reembolsado y queda la referencia y el registrador del primero",
    async () => {
      const r = await reembolso("pendiente");

      const a = await conexion();
      const b = await conexion();
      try {
        await a.cliente.query("begin");
        await como(a.cliente, admin);
        expect(await registrarEn(a.cliente, r.id, "TRX-PRIMERO")).toBe("reembolsado");

        await b.cliente.query("begin");
        await como(b.cliente, otroAdmin);
        const segundo = enCurso(registrarEn(b.cliente, r.id, "TRX-SEGUNDO"));
        await esperarBloqueo(b.pid, a.pid, segundo);

        await a.cliente.query("commit");
        expect(await segundo.promesa).toBe("ya_reembolsado");
        await b.cliente.query("commit");
      } finally {
        await cerrar(a, b);
      }
      expect(await reembolsoEnBd(r.id)).toMatchObject({
        estado: "reembolsado",
        id_admin: admin.usuario.id,
        id_admin_registro: admin.usuario.id,
        referencia_transferencia: "TRX-PRIMERO",
      });
    },
    60_000,
  );

  it(
    "P-44: si reasignar_casos_de_admin tomó la fila y confirma, el registro del admin que la tenía, que esperaba y sigue activo, registra: id_admin es el nuevo asignado e id_admin_registro es él",
    async () => {
      const r = await reembolso("pendiente");

      const a = await conexion();
      const b = await conexion();
      try {
        await a.cliente.query("begin");
        // El único caso abierto de ese admin es este reembolso (los pagos de la prueba están aprobados).
        expect(await reasignarCasosDe(a.cliente, admin)).toBe(1);

        await b.cliente.query("begin");
        await como(b.cliente, admin);
        const registro = enCurso(registrarEn(b.cliente, r.id, "TRX-TARDE"));
        await esperarBloqueo(b.pid, a.pid, registro);

        await a.cliente.query("commit");
        expect(await registro.promesa).toBe("reembolsado");
        await b.cliente.query("commit");
      } finally {
        await cerrar(a, b);
      }
      const enBd = await reembolsoEnBd(r.id);
      expect(enBd).toMatchObject({ estado: "reembolsado", referencia_transferencia: "TRX-TARDE", llave_destino: LLAVE, id_admin_registro: admin.usuario.id });
      expect(enBd.id_admin).not.toBe(admin.usuario.id);
    },
    60_000,
  );

  it(
    "P-44: si el admin que esperaba la fila se desactiva antes de que la otra transacción confirme, el registro responde sin_permiso (se mira otra vez bajo el candado) y no escribe nada",
    async () => {
      const r = await reembolso("pendiente");
      const viejo = await fx.crearAdmin();
      exito(await fx.admin.from("reembolso").update({ id_admin: viejo.id }).eq("id", r.id).select().single(), "asignar al admin viejo");
      const antes = await reembolsoEnBd(r.id);

      const a = await conexion();
      const b = await conexion();
      try {
        // A toma la fila y, antes de confirmar, desactiva al admin viejo (como al desactivarlo desde el equipo).
        await a.cliente.query("begin");
        await a.cliente.query("select id from public.reembolso where id = $1 for no key update", [r.id]);

        await b.cliente.query("begin");
        await b.cliente.query("set local role authenticated");
        await b.cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: viejo.id, role: "authenticated" })]);
        const registro = enCurso(registrarEn(b.cliente, r.id, "TRX-BANEADO"));
        await esperarBloqueo(b.pid, a.pid, registro);

        await a.cliente.query("update auth.users set banned_until = now() + interval '876000 hours' where id = $1", [viejo.id]);
        await a.cliente.query("commit");
        expect(await registro.promesa).toBe("sin_permiso");
        await b.cliente.query("commit");
      } finally {
        await cerrar(a, b);
      }
      expect(await reembolsoEnBd(r.id)).toEqual(antes);
    },
    60_000,
  );

  it(
    "y al revés: si el registro toma la fila primero, reasignar_casos_de_admin espera y, al confirmar el registro, ya no lo mueve",
    async () => {
      const r = await reembolso("pendiente");

      const a = await conexion();
      const b = await conexion();
      try {
        await a.cliente.query("begin");
        await como(a.cliente, admin);
        expect(await registrarEn(a.cliente, r.id, "TRX-ANTES")).toBe("reembolsado");

        await b.cliente.query("begin");
        const reasignacion = enCurso(reasignarCasosDe(b.cliente, admin));
        await esperarBloqueo(b.pid, a.pid, reasignacion);

        await a.cliente.query("commit");
        // El UPDATE de reasignar vuelve a mirar el estado de la fila ya confirmada: reembolsado no es un caso abierto.
        expect(await reasignacion.promesa).toBe(0);
        await b.cliente.query("commit");
      } finally {
        await cerrar(a, b);
      }
      expect(await reembolsoEnBd(r.id)).toMatchObject({ estado: "reembolsado", id_admin: admin.usuario.id, referencia_transferencia: "TRX-ANTES" });
    },
    60_000,
  );

  it(
    "quien pagó entrega la llave mientras el admin registra: el registro, que leyó «esperando la llave» sin candado, espera la fila y, al confirmar la entrega, registra la transferencia",
    async () => {
      const r = await reembolso("esperando_llave");
      const llave = `llave-${randomBytes(4).toString("hex")}`;

      const a = await conexion();
      const b = await conexion();
      try {
        // La puerta que usa la página del enlace (entregarLlavePorToken), con la llave secreta del servidor.
        await a.cliente.query("begin");
        await a.cliente.query("set local role service_role");
        const { rows } = await a.cliente.query<{ resultado: string }>("select public.entregar_llave($1, $2) as resultado", [r.token, llave]);
        expect(rows[0].resultado).toBe("entregada");

        await b.cliente.query("begin");
        await como(b.cliente, admin);
        const registro = enCurso(registrarEn(b.cliente, r.id, "TRX-CON-LLAVE"));
        await esperarBloqueo(b.pid, a.pid, registro);

        await a.cliente.query("commit");
        // Bajo el candado ya está pendiente: el registro decide con la fila bloqueada, no con lo que leyó antes.
        expect(await registro.promesa).toBe("reembolsado");
        await b.cliente.query("commit");
      } finally {
        await cerrar(a, b);
      }
      expect(await reembolsoEnBd(r.id)).toMatchObject({
        estado: "reembolsado",
        llave_destino: llave,
        id_admin: admin.usuario.id,
        referencia_transferencia: "TRX-CON-LLAVE",
      });
    },
    60_000,
  );
});
