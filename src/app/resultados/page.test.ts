import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILA_DE_EJEMPLO } from "../../../pruebas/diagnostico-sembrado";
import { proyectarResultado } from "@/lib/diagnostico/mostrar";

// HU-031: la página del enlace de resultados, sin navegador ni base. La lectura por token es inventada (la de verdad, con su
// forma del token y la consulta, la prueban recuperacion.test.ts y el pgTAP). Se fija que la página no lee la sesión, que
// todo enlace que no sirve se ve igual, y que lo que se pinta no trae el token ni el bloque del contacto.

const falsos = vi.hoisted(() => ({ leer: vi.fn(), sesion: vi.fn() }));

vi.mock("@/lib/diagnostico/recuperacion", () => ({ leerResultadoPorToken: (...args: unknown[]) => falsos.leer(...args) }));
vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: (...args: unknown[]) => falsos.sesion(...args) }));

import Resultados, { metadata } from "./page";

const TOKEN = "c3".repeat(32);
const RESULTADO = proyectarResultado(FILA_DE_EJEMPLO);

async function pintar(searchParams: Record<string, string | string[] | undefined>): Promise<string> {
  const pagina = await Resultados({ searchParams: Promise.resolve(searchParams) } as never);
  return renderToStaticMarkup(pagina);
}

beforeEach(() => {
  falsos.leer.mockReset().mockResolvedValue(null);
  falsos.sesion.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("/resultados", () => {
  it("no se indexa y no manda el Referer", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("con un token que sirve pinta el resultado de HU-009, sin el token ni el bloque del contacto", async () => {
    falsos.leer.mockResolvedValue(RESULTADO);
    const html = await pintar({ token: TOKEN });
    expect(falsos.leer).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(html).toContain(RESULTADO.materia.nombre);
    expect(html).toContain(RESULTADO.evaluacion.nombre);
    expect(html).toContain(`/monitores?materia=${RESULTADO.materia.codigo}`);
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("Ya tenemos tu contacto");
    expect(html).not.toContain("Déjanos tu contacto");
    expect(html).not.toContain("Este enlace no sirve");
  });

  it("todo enlace que no sirve se ve igual, sin datos del diagnóstico", async () => {
    const pantallas = new Set<string>();
    for (const parametros of [
      {},
      { token: "" },
      { token: [TOKEN, TOKEN] },
      { token: "no-es-un-token" },
      { token: FILA_DE_EJEMPLO.id_diagnostico },
      { token: TOKEN },
      { correo: "ana@calibra.test" },
      { telefono: "3001234567" },
    ]) {
      const html = await pintar(parametros);
      expect(html).toContain("Este enlace no sirve");
      expect(html).not.toContain(RESULTADO.materia.nombre);
      pantallas.add(html);
    }
    expect(pantallas.size).toBe(1);
  });

  it("no lee la sesión: abrir el enlace no crea ni toca ninguna", async () => {
    falsos.leer.mockResolvedValue(RESULTADO);
    await pintar({ token: TOKEN });
    await pintar({});
    expect(falsos.sesion).not.toHaveBeenCalled();
  });

  it("si la lectura falla, lo dice sin datos y el log no trae el token", async () => {
    falsos.leer.mockRejectedValue(new Error("Falló «resultado_por_token» al leer el resultado (código 57014)."));
    const html = await pintar({ token: TOKEN });
    expect(html).toContain("No pudimos cargar tus resultados");
    expect(html).not.toContain(TOKEN);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(TOKEN);
  });
});
