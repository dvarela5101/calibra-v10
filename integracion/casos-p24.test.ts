import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import { cargarBandeja, type PagoPorCobrarOAsumir } from "@/lib/admin/bandeja";
import { cerrarCasoP24 } from "@/lib/admin/casos-p24";
import { estadoDelCaso, type CierreDeCaso } from "@/lib/admin/casos-p24-reglas";
import { cargarDesembolso, ejecutarDesembolso } from "@/lib/admin/desembolsos";
import { cargarPagoParaRevisar, revisarPago } from "@/lib/admin/pagos";
import { avisosDeLaPagina } from "@/lib/admin/pagos-reglas";
import { diaDelNegocio } from "@/lib/fechas";
import { diaIsoDeFecha, inicioDeSesion } from "@/lib/plazos/motor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-078 contra el Supabase local, por la misma ruta que la app: el admin asignado rechaza el pago con `revisarPago`
 * cuando la sesión ya empezó (P-24), el caso sale en `cargarBandeja` de cualquier admin, se cierra con `cerrarCasoP24`
 * (lo que llama la acción `cerrarCaso`, que además hace `exigirRol`, la lectura del formulario, `revalidatePath` y
 * `redirect`, que necesitan a Next) y la página lo lee con `cargarPagoParaRevisar`. El desembolso de la monitoría se mira
 * con `cargarDesembolso` y se ejecuta con `ejecutarDesembolso`, como en `integracion/desembolsos.test.ts`. Todo con la
 * sesión de verdad de cada cuenta, así que también se prueban los permisos de `public.cerrar_caso_p24`. Los bordes de
 * cada resultado, con una hora fija, están en `supabase/tests/casos_p24.test.sql`.
 *
 * Las monitorías se insertan con la llave secreta: la realizada, el lunes de hace dos semanas (su desembolso ya se puede
 * ejecutar), con la foto de su desembolso de `crearDesembolso` (bruto 25.000, comisión 2.500, neto 22.500); la que ya
 * empezó, hace 2 horas, en su propia franja (el cierre automático no la alcanza durante la prueba). Los pagos, con
 * `crearPagoDe`, en revisión y asignados al admin de la prueba: `registrar_pago` (HU-018) los asignaría al primer admin
 * activo de la base.
 *
 * El Auth local deja 30 inicios de sesión cada 5 minutos y el resto de la suite ya usa muchos: este archivo inicia tres,
 * una sola vez (el admin asignado, otro admin activo y un monitor). Cada prueba crea y borra todo lo demás.
 *
 * Dos cierres a la vez, y un cierre a la vez que la ejecución del desembolso de su monitoría, van con dos conexiones `pg`
 * reales, cada una en su transacción y con el rol y el token de su admin, como en `integracion/desembolsos.test.ts`: la
 * segunda espera el bloqueo de la primera.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;

/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;

/** Lo que anota el admin en el rechazo de P-24. */
const OBSERVACIONES = "Se cobra por fuera: el pagador vuelve a transferir esta semana.";

/** El otro admin se llama distinto del asignado, para saber de quién es cada nombre que muestra la página. */
const NOMBRE_DEL_OTRO_ADMIN = "Otro admin de prueba";

/** La foto que deja `crearDesembolso`. */
const FOTO = { monto_bruto: 25_000, comision: 2_500, monto_neto: 22_500, llave_destino: "llave-de-prueba" };

type Cuenta = { usuario: UsuarioPrueba; cliente: Cliente };

