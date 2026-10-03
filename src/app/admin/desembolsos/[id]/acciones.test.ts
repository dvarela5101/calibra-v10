import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORES_DE_FECHA, MENSAJE_DE_FALLO, MENSAJES_DE_EJECUCION } from "@/lib/admin/desembolsos-reglas";
import { ejecutar, type EstadoEjecucion } from "./acciones";

// HU-028 sin navegador ni base: la acción con la sesión y la ejecución inventadas. Aquí se fija a dónde vuelve con
// cada resultado, que el monto cambiado conserva lo escrito y que un error no vacía el formulario. La base de verdad
// la cubren supabase/tests/desembolsos.test.sql y la integración.

const ID = "d0d0d0d0-0000-4000-8000-000000000028";
const RUTA = `/admin/desembolsos/${ID}`;
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
    cliente: { soy: "el cliente de la sesión" },
    exigirRol: vi.fn<(rol: string, ruta: string) => Promise<{ idUsuario: string; rol: string }>>(async () => ({
      idUsuario: "a0a0a0a0-0000-4000-8000-000000000028",
      rol: "admin",
    })),
    ejecutarDesembolso: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/admin/desembolsos", () => ({ ejecutarDesembolso: h.ejecutarDesembolso }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));

const INICIAL: EstadoEjecucion = { error: null, valores: { referencia: "", fecha: "2030-01-10" } };

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

/** Lo que hizo la acción: a dónde redirigió o qué estado devolvió. */
async function enviar(campos: Record<string, string>): Promise<{ destino: string } | { estado: EstadoEjecucion }> {
  try {
    return { estado: await ejecutar(INICIAL, formulario(campos)) };
  } catch (error) {
    if (error instanceof h.Redireccion) return { destino: error.destino };
    throw error;
  }
}

const EJECUTAR = { id_desembolso: ID, referencia: " M12345678 ", fecha: "2030-01-09", fecha_sesion: "2030-01-06", neto_esperado: "22500" };
const ESCRITO = { referencia: EJECUTAR.referencia, fecha: EJECUTAR.fecha };

beforeEach(() => {
  vi.useFakeTimers({ now: AHORA, toFake: ["Date"] });
  h.exigirRol.mockClear();
  h.ejecutarDesembolso.mockReset();
  h.revalidatePath.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ejecutar (HU-028): lo que se registró", () => {
  it("criterio 4: vuelve al desembolso con el éxito y refresca la bandeja; quién ejecuta lo pone la sesión", async () => {
    h.ejecutarDesembolso.mockResolvedValue("desembolsado");
    expect(await enviar(EJECUTAR)).toEqual({ destino: `${RUTA}?ejecutado=desembolsado` });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", RUTA);
    expect(h.ejecutarDesembolso).toHaveBeenCalledWith(h.cliente, { idDesembolso: ID, referencia: "M12345678", fecha: "2030-01-09", netoEsperado: 22_500 });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
  });
});

describe("ejecutar: lo que no se registró", () => {
  it.each(["ya_desembolsado", "anulado", "no_realizada", "antes_de_plazo", "con_reporte", "pagos_en_revision", "sin_pagos_aprobados"] as const)(
    "%s cambió mientras el admin miraba: vuelve al desembolso, que se pinta como está ahora",
    async (resultado) => {
      h.ejecutarDesembolso.mockResolvedValue(resultado);
      expect(await enviar(EJECUTAR)).toEqual({ destino: `${RUTA}?error=${resultado}` });
      expect(h.revalidatePath).toHaveBeenCalledWith("/admin");
    },
  );

  it("P-29: si cambió el monto, lo dice, conserva lo escrito y vuelve a pintar la página con el monto nuevo", async () => {
    h.ejecutarDesembolso.mockResolvedValue("monto_cambio");
    expect(await enviar(EJECUTAR)).toEqual({ estado: { error: MENSAJES_DE_EJECUCION.monto_cambio, valores: ESCRITO } });
    expect(h.revalidatePath).toHaveBeenCalledWith(RUTA);
  });

  it.each(["fecha_invalida", "referencia_invalida", "no_encontrado", "sin_permiso", "sin_sesion"] as const)("%s se dice en el formulario", async (resultado) => {
    h.ejecutarDesembolso.mockResolvedValue(resultado);
    expect(await enviar(EJECUTAR)).toEqual({ estado: { error: MENSAJES_DE_EJECUCION[resultado], valores: ESCRITO } });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("si la base falla, pide intentar de nuevo sin perder lo escrito", async () => {
    h.ejecutarDesembolso.mockRejectedValue(new Error("se cayó la base"));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar(EJECUTAR)).toEqual({ estado: { error: MENSAJE_DE_FALLO, valores: ESCRITO } });
    espia.mockRestore();
  });

  it("un formulario inválido no llega a la base", async () => {
    expect(await enviar({ ...EJECUTAR, id_desembolso: "otro" })).toEqual({
      estado: { error: MENSAJES_DE_EJECUCION.no_encontrado, valores: ESCRITO },
    });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", "/admin");
    expect(await enviar({ ...EJECUTAR, referencia: "a".repeat(101) })).toEqual({
      estado: { error: MENSAJES_DE_EJECUCION.referencia_invalida, valores: { ...ESCRITO, referencia: "a".repeat(101) } },
    });
    expect(h.ejecutarDesembolso).not.toHaveBeenCalled();
  });

  it("la fecha se compara con el día de Bogotá, no con el del servidor: a las 11 p. m. del 10, el 11 es futuro", async () => {
    // 04:00 UTC del 11 de enero = 11:00 p. m. del 10 en Bogotá.
    vi.setSystemTime(new Date("2030-01-11T04:00:00.000Z"));
    expect(await enviar({ ...EJECUTAR, fecha: "2030-01-11" })).toEqual({
      estado: { error: ERRORES_DE_FECHA.futura, valores: { ...ESCRITO, fecha: "2030-01-11" } },
    });
    h.ejecutarDesembolso.mockResolvedValue("desembolsado");
    expect(await enviar({ ...EJECUTAR, fecha: "2030-01-10" })).toEqual({ destino: `${RUTA}?ejecutado=desembolsado` });
  });

  it("se protege sola: sin admin, exigirRol redirige antes de ejecutar nada", async () => {
    h.exigirRol.mockRejectedValueOnce(new h.Redireccion("/ingresar"));
    expect(await enviar(EJECUTAR)).toEqual({ destino: "/ingresar" });
    expect(h.ejecutarDesembolso).not.toHaveBeenCalled();
  });
});
