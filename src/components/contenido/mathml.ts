// Del árbol de una fórmula (src/lib/contenido/mate.ts) a elementos de React con MathML (HU-083).
//
// Portado de mml, mmlDe, esFuncionMate, anexarFilaMml y matematica del prototipo (index.html). Va en .ts y con createElement,
// sin JSX: @types/react no trae los elementos de MathML (`<mfrac>` no tipa), y una spec de Playwright no puede importar un
// .tsx (e2e/texto-del-banco.spec.ts dibuja este mismo código). El texto del banco llega aquí como hijo de texto de React, que
// lo escapa: nunca se arma una cadena de HTML.
//
// Los atributos son cadenas y salen en el mismo orden que en el prototipo (los dorados de mate.test.ts dependen del
// orden). Un booleano `false` de React borraría el atributo, así que no se pasa ninguno.
import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { leerMate } from "@/lib/contenido/leer";
import { ACENTOS, ESPACIOS, GRANDES, GRANDES_CON_LIMITES_AL_LADO, type NodoMate } from "@/lib/contenido/mate";

type Atributos = Record<string, string>;

type Elemento = ReactElement<Atributos>;

const mml = (etiqueta: string, atributos: Atributos | null, ...hijos: ReactNode[]): Elemento =>
  createElement(etiqueta, atributos, ...hijos) as Elemento;

/** Los paréntesis sueltos no se estiran, como en TeX; para eso está \left. */
const NO_SE_ESTIRAN = ["(", ")", "[", "]", "|"];

/**
 * Chromium recorta los espacios de borde de un <mtext>: «\text{ y }» saldría pegado a lo que lo rodea («x>0yx<5»). Los de
 * borde pasan a espacio duro (U+00A0), que no se recorta; los de en medio los deja como están.
 */
const conEspaciosDuros = (texto: string): string => texto.replace(/^\s+|\s+$/g, (borde) => "\u00a0".repeat(borde.length));

function mmlDe(nodo: NodoMate): Elemento {
  switch (nodo.t) {
    case "num":
      return mml("mn", null, nodo.v);
    case "id":
      return mml("mi", nodo.recta ? { mathvariant: "normal" } : null, nodo.v);
    case "op":
      if (NO_SE_ESTIRAN.includes(nodo.v)) return mml("mo", { stretchy: "false" }, nodo.v);
      // La barra de división va pegada, como en TeX: «π/2», no «π / 2».
      if (nodo.v === "/") return mml("mo", { lspace: "0", rspace: "0" }, nodo.v);
      return mml("mo", null, nodo.v);
    case "fn":
      return mml("mi", { mathvariant: "normal" }, nodo.v);
    case "texto":
      return mml("mtext", null, conEspaciosDuros(nodo.v));
    case "espacio":
      return mml("mspace", { width: ESPACIOS[nodo.v] });
    case "fila":
      return mml("mrow", null, ...anexarFila(nodo.c));
    case "frac":
      return mml("mfrac", null, mmlDe(nodo.a), mmlDe(nodo.b));
    case "raiz":
      return nodo.n ? mml("mroot", null, mmlDe(nodo.a), mmlDe(nodo.n)) : mml("msqrt", null, mmlDe(nodo.a));
    case "guion": {
      const etiqueta = nodo.sub && nodo.sup ? "msubsup" : nodo.sub ? "msub" : "msup";
      return mml(etiqueta, null, mmlDe(nodo.base), ...(nodo.sub ? [mmlDe(nodo.sub)] : []), ...(nodo.sup ? [mmlDe(nodo.sup)] : []));
    }
    case "grande": {
      if (!nodo.sub && !nodo.sup) return mml("mo", null, GRANDES[nodo.v]);
      // Integrales con límites a los lados; sumas, productos y límites por debajo y por encima (en línea el navegador
      // los baja a los lados solo).
      const alLado = GRANDES_CON_LIMITES_AL_LADO.includes(nodo.v);
      const simbolo = mml("mo", alLado ? null : { movablelimits: "true" }, GRANDES[nodo.v]);
      const etiqueta =
        nodo.sub && nodo.sup
          ? alLado ? "msubsup" : "munderover"
          : nodo.sub ? (alLado ? "msub" : "munder") : alLado ? "msup" : "mover";
      return mml(etiqueta, null, simbolo, ...(nodo.sub ? [mmlDe(nodo.sub)] : []), ...(nodo.sup ? [mmlDe(nodo.sup)] : []));
    }
    case "cerca": {
      const hijos = [
        ...(nodo.abre !== "." ? [mml("mo", null, nodo.abre)] : []),
        mmlDe(nodo.c),
        ...(nodo.cierra !== "." ? [mml("mo", null, nodo.cierra)] : []),
      ];
      // Como el prototipo: todo hijo directo `mo` se estira, no solo los dos delimitadores (un cuerpo que es un `mo` suelto
      // también: `\left( + \right)`).
      return mml("mrow", null, ...hijos.map((h) => (h.type === "mo" ? cloneElement(h, { stretchy: "true", fence: "true" }) : h)));
    }
    case "acento":
      return mml("mover", { accent: "true" }, mmlDe(nodo.base), mml("mo", null, ACENTOS[nodo.v]));
  }
}

