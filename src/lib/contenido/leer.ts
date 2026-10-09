// La lectura en español de una fórmula (HU-083): el texto que va en el `aria-label` de cada `<math>`.
//
// Chromium no saca nombre accesible de un <math>: una opción que es solo una fórmula queda sin nombre, y dentro de una frase la
// fórmula desaparece del nombre («La resistencia vale ohmios»). Medido con el árbol de accesibilidad de Chromium (CDP) y con
// axe-core. Con este texto el radio, el botón o el título recuperan su nombre completo. Sirve para lo que el árbol de
// accesibilidad expone, no para pantalla: lo que se ve sigue siendo el MathML.
//
// El prototipo tiene `textoPlano` (Unicode: «1/R_(eq)»), pensado para un <option> y para guardar texto. Aquí se prefieren
// palabras, porque un lector de pantalla salta los signos de puntuación y no siempre dice «≤» o «∞» igual.
//
// Código puro, sin React ni DOM. Una fórmula que el analizador no entiende no llega aquí: se muestra como texto.
import type { NodoMate } from "./mate";

/** Cómo se dice cada signo del árbol. Lo que no esté aquí se deja tal cual. */
const SIGNOS: Readonly<Record<string, string>> = {
  "+": "más",
  "−": "menos",
  "=": "igual a",
  "<": "menor que",
  ">": "mayor que",
  "≤": "menor o igual que",
  "≥": "mayor o igual que",
  "≠": "distinto de",
  "≈": "aproximadamente igual a",
  "±": "más o menos",
  "∓": "menos o más",
  "→": "tiende a",
  "·": "por",
  "×": "por",
  "÷": "dividido entre",
  "*": "por",
  "/": "entre",
  "!": "factorial",
  "′": "prima",
  "°": "grados",
  "…": "puntos suspensivos",
  // Unicode escrito tal cual en la fórmula (`∫`, `∞`...): el analizador lo deja pasar como operador.
  "∞": "infinito",
  "∫": "integral",
  "∬": "integral doble",
  "∭": "integral triple",
  "∮": "integral cerrada",
  "∑": "suma",
  "∏": "producto",
  "√": "raíz cuadrada de",
  "∂": "derivada parcial",
  "∇": "nabla",
  ",": "coma",
  ";": "punto y coma",
  ":": "dos puntos",
  ".": "punto",
  "|": "barra",
  "(": "abre paréntesis",
  ")": "cierra paréntesis",
  "[": "abre corchete",
  "]": "cierra corchete",
  $: "pesos",
};

/** Letras y símbolos que el analizador entrega como `id` (los de LETRAS en mate.ts). */
const LETRAS_LEIDAS: Readonly<Record<string, string>> = {
  "α": "alfa",
  "β": "beta",
  "γ": "gamma",
  "δ": "delta",
  "ϵ": "épsilon",
  "ε": "épsilon",
  "θ": "theta",
  "λ": "lambda",
  "μ": "mu",
  "ν": "nu",
  "π": "pi",
  "ρ": "rho",
  "σ": "sigma",
  "τ": "tau",
  "ϕ": "fi",
  "φ": "fi",
  "ω": "omega",
  "∞": "infinito",
  "∂": "derivada parcial",
  "∇": "nabla",
  "Δ": "delta mayúscula",
  "Σ": "sigma mayúscula",
  "Ω": "omega mayúscula",
  "Γ": "gamma mayúscula",
  "Φ": "fi mayúscula",
};

/** Las funciones (`v` es el nombre del comando). */
const FUNCIONES_LEIDAS: Readonly<Record<string, string>> = {
  sen: "seno",
  sin: "seno",
  cos: "coseno",
  tan: "tangente",
  sec: "secante",
  csc: "cosecante",
  cot: "cotangente",
  ln: "logaritmo natural",
  log: "logaritmo",
  exp: "exponencial",
};

/** Los operadores grandes (`v` es el nombre del comando). */
const GRANDES_LEIDOS: Readonly<Record<string, string>> = {
  int: "integral",
  iint: "integral doble",
  oint: "integral cerrada",
  sum: "suma",
  prod: "producto",
  lim: "límite",
};

const DELIMITADORES: Readonly<Record<string, string>> = { "(": "paréntesis", ")": "paréntesis", "[": "corchete", "]": "corchete", "|": "barra" };

const ACENTOS_LEIDOS: Readonly<Record<string, (base: string) => string>> = {
  vec: (base) => `vector ${base}`,
  bar: (base) => `${base} barra`,
  hat: (base) => `${base} gorro`,
};

const SUPERINDICES = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUBINDICES = "₀₁₂₃₄₅₆₇₈₉";

