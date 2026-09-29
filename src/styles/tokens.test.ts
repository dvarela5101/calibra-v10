import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "tokens.css"), "utf8");

/** Lee el valor hex de una variable del primer bloque :root. */
function token(nombre: string): string {
  const coincidencia = css.match(new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`));
  if (!coincidencia) throw new Error(`No existe el token --${nombre} en tokens.css`);
  return coincidencia[1];
}

// Contraste WCAG 2.x: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const canal = parseInt(hex.slice(i, i + 2), 16) / 255;
    return canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

const AA_TEXTO = 4.5;

describe("tokens de diseño", () => {
  it.each(["text", "muted", "primary", "alert-text", "success-text"])(
    "--%s pasa AA como texto sobre --bg y --surface",
    (nombre) => {
      expect(contraste(token(nombre), token("bg"))).toBeGreaterThanOrEqual(AA_TEXTO);
      expect(contraste(token(nombre), token("surface"))).toBeGreaterThanOrEqual(AA_TEXTO);
    },
  );

  it("el texto del botón inactivo pasa AA sobre su fondo (--border)", () => {
    expect(contraste(token("muted-disabled"), token("border"))).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it("el texto blanco pasa AA sobre el botón primario", () => {
    expect(contraste("#ffffff", token("primary"))).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it.each(["alert", "success", "warn"])(
    "--%s no pasa AA como texto, por eso es solo relleno y tiene variante de texto",
    (nombre) => {
      expect(contraste(token(nombre), token("bg"))).toBeLessThan(AA_TEXTO);
    },
  );

  it("mantiene los mínimos de accesibilidad del producto", () => {
    expect(css).toMatch(/--texto-min:\s*14px/);
    expect(css).toMatch(/--toque-min:\s*44px/);
  });

  it("no usa degradados", () => {
    expect(css).not.toMatch(/gradient\(/);
  });
});
