import { randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claveDeCorreo, enviarCorreo, type EntradaDeEnvio } from "@/lib/correo/enviar";
import type { Plantilla } from "@/lib/correo/plantillas";
import { crearProveedorMailpit } from "@/lib/correo/proveedor";
import { RECONSTRUCTORES } from "@/lib/correo/reconstructores";
import { crearRegistroDeEnvios } from "@/lib/correo/registro";
import { reintentarCorreosFallidos } from "@/lib/correo/reintentos";
import { enviarCorreoDesdeServidor } from "@/lib/correo/servidor";
import {
  leerResultadoPorToken,
  mandarEnlaceDeResultados,
  mandarEnlaceDelUltimoDiagnostico,
  reconstruirRecuperacion,
} from "@/lib/diagnostico/recuperacion";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures } from "./utilidades";

// HU-031 contra el Supabase LOCAL: el enlace con token para ver el resultado desde otro dispositivo. El correo sale de verdad
// por Mailpit, el registro es la tabla `correo_envio` real y la lectura por token es `public.resultado_por_token`.
//
// - Los dos momentos del envío (P-33, P-34) se prueban por sus funciones de servidor, sin pasar por `after()` de Next, que
//   necesita una petición: `mandarEnlaceDeResultados` (al terminar un diagnóstico de un Lead) y `mandarEnlaceDelUltimoDiagnostico`
//   (al crearse el Lead). Para el segundo, el Lead se crea con `registrar_lead`, la misma función que usa `registrarContacto`, que
//   liga los diagnósticos de la sesión.
// - El proveedor caído es un Mailpit en un puerto sin nadie, como en `integracion/correo.test.ts`. El reintento usa los
//   `RECONSTRUCTORES` reales y el envío real por Mailpit, como el proceso de HU-065 (`integracion/reintentos.test.ts`).
// - Las sesiones y los diagnósticos se crean con la API de administración y `Fixtures` (no gastan el cupo de sesiones anónimas
//   del Auth local); solo hay una sesión anónima de verdad, para la Data API (criterio de la sesión ajena).

let fx: Fixtures;
/** La sesión anónima que se crea una sola vez para el archivo. */
let sesiones: Fixtures;
let ajena: Awaited<ReturnType<Fixtures["crearAnonimo"]>>;
let mailpit: string;
/** Destinatarios de esta prueba (correo_envio y buzón). */
const correos: string[] = [];
/** Claves de correo_envio de esta prueba. */
const claves: string[] = [];

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
const hace = (milisegundos: number) => new Date(Date.now() - milisegundos).toISOString();
const REMITENTE = "Calibra <no-responder@calibra.test>";
const SITIO = "https://calibra.test";

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  sesiones = new Fixtures();
  try {
    ajena = await sesiones.crearAnonimo();
  } catch (error) {
    await sesiones.limpiar();
    throw error;
  }
});

afterAll(async () => {
  await sesiones?.limpiar();
});

beforeEach(() => {
  fx = new Fixtures();
  // Siempre Mailpit (nunca Resend ni Gmail) y un sitio conocido para comprobar el enlace.
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("SMTP_CONTRASENA", "");
  vi.stubEnv("CORREO_REMITENTE", "");
  vi.stubEnv("MAILPIT_URL", mailpit);
  vi.stubEnv("SITIO_URL", SITIO);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  const destinatarios = correos.splice(0);
  const clavesPropias = claves.splice(0);
  if (clavesPropias.length) await fx.admin.from("correo_envio").delete().in("clave", clavesPropias);
  if (destinatarios.length) {
    await fx.admin.from("correo_envio").delete().in("destinatario", destinatarios);
    for (const correo of destinatarios) {
      await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" });
    }
  }
  await fx.limpiar();
});

// ---------------------------------------------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------------------------------------------

type Mensaje = { ID: string; Subject: string; Text: string; HTML: string };

