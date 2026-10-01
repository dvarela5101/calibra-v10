import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import { cierreAutomaticoDe, separarAgenda, sePuedeFinalizar, textoDeEstado, type MonitoriaDeAgenda } from "@/lib/agenda/reglas";
import { cargarAgenda, finalizarMonitoria } from "@/lib/agenda/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { cierreAutomaticoDesde, diaIsoDeFecha, finProgramado, inicioDeSesion } from "@/lib/plazos/motor";
import { cargarParametros } from "@/lib/plazos/parametros";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente } from "./utilidades";

/**
 * HU-023 contra el Supabase local: `finalizarMonitoria` y `cargarAgenda` (el mismo código de la página del
 * monitor) con la sesión de verdad de cada persona, así que también se prueban `public.finalizar_monitoria`,
 * sus permisos y que nadie actualice `monitoria` por su cuenta. El cierre automático (D-14) lo corre pg_cron
 * como postgres: aquí se llama `privado.cerrar_monitorias_sin_finalizar(ahora)` con un cliente `pg`, dentro de
 * una transacción que siempre se revierte (la base local es compartida y la función cierra cualquier
 * confirmada vencida, no solo las de la prueba). Las fechas se calculan desde hoy en Bogotá, nunca con la zona
 * del proceso.
 *
 * El escenario se arma una sola vez para gastar pocas entradas del Auth local: tres inicios de sesión con
 * contraseña (dos monitores y un admin) y una sesión anónima con Lead.
 *
 *  - Monitor 1: dueño de todas las monitorias de la prueba. Cada una lleva su propia franja, con el día y la hora
 *    del inicio que la prueba necesita (la escribe service_role, que no pasa por las reglas de horas y minutos del
 *    monitor).
 *  - Monitor 2: "otro monitor"; no tiene monitorias.
 *  - Sesión Lead: la sesión anónima del Lead que agendó las monitorias.
 *
 * POR QUÉ LOS INICIOS SON RECIENTES: la migración programa en pg_cron `calibra-cerrar-monitorias` cada 15
 * minutos (también en la base local y en la de CI), y cierra sola toda individual confirmada cuyo fin programado
 * más 24 h ya pasó. Una confirmada creada con una fecha de hace días podría cerrarse a mitad de una prueba y
 * volverla intermitente (`ya_finalizada` en vez de `finalizada`). Por eso toda confirmada empieza hace menos de
 * `MAXIMO_HACIA_ATRAS` (con la franja de 60 min su cierre queda a 5 h o más de ahora) y `individual()` lo exige.
 * Para el cierre automático no se envejece nada: se llama `privado.cerrar_monitorias_sin_finalizar` con un
 * `ahora` fijo, en el futuro, que el proceso real todavía no alcanza.
 */

const SEGUNDO = 1_000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
/** Cuánto antes de ahora puede haber empezado una confirmada sin que pg_cron la cierre a mitad de la prueba. */
const MAXIMO_HACIA_ATRAS = 20 * HORA;
/** Holgura entre el reloj de la prueba y el de la base, para "cercana a ahora". */
const TOLERANCIA = 5 * SEGUNDO;

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let fx: Fixtures;
let bd: pg.Client;
let e: Awaited<ReturnType<typeof construirEscenario>>;

beforeAll(async () => {
  await exigirSupabaseLocal();
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  fx = new Fixtures();
  try {
    e = await construirEscenario();
  } catch (error) {
    await fx.limpiar();
    throw error;
  }
}, 90_000);

afterAll(async () => {
  await bd?.end();
  await fx?.limpiar();
});

// ---------------------------------------------------------------------------------------------------------------

const ids = (agenda: MonitoriaDeAgenda[]) => agenda.map((m) => m.idMonitoria);

function porId(agenda: MonitoriaDeAgenda[], id: string): MonitoriaDeAgenda {
  const fila = agenda.find((m) => m.idMonitoria === id);
  if (!fila) throw new Error(`La monitoría ${id} no está en la agenda (hay ${agenda.length}).`);
  return fila;
}

