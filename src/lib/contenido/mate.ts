// Las fórmulas del banco de preguntas (HU-083): del texto con $…$ a un árbol de nodos que el componente dibuja como MathML.
//
// Portado de partirMate y analizarMate del prototipo (index.html, dvarela5101/Calibra), con los mismos tipos de nodo y las
// mismas tablas. Es código puro, sin React ni DOM, para que lo pueda correr una prueba de Node. Las diferencias con el
// prototipo son deliberadas y están en la lista de abajo; todo lo demás se conserva.
//
//  1. partirMate corta con la regla de tramosMate (scripts/contenido/matematica.mts): una barra escapa al carácter que sigue,
//     sea cual sea. El prototipo solo escapaba \$, así que en `a\\$x$ b` veía un \$ literal donde el convertidor ve una
//     fórmula, y el estudiante habría visto distinto de lo que el validador revisó.
//  2. Una fórmula en blanco, o que no dibuja nada (`$$`, `$ $`, `${}$`), cuenta como fórmula que no se entiende. El prototipo
//     la dibujaba como un <math> vacío y el texto desaparecía.
//  3. Dentro de \text{…} y \mathrm{…}, \$ sale como $ (el prototipo dejaba la barra a la vista). Las demás barras de ahí
//     dentro siguen crudas: `\text{\alpha}` muestra \alpha. Es una limitación conocida; el banco de hoy no la usa.
//  4. Un tope de anidación, para que una fuente de miles de llaves no dependa del RangeError del motor ni llegue a React
//     con un árbol que no se pueda dibujar.
//  5. Un error propio (ErrorMate) en vez de Error, y nada de window.__calibraMateErrores: de las erratas se encarga
//     banco.test.ts.
//  6. Las tablas se consultan con Object.hasOwn: en el prototipo `\constructor` o `\toString` se leían como una letra.

/** Cada nodo del árbol de una fórmula. */
export type NodoMate =
  | { t: "num"; v: string }
  /** `recta`: letra sin cursiva (las griegas mayúsculas y \mathrm). */
  | { t: "id"; v: string; recta?: boolean }
  | { t: "op"; v: string }
  /** Función con nombre (sen, cos, ln…): `v` es el nombre del comando, que se escribe tal cual. */
  | { t: "fn"; v: string }
  | { t: "texto"; v: string }
  | { t: "espacio"; v: string }
  | { t: "fila"; c: NodoMate[] }
  | { t: "frac"; a: NodoMate; b: NodoMate }
  | { t: "raiz"; a: NodoMate; n: NodoMate | null }
  | { t: "guion"; base: NodoMate; sub: NodoMate | null; sup: NodoMate | null }
  | { t: "grande"; v: string; sub: NodoMate | null; sup: NodoMate | null }
  | { t: "cerca"; abre: string; cierra: string; c: NodoMate }
  | { t: "acento"; v: string; base: NodoMate };

/** Un trozo del texto: fuera de fórmula (`mate: false`) o lo que va entre dos $. `abierto`: el $ nunca se cerró. */
export interface TrozoMate {
  mate: boolean;
  texto: string;
  abierto?: true;
}

/** La fórmula no se entiende. Su mensaje es para quien escribe el banco, no para el visitante. */
export class ErrorMate extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ErrorMate";
  }
}

// ---------------------------------------------------------------------------------------------------
// Tablas (las del prototipo)
// ---------------------------------------------------------------------------------------------------

const LETRAS: Readonly<Record<string, string>> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
  theta: "θ", lambda: "λ", mu: "μ", nu: "ν", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", phi: "ϕ", varphi: "φ", omega: "ω", infty: "∞", partial: "∂", nabla: "∇",
  Delta: "Δ", Sigma: "Σ", Omega: "Ω", Gamma: "Γ", Phi: "Φ",
};

const OPERADORES: Readonly<Record<string, string>> = {
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈",
  pm: "±", mp: "∓", to: "→", rightarrow: "→", cdot: "·", times: "×", div: "÷",
};

const FUNCIONES: readonly string[] = ["sen", "sin", "cos", "tan", "sec", "csc", "cot", "ln", "log", "exp"];

/** Símbolo que se dibuja para \int, \sum… (`lim` se escribe como palabra). */
export const GRANDES: Readonly<Record<string, string>> = { int: "∫", iint: "∬", oint: "∮", sum: "∑", prod: "∏", lim: "lim" };

