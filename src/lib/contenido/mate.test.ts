import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dibujarTexto } from "@/components/contenido/dibujar";
import { EJEMPLO_POR_COMANDO } from "../../../pruebas/ejemplos-mate";
import { COMANDOS_MATE, revisarMate, tramosMate } from "../../../scripts/contenido/matematica.mts";
import { COMANDOS_DIBUJADOS, ErrorMate, analizarMate, intentarAnalizar, partirMate } from "./mate";

// HU-083: el analizador de fórmulas del banco y su dibujo. Los criterios de pantalla (14 px, apilado, scroll del bloque,
// teclado) necesitan un navegador y los cubre e2e/texto-del-banco.spec.ts; aquí va todo lo que se puede probar con texto.
//
// Los textos con barras se escriben con String.raw: un "\t" o un "\f" normales se comen la barra (es justo el error que
// matematica.mts describe, y lo trae el criterio 1 de backlog/HU-083.md).

/** Lo que sale en la página, con el nombre accesible (`aria-label`) de cada fórmula. */
const completo = (texto: string) => renderToStaticMarkup(dibujarTexto(texto));
/** Lo mismo sin el `aria-label`: aquí interesa la forma del MathML. El nombre lo prueban leer.test.ts y la e2e. */
const html = (texto: string) => completo(texto).replace(/ aria-label="[^"]*"/g, "");
const envuelto = (interior: string) => `<span class="texto-banco">${interior}</span>`;
const aplicar = "\u2061";

/** Lo que React escribe en el HTML para un texto: los cinco caracteres que escapa. */
const escapado = (texto: string) =>
  texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/** El texto que ve una persona: el HTML sin etiquetas y sin escapes. */
const visible = (marcado: string) =>
  marcado
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** `\$` → `$` con la regla de las barras: una barra escapa al carácter que sigue, sea cual sea. */
const sinEscapeDeDolar = (texto: string) => texto.replace(/\\([\s\S])/g, (par, c: string) => (c === "$" ? "$" : par));

function cortesDelConvertidor(texto: string) {
  const { tramos, abierto } = tramosMate(texto);
  return {
    trozos: tramos
      .filter((tramo) => tramo.mate || tramo.texto !== "")
      .map((tramo) => ({ mate: tramo.mate, texto: tramo.mate ? tramo.texto : sinEscapeDeDolar(tramo.texto) })),
    abierto,
  };
}

function cortesDelDibujo(texto: string) {
  const trozos = partirMate(texto);
  return { trozos: trozos.map(({ mate, texto: t }) => ({ mate, texto: t })), abierto: trozos.some((trozo) => trozo.abierto) };
}

describe("partirMate", () => {
  const casos: [string, string, { mate: boolean; texto: string; abierto?: true }[]][] = [
    ["una fórmula sola", String.raw`$\frac{1}{R_{\text{eq}}}$`, [{ mate: true, texto: String.raw`\frac{1}{R_{\text{eq}}}` }]],
    [
      "un \\$ y una fórmula",
      String.raw`cuesta \$5 y $x$`,
      [
        { mate: false, texto: "cuesta $5 y " },
        { mate: true, texto: "x" },
      ],
    ],
    ["un \\$ sin fórmulas", String.raw`cuesta \$5 hoy`, [{ mate: false, texto: "cuesta $5 hoy" }]],
    [
      "una fórmula y un \\$",
      String.raw`$x$ y \$5`,
      [
        { mate: true, texto: "x" },
        { mate: false, texto: " y $5" },
      ],
    ],
    ["un \\$ dentro de una fórmula queda crudo", String.raw`$\$$`, [{ mate: true, texto: String.raw`\$` }]],
    ["$$ es una fórmula vacía", "$$", [{ mate: true, texto: "" }]],
    ["un $ que no se cierra", "$x", [{ mate: true, texto: "x", abierto: true }]],
    [
      "un $ al final",
      "x$",
      [
        { mate: false, texto: "x" },
        { mate: true, texto: "", abierto: true },
      ],
    ],
    ["un \\$ solo", String.raw`\$`, [{ mate: false, texto: "$" }]],
    [
      "otras barras fuera de fórmula quedan literales",
      String.raw`ruta C:\temp $x$`,
      [
        { mate: false, texto: String.raw`ruta C:\temp ` },
        { mate: true, texto: "x" },
      ],
    ],
    ["una barra al final", "fin\\", [{ mate: false, texto: "fin\\" }]],
    // La divergencia con el prototipo: una barra doble antes de $ no lo escapa.
    [
      "barra doble antes de $ (abre fórmula)",
      String.raw`a\\$5$`,
      [
        { mate: false, texto: String.raw`a\\` },
        { mate: true, texto: "5" },
      ],
    ],
    [
      "barra doble y fórmula con texto detrás",
      String.raw`a\\$x$ b`,
      [
        { mate: false, texto: String.raw`a\\` },
        { mate: true, texto: "x" },
        { mate: false, texto: " b" },
      ],
    ],
    [
      "barra doble dentro de una fórmula la cierra",
      String.raw`$a\\$ b`,
      [
        { mate: true, texto: String.raw`a\\` },
        { mate: false, texto: " b" },
      ],
    ],
  ];

  it.each(casos)("%s", (_nombre, texto, esperado) => {
    expect(partirMate(texto)).toEqual(esperado);
  });

  it("corta en los mismos puntos que tramosMate, el validador del banco", () => {
    for (const [, texto] of casos) {
      expect(cortesDelDibujo(texto), texto).toEqual(cortesDelConvertidor(texto));
    }
    const mas = ["", "sin pesos", "$", "$$$", "$a$$b$", String.raw`\\\$`, String.raw`$\\\$x$`, "a$b$c$d", "\\", "ñ $é$ ü"];
    for (const texto of mas) {
      expect(cortesDelDibujo(texto), texto).toEqual(cortesDelConvertidor(texto));
    }
  });
});

