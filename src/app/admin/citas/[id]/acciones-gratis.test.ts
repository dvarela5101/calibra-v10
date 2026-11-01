import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAMBIOS_DE_LA_MARCA, MENSAJE_DE_FALLO_DE_MARCA, MENSAJES_DE_MARCA } from "@/lib/admin/gratis-reglas";
import { cambiarMarcaGratis, type EstadoMarca } from "./acciones";

// HU-116 sin navegador ni base: la acción de marcar o desmarcar una monitoría de prueba con la sesión y la respuesta de la base
// inventadas. Aquí se fija a dónde vuelve con cada resultado, que no manda correos (los anota la base) y que un formulario
// inválido no llega a la base. La base de verdad la cubre supabase/tests/monitoria_gratis.test.sql y el recorrido
// e2e/monitoria-gratis.spec.ts.

const ID = "16161616-0000-4000-8000-000000000116";
const RUTA = `/admin/citas/${ID}`;

const h = vi.hoisted(() => {
  class Redireccion extends Error {
    constructor(readonly destino: string) {
      super(`redirect:${destino}`);
    }
  }
  return {
    Redireccion,
    cliente: { soy: "el cliente de la sesión" } as { soy: string } | null,
    exigirRol: vi.fn<(rol: string, ruta: string) => Promise<{ idUsuario: string; rol: string }>>(async () => ({
      idUsuario: "a0a0a0a0-0000-4000-8000-000000000116",
      rol: "admin",
    })),
    marcarGratis: vi.fn(),
    revalidatePath: vi.fn(),
    enviarCorreo: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/admin/citas", () => ({ autorizarCancelacion: vi.fn(), marcarGratis: h.marcarGratis }));
vi.mock("@/lib/correo/servidor", () => ({ enviarCorreoDesdeServidor: h.enviarCorreo, urlDelSitio: (ruta: string) => ruta }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));

const INICIAL: EstadoMarca = { error: null };

async function enviar(campos: Record<string, string>): Promise<{ destino: string } | { estado: EstadoMarca }> {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  try {
    return { estado: await cambiarMarcaGratis(INICIAL, datos) };
  } catch (error) {
    if (error instanceof h.Redireccion) return { destino: error.destino };
    throw error;
  }
}

beforeEach(() => {
  h.cliente = { soy: "el cliente de la sesión" };
  h.exigirRol.mockClear();
  h.marcarGratis.mockReset();
  h.revalidatePath.mockClear();
  h.enviarCorreo.mockClear();
});

describe("cambiarMarcaGratis (HU-116): lo que se guardó", () => {
  it.each([
    ["1", true, "marcada"],
    ["0", false, "desmarcada"],
  ] as const)("gratis=%s pide %s y vuelve a la ficha con ?gratis=%s, refresca la bandeja, la lista y la ficha, sin correos", async (campo, gratis, resultado) => {
    h.marcarGratis.mockResolvedValue(resultado);
    expect(await enviar({ id_monitoria: ID, gratis: campo })).toEqual({ destino: `${RUTA}?gratis=${resultado}` });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", RUTA);
    expect(h.marcarGratis).toHaveBeenCalledWith(h.cliente, { idMonitoria: ID, gratis });
    expect(h.revalidatePath.mock.calls.map(([ruta]) => ruta).sort()).toEqual(["/admin", "/admin/citas", RUTA].sort());
    expect(h.enviarCorreo).not.toHaveBeenCalled();
  });

  it("la sesión se comprueba antes de llamar a la base", async () => {
    h.marcarGratis.mockResolvedValue("marcada");
    await enviar({ id_monitoria: ID, gratis: "1" });
    expect(h.exigirRol.mock.invocationCallOrder[0]).toBeLessThan(h.marcarGratis.mock.invocationCallOrder[0]);
  });
});

describe("cambiarMarcaGratis: lo que no se guardó", () => {
  it.each(CAMBIOS_DE_LA_MARCA)("%s cambió mientras el admin miraba: vuelve a la ficha con ?gratis_error=", async (resultado) => {
    h.marcarGratis.mockResolvedValue(resultado);
    expect(await enviar({ id_monitoria: ID, gratis: "1" })).toEqual({ destino: `${RUTA}?gratis_error=${resultado}` });
  });

  it.each(["sin_permiso", "sin_sesion", "no_existe", "pedido_invalido"] as const)("%s se dice en el formulario", async (resultado) => {
    h.marcarGratis.mockResolvedValue(resultado);
    expect(await enviar({ id_monitoria: ID, gratis: "1" })).toEqual({ estado: { error: MENSAJES_DE_MARCA[resultado] } });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("un formulario inválido no llega a la base, y uno sin id ni siquiera pide la ficha", async () => {
    expect(await enviar({ id_monitoria: ID, gratis: "sí" })).toEqual({ estado: { error: MENSAJES_DE_MARCA.pedido_invalido } });
    expect(await enviar({ id_monitoria: "no", gratis: "1" })).toEqual({ estado: { error: MENSAJES_DE_MARCA.no_existe } });
    expect(h.exigirRol).toHaveBeenLastCalledWith("admin", "/admin");
    expect(h.marcarGratis).not.toHaveBeenCalled();
  });

  it("si la base falla dice el mensaje de siempre", async () => {
    h.marcarGratis.mockRejectedValue(new Error("se cayó"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar({ id_monitoria: ID, gratis: "1" })).toEqual({ estado: { error: MENSAJE_DE_FALLO_DE_MARCA } });
  });
});
