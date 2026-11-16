import { describe, expect, it } from "vitest";
import { CABECERAS_DE_SEGURIDAD, DIRECTIVAS_CSP, REGLA_DE_CABECERAS } from "./cabeceras";

function valor(nombre: string): string {
  const cabecera = CABECERAS_DE_SEGURIDAD.find((c) => c.key === nombre);
  if (!cabecera) throw new Error(`Falta la cabecera ${nombre}`);
  return cabecera.value;
}

describe("cabeceras de seguridad", () => {
  it("prohíbe incrustar la app y el olfateo de tipos", () => {
    expect(valor("X-Frame-Options")).toBe("DENY");
    expect(valor("X-Content-Type-Options")).toBe("nosniff");
  });

  it("limita el referente al mismo origen en las peticiones cruzadas", () => {
    expect(valor("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("niega cámara, micrófono y geolocalización", () => {
    const politica = valor("Permissions-Policy");
    for (const permiso of ["camera", "microphone", "geolocation"]) {
      expect(politica).toContain(`${permiso}=()`);
    }
  });

  it("la CSP lleva las cuatro directivas y ninguna de scripts ni estilos", () => {
    const csp = valor("Content-Security-Policy");
    expect(csp.split("; ")).toEqual([
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
    ]);
    expect(csp).not.toMatch(/script-src|style-src|default-src/);
    expect(DIRECTIVAS_CSP).toHaveLength(4);
  });

  it("no repite cabeceras y se aplica a todas las rutas", () => {
    const nombres = CABECERAS_DE_SEGURIDAD.map((c) => c.key);
    expect(new Set(nombres).size).toBe(nombres.length);
    expect(REGLA_DE_CABECERAS.source).toBe("/:path*");
    expect(REGLA_DE_CABECERAS.headers).toEqual(CABECERAS_DE_SEGURIDAD);
  });
});
