import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rol } from "@/lib/auth/roles";
import { COOKIE_SIGUIENTE, TEXTOS } from "@/lib/cuentas/reglas";
import { avisoDeVerificacion } from "@/lib/leads/avisos";
import type { LeadDeSesion, ResultadoContacto } from "@/lib/leads/servidor";
import { ERROR_SIN_AUTORIZACION } from "@/lib/privacidad/consentimiento";
import { pedirCuenta, terminarCuenta } from "./acciones";

// Sin Auth ni base: las acciones de /cuenta/crear con todo lo de afuera inventado. Aquí se fija el orden (la guarda es
// lo primero y, rechazada, no toca nada), que con Lead no se lee nada del formulario salvo `siguiente`, que con tope no
// se llama a Auth, la cookie de regreso y que los `redirect` quedan fuera de los `try`. Con Auth y la base de verdad lo
// cubren integracion/cuenta-estudiante.test.ts y e2e/cuenta.spec.ts.

const sesion = vi.hoisted(() => ({ actual: null as { idUsuario: string; rol: Rol | null } | null }));
const servidor = vi.hoisted(() => ({
  leadDeLaSesion: vi.fn(),
  registrarContacto: vi.fn(),
  leadTieneCuenta: vi.fn(),
  pedirCuentaDeEstudiante: vi.fn(),
  activarCuenta: vi.fn(),
  confirmacionDeCorreoActiva: vi.fn(),
  tokenDeAccesoDeLaSesion: vi.fn(),
  crearClienteServidor: vi.fn(),
}));
const almacen = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => sesion.actual }));
vi.mock("@/lib/leads/servidor", () => ({
  leadDeLaSesion: servidor.leadDeLaSesion,
  registrarContacto: servidor.registrarContacto,
}));
vi.mock("@/lib/cuentas/servidor", () => ({
  leadTieneCuenta: servidor.leadTieneCuenta,
  pedirCuentaDeEstudiante: servidor.pedirCuentaDeEstudiante,
  activarCuenta: servidor.activarCuenta,
  confirmacionDeCorreoActiva: servidor.confirmacionDeCorreoActiva,
  tokenDeAccesoDeLaSesion: servidor.tokenDeAccesoDeLaSesion,
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: servidor.crearClienteServidor }));
vi.mock("next/headers", () => ({ cookies: async () => almacen }));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`redirect:${ruta}`);
  },
}));

const ID_SESION = "5a5a5a5a-0000-4000-8000-000000000032";
const LEAD: LeadDeSesion = { id: "1e1e1e1e-0000-4000-8000-000000000032", nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numeroTelefono: null };
const CLIENTE = { auth: {} };

const como = (rol: Rol | null) => {
  sesion.actual = { idUsuario: ID_SESION, rol };
};

/** Un formulario de contacto como lo manda el navegador, con la autorización marcada. */
function formulario(campos: Record<string, string> = {}): FormData {
  const datos = new FormData();
  const todos = { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numero_telefono: "", acepta_tratamiento_datos: "si", ...campos };
  for (const [clave, valor] of Object.entries(todos)) datos.set(clave, valor);
  return datos;
}

const ESTADO = { error: null, aviso: null, valores: {} };

let errores: unknown[][];

