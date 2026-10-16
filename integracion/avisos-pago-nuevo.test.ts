import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/procesos/avisar-pagos-nuevos/route";
import { procesarAvisosDePagoNuevo, reconstruirAvisoPagoNuevo, type DependenciasDeAvisosDePagoNuevo } from "@/lib/admin/avisos-pago-nuevo";
import { cargarBandeja } from "@/lib/admin/bandeja";
import type { PedidoDeAgendar } from "@/lib/agendar/reglas";
import { agendarMonitoria } from "@/lib/agendar/servidor";
import { subirComprobante } from "@/lib/comprobantes/almacenamiento";
import { revisarComprobanteDesdeServidor } from "@/lib/comprobantes/servidor";
import { MAXIMO_DE_INTENTOS } from "@/lib/correo/bandeja";
import { claveDeCorreo, enviarCorreo, type EntradaDeEnvio } from "@/lib/correo/enviar";
import { renderizar, type Plantilla } from "@/lib/correo/plantillas";
import { crearProveedorMailpit, type Proveedor } from "@/lib/correo/proveedor";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { crearRegistroDeEnvios } from "@/lib/correo/registro";
import { reintentarCorreosFallidos } from "@/lib/correo/reintentos";
import { enviarCorreoDesdeServidor, urlDelSitio } from "@/lib/correo/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { registrarPago } from "@/lib/pagos/servidor";
import { diaIsoDeFecha } from "@/lib/plazos/motor";
import { exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-034 contra el Supabase local y Mailpit: cuando llega un pago a revisión, la base anota en la misma transacción un
 * aviso por cada admin activo (`aviso_pago_nuevo`, con el responsable de ese momento como foto), y el procesador
 * (`procesarAvisosDePagoNuevo`, el mismo código de la ruta `/api/procesos/avisar-pagos-nuevos`) manda un correo
 * `aviso_admin_pago_nuevo` a cada uno por Mailpit. En local no hay configuración en Vault, así que la base no llama a la
 * app: la prueba llama el proceso.
 *
 * El trigger anota una fila por cada admin activo de la base compartida (los de la semilla y los que crean otras
 * pruebas), no solo por los de esta prueba, y el lote del procesador es de 10: el proceso se repite hasta que las filas
 * del pago de la prueba quedan procesadas, y la prueba mira solo esas filas (cada una cae en cascada con su pago). El
 * pagador de cada pago tiene un nombre único, que va en el asunto del correo: así la búsqueda en Mailpit y la limpieza
 * no tocan los correos de nadie más.
 *
 * Los pagos se insertan con la llave secreta y el admin de la prueba como responsable (`registrar_pago` elegiría al
 * primer admin activo de la base), salvo el primero, que paga de verdad por la API con la sesión de un Lead. Los fallos
 * del proveedor se simulan con un proveedor que no responde (temporal) o que dice «límite diario» (definitivo), sin
 * esperas entre intentos. El Auth local deja pocos inicios de sesión cada 5 minutos: este archivo inicia una sola vez
 * (el admin de la bandeja) y crea una sesión anónima (el Lead).
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MINUTO = 60_000;
const PRECIO = 32_000;
const MONTO = 25_000;

// La firma mínima de un PNG: la revisión del servidor mira los primeros bytes.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

const REMITENTE = "Calibra <no-responder@calibra.test>";
const SIN_PROVEEDOR = "http://127.0.0.1:1";
const NOMBRE_DE_PLANTILLA = "Aviso al admin: pago nuevo por revisar";

type Mensaje = { ID: string; Subject: string; Text: string; HTML: string; To: { Address: string }[] };
type Aviso = { id_admin: string; id_responsable: string; procesado_en: string | null; intentos: number };
type Enviar = DependenciasDeAvisosDePagoNuevo["enviar"];

let fx: Fixtures;
let cuentas: Fixtures;
let bd: pg.Client;
let mailpit: string;
/** Los dos admins activos del archivo: `uno` es el responsable de los pagos que inserta la prueba y tiene sesión. */
let uno: UsuarioPrueba;
let dos: UsuarioPrueba;
let sesionUno: Cliente;
/** Una sesión anónima, la del Lead que paga de verdad en la primera prueba. */
let anonimo: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
const SUFIJO = randomUUID().slice(0, 6);
const NOMBRE_UNO = `Admin Uno ${SUFIJO}`;
const NOMBRE_DOS = `Admin Dos ${SUFIJO}`;
/** Pagadores y claves de `correo_envio` de la prueba, y las monitorías que apartó el Lead: se borran al final de cada una. */
const pagadores: string[] = [];
const claves: string[] = [];
let apartadas: string[];

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  cuentas = new Fixtures();
  try {
    uno = await cuentas.crearAdmin();
    dos = await cuentas.crearAdmin();
    for (const [admin, nombre] of [[uno, NOMBRE_UNO], [dos, NOMBRE_DOS]] as const) {
      exito(await cuentas.admin.from("admin").update({ nombre }).eq("id", admin.id).select().single(), "nombrar al admin");
    }
    sesionUno = await cuentas.iniciarSesion(uno);
    anonimo = await cuentas.crearAnonimo();
  } catch (error) {
    await cuentas.limpiar();
    throw error;
  }
}, 60_000);

