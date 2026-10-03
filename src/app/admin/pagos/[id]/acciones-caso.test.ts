import { beforeEach, describe, expect, it, vi } from "vitest";
import { MENSAJE_DE_FALLO, MENSAJES_DEL_CIERRE } from "@/lib/admin/casos-p24-reglas";
import { cerrarCaso, type EstadoCierre } from "./acciones-caso";

// HU-078 sin navegador ni base: la acción de cerrar un caso P-24 con la sesión y la base inventadas. Aquí se fija a
// dónde vuelve con cada resultado, que se protege sola, que un formulario inválido no llega a la base y que un error no
// pierde lo escrito. La base de verdad la cubre la integración.

const ID = "6a6a6a6a-0000-4000-8000-000000000078";
const RUTA = `/admin/pagos/${ID}`;

const h = vi.hoisted(() => {
  class Redireccion extends Error {
    constructor(readonly destino: string) {
      super(`redirect:${destino}`);
    }
  }
  return {
    Redireccion,
    cliente: { soy: "el cliente de la sesión" },
    exigirRol: vi.fn<(rol: string, ruta: string) => Promise<{ idUsuario: string; rol: string }>>(async () => ({
      idUsuario: "a0a0a0a0-0000-4000-8000-000000000078",
      rol: "admin",
    })),
    cerrar: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/admin/casos-p24", () => ({ cerrarCasoP24: h.cerrar }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));

const INICIAL: EstadoCierre = { error: null, valores: { cierre: "", nota: "" } };

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

/** Lo que hizo la acción: a dónde redirigió o qué estado devolvió. */
async function enviar(campos: Record<string, string>): Promise<{ destino: string } | { estado: EstadoCierre }> {
  try {
    return { estado: await cerrarCaso(INICIAL, formulario(campos)) };
  } catch (error) {
    if (error instanceof h.Redireccion) return { destino: error.destino };
    throw error;
  }
}

const COBRADO = { id_pago: ID, cierre: "cobrado", nota: " Pagó por Nequi. " };

beforeEach(() => {
  h.exigirRol.mockClear();
  h.cerrar.mockReset();
  h.revalidatePath.mockClear();
});

describe("cerrarCaso (HU-078): lo que se guardó", () => {
  it("criterio 2: cerrar vuelve al pago con el éxito y refresca la bandeja y la página, con la sesión del admin", async () => {
    h.cerrar.mockResolvedValue("cerrado");
    expect(await enviar(COBRADO)).toEqual({ destino: `${RUTA}?caso=cerrado` });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", RUTA);
    expect(h.cerrar).toHaveBeenCalledWith(h.cliente, { idPago: ID, cierre: "cobrado", nota: "Pagó por Nequi." });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
  });

  it("sin nota, la nota viaja nula", async () => {
    h.cerrar.mockResolvedValue("cerrado");
    expect(await enviar({ id_pago: ID, cierre: "asumido", nota: "   " })).toEqual({ destino: `${RUTA}?caso=cerrado` });
    expect(h.cerrar).toHaveBeenCalledWith(h.cliente, { idPago: ID, cierre: "asumido", nota: null });
  });
});

describe("cerrarCaso: lo que no se guardó", () => {
  it.each(["ya_cerrado", "no_es_caso"] as const)("%s cambió mientras el admin miraba: vuelve al pago, que se pinta como está ahora", async (resultado) => {
    h.cerrar.mockResolvedValue(resultado);
    expect(await enviar(COBRADO)).toEqual({ destino: `${RUTA}?caso=${resultado}` });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
  });

  it.each(["no_encontrado", "nota_invalida", "cierre_invalido", "sin_permiso", "sin_sesion"] as const)(
    "%s se dice en el formulario, con lo escrito",
    async (resultado) => {
      h.cerrar.mockResolvedValue(resultado);
      expect(await enviar(COBRADO)).toEqual({ estado: { error: MENSAJES_DEL_CIERRE[resultado], valores: { cierre: "cobrado", nota: COBRADO.nota } } });
      expect(h.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("si la base falla, pide intentar de nuevo sin perder lo escrito", async () => {
    h.cerrar.mockRejectedValue(new Error("se cayó la base"));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar(COBRADO)).toEqual({ estado: { error: MENSAJE_DE_FALLO, valores: { cierre: "cobrado", nota: COBRADO.nota } } });
    expect(espia).toHaveBeenCalled();
    espia.mockRestore();
  });

  it("un formulario inválido no llega a la base", async () => {
    expect(await enviar({ id_pago: "otro", cierre: "cobrado" })).toEqual({
      estado: { error: MENSAJES_DEL_CIERRE.no_encontrado, valores: { cierre: "cobrado", nota: "" } },
    });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", "/admin");
    expect(await enviar({ id_pago: ID, nota: "Sin elegir" })).toEqual({
      estado: { error: MENSAJES_DEL_CIERRE.cierre_invalido, valores: { cierre: "", nota: "Sin elegir" } },
    });
    expect(await enviar({ id_pago: ID, cierre: "asumido", nota: "a".repeat(501) })).toEqual({
      estado: { error: MENSAJES_DEL_CIERRE.nota_invalida, valores: { cierre: "asumido", nota: "a".repeat(501) } },
    });
    expect(h.cerrar).not.toHaveBeenCalled();
  });

  it("se protege sola: sin admin, exigirRol redirige antes de cerrar nada", async () => {
    h.exigirRol.mockRejectedValueOnce(new h.Redireccion("/ingresar"));
    expect(await enviar(COBRADO)).toEqual({ destino: "/ingresar" });
    expect(h.cerrar).not.toHaveBeenCalled();
  });
});
