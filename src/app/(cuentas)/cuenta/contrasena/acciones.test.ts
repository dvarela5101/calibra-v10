import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rol } from "@/lib/auth/roles";
import { COOKIE_SIGUIENTE, TEXTOS } from "@/lib/cuentas/reglas";
import { elegirDespues, guardarContrasenaDeCuenta } from "./acciones";

// Sin Auth ni base: las acciones de elegir la contraseña con todo lo de afuera inventado. Aquí se fija que la guarda de
// rol es lo primero, que valida con CONTRASENA_MINIMA, que NO cierra la sesión (a diferencia de recuperar), que borra la
// cookie de regreso y a dónde va. La contraseña guardada de verdad la cubre la integración.

const sesion = vi.hoisted(() => ({ actual: null as { idUsuario: string; rol: Rol | null } | null }));
const auth = vi.hoisted(() => ({
  updateUser: vi.fn(),
  signOut: vi.fn(),
  refreshSession: vi.fn(),
  crearClienteServidor: vi.fn(),
}));
const almacen = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => sesion.actual }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: auth.crearClienteServidor }));
vi.mock("next/headers", () => ({ cookies: async () => almacen }));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`redirect:${ruta}`);
  },
}));

const ID_USUARIO = "5a5a5a5a-0000-4000-8000-000000000032";
const ESTADO = { error: null };

const comoEstudiante = () => {
  sesion.actual = { idUsuario: ID_USUARIO, rol: "estudiante" };
};

function formulario(contrasena: string, confirmacion = contrasena): FormData {
  const datos = new FormData();
  datos.set("contrasena", contrasena);
  datos.set("confirmacion", confirmacion);
  return datos;
}

beforeEach(() => {
  sesion.actual = null;
  for (const mock of [...Object.values(auth), almacen.get, almacen.set, almacen.delete]) mock.mockReset();
  auth.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
  auth.crearClienteServidor.mockResolvedValue({ auth: { updateUser: auth.updateUser, signOut: auth.signOut, refreshSession: auth.refreshSession } });
  almacen.get.mockReturnValue(undefined);
});

describe("la guarda de rol es lo primero: solo un Estudiante elige su contraseña", () => {
  it("sin sesión, anónima, sin rol, monitor o admin van a /cuenta/crear sin tocar nada", async () => {
    const casos: ({ idUsuario: string; rol: Rol | null } | null)[] = [
      null,
      { idUsuario: ID_USUARIO, rol: "anonimo" },
      { idUsuario: ID_USUARIO, rol: null },
      { idUsuario: ID_USUARIO, rol: "monitor" },
      { idUsuario: ID_USUARIO, rol: "admin" },
    ];
    for (const actual of casos) {
      sesion.actual = actual;
      await expect(guardarContrasenaDeCuenta(ESTADO, formulario("12345678")), String(actual?.rol)).rejects.toThrow(new Error("redirect:/cuenta/crear"));
      await expect(elegirDespues(), String(actual?.rol)).rejects.toThrow(new Error("redirect:/cuenta/crear"));
    }
    expect(auth.crearClienteServidor).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(almacen.delete).not.toHaveBeenCalled();
  });
});

describe("guardarContrasenaDeCuenta (criterio 6)", () => {
  beforeEach(comoEstudiante);

  it("con 7 caracteres o con dos contraseñas distintas da el error y no cambia nada", async () => {
    expect(await guardarContrasenaDeCuenta(ESTADO, formulario("1234567"))).toEqual({ error: "La contraseña debe tener al menos 8 caracteres." });
    expect(await guardarContrasenaDeCuenta(ESTADO, formulario("12345678", "12345679"))).toEqual({ error: "Las dos contraseñas no coinciden." });
    expect(await guardarContrasenaDeCuenta(ESTADO, new FormData())).toEqual({ error: TEXTOS.contrasenaCorta });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(almacen.delete).not.toHaveBeenCalled();
  });

  it("con 8 caracteres iguales la guarda, NO cierra la sesión, borra la cookie y va a «Mis citas»", async () => {
    await expect(guardarContrasenaDeCuenta(ESTADO, formulario("12345678"))).rejects.toThrow(new Error("redirect:/cita"));

    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "12345678" });
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(almacen.delete).toHaveBeenCalledWith(COOKIE_SIGUIENTE);
  });

  it("vuelve a la ruta de la cookie (la que pidió en este navegador) y la borra", async () => {
    almacen.get.mockImplementation((nombre: string) => (nombre === COOKIE_SIGUIENTE ? { value: "/privacidad" } : undefined));

    await expect(guardarContrasenaDeCuenta(ESTADO, formulario("12345678"))).rejects.toThrow(new Error("redirect:/privacidad"));
    expect(almacen.delete).toHaveBeenCalledWith(COOKIE_SIGUIENTE);
  });

  it("una cookie con una ruta externa, mal formada o de un panel se ignora y va a «Mis citas»", async () => {
    for (const valor of ["https://otro.sitio", "//otro.sitio", "/.//otro.sitio", "/admin", "/monitor/agenda", ""]) {
      almacen.get.mockImplementation(() => ({ value: valor }));
      await expect(guardarContrasenaDeCuenta(ESTADO, formulario("12345678")), valor).rejects.toThrow(new Error("redirect:/cita"));
    }
  });

  it("si Auth rechaza la contraseña, devuelve su mensaje en español y no borra la cookie ni redirige", async () => {
    auth.updateUser.mockResolvedValue({ data: { user: null }, error: { code: "same_password" } });

    expect(await guardarContrasenaDeCuenta(ESTADO, formulario("12345678"))).toEqual({ error: "Usa una contraseña distinta de la anterior." });
    expect(almacen.delete).not.toHaveBeenCalled();
  });

  it("sin cliente de Supabase dice que el servicio no está disponible", async () => {
    auth.crearClienteServidor.mockResolvedValue(null);

    expect(await guardarContrasenaDeCuenta(ESTADO, formulario("12345678"))).toEqual({ error: "Este servicio no está disponible en este momento." });
  });
});

describe("elegirDespues (criterio 6)", () => {
  beforeEach(comoEstudiante);

  it("no toca la contraseña ni la sesión: borra la cookie y va a «Mis citas»", async () => {
    await expect(elegirDespues()).rejects.toThrow(new Error("redirect:/cita"));

    expect(auth.crearClienteServidor).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(almacen.delete).toHaveBeenCalledWith(COOKIE_SIGUIENTE);
  });

  it("vuelve a la ruta de la cookie", async () => {
    almacen.get.mockImplementation(() => ({ value: "/monitores?materia=X" }));

    await expect(elegirDespues()).rejects.toThrow(new Error("redirect:/monitores?materia=X"));
  });
});
