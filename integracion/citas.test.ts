import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/procesos/confirmar-citas/route";
import type { PedidoDeAgendar } from "@/lib/agendar/reglas";
import { agendarMonitoria } from "@/lib/agendar/servidor";
import { rutaDeCita } from "@/lib/citas/reglas";
import {
  leerCitaPorToken,
  leerMiCita,
  leerMisCitas,
  MAXIMO_DE_INTENTOS,
  procesarConfirmacionesDeCita,
  reconstruirConfirmacionCita,
} from "@/lib/citas/servidor";
import { subirComprobante } from "@/lib/comprobantes/almacenamiento";
import { revisarComprobanteDesdeServidor } from "@/lib/comprobantes/servidor";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { reintentarCorreosFallidos } from "@/lib/correo/reintentos";
import { enviarCorreoDesdeServidor } from "@/lib/correo/servidor";
import { diaDelNegocio, formatearFechaHora } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";
import { registrarPago } from "@/lib/pagos/servidor";
import { diaIsoDeFecha } from "@/lib/plazos/motor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente } from "./utilidades";

/**
 * HU-019 contra el Supabase local: el trigger de `monitoria` anota la confirmación al pasar una individual de
 * `pendiente_pago` a `confirmada` (la confirme quien la confirme: la base, o `registrar_pago` de HU-018),
 * `procesarConfirmacionesDeCita` (el mismo código de la ruta `/api/procesos/confirmar-citas`) manda por Mailpit el
 * enlace `/cita?token=...` al correo del Lead (D-19), y `leerCitaPorToken`, `leerMiCita` y `leerMisCitas` (lo que usan
 * las páginas) entregan la cita por el token o por la sesión del Lead. En local no hay configuración en Vault, así que
 * la base no llama a la app: la prueba llama el proceso.
 *
 * IMPORTANTE: una monitoría insertada ya `confirmada` NO dispara el trigger (es de UPDATE). Por eso cada cita se crea
 * `pendiente_pago` y se confirma con un UPDATE.
 *
 * Los datos son de la prueba y los borra ella: una monitoría por fecha lejana (una franja no tiene dos activas el mismo
 * día). Las confirmaciones se van en cascada con la monitoría; el registro de correos y los buzones de Mailpit, no, así
 * que la limpieza los borra. La corrida del proceso toma cualquier confirmación pendiente de la base (lotes de 10): por
 * eso se repite hasta que la de la prueba queda procesada, y cada prueba deja procesadas las suyas.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const PRECIO = 25_000;
const ENLACE_VIRTUAL = "https://meet.example/cita-prueba";

// La firma mínima de un PNG: la revisión del servidor mira los primeros bytes.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

type Lead = Awaited<ReturnType<Fixtures["crearLead"]>>;
type Contexto = Awaited<ReturnType<Fixtures["crearContextoDeMonitoria"]>>;

let fx: Fixtures;
let bd: pg.Client;
let mailpit: string;
let e: Awaited<ReturnType<typeof construirEscenario>>;
let sesionMonitor: Cliente;
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
  // Cada prueba deja procesadas sus confirmaciones: la siguiente corrida del proceso no se las encuentra.
  if (monitorias.length) {
    await fx.admin.from("confirmacion_cita").update({ procesado_en: new Date().toISOString() }).in("id_monitoria", monitorias).is("procesado_en", null);
  }
});

afterAll(async () => {
  for (const correo of correos) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(() => undefined);
  }
  if (fx) {
    if (monitorias.length) {
      await fx.admin.from("correo_envio").delete().in("clave", monitorias.map((id) => claveDeCorreo("confirmacion_cita", id)));
    }
    await fx.limpiar();
  }
  if (bd) {
    if (ancla) await bd.query("delete from privado.subida_comprobante where carpeta = $1", [ancla.id]).catch(() => undefined);
    await bd.end();
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

/** El primer día de la semana ISO `dia` (1 = lunes) a cuatro semanas o más de hoy en Bogotá, más `semanasExtra` semanas. */
function diaLejano(dia: number, semanasExtra = 0): string {
  let fecha = sumarDias(diaDelNegocio(new Date()), 28 + semanasExtra * 7);
  while (diaIsoDeFecha(fecha) !== dia) fecha = sumarDias(fecha, 1);
  return fecha;
}

/** El lunes más reciente que ya pasó (a las 10:00 de Bogotá la sesión ya terminó), `semanasAtras` semanas antes. */
function lunesPasado(semanasAtras = 1): string {
  let fecha = sumarDias(diaDelNegocio(new Date()), -7 * semanasAtras);
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
  // Presencial los lunes y virtual los martes, las dos a las 10:00 por 60 min.
  const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: 1, hora: "10:00:00" });
  const franjaVirtual = await fx.crearFranja({ idMonitor: monitor.id, dia: 2, hora: "10:00:00", presencial: false, enlace: ENLACE_VIRTUAL });
  const lead = await fx.crearLead();
  correos.add(lead.correo!);
  return { admin, materia, monitor, lead, franja, franjaVirtual, contexto: { materia, monitor, franja, lead } as Contexto };
}

let semana = 0;

/** Una individual `pendiente_pago` de la franja del lunes, cada una en una semana distinta. */
async function pendiente(opciones: { contexto?: Contexto; fecha?: string } = {}) {
  const monitoria = await fx.crearMonitoria(opciones.contexto ?? e.contexto, {
    fecha: opciones.fecha ?? diaLejano(1, semana++),
    estado: "pendiente_pago",
  });
  monitorias.push(monitoria.id);
  return monitoria;
}

