import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// HU-020, criterio 6, sin navegador ni base: "Ver comprobante" pide el enlace firmado con la sesión en el momento del
// clic y redirige a él. Que la respuesta sea un 307 hacia el Storage con su token, y que la imagen cargue, lo
// comprueba e2e/revisar-pagos.spec.ts.

const ID = "6a6a6a6a-0000-4000-8000-000000000020";
const ENLACE = "http://127.0.0.1:54321/storage/v1/object/sign/comprobantes/c0/a.png?token=abc";

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
      idUsuario: "a0a0a0a0-0000-4000-8000-000000000020",
      rol: "admin",
    })),
    firmar: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/comprobantes/almacenamiento", () => ({ enlaceDeComprobanteDePago: h.firmar }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));

const pedir = (id: string) => GET({} as NextRequest, { params: Promise.resolve({ id }) });

/** A dónde redirige el handler, o el error si hizo otra cosa. */
async function destino(id: string): Promise<string> {
  try {
    await pedir(id);
  } catch (error) {
    if (error instanceof h.Redireccion) return error.destino;
    throw error;
  }
  throw new Error("El handler no redirigió.");
}

beforeEach(() => {
  h.exigirRol.mockClear();
  h.firmar.mockReset();
  h.firmar.mockResolvedValue({ ok: true, url: ENLACE });
});

describe("Ver comprobante (HU-020, criterio 6)", () => {
  it("exige un admin, firma con la sesión de la petición y redirige al enlace firmado", async () => {
    expect(await destino(ID)).toBe(ENLACE);
    expect(h.exigirRol).toHaveBeenCalledWith("admin", `/admin/pagos/${ID}`);
    expect(h.firmar).toHaveBeenCalledTimes(1);
    expect(h.firmar).toHaveBeenCalledWith(h.cliente, ID);
  });

  it("cada clic pide un enlace nuevo: nada se guarda entre una petición y otra", async () => {
    await destino(ID);
    await destino(ID);
    expect(h.firmar).toHaveBeenCalledTimes(2);
  });

  it("sin sesión de admin, exigirRol redirige antes de firmar nada", async () => {
    h.exigirRol.mockRejectedValueOnce(new h.Redireccion(`/ingresar?siguiente=${encodeURIComponent(`/admin/pagos/${ID}`)}`));
    expect(await destino(ID)).toBe("/ingresar?siguiente=%2Fadmin%2Fpagos%2F6a6a6a6a-0000-4000-8000-000000000020");
    expect(h.firmar).not.toHaveBeenCalled();
  });

  it("un id que no es un uuid es un 404, sin firmar", async () => {
    await expect(pedir("../../otro")).rejects.toThrow("notFound");
    expect(h.firmar).not.toHaveBeenCalled();
  });

  it("si no se pudo firmar (el pago no existe o el Storage falló), vuelve al pago con el aviso", async () => {
    h.firmar.mockResolvedValue({ ok: false, mensaje: "No se encontró el pago." });
    expect(await destino(ID)).toBe(`/admin/pagos/${ID}?error=comprobante`);
  });
});
