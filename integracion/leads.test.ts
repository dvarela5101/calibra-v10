import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claveDeCorreo } from "@/lib/correo/enviar";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { enviarCorreoDesdeServidor } from "@/lib/correo/servidor";
import { leerContacto } from "@/lib/leads/reglas";
import {
  confirmarCorreo,
  leadDeLaSesion,
  reconstruirVerificacion,
  registrarContacto,
  verificacionVigente,
  type EntradaDeContacto,
} from "@/lib/leads/servidor";
import { HORAS_DE_VIGENCIA, MAXIMO_DE_ENLACES_POR_HORA } from "@/lib/leads/verificacion";
import { CASILLA_CONTACTO, CASILLA_TRATAMIENTO, leerConsentimiento, MARCADA } from "@/lib/privacidad/consentimiento";
import { exigirSupabaseLocal, exito, Fixtures, idsVisibles } from "./utilidades";

// HU-068 contra el Supabase LOCAL: el Lead se crea de verdad con `registrar_lead`, el enlace de verificación sale por
// Mailpit y la sesión se liga con `confirmar_correo_de_lead`. Las sesiones son anónimas de verdad y las lecturas se
// hacen con su propio JWT, así que las políticas (`privado.es_mi_lead`) también se prueban.
//
// El Auth local deja crear 30 sesiones anónimas por hora por IP (`[auth.rate_limit]` de supabase/config.toml) y el resto
// de la suite ya usa unas veinte: por eso aquí se crean tres una sola vez y cada prueba borra lo que dejó (Leads,
// enlaces, sesiones ligadas, registro de correos y buzón) antes de la siguiente.

type Sesion = Awaited<ReturnType<Fixtures["crearAnonimo"]>>;

let fx: Fixtures;
let sesiones: Fixtures;
let mailpit: string;
/** La sesión que crea el Lead. */
let duena: Sesion;
/** Otra sesión (otro navegador) que escribe el correo de ese Lead. */
let otra: Sesion;
/** Una tercera que no confirma nada. */
let tercera: Sesion;
/** Los correos de esta prueba: Lead y destinatarios del buzón y del registro de envíos. */
const correos: string[] = [];

const MINUTO = 60_000;
const HORA = 3_600_000;
const DIA = 86_400_000;
const hace = (milisegundos: number) => new Date(Date.now() - milisegundos).toISOString();
const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  sesiones = new Fixtures();
  try {
    duena = await sesiones.crearAnonimo();
    otra = await sesiones.crearAnonimo();
    tercera = await sesiones.crearAnonimo();
  } catch (error) {
    await sesiones.limpiar();
    throw error;
  }
});

afterAll(async () => {
  if (!sesiones) return;
  const errores: string[] = [];
  // Por si una prueba se cortó antes de limpiar: al borrar la sesión, su Lead quedaría huérfano.
  await borrarLeadsDeLaPrueba(errores);
  await sesiones.limpiar();
  if (errores.length) throw new Error(`La limpieza dejó datos de prueba en la base local:\n- ${errores.join("\n- ")}`);
});

beforeEach(() => {
  fx = new Fixtures();
  // Siempre Mailpit (nunca Resend ni Gmail) y un sitio conocido para comprobar el enlace.
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("SMTP_CONTRASENA", "");
  vi.stubEnv("CORREO_REMITENTE", "");
  vi.stubEnv("MAILPIT_URL", mailpit);
  vi.stubEnv("SITIO_URL", "https://calibra.test");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  const errores: string[] = [];
  await borrarLeadsDeLaPrueba(errores);
  let falloDeFixtures: unknown;
  try {
    await fx.limpiar();
  } catch (error) {
    falloDeFixtures = error;
  }
  if (errores.length) throw new Error(`La limpieza dejó datos de prueba en la base local:\n- ${errores.join("\n- ")}`);
  if (falloDeFixtures) throw falloDeFixtures;
});

/**
 * Borra los Leads que creó `registrarContacto` (Fixtures no los conoce) y todo lo que cuelga de ellos: los registros
 * de correo por su clave `verificacion_lead:<id>`, los mensajes del buzón, y (en cascada) los enlaces, las sesiones
 * ligadas y los diagnósticos ligados. Se buscan por sesión y por correo, y van antes que los usuarios: al borrar una
 * sesión, `lead.id_sesion_anonima` se anula y el Lead ya no se encontraría.
 */
