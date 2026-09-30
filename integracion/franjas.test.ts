import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { diaDelNegocio } from "@/lib/fechas";
import type { Database } from "@/lib/supabase/tipos";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

// HU-015 contra el Supabase LOCAL: el monitor abre, edita y cierra sus franjas semanales con su sesión
// real (rol `authenticated`), que es la única que pasa por el trigger `privado.validar_franja_del_monitor`.
// Las monitorías y las cuentas las crea el cliente de confianza (llave secreta). Cada prueba borra lo suyo.

type NuevaFranja = Database["public"]["Tables"]["franja"]["Insert"];
type Monitor = { usuario: UsuarioPrueba; cliente: Cliente; idMateria: string };

let fx: Fixtures;
let idAdmin: string;
let franjas: string[];
let leadDePrueba: string | undefined;

beforeAll(async () => {
  await exigirSupabaseLocal();
});

beforeEach(async () => {
  fx = new Fixtures();
  franjas = [];
  leadDePrueba = undefined;
  idAdmin = (await fx.crearAdmin()).id;
});

afterEach(async () => {
  // Las franjas que abre el monitor no las conoce Fixtures: sus monitorías y ellas se borran antes que las cuentas.
  try {
    if (franjas.length) {
      exito(await fx.admin.from("monitoria").delete().in("id_franja", franjas).select("id"), "borrar monitorías de prueba");
      exito(await fx.admin.from("franja").delete().in("id", franjas).select("id"), "borrar franjas de prueba");
    }
  } finally {
    await fx.limpiar();
  }
});