let fx: Fixtures;
let cuentas: Fixtures;
let bd: pg.Client;
/** Las tres sesiones del archivo: el admin al que se le asignan los pagos, otro admin activo y un monitor. */
let asignado: Cuenta;
let otroAdmin: Cuenta;
let monitor: Cuenta;

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  cuentas = new Fixtures();
  try {
    const cuenta = async (usuario: UsuarioPrueba): Promise<Cuenta> => ({ usuario, cliente: await cuentas.iniciarSesion(usuario) });
    asignado = await cuenta(await cuentas.crearAdmin());
    otroAdmin = await cuenta(await cuentas.crearAdmin());
    monitor = await cuenta(await cuentas.crearMonitor());
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
  // Después de los pagos y los desembolsos de cada prueba: pago.id_admin, pago.id_admin_cierre y desembolso.id_admin no
  // caen en cascada.
  await cuentas?.limpiar();
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
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

/** El lunes de hace `semanas` semanas o el anterior: su sesión de las 10:00 terminó hace más de 24 h. */
function lunesDeHace(semanas: number): string {
  let fecha = sumarDias(hoy(), -7 * semanas);
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

/** Día, día de la semana y hora (`HH:MM:SS`) de un instante en Bogotá, tal como los guarda la base. */
function sesionEn(instante: Date): { fecha: string; dia: number; hora: string } {
  const fecha = diaDelNegocio(instante);
  const hora = formatoDeHora.format(instante);
  if (inicioDeSesion(fecha, hora).getTime() !== instante.getTime()) throw new Error(`No se pudo expresar ${instante.toISOString()} como fecha y hora de Bogotá.`);
  return { fecha, dia: diaIsoDeFecha(fecha), hora };
}

/**
 * Una individual realizada el lunes de hace dos semanas (10:00 a 11:00, ya pasó fin + 24 h), con la foto de su
 * desembolso pendiente (`FOTO`).
 */
async function realizada() {
  const contexto = await fx.crearContextoDeMonitoria(asignado.usuario.id);
  const fecha = lunesDeHace(2);
  const monitoria = await fx.crearMonitoria(contexto, { fecha, estado: "realizada", fechaFinalizacion: `${fecha}T16:30:00+00:00` });
  const desembolso = await fx.crearDesembolso({ idMonitoria: monitoria.id });
  return { monitoria, fecha, desembolso };
}

/**
 * Una individual confirmada que empezó hace 2 horas, con su propia materia, monitor certificado, franja de 30 min y
 * Lead: así su franja no choca con otra del mismo monitor, sea el día que sea.
 */
async function yaEmpezada() {
  const sesion = sesionEn(new Date(Math.floor((Date.now() - 2 * HORA) / SEGUNDO) * SEGUNDO));
  const materia = await fx.crearMateria();
  const monitorDeLaCita = await fx.crearMonitor();
  await fx.crearCertificado({ idMonitor: monitorDeLaCita.id, idMateria: materia.id, idAdmin: asignado.usuario.id });
  const franja = await fx.crearFranja({ idMonitor: monitorDeLaCita.id, dia: sesion.dia, hora: sesion.hora, duracionMin: 30 });
  const lead = await fx.crearLead();
  const monitoria = await fx.crearMonitoria({ materia, monitor: monitorDeLaCita, franja, lead }, { fecha: sesion.fecha, estado: "confirmada" });
  return { monitoria, fecha: sesion.fecha };
}

/** Un pago en revisión de esa monitoría, asignado al admin de la prueba, con un pagador que solo existe en esta prueba. */
const pagoEnRevision = (idMonitoria: string, monto = 25_000) =>
  fx.crearPagoDe(idMonitoria, { idAdmin: asignado.usuario.id, monto, nombrePagador: `Pagador ${randomUUID().slice(0, 8)}` });

/** P-24: el asignado lo rechaza con las observaciones, por la misma función que la acción, y la monitoría no se cancela. */
async function rechazarEnP24(idPago: string) {
  expect(await revisarPago(asignado.cliente, { idPago, decision: "rechazar", observaciones: OBSERVACIONES })).toEqual({
    resultado: "rechazado",
    canceloMonitoria: false,
  });
}

/** Un caso P-24 abierto: el pago de una monitoría realizada, rechazado por el asignado. */
async function casoAbierto(monto = 25_000) {
  const r = await realizada();
  const pago = await pagoEnRevision(r.monitoria.id, monto);
  await rechazarEnP24(pago.id);
  return { ...r, pago };
}

/** Lo mismo que hace la acción con lo que llega del formulario (ya validado por `leerCierre`). */
const cerrarCaso = (cuenta: Pick<Cuenta, "cliente">, idPago: string, cierre: CierreDeCaso, nota: string | null = null) =>
  cerrarCasoP24(cuenta.cliente, { idPago, cierre, nota });

const pagoEnBd = async (id: string) =>
  exito(
    await fx.admin
      .from("pago")
      .select("estado, observaciones, fecha_revision, id_admin_revisor, cierre_rechazo, nota_cierre, id_admin_cierre, fecha_cierre")
      .eq("id", id)
      .single(),
    "leer el pago",
  );

const SIN_CIERRE = { cierre_rechazo: null, nota_cierre: null, id_admin_cierre: null, fecha_cierre: null };

const monitoriaEnBd = async (id: string) =>
  exito(await fx.admin.from("monitoria").select("estado, motivo_cancelacion, fecha_finalizacion").eq("id", id).single(), "leer la monitoría");

/** Los casos de esta prueba que un admin ve en «Pagos por cobrar o asumir»: cualquier admin ve los de todos, también de otras pruebas. */
async function casosDeLaBandeja(cuenta: Cuenta, ...pagos: { id: string }[]): Promise<PagoPorCobrarOAsumir[]> {
  const bandeja = await cargarBandeja(cuenta.cliente, cuenta.usuario.id, new Date(), { maxFilas: 1_000 });
  return bandeja.pagosPorCobrarOAsumir.filter((caso) => pagos.some((pago) => pago.id === caso.id));
}

const COLUMNAS = "id, estado, monto_bruto, comision, monto_neto, llave_destino, id_admin, referencia_transferencia, fecha_desembolso";

const desembolsoEnBd = async (id: string) => exito(await fx.admin.from("desembolso").select(COLUMNAS).eq("id", id).single(), "leer el desembolso");

/** Lo mismo que hace la acción del desembolso con lo que llega del formulario (ya validado por `leerEjecucion`). */
const ejecutar = (cliente: Cliente, idDesembolso: string, netoEsperado: number) =>
  ejecutarDesembolso(cliente, { idDesembolso, referencia: `TRX-${randomUUID().slice(0, 8)}`, fecha: hoy(), netoEsperado });

/** Los desembolsos ejecutables que ve el admin asignado en su bandeja (la vista de HU-028), sin el corte de la lista. */
const desembolsosDeLaBandeja = async () =>
  (await cargarBandeja(asignado.cliente, asignado.usuario.id, new Date(), { maxFilas: 1_000 })).desembolsos.map((d) => d.id);

/** La hora de la base (la que usa `cerrar_caso_p24`), no la del proceso. */
async function relojDeLaBase(): Promise<number> {
  const { rows } = await bd.query<{ ahora: Date }>("select clock_timestamp() as ahora");
  return rows[0].ahora.getTime();
}

/** Sin filas: el permiso se niega (error) o la RLS no deja ver ninguna; en ningún caso hay filas afectadas. */
function sinFilas(resultado: { data: unknown[] | null; error: { message: string } | null }) {
  expect(resultado.error ? [] : resultado.data).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------------------
// Con `pg`: dos conexiones a la vez, cada una como la sesión de un admin

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
async function cerrarConexiones(...conexiones: Conexion[]) {
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
async function como(cliente: pg.Client, cuenta: Cuenta) {
  await cliente.query("set local role authenticated");
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: cuenta.usuario.id, role: "authenticated" })]);
}