/** Sin filas: la tabla se lee con RLS (vacío) o el permiso se niega (error); en ningún caso hay filas afectadas. */
function sinFilas(resultado: { data: unknown[] | null; error: { message: string } | null }) {
  expect(resultado.error ? [] : resultado.data).toEqual([]);
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

async function enBd(id: string) {
  return exito(
    await fx.admin.from("monitoria").select("estado, fecha_finalizacion, motivo_cancelacion").eq("id", id).single(),
    "leer la monitoría",
  );
}

type EstadoDePrueba = "pendiente_pago" | "confirmada" | "realizada" | "cancelada";

/**
 * Una monitoría del monitor 1, individual, cuyo inicio cae `desdeAhora` milisegundos desde ahora (negativo: ya
 * empezó), en su propia franja de una hora. El inicio se calcula en Bogotá desde el mismo instante, con el día y la
 * hora que la base guarda. Una confirmada no puede empezar hace más de `MAXIMO_HACIA_ATRAS` (ver el encabezado).
 */
async function individual(desdeAhora: number, estado: EstadoDePrueba = "confirmada", fechaFinalizacion?: string) {
  if (estado === "confirmada" && desdeAhora < -MAXIMO_HACIA_ATRAS) {
    throw new Error("Una confirmada de la prueba no puede empezar hace más de 20 h: pg_cron la cerraría sola a mitad de la prueba.");
  }
  const inicio = new Date(Math.floor(Date.now() / SEGUNDO) * SEGUNDO + desdeAhora);
  const sesion = sesionEn(inicio);
  const franja = await fx.crearFranja({ idMonitor: e.monitor1.id, dia: sesion.dia, hora: sesion.hora });
  const monitoria = await fx.crearMonitoria({ ...e.base1, franja }, { fecha: sesion.fecha, estado, fechaFinalizacion });
  return { ...monitoria, franja, inicio };
}

/** Una confirmada grupal: la individual más su fila en `monitoria_grupal`. */
async function grupal(desdeAhora: number) {
  const monitoria = await individual(desdeAhora);
  exito(
    await fx.admin.from("monitoria_grupal").insert({ id_monitoria: monitoria.id, cupos: 3, modalidad_pago: "unico", precio_por_persona: 10_000 }).select().single(),
    "insertar monitoria_grupal",
  );
  return monitoria;
}

async function construirEscenario() {
  const admin = await fx.crearAdmin();
  const sesionAdmin = await fx.iniciarSesion(admin);

  const sesionLead = await fx.crearAnonimo();
  const lead = await fx.crearLeadDeSesion(sesionLead.id);

  const contexto1 = await fx.crearContextoDeMonitoria(admin.id);
  const sesionM1 = await fx.iniciarSesion(contexto1.monitor);
  const monitor2 = await fx.crearMonitor();
  const sesionM2 = await fx.iniciarSesion(monitor2);

  return {
    admin,
    sesionAdmin,
    sesionLead,
    lead,
    monitor1: contexto1.monitor,
    sesionM1,
    monitor2,
    sesionM2,
    base1: { ...contexto1, lead },
    parametros: await cargarParametros(sesionM1),
  };
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1 (RN-71, RN-80): el monitor finaliza una sesión que ya empezó", () => {
  it("una confirmada que ya empezó pasa a realizada con fecha de finalización cercana a ahora, y la agenda del monitor la mueve de por finalizar a pasadas como «Realizada»", async () => {
    const monitoria = await individual(-2 * HORA);
    const antes = separarAgenda(await cargarAgenda(e.sesionM1), new Date());
    expect(ids(antes.porFinalizar)).toContain(monitoria.id);
    expect(ids(antes.pasadas)).not.toContain(monitoria.id);
    expect(textoDeEstado(porId(antes.porFinalizar, monitoria.id))).toBe("Confirmada");

    const desde = Date.now();
    const resultado = await finalizarMonitoria(e.sesionM1, monitoria.id);
    const hasta = Date.now();

    expect(resultado).toBe("finalizada");
    const fila = await enBd(monitoria.id);
    expect(fila).toMatchObject({ estado: "realizada", motivo_cancelacion: null });
    expect(fila.fecha_finalizacion).not.toBeNull();
    const finalizada = new Date(String(fila.fecha_finalizacion)).getTime();
    expect(finalizada).toBeGreaterThanOrEqual(desde - TOLERANCIA);
    expect(finalizada).toBeLessThanOrEqual(hasta + TOLERANCIA);

    const despues = separarAgenda(await cargarAgenda(e.sesionM1), new Date());
    expect(ids(despues.porFinalizar)).not.toContain(monitoria.id);
    expect(ids(despues.proximas)).not.toContain(monitoria.id);
    expect(ids(despues.pasadas)).toContain(monitoria.id);
    const enPasadas = porId(despues.pasadas, monitoria.id);
    expect(enPasadas.estado).toBe("realizada");
    expect(textoDeEstado(enPasadas)).toBe("Realizada");
  });

  it("el monitor también finaliza una grupal confirmada que ya empezó (las grupales no se cierran solas: las finaliza su monitor)", async () => {
    const monitoria = await grupal(-2 * HORA);

    expect(await finalizarMonitoria(e.sesionM1, monitoria.id)).toBe("finalizada");

    const fila = await enBd(monitoria.id);
    expect(fila.estado).toBe("realizada");
    expect(fila.fecha_finalizacion).not.toBeNull();
  });
});