async function borrarLeadsDeLaPrueba(errores: string[]): Promise<void> {
  const admin = sesiones.admin;
  const intentar = async (contexto: string, accion: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await accion;
    if (error) errores.push(`${contexto}: ${error.message}`);
  };
  const destinatarios = correos.splice(0);

  const ids = new Set<string>();
  const idsDeSesiones = [duena, otra, tercera].filter(Boolean).map((sesion) => sesion.id);
  if (idsDeSesiones.length) {
    const porSesion = await admin.from("lead").select("id").in("id_sesion_anonima", idsDeSesiones);
    if (porSesion.error) errores.push(`buscar Leads por sesión: ${porSesion.error.message}`);
    for (const { id } of porSesion.data ?? []) ids.add(id);
  }
  if (destinatarios.length) {
    const porCorreo = await admin.from("lead").select("id").in("correo", destinatarios);
    if (porCorreo.error) errores.push(`buscar Leads por correo: ${porCorreo.error.message}`);
    for (const { id } of porCorreo.data ?? []) ids.add(id);
  }

  if (ids.size) {
    const { data: enlaces } = await admin.from("verificacion_lead").select("id").in("id_lead", [...ids]);
    const claves = (enlaces ?? []).map(({ id }) => claveDeCorreo("verificacion_lead", id));
    if (claves.length) await intentar("borrar correo_envio por clave", admin.from("correo_envio").delete().in("clave", claves));
  }
  if (destinatarios.length) {
    await intentar("borrar correo_envio por destinatario", admin.from("correo_envio").delete().in("destinatario", destinatarios));
    for (const correo of destinatarios) {
      await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" });
    }
  }
  if (ids.size) await intentar("borrar Leads", admin.from("lead").delete().in("id", [...ids]));
}

/** Un correo que solo existe en esta prueba; al terminar se borran su Lead, su buzón y su registro de envíos. */
function correoNuevo(): string {
  const correo = `lead-${randomUUID()}@calibra.test`;
  correos.push(correo);
  return correo;
}

type Mensaje = { ID: string; Subject: string; Text: string };

/** Los correos que hay en Mailpit para un destinatario, el más reciente primero. */
async function mensajesPara(correo: string): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all(
    (messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje),
  );
}

/** El token del enlace de verificación que trae el correo (la única copia del token que existe). */
function tokenDe(mensaje: Mensaje): string {
  const token = /\/contacto\/verificar\?token=([0-9a-f]{64})/.exec(mensaje.Text)?.[1];
  if (!token) throw new Error(`El correo no trae el enlace de verificación:\n${mensaje.Text}`);
  return token;
}

type CamposDeContacto = {
  nombre?: string;
  correo: string;
  telefono?: string;
  origen?: string | null;
  siguiente?: string;
  quiereNovedades?: boolean;
};

/**
 * Lo que la acción del formulario le pasa a `registrarContacto`: el contacto y la autorización se leen con las
 * mismas funciones que usa la acción (`leerContacto` y `leerConsentimiento`), así que el correo y el teléfono llegan
 * normalizados como en el flujo real.
 */
function entradaDe(idSesion: string, campos: CamposDeContacto): EntradaDeContacto {
  const formulario = new FormData();
  formulario.set("nombre", campos.nombre ?? "Ana Pérez");
  formulario.set("correo", campos.correo);
  formulario.set("numero_telefono", campos.telefono ?? "");
  formulario.set(CASILLA_TRATAMIENTO, MARCADA);
  if (campos.quiereNovedades) formulario.set(CASILLA_CONTACTO, MARCADA);
  const contacto = leerContacto(formulario);
  const consentimiento = leerConsentimiento(formulario);
  if (!contacto.ok) throw new Error(`El contacto de la prueba no es válido: ${contacto.error}`);
  if (!consentimiento.ok) throw new Error(`La autorización de la prueba no es válida: ${consentimiento.error}`);
  return {
    idSesion,
    contacto: contacto.datos,
    consentimiento: consentimiento.consentimiento,
    origen: campos.origen ?? null,
    siguiente: campos.siguiente ?? "/agendar/fecha",
  };
}

const leadDe = async (idSesion: string) =>
  exito(await fx.admin.from("lead").select("*").eq("id_sesion_anonima", idSesion).single(), "leer el Lead de la sesión");

/** Los enlaces de verificación de un Lead, del más viejo al más nuevo. */
async function enlacesDe(idLead: string) {
  return exito(await fx.admin.from("verificacion_lead").select("*").eq("id_lead", idLead).order("creada_en"), "leer los enlaces");
}

const enlaceDe = async (id: string) => exito(await fx.admin.from("verificacion_lead").select("*").eq("id", id).single(), "leer el enlace");

const sesionesLigadasA = async (idLead: string) =>
  exito(await fx.admin.from("lead_sesion").select("id_sesion, id_lead").eq("id_lead", idLead), "leer las sesiones ligadas");

const envioDe = async (idVerificacion: string) =>
  exito(
    await fx.admin.from("correo_envio").select("*").eq("clave", claveDeCorreo("verificacion_lead", idVerificacion)).single(),
    "leer el registro del correo",
  );

/** La sesión `duena` ya es Lead con ese correo. */
async function crearLeadDeDuena(correo: string, campos: Partial<CamposDeContacto> = {}) {
  expect(await registrarContacto(entradaDe(duena.id, { nombre: "Ana Pérez", ...campos, correo }))).toEqual({ resultado: "lead" });
  return leadDe(duena.id);
}

