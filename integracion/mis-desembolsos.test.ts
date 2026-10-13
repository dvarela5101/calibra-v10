import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { cerrarCasoP24 } from "@/lib/admin/casos-p24";
import { cargarDesembolso, ejecutarDesembolso } from "@/lib/admin/desembolsos";
import { resolverReporte } from "@/lib/admin/reportes";
import { reportarInasistenciaDeMiCita } from "@/lib/citas/reportar";
import {
  agruparDesembolsos,
  avisoDeLlave,
  SITUACIONES,
  TEXTOS,
  textoDeSituacion,
  type DesembolsoDelMonitor,
  type Situacion,
} from "@/lib/desembolsos/reglas";
import { cargarMisDesembolsos } from "@/lib/desembolsos/servidor";
import { diaDelNegocio, formatearDia, formatearHora } from "@/lib/fechas";
import { desembolsableDesde, diaIsoDeFecha, finProgramado, inicioDeSesion } from "@/lib/plazos/motor";
import { cargarParametros, type ParametrosNegocio } from "@/lib/plazos/parametros";
import type { Database } from "@/lib/supabase/tipos";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-050 contra el Supabase local, por el mismo código que usa la página `/monitor/desembolsos`: `cargarMisDesembolsos`
 * con la sesión de verdad de cada persona, así que también se prueban `public.mis_desembolsos`, sus permisos y que la
 * tabla `desembolso` siga cerrada para el monitor. La página usa `exigirRol("monitor")`: eso es de la e2e. Los bordes de
 * cada situación, con una hora fija, están en `supabase/tests/mis_desembolsos.test.sql`.
 *
 * Los desembolsos se llevan a cada situación con las funciones reales cuando se puede: el admin ejecuta con
 * `ejecutarDesembolso` (transferido), resuelve con `resolverReporte` (anulado, o de vuelta a listo) y cierra un caso con
 * `cerrarCasoP24`. Donde la puerta real no llega, se inserta como en `integracion/desembolsos.test.ts`: la monitoría
 * ya realizada y la foto del desembolso con `crearDesembolso` (el trigger que lo crea es solo de UPDATE). El reporte en
 * revisión de una monitoría vieja se siembra con `crearReporte`: `reportar_inasistencia` solo deja reportar hasta
 * fin + 24 h, o sea mientras el desembolso sigue en `en_plazo`, y con ella nunca se llega a `en_espera`. La puerta real
 * (`reportarInasistenciaDeMiCita`) sirve para comprobar que ese reporte no cambia lo que lee el monitor (D-59 b).
 *
 * El Auth local deja 30 inicios de sesión con contraseña cada 5 minutos y el resto de la suite ya usa muchos: este
 * archivo inicia tres, una sola vez (los monitores A y B y un admin), y dos sesiones anónimas (un Lead y una que todavía
 * no lo es). Cada prueba crea y borra todo lo demás. Los reportes que crea la puerta real no los borra `limpiar()`: la
 * prueba los borra antes por su monitoría.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;

/**
 * Lo máximo que se espera, como máximo, a una lectura que no debería esperar a nadie. Si esperara, quedaría bloqueada
 * hasta el `lock_timeout` de 15 s de la conexión que tiene el candado: este tope las separa con holgura.
 */
const TOPE_DE_UNA_LECTURA = 3_000;

/** La foto que deja `crearDesembolso` sin más datos. */
const FOTO = { bruto: 25_000, comision: 2_500, neto: 22_500 };

/** Las 13 columnas que entrega `public.mis_desembolsos()`, en este orden (HU-050). */
const COLUMNAS = [
  "id_desembolso",
  "fecha",
  "hora",
  "duracion_min",
  "nombre_materia",
  "situacion",
  "desembolsable_desde",
  "monto_bruto",
  "comision",
  "monto_neto",
  "llave_destino",
  "referencia_transferencia",
  "fecha_desembolso",
] as const;

type FilaCruda = Database["public"]["Functions"]["mis_desembolsos"]["Returns"][number];
type Cuenta = { usuario: UsuarioPrueba; cliente: Cliente };
type Contexto = Awaited<ReturnType<Fixtures["crearContextoDeMonitoria"]>>;
type PagoDePrueba = { estado: "en_revision" | "aprobado" | "rechazado"; monto?: number };
type Montos = { bruto: number; comision: number; neto: number };

/** Lo que nunca debe salir de la lectura del monitor: lo que tienen los pagos y las personas de las pruebas. */
const NOMBRE_DEL_PAGADOR = `Pagador-${randomUUID()}`;
const CONTACTO_DEL_PAGADOR = "pagador@calibra.test";

let cuentas: Fixtures;
let fx: Fixtures;
let bd: pg.Client;
let parametros: ParametrosNegocio;
let admin: Cuenta;
let monitorA: Cuenta;
let monitorB: Cuenta;
/** La llave que tienen A y B al empezar: la que se copia a sus desembolsos y la que una prueba cambia y devuelve. */
const llaveDe = new Map<string, string>();
/** La sesión anónima de un Lead (HU-068) con su contacto ya dejado, y otra sesión anónima que todavía no lo es. */
let sesionLead: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
let leadDeLaSesion: Awaited<ReturnType<Fixtures["crearLeadDeSesion"]>>;
let sesionAnonima: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
/** Lo que arma cada prueba: el contexto de cada monitor y las monitorías (para borrar los reportes de la puerta real). */
let contextos: Map<string, Contexto>;
let monitoriasDeLaPrueba: string[];

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  cuentas = new Fixtures();
  try {
    const cuenta = async (usuario: UsuarioPrueba): Promise<Cuenta> => ({ usuario, cliente: await cuentas.iniciarSesion(usuario) });
    admin = await cuenta(await cuentas.crearAdmin());
    monitorA = await cuenta(await cuentas.crearMonitor());
    monitorB = await cuenta(await cuentas.crearMonitor());
    for (const monitor of [monitorA, monitorB]) llaveDe.set(monitor.usuario.id, await llaveDelMonitor(monitor));
    sesionLead = await cuentas.crearAnonimo();
    leadDeLaSesion = await cuentas.crearLeadDeSesion(sesionLead.id);
    sesionAnonima = await cuentas.crearAnonimo();
    parametros = await cargarParametros(monitorA.cliente);
  } catch (error) {
    await bd.end();
    await cuentas.limpiar();
    throw error;
  }
}, 90_000);

