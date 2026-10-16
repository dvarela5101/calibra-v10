import { renderToStaticMarkup } from "react-dom/server";
import { dibujarTexto } from "../src/components/contenido/dibujar";
import type { ResultadoGuardado } from "../src/lib/diagnostico/resultado";

/**
 * Lo que la pantalla debe mostrar de un resultado guardado (HU-011), sacado de los datos y no escrito a mano.
 *
 * El resultado de ejemplo de HU-009 (`GUARDADO_DE_EJEMPLO`) cambia con ella: la revisión de HU-009 le puso una fórmula `$…$` a la
 * descripción de una habilidad, al detalle de un error y a un prerrequisito, y le cambió la frase del detalle. Una prueba que
 * contaba un solo `<math>` en un error y buscaba «Revisa qué magnitud va arriba.» se rompía al integrarla. Por eso la e2e de la
 * portada (`e2e/ultimo-diagnostico.spec.ts`) pide a este módulo, renglón por renglón, qué textos y cuántas fórmulas lleva, y
 * `expectativas-del-resultado.test.ts` comprueba esas expectativas contra el marcado real del componente con las dos versiones
 * del ejemplo.
 *
 * Solo usa de `src/` el dibujo de un texto del banco (`dibujarTexto`, el mismo que usa `TextoDelBanco`) y tipos: lo cargan Vitest
 * y Playwright.
 */

type HabilidadGuardada = ResultadoGuardado["habilidades"][number];
type ErrorGuardado = ResultadoGuardado["errores"][number];
type PrerrequisitoGuardado = ResultadoGuardado["prerrequisitos"][number];

/** El texto que ve la persona en un trozo de HTML: sin etiquetas, con las entidades de React decodificadas y los espacios juntos. */
export function textoPlano(html: string): string {
  const entidades: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entidad) => entidades[entidad])
    .replace(/\s+/g, " ")
    .trim();
}

/** Lo que aparece en pantalla cuando un texto del banco pasa por `TextoDelBanco` (el mismo `dibujarTexto`). */
export function plano(texto: string | null): string {
  return textoPlano(renderToStaticMarkup(dibujarTexto(texto)));
}

/** Cuántas fórmulas dibuja un texto del banco: cada una sale como un `<math>`. Una que no se entiende se queda como texto. */
export function formulasDe(texto: string | null): number {
  return (renderToStaticMarkup(dibujarTexto(texto)).match(/<math[\s>]/g) ?? []).length;
}

/** Lo que debe tener un renglón (un `<li>`) del resultado: los textos que contiene, los que no y cuántos `<math>` lleva dentro. */
export type RenglonEsperado = { contiene: string[]; noContiene: string[]; formulas: number };

/** Una habilidad: su descripción con las fórmulas dibujadas. */
export function renglonDeHabilidad(habilidad: HabilidadGuardada): RenglonEsperado {
  return { contiene: [plano(habilidad.descripcion)], noContiene: [], formulas: formulasDe(habilidad.descripcion) };
}

/**
 * Un error: su título, la descripción de la habilidad (solo si es una de las del resultado, y es la de la lista de habilidades:
 * así la proyecta `proyectarResultado`) y cada detalle. Sin la habilidad en el resultado, el renglón no dice «Habilidad:».
 */
export function renglonDeError(error: ErrorGuardado, habilidades: readonly HabilidadGuardada[]): RenglonEsperado {
  const prefijo = error.estado === "confirmada" ? "Error detectado:" : "Posible error:";
  const descripcion = habilidades.find((h) => h.habilidad === error.habilidad)?.descripcion ?? null;
  const textos = [error.texto, ...(descripcion === null ? [] : [descripcion]), ...error.detalles];
  return {
    contiene: [
      `${prefijo} ${plano(error.texto)}`,
      ...(descripcion === null ? [] : [`Habilidad: ${plano(descripcion)}`]),
      ...error.detalles.map((detalle) => plano(detalle)),
    ],
    noContiene: descripcion === null ? ["Habilidad:"] : [],
    formulas: textos.reduce((suma, texto) => suma + formulasDe(texto), 0),
  };
}

/** Los errores en el orden de la pantalla: los confirmados primero y, dentro de cada grupo, el orden en que llegaron. */
export function erroresEnOrdenDePantalla(errores: readonly ErrorGuardado[]): ErrorGuardado[] {
  return [...errores.filter((e) => e.estado === "confirmada"), ...errores.filter((e) => e.estado !== "confirmada")];
}

/** Un prerrequisito: su descripción y, si es de otra materia, la materia entre paréntesis al final. */
export function renglonDePrerrequisito(prerrequisito: PrerrequisitoGuardado): RenglonEsperado {
  const materia = prerrequisito.materia === null ? "" : ` (${prerrequisito.materia})`;
  return { contiene: [`${plano(prerrequisito.descripcion)}${materia}`], noContiene: [], formulas: formulasDe(prerrequisito.descripcion) };
}
