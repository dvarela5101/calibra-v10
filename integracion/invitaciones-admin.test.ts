import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cargarBandeja } from "@/lib/admin/bandeja";
import { cargarEquipo, desactivarAdmin, moverAdmin, reactivarAdmin } from "@/lib/admin/equipo";
import {
  buscarInvitacionDeAdmin,
  cancelarInvitacionAbierta,
  invitarAdmin,
  listarInvitaciones,
  registrarAdmin,
  TEXTO_INVITACION_NO_SIRVE,
} from "@/lib/admin/invitaciones";
import { desactivarCuenta, reactivarCuenta } from "@/lib/auth/cuentas";
import { reintentarCorreosDesdeServidor } from "@/lib/correo/procesos";
import { conReintentoDeCaptcha, crearCliente, exigirSupabaseLocal, exito, Fixtures, iniciarSesionConClave, rolDe, TOKEN_CAPTCHA_DE_PRUEBA, type Cliente } from "./utilidades";

// HU-072 contra el Supabase LOCAL: la invitación se guarda de verdad, el correo sale por Mailpit, la cuenta se crea en
// Auth, la lista y la cancelación van con la sesión real de un admin, y la concurrencia se ejerce con dos conexiones pg
// crudas (la espera de verdad). Nada de esto toca el proyecto real.

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MINUTO = 60_000;
const DIA = 86_400_000;
const hace = (milisegundos: number) => new Date(Date.now() - milisegundos).toISOString();
const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

let fx: Fixtures;
let mailpit: string;
/** Correos de esta prueba: invitaciones, correo_envio, el admin que se registre con ellos y el buzón. */
const correos: string[] = [];

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
});

beforeEach(() => {
  fx = new Fixtures();
  // Siempre Mailpit (nunca Resend ni Gmail) y un sitio conocido para comprobar el enlace.
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("SMTP_CONTRASENA", "");
  vi.stubEnv("CORREO_REMITENTE", "");
  vi.stubEnv("MAILPIT_URL", mailpit);
  vi.stubEnv("SITIO_URL", "https://calibra.test");
  // Los fallos esperados (correo sin proveedor, usuario huérfano) se anotan en la consola; aquí no ensucian la salida.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const correo of correos.splice(0)) {
    // El registro de correos no cae en cascada con la invitación: se borra por su clave (invitacion_admin:<id>).
    const { data: invitaciones } = await fx.admin.from("invitacion_admin").select("id").eq("correo", correo);
    const claves = (invitaciones ?? []).map(({ id }) => `invitacion_admin:${id}`);
    if (claves.length) await fx.admin.from("correo_envio").delete().in("clave", claves);
    // Las invitaciones van antes que los admins que las hicieron (id_admin no cae en cascada).
    await fx.admin.from("invitacion_admin").delete().eq("correo", correo);
    // El admin que se registró con ese correo no lo conoce Fixtures: se busca por su correo. Su fila se va con el usuario.
    const { data: admins } = await fx.admin.from("admin").select("id").eq("correo", correo);
    for (const { id } of admins ?? []) await fx.admin.auth.admin.deleteUser(id);
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" });
  }
  await fx.limpiar();
});

function correoNuevo(): string {
  const correo = `nuevo-admin-${randomUUID()}@calibra.test`;
  correos.push(correo);
  return correo;
}

type Mensaje = { ID: string; Subject: string; Text: string };

async function mensajesPara(correo: string): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all(
    (messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje),
  );
}

/** El token del enlace de registro que trae el correo (la única copia del token que existe). */
function tokenDe(mensaje: Mensaje): string {
  const token = /\/admins\/registro\?token=([0-9a-f]{64})/.exec(mensaje.Text)?.[1];
  if (!token) throw new Error(`El correo no trae el enlace de registro:\n${mensaje.Text}`);
  return token;
}

async function invitacionesDe(correo: string) {
  return exito(await fx.admin.from("invitacion_admin").select("*").eq("correo", correo).order("creada_en").order("id"), `leer invitaciones de ${correo}`) as Awaited<
    ReturnType<typeof leerInvitacion>
  >[];
}

async function leerInvitacion(id: string) {
  return exito(await fx.admin.from("invitacion_admin").select("*").eq("id", id).single(), `leer la invitación ${id}`);
}

async function filaDeCorreo(clave: string) {
  return exito(await fx.admin.from("correo_envio").select("*").eq("clave", clave).single(), `leer correo_envio ${clave}`);
}

