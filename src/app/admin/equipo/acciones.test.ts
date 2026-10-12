import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelarInvitacion, invitar, reactivar } from "./acciones";

/** Lo que la consola mostraría de esos argumentos, con las propiedades de un error (details, hint) incluidas. */
const textoDelRegistro = (argumentos: unknown[]) => argumentos.map((a) => inspect(a, { depth: 5 })).join(" ");

// HU-072 sin navegador ni base: las tres acciones nuevas con la sesión, el servidor y la puerta inventados. Aquí se
// fija que la guarda es lo primero, que un formulario inválido no toca la base, a dónde vuelve cada desenlace y que
// ninguna dirección lleva el correo. Que la base cumpla lo cubren supabase/tests/invitacion_admin.test.sql y la
// integración.

const ID_ADMIN = "a0a0a0a0-0000-4000-8000-000000000072";
const ID_AJENO = "a1a1a1a1-0000-4000-8000-000000000072";
const ID_INVITACION = "1a1a1a1a-0000-4000-8000-000000000072";
const ID_OBJETIVO = "0b0b0b0b-0000-4000-8000-000000000072";
const CORREO = "secreto@calibra.test";

const h = vi.hoisted(() => {
  class Redireccion extends Error {
    constructor(readonly destino: string) {
      super(`redirect:${destino}`);
    }
  }
  return {
    Redireccion,
    cliente: { soy: "el cliente de la sesión" } as object | null,
    exigirRol: vi.fn(),
    crearClienteServidor: vi.fn(),
    crearClienteAdmin: vi.fn(),
    invitarAdmin: vi.fn(),
    cancelarInvitacionAbierta: vi.fn(),
    reactivarAdmin: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: h.crearClienteServidor }));