afterAll(async () => {
  await bd?.end();
  // Después de los pagos de cada prueba: pago.id_admin no cae en cascada.
  await cuentas?.limpiar();
});

beforeEach(() => {
  fx = new Fixtures();
  apartadas = [];
  // Nunca Resend ni Gmail (aunque quien corre las pruebas tenga la llave): el correo sale por Mailpit.
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("SMTP_CONTRASENA", "");
  vi.stubEnv("CORREO_REMITENTE", "");
  vi.stubEnv("MAILPIT_URL", mailpit);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // Un pago impide borrar su monitoría (llave foránea sin cascada): se anotan los del Lead antes de limpiar.
  for (const id of apartadas) {
    const filas = exito(await fx.admin.from("pago").select("id").eq("id_monitoria", id), "leer los pagos de la reserva");
    for (const fila of filas) fx.registrarPago(fila.id);
  }
  const propias = claves.splice(0);
  if (propias.length) await fx.admin.from("correo_envio").delete().in("clave", propias);
  for (const pagador of pagadores.splice(0)) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`subject:"${pagador}"`)}`, { method: "DELETE" });
  }
  await fx.limpiar();
});

// ---------------------------------------------------------------------------------------------------------------

const normalizar = (texto: string) => texto.replace(/\s+/g, " ").trim();

/** `AAAA-MM-DD` más `dias` días (aritmética de calendario, sin zona). */
function sumarDias(fecha: string, dias: number): string {
  const instante = new Date(`${fecha}T12:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

const claveDe = (idPago: string, idAdmin: string) => claveDeCorreo("aviso_admin_pago_nuevo", `${idPago}:${idAdmin}`);

/**
 * Un pago en revisión de `uno` (o del responsable que se diga) sobre una individual nueva, con un pagador de nombre único
 * y un contacto que no debe aparecer en ningún correo. Con `estado: "aprobado"` se inserta ya revisado; con `grupal`, en
 * una monitoría grupal. Anota las claves de los correos que se esperan para borrar las filas al final.
 */
async function pagoNuevo(datos: { responsable?: UsuarioPrueba; estado?: "en_revision" | "aprobado"; grupal?: boolean } = {}) {
  const contexto = await fx.crearContextoDeMonitoria(uno.id);
  const monitoria = await fx.crearMonitoria(contexto, { fecha: "2030-01-07" });
  if (datos.grupal) {
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: monitoria.id, cupos: 3, modalidad_pago: "unico", precio_por_persona: 10_000 }).select().single(),
      "insertar monitoria_grupal",
    );
  }
  const nombrePagador = `Pagador ${randomUUID().slice(0, 8)}`;
  pagadores.push(nombrePagador);
  const creado = await fx.crearPagoDe(monitoria.id, { idAdmin: (datos.responsable ?? uno).id, estado: datos.estado, nombrePagador, monto: MONTO });
  const contacto = `pagador-${randomUUID()}@calibra.test`;
  const pago = exito(await fx.admin.from("pago").update({ contacto }).eq("id", creado.id).select().single(), "poner el contacto del pago");
  for (const aviso of await avisosDe(pago.id)) claves.push(claveDe(pago.id, aviso.id_admin));
  return pago;
}

/** Las filas de la bandeja de salida de ese pago: solo las de esta prueba, aunque la base tenga otras. */
const avisosDe = async (idPago: string): Promise<Aviso[]> =>
  exito(
    await fx.admin.from("aviso_pago_nuevo").select("id_admin, id_responsable, procesado_en, intentos").eq("id_pago", idPago).order("id_admin"),
    "leer aviso_pago_nuevo",
  );

const idsDe = (avisos: Aviso[]) => avisos.map((a) => a.id_admin).sort();

/** Los admins que la base considera activos ahora (`privado.admin_activo`): sin baneo, o con uno ya vencido. */
async function adminsActivos(): Promise<string[]> {
  const todos = exito(await fx.admin.from("admin").select("id"), "leer los admins");
  const activos: string[] = [];
  for (const { id } of todos) {
    const { data, error } = await fx.admin.auth.admin.getUserById(id);
    if (error) throw new Error(`leer la cuenta del admin ${id}: ${error.message}`);
    const hasta = data.user?.banned_until;
    if (!hasta || new Date(hasta).getTime() <= Date.now()) activos.push(id);
  }
  return activos.sort();
}

