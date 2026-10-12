import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TEXTOS } from "@/lib/diagnostico/presentacion";
import { proyectarEnCurso, type EnCurso } from "@/lib/diagnostico/reglas";
import { ID_DEL_ENUNCIADO, Pregunta } from "./Pregunta";

// HU-009: el marcado de una pregunta. Elegir una opción, «Responder» sin elegir, Enter y el foco son comportamiento del
// navegador: los mide la e2e. Aquí se fija lo que se ve y cómo se nombra.

function pendiente(enunciado = "¿Cuánto vale $2 + 2$?", opciones: string[] = ["3", "4", "5", "6"]): EnCurso {
  return proyectarEnCurso({
    idDiagnostico: "d1000000-0000-4000-8000-000000000001",
    evaluacion: { id: "e0000000-0000-4000-8000-00000000000a", nombre: "Parcial 1" },
    materia: { codigo: "FISI-1018", nombre: "Física II" },
    paso: 2,
    maximo: 8,
    pregunta: { enunciado, opciones: (["A", "B", "C", "D"] as const).map((letra, i) => ({ letra, texto: opciones[i] })) },
  });
}

const pintar = (cambios: Partial<Parameters<typeof Pregunta>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Pregunta, { enCurso: pendiente(), mensaje: null, ocupado: false, alResponder: vi.fn(), alCambiarDeMateria: vi.fn(), ...cambios }),
  );

describe("Pregunta (criterio 4)", () => {
  const html = pintar();

  it("tiene cuatro opciones, radios nativos, con sus letras de la A a la D en orden", () => {
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(([radio]) => radio);
    expect(radios).toHaveLength(4);
    expect(radios.map((radio) => radio.match(/value="([A-D])"/)?.[1])).toEqual(["A", "B", "C", "D"]);
    for (const radio of radios) expect(radio).toContain('name="opcion"');
    const letras = [...html.matchAll(/<span class="[^"]*">([A-D])<\/span>/g)].map(([, letra]) => letra);
    expect(letras).toEqual(["A", "B", "C", "D"]);
  });

  it("cada opción es un label que envuelve su radio, su letra y su texto: el área táctil es la tarjeta", () => {
    const etiquetas = html.match(/<label [^>]*>.*?<\/label>/g) ?? [];
    expect(etiquetas).toHaveLength(4);
    for (const etiqueta of etiquetas) expect(etiqueta).toMatch(/<input[^>]*type="radio"/);
    expect(etiquetas.map((e) => e.replace(/<[^>]+>/g, ""))).toEqual(["A3", "B4", "C5", "D6"]);
  });

  it("ninguna opción llega marcada: elegir es decisión de la persona", () => {
    expect(html).not.toContain("checked");
  });

  it("el enunciado es un div con id y tabindex=-1, y las opciones son un radiogroup que se nombra con él", () => {
    expect(html).toMatch(new RegExp(`<div id="${ID_DEL_ENUNCIADO}" tabindex="-1" class="[^"]*">`));
    expect(html).toMatch(new RegExp(`<div role="radiogroup" aria-labelledby="${ID_DEL_ENUNCIADO}"`));
  });

  it("la fórmula del enunciado se dibuja como <math>", () => {
    expect(html).toContain("<math");
    expect(html).not.toContain("$2 + 2$");
  });

  it("las fórmulas de las opciones se dibujan también", () => {
    const conFormulas = pintar({ enCurso: pendiente("Pregunta", ["$x^2$", "$x^3$", "$\\frac{1}{2}$", "5"]) });
    expect(conFormulas.match(/<math /g)).toHaveLength(3);
  });

  it("el enunciado con código sale en un div y nunca dentro de un h*, un p o un label", () => {
    const conCodigo = pintar({ enCurso: pendiente("¿Qué imprime?\n```\nprint(1 < 2)\n```", ["1", "2", "3", "4"]) });
    expect(conCodigo).toContain("<pre ");
    expect(conCodigo).not.toMatch(/<h[1-6]/);
    expect(conCodigo).not.toMatch(/<(?:p|label)\b(?:(?!<\/(?:p|label)>)[\s\S])*<pre/);
    expect(conCodigo).toMatch(new RegExp(`<div id="${ID_DEL_ENUNCIADO}"[^>]*><div class="texto-banco[^"]*">`));
  });

  it("un texto con HTML sale escapado", () => {
    const hostil = pintar({ enCurso: pendiente("<img src=x onerror=alert(1)>", ["<b>a</b>", "b", "c", "d"]) });
    expect(hostil).not.toContain("<img");
    expect(hostil).not.toContain("<b>");
    expect(hostil).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("no hay títulos: el h1 lo pone Recorrido", () => {
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it("no muestra si acertó ni deja volver a una pregunta anterior", () => {
    const minusculas = html.toLowerCase();
    for (const palabra of ["correcta", "incorrecta", "acert", "anterior", "atrás", "volver"]) expect(minusculas, palabra).not.toContain(palabra);
  });
});

describe("Pregunta: botones y mensajes (criterios 5 y 6)", () => {
  it("«Responder» envía el formulario y «Cambiar de materia» es un botón, no un enlace", () => {
    const html = pintar();
    expect(html).toMatch(/<button type="submit"[^>]*>Responder<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>Cambiar de materia<\/button>/);
    expect(html).not.toContain("<a ");
  });

  it("el formulario no valida con el navegador: «Elige una opción» es del componente", () => {
    expect(pintar()).toMatch(/<form [^>]*noValidate=""/);
  });

  it("sin mensaje no hay ninguna alerta al cargar", () => {
    expect(pintar()).not.toContain('role="alert"');
  });

  it("un fallo al responder se anuncia con role=alert, junto a las opciones", () => {
    const html = pintar({ mensaje: TEXTOS.errorAlResponder });
    expect(html).toMatch(/<p role="alert" class="[^"]*">No pudimos guardar tu respuesta\. Inténtalo de nuevo\.<\/p>/);
    expect(html.indexOf("role=\"alert\"")).toBeGreaterThan(html.indexOf("radiogroup"));
    expect(html.indexOf("role=\"alert\"")).toBeLessThan(html.indexOf("Responder"));
  });

  it("mientras hay una llamada en curso «Responder» queda inactivo y «Cambiar de materia» deshabilitado (M28)", () => {
    const html = pintar({ ocupado: true });
    expect(html).toMatch(/<button type="submit"[^>]* aria-disabled="true"[^>]*>Responder<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]* disabled=""[^>]*>Cambiar de materia<\/button>/);
  });

  it("«Responder» no lleva `disabled` ni siquiera ocupado: con ese atributo el botón pierde el foco y el teclado no puede reintentar (M49)", () => {
    const boton = pintar({ ocupado: true }).match(/<button type="submit"[^>]*>Responder<\/button>/)?.[0] ?? "";
    expect(boton).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it("fuera de una llamada los botones están habilitados", () => {
    const html = pintar();
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-disabled");
  });
});
