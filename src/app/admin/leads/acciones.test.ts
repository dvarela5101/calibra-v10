import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_AL_REGISTRAR, NO_ENCONTRADO, YA_NO_ACEPTA } from "@/lib/leads/admin";
import { registrarPedidoSinContacto, type EstadoCambio } from "./acciones";

// HU-089 sin navegador ni base: la acción con la sesión y la función inventadas. Se fija que traduce cada respuesta a
// su mensaje, que no llama la base con un id que no sirve y que el log no lleva datos personales. La regla de verdad
// la cubren supabase/tests/registrar_sin_contacto.test.sql y la integración.

const ID = "4a4a4a4a-0000-4000-8000-000000000089";

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
      idUsuario: "a0a0a0a0-0000-4000-8000-000000000089",
      rol: "admin",
    })),
    registrarSinContacto: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/leads/admin", async (original) => ({
  ...(await original<typeof import("@/lib/leads/admin")>()),
  registrarSinContacto: h.registrarSinContacto,
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

const INICIAL: EstadoCambio = { error: null, exito: null };

const formulario = (idLead: string) => {
  const datos = new FormData();
  datos.set("id_lead", idLead);
  return datos;
};

beforeEach(() => {
  h.exigirRol.mockClear();
  h.registrarSinContacto.mockReset();
  h.revalidatePath.mockClear();
});

describe("registrarPedidoSinContacto (HU-089)", () => {
  it("exige ser admin y vuelve a la lista de leads", async () => {
    h.exigirRol.mockRejectedValueOnce(new h.Redireccion("/monitor"));
    await expect(registrarPedidoSinContacto(INICIAL, formulario(ID))).rejects.toThrow("redirect:/monitor");
    expect(h.exigirRol).toHaveBeenCalledWith("admin", "/admin/leads");
    expect(h.registrarSinContacto).not.toHaveBeenCalled();
  });

  it("con un id que no es uuid no llama la base", async () => {
    expect(await registrarPedidoSinContacto(INICIAL, formulario("no-es-un-id"))).toEqual({ error: ERROR_AL_REGISTRAR, exito: null });
    expect(h.registrarSinContacto).not.toHaveBeenCalled();
  });

  it("registrado: con la sesión del admin, vuelve a pintar la lista", async () => {
    h.registrarSinContacto.mockResolvedValueOnce({ ok: true });
    expect(await registrarPedidoSinContacto(INICIAL, formulario(ID))).toEqual({ error: null, exito: "Quedó registrado." });
    expect(h.registrarSinContacto).toHaveBeenCalledWith(h.cliente, ID);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/leads");
  });

  it.each([YA_NO_ACEPTA, NO_ENCONTRADO, ERROR_AL_REGISTRAR])("devuelve «%s» sin volver a pintar", async (mensaje) => {
    h.registrarSinContacto.mockResolvedValueOnce({ ok: false, error: mensaje });
    expect(await registrarPedidoSinContacto(INICIAL, formulario(ID))).toEqual({ error: mensaje, exito: null });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("si la base falla, dice que no pudo y el log solo lleva el mensaje", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    h.registrarSinContacto.mockRejectedValueOnce(new Error("No se pudo registrar el pedido: timeout"));
    expect(await registrarPedidoSinContacto(INICIAL, formulario(ID))).toEqual({ error: ERROR_AL_REGISTRAR, exito: null });
    expect(consola).toHaveBeenCalledOnce();
    expect(String(consola.mock.calls[0])).toContain("timeout");
    consola.mockRestore();
  });
});
