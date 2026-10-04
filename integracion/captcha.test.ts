import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearCliente, exigirSupabaseLocal, Fixtures, iniciarSesionConClave, rolDe, TOKEN_CAPTCHA_DE_PRUEBA } from "./utilidades";

// Pruebas de integración de HU-058 (criterio 2) contra el Supabase LOCAL: con el CAPTCHA de Auth encendido
// (`[auth.captcha]` de supabase/config.toml, con la llave secreta de prueba de Turnstile que pone
// scripts/db-iniciar.mjs), toda alta anónima, todo inicio de sesión con contraseña y todo envío del enlace de
// restablecer exigen un token. El Auth local valida el token contra Cloudflare (hace falta internet).
// Un token inválido (no vacío) no se puede probar aquí: la llave de prueba valida cualquier token. Se verifica
// a mano una vez, levantando el stack con la llave de prueba que siempre falla (la que Cloudflare documenta con
// el prefijo 2x) como valor de la variable TURNSTILE_SECRET_KEY, y se anota en el registro de la HU.

let fx: Fixtures;

beforeAll(async () => {
  await exigirSupabaseLocal();
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  await fx.limpiar();
});

/** Cuántos usuarios anónimos hay en Auth: las pruebas de integración corren de a un archivo, así que no cambia solo. */
async function contarAnonimos(): Promise<number> {
  const porPagina = 1000;
  let total = 0;
  for (let pagina = 1; ; pagina += 1) {
    const { data, error } = await fx.admin.auth.admin.listUsers({ page: pagina, perPage: porPagina });
    if (error) throw new Error(`listUsers: ${error.message}`);
    total += data.users.filter((usuario) => usuario.is_anonymous).length;
    if (data.users.length < porPagina) return total;
  }
}

describe("Criterio 2: el inicio de sesión anónimo exige un token de CAPTCHA válido", () => {
  it("sin token, Auth lo rechaza (captcha_failed, 400) y no crea usuario", async () => {
    const antes = await contarAnonimos();

    const { data, error } = await crearCliente().auth.signInAnonymously();

    expect(error?.code).toBe("captcha_failed");
    expect(error?.status).toBe(400);
    expect(data.user).toBeNull();
    expect(data.session).toBeNull();
    expect(await contarAnonimos()).toBe(antes);
  });

  it("con el token en blanco, Auth lo rechaza (captcha_failed, 400) y no crea usuario", async () => {
    const antes = await contarAnonimos();

    const { data, error } = await crearCliente().auth.signInAnonymously({ options: { captchaToken: "" } });

    expect(error?.code).toBe("captcha_failed");
    expect(error?.status).toBe(400);
    expect(data.user).toBeNull();
    expect(data.session).toBeNull();
    expect(await contarAnonimos()).toBe(antes);
  });

  it("con el token de prueba nace un anónimo con sesión", async () => {
    const cliente = crearCliente();

    const { data, error } = await cliente.auth.signInAnonymously({ options: { captchaToken: TOKEN_CAPTCHA_DE_PRUEBA } });
    try {
      expect(error).toBeNull();
      expect(data.user?.is_anonymous).toBe(true);
      expect(data.session?.access_token).toBeTruthy();
      const claims = await cliente.auth.getClaims();
      expect(claims.data?.claims.is_anonymous).toBe(true);
      expect(claims.data?.claims.sub).toBe(data.user?.id);
      const enAuth = await fx.admin.auth.admin.getUserById(data.user!.id);
      expect(enAuth.data.user?.is_anonymous).toBe(true);
    } finally {
      // Este usuario no lo creó `fx`: se borra aquí, aunque la prueba falle a medias.
      if (data.user) await fx.admin.auth.admin.deleteUser(data.user.id);
    }
  });
});

describe("Criterio 2: el inicio de sesión con contraseña exige el token (D-30)", () => {
  it("sin token falla con captcha_failed aunque la contraseña sea la correcta", async () => {
    const usuario = await fx.crearUsuario();

    const { data, error } = await crearCliente().auth.signInWithPassword({ email: usuario.correo, password: usuario.contrasena });

    expect(error?.code).toBe("captcha_failed");
    expect(error?.status).toBe(400);
    expect(data.session).toBeNull();
  });

  it("con el token de prueba entra y la base lo reconoce", async () => {
    const admin = await fx.crearAdmin();

    const cliente = await iniciarSesionConClave(admin.correo, admin.contrasena);

    expect(await rolDe(cliente)).toBe("admin");
    const { data } = await cliente.auth.getUser();
    expect(data.user?.id).toBe(admin.id);
  });

  it("con el token pero con la contraseña equivocada falla por las credenciales, no por el CAPTCHA", async () => {
    const usuario = await fx.crearUsuario();

    const { error } = await crearCliente().auth.signInWithPassword({
      email: usuario.correo,
      password: `${usuario.contrasena}-mala`,
      options: { captchaToken: TOKEN_CAPTCHA_DE_PRUEBA },
    });

    expect(error?.code).toBe("invalid_credentials");
  });
});

describe("Criterio 2: el enlace para restablecer la contraseña exige el token (D-30)", () => {
  it("sin token falla con captcha_failed", async () => {
    const usuario = await fx.crearUsuario();

    const { error } = await crearCliente().auth.resetPasswordForEmail(usuario.correo);

    expect(error?.code).toBe("captcha_failed");
    expect(error?.status).toBe(400);
  });
});

describe("Criterio 2: lo que no pasa por el widget no pide token", () => {
  it("auth.admin.createUser con la llave secreta crea la cuenta sin token", async () => {
    const usuario = await fx.crearUsuario();

    const { data, error } = await fx.admin.auth.admin.getUserById(usuario.id);

    expect(error).toBeNull();
    expect(data.user?.email).toBe(usuario.correo);
  });

  it("refreshSession renueva la sesión sin token", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const antes = await cliente.auth.getSession();
    expect(antes.data.session?.refresh_token).toBeTruthy();

    const { data, error } = await cliente.auth.refreshSession();

    expect(error).toBeNull();
    expect(data.session?.user.id).toBe(id);
    expect(data.session?.access_token).toBeTruthy();
  });
});
