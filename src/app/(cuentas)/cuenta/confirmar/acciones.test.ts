import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rol } from "@/lib/auth/roles";
import { TEXTOS } from "@/lib/cuentas/reglas";
import { confirmar } from "./acciones";

// Sin Auth ni base: la acción de confirmar con todo lo de afuera inventado. Aquí se fija el orden (la guarda es lo
// primero y, rechazada, no toca Auth ni la base), que el tipo de `verifyOtp` es fijo aunque el formulario traiga otro, que
// el Estudiante se crea después de verificar el enlace y que los errores dicen lo que corresponde. Con Auth y la base de
// verdad lo cubren integracion/cuenta-estudiante.test.ts y e2e/cuenta.spec.ts.

const sesion = vi.hoisted(() => ({ actual: null as { idUsuario: string; rol: Rol | null } | null }));
const servidor = vi.hoisted(() => ({ confirmarCorreoDeCuenta: vi.fn(), activarCuenta: vi.fn(), crearClienteServidor: vi.fn() }));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => sesion.actual }));
vi.mock("@/lib/cuentas/servidor", () => ({
  confirmarCorreoDeCuenta: servidor.confirmarCorreoDeCuenta,
  activarCuenta: servidor.activarCuenta,
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: servidor.crearClienteServidor }));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`redirect:${ruta}`);
  },
}));

const ID_USUARIO = "5a5a5a5a-0000-4000-8000-000000000032";
const TOKEN = "pkce_" + "Ab1-".repeat(12);
const CLIENTE = { auth: {} };
const ESTADO = { error: null, siguientePaso: null };

const como = (rol: Rol | null) => {
  sesion.actual = { idUsuario: ID_USUARIO, rol };
};

function formulario(campos: Record<string, string> = { token_hash: TOKEN }): FormData {
  const datos = new FormData();
  for (const [clave, valor] of Object.entries(campos)) datos.set(clave, valor);
  return datos;
}

let errores: unknown[][];