// ---------------------------------------------------------------------------
// Fechas: siempre en la zona del negocio (America/Bogota), nunca en la del servidor.
// ---------------------------------------------------------------------------
const hoy = () => diaDelNegocio(new Date());

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Día ISO (1 = lunes ... 7 = domingo) de un día de calendario. */
function diaIso(fecha: string): number {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * La franja de las pruebas cae en el mismo día de la semana que hoy: así hoy, hoy + 7, hoy + 14... son
 * fechas válidas para una monitoría en ella (la base exige que la fecha caiga en el día de la franja).
 */
const DIA = () => diaIso(hoy());

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------
async function crearMonitorCertificado(): Promise<Monitor> {
  const { materia } = await fx.crearEvaluacion();
  const usuario = await fx.crearMonitor();
  await fx.crearCertificado({ idMonitor: usuario.id, idMateria: materia.id, idAdmin });
  return { usuario, cliente: await fx.iniciarSesion(usuario), idMateria: materia.id };
}

async function crearMonitorSinCertificado(): Promise<Monitor> {
  const usuario = await fx.crearMonitor();
  return { usuario, cliente: await fx.iniciarSesion(usuario), idMateria: "" };
}

const presencial = (idMonitor: string, extra: Partial<NuevaFranja> = {}): NuevaFranja => ({
  id_monitor: idMonitor,
  dia: DIA(),
  hora: "10:00",
  presencial: true,
  precio: 25_000,
  duracion_min: 60,
  lugar: "Edificio ML, salón 101",
  ...extra,
});

const virtual = (idMonitor: string, extra: Partial<NuevaFranja> = {}): NuevaFranja => ({
  id_monitor: idMonitor,
  dia: DIA(),
  hora: "10:00",
  presencial: false,
  precio: 30_000,
  duracion_min: 60,
  enlace: "https://meet.example.com/abc-defg",
  ...extra,
});

/** Lo que la franja muestra a cualquiera. El lugar y el enlace se comprueban aparte, con el cliente de confianza. */
const COLUMNAS_VISIBLES = "id, id_monitor, dia, hora, presencial, precio, duracion_min, abierta_desde, cerrada_desde";

/** El monitor abre una franja con su sesión (pasa por el trigger). Se anota para borrarla al final. */
async function abrir(monitor: Monitor, datos: Partial<NuevaFranja> = {}) {
  // Presencial por defecto; con `presencial: false` parte de una virtual (lugar y enlace no van juntos).
  const base = datos.presencial === false ? virtual : presencial;
  const franja = exito(
    await monitor.cliente.from("franja").insert(base(monitor.usuario.id, datos)).select(COLUMNAS_VISIBLES).single(),
    "abrir franja",
  );
  franjas.push(franja.id);
  return franja;
}

/** Una monitoría en la franja, creada por el cliente de confianza. Deja su valor propio (RN-32). */
async function agendar(
  monitor: Monitor,
  idFranja: string,
  datos: { fecha: string; estado?: "confirmada" | "realizada" | "cancelada"; valorTotal?: number },
) {
  leadDePrueba ??= (await fx.crearLead()).id;
  const estado = datos.estado ?? "confirmada";
  return exito(
    await fx.admin
      .from("monitoria")
      .insert({
        id_franja: idFranja,
        id_monitor: monitor.usuario.id,
        id_materia: monitor.idMateria,
        id_lead: leadDePrueba,
        fecha: datos.fecha,
        valor_total: datos.valorTotal ?? 25_000,
        estado,
        motivo_cancelacion: estado === "cancelada" ? "estudiante" : null,
        fecha_finalizacion: estado === "realizada" ? new Date().toISOString() : null,
      })
      .select()
      .single(),
    "agendar monitoría",
  );
}

async function franjaEnLaBase(id: string) {
  return exito(await fx.admin.from("franja").select("*").eq("id", id).single(), "leer franja");
}

const MENSAJE_HORARIO_FIJO = "No puedes cambiar el día, la hora ni la duración de una franja que ya tiene monitorías";
const MENSAJE_CIERRE_CON_MONITORIAS = "No puedes cerrarla desde esa fecha: tiene monitorías agendadas ese día o después.";
const MENSAJE_CIERRE_EN_EL_PASADO = "La franja se cierra desde hoy o desde una fecha futura.";
const MENSAJE_SOLAPE = "Se cruza con otra de tus franjas abiertas el mismo día.";

// ---------------------------------------------------------------------------
// Criterio 1: abrir franjas
// ---------------------------------------------------------------------------
describe("criterio 1: el monitor certificado abre franjas", () => {
  it("abre una franja presencial con lugar y la ve en su lista, abierta desde hoy", async () => {
    const monitor = await crearMonitorCertificado();

    const franja = await abrir(monitor, { dia: 3, hora: "14:30", precio: 25_000, duracion_min: 90, lugar: "Edificio W, salón 202" });

    expect(franja).toMatchObject({
      id_monitor: monitor.usuario.id,
      dia: 3,
      presencial: true,
      precio: 25_000,
      duracion_min: 90,
      cerrada_desde: null,
      abierta_desde: hoy(),
    });
    expect(franja.hora.slice(0, 5)).toBe("14:30");
    expect(await franjaEnLaBase(franja.id)).toMatchObject({ lugar: "Edificio W, salón 202", enlace: null });

    // La lista de la página: las franjas del monitor ordenadas por día y hora.
    const lista = exito(
      await monitor.cliente
        .from("franja")
        .select("id, dia, hora, duracion_min, presencial, precio, cerrada_desde")
        .eq("id_monitor", monitor.usuario.id)
        .order("dia")
        .order("hora"),
      "lista de franjas",
    );
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: franja.id, dia: 3, precio: 25_000, duracion_min: 90, presencial: true });
  });

  it("abre una franja virtual con enlace https", async () => {
    const monitor = await crearMonitorCertificado();

    const franja = await abrir(monitor, { presencial: false, dia: 2, hora: "18:00", duracion_min: 45 });

    expect(franja).toMatchObject({ presencial: false, precio: 30_000, duracion_min: 45 });
    expect(await franjaEnLaBase(franja.id)).toMatchObject({ enlace: "https://meet.example.com/abc-defg", lugar: null });
  });

  it("la fecha de apertura no la escribe el monitor: la pone la base (hoy en Bogotá)", async () => {
    const monitor = await crearMonitorCertificado();

    // abierta_desde no tiene permiso de escritura para el monitor.
    const { error } = await monitor.cliente
      .from("franja")
      .insert({ ...presencial(monitor.usuario.id), abierta_desde: sumarDias(hoy(), -30) });

    expect(error).toMatchObject({ code: "42501" });
    expect(exito(await fx.admin.from("franja").select("id").eq("id_monitor", monitor.usuario.id), "franjas")).toEqual([]);
  });

  it("una franja presencial sin lugar y una virtual sin enlace se rechazan con su mensaje", async () => {
    const monitor = await crearMonitorCertificado();

    const sinLugar = await monitor.cliente.from("franja").insert(presencial(monitor.usuario.id, { lugar: null }));
    expect(sinLugar.error).toMatchObject({ code: "P0001", message: "Una franja presencial necesita el lugar de la sesión." });

    const sinEnlace = await monitor.cliente.from("franja").insert(virtual(monitor.usuario.id, { enlace: null }));
    expect(sinEnlace.error).toMatchObject({ code: "P0001", message: "Una franja virtual necesita el enlace de la videollamada." });
  });

  it("el enlace debe ir por https y una franja no lleva lugar y enlace a la vez", async () => {
    const monitor = await crearMonitorCertificado();

    const http = await monitor.cliente.from("franja").insert(virtual(monitor.usuario.id, { enlace: "http://meet.example.com/abc" }));
    expect(http.error).toMatchObject({ code: "23514" });

    const conEspacios = await monitor.cliente.from("franja").insert(virtual(monitor.usuario.id, { enlace: "https://meet example.com" }));
    expect(conEspacios.error).toMatchObject({ code: "23514" });

    const ambos = await monitor.cliente.from("franja").insert(presencial(monitor.usuario.id, { enlace: "https://meet.example.com/abc" }));
    expect(ambos.error).toMatchObject({ code: "23514" });

    expect(exito(await fx.admin.from("franja").select("id").eq("id_monitor", monitor.usuario.id), "franjas")).toEqual([]);
  });

  it("el precio es un entero mayor que cero y la duración debe caber en el mismo día", async () => {
    const monitor = await crearMonitorCertificado();

    const gratis = await monitor.cliente.from("franja").insert(presencial(monitor.usuario.id, { precio: 0 }));
    expect(gratis.error).toMatchObject({ code: "23514" });

    const decimales = await monitor.cliente.from("franja").insert(presencial(monitor.usuario.id, { precio: 25_000.5 }));
    expect(decimales.error, "un precio con decimales no es un entero").not.toBeNull();

    const pasaDeMedianoche = await monitor.cliente.from("franja").insert(presencial(monitor.usuario.id, { hora: "23:30", duracion_min: 60 }));
    expect(pasaDeMedianoche.error).toMatchObject({
      code: "P0001",
      message: "La franja debe terminar el mismo día: revisa la hora y la duración.",
    });

    // Justo hasta la medianoche sí cabe.
    const hastaMedianoche = await abrir(monitor, { hora: "23:00", duracion_min: 60 });
    expect(hastaMedianoche.hora.slice(0, 5)).toBe("23:00");
  });

  it("un monitor sin certificado no puede abrir franjas", async () => {
    const monitor = await crearMonitorSinCertificado();

    const { error } = await monitor.cliente.from("franja").insert(presencial(monitor.usuario.id));

    expect(error?.code).toBe("P0001");
    expect(error?.message).toContain("necesitas al menos un certificado");
    expect(exito(await fx.admin.from("franja").select("id").eq("id_monitor", monitor.usuario.id), "franjas")).toEqual([]);
  });

  it("no abre franjas a nombre de otro monitor", async () => {
    const monitor = await crearMonitorCertificado();
    const otro = await crearMonitorCertificado();

    const { error } = await monitor.cliente.from("franja").insert(presencial(otro.usuario.id));

    expect(error).toMatchObject({ code: "42501" });
    expect(exito(await fx.admin.from("franja").select("id").eq("id_monitor", otro.usuario.id), "franjas")).toEqual([]);
  });

  it("no cambia ni cierra la franja de otro monitor: su fila no le aparece para escribir", async () => {
    const monitor = await crearMonitorCertificado();
    const otro = await crearMonitorCertificado();
    const ajena = await abrir(otro, { precio: 25_000 });

    const precio = await monitor.cliente.from("franja").update({ precio: 1 }).eq("id", ajena.id).select("id");
    const cierre = await monitor.cliente.from("franja").update({ cerrada_desde: hoy() }).eq("id", ajena.id).select("id");

    expect(precio.data).toEqual([]);
    expect(cierre.data).toEqual([]);
    expect(await franjaEnLaBase(ajena.id)).toMatchObject({ precio: 25_000, cerrada_desde: null, id_monitor: otro.usuario.id });
  });

  it("la franja no cambia de dueño, no se borra y sin sesión no se abre", async () => {
    const monitor = await crearMonitorCertificado();
    const otro = await crearMonitorCertificado();
    const franja = await abrir(monitor);

    const traspaso = await monitor.cliente.from("franja").update({ id_monitor: otro.usuario.id }).eq("id", franja.id);
    expect(traspaso.error).toMatchObject({ code: "42501" });

    const borrado = await monitor.cliente.from("franja").delete().eq("id", franja.id);
    expect(borrado.error).toMatchObject({ code: "42501" });

    const anonimo = await crearCliente().from("franja").insert(presencial(monitor.usuario.id));
    expect(anonimo.error).toMatchObject({ code: "42501" });

    expect(await franjaEnLaBase(franja.id)).toMatchObject({ id_monitor: monitor.usuario.id });
  });
});

