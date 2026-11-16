/**
 * HU-134: las cifras del banco que cita la portada. Las tres salen de la base (`cifras_del_banco()`); aquí vive lo puro: validar
 * lo que llega, redondear hacia abajo y armar la frase. Sin `server-only`, para probarlo sin base.
 */

/** Los tres conteos tal como los devuelve la base. */
export type ConteosDelBanco = { materias: number; preguntas: number; errores: number };

/** Lo que muestra la portada: las materias exactas y los otros dos ya redondeados hacia abajo. */
export type CifrasDelBanco = ConteosDelBanco;

/**
 * Redondea hacia abajo para poder decir «más de N» sin exagerar. El paso crece con la cifra para que la frase no se quede vieja
 * con cada pregunta nueva ni prometa de más:
 *   - menos de 100: de 10 en 10 (99 → 90);
 *   - de 100 a 999: de 50 en 50 (249 → 200, 250 → 250, 263 → 250);
 *   - 1000 o más: de 100 en 100 (1099 → 1000, 1250 → 1200).
 * Con menos de 10 da 0: no hay cifra redonda que decir. Lo que no es un entero finito y positivo da 0.
 */
export function redondearHaciaAbajo(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const entero = Math.floor(n);
  const paso = entero < 100 ? 10 : entero < 1000 ? 50 : 100;
  return Math.floor(entero / paso) * paso;
}

/**
 * Convierte los conteos de la base en las cifras de la portada, o `null` si no sirven: algo que no es un entero no negativo, o
 * cualquiera de las tres en cero (después de redondear: «más de 0 preguntas» no dice nada). Con `null` la portada usa el texto
 * sin números.
 */
export function cifrasParaLaPortada(conteos: ConteosDelBanco | null | undefined): CifrasDelBanco | null {
  if (!conteos) return null;
  const { materias, preguntas, errores } = conteos;
  if (![materias, preguntas, errores].every((n) => Number.isInteger(n) && n >= 0)) return null;
  const cifras = { materias, preguntas: redondearHaciaAbajo(preguntas), errores: redondearHaciaAbajo(errores) };
  return cifras.materias > 0 && cifras.preguntas > 0 && cifras.errores > 0 ? cifras : null;
}

/** Un número con punto de miles al estilo colombiano: 1200 → «1.200». */
export function conMiles(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** «materia» o «materias» según la cantidad. */
export function etiquetaDeMaterias(n: number): string {
  return `${n} ${n === 1 ? "materia" : "materias"}`;
}
