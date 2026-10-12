import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashDeToken } from "@/lib/monitores/invitacion";
import type { Database } from "@/lib/supabase/tipos";
import {
  buscarInvitacionDeAdmin,
  cancelarInvitacionAbierta,
  ESPERA_AL_RELEER_MS,
  invitarAdmin,
  listarInvitaciones,
  PAUSA_AL_RELEER_MS,
  reconstruirInvitacionDeAdmin,
  registrarAdmin,
  TEXTO_CORREO_CON_CUENTA,
  TEXTO_FALLO_AL_REGISTRAR,
  TEXTO_INVITACION_NO_SIRVE,
} from "./invitaciones";

// HU-072 sin base ni Auth: el cliente con la llave secreta, el correo y el sitio, inventados. Aquí se fija el orden de
// lo que hace cada función y lo que no puede hacer; que la base cumpla (candados, un solo uso, permisos) lo cubren
// supabase/tests/invitacion_admin.test.sql y la integración.

type Resultado = { data: unknown; error: unknown };

const h = vi.hoisted(() => {
  const estado = {
    eventos: [] as string[],
    /** Cada `from(tabla)` con los pasos que se encadenaron. */
    consultas: [] as { tabla: string; pasos: [string, unknown[]][] }[],
    /** Qué contesta `maybeSingle`, por `tabla.operacion`. Una lista se va gastando; la última se repite. */
    resultados: {} as Record<string, Resultado | Resultado[]>,
    rpc: vi.fn(),
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    enviar: vi.fn(),
    urlDelSitio: vi.fn(),
  };
  return estado;
});

vi.mock("@/lib/supabase/admin", () => ({
  crearClienteAdmin: () => ({
    from: (tabla: string) => {
      const consulta = { tabla, pasos: [] as [string, unknown[]][] };
      h.consultas.push(consulta);
      const cadena: Record<string, unknown> = {};
      for (const metodo of ["select", "update", "eq", "is", "gt"]) {
        cadena[metodo] = (...argumentos: unknown[]) => {
          consulta.pasos.push([metodo, argumentos]);
          return cadena;
        };
      }
      cadena.maybeSingle = async () => {
        const operacion = consulta.pasos.some(([metodo]) => metodo === "update") ? "update" : "select";
        if (tabla === "admin") h.eventos.push("nombre");
        const respuesta = h.resultados[`${tabla}.${operacion}`] ?? { data: null, error: null };
        if (!Array.isArray(respuesta)) return respuesta;
        return respuesta.length > 1 ? respuesta.shift()! : respuesta[0];
      };
      return cadena;
    },
    rpc: (...argumentos: unknown[]) => h.rpc(...argumentos),
    auth: { admin: { createUser: (...a: unknown[]) => h.createUser(...a), deleteUser: (...a: unknown[]) => h.deleteUser(...a) } },
  }),
}));
vi.mock("@/lib/correo/servidor", () => ({
  enviarCorreoDesdeServidor: (...argumentos: unknown[]) => h.enviar(...argumentos),
  urlDelSitio: (...argumentos: unknown[]) => h.urlDelSitio(...argumentos),
}));

const ID_ADMIN = "a0a0a0a0-0000-4000-8000-000000000072";
const ID_INVITACION = "1a1a1a1a-0000-4000-8000-000000000072";
const ID_USUARIO = "b0b0b0b0-0000-4000-8000-000000000072";
const CORREO = "nuevo@calibra.test";
const VENCE = "2026-10-19T15:00:00.000Z";
const TOKEN = "ab".repeat(32);

const CREADA = { data: [{ resultado: "creada", id_invitacion: ID_INVITACION, vencimiento: VENCE }], error: null };
const consultasDe = (tabla: string) => h.consultas.filter((c) => c.tabla === tabla);
const paso = (consulta: { pasos: [string, unknown[]][] }, metodo: string) => consulta.pasos.filter(([m]) => m === metodo).map(([, a]) => a);
/** Las llamadas a `rpc` con ese nombre. */
const llamadasA = (nombre: string) => h.rpc.mock.calls.filter(([llamada]) => llamada === nombre);
/** `rpc` contesta según el nombre de la función; lo que no se nombra responde sin datos y sin error. */
const responderRpc = (respuestas: Record<string, Resultado>) =>
  h.rpc.mockReset().mockImplementation(async (nombre: string) => respuestas[nombre] ?? { data: null, error: null });