/** Lo que hace `registrar_pago` (HU-018) en la misma transacción: confirmar con un UPDATE de `estado`. */
async function cambiarEstado(id: string, estado: "confirmada" | "cancelada" | "realizada", motivo?: string) {
  exito(
    await fx.admin
      .from("monitoria")
      .update({
        estado,
        motivo_cancelacion: (motivo ?? null) as never,
        fecha_finalizacion: estado === "realizada" ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select()
      .single(),
    `pasar la monitoría a ${estado}`,
  );
}

/** Una individual que ya pasó de `pendiente_pago` a `confirmada`, con su confirmación anotada. */
async function confirmada(opciones: { contexto?: Contexto; fecha?: string } = {}) {
  const monitoria = await pendiente(opciones);
  await cambiarEstado(monitoria.id, "confirmada");
  return monitoria;
}

async function confirmacionDe(idMonitoria: string) {
  const filas = exito(
    await fx.admin.from("confirmacion_cita").select("id, token, creada_en, procesado_en, intentos").eq("id_monitoria", idMonitoria),
    "leer confirmaciones",
  );
  return filas[0] ?? null;
}

async function tokenDe(idMonitoria: string): Promise<string> {
  const confirmacion = await confirmacionDe(idMonitoria);
  if (!confirmacion) throw new Error(`La monitoría ${idMonitoria} no tiene confirmación anotada.`);
  return confirmacion.token;
}

async function registroDe(idMonitoria: string) {
  const filas = exito(
    await fx.admin.from("correo_envio").select("estado, destinatario, plantilla").eq("clave", claveDeCorreo("confirmacion_cita", idMonitoria)),
    "leer el registro de correos",
  );
  return filas[0] ?? null;
}

type Mensaje = { Subject: string; Text: string; HTML: string };

async function correosA(correo: string): Promise<Mensaje[]> {
  correos.add(correo);
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

/** Corre el proceso hasta que la confirmación de esa monitoría queda procesada (puede haber otras pendientes en la base). */
async function procesarHasta(idMonitoria: string) {
  for (let i = 0; i < 10; i++) {
    await procesarConfirmacionesDeCita({ cliente: fx.admin });
    const confirmacion = await confirmacionDe(idMonitoria);
    if (!confirmacion || confirmacion.procesado_en !== null) return;
  }
  throw new Error(`La confirmación de la monitoría ${idMonitoria} no se procesó tras 10 corridas.`);
}

async function pagoDe(idMonitoria: string, estado: "en_revision" | "aprobado" | "rechazado" = "en_revision") {
  return fx.crearPagoDe(idMonitoria, { idAdmin: e.admin.id, estado });
}

// ---------------------------------------------------------------------------------------------------------------
// El trigger
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: el trigger anota la confirmación al confirmar una individual", () => {
  it("pendiente_pago a confirmada anota una confirmación con un token aleatorio de 64 hexadecimales, sin procesar", async () => {
    const monitoria = await pendiente();
    expect(await confirmacionDe(monitoria.id)).toBeNull();
    const desde = Date.now();

    await cambiarEstado(monitoria.id, "confirmada");

    const confirmacion = await confirmacionDe(monitoria.id);
    expect(confirmacion).toMatchObject({ procesado_en: null, intentos: 0 });
    expect(confirmacion!.token).toMatch(/^[0-9a-f]{64}$/);
    const creada = new Date(confirmacion!.creada_en).getTime();
    expect(creada).toBeGreaterThanOrEqual(desde - 5_000);
    expect(creada).toBeLessThanOrEqual(Date.now() + 5_000);

    // Otra monitoría, otro token.
    const otraMonitoria = await confirmada();
    expect(await tokenDe(otraMonitoria.id)).not.toBe(confirmacion!.token);
  });

  it("repetir el estado, o pasar después a realizada o a cancelada, no cambia el token ni anota otra", async () => {
    const monitoria = await confirmada();
    const [primera] = exito(await fx.admin.from("confirmacion_cita").select("id, token").eq("id_monitoria", monitoria.id), "leer");

    await cambiarEstado(monitoria.id, "confirmada");
    await cambiarEstado(monitoria.id, "realizada");
    await cambiarEstado(monitoria.id, "cancelada", "estudiante");

    expect(exito(await fx.admin.from("confirmacion_cita").select("id, token").eq("id_monitoria", monitoria.id), "leer")).toEqual([primera]);
  });

  it("una monitoría insertada ya confirmada, una que vence sin pago y una grupal no anotan confirmación", async () => {
    const directa = await fx.crearMonitoria(e.contexto, { fecha: diaLejano(1, semana++), estado: "confirmada" });
    monitorias.push(directa.id);
    expect(await confirmacionDe(directa.id)).toBeNull();

    const vencida = await pendiente();
    await cambiarEstado(vencida.id, "cancelada", "reserva_expirada");
    expect(await confirmacionDe(vencida.id)).toBeNull();

    const grupal = await pendiente();
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: grupal.id, cupos: 3, modalidad_pago: "unico", precio_por_persona: 10_000 }).select().single(),
      "insertar monitoria_grupal",
    );
    await cambiarEstado(grupal.id, "confirmada");
    expect(await confirmacionDe(grupal.id)).toBeNull();
  });

  it("registrar_pago (HU-018), con la sesión del Lead, anota la confirmación; el proceso manda el correo al Lead (no al pagador) y la página entrega la cita por el token y por la sesión", async () => {
    const admin = e.admin;
    const { materia } = await fx.crearEvaluacion();
    const monitor = await fx.crearMonitor();
    await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
    const primera = sumarDias(diaDelNegocio(new Date()), 2);
    const franja = await fx.crearFranja({
      idMonitor: monitor.id,
      dia: diaIsoDeFecha(primera),
      hora: "10:00",
      precio: 32_000,
      abiertaDesde: diaDelNegocio(new Date()),
    });
    const pedido: PedidoDeAgendar = { idFranja: franja.id, fecha: primera, codigoMateria: materia.codigo };

    // Aparta la fecha con la sesión del Lead, como la página de agendar.
    const { resultado, idMonitoria } = await agendarMonitoria(ancla.cliente, pedido, false);
    if (idMonitoria) {
      fx.registrarMonitoria(idMonitoria);
      monitorias.push(idMonitoria);
    }
    expect(resultado).toBe("agendada");
    expect(await confirmacionDe(idMonitoria!)).toBeNull();

    // El navegador sube el comprobante, el servidor lo revisa y la base registra el pago y confirma la monitoría.
    const subida = await subirComprobante(ancla.cliente, ancla.id, new File([PNG as BlobPart], "transferencia.png", { type: "image/png" }));
    if (!subida.ok) throw new Error(`no se pudo subir el comprobante: ${subida.mensaje}`);
    fx.registrarComprobante(subida.ruta);
    expect(await revisarComprobanteDesdeServidor(subida.ruta)).toEqual({ ok: true, tipo: "image/png" });
    const correoDelPagador = `pagador-${randomBytes(6).toString("hex")}@calibra.test`;
    const registro = await registrarPago(ancla.cliente, { idMonitoria: idMonitoria!, ruta: subida.ruta, nombre: "Ana Pérez", correo: correoDelPagador });
    if (registro.idPago) fx.registrarPago(registro.idPago);
    expect(registro.resultado).toBe("registrado");

    // La confirmación quedó anotada por el trigger, sin que `registrar_pago` lo sepa.
    const confirmacion = await confirmacionDe(idMonitoria!);
    expect(confirmacion).toMatchObject({ procesado_en: null });
    const token = confirmacion!.token;
    await procesarHasta(idMonitoria!);

    // Sale al correo del Lead y no al del pagador (D-19: sin copia al contacto del pago).
    const delLead = await correosA(leadDeAncla.correo!);
    expect(delLead).toHaveLength(1);
    expect(delLead[0].Subject).toBe(`Tu monitoría de ${materia.nombre} está confirmada`);
    expect(delLead[0].Text).toContain(rutaDeCita(token));
    expect(await correosA(correoDelPagador)).toEqual([]);
    expect(await registroDe(idMonitoria!)).toEqual({ estado: "enviado", destinatario: leadDeAncla.correo, plantilla: "confirmacion_cita" });

    // Las dos puertas entregan la misma cita, con el pago en revisión (D-22) y el lugar visible (D-21).
    const porToken = await leerCitaPorToken(token);
    const porSesion = await leerMiCita(ancla.cliente, idMonitoria!);
    expect(porToken).toMatchObject({ estado: "confirmada", estadoPago: "en_revision", valorTotal: 32_000, lugar: "Salón de prueba", nombreMateria: materia.nombre });
    expect(porSesion).toEqual(porToken);
    expect((await leerMisCitas(ancla.cliente)).map((c) => c.idMonitoria)).toContain(idMonitoria);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------
// El correo
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: el proceso manda un solo correo al Lead, con el enlace de gestión", () => {
  it("el correo trae fecha, hora, duración, modalidad, materia, monitor, lugar, valor, plazo y el enlace con el token; no repite en otra corrida ni copia al pagador", async () => {
    const monitoria = await confirmada();
    const pago = await pagoDe(monitoria.id);
    // El contacto del pago es otro correo: no recibe copia (D-19).
    const correoDelPago = `pagador-${randomBytes(6).toString("hex")}@calibra.test`;
    exito(await fx.admin.from("pago").update({ contacto: correoDelPago }).eq("id", pago.id).select().single(), "poner el contacto del pago");
    const token = await tokenDe(monitoria.id);
    const antes = (await correosA(e.lead.correo!)).length;

    const resumen = await procesarConfirmacionesDeCita({ cliente: fx.admin });
    expect(resumen.enviadas).toBeGreaterThanOrEqual(1);
    expect(resumen.conError).toBe(0);
    await procesarHasta(monitoria.id);

    const despues = await correosA(e.lead.correo!);
    expect(despues).toHaveLength(antes + 1);
    const correo = despues.find((c) => c.Text.includes(token));
    expect(correo, "debía llegar la confirmación con el enlace de esta cita").toBeDefined();
    expect(correo!.Subject).toBe(`Tu monitoría de ${e.materia.nombre} está confirmada`);

    const texto = correo!.Text;
    expect(texto).toContain(`Hola, ${e.lead.nombre}.`);
    expect(texto).toContain("con Monitor de prueba quedó confirmada.");
    expect(texto).toContain(formatearFechaHora(inicioDe(monitoria.fecha)));
    expect(texto).toContain("Duración: 60 minutos.");
    expect(texto).toContain(`Materia: ${e.materia.nombre}.`);
    expect(texto).toContain("Modalidad: presencial.");
    expect(texto).toContain("Lugar: Salón de prueba.");
    expect(texto).toContain(`Valor: ${formatearPesos(PRECIO)}.`);
    // 12 h antes del inicio (RN-60), y la frase del pago (D-22).
    expect(texto).toContain(`Puedes cancelarla hasta el ${formatearFechaHora(new Date(inicioDe(monitoria.fecha).getTime() - 12 * HORA))}`);
    expect(texto).toContain("Recibimos tu comprobante. Un admin lo revisa y, si hay algún problema, te avisamos a este correo.");
    // El enlace de gestión, con el token de la base: en el texto, en el botón y en la copia del enlace.
    expect(texto).toContain(rutaDeCita(token));
    expect(correo!.HTML).toContain(`href="${new URL(rutaDeCita(token), process.env.SITIO_URL ?? "http://localhost:3000").href}"`);
    // P-37 y D-6: el nombre del monitor sí; su contacto, el contacto del Lead y la comisión, no.
    for (const privado of [e.monitor.correo, e.lead.correo, correoDelPago]) {
      expect(texto).not.toContain(privado);
      expect(correo!.HTML).not.toContain(privado);
    }
    expect(texto.toLowerCase()).not.toContain("comisi");
    expect(await correosA(correoDelPago)).toEqual([]);

    // El registro de correos lleva la clave `confirmacion_cita:<id>`.
    expect(await registroDe(monitoria.id)).toEqual({ estado: "enviado", destinatario: e.lead.correo, plantilla: "confirmacion_cita" });
    expect((await confirmacionDe(monitoria.id))!.procesado_en).not.toBeNull();

    // Otra corrida no lo manda otra vez.
    await procesarConfirmacionesDeCita({ cliente: fx.admin });
    expect(await correosA(e.lead.correo!)).toHaveLength(antes + 1);
  });

  it("una virtual lleva el enlace de la videollamada y no un lugar", async () => {
    // Los martes son de la franja virtual.
    const virtual = await fx.crearMonitoria({ ...e.contexto, franja: e.franjaVirtual }, { fecha: diaLejano(2, semana++), estado: "pendiente_pago" });
    monitorias.push(virtual.id);
    await cambiarEstado(virtual.id, "confirmada");
    const token = await tokenDe(virtual.id);
    await procesarHasta(virtual.id);

    const correo = (await correosA(e.lead.correo!)).find((c) => c.Text.includes(token));
    expect(correo, "debía llegar la confirmación de la virtual").toBeDefined();
    expect(correo!.Text).toContain("Modalidad: virtual.");
    expect(correo!.Text).toContain(`Enlace de la videollamada: ${ENLACE_VIRTUAL}`);
    expect(correo!.Text).not.toContain("Lugar:");
  });

  it("D-19: si el Lead no tiene correo, sale al contacto del primer pago; sin correo ni pago no hay a quién escribirle y se descarta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const leadSinCorreo = await fx.crearLead();
    exito(await fx.admin.from("lead").update({ correo: null, numero_telefono: "3001234567" }).eq("id", leadSinCorreo.id).select().single(), "dejar al Lead solo con teléfono");
    const contexto = { ...e.contexto, lead: { ...leadSinCorreo, correo: null } } as Contexto;
    const primero = `primer-pago-${randomBytes(6).toString("hex")}@calibra.test`;
    const segundo = `segundo-pago-${randomBytes(6).toString("hex")}@calibra.test`;

    const monitoria = await confirmada({ contexto });
    for (const contacto of [primero, segundo]) {
      const pago = await pagoDe(monitoria.id);
      exito(await fx.admin.from("pago").update({ contacto }).eq("id", pago.id).select().single(), "poner el contacto del pago");
    }
    const token = await tokenDe(monitoria.id);
    expect((await reconstruirConfirmacionCita(monitoria.id, fx.admin))?.destinatario).toBe(primero);

    await procesarHasta(monitoria.id);

    const delPrimero = await correosA(primero);
    expect(delPrimero).toHaveLength(1);
    expect(delPrimero[0].Text).toContain(rutaDeCita(token));
    expect(await correosA(segundo)).toEqual([]);
    expect(await registroDe(monitoria.id)).toEqual({ estado: "enviado", destinatario: primero, plantilla: "confirmacion_cita" });

    // Sin correo y sin pago: nadie a quien escribirle.
    const sinNadie = await confirmada({ contexto });
    expect(await reconstruirConfirmacionCita(sinNadie.id, fx.admin)).toBeNull();
    await procesarHasta(sinNadie.id);
    expect(await registroDe(sinNadie.id)).toBeNull();
    expect((await confirmacionDe(sinNadie.id))!.procesado_en).not.toBeNull();
  });

  it("dos corridas a la vez sobre la misma confirmación mandan un solo correo", async () => {
    const monitoria = await confirmada();
    const antes = (await correosA(e.lead.correo!)).length;

    await Promise.all([procesarConfirmacionesDeCita({ cliente: fx.admin }), procesarConfirmacionesDeCita({ cliente: fx.admin })]);
    await procesarHasta(monitoria.id);

    expect(await correosA(e.lead.correo!)).toHaveLength(antes + 1);
    expect((await registroDe(monitoria.id))?.estado).toBe("enviado");
  });
});

