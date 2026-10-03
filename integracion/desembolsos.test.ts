import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { cargarDesembolso, ejecutarDesembolso } from "@/lib/admin/desembolsos";
import type { MotivoParaNoEjecutar } from "@/lib/admin/desembolsos-reglas";
import { revisarPago } from "@/lib/admin/pagos";
import { finalizarMonitoria } from "@/lib/agenda/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { cierreAutomaticoDesde, desembolsableDesde, diaIsoDeFecha, finProgramado, inicioDeSesion } from "@/lib/plazos/motor";
import { cargarParametros, type ParametrosNegocio } from "@/lib/plazos/parametros";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-028 contra el Supabase local, por la misma ruta que la página y la acción de `/admin/desembolsos/[id]`:
 * `cargarDesembolso` y `ejecutarDesembolso` con la sesión de verdad de cada admin, así que también se prueban
 * `public.estado_para_ejecutar`, `public.ejecutar_desembolso`, sus permisos y que nadie escriba `desembolso` por su
 * cuenta. La acción hace lo mismo y además `exigirRol`, la lectura del formulario, `revalidatePath` y `redirect`, que
 * necesitan a Next. Los bordes de cada motivo y resultado, con una hora fija, están en `supabase/tests/desembolsos.test.sql`.
 *
 * El desembolso lo crea el trigger de `monitoria` al pasar a realizada (criterio 1): aquí por sus dos caminos reales,
 * el monitor que finaliza con su sesión y el cierre automático de pg_cron. Este último se llama con un cliente `pg`,
 * dentro de una transacción que siempre se revierte (como en `integracion/finalizar.test.ts`): cierra cualquier
 * confirmada vencida de la base local, no solo la de la prueba. Las confirmadas de la prueba empezaron hace 2 horas, así
 * que el cierre real no las alcanza mientras corre.
 *
 * Para ejecutar hace falta una monitoría que terminó hace más de 24 h. Esas se insertan ya realizadas (el trigger es solo
 * de UPDATE) con la foto de su desembolso de `crearDesembolso` (bruto 25.000, comisión 2.500, neto 22.500, llave
 * "llave-de-prueba"), como `integracion/bandeja.test.ts`: así la foto es la que la prueba quiere y se ve que al
 * ejecutar los montos salen de los pagos aprobados de ese momento (P-29), no de la foto.
 *
 * El Auth local deja 30 inicios de sesión cada 5 minutos y el resto de la suite ya usa muchos: este archivo inicia tres,
 * una sola vez (dos admins y el monitor que finaliza). Cada prueba crea y borra todo lo demás.
 *
 * Dos ejecuciones a la vez van con dos conexiones `pg` reales, cada una en su transacción y con el rol y el token de su
 * admin, como en `integracion/revisar-pagos.test.ts`: la segunda espera el bloqueo de la primera.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;

/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por la otra. */
const ESPERA_MAXIMA = 10_000;

/** La foto que deja `crearDesembolso`. */
const FOTO = { monto_bruto: 25_000, comision: 2_500, monto_neto: 22_500, llave_destino: "llave-de-prueba" };

type Cuenta = { usuario: UsuarioPrueba; cliente: Cliente };

let fx: Fixtures;
let cuentas: Fixtures;
let bd: pg.Client;
let parametros: ParametrosNegocio;
/** Las tres sesiones del archivo: el admin que ejecuta, otro admin activo y el monitor que finaliza sus monitorías. */
let admin: Cuenta;
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
    admin = await cuenta(await cuentas.crearAdmin());
    otroAdmin = await cuenta(await cuentas.crearAdmin());
    monitor = await cuenta(await cuentas.crearMonitor());
    parametros = await cargarParametros(monitor.cliente);
  } catch (error) {
    await cuentas.limpiar();
    throw error;
  }
});

