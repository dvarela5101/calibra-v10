import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS } from "./reglas";
import {
  activarCuenta,
  anotarEnvio,
  confirmacionDeCorreoActiva,
  confirmarCorreoDeCuenta,
  leadTieneCuenta,
  olvidarLaGuardia,
  pedirCuentaDeEstudiante,
  tokenDeAccesoDeLaSesion,
} from "./servidor";

// Sin base ni Auth: el cliente de la llave secreta y el de la sesión son falsos, y `fetch` también. Aquí se fija el orden
// de lo que hace cada paso (anotar, guardia, vincular; cerrar sesiones, crear), lo que se responde con cada código y que
// nunca se registre el correo ni el token. Con Auth y la base de verdad lo cubre integracion/cuenta-estudiante.test.ts.

const admin = vi.hoisted(() => {
  const rpc = vi.fn();
  const signOut = vi.fn();
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { rpc, from, select, eq, maybeSingle, auth: { admin: { signOut } } };
});
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => admin }));

const CORREO = "ana.secreta@calibra.test";
const ID_SESION = "5a5a5a5a-0000-4000-8000-000000000032";
const TOKEN_HASH = "pkce_" + "Ab1-".repeat(12);
const TOKEN_DE_ACCESO = "eyJ.token-de-acceso.firma";

/** `console.error` capturado: ninguna llamada puede traer el correo ni el token. */
let errores: unknown[][];

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_de_prueba");
  olvidarLaGuardia();
  admin.rpc.mockReset();
  admin.auth.admin.signOut.mockReset();
  admin.maybeSingle.mockReset();
  errores = [];
  vi.spyOn(console, "error").mockImplementation((...argumentos: unknown[]) => {
    errores.push(argumentos);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const registrado = () => JSON.stringify(errores);

/** Un `fetch` que responde lo que se le diga a `/auth/v1/settings`. */
const respuestaDeAjustes = (cuerpo: unknown, ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => cuerpo }) as unknown as Response);

