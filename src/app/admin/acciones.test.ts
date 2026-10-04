import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESULTADOS_DE_REABRIR } from "@/lib/reembolsos/reglas";
import { reabrir } from "./acciones";

// HU-025 sin navegador ni base: la acción de reabrir con la sesión y la puerta inventadas. Aquí se fija a dónde vuelve
// con cada resultado. Si el caso está cerrado y quién puede reabrirlo lo decide la base: lo cubren
// supabase/tests/llave_reembolso.test.sql y la integración.

const ID = "0000000e-0000-4000-8000-000000000025";

const h = vi.hoisted(() => {
  class Redireccion extends Error {
    constructor(readonly destino: string) {
      super(`redirect:${destino}`);
    }
  }
  return {
    Redireccion,
    cliente: { soy: "el cliente de la sesión" } as object | null,
    exigirRol: vi.fn(async () => ({ idUsuario: "a0a0a0a0-0000-4000-8000-000000000025", rol: "admin" })),
    reabrirReembolso: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/reembolsos/servidor", () => ({ reabrirReembolso: h.reabrirReembolso }));
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

/** A dónde redirigió la acción (siempre redirige). */
async function destinoDe(campos: Record<string, string | Blob>): Promise<string> {
  try {
    await reabrir(formulario(campos));
  } catch (error) {
    if (error instanceof h.Redireccion) return error.destino;
    throw error;
  }
  throw new Error("La acción no redirigió.");
}

beforeEach(() => {
  h.cliente = { soy: "el cliente de la sesión" };
  h.exigirRol.mockClear();
  h.reabrirReembolso.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reabrir (HU-025, supuesto 4)", () => {
  it.each(RESULTADOS_DE_REABRIR)("con %s vuelve a la bandeja diciendo qué pasó", async (resultado) => {
    h.reabrirReembolso.mockResolvedValue(resultado);
    expect(await destinoDe({ reembolso: ID })).toBe(`/admin?reembolso=${resultado}`);
    // Con la sesión del admin, no con la llave secreta.
    expect(h.reabrirReembolso).toHaveBeenCalledExactlyOnceWith(h.cliente, ID);
  });

  it("exige la sesión de un admin antes de nada", async () => {
    h.exigirRol.mockRejectedValueOnce(new Error("redirect:/entrar"));
    await expect(reabrir(formulario({ reembolso: ID }))).rejects.toThrow("redirect:/entrar");
    expect(h.exigirRol).toHaveBeenCalledWith("admin", "/admin");
    expect(h.reabrirReembolso).not.toHaveBeenCalled();
  });

  it("acepta el id en mayúsculas o con espacios", async () => {
    h.reabrirReembolso.mockResolvedValue("reabierto");
    await destinoDe({ reembolso: `  ${ID.toUpperCase()} ` });
    expect(h.reabrirReembolso).toHaveBeenCalledExactlyOnceWith(h.cliente, ID);
  });

  it.each([
    ["sin el campo", {}],
    ["con un id que no es un uuid", { reembolso: "no-es-un-id" }],
    ["con un archivo en vez del id", { reembolso: new Blob(["x"]) }],
  ] as const)("%s responde que no lo encontró, sin llamar a la base", async (_caso, campos) => {
    expect(await destinoDe(campos)).toBe("/admin?reembolso=no_encontrado");
    expect(h.reabrirReembolso).not.toHaveBeenCalled();
  });

  it("si la base falla, o falta la conexión, vuelve con la falla y la deja en el registro", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    h.reabrirReembolso.mockRejectedValue(new Error("No se pudo reabrir el reembolso: caída"));
    expect(await destinoDe({ reembolso: ID })).toBe("/admin?reembolso=fallo");
    h.cliente = null;
    expect(await destinoDe({ reembolso: ID })).toBe("/admin?reembolso=fallo");
    expect(registro).toHaveBeenCalledTimes(2);
  });
});