/** `public.cerrar_caso_p24`, la misma puerta que usa `cerrarCasoP24`, desde una conexión que ya corre como un admin. */
async function cerrarEn(cliente: pg.Client, idPago: string, cierre: CierreDeCaso, nota: string | null) {
  const { rows } = await cliente.query<{ resultado: string }>("select public.cerrar_caso_p24($1::uuid, $2, $3) as resultado", [idPago, cierre, nota]);
  return rows[0].resultado;
}

/** `public.ejecutar_desembolso`, la misma puerta que usa `ejecutarDesembolso`, desde una conexión que ya corre como un admin. */
async function ejecutarEn(cliente: pg.Client, idDesembolso: string, referencia: string, netoEsperado: number) {
  const { rows } = await cliente.query<{ resultado: string }>("select public.ejecutar_desembolso($1::uuid, $2, $3::date, $4) as resultado", [
    idDesembolso,
    referencia,
    hoy(),
    netoEsperado,
  ]);
  return rows[0].resultado;
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterios 1 y 5 (P-24): el pago rechazado de una sesión que ya empezó queda por cobrar o asumir", () => {
  const casos: [string, () => Promise<{ monitoria: { id: string }; fecha: string }>][] = [
    ["realizada", realizada],
    ["confirmada que empezó hace 2 horas", yaEmpezada],
  ];

  it.each(casos)(
    "%s: el asignado lo rechaza con observaciones, la monitoría no cambia y el caso sale en la bandeja de cualquier admin con el pagador, su contacto, el monto, la monitoría y las observaciones; la página lo pinta abierto y lo dice; un monitor no lo ve",
    async (_monitoria, crear) => {
      const { monitoria, fecha } = await crear();
      const pago = await pagoEnRevision(monitoria.id, 32_000);
      const antes = await monitoriaEnBd(monitoria.id);
      // En revisión todavía no es un caso: está en «Pagos por revisar».
      expect(await casosDeLaBandeja(asignado, pago)).toEqual([]);

      await rechazarEnP24(pago.id);

      const enBd = await pagoEnBd(pago.id);
      expect(enBd).toMatchObject({ estado: "rechazado", observaciones: OBSERVACIONES, id_admin_revisor: asignado.usuario.id, ...SIN_CIERRE });
      expect(await monitoriaEnBd(monitoria.id)).toEqual(antes);

      // Criterio 1 y supuesto 2: lo ven el admin que lo rechazó y cualquier otro admin activo, igual.
      const esperado: PagoPorCobrarOAsumir = {
        id: pago.id,
        nombrePagador: pago.nombre_pagador,
        contacto: "pagador@calibra.test",
        monto: 32_000,
        observaciones: OBSERVACIONES,
        rechazadoEn: new Date(enBd.fecha_revision!),
        monitoria: { fecha, nombreMateria: "Materia de prueba", nombreMonitor: "Monitor de prueba" },
      };
      expect(await casosDeLaBandeja(asignado, pago)).toEqual([esperado]);
      expect(await casosDeLaBandeja(otroAdmin, pago)).toEqual([esperado]);
      // Ya no está entre los que el asignado tiene por revisar.
      expect((await cargarBandeja(asignado.cliente, asignado.usuario.id)).pagos.map((p) => p.id)).not.toContain(pago.id);

      // La página lo lee abierto, sin cierre, y (criterio 5) tras el rechazo dice que el caso quedó en la sección.
      const leido = await cargarPagoParaRevisar(otroAdmin.cliente, pago.id);
      expect(leido).toMatchObject({ estado: "rechazado", observaciones: OBSERVACIONES, cierre: null });
      const caso = estadoDelCaso(leido!.estado, leido!.monitoria.estado, null);
      expect(caso).toBe("abierto");
      expect(avisosDeLaPagina({ revisado: "rechazado" }, { ...leido!, caso })).toEqual([
        {
          exito: true,
          texto: "Rechazaste el pago. El caso quedó en «Pagos por cobrar o asumir» de la bandeja hasta que alguien lo cierre como cobrado o asumido.",
        },
      ]);

      // Las políticas de pago son solo de admins: el monitor no lo ve.
      const delMonitor = await cargarBandeja(monitor.cliente, monitor.usuario.id);
      expect(delMonitor.pagosPorCobrarOAsumir).toEqual([]);
      expect(delMonitor.contadores.pagosPorCobrarOAsumir).toBe(0);
    },
  );
});