describe("criterio 2 (D-13): no se finaliza antes del inicio, y con la hora exacta ya se puede", () => {
  it("una que empieza en 1 minuto no se puede finalizar (no_empezo, nada cambia) y una que empezó hace 1 minuto sí (finalizada); sePuedeFinalizar coincide con la base en ambos casos", async () => {
    // El inicio queda a un minuto de ahora, hacia un lado y hacia el otro, con la hora al segundo.
    const futura = await individual(MINUTO);
    const pasada = await individual(-MINUTO);

    const agenda = await cargarAgenda(e.sesionM1);
    const ahora = new Date();
    const filaFutura = porId(agenda, futura.id);
    const filaPasada = porId(agenda, pasada.id);
    // El inicio que calcula la base (fecha más hora de la franja, en Bogotá) es el que se quiso crear.
    expect(filaFutura.inicio.getTime()).toBe(futura.inicio.getTime());
    expect(filaPasada.inicio.getTime()).toBe(pasada.inicio.getTime());
    expect(filaFutura.inicio.getTime() - ahora.getTime()).toBeGreaterThan(0);
    expect(ahora.getTime() - filaPasada.inicio.getTime()).toBeGreaterThan(0);
    // Lo que decide la app (la agenda) ...
    expect(sePuedeFinalizar(filaFutura, ahora)).toBe(false);
    expect(sePuedeFinalizar(filaPasada, ahora)).toBe(true);
    const separada = separarAgenda(agenda, ahora);
    expect(ids(separada.proximas)).toContain(futura.id);
    expect(ids(separada.porFinalizar)).toContain(pasada.id);

    // ... es lo que decide la base.
    expect(await finalizarMonitoria(e.sesionM1, futura.id)).toBe("no_empezo");
    expect(await enBd(futura.id)).toMatchObject({ estado: "confirmada", fecha_finalizacion: null });
    expect(ids(separarAgenda(await cargarAgenda(e.sesionM1), new Date()).proximas)).toContain(futura.id);

    expect(await finalizarMonitoria(e.sesionM1, pasada.id)).toBe("finalizada");
    expect(await enBd(pasada.id)).toMatchObject({ estado: "realizada" });

    // El borde del lado de la app: con la hora exacta ya se puede (P-40); un milisegundo antes, no.
    expect(sePuedeFinalizar({ estado: "confirmada", inicio: filaFutura.inicio }, filaFutura.inicio)).toBe(true);
    expect(sePuedeFinalizar({ estado: "confirmada", inicio: filaFutura.inicio }, new Date(filaFutura.inicio.getTime() - 1))).toBe(false);
  });

  it("una confirmada que empieza en unas horas no se puede finalizar: no_empezo y nada cambia", async () => {
    const monitoria = await individual(3 * HORA);

    expect(await finalizarMonitoria(e.sesionM1, monitoria.id)).toBe("no_empezo");

    expect(await enBd(monitoria.id)).toMatchObject({ estado: "confirmada", fecha_finalizacion: null });
    const agenda = await cargarAgenda(e.sesionM1);
    expect(sePuedeFinalizar(porId(agenda, monitoria.id), new Date())).toBe(false);
  });
});