/** Desactiva una cuenta como `desactivarCuenta` (100 años de baneo), sin reasignar nada: estos admins no tienen casos. */
async function desactivar(idAdmin: string) {
  const { error } = await fx.admin.auth.admin.updateUserById(idAdmin, { ban_duration: "876000h" });
  if (error) throw new Error(`desactivar al admin: ${error.message}`);
}

const registroDe = async (idPago: string, idAdmin: string) =>
  exito(
    await fx.admin.from("correo_envio").select("id, estado, destinatario, reintentable, intentos, plantilla").eq("clave", claveDe(idPago, idAdmin)),
    "leer correo_envio",
  );

/** Nombre y correo de los admins del aviso, por id. */
async function admins(ids: string[]) {
  const filas = exito(await fx.admin.from("admin").select("id, nombre, correo").in("id", ids), "leer los admins");
  return new Map(filas.map((a) => [a.id, a]));
}

/** Los correos que hay en Mailpit para un admin sobre el pago de ese pagador, con su contenido. */
async function mensajesPara(correo: string, pagador: string): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}" subject:"${pagador}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

/** Corre el procesador hasta que todas las filas de ese pago quedan procesadas (puede haber otras pendientes en la base). */
async function procesarHasta(idPago: string, enviar?: Enviar) {
  for (let i = 0; i < 10; i++) {
    await procesarAvisosDePagoNuevo({ cliente: fx.admin, ...(enviar ? { enviar } : {}) });
    if ((await avisosDe(idPago)).every((a) => a.procesado_en !== null)) return;
  }
  throw new Error(`Los avisos del pago ${idPago} no se procesaron tras 10 corridas.`);
}

/** Manda por `proveedor` solo los correos de este pago (la clave de la entidad empieza por su id) y el resto, por Mailpit. */
const soloDeEstePago = (idPago: string, proveedor: Proveedor): Enviar =>
  (<P extends Plantilla>(entrada: EntradaDeEnvio<P>) =>
    entrada.entidad.startsWith(`${idPago}:`)
      ? enviarCorreo({ registro: crearRegistroDeEnvios(fx.admin), proveedor: { ok: true, proveedor }, esperar: async () => undefined }, entrada)
      : enviarCorreoDesdeServidor(entrada)) as Enviar;

/** Un proveedor caído: no responde. El fallo es temporal y HU-065 lo reintenta. */
const proveedorCaido = () => crearProveedorMailpit({ url: SIN_PROVEEDOR, remitente: REMITENTE });
/** Un proveedor que rechaza para siempre, como el límite diario de Gmail (550): el fallo es definitivo. */
const proveedorSinCupo: Proveedor = { nombre: "gmail", enviar: async () => ({ ok: false, reintentable: false, error: "Gmail 550 límite diario de envíos" }) };

/** El reintento toma los fallidos que llevan 2 minutos quietos: se corre con un "ahora" 3 minutos adelante. */
const reintentar = () =>
  reintentarCorreosFallidos({ cliente: fx.admin, reconstructores: RECONSTRUCTORES, enviar: enviarCorreoDesdeServidor, ahora: new Date(Date.now() + 3 * MINUTO) });

/** Reintenta hasta que todos los correos de esas filas salen (el lote es de 10 y la base puede tener otros fallidos). */
async function reintentarHasta(idPago: string, avisos: Aviso[]) {
  for (let i = 0; i < 10; i++) {
    await reintentar();
    const registros = await Promise.all(avisos.map((a) => registroDe(idPago, a.id_admin)));
    if (registros.every(([r]) => r?.estado === "enviado")) return;
  }
  throw new Error(`Los correos del pago ${idPago} no salieron tras 10 corridas de reintentos.`);
}

/** Lo que debe decir el correo: lo arma la plantilla con los datos del pago, igual que al enviarlo. */
function correoEsperado(pago: { id: string; nombre_pagador: string }, destinatario: { nombre: string }, responsable: { nombre: string } | null) {
  return renderizar("aviso_admin_pago_nuevo", {
    nombreAdmin: destinatario.nombre,
    nombrePagador: pago.nombre_pagador,
    monto: MONTO,
    nombreResponsable: responsable && responsable.nombre,
    enlace: urlDelSitio(`/admin/pagos/${pago.id}`),
  });
}