/** Las que llevan los límites a los lados; las demás los llevan por debajo y por encima. */
export const GRANDES_CON_LIMITES_AL_LADO: readonly string[] = ["int", "iint", "oint"];

/** Ancho de cada espacio. La clave del espacio fino es la coma (`\,`). */
export const ESPACIOS: Readonly<Record<string, string>> = { ",": "0.1667em", ";": "0.2778em", quad: "1em" };

/** Lo que va encima de la base de \vec, \bar y \hat. */
export const ACENTOS: Readonly<Record<string, string>> = { vec: "→", bar: "¯", hat: "^" };

/** Los comandos que llevan argumentos (o, como \left y \right, un cuerpo). El analizador solo atiende los de esta lista. */
const COMANDOS_CON_ARGUMENTOS: readonly string[] = ["frac", "sqrt", "text", "mathrm", "left", "right"];

/**
 * Los comandos que el dibujo entiende. Sale de las mismas tablas que usa el analizador, no de una lista aparte. Una prueba
 * la compara con COMANDOS_MATE (scripts/contenido/matematica.mts), que es la lista que valida el banco.
 */
export const COMANDOS_DIBUJADOS: readonly string[] = [
  ...Object.keys(LETRAS),
  ...Object.keys(OPERADORES),
  ...FUNCIONES,
  ...Object.keys(GRANDES),
  ...Object.keys(ESPACIOS),
  ...Object.keys(ACENTOS),
  ...COMANDOS_CON_ARGUMENTOS,
];

/** Caracteres ASCII que se escriben tal cual en una fórmula. */
const SIMBOLOS = "+-=<>()[]|/'!,;:.*";
const CIFRAS_UNICODE = "⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉";
const DELIMITADORES = "()[]|.";

/** Niveles de analizador (cada grupo y cada átomo anidado cuentan uno): unas 100 llaves una dentro de otra. */
const TOPE_ANIDACION = 200;

const tiene = (tabla: Readonly<Record<string, string>>, clave: string) => Object.hasOwn(tabla, clave);

// ---------------------------------------------------------------------------------------------------
// Del texto a los trozos
// ---------------------------------------------------------------------------------------------------

/**
 * Parte el texto en trozos de texto y de fórmula. Una barra escapa al carácter que sigue (como tramosMate): fuera de
 * fórmula `\$` es un $ literal y las demás barras quedan como están; dentro de fórmula el texto va crudo, con `\$` incluido.
 * Un $ sin pareja deja el último trozo con `abierto`. Un texto sin nada que mostrar no deja trozo.
 */
export function partirMate(texto: string): TrozoMate[] {
  const trozos: TrozoMate[] = [];
  let actual = "";
  let enMate = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === "\\") {
      const siguiente = texto.charAt(i + 1);
      actual += siguiente === "$" && !enMate ? "$" : c + siguiente;
      i += 1;
    } else if (c === "$") {
      if (actual || enMate) trozos.push({ mate: enMate, texto: actual });
      actual = "";
      enMate = !enMate;
    } else {
      actual += c;
    }
  }
  if (enMate) trozos.push({ mate: true, texto: actual, abierto: true });
  else if (actual) trozos.push({ mate: false, texto: actual });
  return trozos;
}

// ---------------------------------------------------------------------------------------------------
// De la fórmula al árbol
// ---------------------------------------------------------------------------------------------------

const fila = (hijos: NodoMate[]): NodoMate => (hijos.length === 1 ? hijos[0] : { t: "fila", c: hijos });

/** Una fila sin ninguna hoja (`{}`, `{{}}`, `{}{}`) no dibuja nada. */
const sinHojas = (nodo: NodoMate): boolean => nodo.t === "fila" && nodo.c.every(sinHojas);

/**
 * Analizador recursivo: de la fuente TeX (lo que va entre los $) a un árbol pequeño. Lanza ErrorMate con el motivo si
 * algo no cuadra. Entiende los comandos de COMANDOS_DIBUJADOS, ^ y _ (un carácter o un {grupo}) y {} para agrupar.
 */
