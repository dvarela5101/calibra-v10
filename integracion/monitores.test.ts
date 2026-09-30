import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buscarInvitacion, invitarMonitor, registrarMonitor } from "@/lib/monitores/servidor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, rolDe } from "./utilidades";

// HU-013 contra el Supabase LOCAL: la invitación se guarda de verdad, el correo sale por Mailpit y la
// cuenta se crea en Auth. Nada de esto toca el proyecto real.

let fx: Fixtures;
let mailpit: string;
const correos: string[] = [];

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
});

beforeEach(() => {
  fx = new Fixtures();
  // Siempre Mailpit (nunca Resend) y un sitio conocido para comprobar el enlace.
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("CORREO_REMITENTE", "");
  vi.stubEnv("MAILPIT_URL", mailpit);
  vi.stubEnv("SITIO_URL", "https://calibra.test");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const correo of correos.splice(0)) {
    // Cuentas que creó registrarMonitor (no las conoce Fixtures): se buscan por el correo de la invitación.
    const { data: privado } = await fx.admin.from("monitor_privado").select("id_monitor").eq("correo", correo);
    await fx.admin.from("invitacion_monitor").delete().eq("correo", correo);
    for (const { id_monitor } of privado ?? []) await fx.admin.auth.admin.deleteUser(id_monitor);
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" });
  }
  await fx.limpiar();
});

function correoNuevo(): string {
  const correo = `monitor-${randomUUID()}@calibra.test`;
  correos.push(correo);
  return correo;
}

type Mensaje = { Subject: string; Text: string };

async function mensajesPara(correo: string): Promise<Mensaje[]> {
  const busqueda = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
  const { messages } = (await busqueda.json()) as { messages?: { ID: string }[] };
  return Promise.all(
    (messages ?? []).map(async ({ ID }) => (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as Mensaje),
  );
}

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

/** Invita, lee la fila y saca el token del correo (la única copia del token que existe). */
async function invitar(idAdmin: string, correo: string) {
  const resultado = await invitarMonitor(idAdmin, correo);
  expect(resultado).toEqual({ ok: true, correoEnviado: true });
  const fila = exito(await fx.admin.from("invitacion_monitor").select("*").eq("correo", correo).single(), "leer invitación");
  const [mensaje] = await mensajesPara(correo);
  const token = /\/monitores\/registro\?token=([0-9a-f]{64})/.exec(mensaje.Text)?.[1];
  if (!token) throw new Error(`El correo no trae el enlace de registro:\n${mensaje.Text}`);
  return { fila, token };
}

const datos = (contrasena = `Clave-${randomUUID()}`) => ({
  nombre: "Camila Monitora",
  numeroTelefono: "300 123 4567",
  llave: "@camila-llave",
  contrasena,
});

async function usuariosDeAuth(correo: string) {
  const { data, error } = await fx.admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.filter((u) => u.email === correo);
}

describe("invitarMonitor", () => {
  it("guarda el hash del token, vence a los 7 días y manda el enlace por correo", async () => {
    const admin = await fx.crearAdmin();
    const correo = correoNuevo();

    const { fila, token } = await invitar(admin.id, correo);

    expect(fila.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fila.token_hash).not.toBe(token);
    expect(fila.token_hash).toBe(sha256(token));
    expect(fila).toMatchObject({ correo, id_admin: admin.id, usada_en: null, id_monitor: null });
    const dias = (new Date(fila.vence_en).getTime() - new Date(fila.creada_en).getTime()) / 86_400_000;
    expect(dias).toBeCloseTo(7, 3);

    const mensajes = await mensajesPara(correo);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].Subject).toBe("Crea tu cuenta de monitor en Calibra");
    expect(mensajes[0].Text).toContain(`https://calibra.test/monitores/registro?token=${token}`);
    // El token no queda en ninguna columna de la fila.
    expect(JSON.stringify(fila)).not.toContain(token);
  });

  it("rechaza un correo que ya es de un monitor", async () => {
    const admin = await fx.crearAdmin();
    const monitor = await fx.crearMonitor({ conContacto: true });

    const resultado = await invitarMonitor(admin.id, monitor.correo);

    expect(resultado).toEqual({ ok: false, error: "Ese correo ya tiene una cuenta de monitor." });
    const { data } = await fx.admin.from("invitacion_monitor").select("id").eq("correo", monitor.correo);
    expect(data).toEqual([]);
    expect(await mensajesPara(monitor.correo)).toEqual([]);
  });
});