afterAll(async () => {
  await bd?.end();
  // Después de los desembolsos de cada prueba: desembolso.id_admin no cae en cascada.
  await cuentas?.limpiar();
});

beforeEach(() => {
  fx = new Fixtures();
  contextos = new Map();
  monitoriasDeLaPrueba = [];
});

afterEach(async () => {
  // Los reportes de la puerta real los creó la función, no `crearReporte`: la llave foránea impide borrar la monitoría.
  if (monitoriasDeLaPrueba.length) await fx.admin.from("reporte_inasistencia").delete().in("id_monitoria", monitoriasDeLaPrueba);
  await fx.limpiar();
  // Si una prueba falló a medias, el monitor vuelve a la llave con la que empezó.
  for (const monitor of [monitorA, monitorB]) {
    await fx.admin.from("monitor_privado").update({ llave: llaveDe.get(monitor.usuario.id)! }).eq("id_monitor", monitor.usuario.id);
  }
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

/** Día, día de la semana, hora (`HH:MM:SS`) y minuto del día de un instante en Bogotá, tal como los guarda la base. */
function sesionEn(instante: Date): { fecha: string; dia: number; hora: string; minutoDelDia: number } {
  const fecha = diaDelNegocio(instante);
  const hora = formatoDeHora.format(instante);
  if (inicioDeSesion(fecha, hora).getTime() !== instante.getTime()) throw new Error(`No se pudo expresar ${instante.toISOString()} como fecha y hora de Bogotá.`);
  return { fecha, dia: diaIsoDeFecha(fecha), hora, minutoDelDia: Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)) };
}

async function llaveDelMonitor(monitor: Cuenta): Promise<string> {
  const { data, error } = await monitor.cliente.from("monitor_privado").select("llave").eq("id_monitor", monitor.usuario.id).single();
  if (error) throw new Error(`leer la llave del monitor: ${error.message}`);
  return data.llave;
}

const llaveGuardadaDe = (monitor: Cuenta) => llaveDe.get(monitor.usuario.id)!;

/** Lo que hace falta para una monitoría de ese monitor: su materia certificada, su franja de los lunes a las 10:00 y un Lead. */
async function contextoDe(monitor: Cuenta): Promise<Contexto> {
  const hecho = contextos.get(monitor.usuario.id);
  if (hecho) return hecho;
  const materia = await fx.crearMateria();
  await fx.crearCertificado({ idMonitor: monitor.usuario.id, idMateria: materia.id, idAdmin: admin.usuario.id });
  const franja = await fx.crearFranja({ idMonitor: monitor.usuario.id, dia: 1, hora: "10:00", duracionMin: 60 });
  const lead = await fx.crearLead();
  const contexto = { materia, monitor: monitor.usuario, franja, lead };
  contextos.set(monitor.usuario.id, contexto);
  return contexto;
}

/** Los pagos de una monitoría, asignados al admin de la prueba, con un nombre y un contacto que no deben salir en la lectura. */
async function crearPagos(idMonitoria: string, pagos: PagoDePrueba[]) {
  const creados = [];
  for (const pago of pagos) {
    creados.push(await fx.crearPagoDe(idMonitoria, { idAdmin: admin.usuario.id, estado: pago.estado, monto: pago.monto, nombrePagador: NOMBRE_DEL_PAGADOR }));
  }
  return creados;
}

type OpcionesDeVieja = {
  monitor?: Cuenta;
  estadoDelDesembolso?: "pendiente" | "desembolsado" | "anulado" | null;
  /** La foto del desembolso; por defecto 25.000/2.500/22.500. */
  foto?: Montos;
  referencia?: string;
  /** Para un desembolsado: el día de la transferencia. */
  diaDeTransferencia?: string;
  /** Una monitoría cancelada por el estudiante (con un desembolso pendiente): la defensa `no_realizada`. */
  cancelada?: boolean;
};

/**
 * Una individual del monitor que se realizó el lunes de hace `semanas` semanas (10:00 a 11:00, ya pasó fin + 24 h), con
 * sus pagos y su desembolso con la foto de `crearDesembolso` y la llave que tiene hoy el monitor (RN-80).
 */
async function vieja(semanas: number, pagos: PagoDePrueba[], opciones: OpcionesDeVieja = {}) {
  const monitor = opciones.monitor ?? monitorA;
  const contexto = await contextoDe(monitor);
  const fecha = lunesDeHace(semanas);
  const monitoria = await fx.crearMonitoria(contexto, {
    fecha,
    estado: opciones.cancelada ? "cancelada" : "realizada",
    ...(opciones.cancelada ? {} : { fechaFinalizacion: `${fecha}T16:30:00+00:00` }),
  });
  monitoriasDeLaPrueba.push(monitoria.id);
  const creados = await crearPagos(monitoria.id, pagos);
  const estado = opciones.estadoDelDesembolso === undefined ? "pendiente" : opciones.estadoDelDesembolso;
  const desembolso =
    estado === null
      ? null
      : await fx.crearDesembolso({
          idMonitoria: monitoria.id,
          estado,
          idAdmin: admin.usuario.id,
          montos: opciones.foto ?? FOTO,
          llave: llaveGuardadaDe(monitor),
          referencia: opciones.referencia,
          fechaDesembolso: estado === "desembolsado" ? mediodiaEnBogota(opciones.diaDeTransferencia ?? sumarDias(hoy(), -1)).toISOString() : undefined,
        });
  return { monitoria, fecha, pagos: creados, desembolso: desembolso!, fin: finProgramado(inicioDeSesion(fecha, "10:00"), 60) };
}