describe("la confirmación se descarta si la cita ya no vale", () => {
  it("si la cita ya se canceló (por ejemplo, el admin rechazó el pago), no sale el correo: se marca procesada y no queda registro", async () => {
    const monitoria = await confirmada();
    await cambiarEstado(monitoria.id, "cancelada", "pago_rechazado");
    const antes = (await correosA(e.lead.correo!)).length;

    expect(await reconstruirConfirmacionCita(monitoria.id, fx.admin)).toBeNull();
    const resumen = await procesarConfirmacionesDeCita({ cliente: fx.admin });
    await procesarHasta(monitoria.id);

    expect(resumen.descartadas).toBeGreaterThanOrEqual(1);
    expect(await correosA(e.lead.correo!)).toHaveLength(antes);
    expect(await registroDe(monitoria.id)).toBeNull();
    expect((await confirmacionDe(monitoria.id))!.procesado_en).not.toBeNull();
  });

  it("si la sesión ya empezó, el correo llegaría tarde: se descarta", async () => {
    const monitoria = await confirmada({ fecha: lunesPasado() });
    const antes = (await correosA(e.lead.correo!)).length;

    expect(await reconstruirConfirmacionCita(monitoria.id, fx.admin)).toBeNull();
    await procesarHasta(monitoria.id);

    expect(await correosA(e.lead.correo!)).toHaveLength(antes);
    expect(await registroDe(monitoria.id)).toBeNull();
  });
});