export function analizarMate(fuente: string): NodoMate {
  const s = fuente;
  let pos = 0;
  // Dentro de \sqrt[…] el índice termina en el primer ].
  let enCorchete = false;
  let nivel = 0;

  if (!s.trim()) throw new ErrorMate("fórmula vacía");

  function fallo(mensaje: string): never {
    throw new ErrorMate(`${mensaje} (posición ${pos})`);
  }

  function anidar<T>(leer: () => T): T {
    if (nivel >= TOPE_ANIDACION) fallo("demasiado anidada");
    nivel += 1;
    const leido = leer();
    nivel -= 1;
    return leido;
  }

  function blancos() {
    while (pos < s.length && /\s/.test(s.charAt(pos))) pos += 1;
  }

  /** `pos` está sobre la barra. */
  function comando(): string {
    pos += 1;
    if (pos >= s.length) fallo("barra invertida al final");
    const c = s.charAt(pos);
    if (!/[A-Za-z]/.test(c)) {
      pos += 1;
      return c;
    }
    const inicio = pos;
    while (pos < s.length && /[A-Za-z]/.test(s.charAt(pos))) pos += 1;
    return s.slice(inicio, pos);
  }

  /** El texto crudo de un {grupo}, para \text y \mathrm. `\$` sale como $ (cambio 3); lo demás queda tal cual. */
  function crudoEntreLlaves(): string {
    blancos();
    if (s.charAt(pos) !== "{") fallo("se esperaba {");
    let profundidad = 1;
    pos += 1;
    const inicio = pos;
    while (pos < s.length) {
      const c = s.charAt(pos);
      if (c === "\\") {
        pos += 2;
        continue;
      }
      if (c === "{") profundidad += 1;
      else if (c === "}") {
        profundidad -= 1;
        if (profundidad === 0) {
          pos += 1;
          return s.slice(inicio, pos - 1).replace(/\\([\s\S])/g, (par, c2: string) => (c2 === "$" ? "$" : par));
        }
      }
      pos += 1;
    }
    return fallo("falta }");
  }

  const esRight = () => s.startsWith("\\right", pos) && !/[A-Za-z]/.test(s.charAt(pos + 6));

  /** Lee elementos hasta }, \right o el final. No consume el cierre. */
  function secuencia(): NodoMate[] {
    return anidar(() => {
      const hijos: NodoMate[] = [];
      for (;;) {
        blancos();
        if (pos >= s.length) break;
        const c = s.charAt(pos);
        if (c === "}") break;
        if (c === "]" && enCorchete) break;
        if (c === "\\" && esRight()) break;
        hijos.push(conGuiones());
      }
      return hijos;
    });
  }

  function grupo(): NodoMate {
    pos += 1; // {
    const hijos = secuencia();
    if (s.charAt(pos) !== "}") fallo("falta }");
    pos += 1;
    return fila(hijos);
  }

  /** Un argumento: {grupo} o un solo átomo, sin guiones. */
  function argumento(): NodoMate {
    blancos();
    if (pos >= s.length) fallo("falta un argumento");
    if (s.charAt(pos) === "{") return grupo();
    return atomo();
  }

  function delimitador(): string {
    blancos();
    const c = s.charAt(pos);
    if (!c) fallo("falta el delimitador de \\left o \\right");
    if (!DELIMITADORES.includes(c)) fallo(`delimitador no admitido: ${c}`);
    pos += 1;
    return c;
  }

  /** Lo que sigue a un comando de COMANDOS_CON_ARGUMENTOS. */
  function conArgumentos(nombre: string): NodoMate {
    switch (nombre) {
      case "frac": {
        const a = argumento();
        return { t: "frac", a, b: argumento() };
      }
      case "sqrt": {
        let n: NodoMate | null = null;
        blancos();
        if (s.charAt(pos) === "[") {
          pos += 1;
          const antes = enCorchete;
          enCorchete = true;
          try {
            n = fila(secuencia());
          } finally {
            enCorchete = antes;
          }
          if (s.charAt(pos) !== "]") fallo("falta ] en \\sqrt[n]");
          pos += 1;
        }
        return { t: "raiz", a: argumento(), n };
      }
      case "text":
        return { t: "texto", v: crudoEntreLlaves() };
      case "mathrm":
        return { t: "id", v: crudoEntreLlaves(), recta: true };
      case "left": {
        const abre = delimitador();
        const cuerpo = secuencia();
        if (!esRight()) fallo("\\left sin \\right");
        pos += 6;
        return { t: "cerca", abre, cierra: delimitador(), c: fila(cuerpo) };
      }
      case "right":
        return fallo("\\right sin \\left");
      default:
        return fallo(`comando sin dibujo: \\${nombre}`);
    }
  }

  function atomo(): NodoMate {
    return anidar(leerAtomo);
  }

  function leerAtomo(): NodoMate {
    blancos();
    const c = s.charAt(pos);
    if (c === "{") return grupo();
    if (c === "}") fallo("} sin pareja");
    // Un ^ o _ sin base: el átomo es una fila vacía y los guiones los lee conGuiones.
    if (c === "^" || c === "_") return { t: "fila", c: [] };
    if (/[0-9]/.test(c)) {
      // Coma o punto decimal solo si le sigue una cifra: 0,05 es un número; a, b no.
      const numero = /^[0-9]+(?:[.,][0-9]+)*/.exec(s.slice(pos));
      const v = numero ? numero[0] : c;
      pos += v.length;
      return { t: "num", v };
    }
    if (/[A-Za-z]/.test(c)) {
      pos += 1;
      return { t: "id", v: c };
    }
    if (c === "\\") {
      const nombre = comando();
      if (nombre === "$") return { t: "op", v: "$" };
      if (tiene(ESPACIOS, nombre)) return { t: "espacio", v: nombre };
      if (tiene(LETRAS, nombre)) return { t: "id", v: LETRAS[nombre], recta: /^[A-Z]/.test(nombre) };
      if (tiene(OPERADORES, nombre)) return { t: "op", v: OPERADORES[nombre] };
      if (FUNCIONES.includes(nombre)) return { t: "fn", v: nombre };
      if (tiene(GRANDES, nombre)) return { t: "grande", v: nombre, sub: null, sup: null };
      if (tiene(ACENTOS, nombre)) return { t: "acento", v: nombre, base: argumento() };
      if (COMANDOS_CON_ARGUMENTOS.includes(nombre)) return conArgumentos(nombre);
      return fallo(`comando desconocido: \\${nombre}`);
    }
    // Carácter suelto: símbolo ASCII o Unicode escrito tal cual (x², π, ≤).
    let ch = c;
    const codigo = c.charCodeAt(0);
    if (codigo >= 0xd800 && codigo <= 0xdbff) ch = s.slice(pos, pos + 2);
    pos += ch.length;
    if (SIMBOLOS.includes(ch)) {
      if (ch === "-") ch = "−";
      else if (ch === "'") ch = "′";
      return { t: "op", v: ch };
    }
    if (codigo < 128) fallo(`carácter no admitido: ${ch}`);
    if (CIFRAS_UNICODE.includes(ch)) return { t: "num", v: ch };
    if (ch.toLowerCase() !== ch.toUpperCase()) return { t: "id", v: ch };
    return { t: "op", v: ch };
  }

  /** Un átomo con sus ^ y _ (en cualquier orden, a lo sumo uno de cada uno). */
  function conGuiones(): NodoMate {
    const base = atomo();
    let sub: NodoMate | null = null;
    let sup: NodoMate | null = null;
    for (;;) {
      blancos();
      const c = s.charAt(pos);
      if (c === "^" && !sup) {
        pos += 1;
        sup = argumento();
      } else if (c === "_" && !sub) {
        pos += 1;
        sub = argumento();
      } else if (c === "^" || c === "_") {
        fallo(`doble ${c}`);
      } else {
        break;
      }
    }
    if (base.t === "grande") {
      base.sub = sub;
      base.sup = sup;
      return base;
    }
    if (!sub && !sup) return base;
    return { t: "guion", base, sub, sup };
  }

  const todo = secuencia();
  if (pos < s.length) fallo(`${s.charAt(pos)} sin pareja`);
  const raiz = fila(todo);
  if (sinHojas(raiz)) throw new ErrorMate("fórmula vacía");
  return raiz;
}

/**
 * Analiza una fórmula sin lanzar: atrapa todo lo que salga, también un error que no sea de ErrorMate (una pila agotada
 * por una fuente de miles de llaves, por ejemplo). Lo que no se entiende se muestra tal cual y la pantalla no falla.
 */
export function intentarAnalizar(fuente: string): { ok: true; arbol: NodoMate } | { ok: false; motivo: string } {
  try {
    return { ok: true, arbol: analizarMate(fuente) };
  } catch (error) {
    return { ok: false, motivo: error instanceof Error ? error.message : String(error) };
  }
}
