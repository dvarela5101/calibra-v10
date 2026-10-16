import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ponerContrasena, vincularCorreo } from "@/lib/auth/convertir";
import { desactivarCuenta, reactivarCuenta } from "@/lib/auth/cuentas";
import { crearCliente, exigirSupabaseLocal, Fixtures, idsVisibles, rolDe, TOKEN_CAPTCHA_DE_PRUEBA } from "./utilidades";

// Pruebas de integración de HU-004 contra el Supabase LOCAL (Auth, REST y base reales).
// Cada prueba crea sus propios usuarios y los borra al final.
//
// HU-032: el Auth local confirma el correo antes de dar por válido un cambio de correo (`enable_confirmations = true`),
// así que convertir al anónimo en cuenta son dos pasos: ligar el correo (Auth manda un correo y el usuario sigue anónimo)
// y confirmarlo con el `token_hash` del correo. El mismo id, las mismas filas visibles.

let fx: Fixtures;
let mailpit: string;

beforeAll(async () => {
  await exigirSupabaseLocal();
  mailpit = process.env.MAILPIT_URL ?? "";
  if (!mailpit) throw new Error("Falta MAILPIT_URL: corre npm run db:env.");
});

/** El `token_hash` del correo de confirmación que Auth mandó a ese destinatario (espera hasta 15 s) y borra el buzón. */
async function tokenHashDelCorreo(destinatario: string): Promise<string> {
  const consulta = `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${destinatario}"`)}`;
  const limite = Date.now() + 15_000;
  try {
    for (;;) {
      const { messages } = (await (await fetch(consulta)).json()) as { messages?: { ID: string }[] };
      if (messages?.length) {
        const { HTML } = (await (await fetch(`${mailpit}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string };
        const enlace = /href="([^"]*\/cuenta\/confirmar\?[^"]*)"/.exec(HTML)?.[1];
        const token = enlace ? new URL(enlace.replaceAll("&amp;", "&")).searchParams.get("token_hash") : null;
        if (!token) throw new Error(`El correo no trae el enlace de confirmación: ${HTML}`);
        return token;
      }
      if (Date.now() > limite) throw new Error(`No llegó el correo de confirmación a ${destinatario}.`);
      await new Promise((listo) => setTimeout(listo, 250));
    }
  } finally {
    await fetch(consulta, { method: "DELETE" }).catch(() => undefined);
  }
}

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  await fx.limpiar();
});