/**
 * Una individual del monitor que empezó hace 3 horas, en su propia franja y realizada: su ventana de reporte sigue
 * abierta, así que el desembolso está `en_plazo`. Dura 30 minutos (o lo que quede hasta la medianoche).
 */
async function empezadaHaceTresHoras(pagos: PagoDePrueba[], opciones: { monitor?: Cuenta; lead?: { id: string } } = {}) {
  const monitor = opciones.monitor ?? monitorA;
  const contexto = await contextoDe(monitor);
  const inicio = new Date(Math.floor((Date.now() - 3 * HORA) / SEGUNDO) * SEGUNDO);
  const sesion = sesionEn(inicio);
  const franja = await fx.crearFranja({
    idMonitor: monitor.usuario.id,
    dia: sesion.dia,
    hora: sesion.hora,
    duracionMin: Math.min(30, 24 * 60 - sesion.minutoDelDia),
  });
  const monitoria = await fx.crearMonitoria(
    { ...contexto, franja, lead: (opciones.lead ?? contexto.lead) as Contexto["lead"] },
    { fecha: sesion.fecha, estado: "realizada", fechaFinalizacion: new Date().toISOString() },
  );
  monitoriasDeLaPrueba.push(monitoria.id);
  const creados = await crearPagos(monitoria.id, pagos);
  const desembolso = await fx.crearDesembolso({ idMonitoria: monitoria.id, estado: "pendiente", montos: FOTO, llave: llaveGuardadaDe(monitor) });
  return { monitoria, pagos: creados, desembolso, fin: finProgramado(inicio, franja.duracion_min) };
}

// ---------------------------------------------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------------------------------------------

const cargar = (monitor: Cuenta = monitorA) => cargarMisDesembolsos(monitor.cliente, monitor.usuario.id);

async function leer(idDesembolso: string, monitor: Cuenta = monitorA): Promise<DesembolsoDelMonitor> {
  const { desembolsos } = await cargar(monitor);
  const fila = desembolsos.find((d) => d.idDesembolso === idDesembolso);
  if (!fila) throw new Error(`El desembolso ${idDesembolso} no está en la lectura del monitor (hay ${desembolsos.length}).`);
  return fila;
}

/** Las filas tal como las entrega la base por la Data API, sin pasar por la app. */
async function crudas(cliente: Cliente): Promise<FilaCruda[]> {
  return exito(await cliente.rpc("mis_desembolsos"), "mis_desembolsos");
}

/** Todos los números de un valor (sin las fechas, que llegan como texto): las cifras que le llegan a la pantalla. */
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

/** Las cifras de dinero de una fila: `duracion_min` también es un número, así que solo cuentan las de 1.000 o más. */
const dineroDe = (valor: unknown) => numerosDe(valor).filter((n) => n >= 1_000);

const ordenados = (numeros: number[]) => [...numeros].sort((a, b) => a - b);

/** Nada de lo que tienen los pagos, las personas o el admin de las pruebas puede asomar en lo que se le entrega al monitor. */
function sinDatosAjenos(entregado: unknown) {
  const texto = JSON.stringify(entregado);
  for (const ajeno of [NOMBRE_DEL_PAGADOR, CONTACTO_DEL_PAGADOR, admin.usuario.id, admin.usuario.correo, "Admin de prueba", "Lead de prueba"]) {
    expect(texto, `lo entregado no trae "${ajeno}"`).not.toContain(ajeno);
  }
  expect(clavesDe(entregado).filter((clave) => /admin|estudiante|pagador|contacto|correo|telefono|motivo|con_reporte|caso_abierto|pagos_en_revision|sin_pagos|no_realizada/i.test(clave))).toEqual([]);
}

/** El texto de la situación sin los espacios duros que lleva la hora. */
const frase = (d: DesembolsoDelMonitor) => textoDeSituacion(d).replace(/\s+/g, " ");

/** El neto que el admin ve para ese desembolso en este instante: `public.estado_para_ejecutar` con su sesión. */
async function estadoDelAdmin(idDesembolso: string) {
  return exito(await admin.cliente.rpc("estado_para_ejecutar", { p_id_desembolso: idDesembolso }), "estado_para_ejecutar del admin");
}

/** Los desembolsos que el admin de la prueba ve en su bandeja de «Desembolsos ejecutables», sin el corte de la lista. */
const desembolsosDeLaBandeja = async () =>
  (await cargarBandeja(admin.cliente, admin.usuario.id, new Date(), { maxFilas: 1_000 })).desembolsos.map((d) => d.id);

// ---------------------------------------------------------------------------------------------------------------
// Con `pg`: conexiones propias, para tomar candados como lo hace el admin
// ---------------------------------------------------------------------------------------------------------------

/** Una conexión propia, con un tope para que una consulta que debía soltarse no cuelgue la prueba. */
async function conexion() {
  const cliente = new pg.Client({ connectionString: URL_BD });
  await cliente.connect();
  await cliente.query("set lock_timeout = '15s'");
  return cliente;
}

/** Cierra la conexión aunque tenga una consulta esperando: la base revierte su transacción y suelta los bloqueos. */
const cerrar = (cliente: pg.Client) => cliente.end().catch(() => undefined);