/** Una función (sen, cos, ln…) va seguida de la aplicación invisible U+2061. */
const esFuncion = (nodo: NodoMate): boolean => nodo.t === "fn" || (nodo.t === "guion" && nodo.base.t === "fn");

/** Los signos que también son el signo de un número: `x = −2`, `(−1)ⁿ`, `a + −b`. */
const SIGNOS_DE_NUMERO = ["+", "−", "±", "∓"];

/** Lo que cierra o termina un valor: detrás de esto un `−` resta, no es el signo de un número. */
const CIERRES = [")", "]", "!", "′"];

/**
 * MathML decide la forma de un `mo` (prefijo, infijo o sufijo) por su lugar en la fila: el primero es prefijo, el último
 * sufijo y todo el resto infijo, con 0,22 a 0,28 em de hueco a cada lado. TeX decide por lo que lo rodea. Esta función da, para
 * cada hijo de la fila, la forma que hay que pedir (`null`: la que el navegador ya infiere).
 *
 * - Un signo tras un operador, una relación, una coma, un paréntesis que abre, una función o un operador grande, o tras una
 *   barra que abre, es el signo de un número (prefijo): `x = −2` no es `x = − 2`. Es la regla de TeX para el `Bin` que sigue a
 *   `Op`, `Rel`, `Open` o `Punct`.
 * - Las barras sueltas `|` se emparejan dentro de la fila: la primera de cada pareja abre (prefijo) y la segunda cierra (sufijo),
 *   para `|f(x)| − 2` o `|a||b|`. Una barra sin pareja se deja como está. `\left| … \right|` no pasa por aquí.
 */
function formasDeLaFila(hijos: NodoMate[]): (string | null)[] {
  const formas: (string | null)[] = hijos.map(() => null);
  const barras = hijos.flatMap((hijo, i) => (hijo.t === "op" && hijo.v === "|" ? [i] : []));
  barras.slice(0, barras.length - (barras.length % 2)).forEach((i, k) => {
    formas[i] = k % 2 === 0 ? "prefix" : "postfix";
  });
  hijos.forEach((hijo, i) => {
    if (hijo.t !== "op" || !SIGNOS_DE_NUMERO.includes(hijo.v)) return;
    // Un espacio (`\,`) no cuenta: `x = \, -2` sigue siendo el signo de un número.
    let previo = i - 1;
    while (previo >= 0 && hijos[previo].t === "espacio") previo -= 1;
    if (previo < 0 || abreUnNumero(hijos[previo], formas[previo])) formas[i] = "prefix";
  });
  // Al principio de la fila el navegador ya infiere prefijo, y al final sufijo: ahí no hace falta pedirlo.
  if (formas[0] === "prefix") formas[0] = null;
  if (formas[hijos.length - 1] === "postfix") formas[hijos.length - 1] = null;
  return formas;
}

/** `previo` deja a su derecha un número con su signo (no un valor ya terminado). */
function abreUnNumero(previo: NodoMate, forma: string | null): boolean {
  if (previo.t === "fn" || previo.t === "grande") return true;
  if (previo.t !== "op") return false;
  if (previo.v === "|") return forma === "prefix";
  return !CIERRES.includes(previo.v);
}

/**
 * MathML no separa «x cos x» como TeX: el espacio fino va a mano, delante de la función (si no abre la fila ni sigue a un
 * operador, que ya trae su espacio) y detrás, en la aplicación invisible.
 */
function anexarFila(hijos: NodoMate[]): Elemento[] {
  const elementos: Elemento[] = [];
  const formas = formasDeLaFila(hijos);
  hijos.forEach((hijo, i) => {
    const funcion = esFuncion(hijo);
    const previo = i > 0 ? hijos[i - 1] : null;
    // Una barra que cierra es sufijo y no trae hueco: cuenta como un valor, igual que `)`.
    if (funcion && previo && (previo.t !== "op" || ")]".includes(previo.v) || formas[i - 1] === "postfix")) {
      elementos.push(mmlDe({ t: "espacio", v: "," }));
    }
    const elemento = mmlDe(hijo);
    elementos.push(formas[i] ? cloneElement(elemento, { form: formas[i] }) : elemento);
    if (funcion) elementos.push(mml("mo", { lspace: "0", rspace: ESPACIOS[","] }, "\u2061"));
  });
  return elementos;
}

/**
 * El `<math>` en línea de una fórmula ya analizada. Una fórmula de un solo hijo no lleva `mrow` de más. Lleva su lectura en
 * español como `aria-label` (src/lib/contenido/leer.ts): sin ella, el navegador no le saca nombre.
 */
export function formula(arbol: NodoMate): ReactElement {
  const lectura = leerMate(arbol);
  return mml("math", lectura ? { "aria-label": lectura } : null, ...anexarFila(arbol.t === "fila" ? arbol.c : [arbol]));
}