afterAll(async () => {
  await bd?.end();
  // Después de los desembolsos de cada prueba: desembolso.id_admin no cae en cascada.
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

/** El instante del mediodía de ese día en Bogotá, como guarda la base la fecha de la transferencia. */
const mediodiaEnBogota = (fecha: string) => inicioDeSesion(fecha, "12:00");

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

/** La llave que tiene ahora el monitor de la prueba (la crea `crearMonitor`; una prueba la cambia). */
async function llaveDelMonitor(): Promise<string> {
  return exito(await fx.admin.from("monitor_privado").select("llave").eq("id_monitor", monitor.usuario.id).single(), "leer la llave del monitor").llave;
}

/**
 * Una individual confirmada del monitor de la prueba que empezó hace 2 horas, en su propia franja de 30 min, con un
 * pago aprobado de `monto`. El cierre real no la alcanza: su fin + 24 h queda a más de 21 horas de ahora.
 */
async function empezada(monto: number) {
  const inicio = new Date(Math.floor((Date.now() - 2 * HORA) / SEGUNDO) * SEGUNDO);
  const sesion = sesionEn(inicio);
  const materia = await fx.crearMateria();
  await fx.crearCertificado({ idMonitor: monitor.usuario.id, idMateria: materia.id, idAdmin: admin.usuario.id });
  const franja = await fx.crearFranja({ idMonitor: monitor.usuario.id, dia: sesion.dia, hora: sesion.hora, duracionMin: 30 });
  const lead = await fx.crearLead();
  const contexto = { materia, monitor: monitor.usuario, franja, lead };
  const monitoria = await fx.crearMonitoria(contexto, { fecha: sesion.fecha, estado: "confirmada" });
  await fx.crearPagoDe(monitoria.id, { idAdmin: admin.usuario.id, estado: "aprobado", monto });
  return { monitoria, fin: finProgramado(inicio, franja.duracion_min) };
}

type PagoDePrueba = { estado: "en_revision" | "aprobado" | "rechazado"; monto?: number };

/**
 * Una individual realizada el lunes de hace dos semanas (10:00 a 11:00, ya pasó fin + 24 h), con sus pagos asignados al
 * admin de la prueba y la foto de su desembolso (`FOTO`) en `estado`.
 */
async function realizadaConDesembolso(pagos: PagoDePrueba[], estado: "pendiente" | "anulado" = "pendiente") {
  const contexto = await fx.crearContextoDeMonitoria(admin.usuario.id);
  const fecha = lunesDeHace(2);
  const monitoria = await fx.crearMonitoria(contexto, { fecha, estado: "realizada", fechaFinalizacion: `${fecha}T16:30:00+00:00` });
  for (const pago of pagos) await fx.crearPagoDe(monitoria.id, { idAdmin: admin.usuario.id, estado: pago.estado, monto: pago.monto });
  const desembolso = await fx.crearDesembolso({ idMonitoria: monitoria.id, estado });
  return { monitoria, fecha, desembolso, fin: finProgramado(inicioDeSesion(fecha, "10:00"), 60) };
}

const COLUMNAS = "id, estado, monto_bruto, comision, monto_neto, llave_destino, id_admin, referencia_transferencia, fecha_desembolso";

const desembolsosDe = async (idMonitoria: string) =>
  exito(await fx.admin.from("desembolso").select(COLUMNAS).eq("id_monitoria", idMonitoria), "leer los desembolsos de la monitoría");

const desembolsoEnBd = async (id: string) => exito(await fx.admin.from("desembolso").select(COLUMNAS).eq("id", id).single(), "leer el desembolso");

/** Lo mismo que hace la acción con lo que llega del formulario (ya validado por `leerEjecucion`). */
const ejecutar = (cliente: Cliente, idDesembolso: string, netoEsperado: number, referencia = `TRX-${randomUUID().slice(0, 8)}`) =>
  ejecutarDesembolso(cliente, { idDesembolso, referencia, fecha: hoy(), netoEsperado });

/** Los desembolsos que el admin de la prueba ve en su bandeja (HU-012), sin el corte de la lista: que uno falte es por la vista. */
const desembolsosDeLaBandeja = async () =>
  (await cargarBandeja(admin.cliente, admin.usuario.id, new Date(), { maxFilas: 1_000 })).desembolsos.map((d) => d.id);

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
async function como(cliente: pg.Client, cuenta: Cuenta) {
  await cliente.query("set local role authenticated");
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: cuenta.usuario.id, role: "authenticated" })]);
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