describe("criterio 2: un admin activo cierra el caso como cobrado o asumido", () => {
  const cierres: [CierreDeCaso, string | null][] = [
    ["cobrado", "Pagó por fuera el martes, con la misma referencia."],
    ["asumido", null],
  ];

  it.each(cierres)(
    "%s: otro admin lo cierra; queda cómo, la nota, quién y cuándo, el pago sigue rechazado, sale de la bandeja de los dos admins y la página lo pinta cerrado; cerrarlo otra vez responde ya_cerrado y no cambia nada",
    async (cierre, nota) => {
      const { monitoria, pago } = await casoAbierto();
      const monitoriaAntes = await monitoriaEnBd(monitoria.id);
      const antes = await relojDeLaBase();

      // Supuesto 2: lo cierra cualquier admin activo, no solo el que rechazó el pago.
      expect(await cerrarCaso(otroAdmin, pago.id, cierre, nota)).toBe("cerrado");

      const despues = await relojDeLaBase();
      const enBd = await pagoEnBd(pago.id);
      expect(enBd).toMatchObject({
        estado: "rechazado",
        observaciones: OBSERVACIONES,
        id_admin_revisor: asignado.usuario.id,
        cierre_rechazo: cierre,
        nota_cierre: nota,
        id_admin_cierre: otroAdmin.usuario.id,
      });
      const cerrado = new Date(enBd.fecha_cierre!).getTime();
      expect(cerrado).toBeGreaterThanOrEqual(antes);
      expect(cerrado).toBeLessThanOrEqual(despues);
      // Cerrar el caso no toca la monitoría (RN-43: tampoco hay reembolso).
      expect(await monitoriaEnBd(monitoria.id)).toEqual(monitoriaAntes);

      // Sale de la sección para todos.
      expect(await casosDeLaBandeja(asignado, pago)).toEqual([]);
      expect(await casosDeLaBandeja(otroAdmin, pago)).toEqual([]);

      // La página dice cómo, quién y cuándo, con la nota si la hay.
      const leido = await cargarPagoParaRevisar(asignado.cliente, pago.id);
      expect(leido?.cierre).toEqual({ como: cierre, nota, idAdmin: otroAdmin.usuario.id, nombreAdmin: NOMBRE_DEL_OTRO_ADMIN, fecha: new Date(enBd.fecha_cierre!) });
      expect(estadoDelCaso(leido!.estado, leido!.monitoria.estado, leido!.cierre!.como)).toBe("cerrado");

      // D-38: no se deshace ni se rehace, ni con el otro cierre, ni el mismo admin, ni otro.
      const otro: CierreDeCaso = cierre === "cobrado" ? "asumido" : "cobrado";
      expect(await cerrarCaso(asignado, pago.id, otro, "Otra nota.")).toBe("ya_cerrado");
      expect(await cerrarCaso(otroAdmin, pago.id, cierre, nota)).toBe("ya_cerrado");
      expect(await pagoEnBd(pago.id)).toEqual(enBd);
    },
  );
});