describe("el reintento (HU-065) reconstruye el correo desde la monitoría", () => {
  it("reconstruirConfirmacionCita da el destinatario y los datos del correo con el mismo enlace, siempre; el mapa de reconstructores lo usa", async () => {
    const monitoria = await confirmada();
    const token = await tokenDe(monitoria.id);

    const primera = await reconstruirConfirmacionCita(monitoria.id, fx.admin);

    expect(primera?.destinatario).toBe(e.lead.correo);
    expect(primera?.datos).toEqual({
      nombre: e.lead.nombre,
      nombreMonitor: "Monitor de prueba",
      materia: e.materia.nombre,
      inicio: inicioDe(monitoria.fecha).toISOString(),
      duracionMin: 60,
      presencial: true,
      valorTotal: PRECIO,
      lugar: "Salón de prueba",
      enlaceSesion: null,
      cancelableHasta: new Date(inicioDe(monitoria.fecha).getTime() - 12 * HORA).toISOString(),
      enlace: expect.stringContaining(rutaDeCita(token)),
    });
    // Determinismo: el reintento da el mismo cuerpo (si no, el proveedor respondería 409 por la misma clave).
    expect(await reconstruirConfirmacionCita(monitoria.id, fx.admin)).toEqual(primera);
    const reconstructor = RECONSTRUCTORES.confirmacion_cita;
    expect(typeof reconstructor).toBe("function");
    expect(await reconstructor?.(monitoria.id)).toEqual(primera);
  });

  it("es null si no hay confirmación anotada, si el id no es un uuid, si la cita se canceló, ya empezó o es grupal", async () => {
    // Sin confirmación anotada el reconstructor deja una advertencia en el registro; aquí se espera.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sinConfirmar = await pendiente();
    expect(await reconstruirConfirmacionCita(sinConfirmar.id, fx.admin)).toBeNull();
    expect(await reconstruirConfirmacionCita("no-es-un-uuid", fx.admin)).toBeNull();

    const cancelada = await confirmada();
    expect(await reconstruirConfirmacionCita(cancelada.id, fx.admin)).not.toBeNull();
    await cambiarEstado(cancelada.id, "cancelada", "estudiante");
    expect(await reconstruirConfirmacionCita(cancelada.id, fx.admin)).toBeNull();

    const empezada = await confirmada({ fecha: lunesPasado(2) });
    expect(await reconstruirConfirmacionCita(empezada.id, fx.admin)).toBeNull();

    // Una grupal con confirmación anotada (la base nunca la anota, pero el reconstructor no la manda aunque exista).
    const grupal = await confirmada();
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: grupal.id, cupos: 3, modalidad_pago: "unico", precio_por_persona: 10_000 }).select().single(),
      "insertar monitoria_grupal",
    );
    expect(await reconstruirConfirmacionCita(grupal.id, fx.admin)).toBeNull();
  });

  it("una cita agendada con menos de 12 horas (RN-37) sale sin plazo de cancelación: dice que no se podrá cancelar", async () => {
    // Una confirmada que empieza en unas 6 horas, de un monitor propio y en su propia franja.
    const monitorProximo = await fx.crearMonitor();
    await fx.crearCertificado({ idMonitor: monitorProximo.id, idMateria: e.materia.id, idAdmin: e.admin.id });
    const inicio = new Date(Math.floor((Date.now() + 6 * HORA) / 1000) * 1000);
    const fecha = diaDelNegocio(inicio);
    const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(inicio);
    const minutosDelDia = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
    const franja = await fx.crearFranja({
      idMonitor: monitorProximo.id,
      dia: diaIsoDeFecha(fecha),
      hora,
      duracionMin: Math.min(30, 24 * 60 - minutosDelDia),
    });
    const monitoria = await confirmada({ contexto: { ...e.contexto, monitor: monitorProximo, franja } as Contexto, fecha });

    const reconstruido = await reconstruirConfirmacionCita(monitoria.id, fx.admin);

    expect(reconstruido?.datos.cancelableHasta).toBeNull();
    const token = await tokenDe(monitoria.id);
    const antes = (await correosA(e.lead.correo!)).length;
    await procesarHasta(monitoria.id);
    const correo = (await correosA(e.lead.correo!)).find((c) => c.Text.includes(token));
    expect(await correosA(e.lead.correo!)).toHaveLength(antes + 1);
    expect(correo!.Text).toContain("No podrás cancelarla");
    expect(correo!.Text).not.toContain("Puedes cancelarla hasta");
  });

  it("con el proveedor caído el correo queda fallido, y el proceso de reintentos lo manda una sola vez con el mismo enlace", async () => {
    const monitoria = await confirmada();
    const token = await tokenDe(monitoria.id);
    const clave = claveDeCorreo("confirmacion_cita", monitoria.id);
    const antes = (await correosA(e.lead.correo!)).length;

    vi.stubEnv("MAILPIT_URL", "http://127.0.0.1:1");
    const caida = await procesarConfirmacionesDeCita({ cliente: fx.admin });
    vi.unstubAllEnvs();
    expect(caida.fallidas).toBeGreaterThanOrEqual(1);
    expect(exito(await fx.admin.from("correo_envio").select("estado, reintentable").eq("clave", clave).single(), "leer el registro")).toEqual({
      estado: "fallido",
      reintentable: true,
    });
    expect((await confirmacionDe(monitoria.id))!.procesado_en).not.toBeNull();
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
    expect(despues.find((c) => c.Text.includes(rutaDeCita(token)))).toBeDefined();
  }, 60_000);
});