describe("quién y cuándo puede finalizar (security definer: la identidad sale de auth.uid())", () => {
  const otros: [string, () => Cliente][] = [
    ["otro monitor", () => e.sesionM2],
    ["un admin", () => e.sesionAdmin],
    ["un Lead (sesión anónima con Lead)", () => e.sesionLead.cliente],
  ];

  it.each(otros)("%s no puede finalizar la monitoría de otro monitor: no_encontrada y nada cambia", async (_quien, sesion) => {
    const monitoria = await individual(-2 * HORA);

    expect(await finalizarMonitoria(sesion(), monitoria.id)).toBe("no_encontrada");

    expect(await enBd(monitoria.id)).toMatchObject({ estado: "confirmada", fecha_finalizacion: null });
  });

  it("una monitoría que no existe también es no_encontrada (no se dice si no existe o es de otro)", async () => {
    expect(await finalizarMonitoria(e.sesionM1, randomUUID())).toBe("no_encontrada");
  });

  it("sin sesión la base niega el permiso (error de permisos, no un resultado) y nada cambia", async () => {
    const monitoria = await individual(-2 * HORA);

    await expect(finalizarMonitoria(crearCliente(), monitoria.id)).rejects.toThrow(/42501|permission denied/i);

    expect(await enBd(monitoria.id)).toMatchObject({ estado: "confirmada", fecha_finalizacion: null });
  });

  it.each(["pendiente_pago", "cancelada"] as const)("una monitoría %s del propio monitor es no_confirmada: no hay sesión que finalizar, y nada cambia", async (estado) => {
    const monitoria = await individual(-2 * HORA, estado);
    const antes = await enBd(monitoria.id);

    expect(await finalizarMonitoria(e.sesionM1, monitoria.id)).toBe("no_confirmada");

    expect(await enBd(monitoria.id)).toEqual(antes);
    expect(antes.fecha_finalizacion).toBeNull();
  });

  it("finalizar dos veces: la primera finaliza y la segunda es ya_finalizada, sin cambiar la fecha de finalización", async () => {
    const monitoria = await individual(-2 * HORA);

    expect(await finalizarMonitoria(e.sesionM1, monitoria.id)).toBe("finalizada");
    const primera = await enBd(monitoria.id);
    expect(await finalizarMonitoria(e.sesionM1, monitoria.id)).toBe("ya_finalizada");

    expect(primera.estado).toBe("realizada");
    expect(await enBd(monitoria.id)).toEqual(primera);
  });

  it("una que ya estaba realizada (por ejemplo, la cerró sola el cierre automático un instante antes) es ya_finalizada y conserva su fecha", async () => {
    const fechaFinalizacion = new Date(Date.now() - 3 * HORA).toISOString();
    const monitoria = await individual(-5 * HORA, "realizada", fechaFinalizacion);
    const antes = await enBd(monitoria.id);

    expect(await finalizarMonitoria(e.sesionM1, monitoria.id)).toBe("ya_finalizada");

    expect(await enBd(monitoria.id)).toEqual(antes);
    expect(new Date(String(antes.fecha_finalizacion)).toISOString()).toBe(fechaFinalizacion);
  });

  const quienes: [string, () => Cliente][] = [["el monitor dueño", () => e.sesionM1], ...otros, ["una sesión sin cuenta", () => crearCliente()]];

  it.each(quienes)("%s no puede actualizar `monitoria` directamente: error de permisos o ninguna fila, y la monitoría no cambia", async (_quien, sesion) => {
    const monitoria = await individual(-2 * HORA);

    const resultado = await sesion()
      .from("monitoria")
      .update({ estado: "realizada", fecha_finalizacion: new Date().toISOString() })
      .eq("id", monitoria.id)
      .select();

    sinFilas(resultado);
    expect(await enBd(monitoria.id)).toMatchObject({ estado: "confirmada", fecha_finalizacion: null });
  });
});

