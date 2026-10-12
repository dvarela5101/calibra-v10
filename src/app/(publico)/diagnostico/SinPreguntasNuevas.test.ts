import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FILA_DE_EJEMPLO } from "../../../../pruebas/diagnostico-sembrado";
import { proyectarResultado } from "@/lib/diagnostico/mostrar";
import { SinPreguntasNuevas } from "./SinPreguntasNuevas";

// HU-009, D-51: el marcado del mensaje de «ya viste todas las preguntas». El orden de los tres bloques importa (criterio 16).

const ULTIMO = proyectarResultado(FILA_DE_EJEMPLO);

const pintar = (cambios: Partial<Parameters<typeof SinPreguntasNuevas>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SinPreguntasNuevas, { ultimo: ULTIMO, mensaje: null, pendiente: false, ocupado: false, alVolverATomar: vi.fn(), alNo: vi.fn(), ...cambios }),
  );

const texto = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("SinPreguntasNuevas (criterio 16)", () => {
  const html = pintar();

  it("en este orden: el mensaje, la pregunta con «Sí» y «No», y debajo el último resultado con su fecha (M38)", () => {
    const orden = [
      "Ya respondiste todas las preguntas de esta evaluación.",
      "¿Quieres volver a tomar el diagnóstico?",
      "Sí, volver a tomarlo",
      ">No</button>",
      "Tu último resultado",
      "Fecha:",
      "4 de octubre de 2026",
    ].map((fragmento) => html.indexOf(fragmento));
    expect(orden.every((posicion) => posicion >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("el mensaje dice que algunas preguntas se repetirán", () => {
    expect(texto(html)).toContain("Ya respondiste todas las preguntas de esta evaluación. Si la vuelves a tomar, algunas se repetirán.");
  });

  it("«Sí, volver a tomarlo» envía el formulario y «No» es un botón que no envía nada", () => {
    expect(html).toMatch(/<button type="submit"[^>]*>Sí, volver a tomarlo<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>No<\/button>/);
  });

  it("la pregunta y el último resultado son títulos h2, y las secciones del resultado, h3", () => {
    expect(html.match(/<h2 /g)).toHaveLength(2);
    expect(html.match(/<h3 /g)).toHaveLength(3);
    expect(html).not.toContain("<h1");
  });

  it("el resultado va solo de consulta: sin «Ver monitores» ni «Tomar otro diagnóstico»", () => {
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("Ver monitores");
    expect(html).not.toContain("Tomar otro diagnóstico");
  });

  it("el último resultado trae la fecha, las cifras y no la marca de repetido", () => {
    expect(texto(html)).toContain("Puntaje global: 63 %");
    expect(texto(html).toLowerCase()).not.toContain("repetid");
  });

  it("sin alertas al cargar", () => {
    expect(html).not.toContain('role="alert"');
  });
});

describe("SinPreguntasNuevas: sin último resultado", () => {
  const html = pintar({ ultimo: null });

  it("el mensaje y la pregunta salen igual", () => {
    expect(texto(html)).toContain("Ya respondiste todas las preguntas de esta evaluación.");
    expect(texto(html)).toContain("¿Quieres volver a tomar el diagnóstico?");
    expect(html).toContain("Sí, volver a tomarlo");
    expect(html).toContain(">No</button>");
  });

  it("no hay encabezado de resultado ni resultado", () => {
    expect(html).not.toContain("Tu último resultado");
    expect(html).not.toContain("Puntaje global");
    expect(html).not.toContain("<h3");
    expect(html.match(/<h2 /g)).toHaveLength(1);
  });
});

describe("SinPreguntasNuevas: mensajes y llamadas", () => {
  it("un fallo al volver a tomarlo se anuncia con role=alert, y la pantalla conserva el último resultado", () => {
    const html = pintar({ mensaje: "No pudimos empezar el diagnóstico. Inténtalo de nuevo." });
    expect(html).toMatch(/<p role="alert" class="[^"]*">No pudimos empezar el diagnóstico\. Inténtalo de nuevo\.<\/p>/);
    expect(html).toContain("Tu último resultado");
  });

  it("mientras hay una llamada, «Sí» dice «Empezando…» y los dos botones no se pueden pulsar", () => {
    const html = pintar({ pendiente: true, ocupado: true });
    expect(html).toMatch(/<button type="submit"[^>]* disabled=""[^>]*>Empezando…<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]* disabled=""[^>]*>No<\/button>/);
  });

  it("fuera de una llamada los dos están habilitados", () => {
    expect(pintar()).not.toContain("disabled");
  });
});