describe("supuesto 1: lo que no es un caso no sale en la sección ni se cierra", () => {
  it("un pago aprobado, uno en revisión y uno rechazado que canceló su cita responden no_es_caso; uno que no existe, no_encontrado; nada cambia", async () => {
    const contexto = await fx.crearContextoDeMonitoria(asignado.usuario.id);
    // 2030-01-07 y 2030-01-14 caen en lunes, el día de la franja: la sesión todavía no empieza.
    const futura = await fx.crearMonitoria(contexto, { fecha: "2030-01-07" });
    const otraFutura = await fx.crearMonitoria(contexto, { fecha: "2030-01-14" });
    const aprobado = await fx.crearPagoDe(futura.id, { idAdmin: asignado.usuario.id, estado: "aprobado" });
    const enRevision = await pagoEnRevision(futura.id);
    // Rechazarlo cancela la cita (RN-43): no hay nada que cobrar ni asumir.
    const queCancelo = await pagoEnRevision(otraFutura.id);
    expect(await revisarPago(asignado.cliente, { idPago: queCancelo.id, decision: "rechazar", observaciones: null })).toEqual({
      resultado: "rechazado",
      canceloMonitoria: true,
    });
    expect(await monitoriaEnBd(otraFutura.id)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });

    const pagos = [aprobado, enRevision, queCancelo];
    const antes = await Promise.all(pagos.map((p) => pagoEnBd(p.id)));
    expect(await casosDeLaBandeja(otroAdmin, ...pagos)).toEqual([]);

    for (const pago of pagos) expect(await cerrarCaso(otroAdmin, pago.id, "asumido"), pago.id).toBe("no_es_caso");
    expect(await cerrarCaso(otroAdmin, randomUUID(), "asumido")).toBe("no_encontrado");

    expect(await Promise.all(pagos.map((p) => pagoEnBd(p.id)))).toEqual(antes);
    for (const fila of antes) expect(fila).toMatchObject(SIN_CIERRE);
  });
});

