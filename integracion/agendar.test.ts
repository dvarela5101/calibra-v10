import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import { requiereAvisoSinCancelacion, type PedidoDeAgendar } from "@/lib/agendar/reglas";
import { agendarMonitoria, cargarReserva } from "@/lib/agendar/servidor";
import { desactivarCuenta, reactivarCuenta } from "@/lib/auth/cuentas";
import { SEMANAS_DEL_HORIZONTE, type FechaLibre } from "@/lib/disponibilidad/reglas";
import { cargarFechasLibres } from "@/lib/disponibilidad/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { cancelableHasta, cumpleAntelacion, diaIsoDeFecha, inicioDeSesion, reservaHasta } from "@/lib/plazos/motor";
import { cargarParametros } from "@/lib/plazos/parametros";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, idsVisibles, type Cliente } from "./utilidades";

/**
 * HU-017 contra el Supabase local: `agendarMonitoria` y `cargarReserva` (el mismo código de la página) con la
 * sesión anónima de verdad de cada persona, así que también se prueban las políticas y los permisos. Las
 * fechas se calculan desde hoy en Bogotá, nunca con la zona del proceso.
 *
 * Casi todo usa una franja que cae a 2 días o más: la antelación de 3 h no depende de la hora en que corre la
 * prueba. Los casos de menos de 12 h o de 3 h crean una franja cuyo inicio cae a pocas horas de ahora (el día
 * y la hora salen del mismo instante, en Bogotá) y dejan un margen de segundos al borde, porque la base
 * decide con su propio `now()`.
 *
 * El Auth local deja crear 150 sesiones anónimas por hora por IP y el resto de la suite ya usa muchas: este
 * archivo crea solo dos, una vez, y cada prueba les pone y les quita su Lead.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

type Sesion = Awaited<ReturnType<Fixtures["crearAnonimo"]>>;

let fx: Fixtures;
let sesiones: Fixtures;
let bd: pg.Client;
/**
 * Dos sesiones anónimas que se crean una sola vez para todo el archivo (el Auth local limita las sesiones
 * anónimas por hora). Ninguna es Lead de entrada: cada prueba le crea el suyo (`sesionLead`) y `fx.limpiar()`
 * lo borra al terminar, junto con sus monitorías y diagnósticos.
 */
let pool: [Sesion, Sesion];

beforeAll(async () => {
  await exigirSupabaseLocal();
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  sesiones = new Fixtures();
  try {
    pool = [await sesiones.crearAnonimo(), await sesiones.crearAnonimo()];
  } catch (error) {
    await sesiones.limpiar();
    throw error;
  }
});

afterAll(async () => {
  await bd?.end();
  await sesiones?.limpiar();
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  await fx.limpiar();
});