/**
 * `sesion` escribe el correo de un Lead que ya existe: se manda el enlace de verificación al dueño. Devuelve la fila del
 * enlace y el token, que solo se puede sacar del correo.
 */
async function pedirEnlace(sesion: Sesion, correo: string, siguiente = "/agendar/fecha") {
  const resultado = await registrarContacto(entradaDe(sesion.id, { nombre: "Otra Persona", correo, siguiente }));
  expect(resultado).toEqual({ resultado: "verificar", envio: "enviado" });
  const { id: idLead } = exito(await fx.admin.from("lead").select("id").eq("correo", correo).single(), "leer el Lead dueño del correo");
  const enlaces = await enlacesDe(idLead);
  const mensajes = await mensajesPara(correo);
  return { idLead, verificacion: enlaces[enlaces.length - 1], token: tokenDe(mensajes[0]) };
}

// ---------------------------------------------------------------------------------------------------------------

describe("criterios 1, 6 y 7: la sesión que deja su contacto queda como Lead", () => {
  it("crea el Lead de la sesión con el correo normalizado, el teléfono con indicativo, la autorización y el origen", async () => {
    const correo = correoNuevo();
    const entrada = entradaDe(duena.id, {
      nombre: "  Ana   Pérez ",
      correo: `  ${correo.toUpperCase()} `,
      telefono: "300 123 4567",
      origen: "feria-2026",
      quiereNovedades: true,
    });

    expect(await registrarContacto(entrada)).toEqual({ resultado: "lead" });

    const lead = await leadDe(duena.id);
    expect(lead).toMatchObject({
      id_sesion_anonima: duena.id,
      nombre: "Ana Pérez",
      correo,
      numero_telefono: "+573001234567",
      origen: "feria-2026",
      estado: "nuevo",
      acepta_tratamiento_datos: true,
      acepta_contacto: true,
    });
    expect(lead.fecha_creacion).toBeTruthy();
    // La fecha de la autorización es la que puso el servidor al leer el formulario.
    expect(new Date(lead.fecha_consentimiento).getTime()).toBe(new Date(entrada.consentimiento.fecha_consentimiento).getTime());
    // Y la sesión ya es Lead para el resto del servidor.
    expect(await leadDeLaSesion(duena.id)).toEqual({ id: lead.id, nombre: "Ana Pérez", correo, numeroTelefono: "+573001234567" });
  });

  it("sin campaña ni teléfono, y sin aceptar novedades, guarda el origen y el teléfono vacíos y el permiso apagado", async () => {
    const correo = correoNuevo();

    await crearLeadDeDuena(correo, { nombre: "Ana" });

    expect(await leadDe(duena.id)).toMatchObject({ correo, nombre: "Ana", numero_telefono: null, origen: null, estado: "nuevo", acepta_contacto: false });
  });

  it("liga al Lead los diagnósticos que la sesión ya había hecho, y no los de otra sesión", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const datos = { idEvaluacion: evaluacion.id, idMateria: materia.id };
    const primero = await fx.crearDiagnostico({ idSesionAnonima: duena.id, ...datos });
    const segundo = await fx.crearDiagnostico({ idSesionAnonima: duena.id, ...datos });
    const deOtra = await fx.crearDiagnostico({ idSesionAnonima: otra.id, ...datos });

    const lead = await crearLeadDeDuena(correoNuevo());

    const { data } = await fx.admin.from("diagnostico").select("id, id_lead").in("id", [primero.id, segundo.id, deOtra.id]);
    expect(Object.fromEntries((data ?? []).map((d) => [d.id, d.id_lead]))).toEqual({
      [primero.id]: lead.id,
      [segundo.id]: lead.id,
      [deOtra.id]: null,
    });
  });
});

