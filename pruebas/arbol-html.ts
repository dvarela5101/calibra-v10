/**
 * Un lector de HTML mínimo para las pruebas de Vitest que miran el marcado de un componente (`renderToStaticMarkup`): arma el árbol de
 * elementos y deja preguntar por etiqueta, por atributo y por ascendientes. Sirve para lo que una expresión regular no responde bien,
 * como «este bloque nunca está dentro de un `h3`, un `p` ni un `label`». No es un analizador completo: lee el HTML que escribe React
 * (etiquetas cerradas, atributos entre comillas, comentarios `<!-- -->`) y nada más. Los nombres de atributo quedan en minúsculas
 * (`dateTime` es `datetime`).
 */

export type Nodo = {
  etiqueta: string;
  atributos: Record<string, string>;
  hijos: (Nodo | string)[];
  padre: Nodo | null;
};

const VACIAS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

const ENTIDADES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };
const decodificar = (texto: string) => texto.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entidad) => ENTIDADES[entidad]);

const ETIQUETA = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
const ATRIBUTO = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function leerHtml(html: string): Nodo {
  const raiz: Nodo = { etiqueta: "#raiz", atributos: {}, hijos: [], padre: null };
  let actual = raiz;
  for (const trozo of html.matchAll(ETIQUETA)) {
    const [completo, cierra, etiqueta, atributos, autocierre, texto] = trozo;
    if (completo.startsWith("<!--")) continue;
    if (texto !== undefined) {
      actual.hijos.push(decodificar(texto));
      continue;
    }
    const nombre = etiqueta.toLowerCase();
    if (cierra) {
      // Se sube hasta la etiqueta que se cierra; un cierre sin apertura se ignora.
      let candidato: Nodo | null = actual;
      while (candidato && candidato.etiqueta !== nombre) candidato = candidato.padre;
      if (candidato?.padre) actual = candidato.padre;
      continue;
    }
    const nodo: Nodo = { etiqueta: nombre, atributos: {}, hijos: [], padre: actual };
    for (const [, clave, doble, simple, sin] of (atributos ?? "").matchAll(ATRIBUTO)) nodo.atributos[clave.toLowerCase()] = decodificar(doble ?? simple ?? sin ?? "");
    actual.hijos.push(nodo);
    if (!autocierre && !VACIAS.has(nombre)) actual = nodo;
  }
  return raiz;
}

/** El texto visible de un nodo, con los espacios normalizados (`\s` incluye los duros). */
export function textoDe(nodo: Nodo | string): string {
  const plano = (n: Nodo | string): string => (typeof n === "string" ? n : n.hijos.map(plano).join(""));
  return plano(nodo).replace(/\s+/g, " ").trim();
}

/** Todos los elementos del árbol, en orden de aparición, que cumplen la condición. */
export function buscarTodos(nodo: Nodo, condicion: (n: Nodo) => boolean): Nodo[] {
  const encontrados: Nodo[] = [];
  const recorrer = (n: Nodo) => {
    for (const hijo of n.hijos) {
      if (typeof hijo === "string") continue;
      if (condicion(hijo)) encontrados.push(hijo);
      recorrer(hijo);
    }
  };
  recorrer(nodo);
  return encontrados;
}

export const porEtiqueta = (nodo: Nodo, ...etiquetas: string[]): Nodo[] => buscarTodos(nodo, (n) => etiquetas.includes(n.etiqueta));

/** Los elementos con esa clase (como palabra completa o como parte del nombre que le da el módulo de estilos). */
export const porClase = (nodo: Nodo, clase: string): Nodo[] => buscarTodos(nodo, (n) => (n.atributos.class ?? "").split(/\s+/).some((c) => c === clase || c.includes(clase)));

/** Las etiquetas de los ascendientes de un nodo, del más cercano al más lejano. */
export function ascendientes(nodo: Nodo): string[] {
  const etiquetas: string[] = [];
  for (let padre = nodo.padre; padre && padre.etiqueta !== "#raiz"; padre = padre.padre) etiquetas.push(padre.etiqueta);
  return etiquetas;
}

/** Los hijos que son elementos. */
export const elementosHijos = (nodo: Nodo): Nodo[] => nodo.hijos.filter((h): h is Nodo => typeof h !== "string");