/**
 * Confirma un correo del aviso: asunto, texto igual al de la plantilla (el correo viaja con CRLF: mismo contenido), el
 * nombre del admin, el monto, «Te toca a ti» o «Le toca a …», el enlace al pago, y nada del contacto del pagador, del
 * comprobante ni de comisiones.
 */
function expectAviso(
  mensaje: Mensaje,
  pago: { id: string; nombre_pagador: string; contacto: string; comprobante: string },
  destinatario: { nombre: string; correo: string },
  responsable: { nombre: string } | null,
) {
  const esperado = correoEsperado(pago, destinatario, responsable);
  expect(mensaje.To.map((t) => t.Address)).toEqual([destinatario.correo]);
  expect(mensaje.Subject).toBe(`Pago nuevo por revisar: ${pago.nombre_pagador}`);
  expect(mensaje.Subject).toBe(esperado.asunto);
  expect(normalizar(mensaje.Text)).toBe(normalizar(esperado.texto));
  const texto = normalizar(mensaje.Text);
  expect(texto).toContain(`Hola, ${destinatario.nombre}`);
  expect(texto).toContain(`${pago.nombre_pagador} pagó`);
  expect(texto).toMatch(/\$\s?25\.000/);
  if (responsable === null) {
    expect(texto).toContain("Te toca a ti");
    expect(texto).not.toContain("Le toca a");
  } else {
    expect(texto).toContain(`Le toca a ${responsable.nombre}`);
    expect(texto).not.toContain("Te toca a ti");
  }
  expect(mensaje.Text).toContain(`/admin/pagos/${pago.id}`);
  expect(mensaje.HTML).toContain(`/admin/pagos/${pago.id}`);
  for (const privado of [pago.contacto, pago.comprobante]) {
    expect(mensaje.Text).not.toContain(privado);
    expect(mensaje.HTML).not.toContain(privado);
  }
  expect(mensaje.Text.toLowerCase()).not.toContain("comisi");
  expect(mensaje.HTML.toLowerCase()).not.toContain("comisi");
}

// ---------------------------------------------------------------------------------------------------------------
// Criterio 4: la base anota un aviso por cada admin activo