describe("Criterio 2: el anónimo se vuelve cuenta sin cambiar de id", () => {
  it("conserva el mismo id y sus diagnósticos al pasar de anónimo a cuenta con contraseña", async () => {
    const { cliente: anonimo, id } = await fx.crearAnonimo();
    const antes = await anonimo.auth.getClaims();
    expect(antes.data?.claims.is_anonymous).toBe(true);

    const { materia, evaluacion } = await fx.crearEvaluacion();
    const diagnostico = await fx.crearDiagnostico({ idSesionAnonima: id, idEvaluacion: evaluacion.id, idMateria: materia.id });
    expect(await idsVisibles(anonimo, "diagnostico", "id", diagnostico.id)).toEqual([diagnostico.id]);

    const correo = `prueba-${crypto.randomUUID()}@calibra.test`;
    const contrasena = `Clave-${crypto.randomUUID()}`;
    // Paso 1: ligar el correo. Auth manda el enlace y el usuario sigue siendo el mismo anónimo hasta confirmarlo.
    expect(await vincularCorreo(anonimo, correo)).toEqual({ ok: true });
    const pendiente = await anonimo.auth.getUser();
    expect(pendiente.data.user?.id).toBe(id);
    expect(pendiente.data.user?.is_anonymous).toBe(true);
    expect(await rolDe(anonimo)).toBe("anonimo");

    // Paso 2: confirmar el correo con el token del correo (otro cliente: otro dispositivo). Después, la contraseña.
    const cuenta = crearCliente();
    const confirmacion = await cuenta.auth.verifyOtp({ type: "email_change", token_hash: await tokenHashDelCorreo(correo) });
    expect(confirmacion.error).toBeNull();
    expect(await ponerContrasena(cuenta, contrasena)).toEqual({ ok: true });
    // El token vigente todavía puede decir lo anterior; con la sesión nueva ya no.
    expect((await cuenta.auth.refreshSession()).error).toBeNull();

    // Mismo usuario de Auth, ya no anónimo, y el token refrescado lo dice.
    const { data: usuario, error } = await cuenta.auth.getUser();
    expect(error).toBeNull();
    expect(usuario.user?.id).toBe(id);
    expect(usuario.user?.is_anonymous).toBe(false);
    expect(usuario.user?.email).toBe(correo);
    const despues = await cuenta.auth.getClaims();
    expect(despues.data?.claims.sub).toBe(id);
    expect(despues.data?.claims.is_anonymous).toBe(false);

    // Sin migrar nada: el diagnóstico sigue siendo suyo por RLS.
    expect(await idsVisibles(cuenta, "diagnostico", "id", diagnostico.id)).toEqual([diagnostico.id]);
    // Y ya no cuenta como anónimo para las políticas de rol.
    expect(await rolDe(cuenta)).not.toBe("anonimo");

    // Un cliente nuevo entra con ese correo y contraseña y ve lo mismo.
    const nuevo = crearCliente();
    const inicio = await nuevo.auth.signInWithPassword({
      email: correo,
      password: contrasena,
      options: { captchaToken: TOKEN_CAPTCHA_DE_PRUEBA },
    });
    expect(inicio.error).toBeNull();
    expect(inicio.data.user?.id).toBe(id);
    expect(inicio.data.user?.is_anonymous).toBe(false);
    expect(await idsVisibles(nuevo, "diagnostico", "id", diagnostico.id)).toEqual([diagnostico.id]);
  });

  it("rechaza convertir con un correo que ya existe y deja la sesión anónima intacta", async () => {
    const existente = await fx.crearUsuario();
    const { cliente: anonimo, id } = await fx.crearAnonimo();

    const resultado = await vincularCorreo(anonimo, existente.correo);
    expect(resultado).toEqual({ ok: false, codigo: "email_exists" });

    const { data } = await anonimo.auth.getUser();
    expect(data.user?.id).toBe(id);
    expect(data.user?.is_anonymous).toBe(true);
  });
});

describe("Criterio 4 (RN-23): un admin desactivado no entra y sus registros se conservan", () => {
  /** Admin con sesión abierta, un monitor, un certificado que el admin emitió y un lead que el admin puede leer. */
  async function prepararAdmin() {
    const admin = await fx.crearAdmin();
    const monitor = await fx.crearMonitor();
    const { materia } = await fx.crearEvaluacion();
    const certificado = await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
    const lead = await fx.crearLead();
    const sesion = await fx.iniciarSesion(admin);

    // Antes de desactivar: es admin y lee por RLS lo que solo un admin lee.
    expect(await rolDe(sesion)).toBe("admin");
    expect(await idsVisibles(sesion, "lead", "id", lead.id)).toEqual([lead.id]);
    expect(await idsVisibles(sesion, "admin", "id", admin.id)).toEqual([admin.id]);

    return { admin, certificado, lead, sesion };
  }

  it("no puede iniciar sesión (user_banned) y al reactivarlo vuelve a entrar", async () => {
    const { admin } = await prepararAdmin();

    await desactivarCuenta(admin.id);

    // Con el token, para que el rechazo sea el del usuario baneado y no `captcha_failed` (HU-058).
    const bloqueado = await crearCliente().auth.signInWithPassword({
      email: admin.correo,
      password: admin.contrasena,
      options: { captchaToken: TOKEN_CAPTCHA_DE_PRUEBA },
    });
    expect(bloqueado.error?.code).toBe("user_banned");
    expect(bloqueado.data.session).toBeNull();

    await reactivarCuenta(admin.id);

    const sesion = await fx.iniciarSesion(admin);
    expect(await rolDe(sesion)).toBe("admin");
  });

  it("con su token viejo deja de ser admin para la base y no puede refrescar la sesión", async () => {
    const { admin, lead, sesion } = await prepararAdmin();

    await desactivarCuenta(admin.id);

    // El token sigue vigente, pero es_admin() ya no lo reconoce.
    expect(await rolDe(sesion)).not.toBe("admin");
    expect(await idsVisibles(sesion, "admin", "id", admin.id)).toEqual([]);
    const todasLasFilas = await sesion.from("admin").select("id");
    expect(todasLasFilas.error).toBeNull();
    expect(todasLasFilas.data).toEqual([]);
    expect(await idsVisibles(sesion, "lead", "id", lead.id)).toEqual([]);

    // Y no puede renovar el token.
    const refresco = await sesion.auth.refreshSession();
    expect(refresco.error?.code).toBe("user_banned");

    // Reactivar le devuelve el rol con la misma sesión, sin volver a iniciar.
    await reactivarCuenta(admin.id);
    expect(await rolDe(sesion)).toBe("admin");
  });

  it("conserva la fila admin y los certificados que emitió", async () => {
    const { admin, certificado } = await prepararAdmin();

    await desactivarCuenta(admin.id);

    const filaAdmin = await fx.admin.from("admin").select("id, correo").eq("id", admin.id);
    expect(filaAdmin.error).toBeNull();
    expect(filaAdmin.data).toEqual([{ id: admin.id, correo: admin.correo }]);

    const filaCertificado = await fx.admin.from("certificado").select("id, id_admin").eq("id", certificado.id);
    expect(filaCertificado.error).toBeNull();
    expect(filaCertificado.data).toEqual([{ id: certificado.id, id_admin: admin.id }]);

    // El usuario de Auth tampoco se borra: solo queda baneado.
    const { data } = await fx.admin.auth.admin.getUserById(admin.id);
    expect(data.user?.id).toBe(admin.id);
    expect(data.user?.banned_until).toBeTruthy();
  });
});