/** Dentro de una transacción de `cliente`: lo que sigue corre con el rol `authenticated` y el token de `cuenta`. */
async function como(cliente: pg.Client, cuenta: Cuenta) {
  await cliente.query("set local role authenticated");
  await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: cuenta.usuario.id, role: "authenticated" })]);
}

/** Termina con el valor de la lectura, o con `"se quedó esperando"` si pasan `TOPE_DE_UNA_LECTURA` sin que termine. */
async function sinEsperar<T>(lectura: Promise<T>): Promise<T | "se quedó esperando"> {
  let temporizador: NodeJS.Timeout | undefined;
  const tope = new Promise<"se quedó esperando">((resolver) => {
    temporizador = setTimeout(() => resolver("se quedó esperando"), TOPE_DE_UNA_LECTURA);
  });
  try {
    return await Promise.race([lectura, tope]);
  } finally {
    clearTimeout(temporizador);
  }
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterios 1, 2 y 12: cada persona recibe solo lo suyo, y solo lo que la pantalla pinta", () => {
  it("A recibe sus tres desembolsos, B solo el suyo; un admin, un Lead, una sesión anónima y nadie reciben nada; y lo que sale de la base son las 13 columnas, sin datos ajenos ni más cifras de dinero que las tres", async () => {
    // Un bruto al azar entre 50.000 y 99.999 repartido en dos pagos de montos distintos entre sí y del bruto: ningún pago
    // es el total de la monitoría, así que una cifra de más (el monto de un pago) se vería.
    const bruto = randomInt(50_000, 100_000);
    const primerPago = randomInt(20_000, 40_000);
    const porTransferir = await vieja(2, [
      { estado: "aprobado", monto: primerPago },
      { estado: "aprobado", monto: bruto - primerPago },
    ]);
    const transferidos: Montos = { bruto: 63_000, comision: 6_300, neto: 56_700 };
    const referencia = `REF-${randomUUID().slice(0, 8)}`;
    const transferido = await vieja(3, [{ estado: "aprobado", monto: 33_000 }, { estado: "aprobado", monto: 30_000 }], {
      estadoDelDesembolso: "desembolsado",
      foto: transferidos,
      referencia,
    });
    const anulado = await vieja(4, [{ estado: "aprobado", monto: 41_000 }], { estadoDelDesembolso: "anulado" });
    const deB = await vieja(2, [{ estado: "aprobado", monto: 77_000 }], { monitor: monitorB });

    const filasA = await crudas(monitorA.cliente);
    expect(filasA.map((f) => f.id_desembolso).sort()).toEqual([porTransferir.desembolso.id, transferido.desembolso.id, anulado.desembolso.id].sort());
    expect((await crudas(monitorB.cliente)).map((f) => f.id_desembolso)).toEqual([deB.desembolso.id]);

    // Criterio 2: el admin, el Lead, la sesión anónima y quien no inició sesión no reciben nada (y sin sesión, el rol anon no puede llamarla).
    for (const quien of [admin.cliente, sesionLead.cliente, sesionAnonima.cliente]) expect(await crudas(quien)).toEqual([]);
    expect((await crearCliente().rpc("mis_desembolsos")).error?.code).toBe("42501");
    // La pantalla lee por el mismo camino: para quien no es monitor, una lista vacía y ninguna llave.
    expect(await cargar(admin)).toEqual({ desembolsos: [], llaveActual: null });

    // Criterio 12: las 13 columnas de la HU, en este orden, y las únicas cifras de dinero son las tres de cada fila.
    for (const fila of filasA) expect(Object.keys(fila)).toEqual([...COLUMNAS]);
    const porId = (id: string) => filasA.find((f) => f.id_desembolso === id)!;
    const porTransferirCrudo = porId(porTransferir.desembolso.id);
    expect(porTransferirCrudo.monto_bruto).toBe(bruto);
    expect(ordenados(dineroDe(porTransferirCrudo))).toEqual(ordenados([bruto, porTransferirCrudo.comision!, porTransferirCrudo.monto_neto!]));
    expect(ordenados(dineroDe(porId(transferido.desembolso.id)))).toEqual(ordenados([63_000, 6_300, 56_700]));
    expect(dineroDe(porId(anulado.desembolso.id))).toEqual([]);
    expect(porId(anulado.desembolso.id)).toMatchObject({
      monto_bruto: null,
      comision: null,
      monto_neto: null,
      llave_destino: null,
      referencia_transferencia: null,
      fecha_desembolso: null,
    });
    sinDatosAjenos(filasA);

    // Y lo que sale de la carga de la página es lo mismo: nada de lo del admin ni de los pagos.
    const carga = await cargar();
    expect(carga.desembolsos).toHaveLength(3);
    expect(carga.llaveActual).toBe(llaveGuardadaDe(monitorA));
    sinDatosAjenos(carga);
    expect(carga.desembolsos.find((d) => d.idDesembolso === transferido.desembolso.id)).toMatchObject({
      situacion: "transferido",
      referencia,
      llaveDestino: llaveGuardadaDe(monitorA),
      montos: transferidos,
    });
  });
});