describe("criterio 4: una sesión que ya es Lead no crea otro", () => {
  it("con datos nuevos actualiza su Lead, conserva el origen y no crea un segundo", async () => {
    const correo = correoNuevo();
    const correoNuevoDeAna = correoNuevo();
    const antes = await crearLeadDeDuena(correo, { nombre: "Ana", origen: "feria-2026" });
    const entrada = entradaDe(duena.id, {
      nombre: "Ana María Pérez",
      correo: correoNuevoDeAna,
      telefono: "+1 (212) 555-0100",
      origen: "otra-campana",
      quiereNovedades: true,
    });

    expect(await registrarContacto(entrada)).toEqual({ resultado: "lead" });

    const { data: deLaSesion } = await fx.admin.from("lead").select("*").eq("id_sesion_anonima", duena.id);
    expect(deLaSesion).toHaveLength(1);
    expect(deLaSesion![0]).toMatchObject({
      id: antes.id,
      nombre: "Ana María Pérez",
      correo: correoNuevoDeAna,
      numero_telefono: "+12125550100",
      acepta_contacto: true,
      // Cómo llegó sigue siendo la primera campaña, y el Lead sigue como estaba.
      origen: "feria-2026",
      estado: "nuevo",
      fecha_creacion: antes.fecha_creacion,
    });
    expect(new Date(deLaSesion![0].fecha_consentimiento).getTime()).toBe(new Date(entrada.consentimiento.fecha_consentimiento).getTime());
    // El correo viejo quedó libre: ningún Lead lo conserva.
    const { data: conElViejo } = await fx.admin.from("lead").select("id").eq("correo", correo);
    expect(conElViejo).toEqual([]);
    expect(await leadDeLaSesion(duena.id)).toEqual({
      id: antes.id,
      nombre: "Ana María Pérez",
      correo: correoNuevoDeAna,
      numeroTelefono: "+12125550100",
    });
  });

  it("si el correo nuevo ya es de otro Lead, da error, no cambia nada y no manda ningún enlace", async () => {
    const correoDeAna = correoNuevo();
    const correoDeBeto = correoNuevo();
    const ana = await crearLeadDeDuena(correoDeAna, { nombre: "Ana" });
    expect(await registrarContacto(entradaDe(otra.id, { nombre: "Beto", correo: correoDeBeto }))).toEqual({ resultado: "lead" });
    const beto = await leadDe(otra.id);

    const resultado = await registrarContacto(entradaDe(duena.id, { nombre: "Ana Cambiada", correo: `  ${correoDeBeto.toUpperCase()}` }));

    expect(resultado).toEqual({ resultado: "error", error: "Ese correo ya es de otro contacto de Calibra. Escribe el tuyo." });
    expect(await leadDe(duena.id)).toEqual(ana);
    expect(await leadDe(otra.id)).toEqual(beto);
    // Quien ya es Lead no pasa por la verificación: esa es solo para una sesión que todavía no lo es.
    expect(await enlacesDe(beto.id)).toEqual([]);
    expect(await mensajesPara(correoDeBeto)).toEqual([]);
  });

  it("dos pestañas de la misma sesión envían a la vez con correos distintos: queda un solo Lead", async () => {
    const [primero, segundo] = [correoNuevo(), correoNuevo()];

    const resultados = await Promise.all([
      registrarContacto(entradaDe(tercera.id, { correo: primero })),
      registrarContacto(entradaDe(tercera.id, { correo: segundo })),
    ]);

    expect(resultados).toEqual([{ resultado: "lead" }, { resultado: "lead" }]);
    const { data } = await fx.admin.from("lead").select("correo").eq("id_sesion_anonima", tercera.id);
    expect(data).toHaveLength(1);
  });

  it("una cuenta de Estudiante ya es Lead: sus datos se actualizan y no se le crea otro", async () => {
    const estudiante = await fx.crearEstudiante();
    const { id_lead: idLead } = exito(await fx.admin.from("estudiante").select("id_lead").eq("id", estudiante.id).single(), "leer el estudiante");
    expect(await leadDeLaSesion(estudiante.id)).toMatchObject({ id: idLead, nombre: "Lead de prueba" });
    // Este Lead lo borra Fixtures junto con el estudiante: el correo no se anota para la limpieza de esta prueba.
    const correo = `estudiante-${randomUUID()}@calibra.test`;

    expect(await registrarContacto(entradaDe(estudiante.id, { nombre: "Estudiante Cambiada", correo }))).toEqual({ resultado: "lead" });

    expect(await leadDeLaSesion(estudiante.id)).toMatchObject({ id: idLead, nombre: "Estudiante Cambiada", correo });
    const { data } = await fx.admin.from("lead").select("id").eq("id_sesion_anonima", estudiante.id);
    expect(data).toEqual([]);
  });
});