/** Los correos que hay en Mailpit para un destinatario. */
async function mensajesPara(correo: string): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all(
    (messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje),
  );
}

/** El token del enlace de resultados que trae el correo (64 hexadecimales, en el sitio de la prueba). */
function tokenDe(mensaje: Mensaje): string {
  const token = new RegExp(`${SITIO.replaceAll(".", "\\.")}/resultados\\?token=([0-9a-f]{64})(?![0-9a-f])`).exec(mensaje.Text)?.[1];
  if (!token) throw new Error(`El correo no trae el enlace de resultados:\n${mensaje.Text}`);
  return token;
}

/**
 * Un Lead de la prueba (se borra con `limpiar()`). Por defecto con correo propio; `correo: null` lo deja sin correo, con solo
 * el teléfono (la base lo admite aunque la app no lo crea).
 */
async function crearLeadDePrueba(opciones: { correo?: string | null; telefono?: string | null } = {}) {
  const correo = opciones.correo === undefined ? `recuperacion-${randomUUID()}@calibra.test` : opciones.correo;
  const telefono = opciones.telefono === undefined ? (correo === null ? `+57300${randomInt(1_000_000, 9_999_999)}` : null) : opciones.telefono;
  if (correo) correos.push(correo);
  const lead = exito(
    await fx.admin
      .from("lead")
      .insert({
        nombre: "Ana Pérez",
        correo,
        numero_telefono: telefono,
        acepta_tratamiento_datos: true,
        fecha_consentimiento: new Date().toISOString(),
      })
      .select()
      .single(),
    "insertar lead",
  );
  fx.registrarLead(lead.id);
  return lead;
}

type Contexto = Awaited<ReturnType<Fixtures["crearEvaluacion"]>>;

/** Un diagnóstico terminado, de un Lead o de una sesión, con la fecha que se pida (para probar cuál es el más reciente). */
async function crearDiagnosticoDePrueba(
  contexto: Contexto,
  dueno: { idLead: string } | { idSesionAnonima: string },
  fecha?: string,
) {
  const diagnostico = await fx.crearDiagnostico({ ...dueno, idEvaluacion: contexto.evaluacion.id, idMateria: contexto.materia.id });
  if (fecha) {
    exito(await fx.admin.from("diagnostico").update({ fecha_realizacion: fecha }).eq("id", diagnostico.id).select("id").single(), "poner la fecha");
  }
  claves.push(claveDeCorreo("recuperacion_diagnostico", diagnostico.id));
  return diagnostico;
}

const tokenDeDiagnostico = async (id: string) =>
  exito(await fx.admin.from("diagnostico").select("token_recuperacion").eq("id", id).single(), "leer el token").token_recuperacion;

const filasDe = async (clave: string) =>
  exito(await fx.admin.from("correo_envio").select("*").eq("clave", clave), `leer correo_envio ${clave}`);

const filasPara = async (destinatario: string) =>
  exito(await fx.admin.from("correo_envio").select("*").eq("destinatario", destinatario), `leer correo_envio de ${destinatario}`);

/** Deja la fila quieta desde hace un rato: el proceso solo toma un fallido que lleva 2 minutos sin tocarse. */
async function envejecer(clave: string, milisegundos = 3 * MINUTO) {
  exito(await fx.admin.from("correo_envio").update({ actualizado_en: hace(milisegundos) }).eq("clave", clave).select("id").single(), `envejecer ${clave}`);
}