// ---------------------------------------------------------------------------
// Criterio 2: RN-32, el precio de la monitoría es una copia
// ---------------------------------------------------------------------------
describe("criterio 2 (RN-32): cambiar el precio no toca lo ya agendado", () => {
  it("la monitoría conserva el valor con que se agendó cuando el monitor cambia el precio de la franja", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor, { precio: 25_000 });
    const monitoria = await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), 7), valorTotal: 25_000 });

    const cambio = await monitor.cliente.from("franja").update({ precio: 32_000 }).eq("id", franja.id).select("id, precio");

    expect(cambio.error).toBeNull();
    expect(cambio.data).toEqual([{ id: franja.id, precio: 32_000 }]);
    expect(await franjaEnLaBase(franja.id)).toMatchObject({ precio: 32_000 });
    const guardada = exito(await fx.admin.from("monitoria").select("valor_total").eq("id", monitoria.id).single(), "leer monitoría");
    expect(guardada.valor_total).toBe(25_000);
  });
});

// ---------------------------------------------------------------------------
// Criterio 3: P-30, cambios y cierre con monitorías
// ---------------------------------------------------------------------------
describe("criterio 3 (P-30): franja con monitorías futuras activas", () => {
  it.each([
    ["la hora", () => ({ hora: "12:00" })],
    ["el día", () => ({ dia: (DIA() % 7) + 1 })],
    ["la duración", () => ({ duracion_min: 90 })],
  ] as const)("no cambia %s", async (_nombre, cambio) => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor, { dia: DIA(), hora: "10:00", duracion_min: 60 });
    await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), 7) });

    const { error } = await monitor.cliente.from("franja").update(cambio()).eq("id", franja.id);

    expect(error?.code).toBe("P0001");
    expect(error?.message).toContain(MENSAJE_HORARIO_FIJO);
    expect(await franjaEnLaBase(franja.id)).toMatchObject({ dia: DIA(), duracion_min: 60 });
    expect((await franjaEnLaBase(franja.id)).hora.slice(0, 5)).toBe("10:00");
  });

  it("no cambia entre presencial y virtual, pero sí corrige el lugar y el precio", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);
    await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), 7) });

    const aVirtual = await monitor.cliente
      .from("franja")
      .update({ presencial: false, lugar: null, enlace: "https://meet.example.com/x" })
      .eq("id", franja.id);
    expect(aVirtual.error).toMatchObject({
      code: "P0001",
      message: "No puedes cambiar entre presencial y virtual mientras la franja tenga monitorías agendadas.",
    });

    const correccion = await monitor.cliente
      .from("franja")
      .update({ lugar: "Edificio W, salón 202", precio: 28_000 })
      .eq("id", franja.id);
    expect(correccion.error).toBeNull();
    expect(await franjaEnLaBase(franja.id)).toMatchObject({ lugar: "Edificio W, salón 202", precio: 28_000 });
  });

  it("una monitoría ya realizada también fija el horario (sus plazos salen de la franja), pero deja cambiar de modalidad", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);
    await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), -7), estado: "realizada" });

    const hora = await monitor.cliente.from("franja").update({ hora: "12:00" }).eq("id", franja.id);
    expect(hora.error?.code).toBe("P0001");
    expect(hora.error?.message).toContain(MENSAJE_HORARIO_FIJO);

    // Sin monitorías futuras, la modalidad sí cambia.
    const modalidad = await monitor.cliente
      .from("franja")
      .update({ presencial: false, lugar: null, enlace: "https://meet.example.com/x" })
      .eq("id", franja.id);
    expect(modalidad.error).toBeNull();
    expect(await franjaEnLaBase(franja.id)).toMatchObject({ presencial: false, lugar: null, enlace: "https://meet.example.com/x" });
  });

  it("no la cierra desde hoy ni desde la fecha de la última monitoría activa", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);
    await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), 7) });
    const ultima = sumarDias(hoy(), 14);
    await agendar(monitor, franja.id, { fecha: ultima });

    for (const desde of [hoy(), sumarDias(hoy(), 7), ultima]) {
      const { error } = await monitor.cliente.from("franja").update({ cerrada_desde: desde }).eq("id", franja.id);
      expect(error?.code, `cerrar desde ${desde}`).toBe("P0001");
      expect(error?.message, `cerrar desde ${desde}`).toContain(MENSAJE_CIERRE_CON_MONITORIAS);
    }
    expect((await franjaEnLaBase(franja.id)).cerrada_desde).toBeNull();
  });

  it("la cierra desde el día siguiente a la última monitoría activa y esas monitorías se mantienen", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);
    const primera = await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), 7) });
    const ultima = await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), 14) });

    const desde = sumarDias(ultima.fecha, 1);
    const { error } = await monitor.cliente.from("franja").update({ cerrada_desde: desde }).eq("id", franja.id);

    expect(error).toBeNull();
    expect((await franjaEnLaBase(franja.id)).cerrada_desde).toBe(desde);
    const monitorias = exito(await fx.admin.from("monitoria").select("id, estado").in("id", [primera.id, ultima.id]), "monitorías");
    expect(monitorias.map((m) => m.estado)).toEqual(["confirmada", "confirmada"]);
  });

  it("una monitoría cancelada no cuenta: deja cambiar el horario y cerrar desde hoy", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);
    await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), 7), estado: "cancelada" });

    const horario = await monitor.cliente.from("franja").update({ hora: "12:00", duracion_min: 45 }).eq("id", franja.id);
    expect(horario.error).toBeNull();
    const cambiada = await franjaEnLaBase(franja.id);
    expect(cambiada.hora.slice(0, 5)).toBe("12:00");
    expect(cambiada.duracion_min).toBe(45);

    const cierre = await monitor.cliente.from("franja").update({ cerrada_desde: hoy() }).eq("id", franja.id);
    expect(cierre.error).toBeNull();
    expect((await franjaEnLaBase(franja.id)).cerrada_desde).toBe(hoy());
  });

  it("una cancelada posterior a las activas no adelanta el cierre mínimo", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);
    await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), 7) });
    await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), 21), estado: "cancelada" });

    const { error } = await monitor.cliente.from("franja").update({ cerrada_desde: sumarDias(hoy(), 8) }).eq("id", franja.id);

    expect(error).toBeNull();
    expect((await franjaEnLaBase(franja.id)).cerrada_desde).toBe(sumarDias(hoy(), 8));
  });

  it("sin monitorías cambia el horario libremente", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);

    const { error } = await monitor.cliente.from("franja").update({ dia: 6, hora: "16:00", duracion_min: 30 }).eq("id", franja.id);

    expect(error).toBeNull();
    const cambiada = await franjaEnLaBase(franja.id);
    expect(cambiada).toMatchObject({ dia: 6, duracion_min: 30 });
    expect(cambiada.hora.slice(0, 5)).toBe("16:00");
  });
});

