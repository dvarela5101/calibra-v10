import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { separarAgenda, textoDeEstado, textoDePago, type EstadoPago, type MonitoriaDeAgenda } from "@/lib/agenda/reglas";
import { cargarAgenda } from "@/lib/agenda/servidor";
import { agendarMonitoria } from "@/lib/agendar/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { diaIsoDeFecha, inicioDeSesion } from "@/lib/plazos/motor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures } from "./utilidades";

/**
 * HU-021 contra el Supabase local: `cargarAgenda` (el mismo código de la página del monitor) con la sesión de
 * verdad de cada persona, así que también se prueban `public.mi_agenda`, las políticas y los permisos. La
 * página usa `exigirRol("monitor")`: eso es de la prueba e2e, no de este archivo. Las fechas se calculan desde
 * hoy en Bogotá, nunca con la zona del proceso.
 *
 * El escenario se arma una sola vez (las pruebas solo leen) para gastar pocas entradas con contraseña y altas
 * anónimas del Auth local: tres inicios de sesión (dos monitores y un admin) y dos sesiones anónimas.
 *
 *  - Monitor 1: cinco monitorías en cada estado de la agenda, en dos franjas (una presencial y una virtual) y
 *    dos materias, cada una de un Lead con nombre y contacto reconocibles.
 *  - Monitor 2: ocho monitorías con las combinaciones de comprobantes de D-11. Hace de "otro monitor".
 *  - Sesión Lead: dueña de la confirmada del monitor 1 y la que agenda "de verdad" con `agendarMonitoria`.
 *  - Sesión anónima: sin contacto, no es Lead.
 */

const MINUTO = 60_000;

/** Los valores en dinero que una agenda nunca debe devolver: el del comprobante, el de la monitoría y el de la franja. */
const MONTO_DEL_PAGO = 31_337;
const VALOR_DE_LA_MONITORIA = 25_000; // el que pone `Fixtures.crearMonitoria`
const PRECIO_DE_LA_FRANJA_VIRTUAL = 47_500;

const LUNES = 1;
const MIERCOLES = 3;

let fx: Fixtures;
let e: Awaited<ReturnType<typeof construirEscenario>>;

beforeAll(async () => {
  await exigirSupabaseLocal();
  fx = new Fixtures();
  try {
    e = await construirEscenario();
  } catch (error) {
    await fx.limpiar();
    throw error;
  }
}, 90_000);

afterAll(async () => {
  await fx?.limpiar();
});

// ---------------------------------------------------------------------------------------------------------------