describe("criterios 3 a 8: la situación de cada desembolso, igual que la ve el admin", () => {
  it("criterio 3: dentro de la ventana de reporte está en_plazo, con desde cuándo se puede transferir (fin + 24 h) y el monto estimado", async () => {
    // 41.000 aprobados: comisión de 4.100 (10 %) y neto de 36.900. La foto (25.000) no es la que se lee.
    const { desembolso, fin } = await empezadaHaceTresHoras([{ estado: "aprobado", monto: 41_000 }]);
    const d = await leer(desembolso.id);

    const desde = desembolsableDesde(fin, parametros);
    expect(d).toMatchObject({ situacion: "en_plazo", desembolsableDesde: desde, montos: { bruto: 41_000, comision: 4_100, neto: 36_900 } });
    // Faltan unas 22 horas: la sesión empezó hace 3 y duró 30 minutos.
    expect(desde.getTime() - Date.now()).toBeGreaterThan(20 * HORA);
    expect(desde.getTime() - Date.now()).toBeLessThan(23 * HORA);
    const hora = formatearHora(desde);
    expect(textoDeSituacion(d)).toBe(`Se puede transferir después del ${formatearDia(diaDelNegocio(desde))} a las ${hora}${hora.endsWith(".") ? "" : "."}`);
    // El admin ve lo mismo: todavía no se puede ejecutar.
    expect((await cargarDesembolso(admin.cliente, desembolso.id))?.motivo).toBe("antes_de_plazo");
    expect(await desembolsosDeLaBandeja()).not.toContain(desembolso.id);
  });

  const casos: [string, Situacion, string | null, string, () => Promise<{ desembolso: { id: string } }>][] = [
    ["sin nada que lo retenga", "listo", null, TEXTOS.listo, () => vieja(2, [{ estado: "aprobado" }])],
    [
      "con un pago aprobado y otro todavía en revisión",
      "pago_en_revision",
      "pagos_en_revision",
      TEXTOS.pagoEnRevision,
      () => vieja(2, [{ estado: "aprobado" }, { estado: "en_revision" }]),
    ],
    ["con su único pago rechazado y el caso P-24 abierto", "pago_rechazado", "caso_abierto", TEXTOS.pagoRechazado, () => vieja(2, [{ estado: "rechazado" }])],
    [
      "con un pago aprobado y un rechazado cuyo caso P-24 sigue abierto",
      "pago_rechazado",
      "caso_abierto",
      TEXTOS.pagoRechazado,
      () => vieja(2, [{ estado: "aprobado" }, { estado: "rechazado" }]),
    ],
    // D-59 b: el reporte en revisión sale como cualquier otra espera, sin la palabra «reporte» ni «inasistencia».
    [
      "con un reporte de inasistencia en revisión",
      "en_espera",
      "con_reporte",
      TEXTOS.enEspera,
      async () => {
        const r = await vieja(2, [{ estado: "aprobado" }]);
        await fx.crearReporte({ idMonitoria: r.monitoria.id, idAdmin: admin.usuario.id, estado: "en_revision" });
        return r;
      },
    ],
    ["sin ningún pago aprobado", "en_espera", "sin_pagos_aprobados", TEXTOS.enEspera, () => vieja(2, [])],
    [
      "con la monitoría cancelada (la defensa no_realizada)",
      "en_espera",
      "no_realizada",
      TEXTOS.enEspera,
      () => vieja(2, [{ estado: "aprobado" }], { cancelada: true }),
    ],
  ];

  it.each(casos)(
    "criterios 4 a 6, %s: el monitor lee %s (el admin, el motivo %s), con su frase y el monto de ahora",
    async (_caso, situacion, motivo, texto, crear) => {
      const { desembolso } = await crear();
      const d = await leer(desembolso.id);

      expect(d.situacion).toBe(situacion);
      expect(textoDeSituacion(d)).toBe(texto);
      // El monitor y el admin ven lo mismo: la situación se decide con la misma función (RN-83, D-39).
      const delAdmin = await cargarDesembolso(admin.cliente, desembolso.id);
      expect(delAdmin?.motivo).toBe(motivo);
      // Un por transferir trae las tres cifras de ahora; con la foto (25.000) distinta de los pagos, se ve que no es la foto.
      const [deLaBase] = await estadoDelAdmin(desembolso.id);
      expect(d.montos?.neto).toBe(deLaBase.monto_neto);
      if (situacion === "en_espera") expect(texto).not.toMatch(/reporte|inasistencia/i);
    },
  );

  it("criterio 6: un reporte en revisión sobre un desembolso vencido sale como en_espera; al rechazarlo vuelve a listo, y al aceptarlo (criterio 8) queda anulado, sin ninguna cifra ni llave", async () => {
    const rechazado = await vieja(2, [{ estado: "aprobado", monto: 41_000 }]);
    const reporte = await fx.crearReporte({ idMonitoria: rechazado.monitoria.id, idAdmin: admin.usuario.id, estado: "en_revision" });
    expect((await leer(rechazado.desembolso.id)).situacion).toBe("en_espera");
    expect(await resolverReporte(admin.cliente, { idReporte: reporte.id, decision: "rechazar", observaciones: null })).toBe("rechazado");
    expect(await leer(rechazado.desembolso.id)).toMatchObject({ situacion: "listo", montos: { bruto: 41_000, comision: 4_100, neto: 36_900 } });

    const aceptado = await vieja(3, [{ estado: "aprobado", monto: 41_000 }]);
    const otro = await fx.crearReporte({ idMonitoria: aceptado.monitoria.id, idAdmin: admin.usuario.id, estado: "en_revision" });
    expect((await leer(aceptado.desembolso.id)).situacion).toBe("en_espera");
    expect(await resolverReporte(admin.cliente, { idReporte: otro.id, decision: "aceptar", observaciones: null })).toBe("aceptado");

    const d = await leer(aceptado.desembolso.id);
    expect(d).toMatchObject({ situacion: "anulado", montos: null, llaveDestino: null, referencia: null, diaDeTransferencia: null, desembolsableDesde: null });
    expect(textoDeSituacion(d)).toBe(TEXTOS.anulado);
    const cruda = (await crudas(monitorA.cliente)).find((f) => f.id_desembolso === aceptado.desembolso.id)!;
    expect(dineroDe(cruda)).toEqual([]);
    expect(agruparDesembolsos((await cargar()).desembolsos).anulados.map((x) => x.idDesembolso)).toEqual([aceptado.desembolso.id]);
  });

  it("criterio 5: un caso P-24 cerrado como asumido deja de retener el desembolso y su monto cuenta en el total (HU-078)", async () => {
    const { desembolso, pagos } = await vieja(2, [
      { estado: "aprobado", monto: 20_000 },
      { estado: "rechazado", monto: 10_000 },
    ]);
    expect(await leer(desembolso.id)).toMatchObject({ situacion: "pago_rechazado", montos: { bruto: 20_000, comision: 2_000, neto: 18_000 } });

    expect(await cerrarCasoP24(admin.cliente, { idPago: pagos[1].id, cierre: "asumido", nota: null })).toBe("cerrado");
    expect(await leer(desembolso.id)).toMatchObject({ situacion: "listo", montos: { bruto: 30_000, comision: 3_000, neto: 27_000 } });
  });

  it("criterio 7: el admin ejecuta con la función real y el monitor ve el día de la transferencia, la referencia, la llave copiada y los montos de ese momento (P-29), y no quién lo ejecutó; la llave guardada no cambia cuando el monitor edita la suya", async () => {
    // La foto es de 25.000; después se aprobó otro pago: 37.000 aprobados, comisión de 3.700 y neto de 33.300.
    const { desembolso } = await vieja(2, [
      { estado: "aprobado", monto: 25_000 },
      { estado: "aprobado", monto: 12_000 },
    ]);
    expect(await leer(desembolso.id)).toMatchObject({ situacion: "listo", montos: { bruto: 37_000, comision: 3_700, neto: 33_300 }, referencia: null });

    const referencia = `TRX-${randomUUID().slice(0, 8)}`;
    expect(await ejecutarDesembolso(admin.cliente, { idDesembolso: desembolso.id, referencia, fecha: hoy(), netoEsperado: 33_300 })).toBe("desembolsado");

    const llaveAnterior = llaveGuardadaDe(monitorA);
    const d = await leer(desembolso.id);
    expect(d).toMatchObject({
      situacion: "transferido",
      diaDeTransferencia: hoy(),
      referencia,
      llaveDestino: llaveAnterior,
      montos: { bruto: 37_000, comision: 3_700, neto: 33_300 },
      desembolsableDesde: null,
    });
    expect(textoDeSituacion(d)).toBe(`Transferido el ${formatearDia(hoy())}.`);
    sinDatosAjenos(await crudas(monitorA.cliente));
    sinDatosAjenos(await cargar());

    // HU-013: si después el monitor cambia su llave, la del desembolso transferido sigue siendo la que tenía.
    const nueva = `llave-nueva-${randomUUID()}`;
    exito(await monitorA.cliente.from("monitor_privado").update({ llave: nueva }).eq("id_monitor", monitorA.usuario.id).select("llave").single(), "cambiar la llave");
    const despues = await cargar();
    expect(despues.llaveActual).toBe(nueva);
    expect(despues.desembolsos.find((x) => x.idDesembolso === desembolso.id)).toMatchObject({ llaveDestino: llaveAnterior });
    expect(avisoDeLlave(d, nueva, "soporte@calibra.test")).toBeNull();
  });

  it("D-59 b: un reporte creado por la puerta real de HU-029 sobre un desembolso en_plazo no cambia nada de lo que lee el monitor: misma situación, misma frase y misma fecha", async () => {
    const { desembolso, monitoria } = await empezadaHaceTresHoras([{ estado: "aprobado", monto: 41_000 }], { lead: leadDeLaSesion });
    const antes = await leer(desembolso.id);
    expect(antes.situacion).toBe("en_plazo");

    expect(await reportarInasistenciaDeMiCita(sesionLead.cliente, monitoria.id)).toBe("reportada");

    const despues = await leer(desembolso.id);
    expect(despues).toEqual(antes);
    expect(frase(despues)).toBe(frase(antes));
    expect(textoDeSituacion(despues)).not.toMatch(/reporte|inasistencia/i);
    const cruda = (await crudas(monitorA.cliente)).find((f) => f.id_desembolso === desembolso.id)!;
    expect(cruda.situacion).toBe("en_plazo");
  });
});

