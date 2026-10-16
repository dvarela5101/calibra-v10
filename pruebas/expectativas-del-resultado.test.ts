import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultadoDelDiagnostico } from "@/components/diagnostico/ResultadoDelDiagnostico";
import { proyectarResultado } from "@/lib/diagnostico/mostrar";
import type { ResultadoGuardado } from "@/lib/diagnostico/resultado";
import { FILA_DE_EJEMPLO, GUARDADO_DE_EJEMPLO } from "./diagnostico-sembrado";
import {
  erroresEnOrdenDePantalla,
  formulasDe,
  plano,
  renglonDeError,
  renglonDeHabilidad,
  renglonDePrerrequisito,
  textoPlano,
  type RenglonEsperado,
} from "./expectativas-del-resultado";

// HU-011: la e2e de la portada (`e2e/ultimo-diagnostico.spec.ts`) saca de estas expectativas, y no de números y frases escritas a
// mano, qué lleva cada renglón del resultado de ejemplo. Aquí se comprueba, sin navegador ni base, que lo que piden coincide con el
// marcado real de `ResultadoDelDiagnostico` con las DOS versiones del ejemplo: la de esta rama y la que dejó la revisión de HU-009
// (3fcbc02), con fórmulas en la descripción de una habilidad, en el detalle de un error y en un prerrequisito. Con números fijos en
// la e2e (un solo `<math>` en el error, «Revisa qué magnitud va arriba.») la segunda versión la rompía al integrar HU-009.

/** El ejemplo como lo dejó la revisión de HU-009. Si esta rama ya lo trae así (tras integrarla), no cambia nada. */
const EJEMPLO_DE_LA_REVISION: ResultadoGuardado = {
  ...GUARDADO_DE_EJEMPLO,
  habilidades: GUARDADO_DE_EJEMPLO.habilidades.map((h) =>
    h.habilidad === "habilidad-secreta-3" ? { ...h, descripcion: "interpreta gráficas de posición como $x = vt$" } : h,
  ),
  errores: GUARDADO_DE_EJEMPLO.errores.map((e) =>
    e.habilidad === "habilidad-secreta-3"
      ? {
          ...e,
          descripcionHabilidad: "interpreta gráficas de posición como $x = vt$",
          detalles: [String.raw`Revisa qué magnitud va arriba en $\frac{a}{b}$.`],
        }
      : e,
  ),
  prerrequisitos: GUARDADO_DE_EJEMPLO.prerrequisitos.map((p, i) => (i === 0 ? { ...p, descripcion: "despeja una incógnita en $ax + b = c$" } : p)),
};

const VERSIONES: [string, ResultadoGuardado][] = [
  ["el ejemplo de esta rama", GUARDADO_DE_EJEMPLO],
  ["el ejemplo de la revisión de HU-009", EJEMPLO_DE_LA_REVISION],
];

function pintar(guardado: ResultadoGuardado): string {
  return renderToStaticMarkup(createElement(ResultadoDelDiagnostico, { resultado: proyectarResultado({ ...FILA_DE_EJEMPLO, resultado: guardado }) }));
}

/** Los `<li>` de una sección del resultado. Las secciones salen en este orden y los `<li>` no se anidan. */
function renglones(html: string, seccion: "habilidades" | "errores" | "repasar"): string[] {
  const orden = ["habilidades", "errores", "repasar"] as const;
  const desde = html.indexOf(`aria-labelledby="${seccion}-`);
  expect(desde, `la sección ${seccion} está`).toBeGreaterThanOrEqual(0);
  const siguiente = orden[orden.indexOf(seccion) + 1];
  const hasta = siguiente ? html.indexOf(`aria-labelledby="${siguiente}-`) : -1;
  return html.slice(desde, hasta === -1 ? undefined : hasta).match(/<li[\s>][\s\S]*?<\/li>/g) ?? [];
}

const cuantasFormulas = (li: string) => (li.match(/<math[\s>]/g) ?? []).length;

