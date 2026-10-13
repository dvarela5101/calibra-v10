import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MateriaConEvaluaciones } from "@/lib/diagnostico/pantalla";
import { proyectarEnCurso, type EnCurso } from "@/lib/diagnostico/reglas";
import { EvaluacionesDeLaMateria, SelectorDeMateria } from "./SelectorDeMateria";

// HU-009: el marcado del selector. Elegir, validar y «Empezar» son comportamiento del navegador (la e2e); aquí se fija lo que se
// ve: qué materias, cómo se reconoce cada Evaluación, los avisos y los mensajes.

const evaluacion = (id: string, nombre: string, temas: string[], semana = 4) => ({ id, nombre, semana, temas });

const FISICA: MateriaConEvaluaciones = {
  codigo: "FISI-1018",
  nombre: "Física II",
  evaluaciones: [evaluacion("e1", "Parcial 1", ["Cinemática", "Dinámica y Energía"])],
};
const CALCULO: MateriaConEvaluaciones = {
  codigo: "MATE-1214",
  nombre: "Cálculo Integral",
  evaluaciones: [evaluacion("e2", "Parcial 1", ["Integrales"]), evaluacion("e3", "Parcial 2", ["Series", "Sucesiones", "Límites"], 8)],
};

const EN_CURSO: EnCurso = proyectarEnCurso({
  idDiagnostico: "d1000000-0000-4000-8000-000000000001",
  evaluacion: { id: "e1", nombre: "Parcial 1" },
  materia: { codigo: "FISI-1018", nombre: "Física II" },
  paso: 2,
  maximo: 8,
  pregunta: { enunciado: "x", opciones: (["A", "B", "C", "D"] as const).map((letra) => ({ letra, texto: letra })) },
});

const pintar = (cambios: Partial<Parameters<typeof SelectorDeMateria>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SelectorDeMateria, {
      materias: [FISICA, CALCULO],
      enCurso: null,
      mensaje: null,
      pendiente: false,
      ocupado: false,
      alEmpezar: vi.fn(),
      alVolver: vi.fn(),
      ...cambios,
    }),
  );

