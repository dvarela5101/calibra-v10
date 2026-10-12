/**
 * Lo que el servidor le manda al navegador, para buscar ahí lo que no debe llegar (e2e de HU-009, `vigilarRespuestas`).
 *
 * Next incrusta el flujo de Server Components de cada página dentro de una cadena de JavaScript:
 * `self.__next_f.push([1,"…{\"clave\":…}…"])`. Las comillas de cada clave salen escapadas (`\"clave\"`), así que un centinela
 * escrito como `"clave"` solo podía encontrar las respuestas de las Server Actions (`text/x-component`, sin escapar) y nunca el
 * HTML de una página: contra una página era siempre falso, aunque la clave viajara. `desescaparComillas` quita las barras que
 * preceden a una comilla, de modo que el mismo centinela vale para las dos formas, y también para una comilla escapada dos veces
 * (un valor con comillas dentro del flujo).
 *
 * Solo sirve para buscar: el resultado no es un JSON ni un HTML válidos. No importa nada de `src/`: lo cargan Vitest y Playwright.
 */
export function desescaparComillas(texto: string): string {
  return texto.replace(/\\+"/g, '"');
}