describe("criterio 4: al llegar un pago a revisión la base anota un aviso por cada admin activo", () => {
  const hoy = () => diaDelNegocio(new Date());

  /** Un monitor certificado con una franja que cae dentro de 2 días a las 10:00 a $ 32.000, y el pedido para apartarla. */
  async function escenario() {
    const certificador = await fx.crearAdmin();
    const materia = await fx.crearMateria();
    const monitor = await fx.crearMonitor();
    await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: certificador.id });
    const primera = sumarDias(hoy(), 2);
    const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: diaIsoDeFecha(primera), hora: "10:00", precio: PRECIO, abiertaDesde: hoy() });
    return { pedido: (): PedidoDeAgendar => ({ idFranja: franja.id, fecha: primera, codigoMateria: materia.codigo }) };
  }

  it("registrar_pago por la API, con la sesión del Lead, deja una fila por cada admin activo (el responsable incluido), con el responsable de ese momento como foto, sin procesar y sin ningún correo todavía", async () => {
    const e = await escenario();
    const lead = await fx.crearLeadDeSesion(anonimo.id);
    // La cuota de subidas es por sesión y la cuentan las subidas, no los archivos.
    await bd.query("delete from privado.subida_comprobante where carpeta = $1", [anonimo.id]);
    const reserva = await agendarMonitoria(anonimo.cliente, e.pedido(), false);
    expect(reserva.resultado, "apartar la fecha").toBe("agendada");
    fx.registrarMonitoria(reserva.idMonitoria!);
    apartadas.push(reserva.idMonitoria!);
    const subida = await subirComprobante(anonimo.cliente, anonimo.id, new File([PNG as BlobPart], "transferencia.png", { type: "image/png" }));
    if (!subida.ok) throw new Error(`no se pudo subir el comprobante: ${subida.mensaje}`);
    fx.registrarComprobante(subida.ruta);
    expect(await revisarComprobanteDesdeServidor(subida.ruta), "revisar el comprobante").toEqual({ ok: true, tipo: "image/png" });

    const registro = await registrarPago(anonimo.cliente, {
      idMonitoria: reserva.idMonitoria!,
      ruta: subida.ruta,
      nombre: "Ana Pérez",
      correo: lead.correo ?? "ana.perez@uniandes.edu.co",
    });
    expect(registro).toEqual({ resultado: "registrado", idPago: expect.any(String) });
    fx.registrarPago(registro.idPago!);

    const pago = exito(await fx.admin.from("pago").select("id, id_admin, estado").eq("id", registro.idPago!).single(), "leer el pago");
    expect(pago.estado).toBe("en_revision");
    const avisos = await avisosDe(pago.id);
    // Uno por cada admin activo de la base compartida (la semilla, los de otras pruebas y los de esta), el responsable incluido.
    expect(idsDe(avisos)).toEqual(await adminsActivos());
    expect(idsDe(avisos)).toContain(pago.id_admin);
    expect(idsDe(avisos)).toContain(uno.id);
    expect(idsDe(avisos)).toContain(dos.id);
    // Cada uno guarda quién era el responsable al llegar el pago.
    expect(avisos.every((a) => a.id_responsable === pago.id_admin)).toBe(true);
    expect(avisos.every((a) => a.procesado_en === null && a.intentos === 0)).toBe(true);
    // Nada salió todavía: la base solo anota.
    for (const aviso of avisos) {
      claves.push(claveDe(pago.id, aviso.id_admin));
      expect(await registroDe(pago.id, aviso.id_admin)).toEqual([]);
    }
  }, 60_000);

  it("un admin desactivado no tiene aviso; un pago que se inserta ya aprobado no avisa, ni el de una grupal", async () => {
    const desactivado = await fx.crearAdmin();
    const activo = await fx.crearAdmin();
    await desactivar(desactivado.id);

    const pago = await pagoNuevo();
    const avisos = await avisosDe(pago.id);
    expect(idsDe(avisos)).toEqual(await adminsActivos());
    expect(idsDe(avisos)).toEqual(expect.arrayContaining([uno.id, dos.id, activo.id]));
    expect(idsDe(avisos)).not.toContain(desactivado.id);
    expect(avisos.every((a) => a.id_responsable === uno.id)).toBe(true);

    expect(await avisosDe((await pagoNuevo({ estado: "aprobado" })).id)).toEqual([]);
    expect(await avisosDe((await pagoNuevo({ grupal: true })).id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 5: el procesador manda el correo

describe("criterio 5: el procesador manda un correo a cada admin activo", () => {
  it("un correo por admin, a su admin.correo y con su nombre: «Te toca a ti» al responsable y «Le toca a …» a los demás, con el enlace al pago y sin contacto, comprobante ni comisión; el desactivado no recibe y repetir la corrida no repite nada", async () => {
    const desactivado = await fx.crearAdmin();
    const otro = await fx.crearAdmin();
    exito(await fx.admin.from("admin").update({ nombre: `Admin Otro ${SUFIJO}` }).eq("id", otro.id).select().single(), "nombrar al otro admin");
    await desactivar(desactivado.id);
    const pago = await pagoNuevo();
    const avisos = await avisosDe(pago.id);
    expect(idsDe(avisos)).toEqual(await adminsActivos());
    expect(idsDe(avisos)).not.toContain(desactivado.id);
    const nombres = await admins([...idsDe(avisos), desactivado.id]);
    const responsable = nombres.get(uno.id)!;
    expect(responsable.nombre).toBe(NOMBRE_UNO);

    await procesarHasta(pago.id);

    // Cada fila quedó procesada y tiene su correo en el registro, enviado a su admin.correo con la plantilla del aviso.
    for (const aviso of await avisosDe(pago.id)) {
      const destinatario = nombres.get(aviso.id_admin)!;
      expect(aviso.procesado_en, destinatario.correo).not.toBeNull();
      expect(await registroDe(pago.id, aviso.id_admin), destinatario.correo).toEqual([
        expect.objectContaining({ estado: "enviado", destinatario: destinatario.correo, plantilla: "aviso_admin_pago_nuevo", intentos: 1 }),
      ]);
    }
    // Los admins de la prueba, uno por uno: el contenido exacto.
    const alResponsable = await mensajesPara(uno.correo, pago.nombre_pagador);
    expect(alResponsable).toHaveLength(1);
    expectAviso(alResponsable[0], pago, nombres.get(uno.id)!, null);
    for (const otroAdmin of [dos, otro]) {
      const mensajes = await mensajesPara(otroAdmin.correo, pago.nombre_pagador);
      expect(mensajes, otroAdmin.correo).toHaveLength(1);
      expectAviso(mensajes[0], pago, nombres.get(otroAdmin.id)!, responsable);
    }
    // El desactivado no tiene aviso, ni correo registrado ni mensaje.
    expect(await registroDe(pago.id, desactivado.id)).toEqual([]);
    expect(await mensajesPara(desactivado.correo, pago.nombre_pagador)).toEqual([]);

    // El mismo aviso procesado dos veces no manda otro correo.
    await procesarAvisosDePagoNuevo({ cliente: fx.admin });
    await procesarAvisosDePagoNuevo({ cliente: fx.admin });
    for (const admin of [uno, dos, otro]) expect(await mensajesPara(admin.correo, pago.nombre_pagador), admin.correo).toHaveLength(1);
  }, 60_000);

  it("un pago que ya se aprobó antes de procesar el aviso se descarta: ningún admin recibe correo y los avisos quedan procesados", async () => {
    const pago = await pagoNuevo();
    const avisos = await avisosDe(pago.id);
    expect(avisos.length).toBeGreaterThanOrEqual(2);
    // Lo revisó otro admin antes de que corriera el proceso.
    exito(
      await fx.admin.from("pago").update({ estado: "aprobado", fecha_revision: new Date().toISOString(), id_admin_revisor: dos.id }).eq("id", pago.id).select().single(),
      "aprobar el pago",
    );

    await procesarHasta(pago.id);

    for (const aviso of await avisosDe(pago.id)) {
      expect(aviso.procesado_en).not.toBeNull();
      expect(await registroDe(pago.id, aviso.id_admin)).toEqual([]);
    }
    for (const admin of [uno, dos]) expect(await mensajesPara(admin.correo, pago.nombre_pagador), admin.correo).toEqual([]);
  }, 60_000);

  it("un admin que se desactivó después de anotado el aviso se descarta (Auth lo tiene baneado), y los demás reciben el suyo", async () => {
    const baneado = await fx.crearAdmin();
    const pago = await pagoNuevo();
    expect(idsDe(await avisosDe(pago.id))).toContain(baneado.id);
    // La desactivación llega después: el aviso ya estaba anotado.
    await desactivar(baneado.id);

    await procesarHasta(pago.id);

    const delBaneado = (await avisosDe(pago.id)).find((a) => a.id_admin === baneado.id);
    expect(delBaneado?.procesado_en).not.toBeNull();
    expect(await registroDe(pago.id, baneado.id)).toEqual([]);
    expect(await mensajesPara(baneado.correo, pago.nombre_pagador)).toEqual([]);
    for (const admin of [uno, dos]) expect(await mensajesPara(admin.correo, pago.nombre_pagador), admin.correo).toHaveLength(1);
  }, 60_000);

  it("dos corridas a la vez sobre los mismos avisos mandan un solo correo por admin", async () => {
    const pago = await pagoNuevo();

    await Promise.all([procesarAvisosDePagoNuevo({ cliente: fx.admin }), procesarAvisosDePagoNuevo({ cliente: fx.admin })]);
    // Si una corrida se topó con la otra, el aviso queda para la siguiente.
    await procesarHasta(pago.id);

    for (const admin of [uno, dos]) {
      expect(await mensajesPara(admin.correo, pago.nombre_pagador), admin.correo).toHaveLength(1);
      expect(await registroDe(pago.id, admin.id), admin.correo).toHaveLength(1);
    }
    for (const aviso of await avisosDe(pago.id)) expect(await registroDe(pago.id, aviso.id_admin)).toHaveLength(1);
  }, 60_000);

  it("el reconstructor da null cuando el aviso ya no aplica: entidad que no es <id_pago>:<id_admin>, pago que no existe, admin sin aviso y pago aprobado", async () => {
    const pago = await pagoNuevo();
    const reconstruir = RECONSTRUCTORES.aviso_admin_pago_nuevo;
    if (!reconstruir) throw new Error("aviso_admin_pago_nuevo no tiene reconstructor.");
    // Un admin que llegó después del pago: no tiene aviso.
    const fuera = await fx.crearAdmin();

    expect(await reconstruir(`${pago.id}:${uno.id}`)).toMatchObject({ destinatario: uno.correo });
    expect(await reconstruirAvisoPagoNuevo(`${pago.id}:${uno.id}`, fx.admin)).toMatchObject({ destinatario: uno.correo });
    for (const entidad of [pago.id, "no-es-una-entidad", `${randomUUID()}:${uno.id}`, `${pago.id}:${randomUUID()}`, `${pago.id}:${fuera.id}`]) {
      expect(await reconstruirAvisoPagoNuevo(entidad, fx.admin), entidad).toBeNull();
    }
    exito(await fx.admin.from("pago").update({ estado: "aprobado", fecha_revision: new Date().toISOString() }).eq("id", pago.id).select().single(), "aprobar el pago");
    expect(await reconstruirAvisoPagoNuevo(`${pago.id}:${uno.id}`, fx.admin)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 6: si el envío falla

describe("criterio 6: si el envío falla", () => {
  it("con el proveedor caído los correos quedan fallidos para reintentar y los avisos procesados; HU-065 los manda después, sobre la misma fila y una sola vez", async () => {
    // Los fallos esperados (proveedor caído) se anotan en la consola; aquí no ensucian la salida.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pago = await pagoNuevo();
    const avisos = await avisosDe(pago.id);
    const nombres = await admins(idsDe(avisos));

    await procesarHasta(pago.id, soloDeEstePago(pago.id, proveedorCaido()));

    // Ya procesados (el registro tiene el fallido) y sin mensajes en el buzón.
    const fallidos = new Map<string, { id: string; intentos: number }>();
    for (const aviso of await avisosDe(pago.id)) {
      expect(aviso.procesado_en).not.toBeNull();
      const [fallido] = await registroDe(pago.id, aviso.id_admin);
      expect(fallido, nombres.get(aviso.id_admin)?.correo).toMatchObject({ estado: "fallido", reintentable: true, plantilla: "aviso_admin_pago_nuevo" });
      fallidos.set(aviso.id_admin, fallido);
    }
    for (const admin of [uno, dos]) expect(await mensajesPara(admin.correo, pago.nombre_pagador)).toEqual([]);

    await reintentarHasta(pago.id, avisos);

    // La misma fila: el reintento suma un intento a los que ya llevaba, y el correo es el del primer envío.
    for (const aviso of avisos) {
      const [enviado] = await registroDe(pago.id, aviso.id_admin);
      expect(enviado).toMatchObject({ id: fallidos.get(aviso.id_admin)!.id, estado: "enviado", intentos: fallidos.get(aviso.id_admin)!.intentos + 1 });
    }
    const alResponsable = await mensajesPara(uno.correo, pago.nombre_pagador);
    expect(alResponsable).toHaveLength(1);
    expectAviso(alResponsable[0], pago, nombres.get(uno.id)!, null);
    const alOtro = await mensajesPara(dos.correo, pago.nombre_pagador);
    expect(alOtro).toHaveLength(1);
    expectAviso(alOtro[0], pago, nombres.get(dos.id)!, nombres.get(uno.id)!);

    // Otra corrida de reintentos no los manda otra vez.
    await reintentar();
    for (const admin of [uno, dos]) expect(await mensajesPara(admin.correo, pago.nombre_pagador), admin.correo).toHaveLength(1);
  }, 60_000);

  it("un fallo definitivo (el límite diario de Gmail) deja el correo fallido sin reintento, no se vuelve a mandar y el admin lo ve en «Correos que no salieron» de su bandeja", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pago = await pagoNuevo();
    const avisos = await avisosDe(pago.id);

    await procesarHasta(pago.id, soloDeEstePago(pago.id, proveedorSinCupo));

    const antes = new Map<string, { id: string; intentos: number }>();
    for (const aviso of await avisosDe(pago.id)) {
      expect(aviso.procesado_en).not.toBeNull();
      const [fallido] = await registroDe(pago.id, aviso.id_admin);
      expect(fallido).toMatchObject({ estado: "fallido", reintentable: false, plantilla: "aviso_admin_pago_nuevo" });
      antes.set(aviso.id_admin, fallido);
    }

    // HU-065 no lo toca: sigue fallido, con los mismos intentos, y nada llega al buzón.
    await reintentar();
    await reintentar();
    for (const aviso of avisos) {
      const [despues] = await registroDe(pago.id, aviso.id_admin);
      expect(despues).toMatchObject({ id: antes.get(aviso.id_admin)!.id, estado: "fallido", reintentable: false, intentos: antes.get(aviso.id_admin)!.intentos });
    }
    for (const admin of [uno, dos]) expect(await mensajesPara(admin.correo, pago.nombre_pagador)).toEqual([]);

    // El admin lo ve en su bandeja, con el nombre legible de la plantilla y a quién iba.
    const bandeja = await cargarBandeja(sesionUno, uno.id, new Date(), { maxFilas: 1_000 });
    for (const admin of [uno, dos]) {
      const [registro] = await registroDe(pago.id, admin.id);
      expect(bandeja.correosSinEnviar.find((c) => c.id === registro.id), admin.correo).toMatchObject({
        tipo: NOMBRE_DE_PLANTILLA,
        destinatario: admin.correo,
      });
    }
  }, 60_000);

  it("si reasignan el pago entre el primer envío y el reintento (HU-074), el reintento da el mismo correo: a quién le tocaba al llegar es una foto", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pago = await pagoNuevo();
    const avisos = await avisosDe(pago.id);
    const nombres = await admins(idsDe(avisos));
    expect(avisos.every((a) => a.id_responsable === uno.id)).toBe(true);
    const entidad = `${pago.id}:${dos.id}`;
    const alLlegar = await reconstruirAvisoPagoNuevo(entidad, fx.admin);
    expect(alLlegar?.datos).toMatchObject({ nombreAdmin: NOMBRE_DOS, nombreResponsable: NOMBRE_UNO });

    await procesarHasta(pago.id, soloDeEstePago(pago.id, proveedorCaido()));
    for (const aviso of avisos) expect((await registroDe(pago.id, aviso.id_admin))[0]).toMatchObject({ estado: "fallido", reintentable: true });

    // Mientras tanto el pago pasa a otro responsable, como al desactivar a `uno`.
    exito(await fx.admin.from("pago").update({ id_admin: dos.id }).eq("id", pago.id).select().single(), "reasignar el pago");
    expect((await avisosDe(pago.id)).every((a) => a.id_responsable === uno.id)).toBe(true);
    expect(await reconstruirAvisoPagoNuevo(entidad, fx.admin)).toEqual(alLlegar);

    await reintentarHasta(pago.id, avisos);

    // `uno` sigue leyendo «Te toca a ti» y `dos` «Le toca a Uno», aunque ahora el pago sea de `dos`.
    const alPrimero = await mensajesPara(uno.correo, pago.nombre_pagador);
    expect(alPrimero).toHaveLength(1);
    expectAviso(alPrimero[0], pago, nombres.get(uno.id)!, null);
    const alSegundo = await mensajesPara(dos.correo, pago.nombre_pagador);
    expect(alSegundo).toHaveLength(1);
    expectAviso(alSegundo[0], pago, nombres.get(dos.id)!, nombres.get(uno.id)!);
  }, 60_000);

  it("sin registro de correos el aviso queda pendiente y suma un intento; al llegar al máximo se abandona", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pago = await pagoNuevo();
    const sinRegistro = async () => ({ ok: false as const, motivo: "fallo_del_registro" as const, error: "sin conexión", intentos: 0 });
    // Solo el pago de esta prueba falla; los avisos de otros pagos que haya en la base salen por Mailpit y no se miran.
    const enviar = (<P extends Plantilla>(entrada: EntradaDeEnvio<P>) =>
      entrada.entidad.startsWith(`${pago.id}:`) ? sinRegistro() : enviarCorreoDesdeServidor(entrada)) as Enviar;
    const delPago = async () => ({ ...(await avisosDe(pago.id))[0] });

    const primera = await procesarAvisosDePagoNuevo({ cliente: fx.admin, enviar });
    expect(primera.conError).toBeGreaterThanOrEqual(1);
    expect(await delPago()).toMatchObject({ intentos: 1, procesado_en: null });

    for (let i = 1; i < MAXIMO_DE_INTENTOS; i++) await procesarAvisosDePagoNuevo({ cliente: fx.admin, enviar });
    const final = await delPago();
    expect(final.intentos).toBe(MAXIMO_DE_INTENTOS);
    expect(final.procesado_en).not.toBeNull();
    expect(await mensajesPara(uno.correo, pago.nombre_pagador)).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------

describe("la ruta /api/procesos/avisar-pagos-nuevos", () => {
  const SECRETO = randomBytes(32).toString("hex");
  const llamar = (encabezado?: string) =>
    POST(
      new Request("http://localhost:3000/api/procesos/avisar-pagos-nuevos", {
        method: "POST",
        headers: encabezado === undefined ? {} : { authorization: encabezado },
        body: "{}",
      }),
    );

  it("sin el secreto del proceso programado, o con otro, responde 401 y no toca la base", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("CRON_SECRETO", "");
    expect((await llamar(`Bearer ${SECRETO}`)).status).toBe(401);
    vi.stubEnv("CRON_SECRETO", SECRETO);
    for (const encabezado of [undefined, "", `Bearer ${"0".repeat(SECRETO.length)}`, SECRETO]) {
      const respuesta = await llamar(encabezado);
      expect(respuesta.status, String(encabezado)).toBe(401);
      expect(await respuesta.json()).toEqual({ error: "No autorizado." });
    }
  });

  it("con el secreto correcto procesa los avisos y responde el resumen", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    const pago = await pagoNuevo();

    const respuesta = await llamar(`Bearer ${SECRETO}`);

    expect(respuesta.status).toBe(200);
    const resumen = await respuesta.json();
    expect(Object.keys(resumen).sort()).toEqual(["conError", "descartadas", "enviadas", "fallidas", "pospuestas", "revisadas", "tomadasPorOtro"]);
    expect(resumen.revisadas).toBe(resumen.enviadas + resumen.descartadas + resumen.fallidas + resumen.tomadasPorOtro + resumen.conError + resumen.pospuestas);
    // El lote es de 10 y pueden quedar avisos de otras pruebas: se completa hasta que los de esta quedan procesados.
    await procesarHasta(pago.id);
    for (const admin of [uno, dos]) expect(await mensajesPara(admin.correo, pago.nombre_pagador), admin.correo).toHaveLength(1);
  }, 60_000);
});