describe("criterio 3 (P-23): un correo que ya es de otro Lead no se liga de inmediato", () => {
  it("manda el enlace de verificación al dueño del correo y no crea Lead para la sesión nueva", async () => {
    const correo = correoNuevo();
    const lead = await crearLeadDeDuena(correo, { nombre: "Ana Pérez" });
    const siguiente = "/agendar/fecha?franja=1";

    const resultado = await registrarContacto(entradaDe(otra.id, { nombre: "Otra Persona", correo: ` ${correo.toUpperCase()} `, siguiente }));

    expect(resultado).toEqual({ resultado: "verificar", envio: "enviado" });
    // La sesión nueva no quedó como Lead, y ese correo sigue teniendo un solo Lead.
    expect(await leadDeLaSesion(otra.id)).toBeNull();
    const { data: conEseCorreo } = await fx.admin.from("lead").select("id").eq("correo", correo);
    expect(conEseCorreo).toEqual([{ id: lead.id }]);
    expect(await sesionesLigadasA(lead.id)).toEqual([]);
    expect(await idsVisibles(otra.cliente, "lead", "id", lead.id)).toEqual([]);

    // Hay un enlace sin usar, a la ruta pedida, que vence en 24 horas y que guarda solo el hash del token.
    const [verificacion, ...otros] = await enlacesDe(lead.id);
    expect(otros).toEqual([]);
    expect(verificacion).toMatchObject({ id_lead: lead.id, siguiente, usada_en: null });
    const horas = (new Date(verificacion.vence_en).getTime() - new Date(verificacion.creada_en).getTime()) / HORA;
    expect(horas).toBeCloseTo(HORAS_DE_VIGENCIA, 3);

    // El correo sale al dueño, con su nombre, y no dice nada de quien lo pidió.
    const mensajes = await mensajesPara(correo);
    expect(mensajes).toHaveLength(1);
    const token = tokenDe(mensajes[0]);
    expect(mensajes[0].Subject).toBe("Confirma tu correo para agendar en Calibra");
    expect(mensajes[0].Text).toContain(`https://calibra.test/contacto/verificar?token=${token}`);
    expect(mensajes[0].Text).toContain("Hola, Ana Pérez.");
    expect(mensajes[0].Text).not.toContain("Otra Persona");
    expect(verificacion.token_hash).toBe(sha256(token));
    expect(JSON.stringify(verificacion)).not.toContain(token);
    expect(await verificacionVigente(token)).toEqual({ correo: expect.stringContaining("***@") });

    // Y el envío quedó anotado con la plantilla y su clave.
    expect(await envioDe(verificacion.id)).toMatchObject({
      plantilla: "verificacion_lead",
      destinatario: correo,
      estado: "enviado",
      intentos: 1,
      ultimo_error: null,
      id_proveedor: mensajes[0].ID,
    });
  });

  it("si el correo no sale, el enlace queda creado y el envío fallido y reintentable, y el reintento manda un enlace nuevo que sirve", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const correo = correoNuevo();
    const lead = await crearLeadDeDuena(correo, { nombre: "Ana Pérez" });

    // Sin proveedor de correo (como si Mailpit estuviera caído) el envío no sale, pero el flujo no se cae.
    vi.stubEnv("MAILPIT_URL", "");
    const resultado = await registrarContacto(entradaDe(otra.id, { nombre: "Otra Persona", correo, siguiente: "/agendar/fecha" }));
    vi.stubEnv("MAILPIT_URL", mailpit);

    expect(resultado).toEqual({ resultado: "verificar", envio: "fallido" });
    const [verificacion] = await enlacesDe(lead.id);
    const fallido = await envioDe(verificacion.id);
    expect(fallido).toMatchObject({ plantilla: "verificacion_lead", destinatario: correo, estado: "fallido", reintentable: true, intentos: 0, enviado_en: null });
    expect(await mensajesPara(correo)).toEqual([]);

    // Lo que hace el proceso de HU-065: reconstruir el correo con el registro de reconstructores y mandarlo con la misma clave.
    const reconstruido = await RECONSTRUCTORES.verificacion_lead!(verificacion.id);
    expect(reconstruido).toMatchObject({ destinatario: correo, datos: { nombre: "Ana Pérez" } });
    const envio = await enviarCorreoDesdeServidor({
      plantilla: "verificacion_lead",
      datos: reconstruido!.datos,
      destinatario: reconstruido!.destinatario,
      entidad: verificacion.id,
    });

    expect(envio).toMatchObject({ ok: true, yaEnviado: false });
    expect(await envioDe(verificacion.id)).toMatchObject({ id: fallido.id, estado: "enviado", intentos: 1, ultimo_error: null, reintentable: false });
    const mensajes = await mensajesPara(correo);
    expect(mensajes).toHaveLength(1);
    const token = tokenDe(mensajes[0]);
    expect((await enlaceDe(verificacion.id)).token_hash).toBe(sha256(token));
    expect(await confirmarCorreo(token, otra.id)).toEqual({ ok: true, siguiente: "/agendar/fecha" });
  });
});