describe("criterio 1 (RN-80): la monitoría que pasa a realizada crea su desembolso pendiente", () => {
  it("el monitor la finaliza con su sesión: queda un desembolso pendiente con la foto de los pagos aprobados y su llave copiada, que todavía no se puede ejecutar (antes de fin + 24 h)", async () => {
    const llave = await llaveDelMonitor();
    // 41.000 aprobados: comisión de 4.100 (10 %) y neto de 36.900.
    const { monitoria, fin } = await empezada(41_000);
    expect(await desembolsosDe(monitoria.id)).toEqual([]);

    expect(await finalizarMonitoria(monitor.cliente, monitoria.id)).toBe("finalizada");

    const [desembolso, ...otros] = await desembolsosDe(monitoria.id);
    expect(otros).toEqual([]);
    expect(desembolso).toEqual({
      id: desembolso.id,
      estado: "pendiente",
      monto_bruto: 41_000,
      comision: 4_100,
      monto_neto: 36_900,
      llave_destino: llave,
      id_admin: null,
      referencia_transferencia: null,
      fecha_desembolso: null,
    });

    // Criterio 2: el admin lo ve, pero hasta después de fin + 24 h no se ejecuta (N-6), y la base tampoco lo deja.
    expect(await cargarDesembolso(admin.cliente, desembolso.id)).toMatchObject({
      estado: "pendiente",
      motivo: "antes_de_plazo",
      llaveDestino: llave,
      desembolsableDesde: desembolsableDesde(fin, parametros),
      monitoria: { estado: "realizada" },
      ejecucion: null,
    });
    expect(await ejecutar(admin.cliente, desembolso.id, 36_900)).toBe("antes_de_plazo");
    expect(await desembolsoEnBd(desembolso.id)).toEqual(desembolso);
    expect(await desembolsosDeLaBandeja()).not.toContain(desembolso.id);
  });

  it("HU-013: si después el monitor cambia su llave con su sesión, el desembolso sigue yendo a la que tenía al realizarse", async () => {
    const anterior = await llaveDelMonitor();
    const { monitoria } = await empezada(25_000);
    expect(await finalizarMonitoria(monitor.cliente, monitoria.id)).toBe("finalizada");
    const [desembolso] = await desembolsosDe(monitoria.id);

    const nueva = `llave-nueva-${randomUUID()}`;
    exito(
      await monitor.cliente.from("monitor_privado").update({ llave: nueva }).eq("id_monitor", monitor.usuario.id).select("llave").single(),
      "cambiar la llave del monitor",
    );
    expect(await llaveDelMonitor()).toBe(nueva);

    expect((await desembolsoEnBd(desembolso.id)).llave_destino).toBe(anterior);
    expect((await cargarDesembolso(admin.cliente, desembolso.id))?.llaveDestino).toBe(anterior);
  });

  it("el cierre automático (pg_cron) la cierra sola a fin + 24 h y crea el mismo desembolso, con la foto y la llave", async () => {
    const llave = await llaveDelMonitor();
    // 27.500 aprobados: comisión de 2.750 y neto de 24.750.
    const { monitoria, fin } = await empezada(27_500);
    const limite = cierreAutomaticoDesde(fin, parametros);

    await bd.query("begin");
    try {
      const { rows: cierre } = await bd.query<{ cerradas: number }>("select privado.cerrar_monitorias_sin_finalizar($1::timestamptz) as cerradas", [
        limite.toISOString(),
      ]);
      expect(cierre[0].cerradas).toBeGreaterThanOrEqual(1);
      const { rows } = await bd.query("select estado, monto_bruto, comision, monto_neto, llave_destino, id_admin from public.desembolso where id_monitoria = $1", [
        monitoria.id,
      ]);
      expect(rows).toEqual([{ estado: "pendiente", monto_bruto: 27_500, comision: 2_750, monto_neto: 24_750, llave_destino: llave, id_admin: null }]);
    } finally {
      // Cierra cualquier confirmada vencida de la base local, no solo la de la prueba: no debe quedar escrito.
      await bd.query("rollback");
    }
    expect(await desembolsosDe(monitoria.id)).toEqual([]);
  });
});