describe("comandos (criterio 2)", () => {
  it("el dibujo entiende exactamente los comandos que el convertidor deja pasar", () => {
    const dibujo = new Set(COMANDOS_DIBUJADOS);
    const convertidor = new Set(COMANDOS_MATE);
    const deMas = [...dibujo].filter((c) => !convertidor.has(c));
    const deMenos = [...convertidor].filter((c) => !dibujo.has(c));
    expect(deMas, `en el dibujo y no en el convertidor: ${deMas.join(" ")}`).toEqual([]);
    expect(deMenos, `en el convertidor y no en el dibujo: ${deMenos.join(" ")}`).toEqual([]);
    expect(COMANDOS_DIBUJADOS.length, "sin comandos repetidos").toBe(dibujo.size);
    expect(dibujo.size).toBe(67);
  });

  it("hay un ejemplo por comando, ni uno más ni uno menos", () => {
    expect(Object.keys(EJEMPLO_POR_COMANDO).sort()).toEqual([...COMANDOS_MATE].sort());
  });

  describe.each(COMANDOS_MATE.map((comando) => [comando, EJEMPLO_POR_COMANDO[comando]] as const))("\\%s", (comando, ejemplo) => {
    it("el ejemplo lleva el comando, el convertidor lo acepta y el dibujo no deja nada sin convertir", () => {
      // Una barra seguida del nombre sin una letra pegada detrás: `\int` no cuenta dentro de `\iint`, ni `\le` dentro de `\leq`.
      const nombre = comando.replace(/[^A-Za-z]/g, (c) => `\\${c}`);
      const lleva = new RegExp(`\\\\${nombre}${/^[A-Za-z]/.test(comando) ? "(?![A-Za-z])" : ""}`);
      expect(ejemplo, `el ejemplo de \\${comando}`).toMatch(lleva);
      expect(revisarMate(`$${ejemplo}$`)).toEqual([]);
      expect(intentarAnalizar(ejemplo), ejemplo).toMatchObject({ ok: true });
      // Con el nombre accesible incluido: tampoco ahí puede quedar nada sin convertir.
      const dibujado = completo(`$${ejemplo}$`);
      expect(dibujado).toContain("<math");
      expect(dibujado).not.toMatch(/[\\${}]/);
    });
  });
});