beforeEach(() => {
  sesion.actual = null;
  for (const mock of [...Object.values(servidor), almacen.get, almacen.set, almacen.delete]) mock.mockReset();
  servidor.crearClienteServidor.mockResolvedValue(CLIENTE);
  servidor.leadTieneCuenta.mockResolvedValue(false);
  servidor.pedirCuentaDeEstudiante.mockResolvedValue({ resultado: "enviado" });
  servidor.confirmacionDeCorreoActiva.mockResolvedValue(true);
  almacen.get.mockReturnValue(undefined);
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

/** Ninguna de las cosas de afuera se tocó. */
function nadaTocado() {
  expect(servidor.leadDeLaSesion).not.toHaveBeenCalled();
  expect(servidor.registrarContacto).not.toHaveBeenCalled();
  expect(servidor.leadTieneCuenta).not.toHaveBeenCalled();
  expect(servidor.pedirCuentaDeEstudiante).not.toHaveBeenCalled();
  expect(servidor.activarCuenta).not.toHaveBeenCalled();
  expect(almacen.set).not.toHaveBeenCalled();
}

describe("pedirCuenta: la guarda de rol es lo primero y, rechazada, no toca nada", () => {
  it("sin sesión: pide recargar", async () => {
    expect(await pedirCuenta(ESTADO, formulario())).toEqual({ error: TEXTOS.sinSesion, aviso: null, valores: {} });
    nadaTocado();
  });

  it("un monitor o un admin no pide cuenta", async () => {
    for (const rol of ["monitor", "admin"] as const) {
      como(rol);
      expect(await pedirCuenta(ESTADO, formulario()), rol).toEqual({ error: TEXTOS.equipo, aviso: null, valores: {} });
    }
    nadaTocado();
  });

  it("un Estudiante va a «Mis citas»", async () => {
    como("estudiante");
    await expect(pedirCuenta(ESTADO, formulario())).rejects.toThrow(new Error("redirect:/cita"));
    nadaTocado();
  });

  it("una sesión sin rol (ya confirmó su correo) no pide otra: updateUser({ email }) nunca se llama sobre una cuenta ya convertida", async () => {
    como(null);
    expect(await pedirCuenta(ESTADO, formulario())).toEqual({ error: TEXTOS.sesionSinRol, aviso: null, valores: {} });
    nadaTocado();
  });
});

describe("pedirCuenta: una sesión sin Lead crea el Lead con el formulario (criterio 8)", () => {
  beforeEach(() => {
    como("anonimo");
    servidor.leadDeLaSesion.mockResolvedValueOnce(null).mockResolvedValue(LEAD);
    servidor.registrarContacto.mockResolvedValue({ resultado: "lead" } satisfies ResultadoContacto);
  });

  it("con el formulario inválido o sin la autorización no guarda nada ni llama a Auth, y devuelve lo escrito", async () => {
    const sinNombre = await pedirCuenta(ESTADO, formulario({ nombre: " " }));
    expect(sinNombre.error).toBe("Escribe tu nombre.");
    expect(sinNombre.valores).toMatchObject({ correo: "camila@uniandes.edu.co" });

    servidor.leadDeLaSesion.mockReset().mockResolvedValue(null);
    const datos = formulario();
    datos.delete("acepta_tratamiento_datos");
    expect(await pedirCuenta(ESTADO, datos)).toMatchObject({ error: ERROR_SIN_AUTORIZACION });

    servidor.leadDeLaSesion.mockReset().mockResolvedValue(null);
    expect((await pedirCuenta(ESTADO, formulario({ correo: "no-es-un-correo" }))).error).toMatch(/correo válido/);

    expect(servidor.registrarContacto).not.toHaveBeenCalled();
    expect(servidor.pedirCuentaDeEstudiante).not.toHaveBeenCalled();
  });

  it("crea el Lead con registrarContacto (con la autorización y el regreso a /cuenta/crear), lo vuelve a leer y pide el correo del Lead", async () => {
    // Crear el Lead cambia la pantalla de /cuenta/crear (del formulario al resumen): el aviso viaja en la dirección.
    await expect(pedirCuenta(ESTADO, formulario({ siguiente: "/privacidad", acepta_contacto: "si" }))).rejects.toThrow(
      new Error("redirect:/cuenta/crear?siguiente=%2Fprivacidad&enviado=1"),
    );

    expect(servidor.registrarContacto).toHaveBeenCalledTimes(1);
    const entrada = servidor.registrarContacto.mock.calls[0][0];
    expect(entrada.idSesion).toBe(ID_SESION);
    expect(entrada.contacto).toEqual({ nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numeroTelefono: null });
    expect(entrada.consentimiento).toMatchObject({ acepta_tratamiento_datos: true, acepta_contacto: true });
    // El enlace de verificación de P-23 vuelve a esta pantalla, con la misma ruta de regreso.
    expect(entrada.siguiente).toBe("/cuenta/crear?siguiente=%2Fprivacidad");
    expect(servidor.leadDeLaSesion).toHaveBeenCalledTimes(2);
    expect(servidor.pedirCuentaDeEstudiante).toHaveBeenCalledWith(CLIENTE, { idSesion: ID_SESION, lead: LEAD });
  });

  it("sin ruta de regreso, el redirect de quien creó el Lead va a /cuenta/crear?enviado=1 y la cookie vieja se borra", async () => {
    await expect(pedirCuenta(ESTADO, formulario())).rejects.toThrow(new Error("redirect:/cuenta/crear?enviado=1"));
    expect(almacen.delete).toHaveBeenCalledWith(COOKIE_SIGUIENTE);
  });

  it("el redirect de quien creó el Lead va después de pedir el correo y de poner la cookie, y solo si Auth no falló", async () => {
    servidor.pedirCuentaDeEstudiante.mockResolvedValueOnce({ resultado: "error", error: "Ya te enviamos un enlace hace un momento." });
    expect(await pedirCuenta(ESTADO, formulario({ siguiente: "/privacidad" }))).toMatchObject({ error: "Ya te enviamos un enlace hace un momento." });
    expect(almacen.set).not.toHaveBeenCalled();

    servidor.leadDeLaSesion.mockReset().mockResolvedValueOnce(null).mockResolvedValue(LEAD);
    await expect(pedirCuenta(ESTADO, formulario({ siguiente: "/privacidad" }))).rejects.toThrow(/^redirect:/);
    expect(almacen.set).toHaveBeenCalledTimes(1);
  });

  it("el correo de otro Lead (P-23): sale el aviso de verificación de «creando tu cuenta» y no se llama a Auth", async () => {
    for (const envio of ["enviado", "frenado", "fallido"] as const) {
      servidor.leadDeLaSesion.mockReset().mockResolvedValue(null);
      servidor.registrarContacto.mockResolvedValueOnce({ resultado: "verificar", envio });

      const estado = await pedirCuenta(ESTADO, formulario());
      expect(estado, envio).toMatchObject({ error: null, aviso: avisoDeVerificacion(envio, "creando tu cuenta") });
    }
    expect(servidor.leadTieneCuenta).not.toHaveBeenCalled();
    expect(servidor.pedirCuentaDeEstudiante).not.toHaveBeenCalled();
    expect(almacen.set).not.toHaveBeenCalled();
  });

  it("un error de registrarContacto (el tope de correos de HU-075) se devuelve y no se llama a Auth", async () => {
    servidor.registrarContacto.mockResolvedValueOnce({ resultado: "error", error: "Probaste varios correos seguidos." });

    expect(await pedirCuenta(ESTADO, formulario())).toMatchObject({ error: "Probaste varios correos seguidos." });
    expect(servidor.pedirCuentaDeEstudiante).not.toHaveBeenCalled();
  });

  it("si registrarContacto lanza, no se llama a Auth y el registro no trae el correo", async () => {
    servidor.registrarContacto.mockRejectedValueOnce(new Error("se cayó la base"));

    expect(await pedirCuenta(ESTADO, formulario())).toMatchObject({ error: TEXTOS.noPudimosGuardar });
    expect(servidor.pedirCuentaDeEstudiante).not.toHaveBeenCalled();
    expect(JSON.stringify(errores)).not.toContain("camila@uniandes.edu.co");
  });
});

describe("pedirCuenta: con Lead no se lee nada del formulario salvo `siguiente`", () => {
  beforeEach(() => {
    como("anonimo");
    servidor.leadDeLaSesion.mockResolvedValue(LEAD);
  });

  it("pide la cuenta con el correo del Lead de la base, aunque el formulario traiga otro (el correo no se cambia a escondidas)", async () => {
    const estado = await pedirCuenta(ESTADO, formulario({ correo: "intruso@calibra.test", nombre: "Otro" }));

    expect(servidor.registrarContacto).not.toHaveBeenCalled();
    expect(servidor.pedirCuentaDeEstudiante).toHaveBeenCalledWith(CLIENTE, { idSesion: ID_SESION, lead: LEAD });
    expect(estado.aviso).toBe(TEXTOS.avisoEnviado("camila@uniandes.edu.co"));
    expect(estado.aviso).not.toContain("intruso");
    // No devuelve lo escrito: no lo leyó.
    expect(estado.valores).toEqual({});
  });

  it("con el formulario vacío (la pantalla de resumen no tiene campos) funciona igual", async () => {
    const datos = new FormData();
    datos.set("siguiente", "/");
    expect(await pedirCuenta(ESTADO, datos)).toMatchObject({ error: null, aviso: TEXTOS.avisoEnviado("camila@uniandes.edu.co") });
  });

  it("si el Lead ya tiene cuenta no sale ningún correo: vuelve a /cuenta/crear, que lo dice", async () => {
    servidor.leadTieneCuenta.mockResolvedValue(true);

    await expect(pedirCuenta(ESTADO, formulario({ siguiente: "/privacidad" }))).rejects.toThrow(new Error("redirect:/cuenta/crear?siguiente=%2Fprivacidad"));
    expect(servidor.leadTieneCuenta).toHaveBeenCalledWith(LEAD.id);
    expect(servidor.pedirCuentaDeEstudiante).not.toHaveBeenCalled();
    expect(almacen.set).not.toHaveBeenCalled();
  });

  it("el redirect de «ya tiene cuenta» no queda atrapado por un catch: la acción lo deja pasar", async () => {
    servidor.leadTieneCuenta.mockResolvedValue(true);
    // Si el redirect estuviera dentro del try, se tomaría por un error de la base y devolvería TEXTOS.noPudimosGuardar.
    await expect(pedirCuenta(ESTADO, formulario())).rejects.toThrow(new Error("redirect:/cuenta/crear"));
    expect(errores).toEqual([]);
  });

  it("sin correo dice que lo agregue y no llama a Auth", async () => {
    servidor.leadDeLaSesion.mockResolvedValue({ ...LEAD, correo: null });

    expect(await pedirCuenta(ESTADO, formulario())).toMatchObject({ error: TEXTOS.sinCorreo });
    expect(servidor.pedirCuentaDeEstudiante).not.toHaveBeenCalled();
  });

  it("con tope por sesión o total devuelve su mensaje, no pone la cookie de regreso y no gasta nada más", async () => {
    for (const [cual, texto] of [
      ["sesion", TEXTOS.topeDeSesion],
      ["total", TEXTOS.topeTotal],
    ] as const) {
      servidor.pedirCuentaDeEstudiante.mockResolvedValueOnce({ resultado: "tope", cual });
      expect(await pedirCuenta(ESTADO, formulario({ siguiente: "/privacidad" })), cual).toMatchObject({ error: texto, aviso: null });
    }
    expect(almacen.set).not.toHaveBeenCalled();
    expect(almacen.delete).not.toHaveBeenCalled();
  });

  it("si Auth no pudo mandar el correo, devuelve su mensaje y no pone la cookie", async () => {
    servidor.pedirCuentaDeEstudiante.mockResolvedValueOnce({ resultado: "error", error: "Ya te enviamos un enlace hace un momento." });

    expect(await pedirCuenta(ESTADO, formulario())).toMatchObject({ error: "Ya te enviamos un enlace hace un momento.", aviso: null });
    expect(almacen.set).not.toHaveBeenCalled();
  });

  it("si pedirCuentaDeEstudiante lanza (la base falló), dice que no salió el correo y no registra el correo", async () => {
    servidor.pedirCuentaDeEstudiante.mockRejectedValueOnce(new Error("se cayó la base"));

    expect(await pedirCuenta(ESTADO, formulario())).toMatchObject({ error: TEXTOS.noSalioElCorreo });
    expect(JSON.stringify(errores)).not.toContain("camila@uniandes.edu.co");
  });

  it("si no se puede leer el Lead o su cuenta, no sigue", async () => {
    servidor.leadDeLaSesion.mockRejectedValueOnce(new Error("falló"));
    expect(await pedirCuenta(ESTADO, formulario())).toMatchObject({ error: TEXTOS.noPudimosGuardar });
    servidor.leadTieneCuenta.mockRejectedValueOnce(new Error("falló"));
    expect(await pedirCuenta(ESTADO, formulario())).toMatchObject({ error: TEXTOS.noPudimosGuardar });
    expect(servidor.pedirCuentaDeEstudiante).not.toHaveBeenCalled();
  });
});

describe("pedirCuenta: la cookie de regreso (criterio 15)", () => {
  beforeEach(() => {
    como("anonimo");
    servidor.leadDeLaSesion.mockResolvedValue(LEAD);
  });

  it("con una ruta interna pone una cookie httpOnly de 24 horas, de todo el sitio, con la ruta normalizada", async () => {
    await pedirCuenta(ESTADO, formulario({ siguiente: "/monitores?materia=X" }));

    expect(almacen.set).toHaveBeenCalledTimes(1);
    expect(almacen.set).toHaveBeenCalledWith(COOKIE_SIGUIENTE, "/monitores?materia=X", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 86_400,
    });
    expect(almacen.delete).not.toHaveBeenCalled();
  });

  it("la cookie va con secure en producción", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await pedirCuenta(ESTADO, formulario({ siguiente: "/privacidad" }));

    expect(almacen.set.mock.calls[0][2]).toMatchObject({ secure: true });
  });

  it("una ruta externa o mal formada se ignora: no se guarda y se borra una vieja", async () => {
    for (const externa of ["https://otro.sitio", "//otro.sitio", "/.//otro.sitio", "/\\otro", ""]) {
      almacen.set.mockClear();
      almacen.delete.mockClear();

      await pedirCuenta(ESTADO, formulario({ siguiente: externa }));
      expect(almacen.set, externa).not.toHaveBeenCalled();
      expect(almacen.delete, externa).toHaveBeenCalledWith(COOKIE_SIGUIENTE);
    }
  });

  it("sin ruta (la portada) borra una cookie vieja de otro pedido", async () => {
    await pedirCuenta(ESTADO, formulario());

    expect(almacen.set).not.toHaveBeenCalled();
    expect(almacen.delete).toHaveBeenCalledWith(COOKIE_SIGUIENTE);
  });
});