describe("criterio 2 y D-39: el admin ve por qué no se puede ejecutar, y la base no lo ejecuta", () => {
  const casos: [string, MotivoParaNoEjecutar, () => Promise<{ desembolso: { id: string } }>][] = [
    [
      "con un reporte de inasistencia en revisión",
      "con_reporte",
      async () => {
        const r = await realizadaConDesembolso([{ estado: "aprobado" }]);
        await fx.crearReporte({ idMonitoria: r.monitoria.id, idAdmin: admin.usuario.id, estado: "en_revision" });
        return r;
      },
    ],
    [
      "con un reporte de inasistencia aceptado",
      "con_reporte",
      async () => {
        const r = await realizadaConDesembolso([{ estado: "aprobado" }]);
        await fx.crearReporte({ idMonitoria: r.monitoria.id, idAdmin: admin.usuario.id, estado: "aceptado" });
        return r;
      },
    ],
    // Como lo dejará HU-030 al aceptar un reporte (P-28, D-37).
    ["anulado", "anulado", () => realizadaConDesembolso([{ estado: "aprobado" }], "anulado")],
    // D-39: si se ejecutara, P-29 dejaría ese pago fuera del desembolso para siempre.
    ["con su pago todavía en revisión", "pagos_en_revision", () => realizadaConDesembolso([{ estado: "en_revision" }])],
    // Supuesto 2: el único pago se rechazó (P-24) y no hay nada que transferir.
    ["sin pagos aprobados", "sin_pagos_aprobados", () => realizadaConDesembolso([{ estado: "rechazado" }])],
  ];

  it.each(casos)("%s: la bandeja no lo lista, cargarDesembolso da el motivo %s, ejecutar responde lo mismo y nada cambia", async (_caso, motivo, crear) => {
    const { desembolso } = await crear();
    const antes = await desembolsoEnBd(desembolso.id);

    // La vista de la bandeja coincide con estado_para_ejecutar: no ofrece lo que la página no deja ejecutar.
    expect(await desembolsosDeLaBandeja()).not.toContain(desembolso.id);
    const leido = await cargarDesembolso(admin.cliente, desembolso.id);
    expect(leido?.motivo).toBe(motivo);
    expect(leido?.ejecucion).toBeNull();

    expect(await ejecutar(admin.cliente, desembolso.id, FOTO.monto_neto)).toBe(motivo);
    expect(await desembolsoEnBd(desembolso.id)).toEqual(antes);
  });

  it("un reporte rechazado no bloquea: está en la bandeja y se puede ejecutar", async () => {
    const { monitoria, desembolso } = await realizadaConDesembolso([{ estado: "aprobado" }]);
    await fx.crearReporte({ idMonitoria: monitoria.id, idAdmin: admin.usuario.id, estado: "rechazado" });

    expect(await desembolsosDeLaBandeja()).toContain(desembolso.id);
    expect((await cargarDesembolso(admin.cliente, desembolso.id))?.motivo).toBeNull();
    expect(await ejecutar(admin.cliente, desembolso.id, 22_500)).toBe("desembolsado");
  });
});