describe("lo que el convertidor rechaza, el dibujo también", () => {
  // Comandos de TeX que no están en la lista. Se prueban solos y con un argumento, porque una rama escondida en el analizador
  // podría atenderlos solo en uno de los dos casos.
  const FUERA_DE_LA_LISTA = String.raw`chi eta psi xi zeta kappa iota upsilon Lambda Pi Psi Theta Xi Upsilon cdots ldots dots vdots ddots binom over atop
    choose mathbb mathcal mathbf mathit mathsf mathtt boldsymbol textbf textit operatorname overline underline overbrace
    underbrace widehat widetilde tilde dot ddot check breve acute grave dfrac tfrac cfrac limsup liminf max min sup inf
    arcsin arccos arctan sinh cosh tanh coth arg det dim ker gcd deg hom Pr equiv sim simeq cong propto subset supset
    subseteq cup cap emptyset varnothing in notin ni forall exists neg land lor wedge vee oplus otimes Rightarrow Leftarrow
    leftarrow Leftrightarrow leftrightarrow mapsto uparrow downarrow implies iff hbar ell Re Im aleph prime angle perp
    parallel langle rangle lfloor rfloor lceil rceil big Big bigg Bigg displaystyle textstyle limits nolimits sqrtn
    ll gg bullet circ star ast dagger therefore because lbrace rbrace constructor toString valueOf hasOwnProperty`
    .split(/\s+/);

  it("la lista de prueba no se cuela en COMANDOS_MATE por error", () => {
    expect(FUERA_DE_LA_LISTA.length).toBeGreaterThan(110);
    expect(FUERA_DE_LA_LISTA.filter((c) => COMANDOS_MATE.includes(c))).toEqual([]);
  });

  it.each(FUERA_DE_LA_LISTA)("\\%s: el convertidor lo marca y el dibujo lanza", (comando) => {
    for (const fuente of [`\\${comando}`, `\\${comando}{x}`, `a + \\${comando} b`]) {
      expect(revisarMate(`$${fuente}$`), fuente).not.toEqual([]);
      expect(() => analizarMate(fuente), fuente).toThrow(ErrorMate);
    }
  });

  it("también los comandos de un solo símbolo y las llaves escapadas", () => {
    for (const fuente of String.raw`\{ \} \% \& \# \_ \| \\ \! \: \> \< \~ \^ \" \'`.split(" ")) {
      expect(revisarMate(`$${fuente}$`), fuente).not.toEqual([]);
      expect(() => analizarMate(fuente), fuente).toThrow(ErrorMate);
    }
  });

  // (a) estructura rota que el convertidor marca: el dibujo también la rechaza.
  it.each([
    String.raw`\right)`,
    String.raw`\left( x`,
    "{x",
    "x}",
    String.raw`\text{a`,
    String.raw`\mathrm{a`,
    String.raw`\frac{1}{2`,
  ])("estructura rota que el convertidor marca: %s", (fuente) => {
    expect(revisarMate(`$${fuente}$`)).not.toEqual([]);
    expect(() => analizarMate(fuente)).toThrow(ErrorMate);
  });

  // (b) estructura rota que el convertidor deja pasar (brecha de HU-005): el dibujo la rechaza. Aquí no se afirma qué
  // devuelve revisarMate: si alguien cierra esa brecha, esta prueba no debe romperse por eso.
  it.each([
    "x^",
    "x_",
    "x^2^3",
    "x_1_2",
    String.raw`\frac{1}`,
    String.raw`\frac12`,
    String.raw`\sqrt`,
    String.raw`\sqrt[3]`,
    String.raw`\vec`,
    String.raw`\text`,
  ])("estructura rota que el convertidor deja pasar: %s", (fuente) => {
    expect(() => analizarMate(fuente)).toThrow(ErrorMate);
    expect(visible(html(`$${fuente}$`))).toBe(`$${fuente}$`);
    expect(html(`$${fuente}$`)).not.toContain("<math");
  });

  // (c) caracteres y delimitadores que el convertidor acepta y el dibujo no.
  it.each([
    "50%",
    "a & b",
    "#1",
    "a ~ b",
    "¿x?",
    "a@b",
    'a"b',
    "a`b",
    String.raw`\left< x \right>`,
    String.raw`\left\{ x \right\}`,
    String.raw`\left( x \right>`,
  ])("carácter o delimitador que el dibujo no entiende: %s", (fuente) => {
    expect(() => analizarMate(fuente)).toThrow(ErrorMate);
    expect(visible(html(`$${fuente}$`))).toBe(`$${fuente}$`);
  });
});

