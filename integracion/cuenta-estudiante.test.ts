import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ponerContrasena, vincularCorreo } from "@/lib/auth/convertir";
import { leerMisCitas } from "@/lib/citas/servidor";
import { RUTA_CONFIRMAR_CUENTA, rutaDeCrearCuenta, tieneFormaDeTokenDeAuth } from "@/lib/cuentas/reglas";
import {
  activarCuenta,
  anotarEnvio,
  confirmacionDeCorreoActiva,
  confirmarCorreoDeCuenta,
  leadTieneCuenta,
  olvidarLaGuardia,
  pedirCuentaDeEstudiante,
} from "@/lib/cuentas/servidor";
import { diaDelNegocio } from "@/lib/fechas";
import { CORREO_FIJO, CORREO_YA_FIJO, INICIA_SESION_PARA_CAMBIAR } from "@/lib/leads/avisos";
import { leerContacto } from "@/lib/leads/reglas";
import { leadDeLaSesion, registrarContacto } from "@/lib/leads/servidor";
import { diaIsoDeFecha } from "@/lib/plazos/motor";
import { CASILLA_TRATAMIENTO, leerConsentimiento, MARCADA } from "@/lib/privacidad/consentimiento";
import type { Database } from "@/lib/supabase/tipos";
import {
  crearCliente,
  exigirEntorno,
  exigirSupabaseLocal,
  exito,
  Fixtures,
  idsVisibles,
  iniciarSesionConClave,
  rolDe,
  TOKEN_CAPTCHA_DE_PRUEBA,
  type Cliente,
} from "./utilidades";

// HU-032 contra el Supabase LOCAL, con sesiones de Auth reales. Aquí se comprueba lo que la implementación SUPONE de Auth
// (el caso A es la prueba de humo, la primera que se escribió) y lo que une a Auth con la base: que un usuario anónimo
// recibe el correo de cambio de correo y sigue anónimo hasta confirmarlo; que confirmarlo lo convierte sin cambiar de id;
// que el cierre de las demás sesiones cierra su renovación; que `crear_estudiante` solo crea el rol con el correo
// confirmado y el del Lead; los topes de envío; y la espera de verdad de las dos conexiones del caso H.
//
// El stack tiene que correr con `enable_confirmations = true` y la plantilla de cambio de correo (supabase/config.toml):
// Auth lee esa configuración al arrancar, así que `npm run db:reiniciar` no la aplica; hace falta `npm run db:detener` y
// `npm run db:iniciar`. El primer caso lo dice en claro si no.
//
// El Auth local deja crear 150 sesiones anónimas por hora por IP y el resto de la suite ya usa muchas: cada prueba crea
// las que necesita (una o dos; el techo de 20 usa siete) y las borra al final con todo lo que cuelga de ellas.

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ASUNTO_DEL_CORREO = "Confirma tu correo para crear tu cuenta de Calibra";
const ASUNTO_DE_RECUPERAR = "Restablece tu contraseña de Calibra";
const ASUNTO_DE_VERIFICACION = "Confirma tu correo para agendar en Calibra";
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000032";

let fx: Fixtures;
let bd: pg.Client;
let mailpit: string;
/** Los correos de esta prueba, para vaciar su buzón. */
const correos = new Set<string>();
/** Las sesiones que creó la prueba, para borrar lo que anotaron los topes. */
const sesiones = new Set<string>();

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
});

afterAll(async () => {
  await bd?.end();
});