function comprobar(li: string, esperado: RenglonEsperado, donde: string): void {
  const visible = textoPlano(li);
  for (const texto of esperado.contiene) expect(visible, `${donde} debe contener «${texto}»`).toContain(texto);
  for (const texto of esperado.noContiene) expect(visible, `${donde} no debe contener «${texto}»`).not.toContain(texto);
  expect(cuantasFormulas(li), `${donde}: sus fórmulas salen como <math>`).toBe(esperado.formulas);
}

describe.each(VERSIONES)("%s: las expectativas coinciden con el marcado real", (_nombre, guardado) => {
  const html = pintar(guardado);

  it("cada habilidad lleva su descripción y sus fórmulas", () => {
    const filas = renglones(html, "habilidades");
    expect(filas).toHaveLength(guardado.habilidades.length);
    guardado.habilidades.forEach((habilidad, i) => comprobar(filas[i], renglonDeHabilidad(habilidad), `habilidad ${i}`));
  });

  it("cada error, en el orden de la pantalla, lleva su título, su habilidad si es del resultado, sus detalles y sus fórmulas", () => {
    const filas = renglones(html, "errores");
    const enOrden = erroresEnOrdenDePantalla(guardado.errores);
    expect(filas).toHaveLength(enOrden.length);
    enOrden.forEach((error, i) => comprobar(filas[i], renglonDeError(error, guardado.habilidades), `error ${i}`));
  });

  it("cada prerrequisito lleva su descripción, la otra materia si la hay y sus fórmulas", () => {
    const filas = renglones(html, "repasar");
    expect(filas).toHaveLength(guardado.prerrequisitos.length);
    guardado.prerrequisitos.forEach((prerrequisito, i) => comprobar(filas[i], renglonDePrerrequisito(prerrequisito), `prerrequisito ${i}`));
  });

  it("el error confirmado, el primero de la pantalla, lleva fórmulas: la prueba no es vacía", () => {
    const confirmado = erroresEnOrdenDePantalla(guardado.errores)[0];
    expect(confirmado.estado).toBe("confirmada");
    expect(renglonDeError(confirmado, guardado.habilidades).formulas).toBeGreaterThan(0);
  });
});

describe("la versión de la revisión de HU-009 no cabe en lo que la e2e fijaba a mano", () => {
  const confirmado = erroresEnOrdenDePantalla(EJEMPLO_DE_LA_REVISION.errores)[0];
  const esperado = renglonDeError(confirmado, EJEMPLO_DE_LA_REVISION.habilidades);

  it("el error confirmado lleva 3 fórmulas (título, habilidad y detalle), no 1", () => {
    expect(esperado.formulas).toBe(3);
    expect(cuantasFormulas(renglones(pintar(EJEMPLO_DE_LA_REVISION), "errores")[0])).toBe(3);
  });

  it("el detalle sigue a «arriba» con una fórmula: «Revisa qué magnitud va arriba.» ya no está", () => {
    const visible = textoPlano(renglones(pintar(EJEMPLO_DE_LA_REVISION), "errores")[0]);
    expect(visible).toContain("Revisa qué magnitud va arriba en");
    expect(visible).not.toContain("Revisa qué magnitud va arriba.");
    expect(esperado.contiene).toContain(plano(confirmado.detalles[0]));
  });
});

describe("formulasDe y plano", () => {
  it("cuentan las fórmulas que se dibujan, una por <math>", () => {
    expect(formulasDe(null)).toBe(0);
    expect(formulasDe("sin fórmulas")).toBe(0);
    expect(formulasDe("una $x = 1$ y otra $y = 2$")).toBe(2);
  });

  it("una fórmula que no se entiende se queda como texto y no cuenta", () => {
    expect(formulasDe("un dólar suelto $ sin cerrar")).toBe(0);
    expect(plano("un dólar suelto $ sin cerrar")).toContain("$");
  });

  it("plano es el texto de lo que se dibuja, sin etiquetas, y vacío si no hay texto", () => {
    expect(plano(null)).toBe("");
    expect(plano("hola   mundo")).toBe("hola mundo");
    expect(plano("a <b> & c")).toBe("a <b> & c");
  });
});