describe("confirmacionDeCorreoActiva: la guardia contra el panel olvidado (HU-032, 3.1)", () => {
  it("con mailer_autoconfirm en falso es segura, y pide /auth/v1/settings con la llave pública y un plazo", async () => {
    const leer = respuestaDeAjustes({ mailer_autoconfirm: false });

    expect(await confirmacionDeCorreoActiva({ leer })).toBe(true);
    expect(leer).toHaveBeenCalledTimes(1);
    const [url, opciones] = leer.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:54321/auth/v1/settings");
    expect(opciones.headers).toEqual({ apikey: "sb_publishable_de_prueba" });
    expect(opciones.signal).toBeInstanceOf(AbortSignal);
  });

  it("con mailer_autoconfirm en verdadero no es segura: updateUser({ email }) convertiría al anónimo sin confirmar", async () => {
    expect(await confirmacionDeCorreoActiva({ leer: respuestaDeAjustes({ mailer_autoconfirm: true }) })).toBe(false);
  });

  it("falla cerrado: sin configuración, con error de red, de HTTP, de JSON o con una respuesta rara", async () => {
    const sinRed = vi.fn(async () => {
      throw new Error("sin red");
    });
    const jsonRoto = vi.fn(async () => ({ ok: true, json: async () => Promise.reject(new Error("no es JSON")) }) as unknown as Response);
    expect(await confirmacionDeCorreoActiva({ leer: sinRed })).toBe(false);
    expect(await confirmacionDeCorreoActiva({ leer: respuestaDeAjustes({ mailer_autoconfirm: false }, false) })).toBe(false);
    expect(await confirmacionDeCorreoActiva({ leer: jsonRoto })).toBe(false);
    for (const cuerpo of [{}, null, { mailer_autoconfirm: "false" }, { mailer_autoconfirm: 0 }, { mailer_autoconfirm: null }]) {
      expect(await confirmacionDeCorreoActiva({ leer: respuestaDeAjustes(cuerpo) }), JSON.stringify(cuerpo)).toBe(false);
    }

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const sinLlamar = respuestaDeAjustes({ mailer_autoconfirm: false });
    expect(await confirmacionDeCorreoActiva({ leer: sinLlamar })).toBe(false);
    expect(sinLlamar).not.toHaveBeenCalled();
  });

  it("recuerda una lectura segura 5 minutos y después vuelve a leer", async () => {
    const leer = respuestaDeAjustes({ mailer_autoconfirm: false });
    const t0 = 1_000_000;

    expect(await confirmacionDeCorreoActiva({ leer, ahora: t0 })).toBe(true);
    expect(await confirmacionDeCorreoActiva({ leer, ahora: t0 + 5 * 60_000 - 1 })).toBe(true);
    expect(leer).toHaveBeenCalledTimes(1);

    expect(await confirmacionDeCorreoActiva({ leer, ahora: t0 + 5 * 60_000 })).toBe(true);
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it("no recuerda una lectura insegura ni un fallo: la siguiente vuelve a leer, y si el panel ya se arregló pasa", async () => {
    let autoconfirm = true;
    const leer = vi.fn(async () => ({ ok: true, json: async () => ({ mailer_autoconfirm: autoconfirm }) }) as unknown as Response);

    expect(await confirmacionDeCorreoActiva({ leer, ahora: 10 })).toBe(false);
    autoconfirm = false;
    expect(await confirmacionDeCorreoActiva({ leer, ahora: 11 })).toBe(true);
    expect(leer).toHaveBeenCalledTimes(2);
  });
});

describe("anotarEnvio", () => {
  it("devuelve lo que dice la base y la llama con la sesión", async () => {
    for (const respuesta of ["ok", "tope_de_sesion", "tope_global"]) {
      admin.rpc.mockResolvedValueOnce({ data: respuesta, error: null });
      expect(await anotarEnvio(ID_SESION), respuesta).toBe(respuesta);
    }
    expect(admin.rpc).toHaveBeenCalledWith("anotar_envio_de_cuenta", { p_id_sesion: ID_SESION });
  });

  it("un error de la base o una respuesta desconocida lanza: nunca se toma como un permiso", async () => {
    admin.rpc.mockResolvedValueOnce({ data: null, error: new Error("falló") });
    await expect(anotarEnvio(ID_SESION)).rejects.toThrow("falló");
    for (const rara of ["creada", "", null, true]) {
      admin.rpc.mockResolvedValueOnce({ data: rara, error: null });
      await expect(anotarEnvio(ID_SESION), String(rara)).rejects.toThrow(/desconocida/);
    }
  });
});

describe("pedirCuentaDeEstudiante: anotar, guardia y vincular, en ese orden", () => {
  const cliente = (respuesta: { data?: { user: { is_anonymous: boolean } | null }; error?: { code?: string } | null } = {}) => {
    const updateUser = vi.fn(async () => ({ data: respuesta.data ?? { user: { is_anonymous: true } }, error: respuesta.error ?? null }));
    return { supabase: { auth: { updateUser } } as unknown as SupabaseClient, updateUser };
  };
  const autoconfirmEn = (valor: boolean) => vi.stubGlobal("fetch", respuestaDeAjustes({ mailer_autoconfirm: valor }));

  it("con cupo y la guardia en orden, pide el cambio de correo con el correo del Lead y responde «enviado»", async () => {
    autoconfirmEn(false);
    admin.rpc.mockResolvedValueOnce({ data: "ok", error: null });
    const { supabase, updateUser } = cliente();

    expect(await pedirCuentaDeEstudiante(supabase, { idSesion: ID_SESION, lead: { correo: CORREO } })).toEqual({ resultado: "enviado" });
    expect(admin.rpc).toHaveBeenCalledWith("anotar_envio_de_cuenta", { p_id_sesion: ID_SESION });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ email: CORREO });
  });

  it("el orden es anotar, guardia y vincular: cada paso ocurre antes del siguiente", async () => {
    const orden: string[] = [];
    admin.rpc.mockImplementationOnce(async () => {
      orden.push("anotar");
      return { data: "ok", error: null };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        orden.push("guardia");
        return { ok: true, json: async () => ({ mailer_autoconfirm: false }) } as unknown as Response;
      }),
    );
    const updateUser = vi.fn(async () => {
      orden.push("vincular");
      return { data: { user: { is_anonymous: true } }, error: null };
    });

    await pedirCuentaDeEstudiante({ auth: { updateUser } } as unknown as SupabaseClient, { idSesion: ID_SESION, lead: { correo: CORREO } });
    expect(orden).toEqual(["anotar", "guardia", "vincular"]);
  });

  it("con el tope de la sesión o el total, no llama a Auth: ni a la guardia ni a updateUser", async () => {
    const leer = respuestaDeAjustes({ mailer_autoconfirm: false });
    vi.stubGlobal("fetch", leer);
    for (const [respuesta, cual] of [
      ["tope_de_sesion", "sesion"],
      ["tope_global", "total"],
    ] as const) {
      admin.rpc.mockResolvedValueOnce({ data: respuesta, error: null });
      const { supabase, updateUser } = cliente();

      expect(await pedirCuentaDeEstudiante(supabase, { idSesion: ID_SESION, lead: { correo: CORREO } }), respuesta).toEqual({ resultado: "tope", cual });
      expect(updateUser, respuesta).not.toHaveBeenCalled();
    }
    expect(leer).not.toHaveBeenCalled();
  });

  it("sin correo en el Lead dice que lo agregue y no gasta cupo ni llama a Auth", async () => {
    const { supabase, updateUser } = cliente();

    expect(await pedirCuentaDeEstudiante(supabase, { idSesion: ID_SESION, lead: { correo: null } })).toEqual({ resultado: "error", error: TEXTOS.sinCorreo });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("si Auth no exige confirmar el correo (o no se pudo leer), no pide la cuenta: el cupo ya se gastó", async () => {
    for (const intento of [respuestaDeAjustes({ mailer_autoconfirm: true }), respuestaDeAjustes({}, false)]) {
      olvidarLaGuardia();
      vi.stubGlobal("fetch", intento);
      admin.rpc.mockResolvedValueOnce({ data: "ok", error: null });
      const { supabase, updateUser } = cliente();

      expect(await pedirCuentaDeEstudiante(supabase, { idSesion: ID_SESION, lead: { correo: CORREO } })).toEqual({
        resultado: "error",
        error: TEXTOS.noSalioElCorreo,
      });
      expect(updateUser).not.toHaveBeenCalled();
    }
    expect(admin.rpc).toHaveBeenCalledTimes(2);
  });

  it("con email_exists responde lo mismo que un envío normal: nadie averigua qué correos tienen cuenta", async () => {
    autoconfirmEn(false);
    admin.rpc.mockResolvedValueOnce({ data: "ok", error: null });
    const { supabase } = cliente({ error: { code: "email_exists" } });

    expect(await pedirCuentaDeEstudiante(supabase, { idSesion: ID_SESION, lead: { correo: CORREO } })).toEqual({ resultado: "enviado" });
  });

  it("con over_email_send_rate_limit da su mensaje en español; con otro código, el de «no salió»", async () => {
    autoconfirmEn(false);
    for (const [codigo, texto] of [
      ["over_email_send_rate_limit", "Ya te enviamos un enlace hace un momento. Revisa tu correo o espera un minuto."],
      ["unexpected_failure", TEXTOS.noSalioElCorreo],
      ["desconocido", TEXTOS.noSalioElCorreo],
    ] as const) {
      admin.rpc.mockResolvedValueOnce({ data: "ok", error: null });
      const { supabase } = cliente({ error: { code: codigo } });

      expect(await pedirCuentaDeEstudiante(supabase, { idSesion: ID_SESION, lead: { correo: CORREO } }), codigo).toEqual({ resultado: "error", error: texto });
    }
  });

  it("si Auth ya lo dejó de ser anónimo (confirmaciones apagadas), es un fallo y no un envío", async () => {
    autoconfirmEn(false);
    admin.rpc.mockResolvedValueOnce({ data: "ok", error: null });
    const { supabase } = cliente({ data: { user: { is_anonymous: false } } });

    expect(await pedirCuentaDeEstudiante(supabase, { idSesion: ID_SESION, lead: { correo: CORREO } })).toEqual({
      resultado: "error",
      error: TEXTOS.noSalioElCorreo,
    });
  });

  it("ningún registro contiene el correo", async () => {
    autoconfirmEn(true);
    admin.rpc.mockResolvedValueOnce({ data: "ok", error: null });
    await pedirCuentaDeEstudiante(cliente().supabase, { idSesion: ID_SESION, lead: { correo: CORREO } });
    olvidarLaGuardia();
    autoconfirmEn(false);
    admin.rpc.mockResolvedValueOnce({ data: "ok", error: null });
    await pedirCuentaDeEstudiante(cliente({ error: { code: "unexpected_failure" } }).supabase, { idSesion: ID_SESION, lead: { correo: CORREO } });

    expect(errores.length).toBeGreaterThan(0);
    expect(registrado()).not.toContain(CORREO);
    expect(registrado()).not.toContain("secreta");
  });
});

describe("confirmarCorreoDeCuenta", () => {
  const conVerifyOtp = (resultado: unknown) => {
    const verifyOtp = vi.fn(async () => resultado);
    return { supabase: { auth: { verifyOtp } } as unknown as SupabaseClient, verifyOtp };
  };
  const usuario = (is_anonymous: boolean) => ({ id: ID_SESION, is_anonymous, email: CORREO });
  const sesion = { access_token: TOKEN_DE_ACCESO };

  it("llama a verifyOtp con el tipo email_change y el token_hash, y devuelve el id y el token de la sesión nueva", async () => {
    const { supabase, verifyOtp } = conVerifyOtp({ data: { user: usuario(false), session: sesion }, error: null });

    expect(await confirmarCorreoDeCuenta(supabase, TOKEN_HASH)).toEqual({ ok: true, idUsuario: ID_SESION, tokenDeAcceso: TOKEN_DE_ACCESO });
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email_change", token_hash: TOKEN_HASH });
  });

  it("un 4xx de Auth (enlace usado, vencido o inventado) es «no sirve»; 429 y los demás se pueden reintentar", async () => {
    for (const [status, motivo] of [
      [400, "no_sirve"],
      [401, "no_sirve"],
      [403, "no_sirve"],
      [404, "no_sirve"],
      [422, "no_sirve"],
      [429, "fallo"],
      [500, "fallo"],
      [502, "fallo"],
      [0, "fallo"],
      [undefined, "fallo"],
    ] as const) {
      const { supabase } = conVerifyOtp({ data: { user: null, session: null }, error: { status, code: "otp_expired" } });
      expect(await confirmarCorreoDeCuenta(supabase, TOKEN_HASH), String(status)).toEqual({ ok: false, motivo });
    }
  });

  it("si no hay sesión o el usuario sigue anónimo, no es una cuenta: «fallo»", async () => {
    for (const data of [
      { user: usuario(true), session: sesion },
      { user: usuario(false), session: null },
      { user: null, session: sesion },
    ]) {
      const { supabase } = conVerifyOtp({ data, error: null });
      expect(await confirmarCorreoDeCuenta(supabase, TOKEN_HASH), JSON.stringify(data)).toEqual({ ok: false, motivo: "fallo" });
    }
  });

  it("ningún registro contiene el token, el correo ni el token de acceso", async () => {
    await confirmarCorreoDeCuenta(conVerifyOtp({ data: { user: null, session: null }, error: { status: 403, code: "otp_expired", message: TOKEN_HASH } }).supabase, TOKEN_HASH);
    await confirmarCorreoDeCuenta(conVerifyOtp({ data: { user: usuario(true), session: sesion }, error: null }).supabase, TOKEN_HASH);

    expect(errores.length).toBe(2);
    for (const secreto of [TOKEN_HASH, CORREO, TOKEN_DE_ACCESO]) expect(registrado()).not.toContain(secreto);
  });
});

describe("activarCuenta: la guardia de Auth, cierra las demás sesiones y después crea el Estudiante", () => {
  // La guardia contra el panel olvidado va primero (revisión de HU-032): estos casos parten de un Auth que sí exige confirmar.
  beforeEach(() => {
    vi.stubGlobal("fetch", respuestaDeAjustes({ mailer_autoconfirm: false }));
  });

  it("comprueba que Auth exija confirmar el correo, cierra las demás sesiones con el token de la sesión nueva y después crea: ok con «creada»", async () => {
    const orden: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        orden.push("guardia");
        return { ok: true, json: async () => ({ mailer_autoconfirm: false }) } as unknown as Response;
      }),
    );
    admin.auth.admin.signOut.mockImplementationOnce(async () => {
      orden.push("cerrar");
      return { error: null };
    });
    admin.rpc.mockImplementationOnce(async () => {
      orden.push("crear");
      return { data: "creada", error: null };
    });

    expect(await activarCuenta(ID_SESION, TOKEN_DE_ACCESO)).toEqual({ ok: true });
    expect(orden).toEqual(["guardia", "cerrar", "crear"]);
    expect(admin.auth.admin.signOut).toHaveBeenCalledWith(TOKEN_DE_ACCESO, "others");
    expect(admin.rpc).toHaveBeenCalledWith("crear_estudiante", { p_id_usuario: ID_SESION });
  });

  it("con mailer_autoconfirm activo (updateUser({ email }) pudo ligar un correo que nadie confirmó) no cierra sesiones ni crea: «sin_confirmacion»", async () => {
    const leer = respuestaDeAjustes({ mailer_autoconfirm: true });
    vi.stubGlobal("fetch", leer);

    expect(await activarCuenta(ID_SESION, TOKEN_DE_ACCESO)).toEqual({ ok: false, motivo: "sin_confirmacion" });
    expect(leer).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.signOut).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("falla cerrado: sin poder leer la configuración de Auth (error de red, de HTTP o respuesta rara) tampoco activa nada", async () => {
    const sinRed = vi.fn(async () => {
      throw new Error("sin red");
    });
    for (const intento of [sinRed, respuestaDeAjustes({}, false), respuestaDeAjustes({ mailer_autoconfirm: "false" })]) {
      olvidarLaGuardia();
      vi.stubGlobal("fetch", intento);

      expect(await activarCuenta(ID_SESION, TOKEN_DE_ACCESO)).toEqual({ ok: false, motivo: "sin_confirmacion" });
    }
    expect(admin.auth.admin.signOut).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("la guardia no deja rastro del token de acceso ni del id en el registro", async () => {
    vi.stubGlobal("fetch", respuestaDeAjustes({ mailer_autoconfirm: true }));
    await activarCuenta(ID_SESION, TOKEN_DE_ACCESO);

    expect(errores.length).toBe(1);
    expect(registrado()).not.toContain(TOKEN_DE_ACCESO);
    expect(registrado()).not.toContain(ID_SESION);
  });

  it("si el cierre falla, no crea el Estudiante y dice «sesiones»", async () => {
    admin.auth.admin.signOut.mockResolvedValueOnce({ error: { code: "unexpected_failure", message: "falló" } });

    expect(await activarCuenta(ID_SESION, TOKEN_DE_ACCESO)).toEqual({ ok: false, motivo: "sesiones" });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("agrupa en «soporte» lo que repetir el paso no arregla, y deja «no_confirmada» aparte", async () => {
    for (const [respuesta, motivo] of [
      ["sin_lead", "soporte"],
      ["ya_tiene_cuenta", "soporte"],
      ["correo_distinto", "soporte"],
      ["no_confirmada", "no_confirmada"],
    ] as const) {
      admin.auth.admin.signOut.mockResolvedValueOnce({ error: null });
      admin.rpc.mockResolvedValueOnce({ data: respuesta, error: null });
      expect(await activarCuenta(ID_SESION, TOKEN_DE_ACCESO), respuesta).toEqual({ ok: false, motivo });
    }
  });

  it("un error de la base o una respuesta desconocida es «fallo», nunca un éxito", async () => {
    admin.auth.admin.signOut.mockResolvedValue({ error: null });
    admin.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "falló" } });
    expect(await activarCuenta(ID_SESION, TOKEN_DE_ACCESO)).toEqual({ ok: false, motivo: "fallo" });
    for (const rara of ["ok", "", null, undefined, true]) {
      admin.rpc.mockResolvedValueOnce({ data: rara, error: null });
      expect(await activarCuenta(ID_SESION, TOKEN_DE_ACCESO), String(rara)).toEqual({ ok: false, motivo: "fallo" });
    }
  });

  it("ningún registro contiene el token de acceso", async () => {
    admin.auth.admin.signOut.mockResolvedValueOnce({ error: { code: "bad_jwt", message: TOKEN_DE_ACCESO } });
    await activarCuenta(ID_SESION, TOKEN_DE_ACCESO);
    admin.auth.admin.signOut.mockResolvedValueOnce({ error: null });
    admin.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "falló" } });
    await activarCuenta(ID_SESION, TOKEN_DE_ACCESO);

    expect(errores.length).toBe(2);
    expect(registrado()).not.toContain(TOKEN_DE_ACCESO);
  });
});