describe("supuesto 2: solo un admin activo cierra, y solo por la función", () => {
  it("un monitor recibe sin_permiso; sin sesión la base ni siquiera ejecuta la función; una nota de 501 caracteres da nota_invalida; el caso sigue abierto", async () => {
    const { pago } = await casoAbierto();
    const antes = await pagoEnBd(pago.id);

    expect(await cerrarCaso(monitor, pago.id, "asumido")).toBe("sin_permiso");
    await expect(cerrarCaso({ cliente: crearCliente() }, pago.id, "asumido")).rejects.toThrow(/No se pudo cerrar el caso: 42501/);
    expect(await cerrarCaso(asignado, pago.id, "cobrado", "a".repeat(501))).toBe("nota_invalida");

    expect(await pagoEnBd(pago.id)).toEqual(antes);
    expect(await casosDeLaBandeja(asignado, pago)).toHaveLength(1);
  });

  it("nadie escribe el cierre directo en pago: ni un admin activo con su sesión puede hacerlo por la Data API", async () => {
    const { pago } = await casoAbierto();
    const antes = await pagoEnBd(pago.id);

    sinFilas(
      await otroAdmin.cliente
        .from("pago")
        .update({ cierre_rechazo: "asumido", id_admin_cierre: otroAdmin.usuario.id, fecha_cierre: new Date().toISOString() })
        .eq("id", pago.id)
        .select(),
    );

    expect(await pagoEnBd(pago.id)).toEqual(antes);
    expect(await casosDeLaBandeja(asignado, pago)).toHaveLength(1);
  });
});

describe("criterios 3 y 4 (D-39): el desembolso de la monitoría espera el caso y después lo cuenta", () => {
  it.each(["cobrado", "asumido"] as const)(
    "%s: con el caso abierto la bandeja no lo lista, la página da caso_abierto y ejecutar responde lo mismo; cerrado, el neto suma el pago rechazado con la misma comisión, el neto viejo da monto_cambio y con el nuevo se ejecuta",
    async (cierre) => {
      const { monitoria, desembolso } = await realizada();
      await fx.crearPagoDe(monitoria.id, { idAdmin: asignado.usuario.id, estado: "aprobado", monto: 25_000 });
      const pago = await pagoEnRevision(monitoria.id, 12_000);
      // Con el pago en revisión espera su revisión (HU-028, D-39).
      expect((await cargarDesembolso(asignado.cliente, desembolso.id))?.motivo).toBe("pagos_en_revision");

      await rechazarEnP24(pago.id);

      // Criterio 4: el caso abierto lo bloquea, en la bandeja, en la página y al ejecutar.
      expect(await desembolsosDeLaBandeja()).not.toContain(desembolso.id);
      // El neto de ahora solo cuenta el aprobado: 25.000, comisión de 2.500 y neto de 22.500.
      expect(await cargarDesembolso(asignado.cliente, desembolso.id)).toMatchObject({ motivo: "caso_abierto", montoNeto: 22_500, ejecucion: null });
      const antes = await desembolsoEnBd(desembolso.id);
      expect(await ejecutar(asignado.cliente, desembolso.id, 22_500)).toBe("caso_abierto");
      expect(await desembolsoEnBd(desembolso.id)).toEqual(antes);

      expect(await cerrarCaso(otroAdmin, pago.id, cierre)).toBe("cerrado");

      // Criterio 3: 37.000 (el aprobado y el rechazado con el caso cerrado), comisión de 3.700 (RN-81) y neto de 33.300.
      expect(await desembolsosDeLaBandeja()).toContain(desembolso.id);
      expect(await cargarDesembolso(otroAdmin.cliente, desembolso.id)).toMatchObject({ motivo: null, montoNeto: 33_300 });
      // P-29: se recalcula al ejecutar, así que el neto de antes del cierre ya no vale.
      expect(await ejecutar(asignado.cliente, desembolso.id, 22_500)).toBe("monto_cambio");
      expect(await desembolsoEnBd(desembolso.id)).toEqual(antes);
      expect(await ejecutar(asignado.cliente, desembolso.id, 33_300)).toBe("desembolsado");
      expect(await desembolsoEnBd(desembolso.id)).toMatchObject({
        estado: "desembolsado",
        monto_bruto: 37_000,
        comision: 3_700,
        monto_neto: 33_300,
        llave_destino: FOTO.llave_destino,
        id_admin: asignado.usuario.id,
      });
    },
  );

  it("supuestos 4 y 5: si el único pago es el rechazado, con el caso abierto no hay nada que ejecutar; cerrado, se ejecuta con su monto", async () => {
    const { desembolso, pago } = await casoAbierto(25_000);
    expect(await cargarDesembolso(asignado.cliente, desembolso.id)).toMatchObject({ motivo: "caso_abierto", montoNeto: 0 });
    expect(await ejecutar(asignado.cliente, desembolso.id, 0)).toBe("caso_abierto");

    expect(await cerrarCaso(asignado, pago.id, "asumido")).toBe("cerrado");

    expect(await cargarDesembolso(asignado.cliente, desembolso.id)).toMatchObject({ motivo: null, montoNeto: FOTO.monto_neto });
    expect(await ejecutar(asignado.cliente, desembolso.id, FOTO.monto_neto)).toBe("desembolsado");
    expect(await desembolsoEnBd(desembolso.id)).toMatchObject({ estado: "desembolsado", monto_bruto: FOTO.monto_bruto, comision: FOTO.comision, monto_neto: FOTO.monto_neto });
  });
});

