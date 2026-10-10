// Un enunciado del banco con bloques de código (HU-083): prosa y programa, cada uno aparte.
//
// Portado de partirEnunciado del prototipo (index.html). Un bloque va entre dos líneas de tres acentos graves; lo de afuera es
// prosa, con sus fórmulas. El convertidor del banco (scripts/contenido/banco.mts: partirCercas, armarEnunciado) deja las
// cercas solas en su línea y sin lenguaje; aquí se tolera una cerca con sangría o con lenguaje (```python), que el
// convertidor rechaza, para que el visitante no vea nunca las cercas ni un programa mezclado con la prosa.

export interface TrozoEnunciado {
  /** `true`: es un programa y su texto va literal. `false`: es prosa y puede llevar fórmulas. */
  codigo: boolean;
  texto: string;
}

/**
 * Parte el texto en prosa y bloques de código. Nunca lanza.
 *
 * - La prosa contigua se une con un espacio, cada línea recortada; las líneas en blanco de la prosa se ignoran.
 * - Un bloque conserva las líneas tal cual, con su sangría y sus líneas en blanco internas. Se quitan las líneas en blanco
 *   del principio y los espacios y saltos del final. Nada se interpreta dentro: ni $, ni \, ni acentos graves sueltos.
 * - Una cerca sin cerrar toma el resto como código.
 * - Un bloque que queda vacío no se devuelve (un `region` sin contenido solo estorba), y la prosa que lo rodeaba se une.
 * - Un texto sin cercas es un único trozo de prosa. Un texto vacío no deja ningún trozo.
 */
export function partirEnunciado(texto: string | null | undefined): TrozoEnunciado[] {
  const trozos: TrozoEnunciado[] = [];
  let prosa: string[] = [];
  let codigo: string[] | null = null;

  const cerrarProsa = () => {
    if (prosa.length) trozos.push({ codigo: false, texto: prosa.join(" ") });
    prosa = [];
  };
  const cerrarCodigo = (lineas: string[]) => {
    const programa = lineas
      .join("\n")
      .replace(/^(?:[ \t]*\n)+/, "")
      .replace(/\s+$/, "");
    if (programa) trozos.push({ codigo: true, texto: programa });
  };

  for (const linea of String(texto ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (codigo === null) {
      if (/^\s*```/.test(linea)) {
        cerrarProsa();
        codigo = [];
      } else if (linea.trim()) {
        prosa.push(linea.trim());
      }
    } else if (/^\s*```\s*$/.test(linea)) {
      cerrarCodigo(codigo);
      codigo = null;
    } else {
      codigo.push(linea);
    }
  }
  if (codigo !== null) cerrarCodigo(codigo);
  else cerrarProsa();

  // La prosa que quedó a los dos lados de un bloque vacío es una sola.
  return trozos.reduce<TrozoEnunciado[]>((unidos, trozo) => {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && !ultimo.codigo && !trozo.codigo) ultimo.texto += ` ${trozo.texto}`;
    else unidos.push(trozo);
    return unidos;
  }, []);
}