describe("cuando no se puede procesar", () => {
  it("sin registro de correos la confirmación queda pendiente y suma un intento; al llegar al máximo se abandona", async () => {
    const monitoria = await confirmada();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sinRegistro = async () => ({ ok: false as const, motivo: "fallo_del_registro" as const, error: "sin conexión", intentos: 0 });
    const estado = async () => (await confirmacionDe(monitoria.id))!;

    const primera = await procesarConfirmacionesDeCita({ cliente: fx.admin, enviar: sinRegistro });
    expect(primera.conError).toBeGreaterThanOrEqual(1);
    expect(await estado()).toMatchObject({ intentos: 1, procesado_en: null });

    for (let i = 1; i < MAXIMO_DE_INTENTOS; i++) await procesarConfirmacionesDeCita({ cliente: fx.admin, enviar: sinRegistro });
    const final = await estado();
    expect(final.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(final.procesado_en).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Las puertas de la página
// ---------------------------------------------------------------------------------------------------------------

describe("criterios 2 y 3: leerCitaPorToken, la puerta del enlace del correo", () => {
  it("con el token del correo trae la cita: estado, monitor, materia, fecha, hora, duración, valor, lugar y los plazos; sin el id del Lead, contacto ni comisión", async () => {
    const monitoria = await confirmada();
    const token = await tokenDe(monitoria.id);

    const cita = await leerCitaPorToken(token);

    const inicio = inicioDe(monitoria.fecha);
    const fin = new Date(inicio.getTime() + HORA);
    expect(cita).toEqual({
      idMonitoria: monitoria.id,
      estado: "confirmada",
      motivoCancelacion: null,
      nombreMonitor: "Monitor de prueba",
      nombreMateria: e.materia.nombre,
      codigoMateria: e.materia.codigo,
      fecha: monitoria.fecha,
      hora: "10:00:00",
      duracionMin: 60,
      presencial: true,
      valorTotal: PRECIO,
      lugar: "Salón de prueba",
      enlace: null,
      inicio,
      finProgramado: fin,
      // RN-60: 12 h antes del inicio. RN-62 y RN-64: 24 h después del fin.
      cancelableHasta: new Date(inicio.getTime() - 12 * HORA),
      reporteHasta: new Date(fin.getTime() + 24 * HORA),
      estadoPago: "sin_pagar",
      estadoReembolso: null,
      estadoReporte: null,
    });
    const serializada = JSON.stringify(cita);
    for (const privado of [e.lead.id, e.lead.correo, e.monitor.id, e.monitor.correo, "comision", "id_lead", "idLead"]) {
      expect(serializada, String(privado)).not.toContain(privado);
    }
  });

  it("un token inventado, vacío o con forma inválida no trae nada: null, sin distinguir entre mal formado e inexistente", async () => {
    const inventado = randomBytes(32).toString("hex");
    expect(await leerCitaPorToken(inventado)).toBeNull();
    const real = await tokenDe((await confirmada()).id);
    // Casi el real: cambia un carácter, o llega en mayúsculas, con espacios o con algo más.
    const casiReal = `${real.slice(0, 63)}${real.endsWith("0") ? "1" : "0"}`;
    for (const malo of ["", "abc", "x".repeat(64), `${inventado}0`, casiReal, real.toUpperCase(), ` ${real}`, `${real} `, `${real}\n`, "' or 1=1 --", `${real}' or '1'='1`]) {
      expect(await leerCitaPorToken(malo), JSON.stringify(malo)).toBeNull();
    }
    // Y el real sí sirve (el control de la prueba).
    expect(await leerCitaPorToken(real)).not.toBeNull();
  });

  it("D-21: el lugar sale con la cita confirmada, aunque el pago siga en revisión; en una cancelada o realizada no sale ni lugar ni enlace", async () => {
    const monitoria = await confirmada();
    await pagoDe(monitoria.id, "en_revision");
    const token = await tokenDe(monitoria.id);
    expect(await leerCitaPorToken(token)).toMatchObject({ estado: "confirmada", estadoPago: "en_revision", lugar: "Salón de prueba", enlace: null });

    await cambiarEstado(monitoria.id, "cancelada", "pago_rechazado");
    expect(await leerCitaPorToken(token)).toMatchObject({ estado: "cancelada", motivoCancelacion: "pago_rechazado", lugar: null, enlace: null });

    const terminada = await confirmada();
    const tokenTerminada = await tokenDe(terminada.id);
    await cambiarEstado(terminada.id, "realizada");
    expect(await leerCitaPorToken(tokenTerminada)).toMatchObject({ estado: "realizada", lugar: null, enlace: null });
  });

  it("D-21: una virtual confirmada trae el enlace de la videollamada y no un lugar; cancelada, ninguno", async () => {
    const virtual = await fx.crearMonitoria({ ...e.contexto, franja: e.franjaVirtual }, { fecha: diaLejano(2, semana++), estado: "pendiente_pago" });
    monitorias.push(virtual.id);
    await cambiarEstado(virtual.id, "confirmada");
    const token = await tokenDe(virtual.id);

    expect(await leerCitaPorToken(token)).toMatchObject({ presencial: false, lugar: null, enlace: ENLACE_VIRTUAL });

    await cambiarEstado(virtual.id, "cancelada", "estudiante");
    expect(await leerCitaPorToken(token)).toMatchObject({ estado: "cancelada", lugar: null, enlace: null });
  });

  it("el estado del pago, del reembolso y del reporte llegan para las HUs que gestionan la cita (rechazado > en_revision > aprobado > sin_pagar)", async () => {
    const sinPago = await confirmada();
    expect((await leerCitaPorToken(await tokenDe(sinPago.id)))?.estadoPago).toBe("sin_pagar");

    const aprobado = await confirmada();
    await pagoDe(aprobado.id, "aprobado");
    expect((await leerCitaPorToken(await tokenDe(aprobado.id)))?.estadoPago).toBe("aprobado");

    const mezcla = await confirmada();
    await pagoDe(mezcla.id, "aprobado");
    await pagoDe(mezcla.id, "en_revision");
    expect((await leerCitaPorToken(await tokenDe(mezcla.id)))?.estadoPago).toBe("en_revision");

    const rechazado = await confirmada();
    await pagoDe(rechazado.id, "en_revision");
    await pagoDe(rechazado.id, "rechazado");
    expect((await leerCitaPorToken(await tokenDe(rechazado.id)))?.estadoPago).toBe("rechazado");

    // Cancelada con el pago aprobado: hay reembolso por pedir (RN-61). Y un reporte de inasistencia en revisión.
    const reembolsada = await confirmada();
    const pago = await pagoDe(reembolsada.id, "aprobado");
    await cambiarEstado(reembolsada.id, "cancelada", "estudiante");
    await fx.crearReembolso({ idPago: pago.id, idAdmin: e.admin.id, estado: "esperando_llave" });
    expect(await leerCitaPorToken(await tokenDe(reembolsada.id))).toMatchObject({ estadoPago: "aprobado", estadoReembolso: "esperando_llave", estadoReporte: null });

    const reportada = await confirmada();
    await pagoDe(reportada.id, "aprobado");
    await fx.crearReporte({ idMonitoria: reportada.id, idAdmin: e.admin.id, estado: "en_revision" });
    expect((await leerCitaPorToken(await tokenDe(reportada.id)))?.estadoReporte).toBe("en_revision");
  });
});

describe("criterio 4: leerMiCita y leerMisCitas con la sesión real, sin el enlace", () => {
  it("la sesión del Lead (la que agendó) abre su cita y es la misma que ve con el token; otra sesión, un monitor y un admin no ven nada", async () => {
    const monitoria = await confirmada({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    const token = await tokenDe(monitoria.id);
    const porToken = await leerCitaPorToken(token);

    const propia = await leerMiCita(ancla.cliente, monitoria.id);

    expect(propia).not.toBeNull();
    expect(propia).toEqual(porToken);
    expect(propia).toMatchObject({ estado: "confirmada", lugar: "Salón de prueba" });
    // Otra sesión anónima (sin Lead), el monitor de la cita y un admin: la cita no es suya.
    const admin = await fx.iniciarSesion(e.admin);
    for (const [quien, cliente] of [
      ["otra sesión", otra.cliente],
      ["el monitor", sesionMonitor],
      ["un admin", admin],
    ] as const) {
      expect(await leerMiCita(cliente, monitoria.id), quien).toBeNull();
    }
    // Un id que no existe o que no es un uuid: lo mismo que una ajena.
    expect(await leerMiCita(ancla.cliente, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await leerMiCita(ancla.cliente, "no-es-un-uuid")).toBeNull();
    // Sin sesión (anon): la base ni la ejecuta.
    await expect(leerMiCita(crearCliente(), monitoria.id)).rejects.toThrow(/No se pudo leer la cita/);
  });

  it("una cuenta de Estudiante abre las citas de su Lead desde su cuenta", async () => {
    const estudiante = await fx.crearEstudiante();
    const { id_lead: idLead } = exito(await fx.admin.from("estudiante").select("id_lead").eq("id", estudiante.id).single(), "leer el Lead del estudiante");
    const lead = exito(await fx.admin.from("lead").select("*").eq("id", idLead).single(), "leer el Lead");
    correos.add(lead.correo!);
    const monitoria = await confirmada({ contexto: { ...e.contexto, lead } as Contexto });
    const sesion = await fx.iniciarSesion(estudiante);

    expect((await leerMiCita(sesion, monitoria.id))?.idMonitoria).toBe(monitoria.id);
    expect((await leerMisCitas(sesion)).map((c) => c.idMonitoria)).toEqual([monitoria.id]);
    expect(await leerMiCita(ancla.cliente, monitoria.id)).toBeNull();
  });

  it("mis citas: las confirmadas, realizadas y canceladas de la sesión, de la más reciente a la más antigua; sin las por pagar ni las vencidas, sin las de otros y sin las grupales", async () => {
    // Un Lead propio de esta prueba, con su sesión: así la lista es exactamente lo que se crea aquí.
    const sesion = await fx.crearAnonimo();
    const lead = await fx.crearLeadDeSesion(sesion.id);
    correos.add(lead.correo!);
    const contexto = { ...e.contexto, lead } as Contexto;
    expect(await leerMisCitas(sesion.cliente)).toEqual([]);

    const proxima = await confirmada({ contexto, fecha: diaLejano(1, 40) });
    const intermedia = await confirmada({ contexto, fecha: diaLejano(1, 41) });
    const lejana = await confirmada({ contexto, fecha: diaLejano(1, 42) });
    await cambiarEstado(intermedia.id, "cancelada", "pago_rechazado");
    const realizada = await confirmada({ contexto, fecha: lunesPasado(3) });
    await cambiarEstado(realizada.id, "realizada");
    // Lo que no es una cita todavía: por pagar y vencida sin pago.
    await pendiente({ contexto, fecha: diaLejano(1, 43) });
    const vencida = await pendiente({ contexto, fecha: diaLejano(1, 44) });
    await cambiarEstado(vencida.id, "cancelada", "reserva_expirada");
    // Una grupal del mismo Lead.
    const grupal = await confirmada({ contexto, fecha: diaLejano(1, 45) });
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: grupal.id, cupos: 3, modalidad_pago: "unico", precio_por_persona: 10_000 }).select().single(),
      "insertar monitoria_grupal",
    );
    // Una de otro Lead.
    await confirmada({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto, fecha: diaLejano(1, 46) });

    const citas = await leerMisCitas(sesion.cliente);

    // Orden por inicio, de la más reciente a la más antigua.
    expect(citas.map((c) => c.idMonitoria)).toEqual([lejana.id, intermedia.id, proxima.id, realizada.id]);
    expect(citas.map((c) => c.estado)).toEqual(["confirmada", "cancelada", "confirmada", "realizada"]);
    // D-21: lugar solo en las confirmadas.
    expect(citas.map((c) => c.lugar)).toEqual(["Salón de prueba", null, "Salón de prueba", null]);
    // La grupal no se abre por la puerta de una sola cita.
    expect(await leerMiCita(sesion.cliente, grupal.id)).toBeNull();
    // Cada una es la misma que ve con su token.
    for (const cita of citas) expect(await leerMiCita(sesion.cliente, cita.idMonitoria)).toEqual(cita);

    // Una sesión sin Lead, un monitor y un admin no tienen citas.
    expect(await leerMisCitas(otra.cliente)).toEqual([]);
    expect(await leerMisCitas(sesionMonitor)).toEqual([]);
    // Sin sesión (anon): la base ni la ejecuta.
    await expect(leerMisCitas(crearCliente())).rejects.toThrow(/No se pudieron leer las citas/);
  });

  it("una reserva por pagar o vencida se puede abrir con leerMiCita (la página la manda a la reserva), pero sin lugar ni enlace", async () => {
    const porPagar = await pendiente({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    const vencida = await pendiente({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    await cambiarEstado(vencida.id, "cancelada", "reserva_expirada");

    expect(await leerMiCita(ancla.cliente, porPagar.id)).toMatchObject({ estado: "pendiente_pago", lugar: null, enlace: null });
    expect(await leerMiCita(ancla.cliente, vencida.id)).toMatchObject({ estado: "cancelada", motivoCancelacion: "reserva_expirada", lugar: null });
    // El token solo existe para las confirmadas.
    expect(await confirmacionDe(porPagar.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Permisos por rol
// ---------------------------------------------------------------------------------------------------------------

describe("permisos: la tabla y las funciones del enlace solo las toca quien debe", () => {
  it("anon no ejecuta ninguna función de la HU ni lee o escribe la tabla", async () => {
    const monitoria = await confirmada();
    const token = await tokenDe(monitoria.id);
    const anonimo = crearCliente();

    expect((await anonimo.rpc("cita_por_token", { p_token: token })).error).not.toBeNull();
    expect((await anonimo.rpc("datos_de_confirmacion_cita", { p_id_monitoria: monitoria.id })).error).not.toBeNull();
    expect((await anonimo.rpc("mi_cita", { p_id_monitoria: monitoria.id })).error).not.toBeNull();
    expect((await anonimo.rpc("mis_citas")).error).not.toBeNull();
    expect((await anonimo.from("confirmacion_cita").select("token")).error).not.toBeNull();
    expect((await anonimo.from("confirmacion_cita").insert({ id_monitoria: monitoria.id })).error).not.toBeNull();
  });

  it("un usuario con sesión (Lead, otra sesión, monitor) no lee confirmacion_cita ni llama las funciones del servidor; sí llama mi_cita y mis_citas", async () => {
    const monitoria = await confirmada({ contexto: { ...e.contexto, lead: leadDeAncla } as Contexto });
    const token = await tokenDe(monitoria.id);

    for (const [quien, cliente] of [
      ["el Lead", ancla.cliente],
      ["otra sesión", otra.cliente],
      ["el monitor", sesionMonitor],
    ] as const) {
      const lectura = await cliente.from("confirmacion_cita").select("token").eq("id_monitoria", monitoria.id);
      expect(lectura.error, `${quien}: leer la tabla`).not.toBeNull();
      expect(lectura.data, `${quien}: leer la tabla`).toBeNull();
      expect((await cliente.from("confirmacion_cita").insert({ id_monitoria: monitoria.id })).error, `${quien}: insertar`).not.toBeNull();
      expect((await cliente.from("confirmacion_cita").update({ procesado_en: new Date().toISOString() }).eq("id_monitoria", monitoria.id)).error, `${quien}: actualizar`).not.toBeNull();
      expect((await cliente.from("confirmacion_cita").delete().eq("id_monitoria", monitoria.id)).error, `${quien}: borrar`).not.toBeNull();
      expect((await cliente.rpc("cita_por_token", { p_token: token })).error, `${quien}: cita_por_token`).not.toBeNull();
      expect((await cliente.rpc("datos_de_confirmacion_cita", { p_id_monitoria: monitoria.id })).error, `${quien}: datos_de_confirmacion_cita`).not.toBeNull();
      expect((await cliente.rpc("mi_cita", { p_id_monitoria: monitoria.id })).error, `${quien}: mi_cita`).toBeNull();
      expect((await cliente.rpc("mis_citas")).error, `${quien}: mis_citas`).toBeNull();
    }
    // La confirmación sigue intacta.
    expect((await confirmacionDe(monitoria.id))!.token).toBe(token);
  });

  it("service_role lee la tabla y solo marca procesado_en e intentos: no inserta, no borra y no toca el token", async () => {
    const monitoria = await confirmada();
    const token = await tokenDe(monitoria.id);

    expect((await fx.admin.from("confirmacion_cita").select("token").eq("id_monitoria", monitoria.id)).data).toEqual([{ token }]);
    expect((await fx.admin.from("confirmacion_cita").update({ token: "0".repeat(64) }).eq("id_monitoria", monitoria.id)).error).not.toBeNull();
    expect((await fx.admin.from("confirmacion_cita").update({ id_monitoria: monitoria.id }).eq("id_monitoria", monitoria.id)).error).not.toBeNull();
    expect((await fx.admin.from("confirmacion_cita").insert({ id_monitoria: (await pendiente()).id })).error).not.toBeNull();
    expect((await fx.admin.from("confirmacion_cita").delete().eq("id_monitoria", monitoria.id)).error).not.toBeNull();
    expect((await fx.admin.from("confirmacion_cita").update({ intentos: 2 }).eq("id_monitoria", monitoria.id)).error).toBeNull();
    expect((await confirmacionDe(monitoria.id))).toMatchObject({ token, intentos: 2 });
    // mi_cita y mis_citas son de la sesión del Lead, no de la llave secreta.
    expect((await fx.admin.rpc("mi_cita", { p_id_monitoria: monitoria.id })).error).not.toBeNull();
    expect((await fx.admin.rpc("mis_citas")).error).not.toBeNull();
    // Y las del servidor sí.
    expect((await fx.admin.rpc("cita_por_token", { p_token: token })).data).toHaveLength(1);
    expect((await fx.admin.rpc("datos_de_confirmacion_cita", { p_id_monitoria: monitoria.id })).data).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// La ruta
// ---------------------------------------------------------------------------------------------------------------

describe("la ruta /api/procesos/confirmar-citas", () => {
  const SECRETO = randomBytes(32).toString("hex");
  const llamar = (encabezado?: string) =>
    POST(
      new Request("http://localhost:3000/api/procesos/confirmar-citas", {
        method: "POST",
        headers: encabezado === undefined ? {} : { authorization: encabezado },
        body: "{}",
      }),
    );

  it("sin el secreto del proceso programado, o con otro, responde 401 y no toca la base", async () => {
    const monitoria = await confirmada();
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("CRON_SECRETO", "");
    expect((await llamar(`Bearer ${SECRETO}`)).status).toBe(401);
    vi.stubEnv("CRON_SECRETO", SECRETO);
    for (const encabezado of [undefined, "", `Bearer ${"0".repeat(SECRETO.length)}`, SECRETO]) {
      const respuesta = await llamar(encabezado);
      expect(respuesta.status, String(encabezado)).toBe(401);
      expect(await respuesta.json()).toEqual({ error: "No autorizado." });
    }
    vi.unstubAllEnvs();
    // Nada se procesó.
    expect((await confirmacionDe(monitoria.id))!.procesado_en).toBeNull();
    expect(await registroDe(monitoria.id)).toBeNull();
  });

  it("con el secreto correcto procesa las confirmaciones, manda el correo y responde el resumen", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    const monitoria = await confirmada();
    const token = await tokenDe(monitoria.id);

    const respuesta = await llamar(`Bearer ${SECRETO}`);

    expect(respuesta.status).toBe(200);
    const resumen = await respuesta.json();
    expect(Object.keys(resumen).sort()).toEqual(["conError", "descartadas", "enviadas", "fallidas", "pospuestas", "revisadas", "tomadasPorOtro"]);
    expect(resumen.revisadas).toBe(
      resumen.enviadas + resumen.descartadas + resumen.fallidas + resumen.tomadasPorOtro + resumen.conError + resumen.pospuestas,
    );
    expect(resumen.enviadas).toBeGreaterThanOrEqual(1);
    await procesarHasta(monitoria.id);
    expect((await correosA(e.lead.correo!)).find((c) => c.Text.includes(rutaDeCita(token)))).toBeDefined();
  });
});
