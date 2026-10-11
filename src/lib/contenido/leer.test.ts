import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dibujarTexto } from "@/components/contenido/dibujar";
import { EJEMPLO_POR_COMANDO, FORMULAS_ANIDADAS } from "../../../pruebas/ejemplos-mate";
import { leerBanco } from "../../../scripts/contenido/banco.mts";
import { COMANDOS_MATE } from "../../../scripts/contenido/matematica.mts";
import { partirEnunciado } from "./enunciado";
import { leerMate } from "./leer";
import { analizarMate, partirMate } from "./mate";

// HU-083: la lectura en español de cada fórmula, que va en el `aria-label` del <math>. Sin ella Chromium no le saca nombre:
// una opción que es solo una fórmula queda sin nombre accesible. La e2e (e2e/texto-del-banco.spec.ts) comprueba el nombre
// que expone el árbol de accesibilidad del navegador; aquí va lo que se puede probar con texto.

const lectura = (fuente: string) => leerMate(analizarMate(fuente));
const completo = (texto: string) => renderToStaticMarkup(dibujarTexto(texto));

/** Cada comando con su ejemplo (pruebas/ejemplos-mate.ts): las lecturas están revisadas a mano. */
const LECTURA_POR_COMANDO: Readonly<Record<string, string>> = {
  frac: "a sobre b",
  sqrt: "raíz cuadrada de x",
  int: "integral de 0 a 1, x",
  iint: "integral doble sobre D, f",
  oint: "integral cerrada sobre C, f",
  sum: "suma de n igual a 1 a infinito, a sub n",
  prod: "producto de k igual a 1 a n, k",
  lim: "límite cuando x tiende a 0, f abre paréntesis x cierra paréntesis",
  left: "abre paréntesis x cierra paréntesis",
  right: "abre corchete x cierra corchete",
  text: "a si b",
  vec: "vector v",
  bar: "x barra",
  hat: "x gorro",
  mathrm: "d x",
  sen: "seno x",
  sin: "seno x",
  cos: "coseno x",
  tan: "tangente x",
  sec: "secante x",
  csc: "cosecante x",
  cot: "cotangente x",
  ln: "logaritmo natural x",
  log: "logaritmo x",
  exp: "exponencial x",
  alpha: "alfa",
  beta: "beta",
  gamma: "gamma",
  delta: "delta",
  epsilon: "épsilon",
  varepsilon: "épsilon",
  theta: "theta",
  lambda: "lambda",
  mu: "mu",
  nu: "nu",
  pi: "pi",
  rho: "rho",
  sigma: "sigma",
  tau: "tau",
  phi: "fi",
  varphi: "fi",
  omega: "omega",
  Delta: "delta mayúscula x",
  Sigma: "sigma mayúscula",
  Omega: "omega mayúscula",
  Gamma: "gamma mayúscula",
  Phi: "fi mayúscula",
  le: "a menor o igual que b",
  leq: "a menor o igual que b",
  ge: "a mayor o igual que b",
  geq: "a mayor o igual que b",
  ne: "a distinto de b",
  neq: "a distinto de b",
  approx: "a aproximadamente igual a b",
  pm: "a más o menos b",
  mp: "a menos o más b",
  to: "x tiende a 0",
  rightarrow: "x tiende a 0",
  infty: "infinito",
  cdot: "a por b",
  times: "a por b",
  div: "a dividido entre b",
  partial: "derivada parcial x",
  nabla: "nabla f",
  ",": "a b",
  ";": "a b",
  quad: "a b",
};