describe("criterio 3: el admin transfiere y registra la referencia y la fecha", () => {
  it("con su sesión queda desembolsado con su id, la referencia, la fecha a mediodía de Bogotá y los montos de los pagos aprobados de ahora (P-29); sale de la bandeja, la página lo pinta registrado y otro intento responde ya_desembolsado", async () => {
    // La foto es de 25.000; después se aprobó otro pago: 37.000 aprobados, comisión de 3.700 y neto de 33.300.
    const { fecha, desembolso, fin } = await realizadaConDesembolso([
      { estado: "aprobado", monto: 25_000 },
      { estado: "aprobado", monto: 12_000 },
    ]);
    expect(await desembolsosDeLaBandeja()).toContain(desembolso.id);

    const leido = await cargarDesembolso(admin.cliente, desembolso.id);
    expect(leido).toEqual({
      id: desembolso.id,
      estado: "pendiente",
      motivo: null,
      montoNeto: 33_300,
      llaveDestino: FOTO.llave_destino,
      desembolsableDesde: desembolsableDesde(fin, parametros),
      nombreMonitor: "Monitor de prueba",
      monitoria: { estado: "realizada", motivoCancelacion: null, fecha, hora: "10:00:00", duracionMin: 60, nombreMateria: "Materia de prueba" },
      ejecucion: null,
    });
    // RN-80: nadie lo tiene asignado hasta ejecutarlo; cualquier admin activo ve lo mismo.
    expect(await cargarDesembolso(otroAdmin.cliente, desembolso.id)).toEqual(leido);

    const referencia = `TRX-${randomUUID().slice(0, 8)}`;
    const dia = hoy();
    expect(await ejecutar(admin.cliente, desembolso.id, 33_300, referencia)).toBe("desembolsado");

    const enBd = await desembolsoEnBd(desembolso.id);
    expect({ ...enBd, fecha_desembolso: new Date(enBd.fecha_desembolso!).getTime() }).toEqual({
      id: desembolso.id,
      estado: "desembolsado",
      monto_bruto: 37_000,
      comision: 3_700,
      monto_neto: 33_300,
      llave_destino: FOTO.llave_destino,
      id_admin: admin.usuario.id,
      referencia_transferencia: referencia,
      fecha_desembolso: mediodiaEnBogota(dia).getTime(),
    });
    expect(await desembolsosDeLaBandeja()).not.toContain(desembolso.id);
    expect(await cargarDesembolso(admin.cliente, desembolso.id)).toMatchObject({
      estado: "desembolsado",
      motivo: "desembolsado",
      montoNeto: 33_300,
      ejecucion: { idAdmin: admin.usuario.id, nombreAdmin: "Admin de prueba", referencia, fecha: mediodiaEnBogota(dia) },
    });

    // Sin vuelta atrás: ni el mismo admin ni otro lo vuelven a registrar.
    expect(await ejecutar(admin.cliente, desembolso.id, 33_300)).toBe("ya_desembolsado");
    expect(await ejecutar(otroAdmin.cliente, desembolso.id, 33_300)).toBe("ya_desembolsado");
    expect(await desembolsoEnBd(desembolso.id)).toEqual(enBd);
  });

  it("monto_cambio: si se aprueba un pago entre que el admin miró y ejecutó, no se registra nada; con el neto nuevo, sí", async () => {
    const { monitoria, desembolso } = await realizadaConDesembolso([{ estado: "aprobado", monto: 25_000 }]);
    const visto = await cargarDesembolso(admin.cliente, desembolso.id);
    expect(visto?.montoNeto).toBe(22_500);

    // Mientras tanto llega otro pago y el admin asignado lo aprueba (HU-020).
    const pago = await fx.crearPagoDe(monitoria.id, { idAdmin: admin.usuario.id, monto: 12_000 });
    expect(await revisarPago(admin.cliente, { idPago: pago.id, decision: "aprobar", observaciones: null })).toEqual({ resultado: "aprobado", canceloMonitoria: false });

    const antes = await desembolsoEnBd(desembolso.id);
    expect(await ejecutar(admin.cliente, desembolso.id, visto!.montoNeto!)).toBe("monto_cambio");
    expect(await desembolsoEnBd(desembolso.id)).toEqual(antes);

    const deNuevo = await cargarDesembolso(admin.cliente, desembolso.id);
    expect(deNuevo).toMatchObject({ motivo: null, montoNeto: 33_300 });
    expect(await ejecutar(admin.cliente, desembolso.id, 33_300)).toBe("desembolsado");
    expect(await desembolsoEnBd(desembolso.id)).toMatchObject({ estado: "desembolsado", monto_bruto: 37_000, comision: 3_700, monto_neto: 33_300 });
  });
});

describe("dos admins ejecutan el mismo desembolso a la vez (supuesto 5)", () => {
  it(
    "el primero bloquea la monitoría y el desembolso; el segundo espera, recibe ya_desembolsado y el desembolso queda con el id y la referencia del primero",
    async () => {
      const { desembolso } = await realizadaConDesembolso([{ estado: "aprobado" }]);

      const a = await conexion();
      const b = await conexion();
      try {
        await a.cliente.query("begin");
        await como(a.cliente, admin);
        expect(await ejecutarEn(a.cliente, desembolso.id, "TRX-PRIMERO", 22_500)).toBe("desembolsado");

        await b.cliente.query("begin");
        await como(b.cliente, otroAdmin);
        const segunda = enCurso(ejecutarEn(b.cliente, desembolso.id, "TRX-SEGUNDO", 22_500));
        await esperarBloqueo(b.pid, a.pid, segunda);

        await a.cliente.query("commit");
        expect(await segunda.promesa).toBe("ya_desembolsado");
        await b.cliente.query("commit");
      } finally {
        await cerrar(a, b);
      }
      expect(await desembolsoEnBd(desembolso.id)).toMatchObject({ estado: "desembolsado", id_admin: admin.usuario.id, referencia_transferencia: "TRX-PRIMERO" });
    },
    60_000,
  );
});