describe("dos cierres a la vez, y un cierre a la vez que la ejecución del desembolso", () => {
  it(
    "dos admins cierran el mismo caso: el primero bloquea la monitoría y el pago; el segundo espera, recibe ya_cerrado y el caso queda como lo cerró el primero",
    async () => {
      const { pago } = await casoAbierto();

      const a = await conexion();
      const b = await conexion();
      try {
        await a.cliente.query("begin");
        await como(a.cliente, asignado);
        expect(await cerrarEn(a.cliente, pago.id, "cobrado", "Lo cerró el primero.")).toBe("cerrado");

        await b.cliente.query("begin");
        await como(b.cliente, otroAdmin);
        const segunda = enCurso(cerrarEn(b.cliente, pago.id, "asumido", null));
        await esperarBloqueo(b.pid, a.pid, segunda);

        await a.cliente.query("commit");
        expect(await segunda.promesa).toBe("ya_cerrado");
        await b.cliente.query("commit");
      } finally {
        await cerrarConexiones(a, b);
      }
      expect(await pagoEnBd(pago.id)).toMatchObject({
        estado: "rechazado",
        cierre_rechazo: "cobrado",
        nota_cierre: "Lo cerró el primero.",
        id_admin_cierre: asignado.usuario.id,
      });
    },
    60_000,
  );

  it(
    "un admin cierra el caso y otro ejecuta el desembolso de esa monitoría: la ejecución espera el bloqueo de la monitoría y, cuando el cierre se confirma, se ejecuta con el monto que ya cuenta el pago rechazado",
    async () => {
      const { monitoria, desembolso } = await realizada();
      await fx.crearPagoDe(monitoria.id, { idAdmin: asignado.usuario.id, estado: "aprobado", monto: 25_000 });
      const pago = await pagoEnRevision(monitoria.id, 12_000);
      await rechazarEnP24(pago.id);

      const a = await conexion();
      const b = await conexion();
      try {
        await a.cliente.query("begin");
        await como(a.cliente, asignado);
        expect(await cerrarEn(a.cliente, pago.id, "asumido", null)).toBe("cerrado");

        // Quien ejecuta ya cuenta con el neto que incluye el pago (33.300): si leyera el caso abierto, respondería caso_abierto.
        await b.cliente.query("begin");
        await como(b.cliente, otroAdmin);
        const ejecucion = enCurso(ejecutarEn(b.cliente, desembolso.id, "TRX-CON-EL-CASO", 33_300));
        await esperarBloqueo(b.pid, a.pid, ejecucion);

        await a.cliente.query("commit");
        expect(await ejecucion.promesa).toBe("desembolsado");
        await b.cliente.query("commit");
      } finally {
        await cerrarConexiones(a, b);
      }
      expect(await desembolsoEnBd(desembolso.id)).toMatchObject({
        estado: "desembolsado",
        monto_bruto: 37_000,
        comision: 3_700,
        monto_neto: 33_300,
        id_admin: otroAdmin.usuario.id,
        referencia_transferencia: "TRX-CON-EL-CASO",
      });
    },
    60_000,
  );
});
