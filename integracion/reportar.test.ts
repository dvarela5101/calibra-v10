import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import { reportarInasistenciaDeMiCita, reportarInasistenciaPorToken } from "@/lib/citas/reportar";
import { leerCitaPorToken, leerMiCita } from "@/lib/citas/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { diaIsoDeFecha, inicioDeSesion } from "@/lib/plazos/motor";
import { exigirSupabaseLocal, exito, Fixtures, type UsuarioPrueba } from "./utilidades";

/**
 * HU-029 contra el Supabase local, por el mismo código que usa la acción de la página de la cita: `reportarInasistenciaPorToken`
 * (el enlace del correo, con la llave secreta) y `reportarInasistenciaDeMiCita` (la sesión del navegador que agendó), y
 * `leerCitaPorToken` y `leerMiCita` para ver lo que la página muestra después. Los bordes de la ventana, el orden de las
 * comprobaciones, los permisos por rol y la vista de la bandeja están en `supabase/tests/reportar_inasistencia.test.sql`.
 *
 * Lo que solo se ve con dos conexiones `pg` reales, como en `integracion/desembolsos.test.ts`: reportar bloquea primero la
 * monitoría con `for update` (no con `for no key update`), así que queda en fila con `ejecutar_desembolso` de HU-028, que
 * bloquea la monitoría y después el desembolso. Esas pruebas llaman el corazón (`privado.reportar_inasistencia`) como dueño
 * de la base, con una hora dentro de la ventana de una monitoría de hace semanas, para que el desembolso ya sea ejecutable.
 *
 * Las monitorías que se reportan por las puertas empezaron hace 2 horas, cada una en su propia franja (una franja no tiene
 * dos activas el mismo día): el cierre automático no las alcanza mientras corre la prueba. Las del enlace del correo se
 * crean `pendiente_pago` y se confirman con un UPDATE, para que el trigger de HU-019 anote su token. Los reportes los crean
 * las funciones, no `crearReporte`, así que la prueba los borra antes de `limpiar()`. Una sola sesión anónima (la del Lead
 * que agendó) y ningún inicio de sesión con contraseña: el Auth local tiene un tope por IP y la suite ya usa muchos.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;

type Contexto = Awaited<ReturnType<Fixtures["crearContextoDeMonitoria"]>>;
type Lead = Awaited<ReturnType<Fixtures["crearLead"]>>;

let fx: Fixtures;
let bd: pg.Client;
let admin: UsuarioPrueba;
let monitor: UsuarioPrueba;
let materia: Contexto["materia"];
/** La sesión anónima que agendó (es Lead) y su Lead. */
let ancla: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
let leadDeAncla: Lead;
let otroLead: Lead;
const monitorias: string[] = [];

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  fx = new Fixtures();
  try {
    admin = await fx.crearAdmin();
    ({ materia } = await fx.crearEvaluacion());
    monitor = await fx.crearMonitor({ conContacto: true });
    await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
    ancla = await fx.crearAnonimo();
    leadDeAncla = await fx.crearLeadDeSesion(ancla.id);
    otroLead = await fx.crearLead();
  } catch (error) {
    await bd.end();
    await fx.limpiar();
    throw error;
  }
}, 60_000);