beforeEach(() => {
  sesion.actual = null;
  for (const mock of Object.values(servidor)) mock.mockReset();
  servidor.crearClienteServidor.mockResolvedValue(CLIENTE);
  servidor.confirmarCorreoDeCuenta.mockResolvedValue({ ok: true, idUsuario: ID_USUARIO, tokenDeAcceso: "token-de-acceso" });
  servidor.activarCuenta.mockResolvedValue({ ok: true });
  errores = [];
  vi.spyOn(console, "error").mockImplementation((...argumentos: unknown[]) => {
    errores.push(argumentos);
  });
  vi.stubEnv("CORREO_DATOS_PERSONALES", "soporte@calibra.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("confirmar: la guarda es lo primero (criterio 4)", () => {
  it("un monitor, un admin o un Estudiante con sesión abierta no cambia nada: se le pide abrir el enlace en otra ventana", async () => {
    for (const rol of ["monitor", "admin", "estudiante"] as const) {
      como(rol);
      expect(await confirmar(ESTADO, formulario()), rol).toEqual({ error: TEXTOS.cuentaAbierta, siguientePaso: null });
    }
    expect(servidor.crearClienteServidor).not.toHaveBeenCalled();
    expect(servidor.confirmarCorreoDeCuenta).not.toHaveBeenCalled();
    expect(servidor.activarCuenta).not.toHaveBeenCalled();
  });

  it("sin sesión (otro dispositivo) o con una sesión anónima sí sigue: verifyOtp le deja la sesión de la cuenta", async () => {
    for (const actual of [null, { idUsuario: ID_USUARIO, rol: "anonimo" as const }, { idUsuario: ID_USUARIO, rol: null }]) {
      sesion.actual = actual;
      servidor.confirmarCorreoDeCuenta.mockClear();

      await expect(confirmar(ESTADO, formulario()), String(actual?.rol)).rejects.toThrow(new Error("redirect:/cuenta/contrasena"));
      expect(servidor.confirmarCorreoDeCuenta).toHaveBeenCalledTimes(1);
    }
  });
});

describe("confirmar: el enlace", () => {
  it("el tipo del verifyOtp lo fija el servidor: el formulario solo aporta el token_hash", async () => {
    await expect(confirmar(ESTADO, formulario({ token_hash: TOKEN, type: "recovery" }))).rejects.toThrow(new Error("redirect:/cuenta/contrasena"));

    // `confirmarCorreoDeCuenta` recibe el cliente y el token, nada más: el tipo no viaja desde el formulario.
    expect(servidor.confirmarCorreoDeCuenta).toHaveBeenCalledWith(CLIENTE, TOKEN);
    expect(servidor.confirmarCorreoDeCuenta.mock.calls[0]).toHaveLength(2);
  });

  it("un token sin forma de token ni se manda a Auth: «ya no sirve» con el camino para pedir otro", async () => {
    const sinForma: Record<string, string>[] = [{}, { token_hash: "" }, { token_hash: "corto" }, { token_hash: `${TOKEN} x` }];
    for (const campos of sinForma) {
      expect(await confirmar(ESTADO, formulario(campos)), JSON.stringify(campos)).toEqual({
        error: TEXTOS.enlaceNoSirveAlConfirmar,
        siguientePaso: "pedir_otro",
      });
    }
    expect(servidor.crearClienteServidor).not.toHaveBeenCalled();
    expect(servidor.confirmarCorreoDeCuenta).not.toHaveBeenCalled();
  });

  it("un enlace usado, vencido o inventado dice «ya no sirve» y no crea nada", async () => {
    servidor.confirmarCorreoDeCuenta.mockResolvedValue({ ok: false, motivo: "no_sirve" });

    expect(await confirmar(ESTADO, formulario())).toEqual({ error: TEXTOS.enlaceNoSirveAlConfirmar, siguientePaso: "pedir_otro" });
    expect(servidor.activarCuenta).not.toHaveBeenCalled();
  });

  it("un fallo de Auth que se puede reintentar dice que intente de nuevo, sin camino para pedir otro", async () => {
    servidor.confirmarCorreoDeCuenta.mockResolvedValue({ ok: false, motivo: "fallo" });
    expect(await confirmar(ESTADO, formulario())).toEqual({ error: TEXTOS.noPudimosConfirmar, siguientePaso: null });

    servidor.confirmarCorreoDeCuenta.mockRejectedValue(new Error("se cayó Auth"));
    expect(await confirmar(ESTADO, formulario())).toEqual({ error: TEXTOS.noPudimosConfirmar, siguientePaso: null });
    expect(servidor.activarCuenta).not.toHaveBeenCalled();
  });

  it("sin cliente de Supabase dice que el servicio no está disponible", async () => {
    servidor.crearClienteServidor.mockResolvedValue(null);

    expect(await confirmar(ESTADO, formulario())).toEqual({ error: "Este servicio no está disponible en este momento.", siguientePaso: null });
    expect(servidor.confirmarCorreoDeCuenta).not.toHaveBeenCalled();
  });
});

describe("confirmar: activar la cuenta", () => {
  it("cierra las demás sesiones y crea el Estudiante DESPUÉS de verificar el enlace, con el id y el token de la sesión nueva, y va a elegir la contraseña", async () => {
    const orden: string[] = [];
    servidor.confirmarCorreoDeCuenta.mockImplementation(async () => {
      orden.push("verificar");
      return { ok: true, idUsuario: ID_USUARIO, tokenDeAcceso: "token-de-acceso" };
    });
    servidor.activarCuenta.mockImplementation(async () => {
      orden.push("activar");
      return { ok: true };
    });

    await expect(confirmar(ESTADO, formulario())).rejects.toThrow(new Error("redirect:/cuenta/contrasena"));
    expect(orden).toEqual(["verificar", "activar"]);
    expect(servidor.activarCuenta).toHaveBeenCalledWith(ID_USUARIO, "token-de-acceso");
  });

  it("si la base dice que escriba a soporte, lo dice con el correo y no manda a «Terminar»: repetirlo daría lo mismo", async () => {
    servidor.activarCuenta.mockResolvedValue({ ok: false, motivo: "soporte" });

    expect(await confirmar(ESTADO, formulario())).toEqual({
      error: "No pudimos activar tu cuenta con estos datos. Escribe a soporte (soporte@calibra.example) y te ayudamos.",
      siguientePaso: null,
    });
  });

  it("si el correo quedó confirmado y no se pudo crear (sin confirmación en Auth, sesiones, no confirmada, fallo o excepción), manda a «Terminar de crear mi cuenta»", async () => {
    // `sin_confirmacion` (revisión de HU-032): Auth no exige confirmar el correo, así que `activarCuenta` no da el rol; lo
    // repite «Terminar de crear mi cuenta» cuando el panel esté corregido.
    for (const motivo of ["sin_confirmacion", "sesiones", "no_confirmada", "fallo"] as const) {
      servidor.activarCuenta.mockResolvedValueOnce({ ok: false, motivo });
      expect(await confirmar(ESTADO, formulario()), motivo).toEqual({ error: TEXTOS.confirmadoSinTerminar, siguientePaso: "terminar" });
    }
    servidor.activarCuenta.mockRejectedValueOnce(new Error("se cayó la base"));
    expect(await confirmar(ESTADO, formulario())).toEqual({ error: TEXTOS.confirmadoSinTerminar, siguientePaso: "terminar" });
  });

  it("el redirect no queda atrapado por un catch: ni el de éxito se toma por un error ni se registra nada", async () => {
    await expect(confirmar(ESTADO, formulario())).rejects.toThrow(new Error("redirect:/cuenta/contrasena"));
    expect(errores).toEqual([]);
  });

  it("ningún registro contiene el token del enlace", async () => {
    servidor.confirmarCorreoDeCuenta.mockRejectedValue(new Error("falló"));
    await confirmar(ESTADO, formulario());
    servidor.confirmarCorreoDeCuenta.mockResolvedValue({ ok: true, idUsuario: ID_USUARIO, tokenDeAcceso: "token-de-acceso" });
    servidor.activarCuenta.mockRejectedValue(new Error("falló"));
    await confirmar(ESTADO, formulario());

    expect(errores.length).toBe(2);
    expect(JSON.stringify(errores)).not.toContain(TOKEN);
    expect(JSON.stringify(errores)).not.toContain("token-de-acceso");
  });
});
