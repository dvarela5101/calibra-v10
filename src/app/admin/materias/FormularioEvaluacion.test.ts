import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORES } from "@/lib/materias/reglas";
import type { EstadoEvaluacion } from "./acciones";
import { FormularioEvaluacion } from "./FormularioEvaluacion";

// HU-055 sin navegador ni servidor: el formulario de una evaluación, pintado con el estado que la acción devolvería
// (`useActionState` se reemplaza para elegirlo). El recorrido real lo cubre e2e/materias.spec.ts con la base.

const h = vi.hoisted(() => ({
  estado: { errores: {}, error: null, exito: null, valores: {} } as EstadoEvaluacion,
  enviando: false,
}));

vi.mock("react", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("react")>();
  return { ...real, useActionState: () => [h.estado, () => {}, h.enviando] };
});
// Las acciones viven en el servidor: aquí no se llaman.
vi.mock("./acciones", () => ({ guardarEvaluacion: vi.fn() }));

const ID = "e1e1e1e1-0000-4000-8000-000000000055";
const pintar = () => renderToStaticMarkup(createElement(FormularioEvaluacion, { evaluacion: { id: ID, nombre: "Parcial 1", semana: 8 }, idTitulo: `evaluacion-${ID}` }));
/** La etiqueta `<input>` con ese id. */
const entrada = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
const botones = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, atributos, nombre]) => ({ atributos, nombre }));

beforeEach(() => {
  h.estado = { errores: {}, error: null, exito: null, valores: {} };
  h.enviando = false;
});

describe("FormularioEvaluacion", () => {
  it("es un formulario con el título de la tarjeta como nombre, el id de la evaluación oculto y los campos con su valor guardado", () => {
    const html = pintar();
    expect(html).toMatch(new RegExp(`<form[^>]*aria-labelledby="evaluacion-${ID}"`));
    expect(html).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="id"[^>]*value="${ID}"`));
    expect(html).toMatch(new RegExp(`<label[^>]*for="evaluacion-nombre-${ID}"[^>]*>Nombre</label>`));
    expect(entrada(html, `evaluacion-nombre-${ID}`)).toContain('value="Parcial 1"');
    expect(html).toMatch(new RegExp(`<label[^>]*for="evaluacion-semana-${ID}"[^>]*>Semana</label>`));
    expect(entrada(html, `evaluacion-semana-${ID}`)).toContain('value="8"');
    expect(botones(html).map((b) => b.nombre)).toEqual(["Guardar evaluación"]);
  });

  it("solo manda nombre y semana: no hay campos para la clave, lo activo ni lo acumulativo", () => {
    const html = pintar();
    expect([...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["id", "nombre", "semana"]);
    expect(html).not.toMatch(/activa|acumulativo|clave/);
  });

  it("la semana es un campo de texto numérico: el navegador no cambia lo que se escribió", () => {
    const campo = entrada(pintar(), `evaluacion-semana-${ID}`);
    expect(campo).toContain('type="text"');
    expect(campo).toContain('inputMode="numeric"');
  });

  it("los campos conservan lo escrito que devolvió la acción", () => {
    h.estado = { errores: { semana: ERRORES.semana }, error: null, exito: null, valores: { nombre: "Otro nombre", semana: "0" } };
    const html = pintar();
    expect(entrada(html, `evaluacion-nombre-${ID}`)).toContain('value="Otro nombre"');
    expect(entrada(html, `evaluacion-semana-${ID}`)).toContain('value="0"');
  });

  it("un error de campo sale junto al campo, como alerta, con aria-describedby y aria-invalid", () => {
    h.estado = {
      errores: { nombre: ERRORES.nombreDeEvaluacionRepetido, semana: ERRORES.semana },
      error: null,
      exito: null,
      valores: { nombre: "Parcial 2", semana: "0" },
    };
    const html = pintar();
    const nombre = entrada(html, `evaluacion-nombre-${ID}`);
    expect(nombre).toContain('aria-invalid="true"');
    expect(nombre).toContain(`aria-describedby="evaluacion-nombre-${ID}-error"`);
    expect(html).toMatch(new RegExp(`<p id="evaluacion-nombre-${ID}-error" role="alert"[^>]*>Ya hay una evaluación con ese nombre en esta materia\.</p>`));
    const semana = entrada(html, `evaluacion-semana-${ID}`);
    expect(semana).toContain('aria-invalid="true"');
    expect(semana).toContain(`aria-describedby="evaluacion-semana-${ID}-error"`);
    expect(html).toMatch(new RegExp(`<p id="evaluacion-semana-${ID}-error" role="alert"[^>]*>La semana es un número entero mayor que 0\.</p>`));
  });

  it("el error general sale como alerta y el éxito como estado", () => {
    h.estado = { errores: {}, error: "No pudimos guardar los cambios. Intenta de nuevo.", exito: null, valores: { nombre: "X", semana: "3" } };
    expect(pintar()).toMatch(/<p role="alert"[^>]*>No pudimos guardar los cambios\. Intenta de nuevo\.<\/p>/);
    h.estado = { errores: {}, error: null, exito: "Cambios guardados.", valores: { nombre: "Parcial 1", semana: "8" } };
    expect(pintar()).toMatch(/<p role="status"[^>]*>Cambios guardados\.<\/p>/);
  });

  it("mientras envía, el botón dice «Guardando…» y está inhabilitado", () => {
    h.enviando = true;
    const [boton] = botones(pintar());
    expect(boton.nombre).toBe("Guardando…");
    expect(boton.atributos).toContain("disabled");
  });
});