describe("el dibujo no falla nunca (criterio 4)", () => {
  const profundo = (abre: string, cierra: string, veces: number) => `$${abre.repeat(veces)}x${cierra.repeat(veces)}$`;
  const textos = [
    String.raw`$\foo$`,
    String.raw`$\frac{1}{$`,
    "$ {{{ $",
    "$ $",
    "$$",
    "${}$",
    "$ { } $",
    "${{}}$",
    "${}{}$",
    "$" + "{".repeat(20_000) + "$",
    "$" + "{".repeat(20_000),
    profundo("{", "}", 20_000),
    profundo(String.raw`\vec`, "", 5_000),
    profundo(String.raw`\frac{`, "}{1}", 5_000),
    profundo("x^{", "}", 5_000),
    profundo(String.raw`\sqrt[`, "]{1}", 5_000),
    profundo(String.raw`\left(`, String.raw`\right)`, 5_000),
    "$" + String.raw`\left(`.repeat(3_000) + "$",
    "cuesta $5",
    "$",
    "$$$",
    "$\\",
    "$\u0000$",
  ];

  it.each(textos.map((t) => [t.length > 60 ? `${t.slice(0, 40)}… (${t.length} caracteres)` : t, t] as const))("%s", (_nombre, texto) => {
    let marcado = "";
    expect(() => {
      marcado = html(texto);
    }).not.toThrow();
    expect(marcado).not.toContain("<math");
  });

  it("devuelve el texto original, sin marca", () => {
    for (const texto of [String.raw`$\foo$`, "$ $", "${}$", "cuesta $5", String.raw`a $\frac{1}{$ b`, "$" + "{".repeat(20_000) + "$"]) {
      expect(html(texto), texto.slice(0, 40)).toBe(envuelto(escapado(texto)));
    }
  });

  it("intentarAnalizar atrapa todo, no solo ErrorMate", () => {
    expect(intentarAnalizar(undefined as unknown as string)).toMatchObject({ ok: false });
    expect(intentarAnalizar(null as unknown as string)).toMatchObject({ ok: false });
    expect(intentarAnalizar(String.raw`\foo`)).toMatchObject({ ok: false, motivo: expect.stringContaining("comando desconocido") });
  });

  it("una fórmula vacía o que no dibuja nada no se entiende, pero \\frac{}{} sigue dibujando", () => {
    for (const fuente of ["", " ", "{}", "{ }", "{{}}", "{}{}", " { } { } "]) {
      expect(() => analizarMate(fuente), JSON.stringify(fuente)).toThrow(ErrorMate);
    }
    for (const fuente of [String.raw`\frac{}{}`, String.raw`\sqrt{}`, "x^{}", "{}x"]) {
      expect(intentarAnalizar(fuente), fuente).toMatchObject({ ok: true });
    }
  });

  it("acepta fórmulas anidadas de verdad y rechaza el abuso por su tope", () => {
    const anidada = (veces: number) => `${"x_{".repeat(veces)}y${"}".repeat(veces)}`;
    expect(intentarAnalizar(anidada(40))).toMatchObject({ ok: true });
    expect(intentarAnalizar(anidada(250))).toMatchObject({ ok: false, motivo: expect.stringContaining("demasiado anidada") });
  });
});

describe("dorados: el MathML que dibuja el prototipo", () => {
  // Las cadenas salen del prototipo (index.html, matematica()) y van dentro del envoltorio del componente.
  const dorados: [string, string][] = [
    [String.raw`$\frac{1}{R_{\text{eq}}}$`, "<math><mfrac><mn>1</mn><msub><mi>R</mi><mtext>eq</mtext></msub></mfrac></math>"],
    ["$x^2$", "<math><msup><mi>x</mi><mn>2</mn></msup></math>"],
    [String.raw`$\sqrt[3]{x}$`, "<math><mroot><mi>x</mi><mn>3</mn></mroot></math>"],
    [String.raw`$\vec{v}$`, '<math><mover accent="true"><mi>v</mi><mo>→</mo></mover></math>'],
    [
      String.raw`$\sum_{n=1}^{\infty} a_n$`,
      '<math><munderover><mo movablelimits="true">∑</mo><mrow><mi>n</mi><mo>=</mo><mn>1</mn></mrow><mi>∞</mi></munderover><msub><mi>a</mi><mi>n</mi></msub></math>',
    ],
    [
      String.raw`$\left(a+b\right)$`,
      '<math><mrow><mo stretchy="true" fence="true">(</mo><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mo stretchy="true" fence="true">)</mo></mrow></math>',
    ],
    [
      String.raw`$\lim_{x\to 0} \frac{\sen x}{x}$`,
      `<math><munder><mo movablelimits="true">lim</mo><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder><mfrac><mrow><mi mathvariant="normal">sen</mi><mo lspace="0" rspace="0.1667em">${aplicar}</mo><mi>x</mi></mrow><mi>x</mi></mfrac></math>`,
    ],
    [
      String.raw`$\int_0^{\pi/2} \sen^2 x \cos x\,dx$`,
      `<math><msubsup><mo>∫</mo><mn>0</mn><mrow><mi>π</mi><mo lspace="0" rspace="0">/</mo><mn>2</mn></mrow></msubsup><mspace width="0.1667em"></mspace><msup><mi mathvariant="normal">sen</mi><mn>2</mn></msup><mo lspace="0" rspace="0.1667em">${aplicar}</mo><mi>x</mi><mspace width="0.1667em"></mspace><mi mathvariant="normal">cos</mi><mo lspace="0" rspace="0.1667em">${aplicar}</mo><mi>x</mi><mspace width="0.1667em"></mspace><mi>d</mi><mi>x</mi></math>`,
    ],
    [String.raw`cuesta \$5 y $x$`, "cuesta $5 y <math><mi>x</mi></math>"],
    [String.raw`$\$$`, "<math><mo>$</mo></math>"],
    // El prototipo estira todo `mo` hijo directo de \left … \right, incluido un cuerpo suelto. Se conserva a propósito.
    [
      String.raw`$\left( + \right)$`,
      '<math><mrow><mo stretchy="true" fence="true">(</mo><mo stretchy="true" fence="true">+</mo><mo stretchy="true" fence="true">)</mo></mrow></math>',
    ],
    // Divergencia declarada: el prototipo deja <mtext>cuesta \$5</mtext>.
    [String.raw`$\text{cuesta \$5}$`, "<math><mtext>cuesta $5</mtext></math>"],
  ];

  it.each(dorados)("%s", (texto, mathml) => {
    expect(html(texto)).toBe(envuelto(mathml));
  });
});