// La llave secreta: si alguna acción la usara por su cuenta, la prueba lo vería.
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: h.crearClienteAdmin }));
vi.mock("@/lib/admin/invitaciones", () => ({ invitarAdmin: h.invitarAdmin, cancelarInvitacionAbierta: h.cancelarInvitacionAbierta }));
vi.mock("@/lib/admin/equipo", () => ({ reactivarAdmin: h.reactivarAdmin, desactivarAdmin: vi.fn(), moverAdmin: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));

const formulario = (campos: Record<string, string | Blob>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

const INVITACION_VALIDA = { correo: CORREO, correo_repetido: CORREO, entiendo: "si" };

type Accion = (datos: FormData) => Promise<void>;

/** A dónde redirigió la acción (siempre redirige). */
async function destinoDe(accion: Accion, campos: Record<string, string | Blob>): Promise<string> {
  try {
    await accion(formulario(campos));
  } catch (error) {
    if (error instanceof h.Redireccion) return error.destino;
    throw error;
  }
  throw new Error("La acción no redirigió.");
}

beforeEach(() => {
  h.cliente = { soy: "el cliente de la sesión" };
  h.exigirRol.mockReset().mockResolvedValue({ idUsuario: ID_ADMIN, rol: "admin" });
  h.crearClienteServidor.mockReset().mockImplementation(async () => h.cliente);
  h.crearClienteAdmin.mockReset().mockImplementation(() => {
    throw new Error("Las acciones del equipo no usan la llave secreta.");
  });
  h.invitarAdmin.mockReset().mockResolvedValue({ ok: true, correoEnviado: true });
  h.cancelarInvitacionAbierta.mockReset().mockResolvedValue("cancelada");
  h.reactivarAdmin.mockReset().mockResolvedValue({ ok: true, nombre: "Ana Pérez" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TRES: [string, Accion, Record<string, string>][] = [
  ["invitar", invitar, INVITACION_VALIDA],
  ["cancelarInvitacion", cancelarInvitacion, { invitacion: ID_INVITACION }],
  ["reactivar", reactivar, { admin: ID_OBJETIVO }],
];

describe("las tres acciones: la guarda va primero (criterio 14)", () => {
  it.each(TRES)("%s exige un admin con la ruta de la pantalla y, si la guarda rechaza, no toca nada", async (_nombre, accion, campos) => {
    h.exigirRol.mockRejectedValue(new Error("redirect:/ingresar"));
    await expect(accion(formulario(campos))).rejects.toThrow("redirect:/ingresar");
    expect(h.exigirRol).toHaveBeenCalledExactlyOnceWith("admin", "/admin/equipo");
    expect(h.crearClienteServidor).not.toHaveBeenCalled();
    expect(h.crearClienteAdmin).not.toHaveBeenCalled();
    expect(h.invitarAdmin).not.toHaveBeenCalled();
    expect(h.cancelarInvitacionAbierta).not.toHaveBeenCalled();
    expect(h.reactivarAdmin).not.toHaveBeenCalled();
  });

  it.each(TRES)("%s pide la guarda ANTES de leer el formulario", async (_nombre, accion) => {
    h.exigirRol.mockRejectedValue(new Error("redirect:/ingresar"));
    // Un formulario que haría fallar la lectura si se tocara antes: ni siquiera es un FormData.
    await expect(accion(null as unknown as FormData)).rejects.toThrow("redirect:/ingresar");
  });
});

describe("invitar (criterios 1 a 3)", () => {
  it("con el formulario bien, invita con el id de la sesión y vuelve con el aviso de éxito", async () => {
    expect(await destinoDe(invitar, INVITACION_VALIDA)).toBe("/admin/equipo?invitada=1");
    expect(h.invitarAdmin).toHaveBeenCalledExactlyOnceWith(ID_ADMIN, CORREO);
  });

  it("el id de quien invita sale de la sesión aunque el formulario traiga otro", async () => {
    await destinoDe(invitar, { ...INVITACION_VALIDA, admin: ID_AJENO, id_admin: ID_AJENO, idAdmin: ID_AJENO });
    expect(h.invitarAdmin).toHaveBeenCalledExactlyOnceWith(ID_ADMIN, CORREO);
  });

  it("normaliza el correo (mayúsculas y espacios) antes de pasarlo", async () => {
    await destinoDe(invitar, { correo: "  Secreto@Calibra.TEST ", correo_repetido: "secreto@calibra.test", entiendo: "si" });
    expect(h.invitarAdmin).toHaveBeenCalledExactlyOnceWith(ID_ADMIN, CORREO);
  });

  it("si el correo no salió, la invitación quedó creada y vuelve con ?invitada=sin_correo", async () => {
    h.invitarAdmin.mockResolvedValue({ ok: true, correoEnviado: false });
    expect(await destinoDe(invitar, INVITACION_VALIDA)).toBe("/admin/equipo?invitada=sin_correo");
  });

  it.each([
    ["correo inválido", { ...INVITACION_VALIDA, correo: "no-es-un-correo" }, "correo_invalido"],
    ["correos distintos", { ...INVITACION_VALIDA, correo_repetido: "otro@calibra.test" }, "correos_distintos"],
    ["sin la casilla", { correo: CORREO, correo_repetido: CORREO }, "sin_aviso"],
    ["los dos errores", { correo: CORREO, correo_repetido: "otro@calibra.test" }, "correos_distintos_y_sin_aviso"],
  ])("con %s vuelve con la clave del error SIN tocar la base ni la llave secreta", async (_caso, campos, clave) => {
    expect(await destinoDe(invitar, campos)).toBe(`/admin/equipo?error=${clave}`);
    expect(h.invitarAdmin).not.toHaveBeenCalled();
    expect(h.crearClienteServidor).not.toHaveBeenCalled();
    expect(h.crearClienteAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ["es_admin", "es_admin"],
    ["es_admin_desactivado", "es_admin_desactivado"],
    ["es_monitor", "es_monitor"],
    // «Subir» y «Bajar» ya tienen un `sin_permiso` con otro texto: el de invitar lleva su propia clave.
    ["sin_permiso", "sin_permiso_invitar"],
  ])("si la base rechaza con %s vuelve con ?error=%s", async (motivo, clave) => {
    h.invitarAdmin.mockResolvedValue({ ok: false, motivo });
    expect(await destinoDe(invitar, INVITACION_VALIDA)).toBe(`/admin/equipo?error=${clave}`);
  });

  it("si algo lanza, vuelve con ?error=fallo_invitar y deja en el registro el mensaje, no el correo ni details", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    h.invitarAdmin.mockRejectedValue(Object.assign(new Error("No se pudo crear la invitación: 23505 duplicate key"), { details: `Key (correo)=(${CORREO})`, hint: "x" }));
    expect(await destinoDe(invitar, INVITACION_VALIDA)).toBe("/admin/equipo?error=fallo_invitar");
    expect(registro).toHaveBeenCalledTimes(1);
    expect(textoDelRegistro(registro.mock.calls[0])).toContain("23505");
    expect(textoDelRegistro(registro.mock.calls[0])).not.toContain(CORREO);
  });

  it("una excepción que no es un Error también vuelve con ?error=fallo_invitar, sin volcar el objeto al registro", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    h.invitarAdmin.mockRejectedValue({ code: "23505", details: `Key (correo)=(${CORREO})` });
    expect(await destinoDe(invitar, INVITACION_VALIDA)).toBe("/admin/equipo?error=fallo_invitar");
    expect(textoDelRegistro(registro.mock.calls[0])).not.toContain(CORREO);
  });

  it("ninguna dirección lleva el correo, ni el de éxito, ni el de error, ni el del fallo", async () => {
    const destinos = [
      await destinoDe(invitar, INVITACION_VALIDA),
      await destinoDe(invitar, { ...INVITACION_VALIDA, correo_repetido: "otro@calibra.test" }),
      await destinoDe(invitar, { correo: CORREO, correo_repetido: CORREO }),
    ];
    h.invitarAdmin.mockResolvedValue({ ok: true, correoEnviado: false });
    destinos.push(await destinoDe(invitar, INVITACION_VALIDA));
    h.invitarAdmin.mockResolvedValue({ ok: false, motivo: "es_admin" });
    destinos.push(await destinoDe(invitar, INVITACION_VALIDA));
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.invitarAdmin.mockRejectedValue(new Error("caída"));
    destinos.push(await destinoDe(invitar, INVITACION_VALIDA));
    for (const destino of destinos) {
      expect(destino, destino).not.toMatch(/secreto|calibra\.test|@|%40/i);
    }
  });
});

describe("cancelarInvitacion (criterio 12)", () => {
  it("cancela con el cliente de la sesión, nunca con la llave secreta, y vuelve con ?cancelada=1", async () => {
    expect(await destinoDe(cancelarInvitacion, { invitacion: ID_INVITACION })).toBe("/admin/equipo?cancelada=1");
    expect(h.cancelarInvitacionAbierta).toHaveBeenCalledExactlyOnceWith(h.cliente, ID_INVITACION);
    expect(h.crearClienteAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ["no_abierta", "no_abierta"],
    ["no_encontrada", "no_encontrada"],
    ["sin_permiso", "sin_permiso_cancelar"],
  ])("si la base responde %s vuelve con ?error=%s", async (resultado, clave) => {
    h.cancelarInvitacionAbierta.mockResolvedValue(resultado);
    expect(await destinoDe(cancelarInvitacion, { invitacion: ID_INVITACION })).toBe(`/admin/equipo?error=${clave}`);
  });

  it.each([
    ["sin el campo", {}],
    ["con algo que no es un uuid", { invitacion: "no-es-un-id" }],
    ["con un archivo en vez del id", { invitacion: new Blob(["x"]) }],
    ["con un uuid con algo pegado", { invitacion: `${ID_INVITACION}'; drop table x;--` }],
  ] as const)("%s dice que no la encontró, sin llamar a la base", async (_caso, campos) => {
    expect(await destinoDe(cancelarInvitacion, campos)).toBe("/admin/equipo?error=no_encontrada");
    expect(h.cancelarInvitacionAbierta).not.toHaveBeenCalled();
    expect(h.crearClienteServidor).not.toHaveBeenCalled();
  });

  it("si la base falla, o falta la conexión, vuelve con ?error=fallo y lo deja en el registro", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    h.cancelarInvitacionAbierta.mockRejectedValue(new Error("No se pudo cancelar la invitación: caída"));
    expect(await destinoDe(cancelarInvitacion, { invitacion: ID_INVITACION })).toBe("/admin/equipo?error=fallo");
    h.cliente = null;
    expect(await destinoDe(cancelarInvitacion, { invitacion: ID_INVITACION })).toBe("/admin/equipo?error=fallo");
    expect(registro).toHaveBeenCalledTimes(2);
  });
});

describe("reactivar (criterio 13, D-64 a)", () => {
  it("reactiva con el cliente de la sesión y vuelve con el id de la persona", async () => {
    expect(await destinoDe(reactivar, { admin: ID_OBJETIVO })).toBe(`/admin/equipo?reactivado=${ID_OBJETIVO}`);
    expect(h.reactivarAdmin).toHaveBeenCalledExactlyOnceWith(h.cliente, ID_OBJETIVO);
    expect(h.crearClienteAdmin).not.toHaveBeenCalled();
  });

  it("el nombre no viaja en la dirección: la página lo saca del equipo que carga con la sesión", async () => {
    h.reactivarAdmin.mockResolvedValue({ ok: true, nombre: "A&B? C <script>" });
    const destino = await destinoDe(reactivar, { admin: ID_OBJETIVO });
    expect(destino).not.toContain("A&B");
    expect(destino).not.toContain("script");
    expect([...new URL(destino, "https://calibra.test").searchParams.entries()]).toEqual([["reactivado", ID_OBJETIVO]]);
  });

  it.each(["ya_activo", "no_encontrado"])("si no se puede reactivar (%s) vuelve con ese motivo", async (motivo) => {
    h.reactivarAdmin.mockResolvedValue({ ok: false, motivo });
    expect(await destinoDe(reactivar, { admin: ID_OBJETIVO })).toBe(`/admin/equipo?error=${motivo}`);
  });

  it.each([
    ["sin el campo", {}],
    ["con algo que no es un uuid", { admin: "no-es-un-id" }],
    ["con un archivo en vez del id", { admin: new Blob(["x"]) }],
  ] as const)("%s dice que no lo encontró, sin llamar a la base", async (_caso, campos) => {
    expect(await destinoDe(reactivar, campos)).toBe("/admin/equipo?error=no_encontrado");
    expect(h.reactivarAdmin).not.toHaveBeenCalled();
    expect(h.crearClienteServidor).not.toHaveBeenCalled();
  });

  it("si Auth o la base fallan, o falta la conexión, vuelve con ?error=fallo", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    h.reactivarAdmin.mockRejectedValue(new Error("Auth caído"));
    expect(await destinoDe(reactivar, { admin: ID_OBJETIVO })).toBe("/admin/equipo?error=fallo");
    h.cliente = null;
    expect(await destinoDe(reactivar, { admin: ID_OBJETIVO })).toBe("/admin/equipo?error=fallo");
    expect(registro).toHaveBeenCalledTimes(2);
  });
});