// ---------------------------------------------------------------------------
// Solapes (P-30)
// ---------------------------------------------------------------------------
describe("solapes entre las franjas abiertas del mismo monitor (P-30)", () => {
  it("rechaza una segunda franja abierta el mismo día que se cruza con la primera", async () => {
    const monitor = await crearMonitorCertificado();
    await abrir(monitor, { hora: "10:00", duracion_min: 60 });

    for (const [hora, duracion] of [
      ["10:00", 60], // idéntica
      ["10:30", 60], // empieza dentro
      ["09:30", 60], // termina dentro
      ["09:00", 180], // la envuelve
    ] as const) {
      const { error } = await monitor.cliente.from("franja").insert(presencial(monitor.usuario.id, { hora, duracion_min: duracion }));
      expect(error, `${hora} + ${duracion} min`).toMatchObject({ code: "P0001", message: MENSAJE_SOLAPE });
    }
    expect(exito(await fx.admin.from("franja").select("id").eq("id_monitor", monitor.usuario.id), "franjas")).toHaveLength(1);
  });

  it("acepta la que empieza justo cuando termina otra, la de otro día y la de otro monitor", async () => {
    const monitor = await crearMonitorCertificado();
    const otro = await crearMonitorCertificado();
    await abrir(monitor, { hora: "10:00", duracion_min: 60 });

    const contigua = await abrir(monitor, { hora: "11:00", duracion_min: 60 });
    const anterior = await abrir(monitor, { hora: "09:00", duracion_min: 60 });
    const otroDia = await abrir(monitor, { dia: (DIA() % 7) + 1, hora: "10:00", duracion_min: 60 });
    const deOtroMonitor = await abrir(otro, { hora: "10:00", duracion_min: 60 });

    expect(contigua.hora.slice(0, 5)).toBe("11:00");
    expect(anterior.hora.slice(0, 5)).toBe("09:00");
    expect(otroDia.dia).not.toBe(DIA());
    expect(deOtroMonitor.id_monitor).toBe(otro.usuario.id);
  });

  it("cambiar la hora de una franja para cruzarla con otra también se rechaza", async () => {
    const monitor = await crearMonitorCertificado();
    await abrir(monitor, { hora: "10:00", duracion_min: 60 });
    const segunda = await abrir(monitor, { hora: "14:00", duracion_min: 60 });

    const { error } = await monitor.cliente.from("franja").update({ hora: "10:30" }).eq("id", segunda.id);

    expect(error).toMatchObject({ code: "P0001", message: MENSAJE_SOLAPE });
    expect((await franjaEnLaBase(segunda.id)).hora.slice(0, 5)).toBe("14:00");
  });

  it("una franja cerrada desde hoy ya no cuenta: una nueva puede ocupar su horario", async () => {
    const monitor = await crearMonitorCertificado();
    const primera = await abrir(monitor, { hora: "10:00", duracion_min: 60 });
    const cerrar = await monitor.cliente.from("franja").update({ cerrada_desde: hoy() }).eq("id", primera.id);
    expect(cerrar.error).toBeNull();

    const nueva = await abrir(monitor, { hora: "10:30", duracion_min: 60 });

    expect(nueva.hora.slice(0, 5)).toBe("10:30");
  });

  it("una franja que se cierra desde mañana sigue abierta hoy: todavía se cruza", async () => {
    const monitor = await crearMonitorCertificado();
    const primera = await abrir(monitor, { hora: "10:00", duracion_min: 60 });
    const cerrar = await monitor.cliente.from("franja").update({ cerrada_desde: sumarDias(hoy(), 1) }).eq("id", primera.id);
    expect(cerrar.error).toBeNull();

    const { error } = await monitor.cliente.from("franja").insert(presencial(monitor.usuario.id, { hora: "10:30" }));

    expect(error).toMatchObject({ code: "P0001", message: MENSAJE_SOLAPE });
  });
});

