import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoDeEntregar } from "@/lib/reembolsos/reglas";
import { entregarLlave, type EstadoEntregar } from "./acciones";

// La acción de entregar la llave con sus dependencias falsas: la puerta de la base (`entregarLlavePorToken`) y el
// `redirect` de Next, que aquí lanza un error con la ruta para poder leerla. Si el reembolso todavía espera la llave y si
// el plazo sigue abierto lo decide la base: se prueba en pgTAP e integración.

const TOKEN = "c".repeat(64);
const INICIAL: EstadoEntregar = { error: null, valor: "" };

const falsos = vi.hoisted(() => ({ entregar: vi.fn() }));

class Redireccion extends Error {
  constructor(
    readonly ruta: string,
    readonly tipo: string | undefined,
  ) {
    super(`NEXT_REDIRECT ${ruta}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (ruta: string, tipo?: string) => {
    throw new Redireccion(ruta, tipo);
  },
}));
vi.mock("@/lib/reembolsos/servidor", () => ({ entregarLlavePorToken: (...args: unknown[]) => falsos.entregar(...args) }));

const formulario = (campos: Record<string, string | Blob>) => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

/** Lo que devuelve la acción, o la redirección que lanza (su ruta y su tipo). */
async function enviar(campos: Record<string, string | Blob>) {
  try {
    return { estado: await entregarLlave(INICIAL, formulario(campos)), redireccion: null };
  } catch (error) {
    if (error instanceof Redireccion) return { estado: null, redireccion: { ruta: error.ruta, tipo: error.tipo } };
    throw error;
  }
}

beforeEach(() => {
  falsos.entregar.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("entregarLlave (criterio 2): lo que vuelve a la página", () => {
  it.each(["entregada", "ya_entregada", "cerrado"] as const)("con %s vuelve a la misma página, reemplazando la dirección", async (resultado) => {
    falsos.entregar.mockResolvedValue(resultado);
    const { estado, redireccion } = await enviar({ token: TOKEN, llave: "3001234567" });
    expect(estado).toBeNull();
    expect(redireccion).toEqual({ ruta: `/reembolso?token=${TOKEN}`, tipo: "replace" });
  });

  it("manda la llave normalizada (espacios seguidos como uno, sin bordes) y el token recortado", async () => {
    falsos.entregar.mockResolvedValue("entregada");
    await enviar({ token: `  ${TOKEN}\n`, llave: "  300   123\t4567 " });
    expect(falsos.entregar).toHaveBeenCalledExactlyOnceWith(TOKEN, "300 123 4567");
  });
});

describe("entregarLlave: lo que se queda en el formulario", () => {
  it("una llave vacía o en blanco no llega a la base", async () => {
    for (const llave of ["", "   ", "\n\t"]) {
      const { estado } = await enviar({ token: TOKEN, llave });
      expect(estado, JSON.stringify(llave)).toEqual({ error: "Escribe tu llave para que podamos devolverte el dinero.", valor: "" });
    }
    expect(falsos.entregar).not.toHaveBeenCalled();
  });

  it("una llave de más de 200 caracteres no llega a la base y conserva lo escrito", async () => {
    const larga = "a".repeat(201);
    expect((await enviar({ token: TOKEN, llave: larga })).estado).toEqual({
      error: "La llave es demasiado larga: puede tener hasta 200 caracteres.",
      valor: larga,
    });
    expect(falsos.entregar).not.toHaveBeenCalled();
  });

  it.each([
    ["llave_invalida", "Revisa tu llave: no puede quedar vacía y puede tener hasta 200 caracteres."],
    ["no_existe", "Este enlace no sirve. Abre de nuevo el enlace del correo que te mandamos."],
  ] as const satisfies readonly (readonly [ResultadoDeEntregar, string])[])("%s se explica, conserva lo escrito y no redirige", async (resultado, mensaje) => {
    falsos.entregar.mockResolvedValue(resultado);
    const { estado, redireccion } = await enviar({ token: TOKEN, llave: "3001234567" });
    expect(redireccion).toBeNull();
    expect(estado).toEqual({ error: mensaje, valor: "3001234567" });
  });

  it.each([
    ["sin token", {}],
    ["con un token sin forma de token", { token: "abc" }],
    ["con un token en mayúsculas", { token: "C".repeat(64) }],
    ["con un archivo en vez del token", { token: new Blob(["x"]) }],
  ] as const)("%s dice que el enlace no sirve, sin llamar a la base", async (_caso, campos) => {
    const { estado } = await enviar({ ...campos, llave: "3001234567" });
    expect(estado?.error).toBe("Este enlace no sirve. Abre de nuevo el enlace del correo que te mandamos.");
    expect(falsos.entregar).not.toHaveBeenCalled();
  });
});

describe("entregarLlave: cuando la base falla", () => {
  it("dice que no se pudo, lo registra sin el token ni la llave y no redirige como si la hubiera guardado", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    falsos.entregar.mockRejectedValue(new Error("No se pudo guardar la llave: conexión rechazada"));
    const { estado, redireccion } = await enviar({ token: TOKEN, llave: "llave-secreta-de-ana" });
    expect(redireccion).toBeNull();
    expect(estado).toEqual({ error: "No pudimos guardar tu llave. Intenta de nuevo.", valor: "llave-secreta-de-ana" });
    expect(registro).toHaveBeenCalledOnce();
    expect(JSON.stringify(registro.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(registro.mock.calls)).not.toContain("llave-secreta-de-ana");
  });

  it("una respuesta desconocida de la base (la puerta lanza) tampoco se toma por guardada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    falsos.entregar.mockRejectedValue(new Error('Respuesta inesperada al guardar la llave: "guardada"'));
    const { estado, redireccion } = await enviar({ token: TOKEN, llave: "3001234567" });
    expect(redireccion).toBeNull();
    expect(estado?.error).toBe("No pudimos guardar tu llave. Intenta de nuevo.");
  });
});