/** Un `enviar` con el proveedor caído: Mailpit en un puerto sin nadie, sin esperas reales entre los tres intentos. */
function enviarConProveedorCaido<P extends Plantilla>(entrada: EntradaDeEnvio<P>) {
  return enviarCorreo(
    {
      registro: crearRegistroDeEnvios(fx.admin),
      proveedor: { ok: true, proveedor: crearProveedorMailpit({ url: "http://127.0.0.1:1", remitente: REMITENTE }) },
      esperar: async () => undefined,
    },
    entrada,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Momento 1: terminar un diagnóstico de un Lead
// ---------------------------------------------------------------------------------------------------------------

describe("momento 1: el diagnóstico de un Lead con correo manda su enlace", () => {
  it("sale un correo con el asunto, el nombre y el enlace /resultados?token=<64 hexadecimales>, y queda enviado en correo_envio", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });

    const envio = await mandarEnlaceDeResultados(diagnostico.id);

    expect(envio).toMatchObject({ ok: true, yaEnviado: false, intentos: 1 });
    const mensajes = await mensajesPara(lead.correo!);
    expect(mensajes).toHaveLength(1);
    const [mensaje] = mensajes;
    expect(mensaje.Subject).toBe("Tus resultados del diagnóstico de Materia de prueba");
    expect(mensaje.Text).toContain("Hola, Ana Pérez");
    expect(mensaje.Text).toContain("Ver mis resultados");
    // El enlace es el token del diagnóstico: 64 hexadecimales, tal como los genera la base.
    const token = tokenDe(mensaje);
    expect(token).toBe(await tokenDeDiagnostico(diagnostico.id));
    expect(mensaje.Text).toContain(`${SITIO}/resultados?token=${token}`);
    expect(mensaje.HTML).toContain(`${SITIO}/resultados?token=${token}`);
    // El correo no trae niveles ni puntaje.
    expect(mensaje.Text).not.toMatch(/puntaje|nivel|lo_domina|no_lo_domina/i);

    // Una fila enviada con la clave `recuperacion_diagnostico:<id>`, y el token no va al registro.
    const clave = claveDeCorreo("recuperacion_diagnostico", diagnostico.id);
    const filas = await filasDe(clave);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      clave,
      plantilla: "recuperacion_diagnostico",
      destinatario: lead.correo,
      estado: "enviado",
      intentos: 1,
      ultimo_error: null,
      id_proveedor: mensaje.ID,
    });
    expect(filas[0].enviado_en).not.toBeNull();
    expect(JSON.stringify(filas[0])).not.toContain(token);
  });

  it("el reconstructor da el mismo destinatario, los datos y el mismo enlace todas las veces, y es el que está registrado", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });
    const token = await tokenDeDiagnostico(diagnostico.id);
    const esperado = {
      destinatario: lead.correo,
      datos: { nombre: "Ana Pérez", materia: "Materia de prueba", enlace: `${SITIO}/resultados?token=${token}` },
    };

    expect(await reconstruirRecuperacion(diagnostico.id)).toEqual(esperado);
    expect(await reconstruirRecuperacion(diagnostico.id)).toEqual(esperado);
    expect(RECONSTRUCTORES.recuperacion_diagnostico).not.toBeNull();
    expect(await RECONSTRUCTORES.recuperacion_diagnostico!(diagnostico.id)).toEqual(esperado);
    // Una entidad que no es un id, o un diagnóstico que no existe, ya no aplica.
    expect(await reconstruirRecuperacion("esto-no-es-un-id")).toBeNull();
    expect(await reconstruirRecuperacion(randomUUID())).toBeNull();
  });
});

