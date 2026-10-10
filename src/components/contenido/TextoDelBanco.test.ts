import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TextoDelBanco } from "./TextoDelBanco";

// HU-083: el componente que dibuja todo texto del banco (enunciado, opción, texto de error, solución o descripción).

const dibujar = (texto: string | null | undefined, className?: string) =>
  renderToStaticMarkup(createElement(TextoDelBanco, { texto, className }));

describe("TextoDelBanco", () => {
  it("criterio 1: una fracción apilada con subíndice, no el texto crudo", () => {
    const html = dibujar(String.raw`$\frac{1}{R_{\text{eq}}}$`);
    // El aria-label es el nombre accesible del <math> (src/lib/contenido/leer.ts).
    expect(html).toBe(
      '<span class="texto-banco"><math aria-label="1 sobre R sub eq"><mfrac><mn>1</mn><msub><mi>R</mi><mtext>eq</mtext></msub></mfrac></math></span>',
    );
    expect(html).not.toMatch(/[\\${}]/);
  });

  it("criterio 2: dentro de un enunciado con otras palabras", () => {
    const html = dibujar(String.raw`La resistencia es $\frac{1}{R_{\text{eq}}}$ y vale $R_1 + R_2$.`);
    expect(html).toContain('La resistencia es <math aria-label="1 sobre R sub eq"><mfrac>');
    expect(html).toContain('</math> y vale <math aria-label="R sub 1 más R sub 2"><msub><mi>R</mi><mn>1</mn></msub>');
    expect(html).toContain("</math>.</span>");
  });

  it("criterio 3: \\$ es un signo de pesos y no abre una fórmula", () => {
    expect(dibujar(String.raw`Cuesta \$5 y \$6`)).toBe('<span class="texto-banco">Cuesta $5 y $6</span>');
    expect(dibujar(String.raw`Cuesta \$5 y $x$`)).toBe(
      '<span class="texto-banco">Cuesta $5 y <math aria-label="x"><mi>x</mi></math></span>',
    );
    expect(dibujar(String.raw`\$5`)).not.toContain("<math");
  });

  it("criterio 4: un $ sin cerrar o una fórmula que no se entiende se ven como texto, sin marca", () => {
    expect(dibujar("Cuesta $5")).toBe('<span class="texto-banco">Cuesta $5</span>');
    expect(dibujar(String.raw`Mira $\foo$ aquí`)).toBe(String.raw`<span class="texto-banco">Mira $\foo$ aquí</span>`);
    expect(dibujar("$$")).toBe('<span class="texto-banco">$$</span>');
    expect(dibujar("${}$")).toBe('<span class="texto-banco">${}$</span>');
    expect(dibujar("$ $")).toBe('<span class="texto-banco">$ $</span>');
    expect(dibujar("Uno $1$ y dos $\\foo$ y tres $3")).toBe(
      '<span class="texto-banco">Uno <math aria-label="1"><mn>1</mn></math> y dos $\\foo$ y tres $3</span>',
    );
  });

  it("criterio 5: el bloque de código es una región con nombre, alcanzable con el teclado, y todo va literal", () => {
    const html = dibujar("¿Qué imprime?\n```\ndef f(x):\n    return $x$ + \\frac{1}{2}\n```");
    expect(html).toBe(
      '<div class="texto-banco"><p class="texto-banco-parrafo">¿Qué imprime?</p>' +
        '<pre class="texto-banco-codigo" tabindex="0" role="region" aria-label="Código">' +
        "<code>def f(x):\n    return $x$ + \\frac{1}{2}</code></pre></div>",
    );
    expect(html).not.toContain("<math");
  });

  it("la prosa de un enunciado con código también lleva sus fórmulas", () => {
    const html = dibujar("Si $x = 2$:\n```\nprint(1)\n```\n¿Cuánto vale $x^2$?");
    expect(html).toContain('<p class="texto-banco-parrafo">Si <math aria-label="x igual a 2">');
    expect(html).toContain('<p class="texto-banco-parrafo">¿Cuánto vale <math aria-label="x al cuadrado"><msup>');
    expect(html.match(/<pre /g)).toHaveLength(1);
  });

  it("sin cercas es un span, que cabe en una etiqueta, un botón o un título; con cercas, un div", () => {
    expect(dibujar("Hola").startsWith("<span ")).toBe(true);
    expect(dibujar(String.raw`$x$`).startsWith("<span ")).toBe(true);
    expect(dibujar("```\nx\n```").startsWith("<div ")).toBe(true);
    expect(dibujar("Hola\n```\nx\n```\nAdiós").startsWith("<div ")).toBe(true);
  });

  it("si todas las cercas quedan vacías cuenta como sin cercas: un span, sin región", () => {
    expect(dibujar("Hola\n```\n```\nAdiós")).toBe('<span class="texto-banco">Hola Adiós</span>');
    expect(dibujar("Hola\n```\n   \n```")).toBe('<span class="texto-banco">Hola</span>');
    expect(dibujar("```\n```")).toBe("");
    expect(dibujar("Hola\n```\n```")).not.toContain("<pre");
  });

  it("null, undefined y vacío no dibujan nada", () => {
    expect(dibujar(null)).toBe("");
    expect(dibujar(undefined)).toBe("");
    expect(dibujar("")).toBe("");
  });

  it("agrega la clase de quien lo usa", () => {
    expect(dibujar("Hola", "opcion")).toBe('<span class="texto-banco opcion">Hola</span>');
    expect(dibujar("```\nx\n```", "enunciado")).toMatch(/^<div class="texto-banco enunciado">/);
  });

  it("el texto hostil sale escapado, con y sin cercas", () => {
    expect(dibujar("<img src=x onerror=alert(1)>")).toBe('<span class="texto-banco">&lt;img src=x onerror=alert(1)&gt;</span>');
    const formula = dibujar("$<script>alert(1)</script>$");
    expect(formula).not.toMatch(/<\/?script|<img/);
    expect(formula).toContain("&lt;");
    const conCerca = dibujar("<b>hola</b>\n```\n<script>alert(1)</script>\n```");
    expect(conCerca).not.toMatch(/<\/?script|<\/?b>/);
    expect(conCerca).toContain("<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>");
  });
});

describe("criterio 7: nunca innerHTML con texto del banco", () => {
  const carpetas = [join(__dirname, "../../lib/contenido"), __dirname];
  const archivos = carpetas.flatMap((carpeta) =>
    readdirSync(carpeta)
      .filter((nombre) => /\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre))
      .map((nombre) => join(carpeta, nombre)),
  );

  it("hay código que revisar", () => {
    expect(archivos.map((ruta) => ruta.split(/[\\/]/).slice(-2).join("/")).sort()).toEqual(
      expect.arrayContaining(["contenido/TextoDelBanco.tsx", "contenido/dibujar.ts", "contenido/mate.ts", "contenido/mathml.ts", "contenido/enunciado.ts"]),
    );
  });

  it.each(["innerHTML", "dangerouslySetInnerHTML", "outerHTML", "insertAdjacentHTML", "document.write"])("ningún archivo usa %s", (prohibido) => {
    const usan = archivos.filter((ruta) => readFileSync(ruta, "utf8").includes(prohibido));
    expect(usan).toEqual([]);
  });
});
