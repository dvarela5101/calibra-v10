import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAMBIOS_DEL_REEMBOLSO, ERRORES_DE_FECHA, MENSAJE_DE_FALLO, MENSAJES_DE_REGISTRO } from "@/lib/admin/reembolsos-reglas";
import { REENVIOS_PARA_LA_BANDEJA, RESULTADOS_DE_REENVIAR } from "@/lib/reembolsos/reglas";
import { registrar, reenviar, type EstadoRegistro } from "./acciones";

// HU-026 sin navegador ni base: las acciones con la sesión y las puertas inventadas. Aquí se fija a dónde vuelven con
// cada resultado, que un error no vacía el formulario y que nada llega a la base sin un admin. La base de verdad la
// cubren supabase/tests/gestionar_reembolsos.test.sql y la integración.

const ID = "70000000-0000-4000-8000-000000000026";
const RUTA = `/admin/reembolsos/${ID}`;
/** 9:00 en Bogotá del 10 de enero de 2030. */
const AHORA = new Date("2030-01-10T14:00:00.000Z");

const h = vi.hoisted(() => {
  class Redireccion extends Error {
    constructor(readonly destino: string) {
      super(`redirect:${destino}`);
    }
  }
  return {
    Redireccion,
    cliente: { soy: "el cliente de la sesión" } as object | null,
    exigirRol: vi.fn<(rol: string, ruta: string) => Promise<{ idUsuario: string; rol: string }>>(async () => ({
      idUsuario: "a0a0a0a0-0000-4000-8000-000000000026",
      rol: "admin",
    })),
    ejecutarReembolso: vi.fn(),
    reenviarPedidoDeLlave: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/admin/reembolsos", () => ({ ejecutarReembolso: h.ejecutarReembolso }));
vi.mock("@/lib/reembolsos/servidor", () => ({ reenviarPedidoDeLlave: h.reenviarPedidoDeLlave }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));

const INICIAL: EstadoRegistro = { error: null, valores: { referencia: "", fecha: "2030-01-10" } };

const formulario = (campos: Record<string, string | Blob>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

/** Lo que hizo registrar: a dónde redirigió o qué estado devolvió. */
async function enviar(campos: Record<string, string>): Promise<{ destino: string } | { estado: EstadoRegistro }> {
  try {
    return { estado: await registrar(INICIAL, formulario(campos)) };
  } catch (error) {
    if (error instanceof h.Redireccion) return { destino: error.destino };
    throw error;
  }
}

/** A dónde redirigió reenviar (siempre redirige). */
async function destinoDeReenviar(campos: Record<string, string | Blob>): Promise<string> {
  try {
    await reenviar(formulario(campos));
  } catch (error) {
    if (error instanceof h.Redireccion) return error.destino;
    throw error;
  }
  throw new Error("La acción no redirigió.");
}

const REGISTRAR = { id_reembolso: ID, referencia: " REF-26-1 ", fecha: "2030-01-09", fecha_minima: "2030-01-06" };
const ESCRITO = { referencia: REGISTRAR.referencia, fecha: REGISTRAR.fecha };

beforeEach(() => {
  vi.useFakeTimers({ now: AHORA, toFake: ["Date"] });
  h.cliente = { soy: "el cliente de la sesión" };
  h.exigirRol.mockClear();
  h.ejecutarReembolso.mockReset();
  h.reenviarPedidoDeLlave.mockReset();
  h.revalidatePath.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("registrar (HU-026, criterio 2): lo que se registró", () => {
  it("vuelve al reembolso con el éxito y refresca la bandeja; quién registra lo pone la sesión", async () => {
    h.ejecutarReembolso.mockResolvedValue("reembolsado");
    expect(await enviar(REGISTRAR)).toEqual({ destino: `${RUTA}?registrado=reembolsado` });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", RUTA);
    expect(h.ejecutarReembolso).toHaveBeenCalledExactlyOnceWith(h.cliente, { idReembolso: ID, referencia: "REF-26-1", fecha: "2030-01-09" });
    // Primero la sesión, después la base.
    expect(h.exigirRol.mock.invocationCallOrder[0]).toBeLessThan(h.ejecutarReembolso.mock.invocationCallOrder[0]);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
  });
});

describe("registrar: lo que no se registró", () => {
  it.each(CAMBIOS_DEL_REEMBOLSO)("%s cambió mientras el admin miraba: vuelve al reembolso, que se pinta como está ahora", async (resultado) => {
    h.ejecutarReembolso.mockResolvedValue(resultado);
    expect(await enviar(REGISTRAR)).toEqual({ destino: `${RUTA}?error=${resultado}` });
    expect(h.revalidatePath.mock.calls).toEqual([["/admin"]]);
  });

  it.each(["fecha_invalida", "referencia_invalida", "no_encontrado", "sin_permiso", "sin_sesion"] as const)(
    "%s se dice en el formulario, con lo escrito",
    async (resultado) => {
      h.ejecutarReembolso.mockResolvedValue(resultado);
      expect(await enviar(REGISTRAR)).toEqual({ estado: { error: MENSAJES_DE_REGISTRO[resultado], valores: ESCRITO } });
      expect(h.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("si la base falla, pide intentar de nuevo sin perder lo escrito, y al registro no va la referencia", async () => {
    h.ejecutarReembolso.mockRejectedValue(new Error("No se pudo registrar el reembolso: 500 caída"));
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar(REGISTRAR)).toEqual({ estado: { error: MENSAJE_DE_FALLO, valores: ESCRITO } });
    expect(registro).toHaveBeenCalledOnce();
    expect(JSON.stringify(registro.mock.calls)).not.toContain("REF-26-1");
  });

  it("sin conexión a la base también es una falla, sin perder lo escrito", async () => {
    h.cliente = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar(REGISTRAR)).toEqual({ estado: { error: MENSAJE_DE_FALLO, valores: ESCRITO } });
    expect(h.ejecutarReembolso).not.toHaveBeenCalled();
  });

  it("un formulario inválido no llega a la base", async () => {
    expect(await enviar({ ...REGISTRAR, id_reembolso: "otro" })).toEqual({ estado: { error: MENSAJES_DE_REGISTRO.no_encontrado, valores: ESCRITO } });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", "/admin");
    expect(await enviar({ ...REGISTRAR, referencia: "a".repeat(101) })).toEqual({
      estado: { error: MENSAJES_DE_REGISTRO.referencia_invalida, valores: { ...ESCRITO, referencia: "a".repeat(101) } },
    });
    expect(await enviar({ ...REGISTRAR, fecha: "2030-01-05" })).toEqual({
      estado: { error: ERRORES_DE_FECHA.antesDeCrearse, valores: { ...ESCRITO, fecha: "2030-01-05" } },
    });
    expect(h.ejecutarReembolso).not.toHaveBeenCalled();
  });

  it("la fecha se compara con el día de Bogotá, no con el del servidor: a las 11 p. m. del 10, el 11 es futuro", async () => {
    // 04:00 UTC del 11 de enero = 11:00 p. m. del 10 en Bogotá.
    vi.setSystemTime(new Date("2030-01-11T04:00:00.000Z"));
    expect(await enviar({ ...REGISTRAR, fecha: "2030-01-11" })).toEqual({
      estado: { error: ERRORES_DE_FECHA.futura, valores: { ...ESCRITO, fecha: "2030-01-11" } },
    });
    expect(h.ejecutarReembolso).not.toHaveBeenCalled();
    h.ejecutarReembolso.mockResolvedValue("reembolsado");
    expect(await enviar({ ...REGISTRAR, fecha: "2030-01-10" })).toEqual({ destino: `${RUTA}?registrado=reembolsado` });
  });

  it("se protege sola: sin admin, exigirRol redirige antes de registrar nada", async () => {
    h.exigirRol.mockRejectedValueOnce(new h.Redireccion("/ingresar"));
    expect(await enviar(REGISTRAR)).toEqual({ destino: "/ingresar" });
    expect(h.ejecutarReembolso).not.toHaveBeenCalled();
  });
});

describe("reenviar (HU-026, criterio 3)", () => {
  it.each(RESULTADOS_DE_REENVIAR.filter((r) => !(REENVIOS_PARA_LA_BANDEJA as readonly string[]).includes(r)))(
    "con %s vuelve al reembolso diciendo qué pasó",
    async (resultado) => {
      h.reenviarPedidoDeLlave.mockResolvedValue(resultado);
      expect(await destinoDeReenviar({ id_reembolso: ID })).toBe(`${RUTA}?reenvio=${resultado}`);
      // Con la sesión del admin, no con la llave secreta.
      expect(h.reenviarPedidoDeLlave).toHaveBeenCalledExactlyOnceWith(h.cliente, ID);
      expect(h.exigirRol).toHaveBeenCalledWith("admin", RUTA);
    },
  );

  it.each(REENVIOS_PARA_LA_BANDEJA)("con %s vuelve a la bandeja diciendo qué pasó: la página del reembolso no podría (404, o no lo deja entrar)", async (resultado) => {
    h.reenviarPedidoDeLlave.mockResolvedValue(resultado);
    expect(await destinoDeReenviar({ id_reembolso: ID })).toBe(`/admin?reenvio=${resultado}`);
    expect(h.reenviarPedidoDeLlave).toHaveBeenCalledExactlyOnceWith(h.cliente, ID);
  });

  it("acepta el id en mayúsculas o con espacios", async () => {
    h.reenviarPedidoDeLlave.mockResolvedValue("reenviado");
    expect(await destinoDeReenviar({ id_reembolso: `  ${ID.toUpperCase()} ` })).toBe(`${RUTA}?reenvio=reenviado`);
    expect(h.reenviarPedidoDeLlave).toHaveBeenCalledExactlyOnceWith(h.cliente, ID);
  });

  it.each([
    ["sin el campo", {}],
    ["con un id que no es un uuid", { id_reembolso: "no-es-un-id" }],
    ["con un archivo en vez del id", { id_reembolso: new Blob(["x"]) }],
  ] as const)("%s vuelve a la bandeja sin llamar a la base", async (_caso, campos) => {
    expect(await destinoDeReenviar(campos)).toBe("/admin");
    expect(h.exigirRol).toHaveBeenCalledWith("admin", "/admin");
    expect(h.reenviarPedidoDeLlave).not.toHaveBeenCalled();
  });

  it("exige la sesión de un admin antes de nada", async () => {
    h.exigirRol.mockRejectedValueOnce(new h.Redireccion("/ingresar"));
    expect(await destinoDeReenviar({ id_reembolso: ID })).toBe("/ingresar");
    expect(h.reenviarPedidoDeLlave).not.toHaveBeenCalled();
  });

  it("si la base falla, o falta la conexión, vuelve con la falla y la deja en el registro", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    h.reenviarPedidoDeLlave.mockRejectedValue(new Error("No se pudo reenviar el enlace: caída"));
    expect(await destinoDeReenviar({ id_reembolso: ID })).toBe(`${RUTA}?reenvio=fallo`);
    h.cliente = null;
    expect(await destinoDeReenviar({ id_reembolso: ID })).toBe(`${RUTA}?reenvio=fallo`);
    expect(registro).toHaveBeenCalledTimes(2);
  });
});