describe("criterio 3: el mismo evento repetido no manda otro correo", () => {
  it("repetir mandarEnlaceDeResultados no crea otra fila ni manda otro correo", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });
    expect(await mandarEnlaceDeResultados(diagnostico.id)).toMatchObject({ ok: true, yaEnviado: false });

    const otra = await mandarEnlaceDeResultados(diagnostico.id);

    expect(otra).toMatchObject({ ok: true, yaEnviado: true });
    expect(await mensajesPara(lead.correo!)).toHaveLength(1);
    const filas = await filasDe(claveDeCorreo("recuperacion_diagnostico", diagnostico.id));
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ estado: "enviado", intentos: 1 });
    expect(await filasPara(lead.correo!)).toHaveLength(1);
  });

  it("si el momento 1 y el momento 2 coinciden sobre el mismo diagnóstico, sale un solo correo", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });
    expect(await mandarEnlaceDeResultados(diagnostico.id)).toMatchObject({ ok: true, yaEnviado: false });

    const delLead = await mandarEnlaceDelUltimoDiagnostico(lead.id);

    expect(delLead).toMatchObject({ ok: true, yaEnviado: true });
    expect(await mensajesPara(lead.correo!)).toHaveLength(1);
    expect(await filasPara(lead.correo!)).toHaveLength(1);
  });

  it("dos llamadas a la vez sobre el mismo diagnóstico mandan un solo correo", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });

    const resultados = await Promise.all([mandarEnlaceDeResultados(diagnostico.id), mandarEnlaceDeResultados(diagnostico.id)]);

    expect(resultados.filter((r) => r?.ok && !r.yaEnviado)).toHaveLength(1);
    // La otra no envió: o lo encontró en curso, o ya enviado.
    const otra = resultados.find((r) => !(r?.ok && !r.yaEnviado));
    expect(otra && (otra.ok ? "ya_enviado" : otra.motivo)).toMatch(/^(ya_enviado|en_curso)$/);
    expect(await mensajesPara(lead.correo!)).toHaveLength(1);
    expect(await filasPara(lead.correo!)).toHaveLength(1);
  });

  it("dos diagnósticos de un mismo Lead mandan dos correos, cada uno con su enlace", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const primero = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id }, hace(2 * DIA));
    const segundo = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id }, hace(DIA));

    expect(await mandarEnlaceDeResultados(primero.id)).toMatchObject({ ok: true, yaEnviado: false });
    expect(await mandarEnlaceDeResultados(segundo.id)).toMatchObject({ ok: true, yaEnviado: false });

    const mensajes = await mensajesPara(lead.correo!);
    expect(mensajes).toHaveLength(2);
    expect(mensajes.map(tokenDe).sort()).toEqual([await tokenDeDiagnostico(primero.id), await tokenDeDiagnostico(segundo.id)].sort());
    expect(await filasPara(lead.correo!)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Momento 2: se crea el Lead de una sesión con diagnósticos
// ---------------------------------------------------------------------------------------------------------------

describe("momento 2: al crearse el Lead, sale un solo correo, el del diagnóstico más reciente", () => {
  /** Lo que hace `registrarContacto` en su rama de creación: `registrar_lead` crea el Lead y le liga los diagnósticos de la sesión. */
  async function crearLeadDeLaSesion(idSesion: string) {
    const correo = `recuperacion-${randomUUID()}@calibra.test`;
    correos.push(correo);
    const idLead = exito(
      await fx.admin.rpc("registrar_lead", {
        p_id_sesion: idSesion,
        p_nombre: "Ana Pérez",
        p_correo: correo,
        p_numero_telefono: "",
        p_acepta_contacto: false,
        p_fecha_consentimiento: new Date().toISOString(),
        p_origen: "",
      }),
      "registrar el Lead de la sesión",
    );
    fx.registrarLead(idLead);
    return { idLead, correo };
  }

  it("una sesión con dos diagnósticos terminados en fechas distintas: manda un solo correo, el del más reciente", async () => {
    const contexto = await fx.crearEvaluacion();
    const sesion = await fx.crearUsuario();
    // El más reciente se crea primero: el orden no depende de cuál se insertó antes.
    const reciente = await crearDiagnosticoDePrueba(contexto, { idSesionAnonima: sesion.id }, hace(DIA));
    const viejo = await crearDiagnosticoDePrueba(contexto, { idSesionAnonima: sesion.id }, hace(3 * DIA));
    const { idLead, correo } = await crearLeadDeLaSesion(sesion.id);
    // Los dos diagnósticos pasaron a ser del Lead, y todavía no salió ningún correo.
    const { data: ligados } = await fx.admin.from("diagnostico").select("id, id_lead").in("id", [reciente.id, viejo.id]);
    expect(Object.fromEntries((ligados ?? []).map((d) => [d.id, d.id_lead]))).toEqual({ [reciente.id]: idLead, [viejo.id]: idLead });
    expect(await filasPara(correo)).toEqual([]);

    const envio = await mandarEnlaceDelUltimoDiagnostico(idLead);

    expect(envio).toMatchObject({ ok: true, yaEnviado: false });
    const mensajes = await mensajesPara(correo);
    expect(mensajes).toHaveLength(1);
    expect(tokenDe(mensajes[0])).toBe(await tokenDeDiagnostico(reciente.id));
    const filas = await filasPara(correo);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ clave: claveDeCorreo("recuperacion_diagnostico", reciente.id), estado: "enviado" });
    expect(await filasDe(claveDeCorreo("recuperacion_diagnostico", viejo.id))).toEqual([]);

    // Repetir el evento (un reintento, un doble clic) no manda otro.
    expect(await mandarEnlaceDelUltimoDiagnostico(idLead)).toMatchObject({ ok: true, yaEnviado: true });
    expect(await mensajesPara(correo)).toHaveLength(1);
    expect(await filasPara(correo)).toHaveLength(1);
  });

  it("con la misma fecha_realizacion gana el id mayor", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const fecha = hace(DIA);
    const a = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id }, fecha);
    const b = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id }, fecha);
    // Un tercero, más viejo, con el id que sea: nunca gana.
    await crearDiagnosticoDePrueba(contexto, { idLead: lead.id }, hace(5 * DIA));
    const mayor = [a.id, b.id].sort()[1];

    const envio = await mandarEnlaceDelUltimoDiagnostico(lead.id);

    expect(envio).toMatchObject({ ok: true, yaEnviado: false });
    const mensajes = await mensajesPara(lead.correo!);
    expect(mensajes).toHaveLength(1);
    expect(tokenDe(mensajes[0])).toBe(await tokenDeDiagnostico(mayor));
    expect(await filasPara(lead.correo!)).toMatchObject([{ clave: claveDeCorreo("recuperacion_diagnostico", mayor) }]);
  });

  it("un Lead sin diagnósticos no recibe correo", async () => {
    const lead = await crearLeadDePrueba();

    expect(await mandarEnlaceDelUltimoDiagnostico(lead.id)).toBeNull();

    expect(await mensajesPara(lead.correo!)).toEqual([]);
    expect(await filasPara(lead.correo!)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Sin a quién mandarlo
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 4: sin Lead, o con un Lead sin correo, no sale nada y nada falla", () => {
  it("un diagnóstico sin Lead devuelve null y no deja fila en correo_envio", async () => {
    const contexto = await fx.crearEvaluacion();
    const sesion = await fx.crearUsuario();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idSesionAnonima: sesion.id });

    expect(await mandarEnlaceDeResultados(diagnostico.id)).toBeNull();

    expect(await filasDe(claveDeCorreo("recuperacion_diagnostico", diagnostico.id))).toEqual([]);
    expect(await reconstruirRecuperacion(diagnostico.id)).toBeNull();
  });

  it("un Lead sin correo (solo teléfono) devuelve null por los dos caminos y no deja fila", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba({ correo: null });
    expect(lead.correo).toBeNull();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });

    expect(await mandarEnlaceDeResultados(diagnostico.id)).toBeNull();
    expect(await mandarEnlaceDelUltimoDiagnostico(lead.id)).toBeNull();

    expect(await filasDe(claveDeCorreo("recuperacion_diagnostico", diagnostico.id))).toEqual([]);
    expect(await reconstruirRecuperacion(diagnostico.id)).toBeNull();
  });

  it("un diagnóstico que no existe, o un id que no es un id, devuelve null sin lanzar", async () => {
    expect(await mandarEnlaceDeResultados(randomUUID())).toBeNull();
    expect(await mandarEnlaceDeResultados("esto-no-es-un-id")).toBeNull();
    expect(await mandarEnlaceDelUltimoDiagnostico(randomUUID())).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Proveedor caído
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 5: con el proveedor caído el correo queda fallido y HU-065 lo manda después con el mismo enlace", () => {
  it("queda fallido y reintentable; reintentarCorreosFallidos con los reconstructores reales lo manda, sobre la misma fila", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });
    const token = await tokenDeDiagnostico(diagnostico.id);
    const clave = claveDeCorreo("recuperacion_diagnostico", diagnostico.id);

    const envio = await mandarEnlaceDeResultados(diagnostico.id, { enviar: enviarConProveedorCaido });

    // No lanza: devuelve el fallo, lo anota en el log sin el token y lo deja en el registro.
    expect(envio).toMatchObject({ ok: false, motivo: "fallo_del_proveedor", intentos: 3 });
    expect(aviso).toHaveBeenCalled();
    expect(aviso.mock.calls.flat().join(" ")).not.toContain(token);
    expect(await mensajesPara(lead.correo!)).toEqual([]);
    const [fallida] = await filasDe(clave);
    expect(fallida).toMatchObject({ estado: "fallido", reintentable: true, intentos: 3, enviado_en: null, id_proveedor: null, destinatario: lead.correo });
    expect(fallida.ultimo_error).toContain("Mailpit no respondió");
    expect(JSON.stringify(fallida)).not.toContain(token);

    // El proceso de reintentos espera 2 minutos desde el último toque; vuelve el proveedor (Mailpit de verdad).
    await envejecer(clave);
    const resumen = await reintentarCorreosFallidos({
      cliente: fx.admin,
      reconstructores: RECONSTRUCTORES,
      enviar: enviarCorreoDesdeServidor,
      lote: 50,
    });

    expect(resumen.enviados).toBeGreaterThanOrEqual(1);
    const filas = await filasDe(clave);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: fallida.id, estado: "enviado", intentos: 4, ultimo_error: null, reintentable: false });
    const mensajes = await mensajesPara(lead.correo!);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].Subject).toBe("Tus resultados del diagnóstico de Materia de prueba");
    expect(tokenDe(mensajes[0])).toBe(token);
    expect(mensajes[0].Text).toContain(`${SITIO}/resultados?token=${token}`);
    expect(filas[0].id_proveedor).toBe(mensajes[0].ID);

    // Otra corrida no lo manda de nuevo.
    await reintentarCorreosFallidos({ cliente: fx.admin, reconstructores: RECONSTRUCTORES, enviar: enviarCorreoDesdeServidor, lote: 50 });
    expect(await mensajesPara(lead.correo!)).toHaveLength(1);
    expect(await filasDe(clave)).toMatchObject([{ estado: "enviado", intentos: 4 }]);
  });

  it("si el Lead se queda sin correo antes del reintento, el correo ya no aplica y no se manda", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const contexto = await fx.crearEvaluacion();
    // Con teléfono, para que después pueda quedarse sin correo (la base exige uno de los dos).
    const lead = await crearLeadDePrueba({ telefono: `+57300${randomInt(1_000_000, 9_999_999)}` });
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });
    const clave = claveDeCorreo("recuperacion_diagnostico", diagnostico.id);
    await mandarEnlaceDeResultados(diagnostico.id, { enviar: enviarConProveedorCaido });
    expect((await filasDe(clave))[0]).toMatchObject({ estado: "fallido", reintentable: true });
    exito(await fx.admin.from("lead").update({ correo: null }).eq("id", lead.id).select("id").single(), "quitar el correo del Lead");
    await envejecer(clave);

    const resumen = await reintentarCorreosFallidos({ cliente: fx.admin, reconstructores: RECONSTRUCTORES, enviar: enviarCorreoDesdeServidor, lote: 50 });

    expect(resumen.descartados).toBeGreaterThanOrEqual(1);
    expect((await filasDe(clave))[0]).toMatchObject({ estado: "fallido", reintentable: false });
    expect(await mensajesPara(lead.correo!)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Leer por el token
// ---------------------------------------------------------------------------------------------------------------

describe("criterios 6, 7 y 8: leer el resultado por su token", () => {
  it("el token del correo da el resultado del diagnóstico: la materia, la Evaluación y lo guardado, sin el token ni datos del Lead", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });
    await mandarEnlaceDeResultados(diagnostico.id);
    const [mensaje] = await mensajesPara(lead.correo!);
    const token = tokenDe(mensaje);

    const resultado = await leerResultadoPorToken(token);

    expect(resultado).toMatchObject({
      idDiagnostico: diagnostico.id,
      materia: { codigo: contexto.materia.codigo, nombre: "Materia de prueba" },
      evaluacion: { nombre: "Parcial de prueba" },
      respondidas: 2,
      aciertos: 1,
      habilidades: [],
      errores: [],
      prerrequisitos: [],
    });
    expect(new Date(resultado!.fecha).getTime()).toBe(new Date(diagnostico.fecha_realizacion).getTime());
    // Ni el token, ni el Lead, ni lo interno llegan a lo que se pinta.
    const texto = JSON.stringify(resultado);
    for (const prohibido of [token, lead.id, lead.correo!, "semilla", "respuestas", "token", "puntaje", "faltaMaterial", "repetido"]) {
      expect(texto.includes(prohibido), `llegó a lo que ve la persona: ${prohibido}`).toBe(false);
    }
  });

  it("un token inexistente, vacío, con mala forma, repetido, en mayúsculas o el id del diagnóstico no devuelve nada", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });
    const token = await tokenDeDiagnostico(diagnostico.id);
    expect(await leerResultadoPorToken(token)).not.toBeNull();

    for (const malo of ["a".repeat(64), "", "basura", diagnostico.id, token.toUpperCase(), token.slice(1), `${token}0`, [token, token], undefined, null, 42]) {
      expect(await leerResultadoPorToken(malo), String(malo)).toBeNull();
    }
  });

  it("el token de un diagnóstico sin Lead no sirve", async () => {
    const contexto = await fx.crearEvaluacion();
    const sesion = await fx.crearUsuario();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idSesionAnonima: sesion.id });

    expect(await leerResultadoPorToken(await tokenDeDiagnostico(diagnostico.id))).toBeNull();
  });

  it("al ligarse el diagnóstico a su Lead, el mismo token empieza a servir", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const sesion = await fx.crearUsuario();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idSesionAnonima: sesion.id });
    const token = await tokenDeDiagnostico(diagnostico.id);
    expect(await leerResultadoPorToken(token)).toBeNull();

    exito(await fx.admin.from("diagnostico").update({ id_lead: lead.id }).eq("id", diagnostico.id).select("id").single(), "ligar el diagnóstico al Lead");

    expect(await leerResultadoPorToken(token)).toMatchObject({ idDiagnostico: diagnostico.id });
  });

  it("con la Evaluación desactivada (o activa) el resultado se sigue leyendo, y no vence", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id }, hace(400 * DIA));
    const token = await tokenDeDiagnostico(diagnostico.id);
    const poner = async (activa: boolean) =>
      exito(await fx.admin.from("evaluacion").update({ activa }).eq("id", contexto.evaluacion.id).select("id").single(), "cambiar la Evaluación");

    await poner(true);
    expect(await leerResultadoPorToken(token), "activa").toMatchObject({ idDiagnostico: diagnostico.id, evaluacion: { nombre: "Parcial de prueba" } });
    await poner(false);
    expect(await leerResultadoPorToken(token), "desactivada").toMatchObject({ idDiagnostico: diagnostico.id, evaluacion: { nombre: "Parcial de prueba" } });
  });

  it("si el Lead se borra, el diagnóstico cae con él y el enlace deja de servir", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });
    const token = await tokenDeDiagnostico(diagnostico.id);
    expect(await leerResultadoPorToken(token)).not.toBeNull();

    exito(await fx.admin.from("lead").delete().eq("id", lead.id).select("id"), "borrar el Lead");

    expect(await leerResultadoPorToken(token)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Lo que una sesión no alcanza
// ---------------------------------------------------------------------------------------------------------------

describe("criterios 11 y 12: una sesión ajena y una sin sesión no obtienen el Lead, sus diagnósticos ni la función", () => {
  it("filtrando por el correo o el teléfono del Lead, no ven ni el Lead ni sus diagnósticos", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba({ telefono: `+57300${randomInt(1_000_000, 9_999_999)}` });
    expect(lead.correo).not.toBeNull();
    expect(lead.numero_telefono).not.toBeNull();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });
    const sinSesion = crearCliente();

    for (const [quien, cliente] of [["sesión ajena", ajena.cliente], ["sin sesión", sinSesion]] as const) {
      // `data` queda vacío o nulo (y a veces hay un error de permisos): lo que importa es que no llega nada.
      const alLead = [
        await cliente.from("lead").select("id, correo, numero_telefono").eq("correo", lead.correo!),
        await cliente.from("lead").select("id, correo, numero_telefono").eq("numero_telefono", lead.numero_telefono!),
        await cliente.from("lead").select("id").eq("id", lead.id),
      ];
      for (const lectura of alLead) expect(lectura.data ?? [], `${quien}: lead`).toEqual([]);

      const aLosDiagnosticos = [
        await cliente.from("diagnostico").select("id, lead!inner(correo)").eq("lead.correo", lead.correo!),
        await cliente.from("diagnostico").select("id, lead!inner(numero_telefono)").eq("lead.numero_telefono", lead.numero_telefono!),
        await cliente.from("diagnostico").select("id").eq("id_lead", lead.id),
        await cliente.from("diagnostico").select("id").eq("id", diagnostico.id),
      ];
      for (const lectura of aLosDiagnosticos) expect(lectura.data ?? [], `${quien}: diagnostico`).toEqual([]);

      // El token no se lee con ninguna sesión: ni por su columna ni filtrando por él.
      const token = await cliente.from("diagnostico").select("token_recuperacion").eq("id", diagnostico.id);
      expect(token.error, `${quien}: token_recuperacion`).not.toBeNull();
      expect(token.data ?? []).toEqual([]);
    }
  });

  it("ninguna sesión, anónima ni sin sesión, llama a resultado_por_token por la Data API, ni con un token válido", async () => {
    const contexto = await fx.crearEvaluacion();
    const lead = await crearLeadDePrueba();
    const diagnostico = await crearDiagnosticoDePrueba(contexto, { idLead: lead.id });
    const token = await tokenDeDiagnostico(diagnostico.id);

    for (const [quien, cliente] of [["sesión ajena", ajena.cliente], ["sin sesión", crearCliente()]] as const) {
      for (const p_token of [token, "a".repeat(64), ""]) {
        const lectura = await cliente.rpc("resultado_por_token", { p_token });
        expect(lectura.error?.code, `${quien}: ${p_token === token ? "token válido" : p_token || "vacío"}`).toBe("42501");
        expect(lectura.data).toBeNull();
      }
    }
    // El servidor, con la llave secreta, sí la ejecuta.
    const delServidor = await fx.admin.rpc("resultado_por_token", { p_token: token });
    expect(delServidor.error).toBeNull();
    expect(delServidor.data).toHaveLength(1);
    expect(Object.keys(delServidor.data![0]).sort()).toEqual([
      "aciertos",
      "codigo_materia",
      "fecha_realizacion",
      "id_diagnostico",
      "nombre_evaluacion",
      "nombre_materia",
      "respondidas",
      "resultado",
    ]);
  });
});