describe("criterios 9 y 10: las tres cifras, de ahora para lo que se va a transferir y lo guardado para lo transferido", () => {
  it("un por transferir creado con una foto distinta de los pagos de hoy muestra el monto de ahora, igual al neto que el admin ve; si entra otro pago cambia con él; ejecutado, queda fijo", async () => {
    // Foto de 25.000/2.500/22.500; pagos de 37.000 aprobados (3.700 de comisión, 33.300 de neto).
    const { monitoria, desembolso } = await vieja(2, [
      { estado: "aprobado", monto: 25_000 },
      { estado: "aprobado", monto: 12_000 },
    ]);
    const d = await leer(desembolso.id);
    expect(d.montos).toEqual({ bruto: 37_000, comision: 3_700, neto: 33_300 });
    expect(await estadoDelAdmin(desembolso.id)).toEqual([{ motivo: null, monto_neto: 33_300 }]);
    expect(frase(d)).toBe(TEXTOS.listo);

    // Entra otro pago antes de ejecutar: el por transferir se mueve con los pagos (P-29) y sigue igual al neto del admin.
    await fx.crearPagoDe(monitoria.id, { idAdmin: admin.usuario.id, estado: "aprobado", monto: 10_000 });
    expect((await leer(desembolso.id)).montos).toEqual({ bruto: 47_000, comision: 4_700, neto: 42_300 });
    expect(await estadoDelAdmin(desembolso.id)).toEqual([{ motivo: null, monto_neto: 42_300 }]);

    // Ejecutado, lo transferido es lo que quedó al ejecutar: otro pago después no lo mueve.
    expect(await ejecutarDesembolso(admin.cliente, { idDesembolso: desembolso.id, referencia: `TRX-${randomUUID().slice(0, 8)}`, fecha: hoy(), netoEsperado: 42_300 })).toBe(
      "desembolsado",
    );
    expect((await leer(desembolso.id)).montos).toEqual({ bruto: 47_000, comision: 4_700, neto: 42_300 });
    await fx.crearPagoDe(monitoria.id, { idAdmin: admin.usuario.id, estado: "aprobado", monto: 5_000 });
    expect(await leer(desembolso.id)).toMatchObject({ situacion: "transferido", montos: { bruto: 47_000, comision: 4_700, neto: 42_300 } });
  });

  it("una foto en 0 con un pago aprobado después también muestra lo de ahora, y un desembolso sin pagos aprobados trae las tres cifras en 0", async () => {
    const conFotoEnCero = await vieja(2, [{ estado: "aprobado", monto: 25_000 }], { foto: { bruto: 0, comision: 0, neto: 0 } });
    expect((await leer(conFotoEnCero.desembolso.id)).montos).toEqual({ bruto: 25_000, comision: 2_500, neto: 22_500 });

    const sinPagos = await vieja(3, []);
    expect(await leer(sinPagos.desembolso.id)).toMatchObject({ situacion: "en_espera", montos: { bruto: 0, comision: 0, neto: 0 } });
  });
});