describe("terminarCuenta (criterio 14)", () => {
  const llamar = () => terminarCuenta();

  it("la guarda es lo primero: sin sesión, del equipo, anónima o sin permiso no toca a Auth", async () => {
    expect(await llamar()).toEqual({ error: TEXTOS.sinSesion });
    for (const [rol, texto] of [
      ["monitor", TEXTOS.equipo],
      ["admin", TEXTOS.equipo],
      ["anonimo", TEXTOS.sesionSinRol],
    ] as const) {
      como(rol);
      expect(await llamar(), rol).toEqual({ error: texto });
    }
    expect(servidor.activarCuenta).not.toHaveBeenCalled();
    expect(servidor.crearClienteServidor).not.toHaveBeenCalled();
    // La guardia de Auth viene después de la de rol: a quien no puede terminar la cuenta ni se le lee la configuración.
    expect(servidor.confirmacionDeCorreoActiva).not.toHaveBeenCalled();
  });

  it("revisión: con Auth sin exigir confirmar el correo (o sin poder leerlo) no se termina la cuenta: ni cliente, ni token, ni activarCuenta", async () => {
    como(null);
    servidor.confirmacionDeCorreoActiva.mockResolvedValue(false);

    expect(await llamar()).toEqual({ error: TEXTOS.noSalioElCorreo });
    expect(servidor.confirmacionDeCorreoActiva).toHaveBeenCalledTimes(1);
    expect(servidor.crearClienteServidor).not.toHaveBeenCalled();
    expect(servidor.tokenDeAccesoDeLaSesion).not.toHaveBeenCalled();
    expect(servidor.activarCuenta).not.toHaveBeenCalled();
    expect(JSON.stringify(errores)).not.toContain(ID_SESION);
  });

  it("revisión: si activarCuenta repite la guardia y Auth ya no exige confirmar, dice lo mismo que cuando el correo no sale", async () => {
    como(null);
    servidor.tokenDeAccesoDeLaSesion.mockResolvedValue("token-de-acceso");
    servidor.activarCuenta.mockResolvedValue({ ok: false, motivo: "sin_confirmacion" });

    expect(await llamar()).toEqual({ error: TEXTOS.noSalioElCorreo });
  });

  it("un Estudiante ya terminó: va a «Mis citas»", async () => {
    como("estudiante");
    await expect(llamar()).rejects.toThrow(new Error("redirect:/cita"));
    expect(servidor.activarCuenta).not.toHaveBeenCalled();
  });

  it("quien confirmó y no tiene rol repite el paso con su token y llega a elegir la contraseña", async () => {
    como(null);
    servidor.tokenDeAccesoDeLaSesion.mockResolvedValue("token-de-acceso");
    servidor.activarCuenta.mockResolvedValue({ ok: true });

    await expect(llamar()).rejects.toThrow(new Error("redirect:/cuenta/contrasena"));
    expect(servidor.tokenDeAccesoDeLaSesion).toHaveBeenCalledWith(CLIENTE);
    expect(servidor.activarCuenta).toHaveBeenCalledWith(ID_SESION, "token-de-acceso");
  });

  it("si la base dice que escriba a soporte, lo dice con el correo de soporte y no manda a reintentar", async () => {
    como(null);
    servidor.tokenDeAccesoDeLaSesion.mockResolvedValue("token-de-acceso");
    servidor.activarCuenta.mockResolvedValue({ ok: false, motivo: "soporte" });

    expect(await llamar()).toEqual({ error: "No pudimos activar tu cuenta con estos datos. Escribe a soporte (soporte@calibra.example) y te ayudamos." });
  });

  it("sin correo de soporte configurado, el mensaje no promete un canal", async () => {
    vi.stubEnv("CORREO_DATOS_PERSONALES", "");
    como(null);
    servidor.tokenDeAccesoDeLaSesion.mockResolvedValue("token-de-acceso");
    servidor.activarCuenta.mockResolvedValue({ ok: false, motivo: "soporte" });

    expect(await llamar()).toEqual({ error: "No pudimos activar tu cuenta con estos datos. Escribe a soporte y te ayudamos." });
  });

  it("un fallo temporal (sesiones, no confirmada, fallo) dice que intente de nuevo", async () => {
    como(null);
    servidor.tokenDeAccesoDeLaSesion.mockResolvedValue("token-de-acceso");
    for (const motivo of ["sesiones", "no_confirmada", "fallo"] as const) {
      servidor.activarCuenta.mockResolvedValueOnce({ ok: false, motivo });
      expect(await llamar(), motivo).toEqual({ error: TEXTOS.terminarFallo });
    }
    servidor.activarCuenta.mockRejectedValueOnce(new Error("falló"));
    expect(await llamar()).toEqual({ error: TEXTOS.terminarFallo });
  });

  it("sin el token de la sesión pide recargar y no llama a activarCuenta", async () => {
    como(null);
    servidor.tokenDeAccesoDeLaSesion.mockResolvedValue(null);

    expect(await llamar()).toEqual({ error: TEXTOS.sinSesion });
    expect(servidor.activarCuenta).not.toHaveBeenCalled();
  });
});