beforeEach(() => {
  fx = new Fixtures();
  olvidarLaGuardia();
  // Siempre Mailpit (nunca Resend ni Gmail) y un sitio conocido para los enlaces que arma la app.
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("SMTP_CONTRASENA", "");
  vi.stubEnv("CORREO_REMITENTE", "");
  vi.stubEnv("MAILPIT_URL", mailpit);
  vi.stubEnv("SITIO_URL", "https://calibra.test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  const errores: string[] = [];
  // Las filas de los topes se van en cascada con la sesión, pero se borran antes para no dejar el techo lleno si algo falla.
  if (sesiones.size) {
    await bd
      .query("delete from privado.envio_de_cuenta where id_sesion = any($1::uuid[])", [[...sesiones]])
      .catch((error: unknown) => errores.push(`borrar los envíos anotados: ${String(error)}`));
    sesiones.clear();
  }
  for (const correo of correos) {
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(() => undefined);
  }
  correos.clear();
  let falloDeFixtures: unknown;
  try {
    await fx.limpiar();
  } catch (error) {
    falloDeFixtures = error;
  }
  if (errores.length) throw new Error(`La limpieza dejó datos de prueba en la base local:\n- ${errores.join("\n- ")}`);
  if (falloDeFixtures) throw falloDeFixtures;
});

// ---------------------------------------------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------------------------------------------

/** Una sesión anónima real que la prueba borra al final. */
async function sesionAnonima() {
  const sesion = await fx.crearAnonimo();
  sesiones.add(sesion.id);
  return sesion;
}

/**
 * Una sesión anónima como la que abre la app: el cliente de `@supabase/ssr` usa PKCE, y con PKCE el `token_hash` del correo
 * lleva el prefijo `pkce_`. Nace como cualquier sesión de la prueba (la borra `fx.limpiar()`) y un cliente PKCE adopta su
 * sesión; el verificador del código vive en la memoria de ese cliente entre `updateUser` y `verifyOtp`.
 */
async function sesionAnonimaConPkce() {
  const base = await sesionAnonima();
  const { data } = await base.cliente.auth.getSession();
  if (!data.session) throw new Error("La sesión anónima no trae sesión.");
  const { url, llavePublica } = exigirEntorno();
  const cliente = createClient<Database>(url, llavePublica, { auth: { flowType: "pkce", persistSession: false, autoRefreshToken: false } });
  const adoptada = await cliente.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  if (adoptada.error) throw new Error(`setSession: ${adoptada.error.message}`);
  return { cliente: cliente as Cliente, id: base.id };
}

/** Un Lead de la sesión con un correo único; su buzón se vacía al final. */
async function leadDe(idSesion: string) {
  const lead = await fx.crearLeadDeSesion(idSesion);
  correos.add(lead.correo!);
  return lead;
}

type Mensaje = { ID: string; Subject: string; HTML: string; Text: string };

/** Los correos que hay en Mailpit para un destinatario, el más reciente primero. */
async function mensajesPara(correo: string): Promise<Mensaje[]> {
  correos.add(correo);
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all((messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje));
}

/** Espera (hasta 15 s) a que haya al menos `cuantos` correos con ese asunto para el destinatario. */
async function esperarCorreos(correo: string, asunto: string, cuantos = 1): Promise<Mensaje[]> {
  const limite = Date.now() + 15_000;
  for (;;) {
    const hallados = (await mensajesPara(correo)).filter((mensaje) => mensaje.Subject === asunto);
    if (hallados.length >= cuantos) return hallados;
    if (Date.now() > limite) throw new Error(`Debían llegar ${cuantos} correo(s) «${asunto}» a ${correo} y hay ${hallados.length}.`);
    await new Promise((listo) => setTimeout(listo, 250));
  }
}

/** El enlace del correo de la cuenta, desescapado, y su token_hash. */
function enlaceDe(mensaje: Mensaje): { enlace: URL; tokenHash: string } {
  const href = /href="([^"]*\/cuenta\/confirmar\?[^"]*)"/.exec(mensaje.HTML)?.[1];
  if (!href) throw new Error(`El correo no trae el enlace a /cuenta/confirmar:\n${mensaje.HTML}`);
  const enlace = new URL(href.replaceAll("&amp;", "&"));
  const tokenHash = enlace.searchParams.get("token_hash");
  if (!tokenHash) throw new Error(`El enlace no trae token_hash: ${enlace.href}`);
  return { enlace, tokenHash };
}

const dormir = (milisegundos: number) => new Promise((listo) => setTimeout(listo, milisegundos));

/** `AAAA-MM-DD` más `dias` días (aritmética de calendario, sin zona). */
function sumarDias(fecha: string, dias: number): string {
  const instante = new Date(`${fecha}T12:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

/** El primer lunes a cuatro semanas o más de hoy en Bogotá. */
function lunesLejano(): string {
  let fecha = sumarDias(diaDelNegocio(new Date()), 28);
  while (diaIsoDeFecha(fecha) !== 1) fecha = sumarDias(fecha, 1);
  return fecha;
}

type LeadDeLaPrueba = Awaited<ReturnType<typeof leadDe>>;

/**
 * Lo que una persona ya tiene antes de crear su cuenta: un diagnóstico de su sesión y una cita confirmada de su Lead
 * (la cita nace `pendiente_pago` y se confirma con un UPDATE, que es lo que dispara el trigger de la confirmación).
 */
async function sembrarHistorial(idSesion: string, lead: LeadDeLaPrueba) {
  const { materia, evaluacion } = await fx.crearEvaluacion();
  const diagnostico = await fx.crearDiagnostico({ idSesionAnonima: idSesion, idEvaluacion: evaluacion.id, idMateria: materia.id });
  const admin = await fx.crearAdmin();
  const contexto = await fx.crearContextoDeMonitoria(admin.id);
  const monitoria = await fx.crearMonitoria({ ...contexto, lead }, { fecha: lunesLejano(), estado: "pendiente_pago" });
  exito(await fx.admin.from("monitoria").update({ estado: "confirmada" }).eq("id", monitoria.id).select().single(), "confirmar la cita");
  await fx.admin.from("confirmacion_cita").update({ procesado_en: new Date().toISOString() }).eq("id_monitoria", monitoria.id).is("procesado_en", null);
  return { diagnostico, monitoria };
}

/** Lo que Auth y la base dicen de un usuario. */
async function usuarioDeAuth(id: string) {
  const { data, error } = await fx.admin.auth.admin.getUserById(id);
  if (error || !data.user) throw new Error(`getUserById: ${error?.message ?? "sin usuario"}`);
  return data.user;
}

const estudianteDe = async (id: string) => (await fx.admin.from("estudiante").select("id, id_lead").eq("id", id)).data ?? [];
const leadFila = async (id: string) => exito(await fx.admin.from("lead").select("*").eq("id", id).single(), "leer el Lead");
const enviosDe = async (idSesion: string) =>
  (await bd.query<{ n: string }>("select count(*)::text as n from privado.envio_de_cuenta where id_sesion = $1", [idSesion])).rows[0].n;

/**
 * Una sesión que ya pidió su cuenta: anónima, con Lead, con el correo de cambio pendiente y el `token_hash` del correo.
 * La prueba confirma (o no) a partir de aquí.
 */
async function cuentaPedida(opciones: { pkce?: boolean } = {}) {
  const sesion = opciones.pkce ? await sesionAnonimaConPkce() : await sesionAnonima();
  const lead = await leadDe(sesion.id);
  const correo = lead.correo!;
  expect(await vincularCorreo(sesion.cliente, correo)).toEqual({ ok: true });
  const [mensaje] = await esperarCorreos(correo, ASUNTO_DEL_CORREO);
  return { ...sesion, lead, correo, ...enlaceDe(mensaje) };
}

/** Confirma el correo desde un cliente sin sesión (otro dispositivo): el usuario ya no es anónimo y trae una sesión nueva. */
async function confirmarDesdeOtroDispositivo(tokenHash: string) {
  const nuevo = crearCliente();
  const resultado = await confirmarCorreoDeCuenta(nuevo, tokenHash);
  if (!resultado.ok) throw new Error(`No se pudo confirmar el correo: ${resultado.motivo}`);
  return { nuevo, ...resultado };
}

// ---------------------------------------------------------------------------------------------------------------
// A. La prueba de humo de Auth
// ---------------------------------------------------------------------------------------------------------------

describe("A. lo que la implementación supone de Auth con un usuario anónimo (prueba de humo)", () => {
  it("el stack corre con las confirmaciones de correo encendidas; si no, hay que reiniciarlo", async () => {
    const { url, llavePublica } = exigirEntorno();
    const respuesta = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: llavePublica } });
    const ajustes = (await respuesta.json()) as { mailer_autoconfirm?: boolean };

    expect(
      ajustes.mailer_autoconfirm,
      "Auth corre con enable_confirmations = false: corre npm run db:detener, npm run db:iniciar y npm run db:env (db:reiniciar no aplica config.toml)",
    ).toBe(false);
    // La guardia del servidor lee lo mismo.
    expect(await confirmacionDeCorreoActiva()).toBe(true);
  });

  it("pedir la cuenta manda un correo de Auth y el usuario sigue anónimo, sin Estudiante y con el Lead intacto; confirmarlo lo convierte con el mismo id", async () => {
    const { cliente, id } = await sesionAnonima();
    const lead = await leadDe(id);
    const { diagnostico, monitoria } = await sembrarHistorial(id, lead);
    const leadAntes = await leadFila(lead.id);

    // (6) PUT /user no pide token de CAPTCHA: el cliente no manda ninguno.
    expect(await vincularCorreo(cliente, lead.correo!)).toEqual({ ok: true });

    // (1) Sigue anónimo para Auth y para la base, sin Estudiante, y el Lead no cambió.
    const { data: usuario } = await cliente.auth.getUser();
    expect(usuario.user?.id).toBe(id);
    expect(usuario.user?.is_anonymous).toBe(true);
    expect(await rolDe(cliente)).toBe("anonimo");
    expect(await estudianteDe(id)).toEqual([]);
    expect(await leadFila(lead.id)).toEqual(leadAntes);
    // El correo queda como cambio pendiente: el usuario todavía no tiene correo.
    const pendiente = await usuarioDeAuth(id);
    expect(pendiente.email ?? "").toBe("");
    expect(pendiente.new_email).toBe(lead.correo);

    // (2) Sale UN correo, al correo del Lead, con el asunto de la HU y el enlace a /cuenta/confirmar.
    const mensajes = await esperarCorreos(lead.correo!, ASUNTO_DEL_CORREO);
    expect(mensajes).toHaveLength(1);
    const { enlace, tokenHash } = enlaceDe(mensajes[0]);
    expect(enlace.pathname).toBe(RUTA_CONFIRMAR_CUENTA);
    expect(enlace.searchParams.get("type")).toBe("email_change");
    expect(enlace.origin).toBe("http://localhost:3000");
    // La forma real del token_hash: la regla de la app la acepta (S15).
    expect(tieneFormaDeTokenDeAuth(tokenHash)).toBe(true);
    console.info(`[HU-032] forma del token_hash con el cliente de supabase-js (implícito): ${tokenHash.length} caracteres, prefijo «${tokenHash.slice(0, 5)}».`);
    expect(mensajes[0].HTML).toContain("Confirmar mi correo");
    expect(mensajes[0].HTML).toContain("no se crea ninguna cuenta");
    // El Lead conserva su correo: el cambio pendiente es del usuario de Auth, no del Lead.
    expect((await leadDeLaSesion(id))?.correo).toBe(lead.correo);

    // Leer el correo y abrir el enlace no gasta el token: sigue sirviendo después (criterio 3). Aquí no hay página; el
    // token solo se gasta con verifyOtp, que es lo que hace el botón.
    // (3) verifyOtp desde un segundo cliente sin sesión: el mismo id, ya no anónimo, correo confirmado igual al del Lead.
    const nuevo = crearCliente();
    const { data, error } = await nuevo.auth.verifyOtp({ type: "email_change", token_hash: tokenHash });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
    expect(data.user?.id).toBe(id);
    // (4) double_confirm_changes = true no pidió una segunda confirmación: de ser así seguiría anónimo.
    expect(data.user?.is_anonymous, "Auth pidió una segunda confirmación: el diseño de HU-032 depende de que no lo haga").toBe(false);
    expect(data.user?.email).toBe(lead.correo);
    expect(data.user?.email_confirmed_at).toBeTruthy();

    // Confirmar el correo no crea el rol: lo crea `crear_estudiante`. Antes de eso, mi_rol() es nulo (ni anónimo ni Estudiante).
    expect(await estudianteDe(id)).toEqual([]);
    expect(await rolDe(nuevo)).toBeNull();

    // El token se gastó: el mismo enlace ya no sirve (criterio 14).
    const repetido = await crearCliente().auth.verifyOtp({ type: "email_change", token_hash: tokenHash });
    expect(repetido.error).not.toBeNull();
    expect(repetido.error?.status).toBeGreaterThanOrEqual(400);
    expect(repetido.error?.status).toBeLessThan(500);

    // El id no cambió: el diagnóstico y la cita siguen siendo suyos.
    expect(await idsVisibles(nuevo, "diagnostico", "id", diagnostico.id)).toEqual([diagnostico.id]);
    expect((await leerMisCitas(nuevo)).map((cita) => cita.idMonitoria)).toEqual([monitoria.id]);
  });

  it("con PKCE (el cliente de la app) el token_hash lleva el prefijo y verifyOtp lo acepta sin el correo", async () => {
    const pedida = await cuentaPedida({ pkce: true });
    console.info(`[HU-032] forma del token_hash con PKCE: ${pedida.tokenHash.length} caracteres, prefijo «${pedida.tokenHash.slice(0, 5)}».`);

    // Con PKCE el valor lleva el prefijo de flujo; la regla de la app (`tieneFormaDeTokenDeAuth`) lo acepta (S15).
    expect(pedida.tokenHash.startsWith("pkce_")).toBe(true);
    expect(tieneFormaDeTokenDeAuth(pedida.tokenHash)).toBe(true);
    const { idUsuario } = await confirmarDesdeOtroDispositivo(pedida.tokenHash);
    expect(idUsuario).toBe(pedida.id);
    expect((await usuarioDeAuth(pedida.id)).is_anonymous).toBe(false);
  });

  it("pedir otra vez con el mismo correo antes de confirmar manda un correo nuevo y el enlace anterior deja de servir", async () => {
    const primera = await cuentaPedida();
    // `max_frequency = 1s`: Auth no manda dos correos al mismo usuario con menos de un segundo de diferencia.
    await dormir(1_300);
    expect(await vincularCorreo(primera.cliente, primera.correo)).toEqual({ ok: true });
    const mensajes = await esperarCorreos(primera.correo, ASUNTO_DEL_CORREO, 2);
    expect(mensajes).toHaveLength(2);
    const [reciente, anterior] = mensajes.map((mensaje) => enlaceDe(mensaje).tokenHash);
    expect(reciente).not.toBe(anterior);

    // Pedir otra vez cambia el token pendiente (Auth guarda uno solo): el enlace anterior ya no sirve, aunque no se haya usado,
    // y es el nuevo el que confirma. Quien abra el correo viejo ve «ya no sirve» y pide otro (criterio 14).
    expect(await confirmarCorreoDeCuenta(crearCliente(), anterior)).toEqual({ ok: false, motivo: "no_sirve" });
    expect((await usuarioDeAuth(primera.id)).is_anonymous).toBe(true);
    expect((await confirmarCorreoDeCuenta(crearCliente(), reciente)).ok).toBe(true);
    expect((await usuarioDeAuth(primera.id)).is_anonymous).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B. Las demás sesiones
// ---------------------------------------------------------------------------------------------------------------

describe("B. confirmar cierra las demás sesiones del usuario (criterio 5)", () => {
  it("el navegador que pidió la cuenta ya no puede renovar su sesión; el que confirmó sigue vivo", async () => {
    const { cliente: viejo, id, tokenHash } = await cuentaPedida();
    const { nuevo, tokenDeAcceso } = await confirmarDesdeOtroDispositivo(tokenHash);
    expect((await viejo.auth.refreshSession()).error).toBeNull();
    const tokenDelViejo = (await viejo.auth.getSession()).data.session!.access_token;

    expect(await activarCuenta(id, tokenDeAcceso)).toEqual({ ok: true });

    // Lo que se cierra es la renovación. Con llaves de firma asimétricas el token de acceso viejo sigue leyendo hasta que
    // vence (`jwt_expiry`): esta prueba NO afirma lo contrario (hecho 8 del SPEC).
    const renovacion = await viejo.auth.refreshSession();
    expect(renovacion.error, "la sesión vieja debía quedar sin poder renovarse").not.toBeNull();
    expect(renovacion.data.session).toBeNull();
    // Qué hace el Auth local con el token de acceso de una sesión cerrada. `getUser` pregunta a Auth por la sesión y falla;
    // `getClaims` (lo que usa `obtenerSesion`) verifica la firma y no pregunta cuando la llave es asimétrica: se anota cuál es
    // el caso del stack local, que decide qué puede afirmar la e2e.
    const lecturaDelViejo = await viejo.auth.getUser(tokenDelViejo);
    expect(lecturaDelViejo.error, "Auth debía rechazar la sesión cerrada al preguntarle por ella").not.toBeNull();
    const algoritmo = JSON.parse(Buffer.from(tokenDelViejo.split(".")[0], "base64url").toString("utf8")).alg;
    const claimsDelViejo = await viejo.auth.getClaims(tokenDelViejo);
    console.info(
      `[HU-032] firma del token de acceso: ${algoritmo}; getUser de la sesión cerrada: ${lecturaDelViejo.error?.message}; getClaims: ${claimsDelViejo.error ? `error ${claimsDelViejo.error.message}` : "pasa"}.`,
    );

    // La sesión que confirmó sigue viva y renueva.
    expect((await nuevo.auth.getUser()).data.user?.id).toBe(id);
    expect((await nuevo.auth.refreshSession()).error).toBeNull();
    expect(await rolDe(nuevo)).toBe("estudiante");
  });

  it("si el token que se le pasa no es válido, el cierre falla, no se crea el Estudiante y se puede repetir", async () => {
    const { id, tokenHash } = await cuentaPedida();
    const { tokenDeAcceso } = await confirmarDesdeOtroDispositivo(tokenHash);

    expect(await activarCuenta(id, "esto.no.es-un-token")).toEqual({ ok: false, motivo: "sesiones" });
    expect(await estudianteDe(id)).toEqual([]);

    expect(await activarCuenta(id, tokenDeAcceso)).toEqual({ ok: true });
    expect(await estudianteDe(id)).toHaveLength(1);
  });

  it("dos clics a la vez crean un solo Estudiante y los dos terminan bien: repetirlo no falla", async () => {
    const { id, tokenHash } = await cuentaPedida();
    const { tokenDeAcceso } = await confirmarDesdeOtroDispositivo(tokenHash);

    const resultados = await Promise.all([activarCuenta(id, tokenDeAcceso), activarCuenta(id, tokenDeAcceso)]);

    expect(resultados).toEqual([{ ok: true }, { ok: true }]);
    expect(await estudianteDe(id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// C. crear_estudiante con usuarios reales
// ---------------------------------------------------------------------------------------------------------------

describe("C. crear_estudiante con usuarios de Auth reales", () => {
  const crear = async (id: string) => exito(await fx.admin.rpc("crear_estudiante", { p_id_usuario: id }), "crear_estudiante");

  it("no_confirmada con el anónimo que tiene un cambio de correo pendiente: nadie recibe el rol sin confirmar su correo", async () => {
    const { id } = await cuentaPedida();

    expect(await crear(id)).toBe("no_confirmada");
    expect(await estudianteDe(id)).toEqual([]);
  });

  it("correo_distinto si el Lead cambió su correo después de pedir; el trigger todavía no actúa porque aún no hay Estudiante", async () => {
    const { id, lead, tokenHash } = await cuentaPedida();
    await confirmarDesdeOtroDispositivo(tokenHash);
    const otroCorreo = `otro-${randomUUID()}@calibra.test`;
    correos.add(otroCorreo);
    exito(await fx.admin.from("lead").update({ correo: otroCorreo }).eq("id", lead.id).select().single(), "cambiar el correo del Lead");

    expect(await crear(id)).toBe("correo_distinto");
    expect(await estudianteDe(id)).toEqual([]);
  });

  it("creada con el correo confirmado y el del Lead, repetida da creada y deja una sola fila, y mi_rol() pasa de anónimo a Estudiante", async () => {
    const { cliente: viejo, id, lead, tokenHash } = await cuentaPedida();
    expect(await rolDe(viejo)).toBe("anonimo");
    const leadAntes = await leadFila(lead.id);

    const { nuevo } = await confirmarDesdeOtroDispositivo(tokenHash);
    expect(await crear(id)).toBe("creada");
    expect(await crear(id)).toBe("creada");

    expect(await estudianteDe(id)).toEqual([{ id, id_lead: lead.id }]);
    expect(await rolDe(nuevo)).toBe("estudiante");
    // El estado del Lead no cambia (RN-09): ser Estudiante se deduce de que exista la fila.
    expect(await leadFila(lead.id)).toEqual(leadAntes);
  });

  it("ya_tiene_cuenta con una segunda sesión ligada al mismo Lead; sin_lead con un usuario sin Lead", async () => {
    const { id, lead, tokenHash } = await cuentaPedida();
    await confirmarDesdeOtroDispositivo(tokenHash);
    expect(await crear(id)).toBe("creada");

    // Un segundo usuario confirmado, con otro correo, ligado al mismo Lead por el enlace de P-23.
    const segundo = await fx.crearUsuario();
    exito(await fx.admin.from("lead_sesion").insert({ id_sesion: segundo.id, id_lead: lead.id }).select().single(), "ligar la segunda sesión");
    expect(await crear(segundo.id)).toBe("ya_tiene_cuenta");
    expect(await estudianteDe(segundo.id)).toEqual([]);

    const sinLead = await fx.crearUsuario();
    expect(await crear(sinLead.id)).toBe("sin_lead");
    expect(await crear(ID_INEXISTENTE)).toBe("no_confirmada");
    expect(await leadTieneCuenta(lead.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D. Nada se pierde
// ---------------------------------------------------------------------------------------------------------------

describe("D. el diagnóstico y la cita siguen siendo suyos, y se entra desde otro dispositivo", () => {
  it("antes y después de crear la cuenta, con el cliente que convirtió y con uno nuevo que entra con correo y contraseña", async () => {
    const { cliente: viejo, id, lead, correo, tokenHash } = await cuentaPedida();
    const { diagnostico, monitoria } = await sembrarHistorial(id, lead);
    expect(await idsVisibles(viejo, "diagnostico", "id", diagnostico.id)).toEqual([diagnostico.id]);
    expect((await leerMisCitas(viejo)).map((cita) => cita.idMonitoria)).toEqual([monitoria.id]);

    const { nuevo, tokenDeAcceso } = await confirmarDesdeOtroDispositivo(tokenHash);
    expect(await activarCuenta(id, tokenDeAcceso)).toEqual({ ok: true });

    // Un Estudiante que nunca eligió contraseña recibe el correo de recuperar, aunque nunca haya tenido una.
    const sinContrasena = crearCliente();
    expect((await sinContrasena.auth.resetPasswordForEmail(correo, { captchaToken: TOKEN_CAPTCHA_DE_PRUEBA })).error).toBeNull();
    const recuperar = await esperarCorreos(correo, ASUNTO_DE_RECUPERAR);
    expect(recuperar[0].HTML).toContain("/auth/confirmar?token_hash=");

    // Elige su contraseña con la sesión que confirmó, sin cerrarla.
    const contrasena = `Clave-${randomUUID()}`;
    expect(await ponerContrasena(nuevo, contrasena)).toEqual({ ok: true });
    expect((await nuevo.auth.getUser()).data.user?.id).toBe(id);
    expect(await ponerContrasena(nuevo, "1234567")).toEqual({ ok: false, codigo: "weak_password" });

    // Desde otro dispositivo: el mismo usuario, el mismo rol, las mismas filas por RLS y las mismas citas.
    const otroDispositivo = await iniciarSesionConClave(correo, contrasena);
    const { data: usuario } = await otroDispositivo.auth.getUser();
    expect(usuario.user?.id).toBe(id);
    expect(usuario.user?.is_anonymous).toBe(false);
    for (const cliente of [nuevo, otroDispositivo]) {
      expect(await rolDe(cliente)).toBe("estudiante");
      expect(await idsVisibles(cliente, "diagnostico", "id", diagnostico.id)).toEqual([diagnostico.id]);
      expect(await idsVisibles(cliente, "lead", "id", lead.id)).toEqual([lead.id]);
      const citas = await leerMisCitas(cliente);
      expect(citas.map((cita) => cita.idMonitoria)).toEqual([monitoria.id]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// F. email_exists
// ---------------------------------------------------------------------------------------------------------------

describe("F. un correo que ya es de otra cuenta de Auth (un monitor o un admin)", () => {
  it("vincularCorreo da email_exists; el pedido responde lo mismo que un envío normal y no queda ningún cambio pendiente", async () => {
    const monitor = await fx.crearMonitor();
    correos.add(monitor.correo);
    const { cliente, id } = await sesionAnonima();
    const lead = await leadDe(id);
    exito(await fx.admin.from("lead").update({ correo: monitor.correo }).eq("id", lead.id).select().single(), "poner el correo del monitor al Lead");

    expect(await vincularCorreo(cliente, monitor.correo)).toEqual({ ok: false, codigo: "email_exists" });

    const pedido = await pedirCuentaDeEstudiante(cliente, { idSesion: id, lead: { correo: monitor.correo } });
    expect(pedido).toEqual({ resultado: "enviado" });
    expect(await enviosDe(id)).toBe("1");
    // Nada pendiente en Auth, nada en el buzón del monitor, y la sesión sigue siendo anónima.
    const usuario = await usuarioDeAuth(id);
    expect(usuario.is_anonymous).toBe(true);
    expect(usuario.new_email ?? "").toBe("");
    expect((await mensajesPara(monitor.correo)).filter((mensaje) => mensaje.Subject === ASUNTO_DEL_CORREO)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// G. Topes
// ---------------------------------------------------------------------------------------------------------------

describe("G. los topes de envío", () => {
  it("tras 3 pedidos el cuarto no llama a Auth; envejecidas las filas una hora, vuelve a pasar", async () => {
    const { cliente, id } = await sesionAnonima();
    const lead = await leadDe(id);
    for (let i = 0; i < 3; i++) expect(await anotarEnvio(id)).toBe("ok");
    const actualizar = vi.spyOn(cliente.auth, "updateUser");

    expect(await pedirCuentaDeEstudiante(cliente, { idSesion: id, lead })).toEqual({ resultado: "tope", cual: "sesion" });
    expect(actualizar).not.toHaveBeenCalled();
    expect(await enviosDe(id)).toBe("3");
    expect((await mensajesPara(lead.correo!)).filter((mensaje) => mensaje.Subject === ASUNTO_DEL_CORREO)).toEqual([]);

    // Lo anotado justo hace una hora ya no cuenta (el borde de HU-075).
    await bd.query("update privado.envio_de_cuenta set enviado_en = now() - interval '1 hour' where id_sesion = $1", [id]);
    expect(await pedirCuentaDeEstudiante(cliente, { idSesion: id, lead })).toEqual({ resultado: "enviado" });
    expect(actualizar).toHaveBeenCalledTimes(1);
    expect(await enviosDe(id)).toBe("1");
    await esperarCorreos(lead.correo!, ASUNTO_DEL_CORREO);
  });

  it("el techo de 20 entre todas las sesiones: 7 sesiones piden 3 veces a la vez y quedan exactamente 20", async () => {
    await bd.query("delete from privado.envio_de_cuenta");
    const siete = await Promise.all(Array.from({ length: 7 }, () => sesionAnonima()));

    const respuestas = await Promise.all(siete.flatMap(({ id }) => [anotarEnvio(id), anotarEnvio(id), anotarEnvio(id)]));

    expect(respuestas.filter((respuesta) => respuesta === "ok")).toHaveLength(20);
    expect(respuestas.filter((respuesta) => respuesta === "tope_global")).toHaveLength(1);
    const { rows } = await bd.query<{ n: string }>("select count(*)::text as n from privado.envio_de_cuenta");
    expect(rows[0].n).toBe("20");

    // Con el techo lleno, una sesión nueva no puede pedir ni llama a Auth.
    const { cliente, id } = await sesionAnonima();
    const lead = await leadDe(id);
    const actualizar = vi.spyOn(cliente.auth, "updateUser");
    expect(await pedirCuentaDeEstudiante(cliente, { idSesion: id, lead })).toEqual({ resultado: "tope", cual: "total" });
    expect(actualizar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// H. Concurrencia con dos conexiones
// ---------------------------------------------------------------------------------------------------------------

describe("H. crear la cuenta y cambiar el correo a la vez (la espera de verdad)", () => {
  let a: pg.Client;
  let b: pg.Client;

  beforeEach(async () => {
    a = new pg.Client({ connectionString: URL_BD });
    b = new pg.Client({ connectionString: URL_BD });
    await Promise.all([a.connect(), b.connect()]);
  });

  afterEach(async () => {
    await Promise.all([a.query("rollback").catch(() => undefined), b.query("rollback").catch(() => undefined)]);
    await Promise.all([a.end(), b.end()]);
  });

  /** Un usuario confirmado y un Lead suyo con el mismo correo, listo para `crear_estudiante`. */
  async function usuarioListo() {
    const usuario = await fx.crearUsuario();
    const lead = await fx.crearLeadDeSesion(usuario.id);
    correos.add(usuario.correo);
    exito(await fx.admin.from("lead").update({ correo: usuario.correo }).eq("id", lead.id).select().single(), "poner el correo del usuario al Lead");
    return { usuario, lead };
  }

  /** ¿Terminó la promesa antes de `ms`? */
  const terminaAntesDe = (promesa: Promise<unknown>, ms: number) =>
    Promise.race([promesa.then(() => true, () => true), dormir(ms).then(() => false)]);

  it("A crea la cuenta sin confirmar; B intenta cambiar el correo y espera; al confirmar A, B recibe el rechazo del trigger", async () => {
    const { usuario, lead } = await usuarioListo();
    await a.query("begin");
    await a.query("set local role service_role");
    expect((await a.query("select public.crear_estudiante($1) as r", [usuario.id])).rows[0].r).toBe("creada");

    await b.query("begin");
    const cambio = b.query("update public.lead set correo = $1 where id = $2", [`otro-${randomUUID()}@calibra.test`, lead.id]);
    const resultado = cambio.then(
      () => null,
      (error: { code?: string; message?: string }) => error,
    );
    // El cambio espera: A tiene bloqueada la fila del Lead (el `for update` de crear_estudiante).
    expect(await terminaAntesDe(cambio, 400), "el cambio de correo no debía terminar mientras A no confirma").toBe(false);

    await a.query("commit");
    const error = await resultado;
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("lead_correo_fijo_con_cuenta");
    await b.query("rollback");
    expect((await leadFila(lead.id)).correo).toBe(usuario.correo);
    expect(await estudianteDe(usuario.id)).toHaveLength(1);
  });

  it("al revés: B cambia el correo y confirma primero, y A recibe correo_distinto sin crear nada", async () => {
    const { usuario, lead } = await usuarioListo();
    const nuevoCorreo = `otro-${randomUUID()}@calibra.test`;
    correos.add(nuevoCorreo);
    await b.query("begin");
    await b.query("update public.lead set correo = $1 where id = $2", [nuevoCorreo, lead.id]);

    await a.query("begin");
    await a.query("set local role service_role");
    const creacion = a.query("select public.crear_estudiante($1) as r", [usuario.id]);
    expect(await terminaAntesDe(creacion, 400), "crear_estudiante no debía terminar mientras B no confirma").toBe(false);

    await b.query("commit");
    expect((await creacion).rows[0].r).toBe("correo_distinto");
    await a.query("commit");
    expect(await estudianteDe(usuario.id)).toEqual([]);
    expect((await leadFila(lead.id)).correo).toBe(nuevoCorreo);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// I. Permisos por la Data API
// ---------------------------------------------------------------------------------------------------------------

describe("I. ninguna sesión crea Estudiantes ni anota envíos por la Data API", () => {
  it("anónimo, Estudiante, monitor y sin sesión reciben un error de permisos", async () => {
    const { cliente: anonimo, id } = await sesionAnonima();
    const estudiante = await fx.crearEstudiante();
    const monitor = await fx.crearMonitor();
    const clientes: [string, Cliente][] = [
      ["sin sesión", crearCliente()],
      ["anónimo", anonimo],
      ["Estudiante", await fx.iniciarSesion(estudiante)],
      ["monitor", await fx.iniciarSesion(monitor)],
    ];

    for (const [quien, cliente] of clientes) {
      const crearRpc = await cliente.rpc("crear_estudiante", { p_id_usuario: id });
      expect(crearRpc.error?.code, `${quien}: crear_estudiante`).toBe("42501");
      const anotarRpc = await cliente.rpc("anotar_envio_de_cuenta", { p_id_sesion: id });
      expect(anotarRpc.error?.code, `${quien}: anotar_envio_de_cuenta`).toBe("42501");
      const insertar = await cliente.from("estudiante").insert({ id, id_lead: randomUUID() });
      expect(insertar.error, `${quien}: insert en estudiante`).not.toBeNull();
    }
    expect(await estudianteDe(id)).toEqual([]);
    // Los parámetros sí son de lectura para las sesiones con cuenta, y no revelan nada más que los tres números.
    const parametros = await (await fx.iniciarSesion(monitor)).rpc("parametros_cuenta");
    expect(parametros.data).toEqual([{ tope_envios_sesion: 3, tope_envios_total: 20, ventana_min: 60 }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// J. P-23 desde /cuenta/crear
// ---------------------------------------------------------------------------------------------------------------

describe("J. el correo de otro Lead desde /cuenta/crear manda el enlace de P-23 y no llama a Auth", () => {
  it("el enlace vuelve a /cuenta/crear, no se crea Lead y no sale el correo de la cuenta", async () => {
    const { cliente, id } = await sesionAnonima();
    const ajeno = `ajeno-${randomUUID()}@calibra.test`;
    correos.add(ajeno);
    const dueno = exito(
      await fx.admin
        .from("lead")
        .insert({ nombre: "Lead Ajeno", correo: ajeno, acepta_tratamiento_datos: true, fecha_consentimiento: new Date().toISOString() })
        .select("id")
        .single(),
      "crear el Lead dueño del correo",
    );
    fx.registrarLead(dueno.id);
    const actualizar = vi.spyOn(cliente.auth, "updateUser");
    const formulario = new FormData();
    formulario.set("nombre", "Otra Persona");
    formulario.set("correo", ` ${ajeno.toUpperCase()}`);
    formulario.set(CASILLA_TRATAMIENTO, MARCADA);
    const contacto = leerContacto(formulario);
    const consentimiento = leerConsentimiento(formulario);
    if (!contacto.ok || !consentimiento.ok) throw new Error("el formulario de la prueba no es válido");

    const resultado = await registrarContacto({
      idSesion: id,
      contacto: contacto.datos,
      consentimiento: consentimiento.consentimiento,
      origen: null,
      siguiente: rutaDeCrearCuenta("/privacidad"),
    });

    expect(resultado).toEqual({ resultado: "verificar", envio: "enviado" });
    expect(await leadDeLaSesion(id)).toBeNull();
    const verificaciones = exito(await fx.admin.from("verificacion_lead").select("siguiente").eq("id_lead", dueno.id), "leer el enlace");
    expect(verificaciones).toEqual([{ siguiente: "/cuenta/crear?siguiente=%2Fprivacidad" }]);
    const mensajes = await esperarCorreos(ajeno, ASUNTO_DE_VERIFICACION);
    expect(mensajes).toHaveLength(1);
    expect((await mensajesPara(ajeno)).filter((mensaje) => mensaje.Subject === ASUNTO_DEL_CORREO)).toEqual([]);
    expect(actualizar).not.toHaveBeenCalled();
    expect(await enviosDe(id)).toBe("0");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// K. El correo de un Lead con cuenta queda fijo (D-55 b)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Lo que la acción de contacto le pasa a `registrarContacto` con un formulario válido: el contacto y la autorización se
 * leen con las mismas funciones de la app, y el buzón del correo se vacía al final.
 */
function entradaDeContacto(idSesion: string, campos: { correo: string; nombre?: string; telefono?: string }) {
  const formulario = new FormData();
  formulario.set("nombre", campos.nombre ?? "Cambiado");
  formulario.set("correo", campos.correo);
  if (campos.telefono) formulario.set("numero_telefono", campos.telefono);
  formulario.set(CASILLA_TRATAMIENTO, MARCADA);
  const contacto = leerContacto(formulario);
  const consentimiento = leerConsentimiento(formulario);
  if (!contacto.ok || !consentimiento.ok) throw new Error("el formulario de la prueba no es válido");
  correos.add(contacto.datos.correo);
  return { idSesion, contacto: contacto.datos, consentimiento: consentimiento.consentimiento, origen: null, siguiente: "/" };
}

describe("K. D-55 b: el correo de un Lead con cuenta queda fijo", () => {
  it("la propia cuenta que manda otro correo por fuera de la pantalla recibe el mensaje del correo fijo (el trigger) y el Lead no cambia", async () => {
    const { id, lead, tokenHash } = await cuentaPedida();
    const { tokenDeAcceso } = await confirmarDesdeOtroDispositivo(tokenHash);
    expect(await activarCuenta(id, tokenDeAcceso)).toEqual({ ok: true });
    const antes = await leadFila(lead.id);

    // La sesión es la cuenta: pasa la guarda de «solo la cuenta cambia un Lead con cuenta» y llega al trigger.
    const resultado = await registrarContacto(entradaDeContacto(id, { correo: `nuevo-${randomUUID()}@calibra.test` }));

    expect(resultado).toEqual({ resultado: "error", error: CORREO_FIJO });
    expect(await leadFila(lead.id)).toEqual(antes);
  });

  it("revisión, hallazgo 2: la sesión ligada por P-23 a un Lead con cuenta no cambia sus datos: responde que inicie sesión y el Lead no cambia", async () => {
    const { id, lead, tokenHash } = await cuentaPedida();
    const { tokenDeAcceso } = await confirmarDesdeOtroDispositivo(tokenHash);
    expect(await activarCuenta(id, tokenDeAcceso)).toEqual({ ok: true });
    // Otra sesión ligada al Lead por el enlace de P-23: no es la cuenta, ni `estudiante`, ni pasa por la guarda de procesarContacto.
    const ligada = await fx.crearUsuario();
    exito(await fx.admin.from("lead_sesion").insert({ id_sesion: ligada.id, id_lead: lead.id }).select().single(), "ligar la segunda sesión");
    const antes = await leadFila(lead.id);

    const conOtroCorreo = await registrarContacto(entradaDeContacto(ligada.id, { correo: `nuevo-${randomUUID()}@calibra.test` }));
    const conElMismo = await registrarContacto(entradaDeContacto(ligada.id, { correo: lead.correo!, nombre: "Cambiado", telefono: "3001234567" }));

    expect(conOtroCorreo).toEqual({ resultado: "error", error: INICIA_SESION_PARA_CAMBIAR });
    expect(conElMismo).toEqual({ resultado: "error", error: INICIA_SESION_PARA_CAMBIAR });
    expect(await leadFila(lead.id)).toEqual(antes);
  });

  it("un 23514 que no es el del trigger (otro CHECK del Lead) no se toma por el correo fijo: el error sube", async () => {
    const { id } = await sesionAnonima();
    const lead = await leadDe(id);
    const antes = await leadFila(lead.id);
    const formulario = new FormData();
    formulario.set("nombre", "Cambiado");
    formulario.set("correo", `nuevo-${randomUUID()}@calibra.test`);
    formulario.set(CASILLA_TRATAMIENTO, MARCADA);
    const contacto = leerContacto(formulario);
    const consentimiento = leerConsentimiento(formulario);
    if (!contacto.ok || !consentimiento.ok) throw new Error("el formulario de la prueba no es válido");
    // Con mayúsculas, el correo viola `lead_correo_normalizado` (23514), que no es el trigger de HU-032: la acción real
    // siempre lo normaliza, así que aquí se salta esa lectura para llegar a la base.
    const sinNormalizar = contacto.datos.correo.toUpperCase();
    correos.add(contacto.datos.correo);

    await expect(
      registrarContacto({
        idSesion: id,
        contacto: { ...contacto.datos, correo: sinNormalizar },
        consentimiento: consentimiento.consentimiento,
        origen: null,
        siguiente: "/",
      }),
    ).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("lead_correo_normalizado") });
    expect(await leadFila(lead.id)).toEqual(antes);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// L. Los textos y los enlaces inválidos con Auth de verdad
// ---------------------------------------------------------------------------------------------------------------

describe("L. un enlace usado, vencido o inventado", () => {
  it("confirmarCorreoDeCuenta dice «no_sirve» (un 4xx de Auth) y no cambia nada", async () => {
    const { id, tokenHash } = await cuentaPedida();

    expect((await confirmarCorreoDeCuenta(crearCliente(), tokenHash)).ok).toBe(true);
    expect(await confirmarCorreoDeCuenta(crearCliente(), tokenHash)).toEqual({ ok: false, motivo: "no_sirve" });
    expect(await confirmarCorreoDeCuenta(crearCliente(), `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`)).toEqual({
      ok: false,
      motivo: "no_sirve",
    });
    expect(await confirmarCorreoDeCuenta(crearCliente(), `pkce_${randomUUID().replaceAll("-", "")}`)).toEqual({ ok: false, motivo: "no_sirve" });
    expect(await estudianteDe(id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// M. Revisión de HU-032: lo que cambia el trigger del correo, la guarda de la cuenta y la guardia de Auth
// ---------------------------------------------------------------------------------------------------------------

describe("M. revisión de HU-032: quién cambia el correo y los datos de un Lead, y cuándo se activa la cuenta", () => {
  it("hallazgo 1: con una sesión ligada por P-23, la que creó el Lead ya no cambia su correo (el nombre y el teléfono sí)", async () => {
    const creadora = await sesionAnonima();
    const lead = await leadDe(creadora.id);
    // Antes del enlace el correo todavía es solo de quien lo escribió: lo cambia con normalidad.
    const primero = `primero-${randomUUID()}@calibra.test`;
    expect(await registrarContacto(entradaDeContacto(creadora.id, { correo: primero }))).toEqual({ resultado: "lead" });
    expect((await leadFila(lead.id)).correo).toBe(primero);

    // Su dueña lo confirma desde otro navegador: `confirmar_correo_de_lead` deja una fila de lead_sesion.
    const duena = await sesionAnonima();
    exito(await fx.admin.from("lead_sesion").insert({ id_sesion: duena.id, id_lead: lead.id }).select().single(), "ligar la sesión de la dueña");
    const antes = await leadFila(lead.id);

    // Quien lo escribió primero ya no lo cambia por el suyo, ni la sesión de la dueña tampoco.
    const delOtro = `otro-${randomUUID()}@calibra.test`;
    expect(await registrarContacto(entradaDeContacto(creadora.id, { correo: delOtro }))).toEqual({ resultado: "error", error: CORREO_YA_FIJO });
    expect(await registrarContacto(entradaDeContacto(duena.id, { correo: delOtro }))).toEqual({ resultado: "error", error: CORREO_YA_FIJO });
    expect(await leadFila(lead.id)).toEqual(antes);

    // Con el mismo correo, el nombre y el teléfono se siguen actualizando.
    expect(await registrarContacto(entradaDeContacto(creadora.id, { correo: primero, nombre: "Nombre nuevo", telefono: "3001234567" }))).toEqual({
      resultado: "lead",
    });
    expect(await leadFila(lead.id)).toMatchObject({ nombre: "Nombre nuevo", numero_telefono: "+573001234567", correo: primero });
  });

  it("hallazgo 1: la base misma rechaza el cambio (23514, lead_correo_fijo_confirmado), también al pasar de nulo a un correo; el nulo y el resto de columnas quedan libres", async () => {
    const creadora = await sesionAnonima();
    const lead = await leadDe(creadora.id);
    const duena = await sesionAnonima();
    exito(await fx.admin.from("lead_sesion").insert({ id_sesion: duena.id, id_lead: lead.id }).select().single(), "ligar la sesión de la dueña");

    const cambio = await fx.admin.from("lead").update({ correo: `otro-${randomUUID()}@calibra.test` }).eq("id", lead.id);
    expect(cambio.error).toMatchObject({ code: "23514", message: expect.stringContaining("lead_correo_fijo_confirmado") });
    expect((await leadFila(lead.id)).correo).toBe(lead.correo);

    exito(await fx.admin.from("lead").update({ nombre: "Otro nombre" }).eq("id", lead.id).select().single(), "cambiar el nombre");
    // Con el correo nulo el Lead necesita un teléfono (lead_tiene_contacto); `leadDe` no lo pone.
    exito(await fx.admin.from("lead").update({ numero_telefono: "+573001234567", correo: null }).eq("id", lead.id).select().single(), "pasar el correo a nulo");
    const deVuelta = await fx.admin.from("lead").update({ correo: lead.correo }).eq("id", lead.id);
    expect(deVuelta.error).toMatchObject({ code: "23514", message: expect.stringContaining("lead_correo_fijo_confirmado") });
  });

  it("hallazgo 2: la sesión que creó el Lead de una cuenta ajena no cambia sus datos: responde que inicie sesión; la cuenta sí", async () => {
    const creadora = await sesionAnonima();
    const lead = await leadDe(creadora.id);
    // La cuenta es otro usuario: confirmó el correo del Lead desde otro navegador y `crear_estudiante` lo ligó.
    const cuenta = await fx.crearUsuario();
    exito(await fx.admin.from("estudiante").insert({ id: cuenta.id, id_lead: lead.id }).select().single(), "crear la cuenta del Lead");
    const antes = await leadFila(lead.id);

    const intento = await registrarContacto(entradaDeContacto(creadora.id, { correo: lead.correo!, nombre: "Cambiado por la sesión", telefono: "3001234567" }));

    expect(intento).toEqual({ resultado: "error", error: INICIA_SESION_PARA_CAMBIAR });
    expect(await leadFila(lead.id)).toEqual(antes);

    expect(await registrarContacto(entradaDeContacto(cuenta.id, { correo: lead.correo!, nombre: "Cambiado por la cuenta" }))).toEqual({ resultado: "lead" });
    expect((await leadFila(lead.id)).nombre).toBe("Cambiado por la cuenta");
  });

  it("hallazgo 3: si Auth no exige confirmar el correo, activarCuenta no da el rol aunque el usuario ya figure confirmado y con el correo del Lead", async () => {
    const { id, lead, tokenHash } = await cuentaPedida();
    // Con las confirmaciones encendidas (el stack de la prueba) Auth convierte al usuario al confirmar el correo. Lo que dejaría
    // `updateUser({ email })` con `mailer_autoconfirm` activo es el mismo usuario sin ninguna confirmación; solo cambia lo
    // que dice `/auth/v1/settings`, que aquí se simula y se deja pasar el resto de las llamadas.
    const { tokenDeAcceso } = await confirmarDesdeOtroDispositivo(tokenHash);
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (entrada: Parameters<typeof fetch>[0], opciones?: RequestInit) =>
      String(entrada instanceof Request ? entrada.url : entrada).endsWith("/auth/v1/settings")
        ? new Response(JSON.stringify({ mailer_autoconfirm: true }), { status: 200 })
        : real(entrada, opciones),
    );
    try {
      olvidarLaGuardia();
      expect(await activarCuenta(id, tokenDeAcceso)).toEqual({ ok: false, motivo: "sin_confirmacion" });
      expect(await estudianteDe(id)).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }

    // Con Auth como debe estar, el mismo paso crea la cuenta: la guardia no rompe el camino normal.
    olvidarLaGuardia();
    expect(await activarCuenta(id, tokenDeAcceso)).toEqual({ ok: true });
    expect(await estudianteDe(id)).toEqual([{ id, id_lead: lead.id }]);
  });
});
