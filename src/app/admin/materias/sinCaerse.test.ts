import { describe, expect, it, vi } from "vitest";
import { sinCaerse } from "./sinCaerse";

// HU-055 sin navegador: el envoltorio que impide que un fallo de la red tumbe la página, y deja pasar lo interno de Next.

type Estado = { error: string | null; valores: Record<string, string> };

const datos = (() => {
  const d = new FormData();
  d.set("nombre", "Cálculo");
  return d;
})();
const inicial: Estado = { error: null, valores: {} };
const alFallar = (_anterior: Estado, d: FormData): Estado => ({ error: "No pudimos guardar los cambios. Intenta de nuevo.", valores: { nombre: String(d.get("nombre")) } });

describe("sinCaerse", () => {
  it("con el resultado de la acción, lo devuelve tal cual y le pasa el estado anterior y los datos", async () => {
    const accion = vi.fn(async (): Promise<Estado> => ({ error: null, valores: { nombre: "Cálculo" } }));
    const alFallarVigilado = vi.fn(alFallar);
    expect(await sinCaerse(accion, alFallarVigilado)(inicial, datos)).toEqual({ error: null, valores: { nombre: "Cálculo" } });
    expect(accion).toHaveBeenCalledExactlyOnceWith(inicial, datos);
    expect(alFallarVigilado).not.toHaveBeenCalled();
  });

  it("con un error cualquiera (red caída, despliegue nuevo) devuelve el estado de error con lo que había escrito", async () => {
    const accion = async (): Promise<Estado> => {
      throw new Error("Failed to fetch");
    };
    expect(await sinCaerse(accion, alFallar)(inicial, datos)).toEqual({
      error: "No pudimos guardar los cambios. Intenta de nuevo.",
      valores: { nombre: "Cálculo" },
    });
  });

  it("con el redirect de Next lo relanza, para que haga la navegación", async () => {
    // Lo que lanza `redirect()`: un error con digest `NEXT_REDIRECT;<tipo>;<destino>;<estado>;`.
    const redireccion = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/admin/materias?borrada=X;303;" });
    const accion = async (): Promise<Estado> => {
      throw redireccion;
    };
    await expect(sinCaerse(accion, alFallar)(inicial, datos)).rejects.toBe(redireccion);
  });

  it("con el notFound de Next también lo relanza", async () => {
    const noEncontrada = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    const accion = async (): Promise<Estado> => {
      throw noEncontrada;
    };
    await expect(sinCaerse(accion, alFallar)(inicial, datos)).rejects.toBe(noEncontrada);
  });
});