describe("criterio 3 (P-05, D-14): una individual sin finalizar se cierra sola 24 h después del fin programado", () => {
  /** El instante desde el que la base cierra sola la monitoría: el fin programado más el cierre automático. */
  function cierreDe(monitoria: { inicio: Date; franja: { duracion_min: number } }): Date {
    return cierreAutomaticoDesde(finProgramado(monitoria.inicio, monitoria.franja.duracion_min), e.parametros);
  }

  /**
   * Corre `privado.cerrar_monitorias_sin_finalizar` y lee el resultado, todo dentro de una transacción que se
   * revierte: la función cierra cualquier individual confirmada vencida de la base local, no solo las de la
   * prueba, y eso no debe quedar escrito.
   */
  async function enTransaccionRevertida<T>(accion: () => Promise<T>): Promise<T> {
    await bd.query("begin");
    try {
      return await accion();
    } finally {
      await bd.query("rollback");
    }
  }

  async function cerrar(ahora: Date): Promise<number> {
    const { rows } = await bd.query<{ cerradas: number }>("select privado.cerrar_monitorias_sin_finalizar($1::timestamptz) as cerradas", [ahora.toISOString()]);
    return rows[0].cerradas;
  }

  async function leer(id: string) {
    const { rows } = await bd.query<{ estado: string; fecha_finalizacion: Date | null; motivo_cancelacion: string | null }>(
      "select estado, fecha_finalizacion, motivo_cancelacion from public.monitoria where id = $1",
      [id],
    );
    return rows[0];
  }

  /** Cuántas filas tienen exactamente esa fecha de finalización: las que acaba de cerrar la función. */
  async function conFinalizacion(ahora: Date): Promise<number> {
    const { rows } = await bd.query<{ n: string }>("select count(*) as n from public.monitoria where fecha_finalizacion = $1::timestamptz", [ahora.toISOString()]);
    return Number(rows[0].n);
  }

  it("el parámetro cierre_automatico_min es de 24 horas (1440 minutos) y el cierre es el fin programado más ese plazo", async () => {
    expect(e.parametros.cierreAutomaticoMin).toBe(24 * 60);
    const monitoria = await individual(-2 * HORA);

    expect(cierreDe(monitoria).getTime()).toBe(monitoria.inicio.getTime() + (monitoria.franja.duracion_min + 24 * 60) * MINUTO);
  });

  it("cierra la individual confirmada justo en cierreAutomaticoDesde (borde inclusivo) y no un milisegundo antes; fecha_finalizacion es el momento del cierre", async () => {
    const monitoria = await individual(-2 * HORA);
    const limite = cierreDe(monitoria);

    await enTransaccionRevertida(async () => {
      await cerrar(new Date(limite.getTime() - 1));
      expect(await leer(monitoria.id)).toMatchObject({ estado: "confirmada", fecha_finalizacion: null });

      const cerradas = await cerrar(limite);

      expect(cerradas).toBeGreaterThanOrEqual(1);
      expect(cerradas).toBe(await conFinalizacion(limite));
      const fila = await leer(monitoria.id);
      expect(fila.estado).toBe("realizada");
      expect(fila.fecha_finalizacion?.getTime()).toBe(limite.getTime());
    });
    // La transacción se revirtió: en la base real la monitoría sigue confirmada.
    expect(await enBd(monitoria.id)).toMatchObject({ estado: "confirmada", fecha_finalizacion: null });
  });

  it("no toca las grupales, las pendientes de pago, las canceladas ni las realizadas, aunque su cierre ya haya pasado", async () => {
    // La individual es la más reciente de las cinco: las demás empezaron antes, así que su cierre (de haber sido
    // individuales confirmadas) ya habría pasado en el `ahora` con que se cierra la individual.
    const individualConfirmada = await individual(-HORA);
    const deGrupo = await grupal(-2 * HORA);
    const pendiente = await individual(-3 * HORA, "pendiente_pago");
    const cancelada = await individual(-4 * HORA, "cancelada");
    const finalizadaAntes = new Date(Date.now() - 2 * HORA).toISOString();
    const realizada = await individual(-5 * HORA, "realizada", finalizadaAntes);
    const limite = cierreDe(individualConfirmada);
    for (const otra of [deGrupo, pendiente, cancelada, realizada]) expect(cierreDe(otra).getTime()).toBeLessThan(limite.getTime());

    await enTransaccionRevertida(async () => {
      const cerradas = await cerrar(limite);

      expect(cerradas).toBe(await conFinalizacion(limite));
      expect((await leer(individualConfirmada.id)).fecha_finalizacion?.getTime()).toBe(limite.getTime());
      expect(await leer(deGrupo.id)).toMatchObject({ estado: "confirmada", fecha_finalizacion: null });
      expect(await leer(pendiente.id)).toMatchObject({ estado: "pendiente_pago", fecha_finalizacion: null });
      expect(await leer(cancelada.id)).toMatchObject({ estado: "cancelada", fecha_finalizacion: null, motivo_cancelacion: "estudiante" });
      const yaRealizada = await leer(realizada.id);
      expect(yaRealizada.estado).toBe("realizada");
      expect(yaRealizada.fecha_finalizacion?.toISOString()).toBe(finalizadaAntes);
    });
  });

  it("correrla dos veces seguidas: la segunda devuelve 0 y no cambia ninguna fecha de finalización", async () => {
    const monitoria = await individual(-2 * HORA);
    const limite = cierreDe(monitoria);

    await enTransaccionRevertida(async () => {
      expect(await cerrar(limite)).toBeGreaterThanOrEqual(1);
      const despuesDeLaPrimera = await leer(monitoria.id);

      expect(await cerrar(limite)).toBe(0);
      // Una corrida posterior puede cerrar otras monitorías de la base compartida, pero no vuelve a tocar lo ya cerrado.
      await cerrar(new Date(limite.getTime() + HORA));

      expect(await leer(monitoria.id)).toEqual(despuesDeLaPrimera);
      expect(despuesDeLaPrimera.fecha_finalizacion?.getTime()).toBe(limite.getTime());
    });
  });

  it("una individual que su monitor ya finalizó no se vuelve a cerrar: conserva su fecha de finalización", async () => {
    const monitoria = await individual(-2 * HORA);
    expect(await finalizarMonitoria(e.sesionM1, monitoria.id)).toBe("finalizada");
    const finalizada = await enBd(monitoria.id);

    await enTransaccionRevertida(async () => {
      await cerrar(cierreDe(monitoria));

      const fila = await leer(monitoria.id);
      expect(fila.estado).toBe("realizada");
      expect(fila.fecha_finalizacion?.toISOString()).toBe(new Date(String(finalizada.fecha_finalizacion)).toISOString());
    });
  });

  it("cierreAutomaticoDe (la agenda) coincide con public.cierre_automatico_desde de la base para la misma monitoría", async () => {
    const monitoria = await individual(-2 * HORA);
    const fila = porId(await cargarAgenda(e.sesionM1), monitoria.id);

    const { rows } = await bd.query<{ cierre: Date }>(
      `select public.cierre_automatico_desde(public.fin_programado(public.inicio_sesion(m.fecha, f.hora), f.duracion_min)) as cierre
       from public.monitoria m join public.franja f on f.id = m.id_franja
       where m.id = $1`,
      [monitoria.id],
    );
    const porRpc = exito(await e.sesionM1.rpc("cierre_automatico_desde", { p_fin_programado: finProgramado(fila.inicio, fila.duracionMin).toISOString() }), "cierre_automatico_desde");

    const deLaAgenda = cierreAutomaticoDe(fila, e.parametros);
    expect(deLaAgenda.getTime()).toBe(rows[0].cierre.getTime());
    expect(deLaAgenda.getTime()).toBe(new Date(porRpc).getTime());
    expect(deLaAgenda.getTime()).toBe(cierreDe(monitoria).getTime());
  });

  it("el cierre automático no se expone: ni authenticated ni anon pueden ejecutarlo", async () => {
    for (const rol of ["authenticated", "anon"]) {
      await bd.query("begin");
      try {
        await bd.query(`set local role ${rol}`);
        await expect(bd.query("select privado.cerrar_monitorias_sin_finalizar(now())")).rejects.toThrow(/permission denied/i);
      } finally {
        await bd.query("rollback");
      }
    }
  });

  it("pg_cron lo corre cada 15 minutos con la hora de la base", async () => {
    const { rows } = await bd.query<{ schedule: string; command: string; active: boolean }>(
      "select schedule, command, active from cron.job where jobname = 'calibra-cerrar-monitorias'",
    );

    expect(rows).toEqual([{ schedule: "*/15 * * * *", command: "select privado.cerrar_monitorias_sin_finalizar(now())", active: true }]);
  });
});