// ---------------------------------------------------------------------------
// Cierre
// ---------------------------------------------------------------------------
describe("cerrar una franja", () => {
  it("rechaza una fecha de cierre en el pasado", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);

    const { error } = await monitor.cliente.from("franja").update({ cerrada_desde: sumarDias(hoy(), -1) }).eq("id", franja.id);

    expect(error).toMatchObject({ code: "P0001", message: MENSAJE_CIERRE_EN_EL_PASADO });
    expect((await franjaEnLaBase(franja.id)).cerrada_desde).toBeNull();
  });

  it("acepta cerrar desde hoy y desde una fecha futura", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);

    const futura = await monitor.cliente.from("franja").update({ cerrada_desde: sumarDias(hoy(), 30) }).eq("id", franja.id);
    expect(futura.error).toBeNull();
    expect((await franjaEnLaBase(franja.id)).cerrada_desde).toBe(sumarDias(hoy(), 30));

    // Puede elegir otra fecha (adelantar el cierre).
    const hoyMismo = await monitor.cliente.from("franja").update({ cerrada_desde: hoy() }).eq("id", franja.id);
    expect(hoyMismo.error).toBeNull();
    expect((await franjaEnLaBase(franja.id)).cerrada_desde).toBe(hoy());
  });

  it("una franja cerrada no recibe monitorías desde su fecha de cierre, pero sí antes", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);
    const cierre = sumarDias(hoy(), 14);
    const cerrar = await monitor.cliente.from("franja").update({ cerrada_desde: cierre }).eq("id", franja.id);
    expect(cerrar.error).toBeNull();

    // Antes del cierre, sí.
    const antes = await agendar(monitor, franja.id, { fecha: sumarDias(hoy(), 7) });
    expect(antes.fecha).toBe(sumarDias(hoy(), 7));

    // Desde el cierre, no (vale también para el cliente de confianza: el agendamiento no se salta el cierre).
    leadDePrueba ??= (await fx.crearLead()).id;
    const despues = await fx.admin.from("monitoria").insert({
      id_franja: franja.id,
      id_monitor: monitor.usuario.id,
      id_materia: monitor.idMateria,
      id_lead: leadDePrueba,
      fecha: cierre,
      valor_total: 25_000,
    });
    expect(despues.error).toMatchObject({ code: "P0001", message: "La franja está cerrada desde esa fecha." });
  });
});