/** Un número, o una cifra escrita como superíndice o subíndice Unicode (`x²`): el analizador la deja pasar como número. */
function leerNumero(v: string): string {
  const arriba = v.length === 1 ? SUPERINDICES.indexOf(v) : -1;
  if (arriba >= 0) return arriba === 2 ? "al cuadrado" : arriba === 3 ? "al cubo" : `elevado a ${arriba}`;
  const abajo = v.length === 1 ? SUBINDICES.indexOf(v) : -1;
  return abajo >= 0 ? `sub ${abajo}` : v;
}

/** Las tablas se consultan con Object.hasOwn: `constructor` no es una letra. */
const buscar = (tabla: Readonly<Record<string, string>>, clave: string): string => (Object.hasOwn(tabla, clave) ? tabla[clave] : clave);

/** Cabe en una palabra o dos, sin que haga falta decir dónde termina: «1 sobre R sub eq», «x al cuadrado sobre 2». */
function esCorto(nodo: NodoMate): boolean {
  const hoja = (n: NodoMate | null) => n === null || n.t === "num" || n.t === "id" || n.t === "texto";
  if (nodo.t === "guion") return hoja(nodo.base) && hoja(nodo.sub) && hoja(nodo.sup);
  return hoja(nodo);
}

/** Lo largo lleva su cierre para que no se confunda con lo que sigue: «raíz cuadrada de x más 1, fin de la raíz». */
const conCierre = (nodo: NodoMate, lectura: string, cierre: string): string => (esCorto(nodo) ? lectura : `${lectura}, ${cierre}`);

function leer(nodo: NodoMate): string {
  switch (nodo.t) {
    case "num":
      return leerNumero(nodo.v);
    case "id":
      return buscar(LETRAS_LEIDAS, nodo.v);
    case "op":
      return buscar(SIGNOS, nodo.v);
    case "fn":
      return buscar(FUNCIONES_LEIDAS, nodo.v);
    case "texto":
      return nodo.v;
    case "espacio":
      return "";
    case "fila":
      return nodo.c.map(leer).filter(Boolean).join(" ");
    case "frac": {
      const arriba = leer(nodo.a);
      const abajo = leer(nodo.b);
      return esCorto(nodo.a) && esCorto(nodo.b)
        ? `${arriba} sobre ${abajo}`
        : `fracción con numerador ${arriba} y denominador ${abajo}, fin de la fracción`;
    }
    case "raiz": {
      const dentro = conCierre(nodo.a, leer(nodo.a), "fin de la raíz");
      if (!nodo.n) return `raíz cuadrada de ${dentro}`;
      const indice = leer(nodo.n);
      return indice === "3" ? `raíz cúbica de ${dentro}` : `raíz de índice ${indice} de ${dentro}`;
    }
    case "guion": {
      const partes = [leer(nodo.base)];
      if (nodo.sub) partes.push(`sub ${conCierre(nodo.sub, leer(nodo.sub), "fin del subíndice")}`);
      if (nodo.sup) {
        const exponente = leer(nodo.sup);
        partes.push(exponente === "2" ? "al cuadrado" : exponente === "3" ? "al cubo" : `elevado a ${conCierre(nodo.sup, exponente, "fin del exponente")}`);
      }
      return partes.join(" ");
    }
    case "grande": {
      const nombre = buscar(GRANDES_LEIDOS, nodo.v);
      const abajo = nodo.sub ? leer(nodo.sub) : "";
      const arriba = nodo.sup ? leer(nodo.sup) : "";
      if (abajo && arriba) return `${nombre} de ${abajo} a ${arriba},`;
      if (abajo) return nodo.v === "lim" ? `${nombre} cuando ${abajo},` : `${nombre} sobre ${abajo},`;
      if (arriba) return `${nombre} hasta ${arriba},`;
      return nombre;
    }
    case "cerca": {
      const abre = nodo.abre === "." ? "" : `abre ${buscar(DELIMITADORES, nodo.abre)}`;
      const cierra = nodo.cierra === "." ? "" : `cierra ${buscar(DELIMITADORES, nodo.cierra)}`;
      return [abre, leer(nodo.c), cierra].filter(Boolean).join(" ");
    }
    case "acento":
      return Object.hasOwn(ACENTOS_LEIDOS, nodo.v) ? ACENTOS_LEIDOS[nodo.v](leer(nodo.base)) : leer(nodo.base);
  }
}

/**
 * La fórmula dicha en español, para el nombre accesible. Sin espacios repetidos ni comas de más: `\int_0^1 x\,dx` queda
 * «integral de 0 a 1, x d x». Cadena vacía si la fórmula no dice nada (solo espacios).
 */
export function leerMate(arbol: NodoMate): string {
  return leer(arbol)
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,(?: ?,)+/g, ",")
    .replace(/[\s,]+$/, "")
    .trim();
}