describe("recordatorio (D-15): la agenda del monitor pone por finalizar las confirmadas que ya empezaron", () => {
  it("por finalizar trae las confirmadas que ya empezaron, de la más antigua a la más reciente, y no las futuras, las pendientes ni las canceladas", async () => {
    // Se crean de la más reciente a la más antigua: el orden de la agenda es por inicio, no por creación.
    const reciente = await individual(-2 * HORA);
    const antigua = await individual(-4 * HORA);
    const futura = await individual(3 * HORA);
    const pendiente = await individual(-3 * HORA, "pendiente_pago");
    const cancelada = await individual(-5 * HORA, "cancelada");
    const ahora = new Date();

    const { porFinalizar, proximas, pasadas } = separarAgenda(await cargarAgenda(e.sesionM1), ahora);

    const mias = [reciente.id, antigua.id];
    expect(ids(porFinalizar).filter((id) => mias.includes(id))).toEqual([antigua.id, reciente.id]);
    for (const m of porFinalizar) {
      expect(m.estado).toBe("confirmada");
      expect(m.inicio.getTime()).toBeLessThanOrEqual(ahora.getTime());
      expect(textoDeEstado(m)).toBe("Confirmada");
    }
    const inicios = porFinalizar.map((m) => m.inicio.getTime());
    expect(inicios).toEqual([...inicios].sort((a, b) => a - b));
    for (const id of [futura.id, pendiente.id, cancelada.id]) expect(ids(porFinalizar)).not.toContain(id);
    expect(ids(proximas)).toContain(futura.id);
    expect(ids(pasadas)).toContain(cancelada.id);
  });

  it("al finalizar la más antigua, sale de por finalizar y las demás siguen ahí", async () => {
    const reciente = await individual(-2 * HORA);
    const antigua = await individual(-4 * HORA);

    expect(await finalizarMonitoria(e.sesionM1, antigua.id)).toBe("finalizada");

    const { porFinalizar, pasadas } = separarAgenda(await cargarAgenda(e.sesionM1), new Date());
    expect(ids(porFinalizar)).toContain(reciente.id);
    expect(ids(porFinalizar)).not.toContain(antigua.id);
    expect(ids(pasadas)).toContain(antigua.id);
  });

  it("la agenda de otro monitor no trae las monitorías por finalizar de este", async () => {
    const monitoria = await individual(-2 * HORA);

    const ajena = await cargarAgenda(e.sesionM2);

    expect(ids(ajena)).not.toContain(monitoria.id);
    expect(ajena).toEqual([]);
  });
});