const LECTURA_ANIDADAS: readonly (readonly [string, string])[] = [
  [String.raw`x_{i_j}`, "x sub i sub j"],
  [String.raw`x_{a_{b_{c_d}}}`, "x sub a sub b sub c sub d, fin del subíndice, fin del subíndice"],
  [String.raw`\frac{\frac{1}{2}}{3}`, "fracción con numerador 1 sobre 2 y denominador 3, fin de la fracción"],
  [String.raw`\frac{1}{1 + \frac{1}{1 + \frac{1}{x}}}`, "fracción con numerador 1 y denominador 1 más fracción con numerador 1 y denominador 1 más 1 sobre x, fin de la fracción, fin de la fracción"],
  [String.raw`\sqrt[3]{x^{2}}`, "raíz cúbica de x al cuadrado"],
  [String.raw`\sqrt{\frac{a_n}{b_n}}`, "raíz cuadrada de a sub n sobre b sub n, fin de la raíz"],
  [String.raw`a_{n+1}^{2}`, "a sub n más 1, fin del subíndice al cuadrado"],
  [String.raw`\sum_{n=1}^{\infty}\frac{1}{n^2}`, "suma de n igual a 1 a infinito, 1 sobre n al cuadrado"],
  [String.raw`\int_{a_1}^{b^2} \frac{f(x)}{g_{k}(x)}\,dx`, "integral de a sub 1 a b al cuadrado, fracción con numerador f abre paréntesis x cierra paréntesis y denominador g sub k abre paréntesis x cierra paréntesis, fin de la fracción d x"],
  [String.raw`\lim_{x_0 \to \infty} \frac{\sen^2 x}{x_0^{2}}`, "límite cuando x sub 0 tiende a infinito, fracción con numerador seno al cuadrado x y denominador x sub 0 al cuadrado, fin de la fracción"],
  [String.raw`\left( \frac{a_i}{b_i} \right)^{2}`, "abre paréntesis a sub i sobre b sub i cierra paréntesis al cuadrado"],
  [String.raw`e^{-\frac{x^{2}}{2}}`, "e elevado a menos x al cuadrado sobre 2, fin del exponente"],
];

