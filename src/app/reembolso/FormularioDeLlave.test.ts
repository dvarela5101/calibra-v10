import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// El envoltorio de la acción sin navegador: una falla de la red no tumba la página y el `redirect` de la acción pasa
// tal cual para que Next navegue. La acción de verdad la prueba acciones.test.ts.

const falsos = vi.hoisted(() => ({ entregar: vi.fn(), rethrow: vi.fn() }));

vi.mock("./acciones", () => ({ entregarLlave: (...args: unknown[]) => falsos.entregar(...args) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: (error: unknown) => falsos.rethrow(error) }));

import { entregarSinCaerse, FormularioDeLlave, SIN_RESPUESTA } from "./FormularioDeLlave";

const TOKEN = "f".repeat(64);
const INICIAL = { error: null, valor: "" };

const datosCon = (llave: string) => {
  const datos = new FormData();
  datos.set("token", TOKEN);
  datos.set("llave", llave);
  return datos;
};

afterEach(() => {
  falsos.entregar.mockReset();
  falsos.rethrow.mockReset();
});

describe("entregarSinCaerse", () => {
  it("devuelve lo que responde la acción", async () => {
    falsos.entregar.mockResolvedValue({ error: "Revisa tu llave", valor: "x" });
    expect(await entregarSinCaerse(INICIAL, datosCon("x"))).toEqual({ error: "Revisa tu llave", valor: "x" });
  });

  it("si la petición no llega, lo dice y conserva lo escrito", async () => {
    falsos.entregar.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await entregarSinCaerse(INICIAL, datosCon("300 123 4567"))).toEqual({ error: SIN_RESPUESTA, valor: "300 123 4567" });
    expect(falsos.rethrow).toHaveBeenCalledOnce();
  });

  it("la redirección de la acción no se trata como falla: se vuelve a lanzar para que Next navegue", async () => {
    const redireccion = new Error("NEXT_REDIRECT");
    falsos.entregar.mockRejectedValue(redireccion);
    falsos.rethrow.mockImplementation((error: unknown) => {
      throw error;
    });
    await expect(entregarSinCaerse(INICIAL, datosCon("x"))).rejects.toBe(redireccion);
  });
});

describe("FormularioDeLlave", () => {
  it("un solo campo de texto, con su ayuda, y el botón de enviar; sin errores al empezar", () => {
    const html = renderToStaticMarkup(createElement(FormularioDeLlave, { token: TOKEN, ayuda: "Revísala antes de enviarla." }));
    expect(html.match(/<input /g)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`<input type="hidden" name="token" value="${TOKEN}"/>`));
    expect(html).toContain('<p id="llave-ayuda"');
    expect(html).toContain("Revísala antes de enviarla.");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-invalid");
    expect(html).toMatch(/<button type="submit"[^>]*>Enviar mi llave<\/button>/);
  });
});