describe("solo un admin activo ejecuta, y solo por la función", () => {
  it("un monitor no ve el desembolso (null) y al ejecutar recibe sin_permiso; sin sesión la base ni siquiera ejecuta las funciones; nada cambia", async () => {
    const { desembolso } = await realizadaConDesembolso([{ estado: "aprobado" }]);
    const antes = await desembolsoEnBd(desembolso.id);

    expect(await cargarDesembolso(monitor.cliente, desembolso.id)).toBeNull();
    expect(exito(await monitor.cliente.rpc("estado_para_ejecutar", { p_id_desembolso: desembolso.id }), "estado_para_ejecutar del monitor")).toEqual([]);
    expect(await ejecutar(monitor.cliente, desembolso.id, 22_500)).toBe("sin_permiso");

    await expect(ejecutar(crearCliente(), desembolso.id, 22_500)).rejects.toThrow(/No se pudo ejecutar el desembolso: 42501/);
    const anonimo = await crearCliente().rpc("estado_para_ejecutar", { p_id_desembolso: desembolso.id });
    expect(anonimo.error?.code).toBe("42501");

    expect(await desembolsoEnBd(desembolso.id)).toEqual(antes);
    expect(await cargarDesembolso(admin.cliente, randomUUID())).toBeNull();
  });

  it("nadie escribe directo en desembolso: ni un admin activo con su sesión puede insertarlo, actualizarlo o borrarlo por la Data API", async () => {
    const { monitoria, desembolso } = await realizadaConDesembolso([{ estado: "aprobado" }]);
    const antes = await desembolsoEnBd(desembolso.id);

    sinFilas(
      await admin.cliente
        .from("desembolso")
        .update({ estado: "desembolsado", id_admin: admin.usuario.id, referencia_transferencia: "TRX-DIRECTA", fecha_desembolso: new Date().toISOString() })
        .eq("id", desembolso.id)
        .select(),
    );
    sinFilas(await admin.cliente.from("desembolso").delete().eq("id", desembolso.id).select());
    const insertado = await admin.cliente
      .from("desembolso")
      .insert({ id_monitoria: monitoria.id, monto_bruto: 1, comision: 0, monto_neto: 1, llave_destino: "llave-ajena" })
      .select();
    expect(insertado.error).not.toBeNull();

    expect(await desembolsoEnBd(desembolso.id)).toEqual(antes);
    expect(await desembolsosDe(monitoria.id)).toHaveLength(1);
  });

  it("supuesto 4: lo que lee la pantalla trae el neto y nunca el bruto ni la comisión, ni antes ni después de ejecutar", async () => {
    // 37.000 aprobados: comisión de 3.700 y neto de 33.300. La foto (25.000 y 2.500) tampoco debe asomar.
    const { desembolso } = await realizadaConDesembolso([
      { estado: "aprobado", monto: 25_000 },
      { estado: "aprobado", monto: 12_000 },
    ]);
    const prohibidos = [37_000, 3_700, FOTO.monto_bruto, FOTO.comision];

    const crudo = exito(await admin.cliente.rpc("estado_para_ejecutar", { p_id_desembolso: desembolso.id }), "estado_para_ejecutar del admin");
    expect(crudo).toEqual([{ motivo: null, monto_neto: 33_300 }]);

    const antes = await cargarDesembolso(admin.cliente, desembolso.id);
    expect(numerosDe(antes).filter((n) => prohibidos.includes(n))).toEqual([]);
    expect(clavesDe(antes).filter((clave) => /bruto|comisi/i.test(clave))).toEqual([]);

    expect(await ejecutar(admin.cliente, desembolso.id, 33_300)).toBe("desembolsado");
    const despues = await cargarDesembolso(admin.cliente, desembolso.id);
    expect(despues?.montoNeto).toBe(33_300);
    expect(numerosDe(despues).filter((n) => prohibidos.includes(n))).toEqual([]);
    expect(clavesDe(despues).filter((clave) => /bruto|comisi/i.test(clave))).toEqual([]);
  });
});
