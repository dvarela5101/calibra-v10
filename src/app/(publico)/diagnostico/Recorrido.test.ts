import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FILA_DE_EJEMPLO } from "../../../../pruebas/diagnostico-sembrado";
import { proyectarResultado } from "@/lib/diagnostico/mostrar";
import { pantallaInicial, type MateriaConEvaluaciones, type PantallaDelRecorrido } from "@/lib/diagnostico/pantalla";
import { proyectarEnCurso, type EnCurso } from "@/lib/diagnostico/reglas";

// HU-009: la pantalla que arma `Recorrido` en cada estado inicial, sin navegador. Las transiciones son `siguientePantalla` (puro,
// con su prueba); el foco, el doble clic y las llamadas reales a las acciones los mide la e2e.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("./acciones", () => ({ empezarDiagnostico: vi.fn(), responderPregunta: vi.fn() }));

import { Recorrido } from "./Recorrido";

const MATERIAS: MateriaConEvaluaciones[] = [
  { codigo: "FISI-1018", nombre: "Física II", evaluaciones: [{ id: "e1", nombre: "Parcial 1", semana: 4, temas: ["Cinemática"] }] },
];

function pendiente(paso: number, maximo = 8): EnCurso {
  return proyectarEnCurso({
    idDiagnostico: "d1000000-0000-4000-8000-000000000001",
    evaluacion: { id: "e1", nombre: "Parcial 1" },
    materia: { codigo: "FISI-1018", nombre: "Física II" },
    paso,
    maximo,
    pregunta: { enunciado: "¿Cuánto vale 2 + 2?", opciones: (["A", "B", "C", "D"] as const).map((letra, i) => ({ letra, texto: String(i + 3) })) },
  });
}

const pintar = (inicial: PantallaDelRecorrido) => renderToStaticMarkup(createElement(Recorrido, { inicial, materias: MATERIAS }));

const texto = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("Recorrido: el selector", () => {
  const html = pintar(pantallaInicial(null));

  it("tiene un h1 «Elige tu materia», el eyebrow «Diagnóstico» y las materias", () => {
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toMatch(/<h1 [^>]*>Elige tu materia<\/h1>/);
    expect(texto(html)).toContain("Diagnóstico Elige tu materia");
    expect(texto(html)).toContain("No necesitas crear una cuenta.");
    expect(html).toContain('name="materia"');
  });

  it("el estado inicial no lleva ninguna región viva: el aviso de avance es de la pregunta", () => {
    expect(html).not.toContain("aria-live");
  });

  it("con un diagnóstico en curso desde «Cambiar de materia», avisa de lo que se descarta", () => {
    const html = pintar({ tipo: "selector", enCurso: pendiente(2), mensaje: null, enfocar: false });
    expect(texto(html)).toContain("Llevas un diagnóstico de Física II · Parcial 1");
  });
});

describe("Recorrido: la pregunta pendiente", () => {
  const html = pintar(pantallaInicial(pendiente(2)));

  it("al recargar pinta la pregunta pendiente y no el selector (criterio 7)", () => {
    expect(html).toContain('name="opcion"');
    expect(html).not.toContain('name="materia"');
    expect(texto(html)).toContain("¿Cuánto vale 2 + 2?");
  });

  it("el h1 es «Tu diagnóstico» y el eyebrow lleva la materia y la Evaluación", () => {
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toMatch(/<h1 [^>]*>Tu diagnóstico<\/h1>/);
    expect(texto(html)).toContain("Física II · Parcial 1 Tu diagnóstico");
  });

  it("«Pregunta 3 de hasta 8» en una región viva educada y atómica, fuera del formulario que se remonta (M30)", () => {
    const region = html.match(/<p class="[^"]*" aria-live="polite" aria-atomic="true">([^<]*)<\/p>/);
    expect(region?.[1]).toBe("Pregunta 3 de hasta 8");
    expect(html.indexOf("aria-live")).toBeLessThan(html.indexOf("<form"));
    expect(html.match(/aria-live/g)).toHaveLength(1);
  });

  it("la región viva cambia de texto con el paso", () => {
    expect(pintar(pantallaInicial(pendiente(0)))).toContain(">Pregunta 1 de hasta 8<");
    expect(pintar(pantallaInicial(pendiente(7)))).toContain(">Pregunta 8 de hasta 8<");
  });

  it("un mensaje de fallo llega a la pregunta", () => {
    const conMensaje = pintar({ tipo: "pregunta", enCurso: pendiente(2), mensaje: "No pudimos guardar tu respuesta. Inténtalo de nuevo.", enfocar: false });
    expect(conMensaje).toMatch(/<p role="alert"[^>]*>No pudimos guardar tu respuesta\. Inténtalo de nuevo\.<\/p>/);
  });
});

describe("Recorrido: ya viste todas las preguntas", () => {
  const ultimo = proyectarResultado(FILA_DE_EJEMPLO);
  const html = pintar({ tipo: "sin_preguntas", idEvaluacion: "e1", ultimo, enCursoPrevio: null, mensaje: null, enfocar: false });

  it("el h1 es «Ya viste todas las preguntas» y el eyebrow, la materia del último resultado", () => {
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toMatch(/<h1 [^>]*>Ya viste todas las preguntas<\/h1>/);
    expect(texto(html)).toContain("Física II Ya viste todas las preguntas");
  });

  it("sigue el mensaje, la pregunta y el último resultado", () => {
    expect(texto(html)).toContain("¿Quieres volver a tomar el diagnóstico? Sí, volver a tomarlo No");
    expect(texto(html)).toContain("Tu último resultado");
  });

  it("sin último resultado, el eyebrow es «Diagnóstico» y la pregunta sale igual", () => {
    const sin = pintar({ tipo: "sin_preguntas", idEvaluacion: "e1", ultimo: null, enCursoPrevio: null, mensaje: null, enfocar: false });
    expect(texto(sin)).toContain("Diagnóstico Ya viste todas las preguntas");
    expect(sin).toContain("Sí, volver a tomarlo");
  });
});
