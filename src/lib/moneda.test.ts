import { describe, expect, it } from "vitest";
import { formatearPesos } from "./moneda";

// Intl separa el signo de pesos de la cifra con un espacio duro (U+00A0).
const normal = (texto: string) => texto.replace(/\xa0/g, " ");

describe("formatearPesos", () => {
  it.each([
    [0, "$ 0"],
    [500, "$ 500"],
    [25_000, "$ 25.000"],
    [150_000, "$ 150.000"],
    [1_234_567, "$ 1.234.567"],
  ])("%i pesos se ve %s", (monto, esperado) => {
    expect(normal(formatearPesos(monto))).toBe(esperado);
  });

  it("no muestra decimales", () => {
    expect(normal(formatearPesos(25_000))).not.toMatch(/[,.]\d{2}$/);
  });
});