/** `AAAA-MM-DD` más `dias` días (aritmética de calendario, sin zona). */
function sumarDias(fecha: string, dias: number): string {
  const instante = new Date(`${fecha}T12:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

const hoy = () => diaDelNegocio(new Date());

const formatoHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** `HH:MM:SS` de un instante en la zona del negocio. */
const horaDelNegocio = (instante: Date) => formatoHora.format(instante);

const fechasDe = (libres: FechaLibre[], idFranja: string) => libres.filter((f) => f.idFranja === idFranja).map((f) => f.fecha);

/** Una de las sesiones anónimas del archivo, ya con su contacto dejado: es Lead (HU-068). */
async function sesionLead(numero: 0 | 1 = 0) {
  const sesion = pool[numero];
  const lead = await fx.crearLeadDeSesion(sesion.id);
  return { ...sesion, lead };
}

/**
 * Una materia (con su evaluación) y un monitor certificado con su franja semanal, que cae dentro de 2 días a
 * las 10:00 (90 min, $ 32.000).
 */
async function escenario() {
  const admin = await fx.crearAdmin();
  const { materia, evaluacion } = await fx.crearEvaluacion();
  const monitor = await fx.crearMonitor();
  await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
  const primera = sumarDias(hoy(), 2);
  const franja = await fx.crearFranja({
    idMonitor: monitor.id,
    dia: diaIsoDeFecha(primera),
    hora: "10:00",
    presencial: true,
    precio: 32_000,
    duracionMin: 90,
    abiertaDesde: hoy(),
  });
  const pedido = (fecha: string, idFranja = franja.id): PedidoDeAgendar => ({ idFranja, fecha, codigoMateria: materia.codigo });
  return { admin, materia, evaluacion, monitor, franja, primera, pedido };
}

/**
 * Una franja del monitor cuyo próximo inicio cae dentro de `ms` milisegundos (al segundo). La fecha, el día de la
 * semana y la hora salen del mismo instante en Bogotá, así que si cruza la medianoche la fecha ya es la de mañana.
 */
async function franjaQueEmpezaEn(idMonitor: string, codigoMateria: string, ms: number) {
  const inicio = new Date(Math.floor((Date.now() + ms) / 1000) * 1000);
  const fecha = diaDelNegocio(inicio);
  const hora = horaDelNegocio(inicio);
  expect(inicioDeSesion(fecha, hora).getTime(), "la fecha y la hora de pared deben dar el mismo instante").toBe(inicio.getTime());
  const franja = await fx.crearFranja({ idMonitor, dia: diaIsoDeFecha(fecha), hora });
  const pedido: PedidoDeAgendar = { idFranja: franja.id, fecha, codigoMateria };
  return { franja, fecha, inicio, pedido };
}

/** Agenda con la sesión de `cliente` y anota la monitoría que cree para que la limpieza la borre. */
async function agendar(cliente: Cliente, pedido: PedidoDeAgendar, aceptaSinCancelacion = false) {
  const resultado = await agendarMonitoria(cliente, pedido, aceptaSinCancelacion);
  if (resultado.resultado === "agendada" && resultado.idMonitoria) fx.registrarMonitoria(resultado.idMonitoria);
  return resultado;
}

/** Las monitorías de una franja (con la llave secreta), anotadas para la limpieza aunque una regresión las cree de más. */
async function monitoriasDe(idFranja: string) {
  const filas = exito(
    await fx.admin.from("monitoria").select("id, id_lead, fecha, estado, valor_total, id_diagnostico").eq("id_franja", idFranja).order("fecha_creacion"),
    "leer las monitorías de la franja",
  );
  for (const fila of filas) fx.registrarMonitoria(fila.id);
  return filas;
}

const filaDe = async (idMonitoria: string) => exito(await fx.admin.from("monitoria").select("*").eq("id", idMonitoria).single(), "leer la monitoría");

/** Lo que hace HU-027 cuando vence la reserva: queda cancelada y la fecha, libre. */
async function expirarReserva(idMonitoria: string) {
  exito(
    await fx.admin.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: "reserva_expirada" }).eq("id", idMonitoria).select().single(),
    "cancelar la reserva",
  );
}

const hace = (milisegundos: number) => new Date(Date.now() - milisegundos).toISOString();

// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1 y RN-32: agendar una fecha libre de una materia certificada", () => {
  it("la monitoría nace en pendiente_pago con el valor de la franja, y cargarReserva la devuelve completa con el vencimiento a 10 minutos", async () => {
    const e = await escenario();
    const sesion = await sesionLead();

    const resultado = await agendar(sesion.cliente, e.pedido(e.primera));

    expect(resultado).toEqual({ resultado: "agendada", idMonitoria: expect.any(String) });
    const id = resultado.idMonitoria!;
    expect(await filaDe(id)).toMatchObject({
      id_franja: e.franja.id,
      id_monitor: e.monitor.id,
      id_materia: e.materia.id,
      id_lead: sesion.lead.id,
      fecha: e.primera,
      estado: "pendiente_pago",
      valor_total: 32_000,
      motivo_cancelacion: null,
      fecha_finalizacion: null,
      id_diagnostico: null,
    });
    expect(await monitoriasDe(e.franja.id)).toHaveLength(1);

    const parametros = await cargarParametros(sesion.cliente);
    const fechaCreacion = new Date((await filaDe(id)).fecha_creacion);
    const inicio = inicioDeSesion(e.primera, "10:00:00");
    const reserva = await cargarReserva(sesion.cliente, id);
    expect(reserva).toEqual({
      id,
      estado: "pendiente_pago",
      motivoCancelacion: null,
      fecha: e.primera,
      hora: "10:00:00",
      duracionMin: 90,
      presencial: true,
      valorTotal: 32_000,
      nombreMonitor: "Monitor de prueba",
      nombreMateria: "Materia de prueba",
      codigoMateria: e.materia.codigo,
      inicio,
      reservaHasta: reservaHasta(fechaCreacion, parametros),
      cancelableHasta: cancelableHasta(inicio, false, parametros),
    });
    // RN-34: la fecha se aparta 10 minutos desde que se crea la reserva.
    expect(parametros.reservaMin).toBe(10);
    expect(reserva!.reservaHasta.getTime() - fechaCreacion.getTime()).toBe(10 * MINUTO);
  });

  it("RN-32: si el monitor cambia el precio de la franja después, la monitoría conserva el valor con que se agendó", async () => {
    const e = await escenario();
    const sesion = await sesionLead();
    const { idMonitoria } = await agendar(sesion.cliente, e.pedido(e.primera));
    expect(idMonitoria).not.toBeNull();

    // El monitor cambia el precio de su franja con su propia sesión (HU-015: el precio sí se cambia).
    const delMonitor = await fx.iniciarSesion(e.monitor);
    // (el monitor no lee lugar ni enlace por la tabla: el .select() pide solo las columnas que ve)
    exito(await delMonitor.from("franja").update({ precio: 50_000 }).eq("id", e.franja.id).select("id, precio").single(), "cambiar el precio de la franja");

    expect((await filaDe(idMonitoria!)).valor_total).toBe(32_000);
    expect((await cargarReserva(sesion.cliente, idMonitoria!))?.valorTotal).toBe(32_000);
    // Lo que se muestra de las otras fechas ya trae el precio nuevo, y una reserva nueva lo copia.
    const libres = await cargarFechasLibres(crearCliente(), e.materia.codigo, SEMANAS_DEL_HORIZONTE);
    expect(libres.filter((f) => f.idFranja === e.franja.id).map((f) => f.precio)).toEqual([50_000, 50_000, 50_000]);
    await expirarReserva(idMonitoria!);
    const otra = await agendar(sesion.cliente, e.pedido(sumarDias(e.primera, 7)));
    expect((await filaDe(otra.idMonitoria!)).valor_total).toBe(50_000);
  });

  it("el código de la materia no distingue mayúsculas ni espacios, como la lista de fechas libres", async () => {
    const e = await escenario();
    const sesion = await sesionLead();

    const resultado = await agendar(sesion.cliente, { ...e.pedido(e.primera), codigoMateria: ` ${e.materia.codigo.toLowerCase()} ` });

    expect(resultado.resultado).toBe("agendada");
    expect((await filaDe(resultado.idMonitoria!)).id_materia).toBe(e.materia.id);
  });

  it("quien la agenda y el monitor de la franja la ven; otro Lead, otro monitor y un visitante sin sesión no", async () => {
    const e = await escenario();
    const duena = await sesionLead(0);
    const otra = await sesionLead(1);
    const otroMonitor = await fx.crearMonitor();
    const { idMonitoria } = await agendar(duena.cliente, e.pedido(e.primera));
    const id = idMonitoria!;

    const deLaDuena = await cargarReserva(duena.cliente, id);
    expect(deLaDuena).toMatchObject({ id, nombreMonitor: "Monitor de prueba", valorTotal: 32_000 });
    expect(await cargarReserva(await fx.iniciarSesion(e.monitor), id)).toEqual(deLaDuena);

    expect(await cargarReserva(otra.cliente, id)).toBeNull();
    expect(await cargarReserva(await fx.iniciarSesion(otroMonitor), id)).toBeNull();
    // Una reserva que no existe tampoco la ve nadie.
    expect(await cargarReserva(duena.cliente, randomUUID())).toBeNull();
    // Sin sesión (rol anon) ni siquiera se puede leer la tabla.
    await expect(cargarReserva(crearCliente(), id)).rejects.toThrow(/No se pudo leer la reserva/);
  });

  it("HU-068: también agendan, como el mismo Lead, la sesión que confirmó su correo (lead_sesion) y la cuenta de Estudiante", async () => {
    const e = await escenario();
    const duena = await sesionLead(0);
    const confirmada = pool[1];
    exito(await fx.admin.from("lead_sesion").insert({ id_sesion: confirmada.id, id_lead: duena.lead.id }).select().single(), "ligar la sesión al Lead");

    // La sesión ligada agenda a nombre del Lead; la dueña la ve, y el Lead ya tiene una reserva por pagar.
    const deLaLigada = await agendar(confirmada.cliente, e.pedido(e.primera));
    expect(deLaLigada.resultado).toBe("agendada");
    expect((await filaDe(deLaLigada.idMonitoria!)).id_lead).toBe(duena.lead.id);
    expect(await cargarReserva(duena.cliente, deLaLigada.idMonitoria!)).toMatchObject({ id: deLaLigada.idMonitoria });
    expect(await agendar(duena.cliente, e.pedido(sumarDias(e.primera, 7)))).toEqual({ resultado: "reserva_pendiente", idMonitoria: deLaLigada.idMonitoria });

    // Una cuenta de Estudiante agenda con el Lead del que salió.
    const estudiante = await fx.crearEstudiante();
    const { id_lead: idLeadDelEstudiante } = exito(await fx.admin.from("estudiante").select("id_lead").eq("id", estudiante.id).single(), "leer el estudiante");
    const deElla = await agendar(await fx.iniciarSesion(estudiante), e.pedido(sumarDias(e.primera, 7)));
    expect(deElla.resultado).toBe("agendada");
    expect((await filaDe(deElla.idMonitoria!)).id_lead).toBe(idLeadDelEstudiante);
  });
});

describe("criterio 2 (RN-35): menos de 3 h de antelación no se agenda", () => {
  it("a 1 h del inicio da sin_antelacion (aun con la casilla marcada) y no crea nada", async () => {
    const { materia, monitor } = await escenario();
    const sesion = await sesionLead();
    const cerca = await franjaQueEmpezaEn(monitor.id, materia.codigo, HORA);

    expect(await agendar(sesion.cliente, cerca.pedido)).toEqual({ resultado: "sin_antelacion", idMonitoria: null });
    expect(await agendar(sesion.cliente, cerca.pedido, true)).toEqual({ resultado: "sin_antelacion", idMonitoria: null });

    expect(await monitoriasDe(cerca.franja.id)).toEqual([]);
  });

  it("el borde de las 3 h coincide con el motor de plazos: con 3 h o más se agenda y con menos no", async () => {
    const { materia, monitor } = await escenario();
    const sesion = await sesionLead();
    const parametros = await cargarParametros(sesion.cliente);
    const antelacion = parametros.antelacionIndividualMin * MINUTO;

    // Un margen de segundos a cada lado del borde, y otros más amplios: la base usa su propio now().
    for (const desfase of [-HORA, -MINUTO, -20_000, 20_000, MINUTO, HORA]) {
      const { franja, inicio, pedido } = await franjaQueEmpezaEn(monitor.id, materia.codigo, antelacion + desfase);
      const ahora = new Date();
      const esperado = cumpleAntelacion(inicio, ahora, false, parametros);
      expect(esperado, `el motor, con un desfase de ${desfase} ms`).toBe(desfase > 0);

      // Con la casilla marcada: aquí solo se prueba la antelación, no el aviso de las 12 h.
      const resultado = await agendar(sesion.cliente, pedido, true);

      expect(resultado.resultado, `la base, con un desfase de ${desfase} ms`).toBe(esperado ? "agendada" : "sin_antelacion");
      expect(await monitoriasDe(franja.id)).toHaveLength(esperado ? 1 : 0);
      // Una reserva por pagar impide la siguiente (D-8): se cancela para seguir con el mismo Lead.
      if (resultado.idMonitoria) await expirarReserva(resultado.idMonitoria);
    }
  });
});

describe("criterio 3 (RN-37, D-10): con menos de 12 h hay que marcar que no podrá cancelarla", () => {
  it("entre 3 h y 12 h sin la casilla no se reserva nada; con ella se agenda; a 2 días no hace falta", async () => {
    const e = await escenario();
    const sesion = await sesionLead();
    const parametros = await cargarParametros(sesion.cliente);
    const cerca = await franjaQueEmpezaEn(e.monitor.id, e.materia.codigo, 6 * HORA);

    expect(requiereAvisoSinCancelacion(cerca.inicio, new Date(), parametros)).toBe(true);
    expect(requiereAvisoSinCancelacion(inicioDeSesion(e.primera, "10:00:00"), new Date(), parametros)).toBe(false);

    expect(await agendar(sesion.cliente, cerca.pedido, false)).toEqual({ resultado: "confirmar_sin_cancelacion", idMonitoria: null });
    expect(await monitoriasDe(cerca.franja.id)).toEqual([]);

    const confirmada = await agendar(sesion.cliente, cerca.pedido, true);
    expect(confirmada).toEqual({ resultado: "agendada", idMonitoria: expect.any(String) });
    expect(await filaDe(confirmada.idMonitoria!)).toMatchObject({ estado: "pendiente_pago", valor_total: 25_000 });
    // La reserva dice hasta cuándo se habría podido cancelar: 12 h antes del inicio, que ya pasó.
    const reserva = await cargarReserva(sesion.cliente, confirmada.idMonitoria!);
    expect(reserva!.cancelableHasta).toEqual(cancelableHasta(cerca.inicio, false, parametros));
    expect(reserva!.cancelableHasta.getTime()).toBeLessThan(Date.now());

    // A 2 días, sin la casilla, se agenda.
    await expirarReserva(confirmada.idMonitoria!);
    expect(await agendar(sesion.cliente, e.pedido(e.primera), false)).toEqual({ resultado: "agendada", idMonitoria: expect.any(String) });
  });

  it("el borde de las 12 h coincide con el motor: con 12 h o más no hace falta la casilla y con menos sí", async () => {
    const { materia, monitor } = await escenario();
    const sesion = await sesionLead();
    const parametros = await cargarParametros(sesion.cliente);
    const limite = parametros.cancelacionIndividualMin * MINUTO;

    for (const desfase of [-HORA, -20_000, 20_000, HORA]) {
      const { franja, inicio, pedido } = await franjaQueEmpezaEn(monitor.id, materia.codigo, limite + desfase);
      const avisa = requiereAvisoSinCancelacion(inicio, new Date(), parametros);
      expect(avisa, `el motor, con un desfase de ${desfase} ms`).toBe(desfase < 0);

      const resultado = await agendar(sesion.cliente, pedido, false);

      expect(resultado.resultado, `la base, con un desfase de ${desfase} ms`).toBe(avisa ? "confirmar_sin_cancelacion" : "agendada");
      expect(await monitoriasDe(franja.id)).toHaveLength(avisa ? 0 : 1);
      if (resultado.idMonitoria) await expirarReserva(resultado.idMonitoria);
    }
  });
});

describe("criterio 4 (RN-33): dos personas piden la misma fecha a la vez", () => {
  it("solo una lo logra y la otra recibe ocupada: queda una sola monitoría activa, en tres rondas con fechas distintas", async () => {
    const e = await escenario();
    const [a, b] = [await sesionLead(0), await sesionLead(1)];

    for (const [ronda, semanas] of [0, 1, 2].entries()) {
      const fecha = sumarDias(e.primera, 7 * semanas);
      // Se alterna quién sale primero en la llamada.
      const [primera, segunda] = ronda % 2 === 0 ? [a, b] : [b, a];

      const resultados = await Promise.all([agendar(primera.cliente, e.pedido(fecha)), agendar(segunda.cliente, e.pedido(fecha))]);

      expect(resultados.map((r) => r.resultado).sort(), `ronda ${ronda + 1}`).toEqual(["agendada", "ocupada"]);
      const ganadora = resultados.find((r) => r.resultado === "agendada")!;
      const perdedora = resultados.find((r) => r.resultado === "ocupada")!;
      expect(perdedora.idMonitoria).toBeNull();
      const deLaFecha = (await monitoriasDe(e.franja.id)).filter((m) => m.fecha === fecha);
      expect(deLaFecha, `ronda ${ronda + 1}`).toHaveLength(1);
      expect(deLaFecha[0]).toMatchObject({ id: ganadora.idMonitoria, estado: "pendiente_pago" });
      // La que ganó no puede apartar otra fecha mientras la tenga por pagar (D-8): se cancela para la ronda siguiente.
      await expirarReserva(ganadora.idMonitoria!);
    }
  });

  it("la que pierde ve que la fecha ya no está disponible: ocupada, sin crear nada para ella", async () => {
    const e = await escenario();
    const [primera, segunda] = [await sesionLead(0), await sesionLead(1)];
    const ganadora = await agendar(primera.cliente, e.pedido(e.primera));
    expect(ganadora.resultado).toBe("agendada");

    expect(await agendar(segunda.cliente, e.pedido(e.primera))).toEqual({ resultado: "ocupada", idMonitoria: null });

    expect(await monitoriasDe(e.franja.id)).toHaveLength(1);
  });
});

describe("criterio 5 (RN-34): una reserva por pagar deja la fecha ocupada para los demás", () => {
  it("la lista de fechas libres ya no la muestra a otra sesión ni a un visitante sin sesión, y vuelve cuando la reserva se cancela", async () => {
    const e = await escenario();
    const compradora = await sesionLead(0);
    const otra = await sesionLead(1);
    const visitante = crearCliente();
    const todas = [e.primera, sumarDias(e.primera, 7), sumarDias(e.primera, 14), sumarDias(e.primera, 21)];
    expect(fechasDe(await cargarFechasLibres(otra.cliente, e.materia.codigo, SEMANAS_DEL_HORIZONTE), e.franja.id)).toEqual(todas);

    const { idMonitoria } = await agendar(compradora.cliente, e.pedido(e.primera));

    const clientes: [string, Cliente][] = [
      ["otra sesión", otra.cliente],
      ["visitante sin sesión", visitante],
      ["la misma sesión", compradora.cliente],
    ];
    for (const [quien, cliente] of clientes) {
      const libres = await cargarFechasLibres(cliente, e.materia.codigo, SEMANAS_DEL_HORIZONTE);
      expect(fechasDe(libres, e.franja.id), quien).toEqual(todas.slice(1));
    }
    // Y quien la pide después no la consigue.
    expect(await agendar(otra.cliente, e.pedido(e.primera))).toEqual({ resultado: "ocupada", idMonitoria: null });

    // Cuando la reserva se cancela (vence, HU-027), la fecha vuelve a estar libre y otra persona puede tomarla.
    await expirarReserva(idMonitoria!);
    expect(fechasDe(await cargarFechasLibres(visitante, e.materia.codigo, SEMANAS_DEL_HORIZONTE), e.franja.id)).toEqual(todas);
    expect((await agendar(otra.cliente, e.pedido(e.primera))).resultado).toBe("agendada");
  });
});

describe("criterio 6 (D-3): quien todavía no es Lead no agenda", () => {
  it("una sesión anónima sin contacto recibe no_es_lead y no se crea nada; al dejar su contacto ya puede", async () => {
    const e = await escenario();
    const sesion = pool[0];

    expect(await agendar(sesion.cliente, e.pedido(e.primera))).toEqual({ resultado: "no_es_lead", idMonitoria: null });
    expect(await monitoriasDe(e.franja.id)).toEqual([]);

    await fx.crearLeadDeSesion(sesion.id);

    expect((await agendar(sesion.cliente, e.pedido(e.primera))).resultado).toBe("agendada");
  });

  it("las cuentas del equipo (monitor y admin) tampoco son Lead: no_es_lead", async () => {
    const e = await escenario();

    for (const [rol, usuario] of [["monitor", e.monitor], ["admin", e.admin]] as const) {
      expect(await agendar(await fx.iniciarSesion(usuario), e.pedido(e.primera)), rol).toEqual({ resultado: "no_es_lead", idMonitoria: null });
    }

    expect(await monitoriasDe(e.franja.id)).toEqual([]);
  });

  it("un cliente sin sesión (rol anon) no puede ejecutar la función: error de permisos", async () => {
    const e = await escenario();
    const pedido = e.pedido(e.primera);

    const crudo = await crearCliente().rpc("agendar_monitoria", {
      p_id_franja: pedido.idFranja,
      p_fecha: pedido.fecha,
      p_codigo_materia: pedido.codigoMateria,
      p_acepta_sin_cancelacion: false,
    });
    expect(crudo.error?.code).toBe("42501");
    await expect(agendarMonitoria(crearCliente(), pedido, false)).rejects.toThrow(/No se pudo agendar: 42501/);

    expect(await monitoriasDe(e.franja.id)).toEqual([]);
  });

  it("nadie agenda a nombre de otro ni inserta en monitoria: la función no recibe la sesión ni la hora, y la tabla no se escribe", async () => {
    const e = await escenario();
    const sesion = await sesionLead();
    const pedido = e.pedido(e.primera);
    const base = { p_id_franja: pedido.idFranja, p_fecha: pedido.fecha, p_codigo_materia: pedido.codigoMateria, p_acepta_sin_cancelacion: false };

    for (const extra of [{ p_id_sesion: randomUUID() }, { p_ahora: "2020-01-01T00:00:00Z" }, { p_id_lead: sesion.lead.id }]) {
      const { error } = await sesion.cliente.rpc("agendar_monitoria", { ...base, ...extra } as never);
      expect(error, JSON.stringify(extra)).not.toBeNull();
    }
    const privado = await sesion.cliente.schema("privado" as never).rpc("agendar_monitoria" as never, base as never);
    expect(privado.error?.code).toBe("PGRST106");
    const insercion = await sesion.cliente
      .from("monitoria")
      .insert({ id_franja: e.franja.id, id_monitor: e.monitor.id, id_materia: e.materia.id, id_lead: sesion.lead.id, fecha: e.primera, valor_total: 1 });
    expect(insercion.error?.code).toBe("42501");

    expect(await monitoriasDe(e.franja.id)).toEqual([]);
  });
});

describe("criterio 7 (RN-15, P-35, D-7): el diagnóstico más reciente de la materia queda ligado a la cita", () => {
  it("liga el más reciente de la materia del Lead (no el de otra materia ni el de otra sesión), lo comparten sus citas y lo ve el monitor de cada una", async () => {
    const e = await escenario();
    const otraMateria = await fx.crearEvaluacion();
    const duena = await sesionLead(0);
    const ajena = pool[1];
    const deLaMateria = { idEvaluacion: e.evaluacion.id, idMateria: e.materia.id };
    const viejo = await fx.crearDiagnostico({ idSesionAnonima: duena.id, ...deLaMateria });
    const reciente = await fx.crearDiagnostico({ idSesionAnonima: duena.id, ...deLaMateria });
    const deOtraMateria = await fx.crearDiagnostico({ idSesionAnonima: duena.id, idEvaluacion: otraMateria.evaluacion.id, idMateria: otraMateria.materia.id });
    const deOtraSesion = await fx.crearDiagnostico({ idSesionAnonima: ajena.id, ...deLaMateria });
    // El orden lo da la fecha de realización: el de otra materia y el de otra sesión son todavía más recientes.
    for (const [id, antes] of [[viejo.id, 3 * 24 * HORA], [reciente.id, 2 * 24 * HORA], [deOtraMateria.id, HORA], [deOtraSesion.id, MINUTO]] as const) {
      exito(await fx.admin.from("diagnostico").update({ fecha_realizacion: hace(antes) }).eq("id", id).select().single(), "fechar el diagnóstico");
    }
    // Como lo deja registrar_lead al crear el Lead (P-33): los diagnósticos de la sesión pasan a ser del Lead.
    exito(await fx.admin.from("diagnostico").update({ id_lead: duena.lead.id }).in("id", [viejo.id, reciente.id, deOtraMateria.id]).select(), "ligar al Lead");
    const delMonitor = await fx.iniciarSesion(e.monitor);
    const deOtroMonitor = await fx.iniciarSesion(await fx.crearMonitor());
    // Antes de agendar, el monitor no ve ningún diagnóstico de esta persona.
    expect(await idsVisibles(delMonitor, "diagnostico", "id", reciente.id)).toEqual([]);

    const primera = await agendar(duena.cliente, e.pedido(e.primera));

    expect(primera.resultado).toBe("agendada");
    expect((await filaDe(primera.idMonitoria!)).id_diagnostico).toBe(reciente.id);
    // El monitor de la cita ve el diagnóstico al que apunta (RN-13), pero no los demás de la persona; otro monitor, ninguno.
    expect(await idsVisibles(delMonitor, "diagnostico", "id", reciente.id)).toEqual([reciente.id]);
    expect(await idsVisibles(delMonitor, "diagnostico", "id", viejo.id)).toEqual([]);
    expect(await idsVisibles(delMonitor, "diagnostico", "id", deOtraSesion.id)).toEqual([]);
    expect(await idsVisibles(deOtroMonitor, "diagnostico", "id", reciente.id)).toEqual([]);
    expect(await idsVisibles(duena.cliente, "diagnostico", "id", reciente.id)).toEqual([reciente.id]);

    // Cancelada la primera reserva, otra fecha comparte el mismo diagnóstico aunque ya esté ligado a otra cita (D-7).
    await expirarReserva(primera.idMonitoria!);
    const segunda = await agendar(duena.cliente, e.pedido(sumarDias(e.primera, 7)));
    expect(segunda.resultado).toBe("agendada");
    expect((await filaDe(segunda.idMonitoria!)).id_diagnostico).toBe(reciente.id);
    expect((await filaDe(primera.idMonitoria!)).id_diagnostico).toBe(reciente.id);
    expect(await idsVisibles(delMonitor, "diagnostico", "id", reciente.id)).toEqual([reciente.id]);

    // Si el diagnóstico se borra (supresión de datos), la cita sigue y queda sin él.
    exito(await fx.admin.from("diagnostico").delete().eq("id", reciente.id).select(), "borrar el diagnóstico");
    expect(await filaDe(segunda.idMonitoria!)).toMatchObject({ id_diagnostico: null, id_materia: e.materia.id, estado: "pendiente_pago" });
  });

  it("un diagnóstico del Lead de otra materia no se liga, y sin diagnóstico la cita queda sin él (D-3)", async () => {
    const e = await escenario();
    const otraMateria = await fx.crearEvaluacion();
    const sesion = await sesionLead();
    await fx.crearDiagnostico({ idSesionAnonima: sesion.id, idEvaluacion: otraMateria.evaluacion.id, idMateria: otraMateria.materia.id });

    const resultado = await agendar(sesion.cliente, e.pedido(e.primera));

    expect(resultado.resultado).toBe("agendada");
    expect((await filaDe(resultado.idMonitoria!)).id_diagnostico).toBeNull();
  });
});

describe("D-8: un Lead tiene como máximo una reserva por pagar vigente a la vez", () => {
  it("con una reserva vigente, otra fecha (de la misma franja o de otra) da reserva_pendiente con el id de la que tiene; la misma fecha, ya_agendada", async () => {
    const e = await escenario();
    const sesion = await sesionLead();
    const otraFranja = await fx.crearFranja({ idMonitor: e.monitor.id, dia: diaIsoDeFecha(sumarDias(e.primera, 1)), hora: "15:00", abiertaDesde: hoy() });
    const primera = await agendar(sesion.cliente, e.pedido(e.primera));
    expect(primera.resultado).toBe("agendada");

    expect(await agendar(sesion.cliente, e.pedido(sumarDias(e.primera, 7)))).toEqual({ resultado: "reserva_pendiente", idMonitoria: primera.idMonitoria });
    expect(await agendar(sesion.cliente, e.pedido(sumarDias(e.primera, 1), otraFranja.id))).toEqual({
      resultado: "reserva_pendiente",
      idMonitoria: primera.idMonitoria,
    });
    expect(await agendar(sesion.cliente, e.pedido(e.primera))).toEqual({ resultado: "ya_agendada", idMonitoria: primera.idMonitoria });

    expect(await monitoriasDe(e.franja.id)).toHaveLength(1);
    expect(await monitoriasDe(otraFranja.id)).toEqual([]);
  });

  it("deja de impedir cuando la reserva ya no está vigente: pasados los 10 minutos, cancelada o ya pagada", async () => {
    const e = await escenario();
    const sesion = await sesionLead();
    const primera = await agendar(sesion.cliente, e.pedido(e.primera));
    const segunda = e.pedido(sumarDias(e.primera, 7));
    const envejecer = async (minutos: number) =>
      exito(await fx.admin.from("monitoria").update({ fecha_creacion: hace(minutos * MINUTO) }).eq("id", primera.idMonitoria!).select().single(), "envejecer la reserva");

    // A 9 minutos todavía está vigente.
    await envejecer(9);
    expect(await agendar(sesion.cliente, segunda)).toEqual({ resultado: "reserva_pendiente", idMonitoria: primera.idMonitoria });

    // A 11 minutos ya venció (aunque HU-027 todavía no la haya cancelado): se puede apartar otra fecha.
    await envejecer(11);
    const conVencida = await agendar(sesion.cliente, segunda);
    expect(conVencida.resultado).toBe("agendada");

    // Cancelada o confirmada (pagada) tampoco impide: solo cuenta la que sigue por pagar.
    await expirarReserva(conVencida.idMonitoria!);
    exito(await fx.admin.from("monitoria").update({ estado: "confirmada" }).eq("id", primera.idMonitoria!).select().single(), "confirmar la primera");
    const tercera = await agendar(sesion.cliente, e.pedido(sumarDias(e.primera, 14)));
    expect(tercera.resultado).toBe("agendada");
  });

  it("dos clics a la vez del mismo Lead sobre la misma fecha: una agendada y la otra ya_agendada con el mismo id", async () => {
    const e = await escenario();
    const sesion = await sesionLead();

    const resultados = await Promise.all([agendar(sesion.cliente, e.pedido(e.primera)), agendar(sesion.cliente, e.pedido(e.primera))]);

    expect(resultados.map((r) => r.resultado).sort()).toEqual(["agendada", "ya_agendada"]);
    expect(resultados[0].idMonitoria).toBe(resultados[1].idMonitoria);
    expect(await monitoriasDe(e.franja.id)).toHaveLength(1);
  });

  it("dos pestañas del mismo Lead piden fechas distintas a la vez: solo una se aparta y la otra recibe reserva_pendiente", async () => {
    const e = await escenario();
    const sesion = await sesionLead();

    const resultados = await Promise.all([
      agendar(sesion.cliente, e.pedido(e.primera)),
      agendar(sesion.cliente, e.pedido(sumarDias(e.primera, 7))),
    ]);

    expect(resultados.map((r) => r.resultado).sort()).toEqual(["agendada", "reserva_pendiente"]);
    expect(resultados[0].idMonitoria).toBe(resultados[1].idMonitoria);
    const activas = (await monitoriasDe(e.franja.id)).filter((m) => m.estado !== "cancelada");
    expect(activas).toHaveLength(1);
    expect(activas[0].id).toBe(resultados[0].idMonitoria);
  });
});

describe("D-9: solo se agenda dentro de las semanas que muestra la lista", () => {
  it("el horizonte de la lista es el de la base, y una fecha a 7 × semanas días o más da no_disponible", async () => {
    const e = await escenario();
    const sesion = await sesionLead();
    const { rows } = await bd.query<{ semanas: number }>("select privado.semanas_para_agendar() as semanas");
    expect(rows[0].semanas).toBe(SEMANAS_DEL_HORIZONTE);

    const limite = sumarDias(hoy(), 7 * SEMANAS_DEL_HORIZONTE);
    const ultima = sumarDias(limite, -1);
    const franjaDelLimite = await fx.crearFranja({ idMonitor: e.monitor.id, dia: diaIsoDeFecha(limite), hora: "10:00", abiertaDesde: hoy() });
    const franjaDeLaUltima = await fx.crearFranja({ idMonitor: e.monitor.id, dia: diaIsoDeFecha(ultima), hora: "10:00", abiertaDesde: hoy() });
    // La lista muestra la última fecha del horizonte y no la del límite: la reserva acepta exactamente lo mismo.
    const libres = await cargarFechasLibres(sesion.cliente, e.materia.codigo, SEMANAS_DEL_HORIZONTE);
    expect(fechasDe(libres, franjaDeLaUltima.id)).toContain(ultima);
    expect(fechasDe(libres, franjaDelLimite.id)).not.toContain(limite);

    // Día de la franja, libre y con antelación, pero fuera de las semanas que se muestran.
    expect(await agendar(sesion.cliente, e.pedido(limite, franjaDelLimite.id))).toEqual({ resultado: "no_disponible", idMonitoria: null });
    expect(await agendar(sesion.cliente, e.pedido(sumarDias(e.primera, 28)))).toEqual({ resultado: "no_disponible", idMonitoria: null });
    expect(await agendar(sesion.cliente, e.pedido(sumarDias(limite, 7 * 10), franjaDelLimite.id))).toEqual({ resultado: "no_disponible", idMonitoria: null });
    expect(await monitoriasDe(franjaDelLimite.id)).toEqual([]);

    // La última fecha que muestra la lista sí se agenda.
    const resultado = await agendar(sesion.cliente, e.pedido(ultima, franjaDeLaUltima.id));
    expect(resultado.resultado).toBe("agendada");
  });
});

describe("no_disponible: lo que la base no ofrece no se agenda", () => {
  it("una franja que no existe, otra materia, un código desconocido, un día que no es el de la franja y una fecha pasada", async () => {
    const e = await escenario();
    const sesion = await sesionLead();
    const sinCertificar = await fx.crearMateria();
    const ayer = sumarDias(hoy(), -1);
    const deAyer = await fx.crearFranja({ idMonitor: e.monitor.id, dia: diaIsoDeFecha(ayer), hora: "10:00", abiertaDesde: hoy() });
    const noDisponible = { resultado: "no_disponible", idMonitoria: null };

    expect(await agendar(sesion.cliente, e.pedido(e.primera, randomUUID()))).toEqual(noDisponible);
    expect(await agendar(sesion.cliente, { ...e.pedido(e.primera), codigoMateria: sinCertificar.codigo })).toEqual(noDisponible);
    expect(await agendar(sesion.cliente, { ...e.pedido(e.primera), codigoMateria: "NO-EXISTE-17" })).toEqual(noDisponible);
    expect(await agendar(sesion.cliente, { ...e.pedido(e.primera), codigoMateria: "INT-%" })).toEqual(noDisponible);
    expect(await agendar(sesion.cliente, e.pedido(sumarDias(e.primera, 1)))).toEqual(noDisponible);
    expect(await agendar(sesion.cliente, e.pedido(ayer, deAyer.id))).toEqual(noDisponible);

    for (const franja of [e.franja, deAyer]) expect(await monitoriasDe(franja.id)).toEqual([]);
  });

  it("una franja cerrada desde esa fecha y un monitor desactivado (que vuelve al reactivarlo)", async () => {
    const e = await escenario();
    const sesion = await sesionLead();
    const cerrada = await fx.crearFranja({
      idMonitor: e.monitor.id,
      dia: diaIsoDeFecha(e.primera),
      hora: "15:00",
      abiertaDesde: hoy(),
      cerradaDesde: sumarDias(e.primera, 7),
    });
    const noDisponible = { resultado: "no_disponible", idMonitoria: null };

    // Cerrada desde la segunda semana: la primera fecha sigue libre y las siguientes no.
    expect(await agendar(sesion.cliente, e.pedido(sumarDias(e.primera, 7), cerrada.id))).toEqual(noDisponible);
    expect(await agendar(sesion.cliente, e.pedido(sumarDias(e.primera, 14), cerrada.id))).toEqual(noDisponible);

    await desactivarCuenta(e.monitor.id);
    try {
      expect(await agendar(sesion.cliente, e.pedido(e.primera))).toEqual(noDisponible);
    } finally {
      await reactivarCuenta(e.monitor.id);
    }
    expect((await agendar(sesion.cliente, e.pedido(e.primera))).resultado).toBe("agendada");
  });
});