describe("criterio 4: lo que el monitor ve listo es lo que el admin ve en «Desembolsos ejecutables»", () => {
  it("los desembolsos listos del monitor son los de la bandeja del admin, y la única que la bandeja ofrece de más es la defensa no_realizada, que en la pantalla del monitor es una espera", async () => {
    const listo = await vieja(2, [{ estado: "aprobado" }]);
    const conReporteRechazado = await vieja(3, [{ estado: "aprobado" }]);
    await fx.crearReporte({ idMonitoria: conReporteRechazado.monitoria.id, idAdmin: admin.usuario.id, estado: "rechazado" });
    const conPagoEnRevision = await vieja(4, [{ estado: "aprobado" }, { estado: "en_revision" }]);
    const conCasoAbierto = await vieja(5, [{ estado: "aprobado" }, { estado: "rechazado" }]);
    const conReporte = await vieja(6, [{ estado: "aprobado" }]);
    await fx.crearReporte({ idMonitoria: conReporte.monitoria.id, idAdmin: admin.usuario.id, estado: "en_revision" });
    const sinPagos = await vieja(7, []);
    const enPlazo = await empezadaHaceTresHoras([{ estado: "aprobado" }]);
    const noRealizada = await vieja(8, [{ estado: "aprobado" }], { cancelada: true });

    const deLaPrueba = [listo, conReporteRechazado, conPagoEnRevision, conCasoAbierto, conReporte, sinPagos, enPlazo, noRealizada].map((x) => x.desembolso.id);
    const { desembolsos } = await cargar();
    expect(desembolsos.map((d) => d.idDesembolso).sort()).toEqual([...deLaPrueba].sort());

    const delMonitor = (situacion: Situacion) => desembolsos.filter((d) => d.situacion === situacion).map((d) => d.idDesembolso);
    expect(delMonitor("listo").sort()).toEqual([listo.desembolso.id, conReporteRechazado.desembolso.id].sort());
    expect(delMonitor("pago_en_revision")).toEqual([conPagoEnRevision.desembolso.id]);
    expect(delMonitor("pago_rechazado")).toEqual([conCasoAbierto.desembolso.id]);
    expect(delMonitor("en_plazo")).toEqual([enPlazo.desembolso.id]);
    expect(delMonitor("en_espera").sort()).toEqual([conReporte.desembolso.id, sinPagos.desembolso.id, noRealizada.desembolso.id].sort());

    // La bandeja es de todos los monitores y de la base compartida: solo se miran los de esta prueba.
    const enLaBandeja = (await desembolsosDeLaBandeja()).filter((id) => deLaPrueba.includes(id));
    expect(enLaBandeja.sort()).toEqual([...delMonitor("listo"), noRealizada.desembolso.id].sort());
    for (const situacion of SITUACIONES.filter((s) => s !== "listo")) {
      for (const id of delMonitor(situacion)) {
        if (id !== noRealizada.desembolso.id) expect(enLaBandeja, `${situacion} no está en la bandeja`).not.toContain(id);
      }
    }
  });
});