describe("confirmarCorreo (P-23): la sesión que abre el enlace queda ligada al Lead", () => {
  it("la sesión que confirma ve el Lead y sus diagnósticos, y una tercera sesión no", async () => {
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const datos = { idEvaluacion: evaluacion.id, idMateria: materia.id };
    const correo = correoNuevo();
    // Un diagnóstico de cada sesión, hechos antes de que exista el Lead: el de la dueña se liga al crearlo.
    const dePrimera = await fx.crearDiagnostico({ idSesionAnonima: duena.id, ...datos });
    const deOtra = await fx.crearDiagnostico({ idSesionAnonima: otra.id, ...datos });
    const lead = await crearLeadDeDuena(correo);
    const { verificacion, token } = await pedirEnlace(otra, correo, "/agendar/fecha?franja=1");
    // Antes de confirmar, no ve nada del Lead.
    expect(await idsVisibles(otra.cliente, "lead", "id", lead.id)).toEqual([]);
    expect(await idsVisibles(otra.cliente, "diagnostico", "id", dePrimera.id)).toEqual([]);

    const resultado = await confirmarCorreo(token, otra.id);

    expect(resultado).toEqual({ ok: true, siguiente: "/agendar/fecha?franja=1" });
    // La sesión queda ligada al Lead y el enlace gastado; sus diagnósticos de antes pasan a ser del Lead.
    expect(await sesionesLigadasA(lead.id)).toEqual([{ id_sesion: otra.id, id_lead: lead.id }]);
    expect((await enlaceDe(verificacion.id)).usada_en).not.toBeNull();
    expect(await leadDeLaSesion(otra.id)).toMatchObject({ id: lead.id, nombre: "Ana Pérez", correo });
    const { data: diagnostico } = await fx.admin.from("diagnostico").select("id_lead").eq("id", deOtra.id).single();
    expect(diagnostico?.id_lead).toBe(lead.id);
    // Ahora ve el Lead y los diagnósticos del Lead, también los que hizo la otra sesión (RLS con `es_mi_lead`).
    expect(await idsVisibles(otra.cliente, "lead", "id", lead.id)).toEqual([lead.id]);
    expect(await idsVisibles(otra.cliente, "diagnostico", "id", dePrimera.id)).toEqual([dePrimera.id]);
    // Una tercera sesión, que no confirmó, sigue sin ver nada.
    expect(await idsVisibles(tercera.cliente, "lead", "id", lead.id)).toEqual([]);
    expect(await idsVisibles(tercera.cliente, "diagnostico", "id", dePrimera.id)).toEqual([]);
    expect(await leadDeLaSesion(tercera.id)).toBeNull();
  });

  it("el enlace es de un solo uso: ni otra sesión ni la misma lo vuelven a usar", async () => {
    const correo = correoNuevo();
    const lead = await crearLeadDeDuena(correo);
    const { token } = await pedirEnlace(otra, correo);
    expect(await confirmarCorreo(token, otra.id)).toMatchObject({ ok: true });
    expect(await verificacionVigente(token)).toBeNull();

    expect(await confirmarCorreo(token, tercera.id)).toEqual({ ok: false });
    expect(await confirmarCorreo(token, otra.id)).toEqual({ ok: false });

    expect(await sesionesLigadasA(lead.id)).toEqual([{ id_sesion: otra.id, id_lead: lead.id }]);
    expect(await idsVisibles(tercera.cliente, "lead", "id", lead.id)).toEqual([]);
  });

  it("un enlace vencido no sirve: no se puede mostrar ni confirmar, y no liga la sesión", async () => {
    const correo = correoNuevo();
    const lead = await crearLeadDeDuena(correo);
    const { verificacion, token } = await pedirEnlace(otra, correo);
    // vence_en debe seguir siendo posterior a creada_en (check de la tabla).
    exito(
      await fx.admin.from("verificacion_lead").update({ creada_en: hace(2 * DIA), vence_en: hace(DIA) }).eq("id", verificacion.id).select().single(),
      "vencer el enlace",
    );

    expect(await verificacionVigente(token)).toBeNull();
    expect(await confirmarCorreo(token, otra.id)).toEqual({ ok: false });

    expect(await sesionesLigadasA(lead.id)).toEqual([]);
    expect((await enlaceDe(verificacion.id)).usada_en).toBeNull();
    expect(await idsVisibles(otra.cliente, "lead", "id", lead.id)).toEqual([]);
  });

  it("una sesión que ya es de otro Lead no se cambia de Lead y el enlace queda sin gastar", async () => {
    const correo = correoNuevo();
    const correoDeTercera = correoNuevo();
    const lead = await crearLeadDeDuena(correo);
    expect(await registrarContacto(entradaDe(tercera.id, { nombre: "Tercera", correo: correoDeTercera }))).toEqual({ resultado: "lead" });
    const { token } = await pedirEnlace(otra, correo);

    expect(await confirmarCorreo(token, tercera.id)).toEqual({ ok: false });

    expect(await verificacionVigente(token)).not.toBeNull();
    expect(await sesionesLigadasA(lead.id)).toEqual([]);
    expect(await leadDeLaSesion(tercera.id)).toMatchObject({ correo: correoDeTercera });
    expect(await idsVisibles(tercera.cliente, "lead", "id", lead.id)).toEqual([]);
    // El dueño del correo todavía puede confirmarlo desde su navegador.
    expect(await confirmarCorreo(token, otra.id)).toMatchObject({ ok: true });
  });

  it("una cuenta de Estudiante ya tiene su Lead: no se liga a otro con un enlace, y el enlace queda sin gastar", async () => {
    const correo = correoNuevo();
    const lead = await crearLeadDeDuena(correo);
    const estudiante = await fx.crearEstudiante();
    const { token } = await pedirEnlace(otra, correo);

    expect(await confirmarCorreo(token, estudiante.id)).toEqual({ ok: false });

    expect(await verificacionVigente(token)).not.toBeNull();
    expect(await sesionesLigadasA(lead.id)).toEqual([]);
    expect(await leadDeLaSesion(estudiante.id)).not.toMatchObject({ id: lead.id });
  });

  it("dos clics a la vez sobre el mismo enlace: solo uno lo usa", async () => {
    const correo = correoNuevo();
    const lead = await crearLeadDeDuena(correo);
    const { token } = await pedirEnlace(otra, correo);

    const resultados = await Promise.all([confirmarCorreo(token, otra.id), confirmarCorreo(token, tercera.id)]);

    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await sesionesLigadasA(lead.id)).toHaveLength(1);
  });

  it("un token inventado, con mala forma o que no es texto no sirve", async () => {
    for (const token of ["basura", "a".repeat(64), "A".repeat(64), "", undefined, null, 42]) {
      expect(await confirmarCorreo(token, otra.id), String(token)).toEqual({ ok: false });
      expect(await verificacionVigente(token), String(token)).toBeNull();
    }
  });
});

