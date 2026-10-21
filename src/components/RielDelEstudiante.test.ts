import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Pantalla } from "./Pantalla";
import { PASOS_DEL_ESTUDIANTE, RielDelEstudiante, type PasoDelEstudiante } from "./RielDelEstudiante";

// D-74 d: el carril del recorrido del estudiante, como el del prototipo.

const pintar = (actual: PasoDelEstudiante) => renderToStaticMarkup(createElement(RielDelEstudiante, { actual }));
const items = (html: string) => html.match(/<li [^>]*>.*?<\/li>/g) ?? [];

describe("RielDelEstudiante", () => {
  it("los cuatro pasos en orden, con su nombre y su pista, dentro de «Tu avance»", () => {
    const html = pintar("prueba");
    expect(html).toMatch(/^<aside aria-label="Tu avance"/);
    expect(items(html).map((li) => li.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())).toEqual([
      "Prueba Preguntas de tu parcial",
      "Diagnóstico Qué habilidades dominas",
      "Monitor Llega con tu diagnóstico",
      "Sesión Fecha, pago y contacto",
    ]);
  });

  it("marca solo el paso actual con aria-current=step", () => {
    for (const [i, paso] of PASOS_DEL_ESTUDIANTE.entries()) {
      const marcados = items(pintar(paso.id)).map((li) => li.includes('aria-current="step"'));
      expect(marcados, paso.id).toEqual(PASOS_DEL_ESTUDIANTE.map((_, j) => j === i));
    }
  });

  it("los pasos anteriores al actual salen recorridos y los siguientes no", () => {
    const clases = items(pintar("monitor")).map((li) => li.match(/class="([^"]*)"/)?.[1] ?? "");
    expect(clases.map((c) => c.includes("hecho"))).toEqual([true, true, false, false]);
    expect(clases.map((c) => c.includes("actual"))).toEqual([false, false, true, false]);
  });

  it("no lleva enlaces: solo muestra en qué paso va", () => {
    expect(pintar("sesion")).not.toContain("<a ");
  });
});

describe("Pantalla con y sin paso", () => {
  it("con paso dibuja el carril antes del contenido", () => {
    const html = renderToStaticMarkup(createElement(Pantalla, { titulo: "T", paso: "diagnostico" }));
    expect(html).toContain('aria-label="Tu avance"');
    expect(html.indexOf("Tu avance")).toBeLessThan(html.indexOf("<main"));
  });

  it("sin paso queda como siempre, sin carril", () => {
    expect(renderToStaticMarkup(createElement(Pantalla, { titulo: "T" }))).not.toContain("Tu avance");
  });
});