describe("leadTieneCuenta y tokenDeAccesoDeLaSesion", () => {
  it("leadTieneCuenta consulta el Estudiante por id_lead con la llave secreta", async () => {
    admin.maybeSingle.mockResolvedValueOnce({ data: { id: ID_SESION }, error: null });
    expect(await leadTieneCuenta("lead-1")).toBe(true);
    admin.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await leadTieneCuenta("lead-1")).toBe(false);

    expect(admin.from).toHaveBeenCalledWith("estudiante");
    expect(admin.eq).toHaveBeenCalledWith("id_lead", "lead-1");
    admin.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error("falló") });
    await expect(leadTieneCuenta("lead-1")).rejects.toThrow("falló");
  });

  it("tokenDeAccesoDeLaSesion devuelve la cadena del token, o null sin sesión", async () => {
    const con = { auth: { getSession: async () => ({ data: { session: { access_token: TOKEN_DE_ACCESO } } }) } } as unknown as SupabaseClient;
    const sin = { auth: { getSession: async () => ({ data: { session: null } }) } } as unknown as SupabaseClient;

    expect(await tokenDeAccesoDeLaSesion(con)).toBe(TOKEN_DE_ACCESO);
    expect(await tokenDeAccesoDeLaSesion(sin)).toBeNull();
  });
});