/** Lo que no debe quedar en una lectura: barras, signos de pesos, llaves, ^ y _, y los símbolos que un lector de pantalla dice mal. */
const SIN_LEER = /[\\${}^_\u0370-\u03ff\u2026\u2070-\u209f\u2190-\u22ff\u00b0\u00b1\u00b2\u00b3\u00b7\u00b9\u00d7\u00f7\u2032\u2212\u2061]/u;
/** Una lectura mal armada: espacios de más o de borde, comas dobles, restos de JavaScript. */
const MAL_ARMADA = /\s{2,}|^\s|\s$|,,|undefined|\[object/;

function formulasDelBanco(): string[] {
  const { banco, errores } = leerBanco(join(__dirname, "../../../contenido"));
  expect(errores, "el banco debe leerse sin errores").toEqual([]);
  const textos: string[] = [];
  for (const materia of banco.materias) {
    for (const tema of materia.temas) {
      for (const h of tema.habilidades) textos.push(h.descripcion);
      for (const m of tema.misconcepciones) textos.push(m.descripcion);
      for (const p of tema.preguntas) {
        textos.push(p.enunciado);
        for (const o of p.opciones) textos.push(o.texto, ...(o.error ? [o.error] : []));
        if (p.solucion) textos.push(p.solucion);
      }
    }
  }
  return textos.flatMap((texto) =>
    partirEnunciado(texto).flatMap((trozo) =>
      trozo.codigo ? [] : partirMate(trozo.texto).filter((parte) => parte.mate && !parte.abierto).map((parte) => parte.texto),
    ),
  );
}

describe("leerMate", () => {
  it("hay una lectura por comando, ni una más ni una menos", () => {
    expect(Object.keys(LECTURA_POR_COMANDO).sort()).toEqual([...COMANDOS_MATE].sort());
  });

  it.each(COMANDOS_MATE.map((comando) => [comando, EJEMPLO_POR_COMANDO[comando]] as const))("\\%s: %s", (comando, ejemplo) => {
    expect(lectura(ejemplo)).toBe(LECTURA_POR_COMANDO[comando]);
  });

  it("las fórmulas anidadas son las de ejemplos-mate.ts, en el mismo orden", () => {
    expect(LECTURA_ANIDADAS.map(([fuente]) => fuente)).toEqual([...FORMULAS_ANIDADAS]);
  });

  it.each(LECTURA_ANIDADAS)("%s", (fuente, esperada) => {
    expect(lectura(fuente)).toBe(esperada);
  });

  it("una fracción corta se dice «a sobre b»; una larga dice dónde empieza y dónde termina", () => {
    expect(lectura(String.raw`\frac{1}{R_{\text{eq}}}`)).toBe("1 sobre R sub eq");
    expect(lectura(String.raw`\frac{1}{2} + 1`)).toBe("1 sobre 2 más 1");
    expect(lectura(String.raw`\frac{a+b}{c}`)).toBe("fracción con numerador a más b y denominador c, fin de la fracción");
    // Sin el cierre, «más 1» parecería parte del denominador.
    expect(lectura(String.raw`\frac{a+b}{c+d} + 1`)).toBe("fracción con numerador a más b y denominador c más d, fin de la fracción más 1");
    expect(lectura(String.raw`\frac{-1}{2}`)).toBe("fracción con numerador menos 1 y denominador 2, fin de la fracción");
  });

  it("raíces, exponentes y subíndices largos llevan su cierre", () => {
    expect(lectura(String.raw`\sqrt{x}`)).toBe("raíz cuadrada de x");
    expect(lectura(String.raw`\sqrt{x+1} + 2`)).toBe("raíz cuadrada de x más 1, fin de la raíz más 2");
    expect(lectura(String.raw`\sqrt[4]{x}`)).toBe("raíz de índice 4 de x");
    expect(lectura("x^2")).toBe("x al cuadrado");
    expect(lectura("x^3")).toBe("x al cubo");
    expect(lectura("x^n")).toBe("x elevado a n");
    expect(lectura("x^{n+1} y")).toBe("x elevado a n más 1, fin del exponente y");
    expect(lectura("x_i^2")).toBe("x sub i al cuadrado");
    expect(lectura("x_{i+1} y")).toBe("x sub i más 1, fin del subíndice y");
  });

  it("los signos y los delimitadores se dicen con palabras", () => {
    expect(lectura("-x")).toBe("menos x");
    expect(lectura("x = -2")).toBe("x igual a menos 2");
    expect(lectura("x < y > z")).toBe("x menor que y mayor que z");
    expect(lectura("n!")).toBe("n factorial");
    expect(lectura("f'(x)")).toBe("f prima abre paréntesis x cierra paréntesis");
    expect(lectura("[a, b]")).toBe("abre corchete a coma b cierra corchete");
    expect(lectura("|x|")).toBe("barra x barra");
    expect(lectura(String.raw`\left| x \right|`)).toBe("abre barra x cierra barra");
    expect(lectura(String.raw`\left. x \right|`)).toBe("x cierra barra");
    expect(lectura("a/b")).toBe("a entre b");
    expect(lectura("0,05")).toBe("0,05");
  });

  it("el Unicode escrito tal cual también se dice (el banco usa ∭ y …)", () => {
    expect(lectura("x² ≤ π")).toBe("x al cuadrado menor o igual que pi");
    expect(lectura("x³ + y₁")).toBe("x al cubo más y sub 1");
    expect(lectura("a⁴")).toBe("a elevado a 4");
    expect(lectura("30°")).toBe("30 grados");
    expect(lectura("a + … + z")).toBe("a más puntos suspensivos más z");
    expect(lectura("∭_V f")).toBe("integral triple sub V f");
    expect(lectura("∞")).toBe("infinito");
    expect(lectura("😀")).toBe("😀");
  });

  it("una integral o una suma dicen sus límites y se separan de lo que sigue", () => {
    expect(lectura(String.raw`\int_0^1 x\,dx`)).toBe("integral de 0 a 1, x d x");
    expect(lectura(String.raw`\int_0^1`)).toBe("integral de 0 a 1");
    expect(lectura(String.raw`\int f`)).toBe("integral f");
    // La coma que separa la integral de lo que sigue y la del cierre del subíndice no se duplican.
    expect(lectura(String.raw`x_{\int_0^1}`)).toBe("x sub integral de 0 a 1, fin del subíndice");
    expect(lectura(String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`)).toBe(
      "suma de i igual a 1 a n, i igual a fracción con numerador n abre paréntesis n más 1 cierra paréntesis y denominador 2, fin de la fracción",
    );
    expect(lectura(String.raw`\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n`)).toBe(
      "límite cuando n tiende a infinito, abre paréntesis 1 más 1 sobre n cierra paréntesis elevado a n",
    );
  });

  it("un \\text se lee sin los espacios de borde; el espacio solo no dice nada", () => {
    expect(lectura(String.raw`x > 0 \text{ y } x < 5`)).toBe("x mayor que 0 y x menor que 5");
    expect(lectura(String.raw`\text{ si } x`)).toBe("si x");
    expect(lectura(String.raw`a\,b`)).toBe("a b");
    expect(lectura(String.raw`\,`)).toBe("");
  });

  it("un nombre que es una clave del objeto no se confunde con una letra", () => {
    expect(lectura(String.raw`\mathrm{constructor}`)).toBe("constructor");
    expect(lectura(String.raw`\mathrm{toString} + \mathrm{__proto__}`)).toBe("toString más __proto__");
  });

  it("ninguna lectura deja un símbolo sin decir: los 67 ejemplos y las anidadas", () => {
    for (const fuente of [...Object.values(EJEMPLO_POR_COMANDO), ...FORMULAS_ANIDADAS]) {
      const dicha = lectura(fuente);
      expect(dicha, fuente).not.toBe("");
      expect(dicha, fuente).not.toMatch(SIN_LEER);
      expect(dicha, fuente).not.toMatch(MAL_ARMADA);
    }
  });

  it("el banco real: cada fórmula tiene lectura y ninguna deja barras, llaves ni símbolos sin decir", () => {
    const formulas = formulasDelBanco();
    expect(formulas.length, "el banco trae fórmulas").toBeGreaterThan(250);
    const malas = formulas.flatMap((fuente) => {
      const dicha = lectura(fuente);
      return dicha === "" || SIN_LEER.test(dicha) || MAL_ARMADA.test(dicha) ? [`${fuente} → «${dicha}»`] : [];
    });
    expect(malas).toEqual([]);
  });
});

describe("el aria-label del <math>", () => {
  it("una fórmula sola lleva su lectura (en HU-009, una opción que es solo una fórmula necesita nombre)", () => {
    expect(completo(String.raw`$\frac{1}{R_{\text{eq}}}$`)).toBe(
      '<span class="texto-banco"><math aria-label="1 sobre R sub eq"><mfrac><mn>1</mn><msub><mi>R</mi><mtext>eq</mtext></msub></mfrac></math></span>',
    );
  });

  it("cada fórmula de una frase lleva la suya, para que el nombre de la opción diga todo", () => {
    const marcado = completo(String.raw`La resistencia vale $\frac{1}{R_{\text{eq}}}$ ohmios y $R_1 + R_2$.`);
    expect(marcado.match(/<math aria-label="[^"]*">/g)).toEqual(['<math aria-label="1 sobre R sub eq">', '<math aria-label="R sub 1 más R sub 2">']);
  });

  it("va escapado: unas comillas en un \\text no rompen el atributo", () => {
    const marcado = completo(String.raw`$\text{di "hola" <b>}$`);
    expect(marcado).toContain('aria-label="di &quot;hola&quot; &lt;b&gt;"');
    expect(marcado).not.toContain("<b>");
  });

  it("una fórmula que no dice nada no lleva aria-label vacío", () => {
    const marcado = completo(String.raw`$\,$`);
    expect(marcado).toContain("<math>");
    expect(marcado).not.toContain("aria-label");
  });

  it("lo que no se entiende se queda como texto, sin <math> ni aria-label", () => {
    expect(completo(String.raw`$\foo$`)).not.toMatch(/<math|aria-label/);
  });
});