async function totalDeInvitaciones(): Promise<number> {
  const { count, error } = await fx.admin.from("invitacion_admin").select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function usuariosDeAuth(correo: string) {
  const { data, error } = await fx.admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.filter((u) => u.email === correo);
}

/** Invita, lee la fila y saca el token del correo. */
async function invitar(idAdmin: string, correo: string) {
  const anteriores = new Set((await mensajesPara(correo)).map((m) => m.ID));
  expect(await invitarAdmin(idAdmin, correo)).toEqual({ ok: true, correoEnviado: true });
  // La fila abierta (con una reinvitación hay una cancelada antes) y el correo nuevo (Mailpit los devuelve del más reciente al más viejo).
  const fila = (await invitacionesDe(correo)).find((f) => f.cancelada_en === null && f.usada_en === null)!;
  const mensaje = (await mensajesPara(correo)).find((m) => !anteriores.has(m.ID));
  if (!mensaje) throw new Error("No llegó el correo de la invitación.");
  return { fila, token: tokenDe(mensaje), mensaje };
}

/** Una invitación sembrada directo en la base, con un token que escoge la prueba (sin pasar por el correo). */
async function sembrar(idAdmin: string, correo = correoNuevo()) {
  const token = randomUUID().replaceAll("-", "").repeat(2);
  const fila = exito(
    await fx.admin.from("invitacion_admin").insert({ correo, token_hash: sha256(token), id_admin: idAdmin }).select().single(),
    "sembrar la invitación",
  );
  return { correo, token, fila };
}

const datos = (contrasena = `Clave-${randomUUID()}`) => ({ nombre: "Ana Registrada", contrasena });

/** Un admin con su sesión real y un nombre que se reconoce en el correo. */
async function adminConSesion(nombre = "Admin de prueba") {
  const admin = await fx.crearAdmin();
  if (nombre !== "Admin de prueba") exito(await fx.admin.from("admin").update({ nombre }).eq("id", admin.id).select().single(), "poner el nombre");
  return { admin, sesion: await fx.iniciarSesion(admin) };
}

// ---------------------------------------------------------------------------------------------------------------

describe("invitarAdmin (criterios 1 a 4 y 14)", () => {
  it("guarda el hash del token, vence a los 7 días y manda el enlace por correo con el nombre de quien invita", async () => {
    const { admin } = await adminConSesion("Invitadora Ana");
    const correo = correoNuevo();

    const { fila, token, mensaje } = await invitar(admin.id, correo);

    expect(fila.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fila.token_hash).not.toBe(token);
    expect(fila.token_hash).toBe(sha256(token));
    expect(fila).toMatchObject({ correo, id_admin: admin.id, usada_en: null, cancelada_en: null, id_admin_nuevo: null });
    const dias = (new Date(fila.vence_en).getTime() - new Date(fila.creada_en).getTime()) / DIA;
    expect(dias).toBeCloseTo(7, 3);

    const mensajes = await mensajesPara(correo);
    expect(mensajes).toHaveLength(1);
    expect(mensaje.Subject).toBe("Te invitaron al equipo de admins de Calibra");
    expect(mensaje.Subject).not.toContain("Ana");
    expect(mensaje.Text).toContain(`https://calibra.test/admins/registro?token=${token}`);
    expect(mensaje.Text).toContain("Invitadora Ana te invita al equipo de admins de Calibra.");
    // El token no queda en ninguna columna de la fila.
    expect(JSON.stringify(fila)).not.toContain(token);
    // El registro de correos lo anota con la clave de la plantilla y la invitación.
    expect(await filaDeCorreo(`invitacion_admin:${fila.id}`)).toMatchObject({ plantilla: "invitacion_admin", destinatario: correo, estado: "enviado" });
  });

  it("guarda el correo en minúsculas y sin espacios aunque llegue con mayúsculas", async () => {
    const { admin } = await adminConSesion();
    const correo = correoNuevo();
    expect(await invitarAdmin(admin.id, `  ${correo.toUpperCase()} `)).toEqual({ ok: true, correoEnviado: true });
    const [fila] = await invitacionesDe(correo);
    expect(fila.correo).toBe(correo);
  });

  it("rechaza, sin invitación ni correo, un correo de un admin activo, de uno desactivado, de un monitor y de quien invita", async () => {
    const { admin } = await adminConSesion();
    const otro = await fx.crearAdmin();
    const desactivado = await fx.crearAdmin();
    await desactivarCuenta(desactivado.id);
    const monitor = await fx.crearMonitor();
    const antes = await totalDeInvitaciones();

    expect(await invitarAdmin(admin.id, otro.correo)).toEqual({ ok: false, motivo: "es_admin" });
    expect(await invitarAdmin(admin.id, otro.correo.toUpperCase())).toEqual({ ok: false, motivo: "es_admin" });
    expect(await invitarAdmin(admin.id, admin.correo)).toEqual({ ok: false, motivo: "es_admin" });
    expect(await invitarAdmin(admin.id, desactivado.correo)).toEqual({ ok: false, motivo: "es_admin_desactivado" });
    expect(await invitarAdmin(admin.id, monitor.correo)).toEqual({ ok: false, motivo: "es_monitor" });

    expect(await totalDeInvitaciones()).toBe(antes);
    for (const { correo } of [otro, desactivado, monitor, admin]) expect(await mensajesPara(correo)).toEqual([]);
  });

  it("si quien invita está desactivado, o no es un admin, responde sin_permiso: ni invitación ni correo", async () => {
    const { admin } = await adminConSesion();
    const desactivado = await fx.crearAdmin();
    await desactivarCuenta(desactivado.id);
    const monitor = await fx.crearMonitor();
    const correo = correoNuevo();

    expect(await invitarAdmin(desactivado.id, correo)).toEqual({ ok: false, motivo: "sin_permiso" });
    expect(await invitarAdmin(monitor.id, correo)).toEqual({ ok: false, motivo: "sin_permiso" });
    expect(await invitarAdmin(randomUUID(), correo)).toEqual({ ok: false, motivo: "sin_permiso" });

    expect(await invitacionesDe(correo)).toEqual([]);
    expect(await mensajesPara(correo)).toEqual([]);
    // Y quien sí es admin activo, con el mismo correo, invita.
    expect(await invitarAdmin(admin.id, correo)).toEqual({ ok: true, correoEnviado: true });
  });

  it("un SITIO_URL inválido lanza ANTES de crear la invitación: el conteo no cambia y no queda un correo sin reintento", async () => {
    const { admin } = await adminConSesion();
    const correo = correoNuevo();
    const antes = await totalDeInvitaciones();
    vi.stubEnv("SITIO_URL", "ftp://calibra.test");

    await expect(invitarAdmin(admin.id, correo)).rejects.toThrow(RangeError);

    expect(await totalDeInvitaciones()).toBe(antes);
    expect(await invitacionesDe(correo)).toEqual([]);
    expect(await mensajesPara(correo)).toEqual([]);
  });
});

describe("reinvitar (criterio 4)", () => {
  it("la segunda invitación cancela la primera: el enlace viejo no sirve, el nuevo sí, y queda una sola abierta", async () => {
    const { admin } = await adminConSesion();
    const correo = correoNuevo();
    const primera = await invitar(admin.id, correo);
    expect(await buscarInvitacionDeAdmin(primera.token)).toMatchObject({ vigente: true, correo });

    const segunda = await invitar(admin.id, correo);

    expect(segunda.token).not.toBe(primera.token);
    expect(await buscarInvitacionDeAdmin(primera.token)).toEqual({ vigente: false });
    expect(await buscarInvitacionDeAdmin(segunda.token)).toMatchObject({ vigente: true, correo });
    const filas = await invitacionesDe(correo);
    expect(filas).toHaveLength(2);
    expect(filas.filter((f) => f.cancelada_en === null && f.usada_en === null)).toHaveLength(1);
    expect(filas.find((f) => f.id === primera.fila.id)!.cancelada_en).not.toBeNull();
    expect(await mensajesPara(correo)).toHaveLength(2);
    // Una sola abierta en la lista de los admins.
    const abiertas = (await listarInvitaciones(await fx.iniciarSesion(admin))).filter((i) => i.correo === correo);
    expect(abiertas.map((i) => i.id)).toEqual([segunda.fila.id]);
  });

  it("dos admins que invitan el mismo correo a la vez: una abierta y una cancelada, sin error", async () => {
    const { admin: uno } = await adminConSesion();
    const { admin: dos } = await adminConSesion();
    const correo = correoNuevo();

    const resultados = await Promise.all([invitarAdmin(uno.id, correo), invitarAdmin(dos.id, correo)]);

    expect(resultados).toEqual([
      { ok: true, correoEnviado: true },
      { ok: true, correoEnviado: true },
    ]);
    const filas = await invitacionesDe(correo);
    expect(filas).toHaveLength(2);
    expect(filas.filter((f) => f.cancelada_en === null)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------

/**
 * Una invitación cuyo correo no salió: el proveedor no está configurado en ese momento (sin_proveedor, que es temporal),
 * así que la fila de correo_envio queda `fallido` y `reintentable`. Luego vuelve Mailpit. La fila queda con 3 minutos de
 * quieta, lista para que el proceso de reintentos la tome (el proceso no toca lo que acaba de fallar).
 */
async function invitacionQueNoSalio(idAdmin: string) {
  const correo = correoNuevo();
  vi.stubEnv("MAILPIT_URL", "");
  const resultado = await invitarAdmin(idAdmin, correo);
  vi.stubEnv("MAILPIT_URL", mailpit);
  expect(resultado).toEqual({ ok: true, correoEnviado: false });

  const [invitacion] = await invitacionesDe(correo);
  const clave = `invitacion_admin:${invitacion.id}`;
  const recien = await filaDeCorreo(clave);
  expect(recien).toMatchObject({ estado: "fallido", reintentable: true, intentos: 0, destinatario: correo, enviado_en: null });
  expect(await mensajesPara(correo)).toEqual([]);
  exito(await fx.admin.from("correo_envio").update({ actualizado_en: hace(3 * MINUTO) }).eq("clave", clave).select("id").single(), "envejecer el correo");
  return { correo, invitacion, clave, envio: await filaDeCorreo(clave) };
}

describe("correo caído y reintento (criterio 16, HU-065)", () => {
  it("si el correo no sale, la invitación queda creada y el reintento manda un enlace nuevo que sirve; el viejo ya no", async () => {
    const { admin } = await adminConSesion();
    const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id);

    const resumen = await reintentarCorreosDesdeServidor();
    expect(resumen.enviados).toBeGreaterThanOrEqual(1);

    // La misma fila, ahora enviada.
    expect(await filaDeCorreo(clave)).toMatchObject({ id: envio.id, estado: "enviado", intentos: 1, ultimo_error: null, reintentable: false });
    const mensajes = await mensajesPara(correo);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].Subject).toBe("Te invitaron al equipo de admins de Calibra");
    const token = tokenDe(mensajes[0]);

    // El enlace nuevo sirve y el hash guardado cambió: el token viejo (que nunca llegó) ya no vale.
    expect(await buscarInvitacionDeAdmin(token)).toMatchObject({ vigente: true, correo });
    const despues = await leerInvitacion(invitacion.id);
    expect(despues.token_hash).toBe(sha256(token));
    expect(despues.token_hash).not.toBe(invitacion.token_hash);
    // Es la misma invitación: no se creó otra, no se alargó y sigue abierta.
    expect(despues).toMatchObject({ id: invitacion.id, vence_en: invitacion.vence_en, creada_en: invitacion.creada_en, usada_en: null, cancelada_en: null });
    expect(await invitacionesDe(correo)).toHaveLength(1);
    // Y el correo reintentado también dice quién invita.
    expect(mensajes[0].Text).toContain("Admin de prueba te invita al equipo de admins de Calibra.");
  });

  it.each([
    ["usada", { usada_en: new Date().toISOString() }],
    ["cancelada", { cancelada_en: new Date().toISOString() }],
    ["vencida", { creada_en: hace(10 * DIA), vence_en: hace(3 * DIA) }],
  ])("si la invitación ya está %s, el reintento descarta el correo y no manda nada; el admin lo ve como «Invitación de admin»", async (_caso, cambios) => {
    const { admin, sesion } = await adminConSesion();
    const { correo, invitacion, clave, envio } = await invitacionQueNoSalio(admin.id);
    exito(await fx.admin.from("invitacion_admin").update(cambios).eq("id", invitacion.id).select().single(), "dejar la invitación sin vigencia");

    const resumen = await reintentarCorreosDesdeServidor();

    expect(resumen.descartados).toBeGreaterThanOrEqual(1);
    const despues = await filaDeCorreo(clave);
    expect(despues).toMatchObject({ id: envio.id, estado: "fallido", reintentable: false, intentos: 0, enviado_en: null });
    expect(despues.ultimo_error).toContain("ya no aplica");
    expect(await mensajesPara(correo)).toEqual([]);
    // La invitación queda como estaba: ni enlace nuevo ni se reabre.
    expect((await leerInvitacion(invitacion.id)).token_hash).toBe(invitacion.token_hash);

    const bandeja = await cargarBandeja(sesion, admin.id, new Date(), { maxFilas: 1_000 });
    expect(bandeja.correosSinEnviar.find((c) => c.id === envio.id)).toMatchObject({ tipo: "Invitación de admin", destinatario: correo });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("registrarAdmin (criterios 5 a 10)", () => {
  it("con un token válido crea la cuenta, el admin al final del orden, y gasta la invitación; la persona entra y es admin", async () => {
    const { admin, sesion } = await adminConSesion();
    const correo = correoNuevo();
    const { fila, token } = await invitar(admin.id, correo);
    expect(await buscarInvitacionDeAdmin(token)).toMatchObject({ vigente: true, correo });

    const registro = datos();
    const ordenesAntes = (await fx.admin.from("admin").select("orden_revision")).data!.map((f) => f.orden_revision);
    const resultado = await registrarAdmin(token, registro);
    expect(resultado).toEqual({ ok: true, correo });

    const [usuario] = await usuariosDeAuth(correo);
    expect(usuario).toBeDefined();
    expect(usuario.email_confirmed_at).toBeTruthy();

    const nuevo = exito(await fx.admin.from("admin").select("*").eq("id", usuario.id).single(), "el admin nuevo");
    expect(nuevo).toMatchObject({ nombre: "Ana Registrada", correo });
    // Al final: mayor que el de todos los demás en ese instante.
    expect(nuevo.orden_revision).toBeGreaterThan(Math.max(...ordenesAntes));

    const gastada = await leerInvitacion(fila.id);
    expect(gastada.usada_en).not.toBeNull();
    expect(gastada.cancelada_en).toBeNull();
    expect(gastada.id_admin_nuevo).toBe(usuario.id);
    expect(await buscarInvitacionDeAdmin(token)).toEqual({ vigente: false });

    // La persona entra con su contraseña y la base la reconoce como admin.
    const sesionNueva = await iniciarSesionConClave(correo, registro.contrasena);
    expect(await rolDe(sesionNueva)).toBe("admin");

    // Sale «Activo» y sin casos abiertos, y cualquier admin lo puede subir con «Subir».
    const equipo = await cargarEquipo(sesionNueva);
    expect(equipo.find((m) => m.id === usuario.id)).toMatchObject({ nombre: "Ana Registrada", correo, activo: true, casosAbiertos: 0, ordenRevision: nuevo.orden_revision });
    const vecino = (await cargarEquipo(sesion)).filter((m) => m.ordenRevision < nuevo.orden_revision).at(-1)!;
    expect(await moverAdmin(sesion, usuario.id, "arriba")).toBe("movido");
    const subido = exito(await fx.admin.from("admin").select("orden_revision").eq("id", usuario.id).single(), "orden tras subir");
    expect(subido.orden_revision).toBe(vecino.ordenRevision);
  });

  it.each([
    ["usado", async (idAdmin: string) => {
      const { token, fila } = await sembrar(idAdmin);
      exito(await fx.admin.from("invitacion_admin").update({ usada_en: new Date().toISOString() }).eq("id", fila.id).select().single(), "usar");
      return { token, correo: fila.correo };
    }],
    ["cancelado", async (idAdmin: string) => {
      const { token, fila } = await sembrar(idAdmin);
      exito(await fx.admin.from("invitacion_admin").update({ cancelada_en: new Date().toISOString() }).eq("id", fila.id).select().single(), "cancelar");
      return { token, correo: fila.correo };
    }],
    ["vencido", async (idAdmin: string) => {
      const { token, fila } = await sembrar(idAdmin);
      exito(await fx.admin.from("invitacion_admin").update({ creada_en: hace(10 * DIA), vence_en: hace(3 * DIA) }).eq("id", fila.id).select().single(), "vencer");
      return { token, correo: fila.correo };
    }],
  ])("un token %s no sirve y no crea ninguna cuenta", async (_caso, preparar) => {
    const { admin } = await adminConSesion();
    const { token, correo } = await preparar(admin.id);

    expect(await buscarInvitacionDeAdmin(token)).toEqual({ vigente: false });
    expect(await registrarAdmin(token, datos())).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    expect(await usuariosDeAuth(correo)).toEqual([]);
    expect((await fx.admin.from("admin").select("id").eq("correo", correo)).data).toEqual([]);
  });

  it("un token inventado, incompleto o ausente no sirve", async () => {
    expect(await registrarAdmin("basura", datos())).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    expect(await registrarAdmin(undefined, datos())).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    expect(await registrarAdmin("a".repeat(64), datos())).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    expect(await registrarAdmin("a".repeat(63), datos())).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
  });

  it("usar dos veces el mismo enlace: el segundo no crea otra cuenta", async () => {
    const { admin } = await adminConSesion();
    const { token, fila } = await invitar(admin.id, correoNuevo());
    const correo = fila.correo;
    expect(await registrarAdmin(token, datos())).toMatchObject({ ok: true });

    const segundo = await registrarAdmin(token, datos());

    expect(segundo).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    expect(await usuariosDeAuth(correo)).toHaveLength(1);
    expect((await fx.admin.from("admin").select("id").eq("correo", correo)).data).toHaveLength(1);
  });

  it("un correo que ya tiene una cuenta de Calibra (un usuario cualquiera o un estudiante) avisa, no gasta la invitación y no deja otra cuenta", async () => {
    const { admin } = await adminConSesion();
    const usuario = await fx.crearUsuario();
    const estudiante = await fx.crearEstudiante();

    for (const existente of [usuario, estudiante]) {
      correos.push(existente.correo);
      const { token, fila } = await sembrar(admin.id, existente.correo);

      const resultado = await registrarAdmin(token, datos());

      expect(resultado).toMatchObject({ ok: false, motivo: "correo_con_cuenta" });
      expect(await leerInvitacion(fila.id)).toMatchObject({ usada_en: null, cancelada_en: null, id_admin_nuevo: null });
      expect(await usuariosDeAuth(existente.correo)).toHaveLength(1);
      expect((await fx.admin.from("admin").select("id").eq("correo", existente.correo)).data).toEqual([]);
    }
  });

  it("si la base falla después de crear la cuenta (nombre vacío), se borra el usuario recién creado y la invitación queda sin gastar", async () => {
    const { admin } = await adminConSesion();
    const { token, fila, correo } = await sembrar(admin.id);

    // Saltándose el lector del formulario: la RPC lanza 22023 y no queda ni el usuario ni el gasto.
    const resultado = await registrarAdmin(token, { nombre: "   ", contrasena: `Clave-${randomUUID()}` });

    expect(resultado).toMatchObject({ ok: false, motivo: "fallo" });
    expect(await usuariosDeAuth(correo)).toEqual([]);
    expect(await leerInvitacion(fila.id)).toMatchObject({ usada_en: null, id_admin_nuevo: null });
    expect((await fx.admin.from("admin").select("id").eq("correo", correo)).data).toEqual([]);
  });

  it("si el correo ya es de un admin (creado a mano después de la invitación), la base lo rechaza, se borra el usuario y no se gasta nada", async () => {
    const { admin } = await adminConSesion();
    const { token, fila, correo } = await sembrar(admin.id);
    // Un admin con ese correo, de otro usuario (admin.correo no es único): registrar_admin lo ve y lanza.
    const otro = await fx.crearUsuario();
    exito(await fx.admin.from("admin").insert({ id: otro.id, nombre: "Otro admin", correo, orden_revision: 1_999_999_999 }).select().single(), "admin con el mismo correo");

    const resultado = await registrarAdmin(token, datos());

    expect(resultado).toMatchObject({ ok: false, motivo: "fallo" });
    expect(await usuariosDeAuth(correo)).toEqual([]);
    expect(await leerInvitacion(fila.id)).toMatchObject({ usada_en: null, id_admin_nuevo: null });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("quien invitó tiene que seguir activo (una cuenta de admin comprometida y desactivada no deja invitaciones vivas)", () => {
  it("al desactivar a quien invitó, su invitación deja de servir (ni formulario ni cuenta ni admin); si lo reactivan, vuelve a servir", async () => {
    const { admin } = await adminConSesion("Quien se va");
    const { token, fila } = await invitar(admin.id, correoNuevo());
    const correo = fila.correo;
    expect(await buscarInvitacionDeAdmin(token)).toMatchObject({ vigente: true, correo });

    await desactivarCuenta(admin.id);

    expect(await buscarInvitacionDeAdmin(token)).toEqual({ vigente: false });
    expect(await registrarAdmin(token, datos())).toEqual({ ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE });
    expect(await usuariosDeAuth(correo)).toEqual([]);
    expect((await fx.admin.from("admin").select("id").eq("correo", correo)).data).toEqual([]);
    // No se gastó ni se canceló: la fila queda como estaba.
    expect(await leerInvitacion(fila.id)).toMatchObject({ usada_en: null, cancelada_en: null, id_admin_nuevo: null });

    await reactivarCuenta(admin.id);

    expect(await buscarInvitacionDeAdmin(token)).toMatchObject({ vigente: true, correo });
    expect(await registrarAdmin(token, datos())).toEqual({ ok: true, correo });
    expect(await usuariosDeAuth(correo)).toHaveLength(1);
  });

  it("aunque el servidor no lo mire (la invitación estaba abierta cuando se desactivó), la base rechaza el alta: registrar_admin da false y no cambia nada", async () => {
    const { admin } = await adminConSesion();
    const { token, fila, correo } = await sembrar(admin.id);
    const cuenta = await fx.crearUsuario();
    await desactivarCuenta(admin.id);

    const respuesta = await fx.admin.rpc("registrar_admin", { p_token_hash: sha256(token), p_id_usuario: cuenta.id, p_correo: correo, p_nombre: "Ana Registrada" });

    expect(respuesta.error).toBeNull();
    expect(respuesta.data).toBe(false);
    expect(await leerInvitacion(fila.id)).toMatchObject({ usada_en: null, cancelada_en: null, id_admin_nuevo: null });
    expect((await fx.admin.from("admin").select("id").eq("id", cuenta.id)).data).toEqual([]);
  });

  it("solo cuenta quien hizo la invitación: la de un admin activo sirve aunque otro esté desactivado", async () => {
    const { admin: quienSeVa } = await adminConSesion();
    const { admin: quienSigue } = await adminConSesion();
    const { token, fila } = await invitar(quienSigue.id, correoNuevo());
    const correo = fila.correo;
    await desactivarCuenta(quienSeVa.id);

    expect(await buscarInvitacionDeAdmin(token)).toMatchObject({ vigente: true, correo });
    expect(await registrarAdmin(token, datos())).toEqual({ ok: true, correo });
  });

  it("la función invitador_activo: solo un admin activo da true; solo service_role la ejecuta", async () => {
    const { admin, sesion } = await adminConSesion();
    const monitor = await fx.crearMonitor();
    const desactivado = await fx.crearAdmin();
    await desactivarCuenta(desactivado.id);
    const pregunta = (id: string | null) => fx.admin.rpc("invitador_activo", { p_id_admin: id as string });

    expect((await pregunta(admin.id)).data).toBe(true);
    for (const id of [desactivado.id, monitor.id, randomUUID(), null]) expect((await pregunta(id)).data, String(id)).toBe(false);

    // Ni un admin activo con su sesión, ni anon, la ejecutan.
    for (const cliente of [sesion, crearCliente()]) {
      const rechazada = await cliente.rpc("invitador_activo", { p_id_admin: admin.id });
      expect(rechazada.error?.code).toBe("42501");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("dos registros a la vez (criterio 8)", () => {
  // Cinco rondas: el perdedor llega a Auth de formas distintas (antes, durante o después de que el ganador termine), y en
  // todas tiene que ver lo que pide el criterio 8: que la invitación ya no sirve. Ni «ya hay una cuenta con este correo»
  // ni un fallo genérico: la lectura repetida de `registrarAdmin` espera a que el ganador gaste la invitación.
  it("la misma invitación con dos registros simultáneos (cinco veces): una sola cuenta, un solo admin, y el otro ve que el enlace ya no sirve, sin cuenta huérfana", async () => {
    const { admin } = await adminConSesion();
    const registroDelServidor = vi.mocked(console.error);

    for (let ronda = 1; ronda <= 5; ronda++) {
      const { token, fila, correo } = await sembrar(admin.id);
      registroDelServidor.mockClear();

      const resultados = await Promise.all([registrarAdmin(token, datos()), registrarAdmin(token, datos())]);

      expect(resultados.filter((r) => r.ok), `ronda ${ronda}: uno solo gana`).toHaveLength(1);
      const perdedor = resultados.find((r) => !r.ok)!;
      // Lo que el servidor dejó en su registro entra en el mensaje: si Auth contestó otro código, se ve cuál.
      expect(perdedor, `ronda ${ronda}: el perdedor ve que el enlace ya no sirve (registro del servidor: ${JSON.stringify(registroDelServidor.mock.calls)})`).toEqual({
        ok: false,
        motivo: "invitacion_no_sirve",
        error: TEXTO_INVITACION_NO_SIRVE,
      });

      const usuarios = await usuariosDeAuth(correo);
      expect(usuarios, `ronda ${ronda}: una sola cuenta en Auth`).toHaveLength(1);
      const admins = exito(await fx.admin.from("admin").select("id, nombre").eq("correo", correo), "admins de la invitación");
      expect(admins).toHaveLength(1);
      expect(admins[0].id).toBe(usuarios[0].id);
      expect(await leerInvitacion(fila.id)).toMatchObject({ id_admin_nuevo: usuarios[0].id });
      expect((await leerInvitacion(fila.id)).usada_en).not.toBeNull();
    }
  }, 60_000);

  it("dos invitaciones distintas con dos registros simultáneos: los dos terminan bien y con órdenes distintos", async () => {
    const { admin } = await adminConSesion();
    const uno = await sembrar(admin.id);
    const dos = await sembrar(admin.id);

    const [a, b] = await Promise.all([registrarAdmin(uno.token, datos()), registrarAdmin(dos.token, datos())]);

    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    const filas = exito(await fx.admin.from("admin").select("correo, orden_revision").in("correo", [uno.correo, dos.correo]), "los dos admins");
    expect(filas).toHaveLength(2);
    expect(filas[0].orden_revision).not.toBe(filas[1].orden_revision);
  });
});

/** Una conexión pg cruda con una transacción abierta que se comporta como una sesión de `service_role` (el servidor). */
async function conexion(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: URL_BD });
  await c.connect();
  return c;
}

async function comoServicio(c: pg.Client) {
  await c.query("begin");
  await c.query("set local role service_role");
}

async function comoAdminActivo(c: pg.Client, id: string) {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
}

async function cerrar(...conexiones: pg.Client[]) {
  for (const c of conexiones) {
    await c.query("rollback").catch(() => undefined);
    await c.end();
  }
}

/** Lanza una consulta sin esperarla y dice si ya terminó (la espera de verdad). */
function lanzar<T extends pg.QueryResultRow>(c: pg.Client, sql: string, parametros: unknown[]) {
  const estado: { termino: boolean; error: Error | null; filas: T[] | null; promesa: Promise<void> } = {
    termino: false,
    error: null,
    filas: null,
    promesa: Promise.resolve(),
  };
  estado.promesa = c
    .query<T>(sql, parametros)
    .then((r) => {
      estado.filas = r.rows;
    })
    .catch((e: Error) => {
      estado.error = e;
    })
    .finally(() => {
      estado.termino = true;
    });
  return estado;
}

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));
const REGISTRAR = "select public.registrar_admin($1, $2, $3, $4) as ok";
const CREAR = "select * from public.crear_invitacion_admin($1, $2, $3)";

describe("candados de la base, con dos conexiones crudas (la espera de verdad)", () => {
  it("dos altas de invitaciones distintas: la segunda espera a la primera y su orden es el de la primera más uno", async () => {
    const { admin } = await adminConSesion();
    const uno = await sembrar(admin.id);
    const dos = await sembrar(admin.id);
    const usuarioUno = await fx.crearUsuario();
    const usuarioDos = await fx.crearUsuario();
    const a = await conexion();
    const b = await conexion();
    try {
      await comoServicio(a);
      expect((await a.query(REGISTRAR, [sha256(uno.token), usuarioUno.id, uno.correo, "Alta uno"])).rows[0].ok).toBe(true);
      await comoServicio(b);
      const enB = lanzar<{ ok: boolean }>(b, REGISTRAR, [sha256(dos.token), usuarioDos.id, dos.correo, "Alta dos"]);

      await dormir(400);
      expect(enB.termino, "B debía esperar a que A confirmara").toBe(false);
      await a.query("commit");
      await enB.promesa;
      expect(enB.error).toBeNull();
      expect(enB.filas?.[0].ok).toBe(true);
      await b.query("commit");

      const filas = exito(await fx.admin.from("admin").select("id, orden_revision").in("id", [usuarioUno.id, usuarioDos.id]), "los dos altas");
      const ordenUno = filas.find((f) => f.id === usuarioUno.id)!.orden_revision;
      const ordenDos = filas.find((f) => f.id === usuarioDos.id)!.orden_revision;
      expect(ordenDos).toBe(ordenUno + 1);
    } finally {
      await cerrar(a, b);
    }
  });

  it("registrar un correo sin confirmar mientras otro admin invita ese mismo correo: la invitación espera y responde es_admin", async () => {
    const { admin: uno } = await adminConSesion();
    const { admin: dos } = await adminConSesion();
    const { token, correo } = await sembrar(uno.id);
    const usuario = await fx.crearUsuario();
    const a = await conexion();
    const b = await conexion();
    try {
      await comoServicio(a);
      expect((await a.query(REGISTRAR, [sha256(token), usuario.id, correo, "Alta"])).rows[0].ok).toBe(true);
      await comoServicio(b);
      const enB = lanzar<{ resultado: string }>(b, CREAR, [sha256(randomUUID().replaceAll("-", "").repeat(2)), correo, dos.id]);

      await dormir(400);
      expect(enB.termino, "la invitación debía esperar a que el registro confirmara").toBe(false);
      await a.query("commit");
      await enB.promesa;
      expect(enB.error).toBeNull();
      expect(enB.filas?.[0].resultado).toBe("es_admin");
      await b.query("commit");

      const abiertas = (await invitacionesDe(correo)).filter((f) => f.usada_en === null && f.cancelada_en === null);
      expect(abiertas).toEqual([]);
    } finally {
      await cerrar(a, b);
    }
  });

  it("dos admins que invitan el mismo correo a la vez: el segundo espera, cancela la invitación del primero y no hay error", async () => {
    const { admin: uno } = await adminConSesion();
    const { admin: dos } = await adminConSesion();
    const correo = correoNuevo();
    const hashUno = sha256(randomUUID().replaceAll("-", "").repeat(2));
    const hashDos = sha256(randomUUID().replaceAll("-", "").repeat(2));
    const a = await conexion();
    const b = await conexion();
    try {
      await comoServicio(a);
      expect((await a.query(CREAR, [hashUno, correo, uno.id])).rows[0].resultado).toBe("creada");
      await comoServicio(b);
      const enB = lanzar<{ resultado: string }>(b, CREAR, [hashDos, correo, dos.id]);

      await dormir(400);
      expect(enB.termino, "el segundo debía esperar al primero").toBe(false);
      await a.query("commit");
      await enB.promesa;
      expect(enB.error).toBeNull();
      expect(enB.filas?.[0].resultado).toBe("creada");
      await b.query("commit");

      const filas = await invitacionesDe(correo);
      expect(filas).toHaveLength(2);
      const abiertas = filas.filter((f) => f.cancelada_en === null);
      expect(abiertas.map((f) => f.token_hash)).toEqual([hashDos]);
    } finally {
      await cerrar(a, b);
    }
  });

  it("cancelar mientras otro registra con la misma invitación: gana una sola, la cancelación ve no_abierta", async () => {
    const { admin: uno } = await adminConSesion();
    const { admin: dos } = await adminConSesion();
    const { token, fila, correo } = await sembrar(uno.id);
    const usuario = await fx.crearUsuario();
    const a = await conexion();
    const b = await conexion();
    try {
      await comoServicio(a);
      expect((await a.query(REGISTRAR, [sha256(token), usuario.id, correo, "Alta"])).rows[0].ok).toBe(true);
      await comoAdminActivo(b, dos.id);
      const enB = lanzar<{ r: string }>(b, "select public.cancelar_invitacion_admin($1) as r", [fila.id]);

      await dormir(400);
      expect(enB.termino, "la cancelación debía esperar al bloqueo de la fila").toBe(false);
      await a.query("commit");
      await enB.promesa;
      expect(enB.error).toBeNull();
      expect(enB.filas?.[0].r).toBe("no_abierta");
      await b.query("commit");

      const despues = await leerInvitacion(fila.id);
      expect(despues.usada_en).not.toBeNull();
      expect(despues.cancelada_en).toBeNull();
    } finally {
      await cerrar(a, b);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------

/** Las identidades que no deben poder hacer nada con las invitaciones, cada una con su sesión real. */
async function identidadesSinPermiso() {
  const monitor = await fx.crearMonitor();
  const estudiante = await fx.crearEstudiante();
  const anonimo = await fx.crearAnonimo();
  const desactivado = await fx.crearAdmin();
  const sesionDelDesactivado = await fx.iniciarSesion(desactivado);
  await desactivarCuenta(desactivado.id);
  return {
    monitor: { id: monitor.id, sesion: await fx.iniciarSesion(monitor) },
    estudiante: { id: estudiante.id, sesion: await fx.iniciarSesion(estudiante) },
    anonimo: { id: anonimo.id, sesion: anonimo.cliente },
    desactivado: { id: desactivado.id, sesion: sesionDelDesactivado },
  };
}

describe("reactivar (criterio 13, D-64 a)", () => {
  it("un admin desactivado no entra; reactivado, entra y mi_rol() responde admin con la misma sesión; conserva su orden y sus casos no se le devuelven", async () => {
    const a = await fx.crearAdmin();
    const { admin: b, sesion: sesionB } = await adminConSesion();
    const sesionA = await fx.iniciarSesion(a);
    const contexto = await fx.crearContextoDeMonitoria(a.id);
    const monitoria = await fx.crearMonitoria(contexto, { fecha: "2030-01-14" });
    const pago = await fx.crearPagoDe(monitoria.id, { idAdmin: a.id, estado: "aprobado" });
    const reembolso = await fx.crearReembolso({ idPago: pago.id, idAdmin: a.id, estado: "esperando_llave" });
    const ordenAntes = exito(await fx.admin.from("admin").select("orden_revision").eq("id", a.id).single(), "orden de A").orden_revision;

    const desactivado = await desactivarAdmin(sesionB, b.id, a.id);
    expect(desactivado.ok).toBe(true);
    const recibe = exito(await fx.admin.from("reembolso").select("id_admin").eq("id", reembolso.id).single(), "reembolso tras desactivar").id_admin;
    expect(recibe).not.toBe(a.id);

    // Baneado: no inicia sesión (con el token del CAPTCHA, para que el rechazo sea el del usuario baneado) y no es admin.
    const bloqueado = await conReintentoDeCaptcha(() =>
      crearCliente().auth.signInWithPassword({ email: a.correo, password: a.contrasena, options: { captchaToken: TOKEN_CAPTCHA_DE_PRUEBA } }),
    );
    expect(bloqueado.error?.code).toBe("user_banned");
    expect(await rolDe(sesionA)).not.toBe("admin");

    const resultado = await reactivarAdmin(sesionB, a.id);
    expect(resultado).toEqual({ ok: true, nombre: "Admin de prueba" });

    // Inicia sesión de nuevo y, con la misma sesión de antes, la base lo reconoce como admin.
    expect(await rolDe(await fx.iniciarSesion(a))).toBe("admin");
    expect(await rolDe(sesionA)).toBe("admin");
    // Conserva su lugar; sus casos siguen con quien los recibió.
    expect(exito(await fx.admin.from("admin").select("orden_revision").eq("id", a.id).single(), "orden de A").orden_revision).toBe(ordenAntes);
    expect(exito(await fx.admin.from("reembolso").select("id_admin").eq("id", reembolso.id).single(), "reembolso tras reactivar").id_admin).toBe(recibe);
    const equipo = await cargarEquipo(sesionB);
    expect(equipo.find((m) => m.id === a.id)).toMatchObject({ activo: true, casosAbiertos: 0, ordenRevision: ordenAntes });
  });

  it("a un admin activo no se le reactiva (ya_activo) y a quien no es del equipo, tampoco (no_encontrado)", async () => {
    const { admin: b, sesion: sesionB } = await adminConSesion();
    const otro = await fx.crearAdmin();
    expect(await reactivarAdmin(sesionB, otro.id)).toEqual({ ok: false, motivo: "ya_activo" });
    expect(await reactivarAdmin(sesionB, b.id)).toEqual({ ok: false, motivo: "ya_activo" });
    expect(await reactivarAdmin(sesionB, randomUUID())).toEqual({ ok: false, motivo: "no_encontrado" });
    const monitor = await fx.crearMonitor();
    expect(await reactivarAdmin(sesionB, monitor.id)).toEqual({ ok: false, motivo: "no_encontrado" });
  });

  it("con la sesión de un monitor, un estudiante, una anónima o un admin desactivado no reactiva nada: la cuenta sigue baneada", async () => {
    const baneado = await fx.crearAdmin();
    await desactivarCuenta(baneado.id);
    const sin = await identidadesSinPermiso();

    for (const [nombre, { sesion }] of Object.entries(sin)) {
      expect(await reactivarAdmin(sesion, baneado.id), nombre).toEqual({ ok: false, motivo: "no_encontrado" });
    }

    const intento = await conReintentoDeCaptcha(() =>
      crearCliente().auth.signInWithPassword({ email: baneado.correo, password: baneado.contrasena, options: { captchaToken: TOKEN_CAPTCHA_DE_PRUEBA } }),
    );
    expect(intento.error?.code).toBe("user_banned");
  });
});

describe("la lista y la cancelación con la sesión del admin (criterios 11, 12 y 14)", () => {
  it("un admin ve las abiertas con quién invitó; las usadas, canceladas y vencidas no salen; y nada trae el hash ni el token", async () => {
    const { admin, sesion } = await adminConSesion("Invitadora Ana");
    const abierta = await invitar(admin.id, correoNuevo());
    const usada = await sembrar(admin.id);
    const cancelada = await sembrar(admin.id);
    const vencida = await sembrar(admin.id);
    exito(await fx.admin.from("invitacion_admin").update({ usada_en: new Date().toISOString() }).eq("id", usada.fila.id).select().single(), "usar");
    exito(await fx.admin.from("invitacion_admin").update({ cancelada_en: new Date().toISOString() }).eq("id", cancelada.fila.id).select().single(), "cancelar");
    exito(await fx.admin.from("invitacion_admin").update({ creada_en: hace(10 * DIA), vence_en: hace(3 * DIA) }).eq("id", vencida.fila.id).select().single(), "vencer");

    const lista = await listarInvitaciones(sesion);

    const mia = lista.find((i) => i.id === abierta.fila.id);
    expect(mia).toMatchObject({ correo: abierta.fila.correo, invitadaPor: "Invitadora Ana", invitoActivo: true });
    expect(mia!.venceEn.getTime()).toBe(new Date(abierta.fila.vence_en).getTime());
    const ids = lista.map((i) => i.id);
    for (const fila of [usada.fila, cancelada.fila, vencida.fila]) expect(ids).not.toContain(fila.id);
    expect(JSON.stringify(lista)).not.toMatch(/token_hash|token/);
    expect(JSON.stringify(lista)).not.toContain(abierta.token);
    expect(JSON.stringify(lista)).not.toContain(abierta.fila.token_hash);
  });

  it("si quien invitó ya no está activo, la lista lo dice (invitoActivo) y la invitación sigue abierta para que se pueda cancelar", async () => {
    const { admin } = await adminConSesion("Quien se va");
    const { sesion: sesionOtro } = await adminConSesion();
    const abierta = await invitar(admin.id, correoNuevo());
    await desactivarCuenta(admin.id);

    const lista = await listarInvitaciones(sesionOtro);

    expect(lista.find((i) => i.id === abierta.fila.id)).toMatchObject({ invitadaPor: "Quien se va", invitoActivo: false });
    expect(await cancelarInvitacionAbierta(sesionOtro, abierta.fila.id)).toBe("cancelada");
  });

  it("las otras cuatro identidades (monitor, estudiante, anónima y admin desactivado) reciben una lista vacía", async () => {
    const { admin } = await adminConSesion();
    await sembrar(admin.id);
    const sin = await identidadesSinPermiso();
    for (const [nombre, { sesion }] of Object.entries(sin)) expect(await listarInvitaciones(sesion), nombre).toEqual([]);
  });

  it("cancelar: cancelada la primera vez, no_abierta la segunda, no_encontrada con un id cualquiera; el enlace cancelado se lee como vencido", async () => {
    const { admin, sesion } = await adminConSesion();
    const { token, fila } = await invitar(admin.id, correoNuevo());

    expect(await cancelarInvitacionAbierta(sesion, fila.id)).toBe("cancelada");
    expect(await buscarInvitacionDeAdmin(token)).toEqual({ vigente: false });
    expect(await registrarAdmin(token, datos())).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    expect((await listarInvitaciones(sesion)).map((i) => i.id)).not.toContain(fila.id);
    expect(await cancelarInvitacionAbierta(sesion, fila.id)).toBe("no_abierta");
    expect(await cancelarInvitacionAbierta(sesion, randomUUID())).toBe("no_encontrada");

    // Una usada tampoco cambia.
    const usada = await sembrar(admin.id);
    exito(await fx.admin.from("invitacion_admin").update({ usada_en: new Date().toISOString() }).eq("id", usada.fila.id).select().single(), "usar");
    expect(await cancelarInvitacionAbierta(sesion, usada.fila.id)).toBe("no_abierta");
    expect(await leerInvitacion(usada.fila.id)).toMatchObject({ cancelada_en: null });
  });

  it("cancelar con la sesión de otra identidad responde sin_permiso y deja la invitación abierta", async () => {
    const { admin } = await adminConSesion();
    const { token, fila } = await invitar(admin.id, correoNuevo());
    const sin = await identidadesSinPermiso();

    for (const [nombre, { sesion }] of Object.entries(sin)) {
      expect(await cancelarInvitacionAbierta(sesion, fila.id), nombre).toBe("sin_permiso");
    }

    expect(await leerInvitacion(fila.id)).toMatchObject({ cancelada_en: null, usada_en: null });
    expect(await buscarInvitacionDeAdmin(token)).toMatchObject({ vigente: true });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("permisos por la Data API (criterio 15)", () => {
  async function actores(): Promise<[string, Cliente][]> {
    const { sesion } = await adminConSesion();
    return [
      ["admin activo", sesion],
      ["anon", crearCliente()],
    ];
  }

  it("ni un admin activo ni anon leen, insertan, actualizan o borran en invitacion_admin", async () => {
    const { admin } = await adminConSesion();
    const { fila } = await sembrar(admin.id);
    for (const [nombre, cliente] of await actores()) {
      const lectura = await cliente.from("invitacion_admin").select("*");
      expect(lectura.error?.code, `${nombre}: select`).toBe("42501");
      const insercion = await cliente.from("invitacion_admin").insert({ correo: correoNuevo(), token_hash: "f".repeat(64), id_admin: admin.id });
      expect(insercion.error?.code, `${nombre}: insert`).toBe("42501");
      const cambio = await cliente.from("invitacion_admin").update({ cancelada_en: new Date().toISOString() }).eq("id", fila.id);
      expect(cambio.error?.code, `${nombre}: update`).toBe("42501");
      const borrado = await cliente.from("invitacion_admin").delete().eq("id", fila.id);
      expect(borrado.error?.code, `${nombre}: delete`).toBe("42501");
    }
    expect(await leerInvitacion(fila.id)).toMatchObject({ cancelada_en: null });
  });

  it("ni un admin activo ni anon insertan, actualizan o borran en admin", async () => {
    const otro = await fx.crearAdmin();
    for (const [nombre, cliente] of await actores()) {
      const insercion = await cliente.from("admin").insert({ id: randomUUID(), nombre: "Intruso", correo: correoNuevo(), orden_revision: 1_999_999_998 });
      expect(insercion.error?.code, `${nombre}: insert`).toBe("42501");
      const cambio = await cliente.from("admin").update({ nombre: "Cambiado" }).eq("id", otro.id);
      expect(cambio.error?.code, `${nombre}: update`).toBe("42501");
      const borrado = await cliente.from("admin").delete().eq("id", otro.id);
      expect(borrado.error?.code, `${nombre}: delete`).toBe("42501");
    }
    expect(exito(await fx.admin.from("admin").select("nombre").eq("id", otro.id).single(), "admin intacto").nombre).toBe("Admin de prueba");
  });

  it("ni un admin activo ni anon ejecutan crear_invitacion_admin ni registrar_admin", async () => {
    const { admin } = await adminConSesion();
    const { fila } = await sembrar(admin.id);
    for (const [nombre, cliente] of await actores()) {
      const crear = await cliente.rpc("crear_invitacion_admin", { p_token_hash: "e".repeat(64), p_correo: correoNuevo(), p_id_admin: admin.id });
      expect(crear.error?.code, `${nombre}: crear`).toBe("42501");
      const registrar = await cliente.rpc("registrar_admin", { p_token_hash: fila.token_hash, p_id_usuario: randomUUID(), p_correo: fila.correo, p_nombre: "Intruso" });
      expect(registrar.error?.code, `${nombre}: registrar`).toBe("42501");
    }
    expect(await leerInvitacion(fila.id)).toMatchObject({ usada_en: null });
    expect((await fx.admin.from("admin").select("id").eq("correo", fila.correo)).data).toEqual([]);
  });

  it("anon no ejecuta la lista ni la cancelación", async () => {
    const lista = await crearCliente().rpc("invitaciones_de_admin");
    expect(lista.error?.code).toBe("42501");
    const cancelar = await crearCliente().rpc("cancelar_invitacion_admin", { p_id: randomUUID() });
    expect(cancelar.error?.code).toBe("42501");
  });
});