beforeEach(() => {
  h.eventos = [];
  h.consultas = [];
  h.resultados = { "admin.select": { data: { nombre: "Admin Uno" }, error: null } };
  h.rpc.mockReset().mockImplementation(async () => {
    h.eventos.push("rpc");
    return CREADA;
  });
  h.createUser.mockReset().mockImplementation(async () => ({ data: { user: { id: ID_USUARIO } }, error: null }));
  h.deleteUser.mockReset().mockImplementation(async () => ({ error: null }));
  h.enviar.mockReset().mockImplementation(async () => {
    h.eventos.push("enviar");
    return { ok: true, yaEnviado: false, intentos: 1, idProveedor: "p-1" };
  });
  h.urlDelSitio.mockReset().mockImplementation((ruta: string) => {
    h.eventos.push("enlace");
    return `https://calibra.test${ruta}`;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("invitarAdmin (HU-072, criterios 1 a 4 y 14)", () => {
  it("lee el nombre y arma el enlace ANTES de crear la invitación, y manda el correo después", async () => {
    expect(await invitarAdmin(ID_ADMIN, CORREO)).toEqual({ ok: true, correoEnviado: true });
    expect(h.eventos).toEqual(["nombre", "enlace", "rpc", "enviar"]);
  });

  it("si el enlace no se puede armar (SITIO_URL ausente) no llama a la base ni manda nada", async () => {
    h.urlDelSitio.mockImplementation(() => {
      throw new Error("Falta SITIO_URL");
    });
    await expect(invitarAdmin(ID_ADMIN, CORREO)).rejects.toThrow("Falta SITIO_URL");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("pasa a la base el hash del token, el correo y el id de quien invita; el token no sale de la llamada", async () => {
    await invitarAdmin(ID_ADMIN, CORREO);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("crear_invitacion_admin", {
      p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_correo: CORREO,
      p_id_admin: ID_ADMIN,
    });
    const { p_token_hash: hash } = h.rpc.mock.calls[0][1] as { p_token_hash: string };
    const enlace = (h.enviar.mock.calls[0][0] as { datos: { enlace: string } }).datos.enlace;
    const token = /token=([0-9a-f]{64})$/.exec(enlace)![1];
    expect(token).not.toBe(hash);
    expect(hashDeToken(token)).toBe(hash);
  });

  it("manda la plantilla de la invitación con la entidad igual al id, el vencimiento y el nombre de quien invita", async () => {
    await invitarAdmin(ID_ADMIN, CORREO);
    expect(h.enviar).toHaveBeenCalledExactlyOnceWith({
      plantilla: "invitacion_admin",
      datos: { enlace: expect.stringMatching(/^https:\/\/calibra\.test\/admins\/registro\?token=[0-9a-f]{64}$/), venceEn: VENCE, invitadoPor: "Admin Uno" },
      destinatario: CORREO,
      entidad: ID_INVITACION,
    });
  });

  it("lee el nombre de quien invita con el id de la sesión", async () => {
    await invitarAdmin(ID_ADMIN, CORREO);
    const [lectura] = consultasDe("admin");
    expect(paso(lectura, "eq")).toEqual([["id", ID_ADMIN]]);
  });

  it.each([
    ["vacío", ""],
    ["de solo espacios", "  \n "],
    ["nulo", null],
  ])("con un nombre %s manda «Un admin de Calibra» en vez de lanzar después de crear la invitación", async (_caso, nombre) => {
    h.resultados["admin.select"] = { data: { nombre }, error: null };
    expect(await invitarAdmin(ID_ADMIN, CORREO)).toEqual({ ok: true, correoEnviado: true });
    expect((h.enviar.mock.calls[0][0] as { datos: { invitadoPor: string } }).datos.invitadoPor).toBe("Un admin de Calibra");
  });

  it("deja el nombre de quien invita en una sola línea", async () => {
    h.resultados["admin.select"] = { data: { nombre: "Ana\r\n  Pérez" }, error: null };
    await invitarAdmin(ID_ADMIN, CORREO);
    expect((h.enviar.mock.calls[0][0] as { datos: { invitadoPor: string } }).datos.invitadoPor).toBe("Ana Pérez");
  });

  it("si quien invita no es un admin, responde sin_permiso sin crear nada ni mandar nada", async () => {
    h.resultados["admin.select"] = { data: null, error: null };
    expect(await invitarAdmin(ID_ADMIN, CORREO)).toEqual({ ok: false, motivo: "sin_permiso" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it.each(["es_admin", "es_admin_desactivado", "es_monitor", "sin_permiso"] as const)(
    "con %s de la base devuelve el motivo y no manda ningún correo",
    async (resultado) => {
      h.rpc.mockResolvedValue({ data: [{ resultado, id_invitacion: null, vencimiento: null }], error: null });
      expect(await invitarAdmin(ID_ADMIN, CORREO)).toEqual({ ok: false, motivo: resultado });
      expect(h.enviar).not.toHaveBeenCalled();
    },
  );

  it("si el correo no sale, la invitación queda creada y lo dice; en el registro va el id, no el correo", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    h.enviar.mockResolvedValue({ ok: false, motivo: "sin_proveedor", error: "sin proveedor", intentos: 0 });
    expect(await invitarAdmin(ID_ADMIN, CORREO)).toEqual({ ok: true, correoEnviado: false });
    expect(registro).toHaveBeenCalledTimes(1);
    const texto = String(registro.mock.calls[0]);
    expect(texto).toContain(ID_INVITACION);
    expect(texto).toContain("sin_proveedor");
    expect(texto).not.toContain(CORREO);
  });

  it("un error de la base lanza con el código y el mensaje, nunca con el valor repetido que PostgREST pone en details", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint", details: "Key (correo)=(tercero@calibra.test) already exists.", hint: null },
    });
    const error = await invitarAdmin(ID_ADMIN, CORREO).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("23505");
    expect((error as Error).message).not.toContain("tercero@calibra.test");
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it.each([
    ["sin filas", { data: [], error: null }],
    ["sin datos", { data: null, error: null }],
    ["con un resultado que no existe", { data: [{ resultado: "otra_cosa", id_invitacion: null, vencimiento: null }], error: null }],
  ])("una respuesta inesperada de la base (%s) lanza", async (_caso, respuesta) => {
    h.rpc.mockResolvedValue(respuesta);
    await expect(invitarAdmin(ID_ADMIN, CORREO)).rejects.toThrow("Respuesta inesperada");
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("si no puede leer el nombre, lanza antes de crear la invitación", async () => {
    h.resultados["admin.select"] = { data: null, error: { code: "XX000", message: "caída" } };
    await expect(invitarAdmin(ID_ADMIN, CORREO)).rejects.toThrow("caída");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("buscarInvitacionDeAdmin (criterio 5)", () => {
  const AHORA = new Date("2026-10-12T15:00:00.000Z");
  const fila = (cambios: Record<string, unknown> = {}) => ({
    data: { correo: CORREO, vence_en: VENCE, usada_en: null, cancelada_en: null, id_admin: ID_ADMIN, ...cambios },
    error: null,
  });

  beforeEach(() => {
    // Quien invitó sigue activo, salvo que la prueba diga lo contrario.
    responderRpc({ invitador_activo: { data: true, error: null } });
  });

  it.each([undefined, null, "", "abc", "AB".repeat(32), "ab".repeat(31), `${TOKEN}0`, ["x"], 7, { token: TOKEN }])(
    "un valor sin forma de token (%j) no consulta la base",
    async (token) => {
      expect(await buscarInvitacionDeAdmin(token, AHORA)).toEqual({ vigente: false });
      expect(h.consultas).toHaveLength(0);
    },
  );

  it("una invitación sin usar, sin cancelar y sin vencer es vigente, y se busca por el hash del token", async () => {
    h.resultados["invitacion_admin.select"] = fila();
    expect(await buscarInvitacionDeAdmin(TOKEN, AHORA)).toEqual({ vigente: true, correo: CORREO, venceEn: VENCE });
    const [consulta] = consultasDe("invitacion_admin");
    expect(paso(consulta, "eq")).toEqual([["token_hash", hashDeToken(TOKEN)]]);
    expect(paso(consulta, "select")).toEqual([["correo, vence_en, usada_en, cancelada_en, id_admin"]]);
  });

  it.each([
    ["usada", { usada_en: "2026-10-12T14:00:00.000Z" }],
    ["cancelada", { cancelada_en: "2026-10-12T14:00:00.000Z" }],
    ["vencida", { vence_en: "2026-10-12T14:59:59.000Z" }],
    ["que vence justo ahora", { vence_en: AHORA.toISOString() }],
  ])("una invitación %s no es vigente, y ni siquiera pregunta por quien invitó", async (_caso, cambios) => {
    h.resultados["invitacion_admin.select"] = fila(cambios);
    expect(await buscarInvitacionDeAdmin(TOKEN, AHORA)).toEqual({ vigente: false });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  describe("quien invitó tiene que seguir activo (una cuenta de admin comprometida y desactivada no deja invitaciones vivas)", () => {
    it("pregunta a la base por el admin que hizo la invitación, con su id, y si está activo la invitación es vigente", async () => {
      h.resultados["invitacion_admin.select"] = fila();
      expect(await buscarInvitacionDeAdmin(TOKEN, AHORA)).toEqual({ vigente: true, correo: CORREO, venceEn: VENCE });
      expect(h.rpc).toHaveBeenCalledExactlyOnceWith("invitador_activo", { p_id_admin: ID_ADMIN });
    });

    it("si quien invitó ya no está activo, la invitación no es vigente aunque no esté usada, cancelada ni vencida", async () => {
      h.resultados["invitacion_admin.select"] = fila();
      responderRpc({ invitador_activo: { data: false, error: null } });
      expect(await buscarInvitacionDeAdmin(TOKEN, AHORA)).toEqual({ vigente: false });
    });

    it.each([null, undefined, "true", 1, [true]])("solo un true de la base cuenta como activo (%j no)", async (data) => {
      h.resultados["invitacion_admin.select"] = fila();
      responderRpc({ invitador_activo: { data, error: null } });
      expect(await buscarInvitacionDeAdmin(TOKEN, AHORA)).toEqual({ vigente: false });
    });

    it("si no se puede comprobar, lanza: no se dice que el enlace sirve ni que no sirve sin haberlo mirado", async () => {
      h.resultados["invitacion_admin.select"] = fila();
      responderRpc({ invitador_activo: { data: null, error: { code: "XX000", message: "caída de la función" } } });
      await expect(buscarInvitacionDeAdmin(TOKEN, AHORA)).rejects.toThrow("caída de la función");
    });
  });

  it("un token que no existe no es vigente", async () => {
    h.resultados["invitacion_admin.select"] = { data: null, error: null };
    expect(await buscarInvitacionDeAdmin(TOKEN, AHORA)).toEqual({ vigente: false });
  });

  it("si la base falla, lanza (no se dice que el enlace no sirve cuando no se pudo mirar)", async () => {
    h.resultados["invitacion_admin.select"] = { data: null, error: { code: "XX000", message: "caída" } };
    await expect(buscarInvitacionDeAdmin(TOKEN, AHORA)).rejects.toThrow("caída");
  });
});

describe("registrarAdmin (criterios 7 a 9)", () => {
  const DATOS = { nombre: "Ana Pérez", contrasena: "12345678" };
  const VIGENTE = { data: { correo: CORREO, vence_en: "2999-01-01T00:00:00.000Z", usada_en: null, cancelada_en: null, id_admin: ID_ADMIN }, error: null };
  const GASTADA = { data: { correo: CORREO, vence_en: "2999-01-01T00:00:00.000Z", usada_en: "2026-10-12T14:00:00.000Z", cancelada_en: null, id_admin: ID_ADMIN }, error: null };
  const EMAIL_EXISTS = { data: { user: null }, error: { code: "email_exists", message: "ya existe" } };
  /** Quien invitó sigue activo y la base gasta la invitación, salvo que la prueba diga otra cosa. */
  const BASE_BIEN = { invitador_activo: { data: true, error: null }, registrar_admin: { data: true, error: null } };

  beforeEach(() => {
    h.resultados["invitacion_admin.select"] = VIGENTE;
    responderRpc(BASE_BIEN);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("con una invitación vigente crea el usuario con el correo de la invitación, da de alta al admin y devuelve el correo", async () => {
    expect(await registrarAdmin(TOKEN, DATOS)).toEqual({ ok: true, correo: CORREO });
    expect(h.createUser).toHaveBeenCalledExactlyOnceWith({ email: CORREO, password: "12345678", email_confirm: true });
    expect(llamadasA("registrar_admin")).toEqual([
      [
        "registrar_admin",
        { p_token_hash: hashDeToken(TOKEN), p_id_usuario: ID_USUARIO, p_correo: CORREO, p_nombre: "Ana Pérez" },
      ],
    ]);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "inventado", "AB".repeat(32)])("con el token %j no crea ningún usuario", async (token) => {
    expect(await registrarAdmin(token, DATOS)).toEqual({ ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE });
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("con una invitación usada no crea ningún usuario", async () => {
    h.resultados["invitacion_admin.select"] = GASTADA;
    expect(await registrarAdmin(TOKEN, DATOS)).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("con una invitación de un admin que ya se desactivó no crea ningún usuario ni da de alta a nadie", async () => {
    responderRpc({ ...BASE_BIEN, invitador_activo: { data: false, error: null } });
    expect(await registrarAdmin(TOKEN, DATOS)).toEqual({ ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE });
    expect(llamadasA("invitador_activo")).toEqual([["invitador_activo", { p_id_admin: ID_ADMIN }]]);
    expect(h.createUser).not.toHaveBeenCalled();
    expect(llamadasA("registrar_admin")).toHaveLength(0);
  });

  it("si quien invitó se desactiva justo después de la lectura, la base lo rechaza (false) y se borra el usuario recién creado", async () => {
    responderRpc({ ...BASE_BIEN, registrar_admin: { data: false, error: null } });
    expect(await registrarAdmin(TOKEN, DATOS)).toEqual({ ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE });
    expect(h.createUser).toHaveBeenCalledTimes(1);
    expect(h.deleteUser).toHaveBeenCalledExactlyOnceWith(ID_USUARIO);
  });

  describe("el correo ya tiene cuenta en Auth (email_exists)", () => {
    const registrarYEsperar = async (milisegundos: number) => {
      const resultado = registrarAdmin(TOKEN, DATOS);
      await vi.advanceTimersByTimeAsync(milisegundos);
      return resultado;
    };

    beforeEach(() => {
      vi.useFakeTimers();
      h.createUser.mockResolvedValue(EMAIL_EXISTS);
    });

    it("la espera es de 250 ms entre lecturas, hasta 2 s", () => {
      expect(PAUSA_AL_RELEER_MS).toBe(250);
      expect(ESPERA_AL_RELEER_MS).toBe(2_000);
    });

    it("si otro registro de la misma invitación ya la gastó, lo ve a la primera y dice que el enlace ya no sirve, sin esperar", async () => {
      h.resultados["invitacion_admin.select"] = [VIGENTE, GASTADA];
      expect(await registrarYEsperar(0)).toEqual({ ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE });
      expect(consultasDe("invitacion_admin")).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
      expect(llamadasA("registrar_admin")).toHaveLength(0);
      expect(h.deleteUser).not.toHaveBeenCalled();
    });

    it("si el ganador todavía no la gasta, espera y vuelve a leer cada 250 ms hasta verla gastada (el perdedor no se queda con «ya hay una cuenta»)", async () => {
      // Lecturas: la de antes de crear el usuario y tres después de que Auth lo rechaza.
      h.resultados["invitacion_admin.select"] = [VIGENTE, VIGENTE, VIGENTE, GASTADA];
      let terminado = false;
      const resultado = registrarAdmin(TOKEN, DATOS).then((r) => {
        terminado = true;
        return r;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(consultasDe("invitacion_admin")).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(PAUSA_AL_RELEER_MS - 1);
      expect(consultasDe("invitacion_admin")).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(consultasDe("invitacion_admin")).toHaveLength(3);
      expect(terminado).toBe(false);
      await vi.advanceTimersByTimeAsync(PAUSA_AL_RELEER_MS);

      expect(await resultado).toEqual({ ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE });
      expect(consultasDe("invitacion_admin")).toHaveLength(4);
      expect(llamadasA("registrar_admin")).toHaveLength(0);
      expect(h.createUser).toHaveBeenCalledTimes(1);
    });

    it("si el admin que hizo la invitación se desactiva mientras espera, también deja de servir", async () => {
      h.resultados["invitacion_admin.select"] = [VIGENTE, VIGENTE];
      let activo = true;
      h.rpc.mockImplementation(async (nombre: string) => (nombre === "invitador_activo" ? { data: activo, error: null } : { data: true, error: null }));
      const resultado = registrarAdmin(TOKEN, DATOS);
      await vi.advanceTimersByTimeAsync(PAUSA_AL_RELEER_MS);
      activo = false;
      await vi.advanceTimersByTimeAsync(PAUSA_AL_RELEER_MS);
      expect(await resultado).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    });

    it("si nadie la gasta en 2 s, el correo es de una cuenta que ya existía: lo dice, tras 8 esperas y 10 lecturas, sin gastar ni borrar nada", async () => {
      let terminado = false;
      const resultado = registrarAdmin(TOKEN, DATOS).then((r) => {
        terminado = true;
        return r;
      });

      await vi.advanceTimersByTimeAsync(ESPERA_AL_RELEER_MS - 1);
      expect(terminado).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(await resultado).toEqual({ ok: false, motivo: "correo_con_cuenta", error: TEXTO_CORREO_CON_CUENTA });
      // La de antes de crear el usuario, la inmediata después de que Auth lo rechaza y una por cada espera.
      expect(consultasDe("invitacion_admin")).toHaveLength(2 + ESPERA_AL_RELEER_MS / PAUSA_AL_RELEER_MS);
      expect(llamadasA("registrar_admin")).toHaveLength(0);
      expect(h.deleteUser).not.toHaveBeenCalled();
    });

    it("el perdedor ve «ya no sirve» aunque el ganador la gaste justo en la última lectura", async () => {
      const lecturas = 2 + ESPERA_AL_RELEER_MS / PAUSA_AL_RELEER_MS;
      h.resultados["invitacion_admin.select"] = [...Array.from({ length: lecturas - 1 }, () => VIGENTE), GASTADA];
      expect(await registrarYEsperar(ESPERA_AL_RELEER_MS)).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    });
  });

  // Lo que Auth local contesta de verdad al segundo de dos createUser simultáneos con el mismo correo (se comprobó con tres
  // createUser a la vez): AuthRetryableFetchError, 500, «Database error creating new user» y sin código. No es email_exists.
  describe("Auth contesta un 500 (así responde al segundo de dos registros que chocan en su índice de correos)", () => {
    const ERROR_500 = { name: "AuthRetryableFetchError", status: 500, message: "Database error creating new user" };

    beforeEach(() => {
      vi.useFakeTimers();
      h.createUser.mockResolvedValue({ data: { user: null }, error: ERROR_500 });
    });

    it("espera a que el ganador gaste la invitación y el perdedor ve que el enlace ya no sirve, no un fallo genérico", async () => {
      h.resultados["invitacion_admin.select"] = [VIGENTE, VIGENTE, VIGENTE, GASTADA];
      const resultado = registrarAdmin(TOKEN, DATOS);
      await vi.advanceTimersByTimeAsync(2 * PAUSA_AL_RELEER_MS);
      expect(await resultado).toEqual({ ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE });
      expect(consultasDe("invitacion_admin")).toHaveLength(4);
      expect(llamadasA("registrar_admin")).toHaveLength(0);
      expect(h.deleteUser).not.toHaveBeenCalled();
    });

    it("si pasan 2 s y la invitación sigue vigente, es un fallo («Intenta de nuevo»), no «ya hay una cuenta»; deja el mensaje en el registro, sin el correo", async () => {
      const registro = vi.spyOn(console, "error").mockImplementation(() => {});
      const resultado = registrarAdmin(TOKEN, DATOS);
      await vi.advanceTimersByTimeAsync(ESPERA_AL_RELEER_MS);
      expect(await resultado).toEqual({ ok: false, motivo: "fallo", error: TEXTO_FALLO_AL_REGISTRAR });
      expect(consultasDe("invitacion_admin")).toHaveLength(2 + ESPERA_AL_RELEER_MS / PAUSA_AL_RELEER_MS);
      expect(registro).toHaveBeenCalledTimes(1);
      expect(String(registro.mock.calls[0])).toContain("Database error creating new user");
      expect(String(registro.mock.calls[0])).not.toContain(CORREO);
      expect(llamadasA("registrar_admin")).toHaveLength(0);
    });

    it.each([502, 503])("un %i también es del servidor: espera", async (status) => {
      h.createUser.mockResolvedValue({ data: { user: null }, error: { ...ERROR_500, status } });
      h.resultados["invitacion_admin.select"] = [VIGENTE, VIGENTE, GASTADA];
      const resultado = registrarAdmin(TOKEN, DATOS);
      await vi.advanceTimersByTimeAsync(PAUSA_AL_RELEER_MS);
      expect(await resultado).toMatchObject({ ok: false, motivo: "invitacion_no_sirve" });
    });

    it.each([
      ["un 400", { name: "AuthApiError", status: 400, code: "weak_password", message: "contraseña débil" }],
      ["un 422 sin código", { name: "AuthApiError", status: 422, message: "no procesable" }],
      ["un 429", { name: "AuthApiError", status: 429, code: "over_request_rate_limit", message: "muchas" }],
      ["un fallo de red (estado 0)", { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" }],
      ["un error sin estado", { name: "AuthUnknownError", message: "raro" }],
    ])("%s no es un posible choque: es un fallo inmediato, sin esperar ni volver a leer", async (_caso, error) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      h.createUser.mockResolvedValue({ data: { user: null }, error });
      expect(await registrarAdmin(TOKEN, DATOS)).toEqual({ ok: false, motivo: "fallo", error: TEXTO_FALLO_AL_REGISTRAR });
      expect(consultasDe("invitacion_admin")).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("otro error de Auth es un fallo inmediato, deja el código en el registro (no el correo) y no llama a la base ni espera", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    h.createUser.mockResolvedValue({ data: { user: null }, error: { code: "unexpected_failure", message: `no se pudo con ${CORREO}` } });
    expect(await registrarAdmin(TOKEN, DATOS)).toEqual({ ok: false, motivo: "fallo", error: TEXTO_FALLO_AL_REGISTRAR });
    expect(String(registro.mock.calls[0])).toContain("unexpected_failure");
    expect(llamadasA("registrar_admin")).toHaveLength(0);
    expect(consultasDe("invitacion_admin")).toHaveLength(1);
  });

  it("si la base falla después de crear el usuario, lo borra y es un fallo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    responderRpc({ ...BASE_BIEN, registrar_admin: { data: null, error: { code: "22023", message: "El nombre no puede estar vacío" } } });
    expect(await registrarAdmin(TOKEN, DATOS)).toEqual({ ok: false, motivo: "fallo", error: TEXTO_FALLO_AL_REGISTRAR });
    expect(h.deleteUser).toHaveBeenCalledExactlyOnceWith(ID_USUARIO);
  });

  it("si la base dice que la invitación ya no sirve (false), borra el usuario recién creado", async () => {
    responderRpc({ ...BASE_BIEN, registrar_admin: { data: false, error: null } });
    expect(await registrarAdmin(TOKEN, DATOS)).toEqual({ ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE });
    expect(h.deleteUser).toHaveBeenCalledExactlyOnceWith(ID_USUARIO);
  });

  it("si ni siquiera se puede borrar el usuario, deja su id en el registro para borrarlo a mano", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    responderRpc({ ...BASE_BIEN, registrar_admin: { data: false, error: null } });
    h.deleteUser.mockResolvedValue({ error: { message: "caída" } });
    await registrarAdmin(TOKEN, DATOS);
    expect(registro).toHaveBeenCalledTimes(1);
    expect(String(registro.mock.calls[0])).toContain(ID_USUARIO);
    expect(String(registro.mock.calls[0])).not.toContain(CORREO);
  });
});

describe("reconstruirInvitacionDeAdmin (criterio 16, HU-065)", () => {
  const AHORA = new Date("2026-10-12T15:00:00.000Z");
  const ABIERTA = { data: { correo: CORREO, vence_en: VENCE, id_admin: ID_ADMIN }, error: null };

  beforeEach(() => {
    h.resultados["invitacion_admin.update"] = ABIERTA;
  });

  it.each(["", "no-es-un-id", "1234", `${ID_INVITACION}0`])("con %j, que no es un uuid, devuelve null sin tocar la base", async (id) => {
    expect(await reconstruirInvitacionDeAdmin(id, AHORA)).toBeNull();
    expect(h.consultas).toHaveLength(0);
  });

  it("reemplaza el hash solo si la invitación sigue abierta y vigente", async () => {
    await reconstruirInvitacionDeAdmin(ID_INVITACION, AHORA);
    const [actualiza] = consultasDe("invitacion_admin");
    expect(paso(actualiza, "eq")).toEqual([["id", ID_INVITACION]]);
    expect(paso(actualiza, "is")).toEqual([
      ["usada_en", null],
      ["cancelada_en", null],
    ]);
    expect(paso(actualiza, "gt")).toEqual([["vence_en", AHORA.toISOString()]]);
    expect(paso(actualiza, "update")).toEqual([[{ token_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }]]);
  });

  it("pide el correo, el vencimiento y quien invitó, sin un embebido (la tabla tiene dos llaves hacia admin)", async () => {
    await reconstruirInvitacionDeAdmin(ID_INVITACION, AHORA);
    const [actualiza] = consultasDe("invitacion_admin");
    expect(paso(actualiza, "select")).toEqual([["correo, vence_en, id_admin"]]);
    expect(String(paso(actualiza, "select")[0][0])).not.toMatch(/[()!]/);
    // El nombre es una segunda consulta, a admin.
    const [nombre] = consultasDe("admin");
    expect(paso(nombre, "eq")).toEqual([["id", ID_ADMIN]]);
  });

  it("devuelve el destinatario y los datos con un enlace nuevo cuyo hash es el que se guardó", async () => {
    const reconstruccion = await reconstruirInvitacionDeAdmin(ID_INVITACION, AHORA);
    expect(reconstruccion).toEqual({
      destinatario: CORREO,
      datos: { enlace: expect.stringMatching(/^https:\/\/calibra\.test\/admins\/registro\?token=[0-9a-f]{64}$/), venceEn: VENCE, invitadoPor: "Admin Uno" },
    });
    const guardado = (paso(consultasDe("invitacion_admin")[0], "update")[0][0] as { token_hash: string }).token_hash;
    const token = /token=([0-9a-f]{64})$/.exec(reconstruccion!.datos.enlace)![1];
    expect(hashDeToken(token)).toBe(guardado);
  });

  it("cada reconstrucción trae un token distinto", async () => {
    const a = await reconstruirInvitacionDeAdmin(ID_INVITACION, AHORA);
    const b = await reconstruirInvitacionDeAdmin(ID_INVITACION, AHORA);
    expect(a!.datos.enlace).not.toBe(b!.datos.enlace);
  });

  it("sin fila (usada, vencida, cancelada o borrada) devuelve null y no lee ningún nombre", async () => {
    h.resultados["invitacion_admin.update"] = { data: null, error: null };
    expect(await reconstruirInvitacionDeAdmin(ID_INVITACION, AHORA)).toBeNull();
    expect(consultasDe("admin")).toHaveLength(0);
  });

  it("con el nombre vacío manda «Un admin de Calibra»", async () => {
    h.resultados["admin.select"] = { data: { nombre: " " }, error: null };
    expect((await reconstruirInvitacionDeAdmin(ID_INVITACION, AHORA))!.datos.invitadoPor).toBe("Un admin de Calibra");
  });

  it("si la base falla, lanza: el reintento lo vuelve a intentar después", async () => {
    h.resultados["invitacion_admin.update"] = { data: null, error: { code: "XX000", message: "caída" } };
    await expect(reconstruirInvitacionDeAdmin(ID_INVITACION, AHORA)).rejects.toThrow("caída");
  });
});

describe("la lista y la cancelación con la sesión del admin", () => {
  const cliente = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient<Database>;
  const FILA = {
    id: ID_INVITACION,
    correo: CORREO,
    invitada_por: "Admin Uno",
    invito_activo: false,
    creada_en: "2026-10-12T10:00:00.000Z",
    vence_en: VENCE,
  };

  it("listarInvitaciones llama a invitaciones_de_admin y devuelve las filas con fechas", async () => {
    const rpc = vi.fn(async () => ({ data: [FILA], error: null }));
    expect(await listarInvitaciones(cliente(rpc))).toEqual([
      {
        id: ID_INVITACION,
        correo: CORREO,
        invitadaPor: "Admin Uno",
        invitoActivo: false,
        creadaEn: new Date("2026-10-12T10:00:00.000Z"),
        venceEn: new Date(VENCE),
      },
    ]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("invitaciones_de_admin");
  });

  it("no saca ningún campo del hash ni del token", async () => {
    const rpc = vi.fn(async () => ({ data: [{ ...FILA, token_hash: "f".repeat(64) }], error: null }));
    expect(JSON.stringify(await listarInvitaciones(cliente(rpc)))).not.toMatch(/token|f{64}/);
  });

  it("sin filas, o sin datos, devuelve una lista vacía; con error, lanza", async () => {
    expect(await listarInvitaciones(cliente(vi.fn(async () => ({ data: [], error: null }))))).toEqual([]);
    expect(await listarInvitaciones(cliente(vi.fn(async () => ({ data: null, error: null }))))).toEqual([]);
    await expect(listarInvitaciones(cliente(vi.fn(async () => ({ data: null, error: { code: "42501", message: "sin permiso" } }))))).rejects.toThrow("sin permiso");
  });

  it.each(["cancelada", "no_abierta", "no_encontrada", "sin_permiso"])("cancelarInvitacionAbierta devuelve %s", async (resultado) => {
    const rpc = vi.fn(async () => ({ data: resultado, error: null }));
    expect(await cancelarInvitacionAbierta(cliente(rpc), ID_INVITACION)).toBe(resultado);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cancelar_invitacion_admin", { p_id: ID_INVITACION });
  });

  it.each(["otra_cosa", "", null, 3])("rechaza una respuesta desconocida (%j)", async (data) => {
    await expect(cancelarInvitacionAbierta(cliente(vi.fn(async () => ({ data, error: null }))), ID_INVITACION)).rejects.toThrow("Respuesta inesperada");
  });

  it("un error de la base lanza", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "42501", message: "sin permiso" } }));
    await expect(cancelarInvitacionAbierta(cliente(rpc), ID_INVITACION)).rejects.toThrow("sin permiso");
  });
});