describe("criterio 11: la llave copiada al desembolso frente a la que el monitor tiene hoy", () => {
  it("si el monitor cambia su llave, la lectura trae la actual y la copiada, y el aviso se arma con y sin el correo de Calibra; un transferido no lleva aviso", async () => {
    const copiada = llaveGuardadaDe(monitorA);
    const porTransferir = await vieja(2, [{ estado: "aprobado" }]);
    const transferido = await vieja(3, [{ estado: "aprobado" }], { estadoDelDesembolso: "desembolsado", foto: { bruto: 18_000, comision: 1_800, neto: 16_200 } });

    // Mientras nada cambie, no hay aviso.
    const igual = await cargar();
    expect(igual.llaveActual).toBe(copiada);
    expect(avisoDeLlave(igual.desembolsos.find((d) => d.idDesembolso === porTransferir.desembolso.id)!, igual.llaveActual, "soporte@calibra.test")).toBeNull();

    // El cliente admin cambia la llave del monitor, como lo haría su formulario del panel.
    const nueva = `llave-nueva-${randomUUID()}`;
    exito(await fx.admin.from("monitor_privado").update({ llave: nueva }).eq("id_monitor", monitorA.usuario.id).select("llave").single(), "cambiar la llave del monitor");
    const { desembolsos, llaveActual } = await cargar();
    expect(llaveActual).toBe(nueva);
    const d = desembolsos.find((x) => x.idDesembolso === porTransferir.desembolso.id)!;
    expect(d.llaveDestino).toBe(copiada);

    const conCorreo = avisoDeLlave(d, llaveActual, "soporte@calibra.test");
    expect(conCorreo?.cambio).toBe(`Cambiaste tu llave después de esta monitoría. Los pagos que ya estaban en camino siguen yendo a la anterior: ${copiada}.`);
    expect(conCorreo?.escribirA).toBe("soporte@calibra.test");
    expect(avisoDeLlave(d, llaveActual, null)).toMatchObject({ cambio: conCorreo?.cambio, escribirA: null });
    expect(avisoDeLlave(desembolsos.find((x) => x.idDesembolso === transferido.desembolso.id)!, llaveActual, "soporte@calibra.test")).toBeNull();
  });
});

describe("la tabla desembolso sigue cerrada para el monitor", () => {
  it("con su sesión, el monitor no lee desembolso, no ve estado_para_ejecutar y no puede llamar a la comisión: lo único que recibe es la lectura de sus propios desembolsos", async () => {
    const { desembolso } = await vieja(2, [{ estado: "aprobado" }]);
    expect(exito(await monitorA.cliente.from("desembolso").select(), "leer desembolso como monitor")).toEqual([]);
    expect(exito(await monitorA.cliente.from("desembolso").select("*").eq("id", desembolso.id), "leer el desembolso por id")).toEqual([]);
    expect(exito(await monitorA.cliente.rpc("estado_para_ejecutar", { p_id_desembolso: desembolso.id }), "estado_para_ejecutar del monitor")).toEqual([]);
    for (const rpc of ["comision", "monto_neto"] as const) {
      expect((await monitorA.cliente.rpc(rpc, { p_monto_bruto: 1_000 })).error?.code, `${rpc} sin permiso`).toBe("42501");
    }
    expect((await monitorA.cliente.rpc("parametros_comision")).error?.code).toBe("42501");
    // Un admin sí lee la tabla: la política de solo admin sigue puesta.
    expect(exito(await admin.cliente.from("desembolso").select("id").eq("id", desembolso.id), "leer desembolso como admin").map((f) => f.id)).toEqual([desembolso.id]);
    // Y lo que recibe el monitor sigue siendo la lectura de la HU.
    expect((await leer(desembolso.id)).montos).toEqual({ bruto: 25_000, comision: 2_500, neto: 22_500 });
  });
});

describe("la lectura no espera a nadie (3.3 del SPEC)", () => {
  it(
    "con la monitoría y el desembolso bloqueados por un admin que ejecuta, la lectura del monitor termina sin esperar y devuelve lo de antes; sin commit ve el desembolso por transferir completo, y con el commit el transferido completo, nunca una mitad",
    async () => {
      // La foto es de 25.000; con 37.000 aprobados, comisión de 3.700 y neto de 33.300.
      const { monitoria, desembolso } = await vieja(2, [
        { estado: "aprobado", monto: 25_000 },
        { estado: "aprobado", monto: 12_000 },
      ]);
      const antes = await cargar();
      expect(antes.desembolsos.find((d) => d.idDesembolso === desembolso.id)).toMatchObject({ situacion: "listo", referencia: null, diaDeTransferencia: null });

      // 1. Los dos candados que toma ejecutar_desembolso, tomados a mano: la lectura no los espera.
      const bloqueo = await conexion();
      try {
        await bloqueo.query("begin");
        await bloqueo.query("select id from public.monitoria where id = $1 for update", [monitoria.id]);
        await bloqueo.query("select id from public.desembolso where id = $1 for update", [desembolso.id]);
        expect(await sinEsperar(cargar())).toEqual(antes);
      } finally {
        await bloqueo.query("rollback").catch(() => undefined);
        await cerrar(bloqueo);
      }

      // 2. Una ejecución de verdad, sin commit todavía: el monitor sigue viendo el por transferir completo.
      const referencia = `TRX-${randomUUID().slice(0, 8)}`;
      const ejecucion = await conexion();
      try {
        await ejecucion.query("begin");
        await como(ejecucion, admin);
        const { rows } = await ejecucion.query<{ resultado: string }>("select public.ejecutar_desembolso($1::uuid, $2, $3::date, $4) as resultado", [
          desembolso.id,
          referencia,
          hoy(),
          33_300,
        ]);
        expect(rows[0].resultado).toBe("desembolsado");

        const sinCommit = await sinEsperar(cargar());
        expect(sinCommit).toEqual(antes);
        expect(sinCommit === "se quedó esperando" ? null : sinCommit.desembolsos.find((d) => d.idDesembolso === desembolso.id)).toMatchObject({
          situacion: "listo",
          referencia: null,
          diaDeTransferencia: null,
          montos: { bruto: 37_000, comision: 3_700, neto: 33_300 },
        });

        await ejecucion.query("commit");
      } finally {
        await ejecucion.query("rollback").catch(() => undefined);
        await cerrar(ejecucion);
      }

      // 3. Con el commit, el transferido completo: situación, referencia, día, llave y montos a la vez.
      expect(await leer(desembolso.id)).toMatchObject({
        situacion: "transferido",
        referencia,
        diaDeTransferencia: hoy(),
        llaveDestino: llaveGuardadaDe(monitorA),
        montos: { bruto: 37_000, comision: 3_700, neto: 33_300 },
      });
    },
    60_000,
  );
});