describe("P-31: el lugar y el enlace son solo para su monitor", () => {
  it("sin sesión se lee lo necesario para agendar, pero no el enlace ni el lugar", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor, { presencial: false });
    const anonimo = crearCliente();

    const visible = await anonimo.from("franja").select(COLUMNAS_VISIBLES).eq("id", franja.id).single();
    expect(visible.error).toBeNull();
    expect(visible.data).toMatchObject({ id: franja.id, precio: 30_000 });
    for (const columna of ["enlace", "lugar"] as const) {
      const oculta = await anonimo.from("franja").select(columna).eq("id", franja.id);
      expect(oculta.error, columna).toMatchObject({ code: "42501" });
    }
  });

  it("otro monitor tampoco los lee de la tabla, y acceso_a_mis_franjas() solo le da los suyos", async () => {
    const duena = await crearMonitorCertificado();
    const franja = await abrir(duena, { presencial: false });
    const otro = await crearMonitorCertificado();

    expect((await otro.cliente.from("franja").select("enlace").eq("id", franja.id)).error).toMatchObject({ code: "42501" });
    expect(exito(await otro.cliente.rpc("acceso_a_mis_franjas"), "acceso del otro")).toEqual([]);
    expect(exito(await duena.cliente.rpc("acceso_a_mis_franjas"), "acceso de la dueña")).toEqual([
      { id_franja: franja.id, lugar: null, enlace: "https://meet.example.com/abc-defg" },
    ]);
  });

  it("sin sesión no se llama acceso_a_mis_franjas()", async () => {
    const { error } = await crearCliente().rpc("acceso_a_mis_franjas");
    expect(error).not.toBeNull();
  });
});