afterAll(async () => {
  if (fx) {
    // Los reportes los crearon las funciones: `limpiar()` solo borra los de `crearReporte`, y la llave foránea impide
    // borrar antes la monitoría.
    if (monitorias.length) await fx.admin.from("reporte_inasistencia").delete().in("id_monitoria", monitorias);
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

/** Día, día de la semana y hora (`HH:MM:SS`) de un instante en Bogotá, tal como los guarda la base. */
function sesionEn(instante: Date): { fecha: string; dia: number; hora: string } {
  const fecha = diaDelNegocio(instante);
  const hora = formatoDeHora.format(instante);
  if (inicioDeSesion(fecha, hora).getTime() !== instante.getTime()) throw new Error(`No se pudo expresar ${instante.toISOString()} como fecha y hora de Bogotá.`);
  return { fecha, dia: diaIsoDeFecha(fecha), hora };
}

/** Una franja propia del monitor de la prueba para ese día y hora (presencial, 60 min). */
async function franjaEn(dia: number, hora: string) {
  return fx.crearFranja({ idMonitor: monitor.id, dia, hora });
}

/**
 * Una individual del Lead `lead` que empieza `horas` horas antes de ahora (negativo: en el futuro), en su propia franja.
 * Nace `pendiente_pago` y se confirma con un UPDATE, como `registrar_pago`: el trigger de HU-019 le anota su token.
 */
async function confirmadaQueEmpezoHace(horas: number, lead: Lead = leadDeAncla) {
  const sesion = sesionEn(new Date(Math.floor((Date.now() - horas * HORA) / MINUTO) * MINUTO));
  const franja = await franjaEn(sesion.dia, sesion.hora);
  const contexto = { materia, monitor, franja, lead } as Contexto;
  const monitoria = await fx.crearMonitoria(contexto, { fecha: sesion.fecha, estado: "pendiente_pago" });
  monitorias.push(monitoria.id);
  exito(await fx.admin.from("monitoria").update({ estado: "confirmada" }).eq("id", monitoria.id).select().single(), "confirmar la monitoría");
  return monitoria;
}

/**
 * Una individual realizada el lunes de hace `semanas` semanas (10:00 a 11:00: ya pasó fin + 24 h), con un pago aprobado
 * y su desembolso pendiente: sin reporte, HU-028 la deja ejecutar. `dentroDeLaVentana` es una hora en la que todavía se
 * podía reportar (una hora después del inicio), para llamar el corazón con su `p_ahora`.
 */
async function realizadaConDesembolso(semanas: number) {
  const fecha = lunesDeHace(semanas);
  const franja = await franjaEn(1, "10:00");
  const contexto = { materia, monitor, franja, lead: otroLead } as Contexto;
  const monitoria = await fx.crearMonitoria(contexto, { fecha, estado: "realizada", fechaFinalizacion: `${fecha}T16:00:00+00:00` });
  monitorias.push(monitoria.id);
  await fx.crearPagoDe(monitoria.id, { idAdmin: admin.id, estado: "aprobado" });
  const desembolso = await fx.crearDesembolso({ idMonitoria: monitoria.id });
  return { monitoria, desembolso, dentroDeLaVentana: new Date(inicioDeSesion(fecha, "10:00").getTime() + HORA) };
}

async function tokenDe(idMonitoria: string): Promise<string> {
  const filas = exito(await fx.admin.from("confirmacion_cita").select("token").eq("id_monitoria", idMonitoria), "leer la confirmación");
  if (!filas[0]) throw new Error(`La monitoría ${idMonitoria} no tiene confirmación anotada.`);
  return filas[0].token;
}

async function reportesDe(idMonitoria: string) {
  return exito(
    await fx.admin.from("reporte_inasistencia").select("estado, id_admin, fecha_reporte, fecha_decision, observaciones").eq("id_monitoria", idMonitoria),
    "leer los reportes",
  );
}

async function estadoDe(idMonitoria: string) {
  return exito(await fx.admin.from("monitoria").select("estado, motivo_cancelacion").eq("id", idMonitoria).single(), "leer la monitoría");
}

/** El primer admin activo de la base (el turno de D-26): puede ser uno de la semilla o el de la prueba. */
async function primerAdminActivo(): Promise<string | null> {
  const { rows } = await bd.query<{ id: string | null }>("select privado.siguiente_admin_activo() as id");
  return rows[0].id;
}

// ---------------------------------------------------------------------------------------------------------------
// Con `pg`: dos conexiones a la vez, como en `integracion/desembolsos.test.ts`
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

/** Dentro de una transacción de `cliente`: lo que sigue corre con el rol `authenticated` y el token del admin de la prueba. */
async function comoAdmin(cliente: pg.Client) {
  await cliente.query("set local role authenticated");
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
}

/** El corazón del reporte, que nadie ejecuta desde la Data API (la prueba lo corre como dueño de la base). */
async function reportarEn(cliente: pg.Client, idMonitoria: string, ahora: Date) {
  const { rows } = await cliente.query<{ r: string }>("select privado.reportar_inasistencia($1::uuid, $2::timestamptz) as r", [idMonitoria, ahora.toISOString()]);
  return rows[0].r;
}

/** Lo que responde `public.estado_para_ejecutar` (la página del desembolso de HU-028) al admin de la prueba. */
async function motivoParaEjecutar(idDesembolso: string): Promise<string | null> {
  const c = await conexion();
  try {
    await c.cliente.query("begin");
    await comoAdmin(c.cliente);
    const { rows } = await c.cliente.query<{ motivo: string | null }>("select motivo from public.estado_para_ejecutar($1::uuid)", [idDesembolso]);
    await c.cliente.query("rollback");
    if (rows.length !== 1) throw new Error(`estado_para_ejecutar devolvió ${rows.length} filas para el admin de la prueba.`);
    return rows[0].motivo;
  } finally {
    await cerrar(c);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Criterio 1: quien agendó reporta y queda un reporte en revisión asignado a un admin
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: quien agendó reporta una individual que ya empezó y queda un reporte en_revision asignado a un admin", () => {
  it("con el enlace del correo (token, llave secreta): reportada, asignado al primer admin activo y sin tocar la monitoría; la cita ya muestra el reporte en revisión", async () => {
    const monitoria = await confirmadaQueEmpezoHace(2);
    const token = await tokenDe(monitoria.id);
    const asignado = await primerAdminActivo();
    expect(asignado).not.toBeNull();

    expect(await reportarInasistenciaPorToken(token)).toBe("reportada");

    const [reporte, ...otros] = await reportesDe(monitoria.id);
    expect(otros).toEqual([]);
    expect(reporte).toMatchObject({ estado: "en_revision", id_admin: asignado, fecha_decision: null, observaciones: null });
    // La hora la pone la base (now()), no el navegador.
    expect(Math.abs(new Date(reporte.fecha_reporte).getTime() - Date.now())).toBeLessThan(MINUTO);
    // Decidir el reporte es de HU-030: la monitoría sigue confirmada.
    expect(await estadoDe(monitoria.id)).toEqual({ estado: "confirmada", motivo_cancelacion: null });
    expect(await leerCitaPorToken(token)).toMatchObject({ idMonitoria: monitoria.id, estadoReporte: "en_revision", observacionesReporte: null });
  });

  it("con la sesión del navegador que agendó (sin el enlace): reportada; la cita de la sesión muestra el reporte en revisión", async () => {
    const monitoria = await confirmadaQueEmpezoHace(2);

    expect(await reportarInasistenciaDeMiCita(ancla.cliente, monitoria.id)).toBe("reportada");

    expect(await reportesDe(monitoria.id)).toEqual([expect.objectContaining({ estado: "en_revision", fecha_decision: null })]);
    expect(await leerMiCita(ancla.cliente, monitoria.id)).toMatchObject({ estado: "confirmada", estadoReporte: "en_revision", observacionesReporte: null });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 3: con reporte o fuera de la ventana no se puede
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 3: si ya tiene reporte o pasó la ventana, no se puede reportar", () => {
  it("un segundo reporte, por cualquiera de las dos puertas, responde ya_reportada y no crea otra fila", async () => {
    const monitoria = await confirmadaQueEmpezoHace(2);
    const token = await tokenDe(monitoria.id);
    expect(await reportarInasistenciaDeMiCita(ancla.cliente, monitoria.id)).toBe("reportada");

    expect(await reportarInasistenciaPorToken(token)).toBe("ya_reportada");
    expect(await reportarInasistenciaDeMiCita(ancla.cliente, monitoria.id)).toBe("ya_reportada");
    expect(await reportesDe(monitoria.id)).toHaveLength(1);
  });

  it("una que empezó hace 30 h (la sesión de 60 min terminó hace 29 h) responde fuera_de_ventana por las dos puertas, y una que empieza en 2 h, aun_no_empieza: ninguna crea reporte", async () => {
    const vencida = await confirmadaQueEmpezoHace(30);
    expect(await reportarInasistenciaPorToken(await tokenDe(vencida.id))).toBe("fuera_de_ventana");
    expect(await reportarInasistenciaDeMiCita(ancla.cliente, vencida.id)).toBe("fuera_de_ventana");

    const futura = await confirmadaQueEmpezoHace(-2);
    expect(await reportarInasistenciaPorToken(await tokenDe(futura.id))).toBe("aun_no_empieza");
    expect(await reportarInasistenciaDeMiCita(ancla.cliente, futura.id)).toBe("aun_no_empieza");

    expect(await reportesDe(vencida.id)).toEqual([]);
    expect(await reportesDe(futura.id)).toEqual([]);
  });

  it("la cita de otro Lead, por la sesión del navegador: no_existe, igual que si no existiera, y no crea nada", async () => {
    const ajena = await confirmadaQueEmpezoHace(2, otroLead);
    expect(await reportarInasistenciaDeMiCita(ancla.cliente, ajena.id)).toBe("no_existe");
    expect(await reportesDe(ajena.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D-37: lo que decide el admin llega a la página
// ---------------------------------------------------------------------------------------------------------------

describe("D-37: cuando un admin decide el reporte (HU-030), la página de la cita recibe su estado y las observaciones", () => {
  it("rechazado con texto: las dos lecturas de la cita traen el texto sin espacios de los lados", async () => {
    const monitoria = await confirmadaQueEmpezoHace(2);
    const token = await tokenDe(monitoria.id);
    expect(await reportarInasistenciaDeMiCita(ancla.cliente, monitoria.id)).toBe("reportada");
    // Lo que hará HU-030 al rechazarlo.
    exito(
      await fx.admin
        .from("reporte_inasistencia")
        .update({ estado: "rechazado", fecha_decision: new Date().toISOString(), observaciones: "  El monitor mostró que sí asistió.\n" })
        .eq("id_monitoria", monitoria.id)
        .select()
        .single(),
      "rechazar el reporte",
    );

    const esperado = { estadoReporte: "rechazado", observacionesReporte: "El monitor mostró que sí asistió." };
    expect(await leerCitaPorToken(token)).toMatchObject(esperado);
    expect(await leerMiCita(ancla.cliente, monitoria.id)).toMatchObject(esperado);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 2 (RN-83): el reporte suspende el desembolso, también con dos conexiones a la vez
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 2 (RN-83): con un reporte en revisión el desembolso queda suspendido, y reportar queda en fila con ejecutarlo", () => {
  it(
    "reportar bloquea la monitoría con for update: espera a quien tiene su fila con for key share (lo que toma insertar un pago o un reporte de esa monitoría), que for no key update no esperaría",
    async () => {
      const { monitoria, dentroDeLaVentana } = await realizadaConDesembolso(3);

      const a = await conexion();
      const b = await conexion();
      try {
        await a.cliente.query("begin");
        await a.cliente.query("select 1 from public.monitoria where id = $1 for key share", [monitoria.id]);

        await b.cliente.query("begin");
        const reporte = enCurso(reportarEn(b.cliente, monitoria.id, dentroDeLaVentana));
        await esperarBloqueo(b.pid, a.pid, reporte);

        await a.cliente.query("commit");
        expect(await reporte.promesa).toBe("reportada");
        await b.cliente.query("commit");
      } finally {
        await cerrar(a, b);
      }
      expect(await reportesDe(monitoria.id)).toEqual([expect.objectContaining({ estado: "en_revision" })]);
    },
    60_000,
  );

  it(
    "si el reporte llega primero, el admin que ejecuta el desembolso espera la monitoría y recibe con_reporte; el desembolso sigue pendiente y la página dice con_reporte",
    async () => {
      const { monitoria, desembolso, dentroDeLaVentana } = await realizadaConDesembolso(4);
      // Control: sin reporte, HU-028 lo deja ejecutar.
      expect(await motivoParaEjecutar(desembolso.id)).toBeNull();

      const lead = await conexion();
      const a = await conexion();
      try {
        await lead.cliente.query("begin");
        expect(await reportarEn(lead.cliente, monitoria.id, dentroDeLaVentana)).toBe("reportada");

        await a.cliente.query("begin");
        await comoAdmin(a.cliente);
        const ejecucion = enCurso(
          a.cliente.query<{ r: string }>("select public.ejecutar_desembolso($1::uuid, 'TRX-HU029', $2::date, null) as r", [
            desembolso.id,
            diaDelNegocio(new Date()),
          ]),
        );
        await esperarBloqueo(a.pid, lead.pid, ejecucion);

        await lead.cliente.query("commit");
        expect((await ejecucion.promesa).rows[0].r).toBe("con_reporte");
        await a.cliente.query("commit");
      } finally {
        await cerrar(lead, a);
      }

      expect(exito(await fx.admin.from("desembolso").select("estado, id_admin, referencia_transferencia").eq("id", desembolso.id).single(), "leer el desembolso")).toEqual({
        estado: "pendiente",
        id_admin: null,
        referencia_transferencia: null,
      });
      expect(await motivoParaEjecutar(desembolso.id)).toBe("con_reporte");
    },
    60_000,
  );
});
