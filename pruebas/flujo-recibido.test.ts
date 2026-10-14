import { describe, expect, it } from "vitest";
import { desescaparComillas } from "./flujo-recibido";

// HU-009: el vigilante de la e2e busca claves prohibidas escritas entre comillas (`"clave"`). En el HTML de una página Next las
// incrusta escapadas dentro de una cadena de JavaScript, y sin desescapar el centinela nunca podía dispararse contra una página.

/** Como la incrusta Next: el flujo de una página con una pregunta pendiente, que trae `inicial.enCurso`. */
const HTML_DE_UNA_PAGINA = String.raw`<html><body><main>…</main><script>self.__next_f.push([1,"5:{\"inicial\":{\"tipo\":\"pregunta\",\"enCurso\":{\"idDiagnostico\":\"d1\",\"pregunta\":{\"enunciado\":\"¿Cuánto vale 2 + 2?\",\"clave\":\"P1\"}}}}\n"])</script></body></html>`;

/** Como lo manda una Server Action (`text/x-component`): sin escapar. */
const RESPUESTA_DE_UNA_ACCION = String.raw`1:{"tipo":"pregunta","enCurso":{"pregunta":{"enunciado":"¿Cuánto vale 2 + 2?","clave":"P1"}}}`;

describe("desescaparComillas", () => {
  it("el centinela entre comillas no encuentra una clave en el HTML de una página, y sí tras desescapar (M55)", () => {
    expect(HTML_DE_UNA_PAGINA.includes('"clave"'), "sin desescapar, la clave pasa de largo").toBe(false);
    expect(desescaparComillas(HTML_DE_UNA_PAGINA).includes('"clave"')).toBe(true);
    expect(desescaparComillas(HTML_DE_UNA_PAGINA).includes('"enunciado"')).toBe(true);
  });

  it("una respuesta de acción, que ya viene sin escapar, queda igual", () => {
    expect(desescaparComillas(RESPUESTA_DE_UNA_ACCION)).toBe(RESPUESTA_DE_UNA_ACCION);
    expect(desescaparComillas(RESPUESTA_DE_UNA_ACCION).includes('"clave"')).toBe(true);
  });

  it("una comilla escapada varias veces también se desescapa", () => {
    expect(desescaparComillas(String.raw`\\\"repetido\\\"`)).toBe('"repetido"');
    expect(desescaparComillas(String.raw`\"repetido\"`)).toBe('"repetido"');
  });

  it("no inventa coincidencias: lo que no es una clave escapada sigue sin encontrarse", () => {
    const recibido = desescaparComillas(HTML_DE_UNA_PAGINA);
    for (const inocente of ['"semilla"', '"correcta"', '"faltaMaterial"', '"token_recuperacion"']) expect(recibido.includes(inocente), inocente).toBe(false);
    // Una clave sin comillas, o escapada a medias, tampoco cuenta como la clave entre comillas.
    expect(desescaparComillas("clave").includes('"clave"')).toBe(false);
    expect(desescaparComillas(String.raw`\"clave`).includes('"clave"')).toBe(false);
  });

  it("no toca las barras que no preceden a una comilla (una fórmula del banco conserva su \\frac)", () => {
    expect(desescaparComillas(String.raw`$\frac{1}{2}$ y \"x\"`)).toBe(String.raw`$\frac{1}{2}$ y "x"`);
  });
});