describe("freno (RN-12): como máximo 3 enlaces por Lead en una hora", () => {
  it("el cuarto enlace no se crea ni se manda, y aun así responde que hay que verificar", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(MAXIMO_DE_ENLACES_POR_HORA).toBe(3);
    const correo = correoNuevo();
    const lead = await crearLeadDeDuena(correo);

    // Tres enlaces pedidos desde dos sesiones distintas: el freno es por Lead, no por sesión.
    for (const sesion of [otra, otra, tercera]) {
      expect(await registrarContacto(entradaDe(sesion.id, { correo }))).toEqual({ resultado: "verificar", envio: "enviado" });
    }
    const enviados = await enlacesDe(lead.id);
    expect(enviados).toHaveLength(3);
    expect(await mensajesPara(correo)).toHaveLength(3);
    expect(aviso).not.toHaveBeenCalled();

    const cuarto = await registrarContacto(entradaDe(tercera.id, { correo }));

    expect(cuarto).toEqual({ resultado: "verificar", envio: "frenado" });
    expect((await enlacesDe(lead.id)).map((e) => e.id)).toEqual(enviados.map((e) => e.id));
    expect(await mensajesPara(correo)).toHaveLength(3);
    const { data: registros } = await fx.admin.from("correo_envio").select("clave").eq("destinatario", correo);
    expect(registros).toHaveLength(3);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining(lead.id));
  });

  it("con muchos pedidos a la vez, igual salen solo 3: el freno no tiene carreras", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const correo = correoNuevo();
    const lead = await crearLeadDeDuena(correo);

    const resultados = await Promise.all(Array.from({ length: 6 }, () => registrarContacto(entradaDe(otra.id, { correo }))));

    const envios = resultados.map((r) => (r.resultado === "verificar" ? r.envio : r.resultado)).sort();
    expect(envios).toEqual(["enviado", "enviado", "enviado", "frenado", "frenado", "frenado"]);
    expect(await enlacesDe(lead.id)).toHaveLength(MAXIMO_DE_ENLACES_POR_HORA);
    expect(await mensajesPara(correo)).toHaveLength(MAXIMO_DE_ENLACES_POR_HORA);
  });

  it("la cuenta es por hora: con los tres enlaces de hace más de una hora, vuelve a mandar", async () => {
    const correo = correoNuevo();
    const lead = await crearLeadDeDuena(correo);
    for (let i = 0; i < MAXIMO_DE_ENLACES_POR_HORA; i++) {
      expect(await registrarContacto(entradaDe(otra.id, { correo }))).toEqual({ resultado: "verificar", envio: "enviado" });
    }
    // Con dos de hace 61 minutos y uno de hace 59, todavía hay 1 dentro de la hora y caben dos más.
    const [a, b, c] = await enlacesDe(lead.id);
    for (const [enlace, minutos] of [[a, 61], [b, 61], [c, 59]] as const) {
      exito(await fx.admin.from("verificacion_lead").update({ creada_en: hace(minutos * MINUTO) }).eq("id", enlace.id).select().single(), "envejecer el enlace");
    }

    expect(await registrarContacto(entradaDe(otra.id, { correo }))).toEqual({ resultado: "verificar", envio: "enviado" });
    expect(await registrarContacto(entradaDe(otra.id, { correo }))).toEqual({ resultado: "verificar", envio: "enviado" });
    // Ya hay tres dentro de la hora (el de hace 59 minutos y los dos nuevos): el siguiente se frena.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await registrarContacto(entradaDe(otra.id, { correo }))).toEqual({ resultado: "verificar", envio: "frenado" });

    expect(await enlacesDe(lead.id)).toHaveLength(5);
    expect(await mensajesPara(correo)).toHaveLength(5);
  });
});