/** `AAAA-MM-DD` más `dias` días (aritmética de calendario, sin zona). */
function sumarDias(fecha: string, dias: number): string {
  const instante = new Date(`${fecha}T12:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

/** El primer día de la semana `dia` (1 = lunes, 7 = domingo) que cae en `desde` o después. */
function primerDia(dia: number, desde: string): string {
  let fecha = desde;
  while (diaIsoDeFecha(fecha) !== dia) fecha = sumarDias(fecha, 1);
  return fecha;
}

const hoy = () => diaDelNegocio(new Date());
const hace = (milisegundos: number) => new Date(Date.now() - milisegundos).toISOString();
const ids = (agenda: MonitoriaDeAgenda[]) => agenda.map((m) => m.idMonitoria);

function porId(agenda: MonitoriaDeAgenda[], id: string): MonitoriaDeAgenda {
  const fila = agenda.find((m) => m.idMonitoria === id);
  if (!fila) throw new Error(`La monitoría ${id} no está en la agenda (hay ${agenda.length}).`);
  return fila;
}

/** Sin filas: la tabla se lee con RLS (vacío) o el permiso se niega (error); en ningún caso llegan datos. */
function sinFilas(resultado: { data: unknown[] | null; error: { message: string } | null }) {
  expect(resultado.error ? [] : resultado.data).toEqual([]);
}

/** Le pone al Lead un nombre y un teléfono reconocibles: la agenda debe mostrar el nombre y nunca el contacto. */
async function conContacto(lead: { id: string }, nombre: string) {
  const telefono = `3${randomInt(100_000_000, 999_999_999)}`;
  return exito(
    await fx.admin.from("lead").update({ nombre, numero_telefono: telefono }).eq("id", lead.id).select().single(),
    "darle nombre y teléfono al Lead",
  );
}

/** D-11: los comprobantes de una monitoría y el estado del pago que la agenda debe mostrar. */
const COMBINACIONES: { caso: string; pagos: ("en_revision" | "aprobado" | "rechazado")[]; esperado: EstadoPago }[] = [
  { caso: "ningún comprobante", pagos: [], esperado: "sin_pagar" },
  { caso: "un comprobante en revisión", pagos: ["en_revision"], esperado: "en_revision" },
  { caso: "un comprobante aprobado", pagos: ["aprobado"], esperado: "aprobado" },
  { caso: "un comprobante rechazado", pagos: ["rechazado"], esperado: "rechazado" },
  { caso: "aprobado y en revisión", pagos: ["aprobado", "en_revision"], esperado: "en_revision" },
  { caso: "aprobado y rechazado", pagos: ["aprobado", "rechazado"], esperado: "rechazado" },
  { caso: "en revisión y rechazado", pagos: ["en_revision", "rechazado"], esperado: "rechazado" },
  { caso: "rechazado, en revisión y aprobado", pagos: ["rechazado", "en_revision", "aprobado"], esperado: "rechazado" },
];

async function construirEscenario() {
  const admin = await fx.crearAdmin();
  const sesionAdmin = await fx.iniciarSesion(admin);

  // Sesión Lead (HU-068: una sesión anónima con su contacto ya dejado) y una sesión anónima que todavía no lo es.
  const sesionLead = await fx.crearAnonimo();
  const lead = await conContacto(await fx.crearLeadDeSesion(sesionLead.id), "Valentina Ríos");
  const sesionAnonima = await fx.crearAnonimo();

  // Monitor 1: franja presencial (lunes 10:00, 60 min, de la materia del contexto) y franja virtual (miércoles
  // 15:30, 45 min, de otra materia en la que también está certificado).
  const contexto1 = await fx.crearContextoDeMonitoria(admin.id);
  const materiaVirtual = await fx.crearMateria("Física de prueba");
  await fx.crearCertificado({ idMonitor: contexto1.monitor.id, idMateria: materiaVirtual.id, idAdmin: admin.id });
  const franjaVirtual = await fx.crearFranja({
    idMonitor: contexto1.monitor.id,
    dia: MIERCOLES,
    hora: "15:30",
    duracionMin: 45,
    presencial: false,
    precio: PRECIO_DE_LA_FRANJA_VIRTUAL,
  });
  const presencial = contexto1;
  const virtual = { ...contexto1, franja: franjaVirtual, materia: materiaVirtual };

  const ana = await conContacto(contexto1.lead, "Ana Pérez");
  const camila = await conContacto(await fx.crearLead(), "Camila Torres");
  const daniel = await conContacto(await fx.crearLead(), "Daniel Rojas");
  const elena = await conContacto(await fx.crearLead(), "Elena Gómez");

  // Las fechas: la confirmada es la más cercana, y la pendiente vigente viene después aunque se cree antes (el
  // orden de la agenda es por inicio, no por creación). Pasadas, de más reciente a más antigua: cancelada, vencida,
  // realizada (esta última, ya ocurrida).
  const fechaConfirmada = primerDia(MIERCOLES, sumarDias(hoy(), 3));
  const fechaPendiente = primerDia(LUNES, sumarDias(hoy(), 10));
  const fechaVencida = sumarDias(fechaPendiente, 7);
  const fechaCancelada = sumarDias(fechaPendiente, 14);
  const fechaRealizada = sumarDias(fechaConfirmada, -14);
  // Un miércoles libre de la franja virtual, dentro de las semanas que deja agendar la base (HU-017).
  const fechaDeLaReserva = sumarDias(fechaConfirmada, 7);

  const pendiente = await fx.crearMonitoria({ ...presencial, lead: ana }, { fecha: fechaPendiente, estado: "pendiente_pago" });
  const confirmada = await fx.crearMonitoria({ ...virtual, lead }, { fecha: fechaConfirmada, estado: "confirmada" });
  const realizada = await fx.crearMonitoria(
    { ...virtual, lead: camila },
    {
      fecha: fechaRealizada,
      estado: "realizada",
      fechaFinalizacion: new Date(inicioDeSesion(fechaRealizada, franjaVirtual.hora).getTime() + 45 * MINUTO).toISOString(),
    },
  );
  const cancelada = await fx.crearMonitoria({ ...presencial, lead: daniel }, { fecha: fechaCancelada, estado: "cancelada" });
  exito(
    await fx.admin.from("monitoria").update({ motivo_cancelacion: "pago_rechazado" }).eq("id", cancelada.id).select().single(),
    "darle a la cancelada su motivo",
  );
  // Pendiente de pago con la reserva de 10 minutos vencida desde hace uno (RN-34); HU-027 todavía no la cancela.
  const vencida = await fx.crearMonitoria({ ...presencial, lead: elena }, { fecha: fechaVencida, estado: "pendiente_pago" });
  exito(
    await fx.admin.from("monitoria").update({ fecha_creacion: hace(11 * MINUTO) }).eq("id", vencida.id).select().single(),
    "envejecer la reserva",
  );

  // Comprobantes de las monitorías de pago: la confirmada y la realizada, aprobados; la cancelada, rechazado.
  const idsPagos: string[] = [];
  const pagar = async (idMonitoria: string, estado: "en_revision" | "aprobado" | "rechazado") => {
    const pago = await fx.crearPagoDe(idMonitoria, { idAdmin: admin.id, estado, monto: MONTO_DEL_PAGO, nombrePagador: "Pagador Aparte" });
    idsPagos.push(pago.id);
  };
  await pagar(confirmada.id, "aprobado");
  await pagar(realizada.id, "aprobado");
  await pagar(cancelada.id, "rechazado");

  const fila = (
    id: string,
    base: typeof presencial,
    quien: { nombre: string },
    fecha: string,
    resto: Pick<MonitoriaDeAgenda, "estado" | "motivoCancelacion" | "reservaVencida" | "estadoPago">,
  ): MonitoriaDeAgenda => ({
    idMonitoria: id,
    fecha,
    hora: base.franja.hora,
    duracionMin: base.franja.duracion_min,
    presencial: base.franja.presencial,
    nombreMateria: base.materia.nombre,
    codigoMateria: base.materia.codigo,
    nombreEstudiante: quien.nombre,
    inicio: inicioDeSesion(fecha, base.franja.hora),
    ...resto,
  });
  const esperadas = {
    pendiente: fila(pendiente.id, presencial, ana, fechaPendiente, { estado: "pendiente_pago", motivoCancelacion: null, reservaVencida: false, estadoPago: "sin_pagar" }),
    confirmada: fila(confirmada.id, virtual, lead, fechaConfirmada, { estado: "confirmada", motivoCancelacion: null, reservaVencida: false, estadoPago: "aprobado" }),
    realizada: fila(realizada.id, virtual, camila, fechaRealizada, { estado: "realizada", motivoCancelacion: null, reservaVencida: false, estadoPago: "aprobado" }),
    cancelada: fila(cancelada.id, presencial, daniel, fechaCancelada, { estado: "cancelada", motivoCancelacion: "pago_rechazado", reservaVencida: false, estadoPago: "rechazado" }),
    vencida: fila(vencida.id, presencial, elena, fechaVencida, { estado: "pendiente_pago", motivoCancelacion: null, reservaVencida: true, estadoPago: "sin_pagar" }),
  };

  // Monitor 2 ("otro monitor"): una monitoría por combinación de comprobantes, en lunes distintos. El estado de la
  // monitoría no importa aquí: solo cómo se resume su pago.
  const contexto2 = await fx.crearContextoDeMonitoria(admin.id);
  const gabriela = await conContacto(contexto2.lead, "Gabriela Mora");
  const primerLunes = primerDia(LUNES, sumarDias(hoy(), 3));
  const combinaciones: { caso: string; esperado: EstadoPago; idMonitoria: string }[] = [];
  for (const [i, combinacion] of COMBINACIONES.entries()) {
    const monitoria = await fx.crearMonitoria({ ...contexto2, lead: gabriela }, { fecha: sumarDias(primerLunes, 7 * i), estado: "confirmada" });
    for (const estado of combinacion.pagos) await pagar(monitoria.id, estado);
    combinaciones.push({ caso: combinacion.caso, esperado: combinacion.esperado, idMonitoria: monitoria.id });
  }

  return {
    admin,
    sesionAdmin,
    sesionLead,
    lead,
    sesionAnonima,
    monitor1: contexto1.monitor,
    sesionM1: await fx.iniciarSesion(contexto1.monitor),
    monitor2: contexto2.monitor,
    sesionM2: await fx.iniciarSesion(contexto2.monitor),
    contexto2,
    gabriela,
    materiaVirtual,
    franjaVirtual,
    fechaDeLaReserva,
    fechaLibreDelMonitor2: sumarDias(primerLunes, 7 * COMBINACIONES.length),
    leadsDelMonitor1: [ana, lead, camila, daniel, elena],
    esperadas,
    combinaciones,
    idsPagos,
  };
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1 (RN-17, D-12): próximas y pasadas", () => {
  it("las próximas son la pendiente de pago vigente y la confirmada, por inicio ascendente (aunque la pendiente se creó antes)", async () => {
    const { proximas } = separarAgenda(await cargarAgenda(e.sesionM1));

    expect(ids(proximas)).toEqual([e.esperadas.confirmada.idMonitoria, e.esperadas.pendiente.idMonitoria]);
    expect(proximas[0].inicio.getTime()).toBeLessThan(proximas[1].inicio.getTime());
    expect(proximas.map((m) => m.estado)).toEqual(["confirmada", "pendiente_pago"]);
    expect(proximas.map((m) => m.reservaVencida)).toEqual([false, false]);
  });

  it("las pasadas son la cancelada con su motivo, la reserva vencida y la realizada, de la más reciente a la más antigua", async () => {
    const { pasadas } = separarAgenda(await cargarAgenda(e.sesionM1));

    expect(ids(pasadas)).toEqual([e.esperadas.cancelada.idMonitoria, e.esperadas.vencida.idMonitoria, e.esperadas.realizada.idMonitoria]);
    const [cancelada, vencida, realizada] = pasadas;
    expect(cancelada).toMatchObject({ estado: "cancelada", motivoCancelacion: "pago_rechazado" });
    expect(textoDeEstado(cancelada)).toMatch(/Cancelada.*pago.*rechazado/i);
    expect(realizada).toMatchObject({ estado: "realizada", motivoCancelacion: null });
    expect(textoDeEstado(realizada)).toBe("Realizada");
    // D-12: la vencida sigue pendiente_pago en la base (nadie la ha cancelado), pero se muestra entre las pasadas.
    expect(vencida).toMatchObject({ estado: "pendiente_pago", motivoCancelacion: null, reservaVencida: true });
    expect(textoDeEstado(vencida)).toMatch(/vencida/i);
  });

  it("la agenda trae exactamente las cinco monitorías del monitor, ninguna de más ni repetida", async () => {
    const agenda = await cargarAgenda(e.sesionM1);

    expect(ids(agenda).sort()).toEqual(Object.values(e.esperadas).map((m) => m.idMonitoria).sort());
    const { proximas, pasadas } = separarAgenda(agenda);
    expect(proximas.length + pasadas.length).toBe(5);
  });

  it("D-12: la reserva pasa a pasadas al cumplirse los 10 minutos (a 9 sigue en próximas, a 11 ya venció) aunque siga pendiente_pago", async () => {
    const monitoria = await fx.crearMonitoria({ ...e.contexto2, lead: e.gabriela }, { fecha: e.fechaLibreDelMonitor2, estado: "pendiente_pago" });
    const envejecer = async (minutos: number) =>
      exito(await fx.admin.from("monitoria").update({ fecha_creacion: hace(minutos * MINUTO) }).eq("id", monitoria.id).select().single(), "envejecer la reserva");
    const dondeEsta = async () => {
      const agenda = await cargarAgenda(e.sesionM2);
      const { proximas, pasadas } = separarAgenda(agenda);
      return { vencida: porId(agenda, monitoria.id).reservaVencida, enProximas: ids(proximas).includes(monitoria.id), enPasadas: ids(pasadas).includes(monitoria.id) };
    };

    try {
      await envejecer(9);
      expect(await dondeEsta()).toEqual({ vencida: false, enProximas: true, enPasadas: false });

      await envejecer(11);
      expect(await dondeEsta()).toEqual({ vencida: true, enProximas: false, enPasadas: true });
      expect(porId(await cargarAgenda(e.sesionM2), monitoria.id).estado).toBe("pendiente_pago");
    } finally {
      // Las demás pruebas cuentan con las ocho monitorías del monitor 2.
      exito(await fx.admin.from("monitoria").delete().eq("id", monitoria.id).select(), "borrar la reserva de la prueba");
    }
  });
});

describe("criterio 2 (RN-36): cada monitoría trae fecha, hora, duración, materia, modalidad y quién agendó", () => {
  it.each(["pendiente", "confirmada", "realizada", "cancelada", "vencida"] as const)(
    "la monitoría %s trae su fecha, hora, duración, materia, modalidad y el nombre del Lead que la agendó",
    async (clave) => {
      const esperada = e.esperadas[clave];

      const agenda = await cargarAgenda(e.sesionM1);

      expect(porId(agenda, esperada.idMonitoria)).toEqual(esperada);
    },
  );

  it("hay una presencial y una virtual, de dos materias, con duraciones y horas distintas; el inicio es la fecha más la hora en Bogotá", async () => {
    const agenda = await cargarAgenda(e.sesionM1);

    expect(agenda.filter((m) => m.presencial)).toHaveLength(3);
    expect(agenda.filter((m) => !m.presencial)).toHaveLength(2);
    expect(new Set(agenda.map((m) => m.codigoMateria)).size).toBe(2);
    expect(new Set(agenda.map((m) => m.duracionMin))).toEqual(new Set([60, 45]));
    expect(new Set(agenda.map((m) => m.nombreEstudiante)).size).toBe(5);
    for (const m of agenda) expect(m.inicio.getTime(), m.nombreEstudiante).toBe(inicioDeSesion(m.fecha, m.hora).getTime());
  });

  it("una reserva hecha de verdad con agendarMonitoria por una sesión Lead aparece en la agenda del monitor con el nombre del Lead", async () => {
    const fecha = e.fechaDeLaReserva;

    const resultado = await agendarMonitoria(
      e.sesionLead.cliente,
      { idFranja: e.franjaVirtual.id, fecha, codigoMateria: e.materiaVirtual.codigo },
      false,
    );

    expect(resultado).toEqual({ resultado: "agendada", idMonitoria: expect.any(String) });
    const id = resultado.idMonitoria!;
    fx.registrarMonitoria(id);
    try {
      const agenda = await cargarAgenda(e.sesionM1);
      expect(porId(agenda, id)).toEqual({
        idMonitoria: id,
        fecha,
        hora: e.franjaVirtual.hora,
        duracionMin: 45,
        presencial: false,
        nombreMateria: "Física de prueba",
        codigoMateria: e.materiaVirtual.codigo,
        nombreEstudiante: "Valentina Ríos",
        estado: "pendiente_pago",
        motivoCancelacion: null,
        reservaVencida: false,
        estadoPago: "sin_pagar",
        inicio: inicioDeSesion(fecha, e.franjaVirtual.hora),
      });
      expect(ids(separarAgenda(agenda).proximas)).toContain(id);
      // Y solo en la de ese monitor.
      expect(ids(await cargarAgenda(e.sesionM2))).not.toContain(id);
    } finally {
      // La agenda del escenario es compartida: la reserva de esta prueba no debe quedar para las demás.
      exito(await fx.admin.from("monitoria").delete().eq("id", id).select(), "borrar la reserva de la prueba");
    }
  });
});

describe("criterio 3: la agenda es solo del monitor de la sesión", () => {
  it("otro monitor, con sus propias monitorías, no ve ninguna de las del primero, y el primero tampoco las de él", async () => {
    const delPrimero = ids(await cargarAgenda(e.sesionM1));
    const delOtro = ids(await cargarAgenda(e.sesionM2));

    expect(delOtro.sort()).toEqual(e.combinaciones.map((c) => c.idMonitoria).sort());
    expect(delPrimero.filter((id) => delOtro.includes(id))).toEqual([]);
    expect(delOtro).toHaveLength(COMBINACIONES.length);
    expect(delPrimero).toHaveLength(5);
    // Ni siquiera la tabla se las deja ver (la política de monitoria es la misma de HU-017).
    const filas = await e.sesionM2.from("monitoria").select("id").in("id", delPrimero);
    sinFilas(filas);
  });

  it("un admin, un Lead (aun con una monitoría a su nombre en la agenda del monitor) y una sesión anónima reciben una agenda vacía", async () => {
    // El admin ve todas las monitorías por las políticas, pero su agenda de monitor sigue vacía.
    const deTodas = exito(await e.sesionAdmin.from("monitoria").select("id"), "el admin lee las monitorías");
    expect(deTodas.length).toBeGreaterThanOrEqual(5);
    expect(await cargarAgenda(e.sesionAdmin)).toEqual([]);

    // El Lead sí ve su monitoría como estudiante (políticas), pero no es monitor.
    const deLaLead = exito(await e.sesionLead.cliente.from("monitoria").select("id").eq("id", e.esperadas.confirmada.idMonitoria), "la Lead lee su monitoría");
    expect(deLaLead).toHaveLength(1);
    expect(await cargarAgenda(e.sesionLead.cliente)).toEqual([]);

    expect(await cargarAgenda(e.sesionAnonima.cliente)).toEqual([]);
  });

  it("un cliente sin sesión (rol anon) no puede pedir la agenda: error de permisos", async () => {
    const crudo = await crearCliente().rpc("mi_agenda");

    expect(crudo.error?.code).toBe("42501");
    expect(crudo.data).toBeNull();
    await expect(cargarAgenda(crearCliente())).rejects.toThrow(/No se pudo leer la agenda/);
  });

  it("nadie pide la agenda de otro monitor: la función no recibe un monitor ni una hora, y la de la base no está expuesta", async () => {
    const delOtro = e.sesionM2;

    for (const extra of [{ p_id_monitor: e.monitor1.id }, { id_monitor: e.monitor1.id }, { p_ahora: "2020-01-01T00:00:00Z" }]) {
      const { error, data } = await delOtro.rpc("mi_agenda", extra as never);
      expect(error, JSON.stringify(extra)).not.toBeNull();
      expect(data, JSON.stringify(extra)).toBeNull();
    }
    const privado = await delOtro.schema("privado" as never).rpc("agenda_del_monitor" as never, { p_ahora: new Date().toISOString() } as never);
    expect(privado.error?.code).toBe("PGRST106");
  });
});

describe("criterio 4 (P-37): el monitor ve el nombre del estudiante, no su correo ni su teléfono", () => {
  it("nada de lo que devuelve mi_agenda (crudo ni por cargarAgenda) trae el correo ni el teléfono del Lead, pero sí su nombre", async () => {
    const crudo = exito(await e.sesionM1.rpc("mi_agenda"), "pedir la agenda");
    const jsonCrudo = JSON.stringify(crudo);
    const jsonCargada = JSON.stringify(await cargarAgenda(e.sesionM1));

    for (const lead of e.leadsDelMonitor1) {
      // Guarda de la prueba: el Lead sí tiene contacto en la base, así que su ausencia en la agenda significa algo.
      expect(lead.correo, `el correo de ${lead.nombre}`).toBeTruthy();
      expect(lead.numero_telefono, `el teléfono de ${lead.nombre}`).toBeTruthy();
      for (const [origen, json] of [["mi_agenda", jsonCrudo], ["cargarAgenda", jsonCargada]]) {
        expect(json, `${origen} muestra el nombre de ${lead.nombre}`).toContain(lead.nombre);
        expect(json, `${origen} esconde el correo de ${lead.nombre}`).not.toContain(lead.correo!);
        expect(json, `${origen} esconde el teléfono de ${lead.nombre}`).not.toContain(lead.numero_telefono!);
      }
    }
    // Ningún correo de nadie (ni del Lead ni del pagador de los comprobantes).
    expect(jsonCrudo).not.toContain("@");
    expect(jsonCargada).not.toContain("@");
  });

  it("el monitor no puede leer la fila del Lead directamente: from(lead) devuelve vacío, aunque el Lead existe", async () => {
    const idsDeLeads = e.leadsDelMonitor1.map((l) => l.id);
    const existen = exito(await fx.admin.from("lead").select("id").in("id", idsDeLeads), "leer los Leads con la llave secreta");
    expect(existen).toHaveLength(idsDeLeads.length);

    const filtrados = await e.sesionM1.from("lead").select("id, nombre, correo, numero_telefono").in("id", idsDeLeads);
    const todos = await e.sesionM1.from("lead").select("id, nombre, correo, numero_telefono");

    for (const resultado of [filtrados, todos]) {
      expect(resultado.error).toBeNull();
      expect(resultado.data).toEqual([]);
    }
  });
});

describe("criterio 5 (P-24, D-11): el estado del pago de cada monitoría, sin cifras", () => {
  it.each(COMBINACIONES.map((c) => c.caso))("D-11: con %s", async (caso) => {
    const { esperado, idMonitoria } = e.combinaciones.find((c) => c.caso === caso)!;

    const agenda = await cargarAgenda(e.sesionM2);

    expect(porId(agenda, idMonitoria).estadoPago).toBe(esperado);
  });

  it("los cuatro estados se alcanzan (sin pagar, en revisión, aprobado y rechazado) y la agenda del monitor 1 los muestra por monitoría", async () => {
    expect(new Set(e.combinaciones.map((c) => c.esperado))).toEqual(new Set<EstadoPago>(["sin_pagar", "en_revision", "aprobado", "rechazado"]));

    const agenda = await cargarAgenda(e.sesionM1);

    expect(Object.fromEntries(Object.entries(e.esperadas).map(([clave, m]) => [clave, porId(agenda, m.idMonitoria).estadoPago]))).toEqual({
      pendiente: "sin_pagar",
      confirmada: "aprobado",
      realizada: "aprobado",
      cancelada: "rechazado",
      vencida: "sin_pagar",
    });
  });

  it("los textos del estado del pago y de la monitoría no tienen cifras ni signos de dinero", async () => {
    const estados: EstadoPago[] = ["sin_pagar", "en_revision", "aprobado", "rechazado"];
    const textos = estados.map(textoDePago);

    expect(new Set(textos).size).toBe(4);
    for (const texto of textos) expect(texto).not.toMatch(/[\d$]/);
    for (const m of [...(await cargarAgenda(e.sesionM1)), ...(await cargarAgenda(e.sesionM2))]) {
      expect(textoDeEstado(m), m.nombreEstudiante).not.toMatch(/[\d$]/);
      expect(textoDePago(m.estadoPago), m.nombreEstudiante).not.toMatch(/[\d$]/);
    }
  });

  it("sin cifras de dinero: la fila trae solo las columnas de la agenda, y ni el monto, ni el valor, ni el precio, ni el pagador", async () => {
    const crudo = [...exito(await e.sesionM1.rpc("mi_agenda"), "agenda del monitor 1"), ...exito(await e.sesionM2.rpc("mi_agenda"), "agenda del monitor 2")];

    const columnas = [
      "codigo_materia", "duracion_min", "estado", "estado_pago", "fecha", "hora", "id_monitoria",
      "inicio", "motivo_cancelacion", "nombre_estudiante", "nombre_materia", "presencial", "reserva_vencida",
    ];
    for (const fila of crudo) expect(Object.keys(fila).sort()).toEqual(columnas);
    const valores = crudo.flatMap((fila) => Object.values(fila));
    for (const cifra of [MONTO_DEL_PAGO, VALOR_DE_LA_MONITORIA, PRECIO_DE_LA_FRANJA_VIRTUAL]) expect(valores).not.toContain(cifra);
    expect(JSON.stringify(crudo)).not.toContain("Pagador Aparte");
  });

  it("el monitor no puede leer la tabla de pagos: no llega ni el monto ni el pagador ni su contacto, aunque existen", async () => {
    const existen = exito(await fx.admin.from("pago").select("id").in("id", e.idsPagos), "leer los pagos con la llave secreta");
    expect(existen).toHaveLength(e.idsPagos.length);

    sinFilas(await e.sesionM1.from("pago").select("id, monto, nombre_pagador, contacto, estado").in("id", e.idsPagos));
    sinFilas(await e.sesionM1.from("pago").select("id, monto, nombre_pagador, contacto, estado"));
    // Tampoco la comisión (P-32): el desembolso es del admin.
    sinFilas(await e.sesionM1.from("desembolso").select("id, comision, monto_neto"));
  });
});
