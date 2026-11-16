import { describe, expect, it } from "vitest";
import { cifrasParaLaPortada, conMiles, etiquetaDeMaterias, redondearHaciaAbajo } from "./cifras";

describe("redondearHaciaAbajo (HU-134)", () => {
  it.each([
    [0, 0],
    [1, 0],
    [9, 0],
    [10, 10],
    [19, 10],
    [99, 90],
    [100, 100],
    [149, 100],
    [150, 150],
    [249, 200],
    [250, 250],
    [263, 250],
    [299, 250],
    [300, 300],
    [445, 400],
    [999, 950],
    [1000, 1000],
    [1099, 1000],
    [1100, 1100],
    [1250, 1200],
    [12_345, 12_300],
  ])("%i → %i", (entrada, esperado) => {
    expect(redondearHaciaAbajo(entrada)).toBe(esperado);
  });

  it("nunca sube y lo que no es un número positivo da 0", () => {
    for (let n = 0; n <= 3000; n++) expect(redondearHaciaAbajo(n)).toBeLessThanOrEqual(n);
    for (const raro of [-5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(redondearHaciaAbajo(raro)).toBe(0);
  });

  it("un decimal cuenta por su parte entera", () => {
    expect(redondearHaciaAbajo(249.9)).toBe(200);
  });
});

describe("cifrasParaLaPortada (HU-134)", () => {
  it("deja las materias exactas y redondea preguntas y errores hacia abajo", () => {
    expect(cifrasParaLaPortada({ materias: 10, preguntas: 263, errores: 445 })).toEqual({ materias: 10, preguntas: 250, errores: 400 });
  });

  it.each([
    ["sin datos", null],
    ["indefinido", undefined],
    ["cero materias", { materias: 0, preguntas: 263, errores: 445 }],
    ["cero preguntas", { materias: 2, preguntas: 0, errores: 445 }],
    ["cero errores", { materias: 2, preguntas: 263, errores: 0 }],
    ["menos de 10 preguntas (redondea a 0)", { materias: 2, preguntas: 9, errores: 445 }],
    ["un negativo", { materias: 2, preguntas: -1, errores: 445 }],
    ["un decimal", { materias: 2.5, preguntas: 263, errores: 445 }],
    ["un NaN", { materias: 2, preguntas: Number.NaN, errores: 445 }],
  ])("%s: null", (_motivo, conteos) => {
    expect(cifrasParaLaPortada(conteos)).toBeNull();
  });
});

describe("formato de las cifras", () => {
  it("separa los miles con punto", () => {
    expect([conMiles(950), conMiles(1000), conMiles(12_300)]).toEqual(["950", "1.000", "12.300"]);
  });

  it("concuerda materia y materias", () => {
    expect([etiquetaDeMaterias(1), etiquetaDeMaterias(10)]).toEqual(["1 materia", "10 materias"]);
  });
});