describe("reconstruirVerificacion (HU-065): rehacer el correo que no salió", () => {
  it("cambia el hash de un enlace sin usar y devuelve el destinatario y los datos con un enlace nuevo que sirve", async () => {
    const correo = correoNuevo();
    await crearLeadDeDuena(correo, { nombre: "Ana Pérez" });
    const { idLead, verificacion, token } = await pedirEnlace(otra, correo, "/agendar/fecha");

    const reconstruido = await reconstruirVerificacion(verificacion.id);

    expect(reconstruido).toMatchObject({ destinatario: correo, datos: { nombre: "Ana Pérez", venceEn: verificacion.vence_en } });
    const nuevo = /^https:\/\/calibra\.test\/contacto\/verificar\?token=([0-9a-f]{64})$/.exec(reconstruido!.datos.enlace)?.[1];
    expect(nuevo, "el enlace nuevo debía traer un token").toBeDefined();
    expect(nuevo).not.toBe(token);
    // Es el mismo enlace de la base (no se creó otro ni se alargó): solo cambió el hash, y el token viejo dejó de servir.
    const despues = await enlaceDe(verificacion.id);
    expect(despues).toMatchObject({
      id: verificacion.id,
      id_lead: idLead,
      siguiente: "/agendar/fecha",
      creada_en: verificacion.creada_en,
      vence_en: verificacion.vence_en,
      usada_en: null,
    });
    expect(despues.token_hash).toBe(sha256(nuevo!));
    expect(despues.token_hash).not.toBe(verificacion.token_hash);
    expect(await enlacesDe(idLead)).toHaveLength(1);
    expect(await verificacionVigente(token)).toBeNull();
    expect(await verificacionVigente(nuevo)).not.toBeNull();
    // Y el enlace nuevo confirma.
    expect(await confirmarCorreo(nuevo, otra.id)).toEqual({ ok: true, siguiente: "/agendar/fecha" });
  });

  it("de un enlace ya usado, vencido o que no existe devuelve null y no toca el hash", async () => {
    const correo = correoNuevo();
    await crearLeadDeDuena(correo);
    const usado = await pedirEnlace(otra, correo);
    expect(await confirmarCorreo(usado.token, otra.id)).toMatchObject({ ok: true });
    const vencido = await pedirEnlace(tercera, correo);
    exito(
      await fx.admin.from("verificacion_lead").update({ creada_en: hace(2 * DIA), vence_en: hace(DIA) }).eq("id", vencido.verificacion.id).select().single(),
      "vencer el enlace",
    );

    expect(await reconstruirVerificacion(usado.verificacion.id)).toBeNull();
    expect(await reconstruirVerificacion(vencido.verificacion.id)).toBeNull();
    expect(await reconstruirVerificacion(randomUUID())).toBeNull();
    expect(await reconstruirVerificacion("esto-no-es-un-id")).toBeNull();

    expect((await enlaceDe(usado.verificacion.id)).token_hash).toBe(usado.verificacion.token_hash);
    expect((await enlaceDe(vencido.verificacion.id)).token_hash).toBe(vencido.verificacion.token_hash);
  });
});

describe("las tablas y funciones del servidor no están al alcance de una sesión", () => {
  it("una sesión anónima no lee lead_sesion ni verificacion_lead, ni llama a registrar_lead ni a confirmar_correo_de_lead", async () => {
    const correo = correoNuevo();
    await crearLeadDeDuena(correo);
    await pedirEnlace(otra, correo);

    for (const tabla of ["lead_sesion", "verificacion_lead"] as const) {
      const lectura = await otra.cliente.from(tabla).select("*");
      expect(lectura.data, tabla).toBeNull();
      expect(lectura.error?.code, tabla).toBe("42501");
    }
    const registrar = await otra.cliente.rpc("registrar_lead", {
      p_id_sesion: otra.id,
      p_nombre: "Intrusa",
      p_correo: `intrusa-${randomUUID()}@calibra.test`,
      p_numero_telefono: "",
      p_acepta_contacto: false,
      p_fecha_consentimiento: new Date().toISOString(),
      p_origen: "",
    });
    expect(registrar.error?.code).toBe("42501");
    const confirmar = await otra.cliente.rpc("confirmar_correo_de_lead", { p_token_hash: "0".repeat(64), p_id_sesion: otra.id });
    expect(confirmar.error?.code).toBe("42501");
    // Y por la Data API tampoco crea Leads.
    const insercion = await otra.cliente
      .from("lead")
      .insert({ id_sesion_anonima: otra.id, nombre: "Intrusa", correo: `intrusa-${randomUUID()}@calibra.test`, acepta_tratamiento_datos: true, fecha_consentimiento: new Date().toISOString() });
    expect(insercion.error).not.toBeNull();
    expect(await leadDeLaSesion(otra.id)).toBeNull();
  });
});