/** El texto visible, con los espacios normalizados y sin comentarios de React. */
const texto = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("SelectorDeMateria: con materias", () => {
  const html = pintar();

  it("una tarjeta con radio por materia, con el código como valor, y ninguna elegida", () => {
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*name="materia"[^>]*>/g)].map(([radio]) => radio);
    expect(radios).toHaveLength(2);
    expect(radios.map((radio) => radio.match(/value="([^"]+)"/)?.[1])).toEqual(["FISI-1018", "MATE-1214"]);
    expect(html).not.toContain("checked");
    expect(texto(html)).toContain("Física II");
    expect(texto(html)).toContain("Cálculo Integral");
  });

  it("el grupo de materias se nombra «Materia»", () => {
    expect(html).toMatch(/<p id="grupo-de-materias"[^>]*>Materia<\/p>/);
    expect(html).toContain('<div role="radiogroup" aria-labelledby="grupo-de-materias"');
  });

  it("no pide ningún dato: solo radios y el botón «Empezar»", () => {
    const entradas = [...html.matchAll(/<input[^>]*>/g)].map(([entrada]) => entrada);
    expect(entradas.length).toBeGreaterThan(0);
    for (const entrada of entradas) expect(entrada).toContain('type="radio"');
    for (const tipo of ["text", "email", "tel", "password", "checkbox"]) expect(html, tipo).not.toContain(`type="${tipo}"`);
    expect(html).not.toContain("<textarea");
    expect(html).toMatch(/<button type="submit"[^>]*>Empezar<\/button>/);
  });

  it("debajo, «¿No ves tu materia? Mira los monitores» con el enlace a la lista", () => {
    expect(texto(html)).toContain("¿No ves tu materia? Mira los monitores");
    expect(html).toMatch(/<a [^>]*href="\/monitores"[^>]*>Mira los monitores<\/a>/);
    expect(html.indexOf("Mira los monitores")).toBeGreaterThan(html.indexOf("Empezar"));
  });

  it("al cargar no hay Evaluaciones ni alertas: primero se elige la materia", () => {
    expect(html).not.toContain("grupo-de-evaluaciones");
    expect(html).not.toContain("Temas:");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it("el formulario no valida con el navegador: «Elige una materia» es del componente", () => {
    expect(html).toMatch(/<form [^>]*noValidate=""/);
  });
});

describe("SelectorDeMateria: avisos y mensajes", () => {
  it("con un diagnóstico en curso avisa que empezar otra Evaluación lo descarta, con la materia delante", () => {
    const html = pintar({ enCurso: EN_CURSO });
    expect(html).toMatch(/<p role="status" class="[^"]*">Llevas un diagnóstico de Física II · Parcial 1\. Si empiezas otro de otra Evaluación, se descarta este\.<\/p>/);
  });

  it("sin diagnóstico en curso no hay aviso", () => {
    expect(pintar()).not.toContain("Llevas un diagnóstico");
  });

  it("un mensaje (vencido, reemplazado o Evaluación apagada) se anuncia con role=alert", () => {
    const html = pintar({ mensaje: "Ese diagnóstico ya no está. Empieza uno nuevo." });
    expect(html).toMatch(/<p role="alert" class="[^"]*">Ese diagnóstico ya no está\. Empieza uno nuevo\.<\/p>/);
  });

  it("el aviso de lo que sigue en curso y el mensaje salen juntos", () => {
    const t = texto(pintar({ enCurso: EN_CURSO, mensaje: "Esa evaluación no está disponible" }));
    expect(t).toContain("Llevas un diagnóstico de Física II · Parcial 1");
    expect(t).toContain("Esa evaluación no está disponible");
  });

  it("mientras hay una llamada el botón dice «Empezando…» y queda inactivo", () => {
    const html = pintar({ pendiente: true, ocupado: true });
    expect(html).toMatch(/<button type="submit"[^>]* aria-disabled="true"[^>]*>Empezando…<\/button>/);
  });

  it("ocupado sin llamada (ya va al resultado) deja el botón inactivo", () => {
    expect(pintar({ ocupado: true })).toMatch(/<button type="submit"[^>]* aria-disabled="true"[^>]*>Empezar<\/button>/);
  });

  it("«Empezar» no lleva `disabled` ocupado: con ese atributo pierde el foco y el teclado no puede reintentar tras un fallo (M49)", () => {
    const boton = pintar({ pendiente: true, ocupado: true }).match(/<button type="submit"[^>]*>Empezando…<\/button>/)?.[0] ?? "";
    expect(boton).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it("fuera de una llamada el botón está habilitado", () => {
    const html = pintar();
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-disabled");
  });
});

describe("SelectorDeMateria: volver a la pregunta pendiente (M51)", () => {
  const boton = /<button type="button"[^>]*>Volver a mi pregunta<\/button>/;

  it("con un diagnóstico en curso hay un botón «Volver a mi pregunta» que no envía el formulario", () => {
    expect(pintar({ enCurso: EN_CURSO })).toMatch(boton);
  });

  it("sin diagnóstico en curso no hay a qué volver", () => {
    expect(pintar()).not.toContain("Volver a mi pregunta");
    expect(pintar({ materias: [] })).not.toContain("Volver a mi pregunta");
  });

  it("mientras hay una llamada el botón queda deshabilitado: no se vuelve a una pregunta que la llamada va a cambiar", () => {
    expect(pintar({ enCurso: EN_CURSO, ocupado: true })).toMatch(/<button type="button"[^>]* disabled=""[^>]*>Volver a mi pregunta<\/button>/);
    expect(pintar({ enCurso: EN_CURSO })).not.toContain("disabled");
  });
});

describe("SelectorDeMateria: sin materias", () => {
  const html = pintar({ materias: [] });

  it("dice «Todavía no hay diagnósticos disponibles» y deja el enlace a los monitores", () => {
    expect(texto(html)).toContain("Todavía no hay diagnósticos disponibles");
    expect(texto(html)).toContain("¿No ves tu materia? Mira los monitores");
    expect(html).toMatch(/<a [^>]*href="\/monitores"[^>]*>Mira los monitores<\/a>/);
  });

  it("no hay formulario ni botón «Empezar»", () => {
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Empezar");
    expect(html).not.toContain("<input");
  });

  it("sigue mostrando el mensaje", () => {
    const con = pintar({ materias: [], mensaje: "Esa evaluación no está disponible" });
    expect(con).toMatch(/<p role="alert"[^>]*>Esa evaluación no está disponible<\/p>/);
  });

  it("con un diagnóstico en curso no avisa de un descarte que no puede pasar y ofrece volver a su pregunta (M51)", () => {
    // Sin materias no hay otra Evaluación que empezar: «si empiezas otro se descarta este» promete algo que no se puede hacer.
    const con = pintar({ materias: [], enCurso: EN_CURSO, mensaje: "Esa evaluación no está disponible" });
    expect(con).not.toContain("Llevas un diagnóstico");
    expect(con).not.toContain("se descarta");
    expect(con).not.toContain('role="status"');
    expect(con).toMatch(/<button type="button"[^>]*>Volver a mi pregunta<\/button>/);
    expect(texto(con)).toContain("Todavía no hay diagnósticos disponibles");
    expect(con).toMatch(/<p role="alert"[^>]*>Esa evaluación no está disponible<\/p>/);
    // La salida va antes de la línea de monitores y no es un formulario: no hay nada que enviar.
    expect(con.indexOf("Volver a mi pregunta")).toBeLessThan(con.indexOf("Mira los monitores"));
    expect(con).not.toContain("<form");
  });
});

describe("EvaluacionesDeLaMateria (criterio 2): cada Evaluación se reconoce por su nombre y sus temas", () => {
  const pintarEvaluaciones = (evaluaciones: MateriaConEvaluaciones["evaluaciones"], elegida = null as MateriaConEvaluaciones["evaluaciones"][number] | null) =>
    renderToStaticMarkup(createElement(EvaluacionesDeLaMateria, { evaluaciones, elegida, alElegir: vi.fn() }));

  it("con una sola, el bloque ya elegido: su nombre y «Temas: …», sin radio", () => {
    const html = pintarEvaluaciones(FISICA.evaluaciones, FISICA.evaluaciones[0]);
    expect(texto(html)).toContain("Evaluación Parcial 1 Temas: Cinemática y Dinámica y Energía");
    expect(html).not.toContain("<input");
    expect(html).toContain('<div role="group" aria-labelledby="grupo-de-evaluaciones"');
  });

  it("con varias, una tarjeta con radio por Evaluación, cada una con su nombre y sus temas (M43)", () => {
    const html = pintarEvaluaciones(CALCULO.evaluaciones);
    const etiquetas = (html.match(/<label [^>]*>.*?<\/label>/g) ?? []).map(texto);
    expect(etiquetas).toEqual(["Parcial 1 Temas: Integrales", "Parcial 2 Temas: Series, Sucesiones y Límites"]);
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(([radio]) => radio);
    expect(radios).toHaveLength(2);
    expect(radios.map((radio) => radio.match(/value="([^"]+)"/)?.[1])).toEqual(["e2", "e3"]);
    for (const radio of radios) expect(radio).toContain('name="evaluacion"');
    expect(html).toContain('<div role="radiogroup" aria-labelledby="grupo-de-evaluaciones"');
  });

  it("la elegida sale marcada y la otra no", () => {
    const html = pintarEvaluaciones(CALCULO.evaluaciones, CALCULO.evaluaciones[1]);
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(([radio]) => radio);
    expect(radios[0]).not.toContain("checked");
    expect(radios[1]).toContain('checked=""');
  });

  it("una Evaluación sin temas no dice «Temas:»", () => {
    const html = pintarEvaluaciones([evaluacion("e9", "Final", [])], null);
    expect(texto(html)).toContain("Final");
    expect(html).not.toContain("Temas");
  });

  it("sin Evaluaciones no dibuja nada", () => {
    expect(pintarEvaluaciones([])).toBe("");
  });
});