describe("franja ya cerrada y horas con segundos", () => {
  it("una franja ya cerrada no se edita ni se reabre: se abre otra", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);
    exito(await monitor.cliente.from("franja").update({ cerrada_desde: hoy() }).eq("id", franja.id).select("id"), "cerrar");

    for (const cambio of [{ precio: 40_000 }, { cerrada_desde: null }]) {
      const { error } = await monitor.cliente.from("franja").update(cambio).eq("id", franja.id);
      expect(error).toMatchObject({ code: "P0001", message: "Esta franja ya está cerrada. Para volver a ofrecer ese horario, abre otra." });
    }
  });

  it("un cierre programado para más adelante sí se puede mover", async () => {
    const monitor = await crearMonitorCertificado();
    const franja = await abrir(monitor);
    exito(await monitor.cliente.from("franja").update({ cerrada_desde: sumarDias(hoy(), 7) }).eq("id", franja.id).select("id"), "programar");
    const movida = exito(
      await monitor.cliente.from("franja").update({ cerrada_desde: sumarDias(hoy(), 14) }).eq("id", franja.id).select("cerrada_desde"),
      "mover el cierre",
    );
    expect(movida).toEqual([{ cerrada_desde: sumarDias(hoy(), 14) }]);
  });

  it("la hora va en horas y minutos: con segundos se rechaza", async () => {
    const monitor = await crearMonitorCertificado();
    const { error } = await monitor.cliente.from("franja").insert(presencial(monitor.usuario.id, { hora: "10:00:30" }));
    expect(error).toMatchObject({ code: "P0001", message: "Escribe la hora en horas y minutos, por ejemplo 14:00." });
  });
});