describe("Criterio 6: las políticas dependen del rol de la sesión real", () => {
  it("mi_rol() devuelve admin, monitor, estudiante y anonimo según la sesión", async () => {
    const admin = await fx.crearAdmin();
    const monitor = await fx.crearMonitor();
    const estudiante = await fx.crearEstudiante();
    const { cliente: anonimo } = await fx.crearAnonimo();

    expect(await rolDe(await fx.iniciarSesion(admin))).toBe("admin");
    expect(await rolDe(await fx.iniciarSesion(monitor))).toBe("monitor");
    expect(await rolDe(await fx.iniciarSesion(estudiante))).toBe("estudiante");
    expect(await rolDe(anonimo)).toBe("anonimo");
  });

  it("sin sesión no se puede consultar mi_rol()", async () => {
    const { error } = await crearCliente().rpc("mi_rol");
    expect(error).not.toBeNull();
  });

  it("monitor_privado: el anónimo no ve nada, el monitor y el admin ven la fila", async () => {
    const monitor = await fx.crearMonitor({ conContacto: true });
    const admin = await fx.crearAdmin();
    const { cliente: anonimo } = await fx.crearAnonimo();

    expect(await idsVisibles(anonimo, "monitor_privado", "id_monitor", monitor.id)).toEqual([]);
    const todas = await anonimo.from("monitor_privado").select("id_monitor");
    expect(todas.error).toBeNull();
    expect(todas.data).toEqual([]);

    const sesionMonitor = await fx.iniciarSesion(monitor);
    expect(await idsVisibles(sesionMonitor, "monitor_privado", "id_monitor", monitor.id)).toEqual([monitor.id]);

    const sesionAdmin = await fx.iniciarSesion(admin);
    expect(await idsVisibles(sesionAdmin, "monitor_privado", "id_monitor", monitor.id)).toEqual([monitor.id]);

    // Lo público del monitor (su nombre) sí lo ve cualquiera, incluido el anónimo.
    expect(await idsVisibles(anonimo, "monitor", "id", monitor.id)).toEqual([monitor.id]);
  });

  it("un anónimo no ve los diagnósticos de otra sesión anónima", async () => {
    const { id: idDueno } = await fx.crearAnonimo();
    const { cliente: otro } = await fx.crearAnonimo();
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const diagnostico = await fx.crearDiagnostico({ idSesionAnonima: idDueno, idEvaluacion: evaluacion.id, idMateria: materia.id });

    expect(await idsVisibles(otro, "diagnostico", "id", diagnostico.id)).toEqual([]);
  });
});
