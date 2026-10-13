import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// HU-050, criterio 16: los colores salen de tokens.css, sin degradados y sin texto por debajo de 14 px. La e2e mide el
// tamaño real en un navegador; esta prueba atrapa lo que la e2e no mide (un color suelto, un degradado, una variable
// que no existe) y no necesita ni navegador ni base. Ninguna otra prueba del repo lee los *.module.css.

const CSS = readFileSync(join(__dirname, "desembolsos.module.css"), "utf8");
const TOKENS = readFileSync(join(__dirname, "../../../styles/tokens.css"), "utf8");

/** Los `--nombre` que define tokens.css. */
const DEFINIDOS = new Set([...TOKENS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

const SIN_COLOR = /^(?:transparent|inherit|initial|unset|currentcolor|none|auto|solid|dashed|dotted|inset|0)$/i;

/** Qué le pasa a un CSS frente a las reglas del producto. Vacío si cumple. */
function problemasDeCss(css: string): string[] {
  const problemas: string[] = [];
  // Los comentarios pueden hablar de colores y de tamaños sin ser estilos.
  const sin = css.replace(/\/\*[\s\S]*?\*\//g, "");

  for (const [color] of sin.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) problemas.push(`color suelto ${color}`);
  for (const [funcion] of sin.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\(/gi)) problemas.push(`color suelto con ${funcion})`);
  if (/gradient\(/i.test(sin)) problemas.push("degradado");

  for (const [, nombre] of sin.matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (!DEFINIDOS.has(nombre)) problemas.push(`${nombre} no está definida en tokens.css`);
  }

  for (const [, propiedad, valor] of sin.matchAll(/(?:^|[;{\s])(font-size|font)\s*:\s*([^;}]+)/g)) {
    if (propiedad === "font") {
      problemas.push("font abreviado: usa font-size en px");
      continue;
    }
    const medida = /^(\d+(?:\.\d+)?)px$/.exec(valor.trim());
    if (medida ? Number(medida[1]) < 14 : valor.trim() !== "var(--texto-min)") {
      problemas.push(`font-size ${valor.trim()}: debe ser de 14px o más, en px`);
    }
  }

  // Un color con nombre (`red`, `black`) tampoco sale de tokens.css: en las propiedades de color solo vale var(--x) o una palabra sin color.
  for (const [, propiedad, valor] of sin.matchAll(/(?:^|[;{\s])((?:background|border|outline|box-shadow|fill|stroke|caret-color|accent-color|color|text-decoration)(?:-[a-z]+)*)\s*:\s*([^;}]+)/g)) {
    if (propiedad === "background-image" || /^(?:border|outline)-(?:width|style|radius|collapse|spacing)/.test(propiedad)) continue;
    const resto = valor
      .replace(/var\(\s*--[\w-]+\s*\)/g, " ")
      .replace(/\d+(?:\.\d+)?(?:px|em|rem|%)?/g, " ")
      .split(/\s+/)
      .filter((palabra) => palabra && !SIN_COLOR.test(palabra));
    if (resto.length > 0) problemas.push(`${propiedad}: ${resto.join(" ")} no sale de tokens.css`);
  }

  // --alert, --warn y --success son solo relleno: como texto no pasan el contraste.
  if (/(?:^|[;{\s])color\s*:\s*var\(\s*--(?:alert|warn|success)\s*\)/.test(sin)) problemas.push("--alert, --warn o --success como color de texto");
  return problemas;
}

describe("desembolsos.module.css (criterio 16)", () => {
  it("los colores salen de tokens.css, sin degradados, con texto de 14 px o más y con todas sus variables definidas", () => {
    expect(problemasDeCss(CSS)).toEqual([]);
  });

  it("control: la prueba mira algo (hay estilos, tamaños de texto y variables de tokens.css)", () => {
    expect(DEFINIDOS.has("--surface") && DEFINIDOS.has("--toque-min") && DEFINIDOS.has("--success-text")).toBe(true);
    expect((CSS.match(/font-size:/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect((CSS.match(/var\(--/g) ?? []).length).toBeGreaterThanOrEqual(20);
    for (const variable of ["--surface", "--border", "--r", "--sombra-carta", "--muted", "--success-text", "--alert-text", "--toque-min"]) {
      expect(CSS, variable).toContain(`var(${variable})`);
    }
  });

  it("el texto de la situación usa las variantes de texto: transferido en verde de texto y anulado en rojo de texto", () => {
    expect(CSS).toMatch(/\.transferido\s*\{[^}]*color:\s*var\(--success-text\)/);
    expect(CSS).toMatch(/\.anulado\s*\{[^}]*color:\s*var\(--alert-text\)/);
  });

  it("lo que se transfiere (.neto) va en negrita y en un texto más grande que las otras cifras (.montos)", () => {
    expect(CSS).toMatch(/\.neto\s*\{[^}]*font-weight:\s*(?:700|800|900|bold)\b/);
    const tamano = (selector: string) => Number(new RegExp(`${selector}\\s*\\{[^}]*font-size:\\s*(\\d+(?:\\.\\d+)?)px`).exec(CSS)?.[1]);
    expect(tamano("\\.montos")).toBeGreaterThanOrEqual(14);
    expect(tamano("\\.neto")).toBeGreaterThan(tamano("\\.montos"));
  });

  it("solo el valor de una cifra va en un renglón sin partirse; el resto de los textos puede partirse (una referencia de 100 caracteres no se sale a 390 px)", () => {
    const reglas = [...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, cuerpo]) => ({ selector: selector.trim(), cuerpo }));
    const sinPartir = reglas.filter((r) => /white-space\s*:\s*nowrap/.test(r.cuerpo)).map((r) => r.selector);
    expect(sinPartir).toEqual([".valor"]);
    for (const clase of [".dato", ".situacion", ".detalle", ".rotulo"]) {
      expect(reglas.find((r) => r.selector === clase)?.cuerpo, clase).toMatch(/overflow-wrap\s*:\s*anywhere/);
    }
  });

  it("«Ver N más» mide al menos 44 px de alto", () => {
    expect(CSS).toMatch(/\.resumen\s*\{[^}]*min-block-size:\s*var\(--toque-min\)/);
  });
});

describe("el revisor de CSS: control negativo (lo que debe señalar)", () => {
  it.each([
    ["un color con #", ".a { color: #333; }"],
    ["un color de seis cifras", ".a { background: #333333; }"],
    ["un color de ocho cifras", ".a { background: #33333388; }"],
    ["rgb()", ".a { background: rgb(0 0 0); }"],
    ["rgba()", ".a { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }"],
    ["hsl()", ".a { color: hsl(10 20% 30%); }"],
    ["un degradado", ".a { background: linear-gradient(var(--bg), var(--surface)); }"],
    ["un degradado radial", ".a { background-image: radial-gradient(var(--bg), var(--surface)); }"],
    ["texto de 13px", ".a { font-size: 13px; }"],
    ["texto de 11px", ".a{font-size:11px}"],
    ["texto en rem", ".a { font-size: 1rem; }"],
    ["texto en em", ".a { font-size: 0.8em; }"],
    ["texto con una palabra", ".a { font-size: small; }"],
    ["el font abreviado", ".a { font: 13px sans-serif; }"],
    ["una variable que no existe", ".a { color: var(--inexistente); }"],
    ["una variable que no existe dentro de otra", ".a { padding: var(--e3) var(--e99); }"],
    ["un color con nombre", ".a { color: red; }"],
    ["un fondo con nombre", ".a { background: white; }"],
    ["un borde con un color con nombre", ".a { border: 1px solid black; }"],
    ["--alert como texto", ".a { color: var(--alert); }"],
    ["--warn como texto", ".a { color: var(--warn); }"],
    ["--success como texto", ".a { color: var(--success); }"],
  ])("señala %s", (_nombre, css) => {
    expect(problemasDeCss(css).length).toBeGreaterThan(0);
  });

  it("un CSS que cumple no se señala, y un color o un tamaño en un comentario tampoco", () => {
    expect(
      problemasDeCss(`
        /* antes era #333 y 12px; ahora rgba(0,0,0,.5) viene de los tokens */
        .a { color: var(--text); font-size: 14px; border: 1px solid var(--border); padding: var(--e3) var(--e4); }
        .b { background: var(--surface); box-shadow: var(--sombra-carta); font-size: 15.5px; color: var(--alert-text); }
        .c { font-size: var(--texto-min); border-color: transparent; outline: none; background: none; }
      `),
    ).toEqual([]);
  });

  it("--alert, --warn y --success sí valen de relleno", () => {
    expect(problemasDeCss(".a { background: var(--alert); border-inline-start: 6px solid var(--warn); outline: 2px solid var(--success); }")).toEqual([]);
  });
});
