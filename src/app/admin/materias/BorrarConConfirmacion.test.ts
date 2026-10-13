import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BorrarConConfirmacion, PasoDeBorrado } from "./BorrarConConfirmacion";

// HU-055 sin navegador ni servidor: se pinta el botón y el paso de confirmación y se lee el HTML. El paso se abre con un
// clic (estado del navegador), así que aquí se pinta por separado; el recorrido completo (botón, confirmación, redirección
// con «Borramos…») lo cubre e2e/materias.spec.ts con la base real. El foco inicial no sale en el HTML del servidor: se lee
// del elemento que el componente arma (`autoFocus`).

// Las acciones viven en el servidor: aquí no se llaman.
vi.mock("./acciones", () => ({ borrar: vi.fn(async () => ({ error: null })), borrarEvaluacion: vi.fn(async () => ({ error: null })) }));

const ID = "11111111-0000-4000-8000-000000000055";
const PREGUNTA = "¿Borrar la materia Cálculo Diferencial (MATE-1214)? No se puede deshacer.";

const botones = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, atributos, nombre]) => ({ atributos, nombre }));

/** Todos los elementos de un árbol de React, en orden. */
function elementos(nodo: ReactNode): ReactElement<{ children?: ReactNode; [propiedad: string]: unknown }>[] {
  if (!isValidElement<{ children?: ReactNode }>(nodo)) return [];
  return [nodo as ReactElement<{ children?: ReactNode }>, ...Children.toArray(nodo.props.children).flatMap(elementos)];
}

describe("BorrarConConfirmacion: el botón", () => {
  const pintar = (props: Partial<Parameters<typeof BorrarConConfirmacion>[0]> = {}) =>
    renderToStaticMarkup(createElement(BorrarConConfirmacion, { tipo: "materia", id: ID, pregunta: PREGUNTA, etiqueta: "Borrar materia", ...props }));

  it("es un único botón con la etiqueta, que no envía nada: solo abre la confirmación", () => {
    const html = pintar();
    const todos = botones(html);
    expect(todos).toHaveLength(1);
    expect(todos[0].nombre).toBe("Borrar materia");
    expect(todos[0].atributos).toContain('type="button"');
    expect(html).not.toContain('type="submit"');
  });

  it("todavía no pregunta ni muestra errores", () => {
    const html = pintar();
    expect(html).not.toContain("¿Borrar");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="group"');
  });

  it("lleva el id de lo que se borra en un campo oculto, y solo ese", () => {
    const html = pintar();
    expect(html).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="id"[^>]*value="${ID}"`));
    expect(html.match(/<input/g)).toHaveLength(1);
  });

  it("el botón de una evaluación se describe con el nombre de la evaluación, sin cambiar su nombre accesible", () => {
    const html = pintar({ tipo: "evaluacion", etiqueta: "Borrar", descritoPor: "evaluacion-abc" });
    expect(html).toMatch(/<button[^>]*aria-describedby="evaluacion-abc"[^>]*>Borrar<\/button>/);
    expect(html).not.toContain("aria-label");
  });
});

describe("PasoDeBorrado: la confirmación", () => {
  const props = { idPregunta: "pregunta", pregunta: PREGUNTA, error: null, enviando: false, alCancelar: () => {} };
  const pintar = (cambios: Partial<Parameters<typeof PasoDeBorrado>[0]> = {}) => renderToStaticMarkup(createElement(PasoDeBorrado, { ...props, ...cambios }));

  it("pregunta como la HU y ofrece «Sí, borrar» (envía) y «Cancelar» (no envía)", () => {
    const html = pintar();
    expect(html).toContain(`>${PREGUNTA}</p>`);
    const [si, no] = botones(html);
    expect(si.nombre).toBe("Sí, borrar");
    expect(si.atributos).toContain('type="submit"');
    expect(no.nombre).toBe("Cancelar");
    expect(no.atributos).toContain('type="button"');
    expect(botones(html)).toHaveLength(2);
  });

  it("es un grupo con la pregunta como nombre, para que un lector de pantalla la diga al entrar", () => {
    const html = pintar({ idPregunta: "p-1" });
    expect(html).toMatch(/<p id="p-1"/);
    expect(html).toMatch(/role="group"[^>]*aria-labelledby="p-1"|aria-labelledby="p-1"[^>]*role="group"/);
  });

  it("la pregunta de una evaluación es la de la HU", () => {
    const pregunta = "¿Borrar la evaluación Parcial 1? No se puede deshacer.";
    expect(pintar({ pregunta })).toContain(`>${pregunta}</p>`);
  });

  it("el foco empieza en «Cancelar», la salida segura, y no en «Sí, borrar»", () => {
    const botonesDelPaso = elementos(PasoDeBorrado(props)).filter((e) => e.type === "button");
    const cancelar = botonesDelPaso.find((e) => e.props.children === "Cancelar");
    const confirmar = botonesDelPaso.find((e) => e.props.children === "Sí, borrar");
    expect(cancelar?.props.autoFocus).toBe(true);
    expect(confirmar).toBeDefined();
    expect(confirmar?.props.autoFocus).toBeFalsy();
  });

  it("sin error no hay alerta; con error sale como alerta dentro del paso", () => {
    expect(pintar()).not.toContain('role="alert"');
    const html = pintar({ error: "Ya no se puede borrar: tiene certificados. Recarga la página." });
    expect(html).toMatch(/<p role="alert"[^>]*>Ya no se puede borrar: tiene certificados\. Recarga la página\.<\/p>/);
    // Dentro del grupo de la confirmación.
    expect(html.indexOf('role="alert"')).toBeGreaterThan(html.indexOf('role="group"'));
    expect(html.indexOf('role="alert"')).toBeLessThan(html.lastIndexOf("</div>"));
  });

  it("mientras se borra, avisa y no deja enviar ni desistir otra vez", () => {
    const [si, no] = botones(pintar({ enviando: true }));
    expect(si.nombre).toBe("Borrando…");
    expect(si.atributos).toContain("disabled");
    expect(no.atributos).toContain("disabled");
    const [sinEnviar] = botones(pintar({ enviando: false }));
    expect(sinEnviar.atributos).not.toContain("disabled");
  });
});