describe("comportamiento", () => {
  const dibuja = (fuente: string) => html(`$${fuente}$`).replace(/^<span class="texto-banco">|<\/span>$/g, "");

  it("0,05 es un solo número y «a, b» no", () => {
    expect(dibuja("0,05")).toBe("<math><mn>0,05</mn></math>");
    expect(dibuja("3.14")).toBe("<math><mn>3.14</mn></math>");
    expect(dibuja("a, b")).toBe("<math><mi>a</mi><mo>,</mo><mi>b</mi></math>");
    expect(dibuja("1,x")).toBe("<math><mn>1</mn><mo>,</mo><mi>x</mi></math>");
  });

  it("deja pasar Unicode escrito tal cual", () => {
    expect(dibuja("x² ≤ π")).toBe("<math><mi>x</mi><mn>²</mn><mo>≤</mo><mi>π</mi></math>");
    expect(dibuja("😀")).toBe("<math><mo>😀</mo></math>");
  });

  it("convierte - en − y ' en ′", () => {
    expect(dibuja("-x'")).toBe("<math><mo>−</mo><mi>x</mi><mo>′</mo></math>");
  });

  it("\\left. deja un delimitador vacío", () => {
    expect(dibuja(String.raw`\left. x \right|`)).toBe('<math><mrow><mi>x</mi><mo stretchy="true" fence="true">|</mo></mrow></math>');
    expect(dibuja(String.raw`\left( x \right.`)).toBe('<math><mrow><mo stretchy="true" fence="true">(</mo><mi>x</mi></mrow></math>');
  });

  it("\\mathrm, subíndices anidados y fracciones anidadas", () => {
    expect(dibuja(String.raw`\mathrm{d}x`)).toBe('<math><mi mathvariant="normal">d</mi><mi>x</mi></math>');
    expect(dibuja(String.raw`x_{i_j}`)).toBe("<math><msub><mi>x</mi><msub><mi>i</mi><mi>j</mi></msub></msub></math>");
    expect(dibuja(String.raw`\frac{\frac{1}{2}}{3}`)).toBe("<math><mfrac><mfrac><mn>1</mn><mn>2</mn></mfrac><mn>3</mn></mfrac></math>");
  });

  it("una letra griega mayúscula va derecha y la minúscula en cursiva", () => {
    expect(dibuja(String.raw`\Delta \delta`)).toBe('<math><mi mathvariant="normal">Δ</mi><mi>δ</mi></math>');
  });

  it("el árbol de un \\text conserva sus espacios; el dibujo pone espacio duro en los de borde", () => {
    expect(analizarMate(String.raw`\text{ si }x`)).toEqual({
      t: "fila",
      c: [
        { t: "texto", v: " si " },
        { t: "id", v: "x" },
      ],
    });
    // Chromium recorta los espacios de borde de un <mtext>: sin U+00A0 «x > 0 \text{ y } x < 5» sale como «x>0yx<5».
    expect(dibuja(String.raw`\text{ y }`)).toBe("<math><mtext>\u00a0y\u00a0</mtext></math>");
    expect(dibuja(String.raw`\text{si }x`)).toBe("<math><mtext>si\u00a0</mtext><mi>x</mi></math>");
    expect(dibuja(String.raw`x > 0 \text{ y } x < 5`)).toContain("<mo>&gt;</mo><mn>0</mn><mtext>\u00a0y\u00a0</mtext><mi>x</mi>");
    // Cada espacio de borde cuenta; los de en medio y los de un \text sin espacios en el borde no se tocan.
    expect(dibuja(String.raw`\text{  y  }`)).toBe("<math><mtext>\u00a0\u00a0y\u00a0\u00a0</mtext></math>");
    expect(dibuja(String.raw`\text{a  b}`)).toBe("<math><mtext>a  b</mtext></math>");
    expect(dibuja(String.raw`\text{si}`)).toBe("<math><mtext>si</mtext></math>");
    // Un \text que es solo un espacio se ve como un hueco.
    expect(dibuja(String.raw`a \text{ } b`)).toBe("<math><mi>a</mi><mtext>\u00a0</mtext><mi>b</mi></math>");
  });

  it("\\$ dentro de \\text y \\mathrm sale $, sin barra (cambio 3 del archivo mate.ts)", () => {
    expect(dibuja(String.raw`\text{cuesta \$5}`)).toBe("<math><mtext>cuesta $5</mtext></math>");
    expect(dibuja(String.raw`\mathrm{\$}x`)).toBe('<math><mi mathvariant="normal">$</mi><mi>x</mi></math>');
    expect(dibuja(String.raw`\text{a\\b}`)).toBe(String.raw`<math><mtext>a\\b</mtext></math>`);
  });

  it("\\mathrm{\\Delta} deja \\Delta sin convertir: limitación conocida", () => {
    expect(dibuja(String.raw`\mathrm{\Delta}x`)).toBe(String.raw`<math><mi mathvariant="normal">\Delta</mi><mi>x</mi></math>`);
  });

  it("la función lleva el espacio fino delante (salvo tras un operador o al abrir) y la aplicación invisible detrás", () => {
    expect(dibuja(String.raw`x \cos x`)).toBe(
      `<math><mi>x</mi><mspace width="0.1667em"></mspace><mi mathvariant="normal">cos</mi><mo lspace="0" rspace="0.1667em">${aplicar}</mo><mi>x</mi></math>`,
    );
    expect(dibuja(String.raw`1 + \cos x`)).toBe(
      `<math><mn>1</mn><mo>+</mo><mi mathvariant="normal">cos</mi><mo lspace="0" rspace="0.1667em">${aplicar}</mo><mi>x</mi></math>`,
    );
    expect(dibuja(String.raw`(a) \ln b`)).toContain('<mo stretchy="false">)</mo><mspace width="0.1667em"></mspace><mi mathvariant="normal">ln</mi>');
  });

  it("los paréntesis sueltos no se estiran y la barra de división va pegada", () => {
    expect(dibuja("(a)/b")).toBe(
      '<math><mo stretchy="false">(</mo><mi>a</mi><mo stretchy="false">)</mo><mo lspace="0" rspace="0">/</mo><mi>b</mi></math>',
    );
  });

  it("el texto hostil sale escapado", () => {
    // Dentro de una fórmula los < y > son operadores y cada letra su propio <mi>: lo que importa es que ninguna etiqueta del
    // banco llegue al HTML como etiqueta.
    const formula = html("$<script>alert(1)</script>$");
    expect(formula).not.toMatch(/<\/?script|<img/);
    expect(formula).toContain("<mo>&lt;</mo>");
    expect(formula).toContain("<mo>&gt;</mo>");
    expect(visible(formula)).toBe("<script>alert(1)</script>");
    expect(html("<img src=x onerror=alert(1)>")).toBe(envuelto("&lt;img src=x onerror=alert(1)&gt;"));
    expect(html("```\n<script>alert(1)</script>\n```")).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("forma de los operadores: el signo de un número y las barras", () => {
  // MathML decide si un `mo` es prefijo, infijo o sufijo por su lugar en la fila, y el infijo lleva 0,22 a 0,28 em de hueco a
  // cada lado. TeX decide por lo que lo rodea. Lo que cambia el hueco lo mide e2e/texto-del-banco.spec.ts en un navegador; aquí
  // se fija qué `mo` pide qué forma.
  const dibuja = (fuente: string) => html(`$${fuente}$`).replace(/^<span class="texto-banco">|<\/span>$/g, "");
  const menos = '<mo form="prefix">−</mo>';
  const barraQueAbre = '<mo stretchy="false" form="prefix">|</mo>';
  const barraQueCierra = '<mo stretchy="false" form="postfix">|</mo>';
  const barra = '<mo stretchy="false">|</mo>';

  describe("un signo tras un operador, una relación o un delimitador que abre es el signo de un número (prefijo)", () => {
    const casos: [string, string][] = [
      ["x = -2", `<math><mi>x</mi><mo>=</mo>${menos}<mn>2</mn></math>`],
      ["(-1)^n", `<math><mo stretchy="false">(</mo>${menos}<mn>1</mn><msup><mo stretchy="false">)</mo><mi>n</mi></msup></math>`],
      ["f(-x)", `<math><mi>f</mi><mo stretchy="false">(</mo>${menos}<mi>x</mi><mo stretchy="false">)</mo></math>`],
      // Con un espacio después de la coma: «1,1» es un solo número (0,05).
      ["[-1, 1]", `<math><mo stretchy="false">[</mo>${menos}<mn>1</mn><mo>,</mo><mn>1</mn><mo stretchy="false">]</mo></math>`],
      [String.raw`x \to -\infty`, `<math><mi>x</mi><mo>→</mo>${menos}<mi>∞</mi></math>`],
      [String.raw`x \le -1`, `<math><mi>x</mi><mo>≤</mo>${menos}<mn>1</mn></math>`],
      ["a + -b", `<math><mi>a</mi><mo>+</mo>${menos}<mi>b</mi></math>`],
      ["a - -b", `<math><mi>a</mi><mo>−</mo>${menos}<mi>b</mi></math>`],
      [
        String.raw`\frac{dy}{dt} = -\frac{3}{2}`,
        `<math><mfrac><mrow><mi>d</mi><mi>y</mi></mrow><mrow><mi>d</mi><mi>t</mi></mrow></mfrac><mo>=</mo>${menos}<mfrac><mn>3</mn><mn>2</mn></mfrac></math>`,
      ],
      [
        String.raw`\lim_{x\to-\infty} \frac{3x-1}{\sqrt{x^2+5}}`,
        `<math><munder><mo movablelimits="true">lim</mo><mrow><mi>x</mi><mo>→</mo>${menos}<mi>∞</mi></mrow></munder>` +
          "<mfrac><mrow><mn>3</mn><mi>x</mi><mo>−</mo><mn>1</mn></mrow><msqrt><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>5</mn></mrow></msqrt></mfrac></math>",
      ],
      [String.raw`x = \pm 2`, '<math><mi>x</mi><mo>=</mo><mo form="prefix">±</mo><mn>2</mn></math>'],
      ["x = +3", '<math><mi>x</mi><mo>=</mo><mo form="prefix">+</mo><mn>3</mn></math>'],
      // Un espacio no cuenta: el signo sigue pegado a su número, también si el espacio abre la fila.
      [String.raw`x = \, -2`, `<math><mi>x</mi><mo>=</mo><mspace width="0.1667em"></mspace>${menos}<mn>2</mn></math>`],
      [String.raw`\, -x`, `<math><mspace width="0.1667em"></mspace>${menos}<mi>x</mi></math>`],
      // Tras una barra que abre sí; tras una que cierra, no.
      ["|-x|", `<math>${barra}${menos}<mi>x</mi>${barra}</math>`],
    ];
    it.each(casos)("%s", (fuente, esperado) => {
      expect(dibuja(fuente)).toBe(esperado);
    });

    it("tras una función o un operador grande también", () => {
      expect(dibuja(String.raw`\sin -x`)).toBe(
        `<math><mi mathvariant="normal">sin</mi><mo lspace="0" rspace="0.1667em">${aplicar}</mo>${menos}<mi>x</mi></math>`,
      );
      expect(dibuja(String.raw`\sum_{n=1}^{3} -a_n`)).toContain(`</munderover>${menos}<msub><mi>a</mi><mi>n</mi></msub>`);
      expect(dibuja(String.raw`\int_0^1 -x\,dx`)).toContain(`</msubsup>${menos}<mi>x</mi>`);
    });
  });

  describe("al principio de la fila el navegador ya lo infiere: no se pide nada", () => {
    it.each([
      ["-x", "<math><mo>−</mo><mi>x</mi></math>"],
      ["x^{-2}", "<math><msup><mi>x</mi><mrow><mo>−</mo><mn>2</mn></mrow></msup></math>"],
      ["e^{-x}", "<math><msup><mi>e</mi><mrow><mo>−</mo><mi>x</mi></mrow></msup></math>"],
      ["a_{-1}", "<math><msub><mi>a</mi><mrow><mo>−</mo><mn>1</mn></mrow></msub></math>"],
      [String.raw`\left( -x \right)`, '<math><mrow><mo stretchy="true" fence="true">(</mo><mrow><mo>−</mo><mi>x</mi></mrow><mo stretchy="true" fence="true">)</mo></mrow></math>'],
    ])("%s", (fuente, esperado) => {
      expect(dibuja(fuente)).toBe(esperado);
    });
  });

  describe("un signo tras un valor resta: infijo, sin forma", () => {
    it.each([
      "a - b",
      "(a) - b",
      "[a] - b",
      "x^2 - 1",
      "n! - 1",
      "f'(x) - 1",
      "2 - 3",
      "a_n - 1",
      String.raw`\sqrt{x} - 1`,
      String.raw`\frac{1}{2} - 1`,
      String.raw`\bar{x} - 1`,
      String.raw`\left( a \right) - b`,
      String.raw`\left| x \right| - 1`,
      String.raw`x \cos x - 1`,
      String.raw`a \pm b`,
      String.raw`a \mp b`,
      "a + b",
      String.raw`x \, - y`,
      // Detrás de una barra que cierra.
      "|a| - 1",
      "|a| + |b|",
    ])("%s", (fuente) => {
      // Las barras de la lista sí llevan forma; el signo (`<mo form=...>`) no.
      expect(dibuja(fuente)).not.toContain("<mo form=");
    });

    it("la resta de la fórmula del criterio sigue siendo infijo", () => {
      expect(dibuja("3x-1")).toBe("<math><mn>3</mn><mi>x</mi><mo>−</mo><mn>1</mn></math>");
    });
  });

  describe("las barras sueltas se emparejan dentro de la fila", () => {
    it("la de en medio abre, la siguiente cierra y el signo que sigue resta", () => {
      expect(dibuja("g(x)=|f(x-1)|-2")).toBe(
        '<math><mi>g</mi><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo><mo>=</mo>' +
          `${barraQueAbre}<mi>f</mi><mo stretchy="false">(</mo><mi>x</mi><mo>−</mo><mn>1</mn><mo stretchy="false">)</mo>${barraQueCierra}` +
          "<mo>−</mo><mn>2</mn></math>",
      );
    });

    it("dos parejas seguidas y una función detrás, con su espacio fino", () => {
      expect(dibuja(String.raw`|\vec{a}||\vec{b}|\cos\theta`)).toBe(
        `<math>${barra}<mover accent="true"><mi>a</mi><mo>→</mo></mover>${barraQueCierra}` +
          `${barraQueAbre}<mover accent="true"><mi>b</mi><mo>→</mo></mover>${barraQueCierra}` +
          `<mspace width="0.1667em"></mspace><mi mathvariant="normal">cos</mi><mo lspace="0" rspace="0.1667em">${aplicar}</mo><mi>θ</mi></math>`,
      );
    });

    it("una barra que abre pega lo que sigue; una función tras ella no lleva espacio", () => {
      expect(dibuja(String.raw`(x-2)\,|x-2|`)).toBe(
        '<math><mo stretchy="false">(</mo><mi>x</mi><mo>−</mo><mn>2</mn><mo stretchy="false">)</mo><mspace width="0.1667em"></mspace>' +
          `${barraQueAbre}<mi>x</mi><mo>−</mo><mn>2</mn>${barra}</math>`,
      );
      expect(dibuja(String.raw`a |\sin x|`)).toContain(`${barraQueAbre}<mi mathvariant="normal">sin</mi>`);
    });

    it("al principio y al final de la fila el navegador ya las infiere: sin forma, como en el prototipo", () => {
      expect(dibuja("|x|")).toBe(`<math>${barra}<mi>x</mi>${barra}</math>`);
      expect(dibuja(String.raw`\frac{|a|}{|b|}`)).toBe(
        `<math><mfrac><mrow>${barra}<mi>a</mi>${barra}</mrow><mrow>${barra}<mi>b</mi>${barra}</mrow></mfrac></math>`,
      );
    });

    it("una barra sin pareja se queda como está", () => {
      expect(dibuja("a | b")).toBe(`<math><mi>a</mi>${barra}<mi>b</mi></math>`);
      expect(dibuja("|a| b |")).toBe(`<math>${barra}<mi>a</mi>${barraQueCierra}<mi>b</mi>${barra}</math>`);
    });

    it("las barras de una fila no se emparejan con las de otra", () => {
      // Una barra dentro de un grupo y otra fuera: cada fila cuenta las suyas, y las dos quedan sin pareja.
      expect(dibuja("x_{|a} + |b")).not.toContain("form=");
    });
  });
});
