import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dibujarTexto } from "@/components/contenido/dibujar";
import { DORADO_POR_COMANDO, DORADOS_ANIDADOS, DORADOS_EXTRA } from "../../../pruebas/dorados-mate";
import { EJEMPLO_POR_COMANDO, FORMULAS_ANIDADAS } from "../../../pruebas/ejemplos-mate";
import { COMANDOS_MATE } from "../../../scripts/contenido/matematica.mts";

// HU-083: el MathML que dibuja el prototipo para cada comando y para unas fórmulas de forma, fijado en pruebas/dorados-mate.ts
// (la cabecera de ese archivo explica de dónde salió). Los 67 ejemplos de pruebas/ejemplos-mate.ts solo comprueban que no queden
// barras ni llaves: sin esta tabla, un `\le` que dibuje ≥ o un `msubsup` que pase a `msub` pasaban las pruebas.

/** El dibujo de `$fuente$` sin el envoltorio y sin el nombre accesible, que prueban leer.test.ts y la e2e. */
const dibujado = (fuente: string): string =>
  renderToStaticMarkup(dibujarTexto(`$${fuente}$`))
    .replace(/ aria-label="[^"]*"/g, "")
    .replace(/^<span class="texto-banco">|<\/span>$/g, "");

describe("dorados del prototipo", () => {
  it("hay un dorado por comando, ni uno más ni uno menos", () => {
    expect(Object.keys(DORADO_POR_COMANDO).sort()).toEqual([...COMANDOS_MATE].sort());
  });

  it.each(COMANDOS_MATE.map((comando) => [comando, EJEMPLO_POR_COMANDO[comando]] as const))("\\%s: %s", (comando, ejemplo) => {
    expect(dibujado(ejemplo)).toBe(DORADO_POR_COMANDO[comando]);
  });

  it("las fórmulas anidadas son las de ejemplos-mate.ts, en el mismo orden", () => {
    expect(DORADOS_ANIDADOS.map(([fuente]) => fuente)).toEqual([...FORMULAS_ANIDADAS]);
  });

  it.each([...DORADOS_ANIDADOS, ...DORADOS_EXTRA])("%s", (fuente, esperado) => {
    expect(dibujado(fuente)).toBe(esperado);
  });

  it("los dorados son MathML de verdad (el nombre accesible ya no está y las barras tampoco)", () => {
    for (const esperado of [...Object.values(DORADO_POR_COMANDO), ...DORADOS_ANIDADOS.map(([, e]) => e), ...DORADOS_EXTRA.map(([, e]) => e)]) {
      expect(esperado).toMatch(/^<math>.*<\/math>$/);
      expect(esperado).not.toContain("aria-label");
    }
  });
});
