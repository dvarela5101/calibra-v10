import { beforeEach, describe, expect, it, vi } from "vitest";
import { registrarse, type EstadoRegistro } from "./acciones";

// HU-072 (criterios 7, 9 y 17) sin navegador ni base: la acción de registrarse con el servidor y Auth inventados. Se
// fija qué se le pasa a cada uno, a dónde va la persona y qué se le conserva en el formulario tras un error.

const TOKEN = "ab".repeat(32);
const ANTERIOR: EstadoRegistro = { error: null, invitacionNoSirve: false, valores: {} };

const h = vi.hoisted(() => {
  class Redireccion extends Error {
    constructor(readonly destino: string) {
      super(`redirect:${destino}`);
    }
  }
  return {
    Redireccion,
    registrarAdmin: vi.fn(),
    signInWithPassword: vi.fn(),
    cliente: null as object | null,
  };
});

vi.mock("@/lib/admin/invitaciones", () => ({ registrarAdmin: h.registrarAdmin }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

const BUENO = { token: TOKEN, nombre: "Ana Pérez", contrasena: "12345678", confirmacion: "12345678" };

/** El estado que devolvió la acción, o a dónde redirigió. */
async function resultadoDe(campos: Record<string, string>): Promise<{ estado: EstadoRegistro } | { destino: string }> {
  try {
    return { estado: await registrarse(ANTERIOR, formulario(campos)) };
  } catch (error) {
    if (error instanceof h.Redireccion) return { destino: error.destino };
    throw error;
  }
}

beforeEach(() => {
  h.registrarAdmin.mockReset().mockResolvedValue({ ok: true, correo: "nuevo@calibra.test" });
  h.signInWithPassword.mockReset().mockResolvedValue({ error: null });
  h.cliente = { auth: { signInWithPassword: h.signInWithPassword } };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("registrarse (HU-072)", () => {
  it("crea la cuenta con el token y los datos, inicia sesión con el correo de la invitación y va a /admin", async () => {
    expect(await resultadoDe(BUENO)).toEqual({ destino: "/admin" });
    expect(h.registrarAdmin).toHaveBeenCalledExactlyOnceWith(TOKEN, { nombre: "Ana Pérez", contrasena: "12345678" });
    expect(h.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "nuevo@calibra.test",
      password: "12345678",
      options: { captchaToken: undefined },
    });
  });

  it("pasa el token del CAPTCHA al inicio de sesión (criterio 17)", async () => {
    await resultadoDe({ ...BUENO, captcha_token: "token-de-turnstile" });
    expect(h.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "nuevo@calibra.test",
      password: "12345678",
      options: { captchaToken: "token-de-turnstile" },
    });
  });

  it("el correo es el de la invitación, nunca uno que traiga el formulario", async () => {
    await resultadoDe({ ...BUENO, correo: "otro@calibra.test", email: "otro@calibra.test" });
    expect(h.signInWithPassword.mock.calls[0][0].email).toBe("nuevo@calibra.test");
    expect(JSON.stringify(h.registrarAdmin.mock.calls[0])).not.toContain("otro@calibra.test");
  });

  it("si el inicio de sesión falla, o falta la conexión, la persona entra desde /ingresar", async () => {
    h.signInWithPassword.mockResolvedValue({ error: { message: "captcha_failed" } });
    expect(await resultadoDe(BUENO)).toEqual({ destino: "/ingresar" });
    h.cliente = null;
    expect(await resultadoDe(BUENO)).toEqual({ destino: "/ingresar" });
  });

  it.each([
    ["sin nombre", { ...BUENO, nombre: " " }, "Escribe tu nombre."],
    ["con una contraseña corta", { ...BUENO, contrasena: "1234567", confirmacion: "1234567" }, "La contraseña debe tener al menos 8 caracteres."],
    ["con contraseñas distintas", { ...BUENO, confirmacion: "87654321" }, "Las dos contraseñas no coinciden."],
  ])("%s vuelve con el error, sin tocar Auth ni la base, y conserva el nombre pero no las contraseñas", async (_caso, campos, error) => {
    const resultado = await resultadoDe(campos);
    expect(resultado).toEqual({ estado: { error, invitacionNoSirve: false, valores: { nombre: campos.nombre } } });
    expect(JSON.stringify(resultado)).not.toContain(campos.contrasena);
    expect(h.registrarAdmin).not.toHaveBeenCalled();
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it("si la invitación ya no sirve, lo marca para que la pantalla esconda el formulario, y no inicia sesión", async () => {
    const mensaje = "Este enlace ya se usó o venció. Pide otra invitación al equipo de Calibra.";
    h.registrarAdmin.mockResolvedValue({ ok: false, motivo: "invitacion_no_sirve", error: mensaje });
    expect(await resultadoDe(BUENO)).toEqual({ estado: { error: mensaje, invitacionNoSirve: true, valores: { nombre: "Ana Pérez" } } });
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each(["correo_con_cuenta", "fallo"])("si el registro responde %s, vuelve con su mensaje y el formulario sigue", async (motivo) => {
    h.registrarAdmin.mockResolvedValue({ ok: false, motivo, error: "mensaje del servidor" });
    expect(await resultadoDe(BUENO)).toEqual({ estado: { error: "mensaje del servidor", invitacionNoSirve: false, valores: { nombre: "Ana Pérez" } } });
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it("si el registro lanza, dice que no se pudo y deja el nombre", async () => {
    h.registrarAdmin.mockRejectedValue(new Error("caída"));
    expect(await resultadoDe(BUENO)).toEqual({
      estado: { error: "No pudimos crear tu cuenta. Intenta de nuevo.", invitacionNoSirve: false, valores: { nombre: "Ana Pérez" } },
    });
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });
});