describe("registrarMonitor", () => {
  it("con un token válido crea la cuenta, el monitor y su perfil, y gasta la invitación", async () => {
    const admin = await fx.crearAdmin();
    const correo = correoNuevo();
    const { fila, token } = await invitar(admin.id, correo);
    expect(await buscarInvitacion(token)).toMatchObject({ vigente: true, correo });

    const registro = datos();
    const resultado = await registrarMonitor(token, registro);
    expect(resultado).toEqual({ ok: true, correo });

    const [usuario] = await usuariosDeAuth(correo);
    expect(usuario).toBeDefined();
    expect(usuario.email_confirmed_at).toBeTruthy();

    const monitor = exito(await fx.admin.from("monitor").select("*").eq("id", usuario.id).single(), "monitor");
    expect(monitor.nombre).toBe("Camila Monitora");
    const privado = exito(await fx.admin.from("monitor_privado").select("*").eq("id_monitor", usuario.id).single(), "monitor_privado");
    expect(privado).toMatchObject({ correo, numero_telefono: "300 123 4567", llave: "@camila-llave" });
    const perfil = await fx.admin.from("perfil_monitor").select("id_monitor").eq("id_monitor", usuario.id);
    expect(perfil.data).toEqual([{ id_monitor: usuario.id }]);

    const gastada = exito(await fx.admin.from("invitacion_monitor").select("*").eq("id", fila.id).single(), "invitación");
    expect(gastada.usada_en).not.toBeNull();
    expect(gastada.id_monitor).toBe(usuario.id);
    expect(await buscarInvitacion(token)).toEqual({ vigente: false });

    // La persona entra con su contraseña y la base la reconoce como monitor.
    const cliente = crearCliente();
    const { error } = await cliente.auth.signInWithPassword({ email: correo, password: registro.contrasena });
    expect(error).toBeNull();
    expect(await rolDe(cliente)).toBe("monitor");
  });

  it("un token que ya se usó no sirve y no crea otra cuenta", async () => {
    const admin = await fx.crearAdmin();
    const correo = correoNuevo();
    const { token } = await invitar(admin.id, correo);
    expect(await registrarMonitor(token, datos())).toMatchObject({ ok: true });

    const segundo = await registrarMonitor(token, datos());

    expect(segundo).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    expect(await usuariosDeAuth(correo)).toHaveLength(1);
    const { data } = await fx.admin.from("monitor_privado").select("id_monitor").eq("correo", correo);
    expect(data).toHaveLength(1);
  });

  it("una invitación vencida no sirve y no crea cuenta", async () => {
    const admin = await fx.crearAdmin();
    const correo = correoNuevo();
    const { fila, token } = await invitar(admin.id, correo);
    const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();
    // vence_en debe seguir siendo posterior a creada_en (check de la tabla).
    exito(
      await fx.admin.from("invitacion_monitor").update({ creada_en: hace(10), vence_en: hace(3) }).eq("id", fila.id).select().single(),
      "vencer invitación",
    );

    expect(await buscarInvitacion(token)).toEqual({ vigente: false });
    expect(await registrarMonitor(token, datos())).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    expect(await usuariosDeAuth(correo)).toEqual([]);
  });

  it("un token inventado no sirve", async () => {
    expect(await registrarMonitor("basura", datos())).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    expect(await registrarMonitor(undefined, datos())).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    // Con forma de token pero desconocido.
    expect(await registrarMonitor("a".repeat(64), datos())).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
  });

  it("si el correo ya tiene una cuenta, avisa y la invitación queda sin usar", async () => {
    const admin = await fx.crearAdmin();
    const correo = correoNuevo();
    const { fila, token } = await invitar(admin.id, correo);
    // Alguien creó una cuenta con ese correo después de la invitación.
    const existente = await fx.admin.auth.admin.createUser({ email: correo, password: `Clave-${randomUUID()}`, email_confirm: true });
    expect(existente.error).toBeNull();
    const idExistente = existente.data.user!.id;

    try {
      const resultado = await registrarMonitor(token, datos());

      expect(resultado).toMatchObject({ ok: false, motivo: "correo_con_cuenta" });
      const invitacion = exito(await fx.admin.from("invitacion_monitor").select("*").eq("id", fila.id).single(), "invitación");
      expect(invitacion.usada_en).toBeNull();
      expect(invitacion.id_monitor).toBeNull();
      expect(await usuariosDeAuth(correo)).toHaveLength(1);
    } finally {
      await fx.admin.auth.admin.deleteUser(idExistente);
    }
  });
});
