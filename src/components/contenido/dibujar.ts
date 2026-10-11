// El dibujo de un texto del banco de preguntas (HU-083): enunciado, opción, texto de error, solución o descripción.
//
// Es el único camino del texto del banco a la pantalla. Va en .ts y con createElement, sin JSX, porque
// e2e/texto-del-banco.spec.ts dibuja este mismo código desde Playwright y una spec no puede importar un .tsx. El texto llega
// a React como hijo de texto (que lo escapa), nunca como HTML: ni este módulo ni los de src/lib/contenido/ pueden asignar
// HTML ya armado a un elemento (TextoDelBanco.test.ts busca las API que lo hacen y falla si aparece alguna).
import { createElement, type ReactNode } from "react";
import { partirEnunciado } from "@/lib/contenido/enunciado";
import { intentarAnalizar, partirMate } from "@/lib/contenido/mate";
import { formula } from "./mathml";

/**
 * Los trozos de una línea de prosa, en línea: texto y `<math>`. Una fórmula que no se entiende, o un $ sin cerrar, se queda
 * como texto tal cual (con su `$`), sin marca: la marca del prototipo era una ayuda para quien escribe el banco y el
 * visitante no sabría qué significa. De las erratas se encarga banco.test.ts.
 */
function enLinea(prosa: string): ReactNode[] {
  const nodos: ReactNode[] = [];
  const anexar = (nodo: ReactNode) => {
    const ultimo = nodos.length - 1;
    // El texto contiguo se junta en un solo nodo de texto.
    if (typeof nodo === "string" && typeof nodos[ultimo] === "string") nodos[ultimo] += nodo;
    else nodos.push(nodo);
  };
  for (const trozo of partirMate(prosa)) {
    if (!trozo.mate) {
      anexar(trozo.texto);
      continue;
    }
    const analisis = trozo.abierto ? null : intentarAnalizar(trozo.texto);
    let dibujo: ReactNode = null;
    if (analisis?.ok) {
      try {
        dibujo = formula(analisis.arbol);
      } catch {
        dibujo = null;
      }
    }
    anexar(dibujo ?? `$${trozo.texto}${trozo.abierto ? "" : "$"}`);
  }
  return nodos;
}

/**
 * Dibuja un texto del banco. `null`, `undefined` y `""` no dibujan nada (los textos de error son opcionales).
 *
 * - Sin bloques de código: un `<span class="texto-banco">` con texto y fórmulas en línea. Vale dentro de un `label`, un
 *   `button`, un `h2` o un `p`.
 * - Con bloques de código (al menos uno que no esté vacío): un `<div class="texto-banco">` con un `<p>` por cada trozo de
 *   prosa y un `<pre>` por cada bloque. Un `pre` no cabe en un `p` ni en un `label`: quien muestre un enunciado lo pone
 *   en un `div`. El convertidor solo deja cercas en el enunciado y en la solución.
 *
 * La etiqueta (`span` o `div`) la decide el contenido, no quien llama.
 */
export function dibujarTexto(texto: string | null | undefined, clase?: string): ReactNode {
  if (texto === null || texto === undefined || texto === "") return null;
  const trozos = partirEnunciado(texto);
  if (trozos.length === 0) return null;
  const className = clase ? `texto-banco ${clase}` : "texto-banco";
  if (!trozos.some((trozo) => trozo.codigo)) return createElement("span", { className }, ...enLinea(trozos[0].texto));
  return createElement(
    "div",
    { className },
    ...trozos.map((trozo) =>
      trozo.codigo
        ? createElement(
            "pre",
            { className: "texto-banco-codigo", tabIndex: 0, role: "region", "aria-label": "Código" },
            createElement("code", null, trozo.texto),
          )
        : createElement("p", { className: "texto-banco-parrafo" }, ...enLinea(trozo.texto)),
    ),
  );
}
