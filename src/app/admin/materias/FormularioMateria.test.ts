import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AVISO_DEL_CODIGO, ERRORES } from "@/lib/materias/reglas";
import type { EstadoMateria } from "./acciones";
import { CampoDelCodigo, FormularioMateria } from "./FormularioMateria";

// HU-055 sin navegador ni servidor: el formulario de crear y de corregir una materia, pintado con el estado que la
// acción devolvería (`useActionState` se reemplaza para elegirlo). El recorrido real (escribir, enviar, ver el resultado)
// lo cubre e2e/materias.spec.ts con la base. El aviso del código depende de lo que se va escribiendo: se pinta
// `CampoDelCodigo` con un valor inicial que ya difiere del guardado, que es lo mismo que pasa tras un envío con error.

const h = vi.hoisted(() => ({
  estado: { errores: {}, error: null, exito: null, valores: {} } as EstadoMateria,
  enviando: false,
}));

vi.mock("react", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("react")>();
  return { ...real, useActionState: () => [h.estado, () => {}, h.enviando] };
});
// Las acciones viven en el servidor: aquí no se llaman.
vi.mock("./acciones", () => ({ crear: vi.fn(), guardar: vi.fn() }));

const MATERIA = { id: "11111111-0000-4000-8000-000000000055", nombre: "Cálculo Diferencial", codigo: "MATE-1214" };

/** La etiqueta `<input>` con ese id. */
const entrada = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
const botones = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, atributos, nombre]) => ({ atributos, nombre }));
const pintarCrear = () => renderToStaticMarkup(createElement(FormularioMateria, { modo: "crear" }));
const pintarEditar = () => renderToStaticMarkup(createElement(FormularioMateria, { modo: "editar", materia: MATERIA }));

beforeEach(() => {
  h.estado = { errores: {}, error: null, exito: null, valores: {} };
  h.enviando = false;
});

describe("FormularioMateria: crear", () => {
  it("vacío, con «Nombre» y «Código» con su ayuda, y el botón «Crear materia»", () => {
    const html = pintarCrear();
    expect(html).toMatch(/<label[^>]*for="nueva-materia-nombre"[^>]*>Nombre<\/label>/);
    expect(html).toMatch(/<label[^>]*for="nueva-materia-codigo"[^>]*>Código<\/label>/);
    expect(entrada(html, "nueva-materia-nombre")).toContain('value=""');
    expect(entrada(html, "nueva-materia-codigo")).toContain('value=""');
    expect(html).toContain("Cuatro letras, un guion y cuatro números, como MATE-1214.");
    expect(botones(html).map((b) => b.nombre)).toEqual(["Crear materia"]);
    expect(html).not.toContain('name="id"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it("los campos conservan lo escrito que devolvió la acción", () => {
    h.estado = { errores: { codigo: ERRORES.codigo }, error: null, exito: null, valores: { nombre: "Cálculo", codigo: "mate-12" } };
    const html = pintarCrear();
    expect(entrada(html, "nueva-materia-nombre")).toContain('value="Cálculo"');
    expect(entrada(html, "nueva-materia-codigo")).toContain('value="mate-12"');
  });

  it("un error de campo sale junto al campo, como alerta, unido con aria-describedby y aria-invalid", () => {
    h.estado = {
      errores: { nombre: ERRORES.nombreDeMateria, codigo: "Ya existe una materia con ese código: Álgebra." },
      error: null,
      exito: null,
      valores: { nombre: "", codigo: "MATE-1105" },
    };
    const html = pintarCrear();
    const nombre = entrada(html, "nueva-materia-nombre");
    expect(nombre).toContain('aria-invalid="true"');
    expect(nombre).toContain('aria-describedby="nueva-materia-nombre-error"');
    expect(html).toMatch(/<p id="nueva-materia-nombre-error" role="alert"[^>]*>Escribe el nombre de la materia\.<\/p>/);
    const codigo = entrada(html, "nueva-materia-codigo");
    expect(codigo).toContain('aria-invalid="true"');
    expect(codigo).toContain('aria-describedby="nueva-materia-codigo-ayuda nueva-materia-codigo-error"');
    expect(html).toMatch(/<p id="nueva-materia-codigo-error" role="alert"[^>]*>Ya existe una materia con ese código: Álgebra\.<\/p>/);
  });

  it("sin errores, los campos no se marcan como inválidos", () => {
    expect(pintarCrear()).not.toContain("aria-invalid");
  });

  it("el error general sale como alerta y el éxito como estado, con los textos de la acción", () => {
    h.estado = { errores: {}, error: "No pudimos guardar los cambios. Intenta de nuevo.", exito: null, valores: { nombre: "X", codigo: "MATE-1214" } };
    expect(pintarCrear()).toMatch(/<p role="alert"[^>]*>No pudimos guardar los cambios\. Intenta de nuevo\.<\/p>/);
    h.estado = { errores: {}, error: null, exito: "Creamos la materia X (MATE-1214).", valores: {} };
    expect(pintarCrear()).toMatch(/<p role="status"[^>]*>Creamos la materia X \(MATE-1214\)\.<\/p>/);
  });

  it("mientras envía, el botón dice «Creando…» y está inhabilitado", () => {
    h.enviando = true;
    const [boton] = botones(pintarCrear());
    expect(boton.nombre).toBe("Creando…");
    expect(boton.atributos).toContain("disabled");
  });
});

describe("FormularioMateria: corregir", () => {
  it("trae el nombre y el código guardados, el id oculto y «Guardar cambios»", () => {
    const html = pintarEditar();
    expect(entrada(html, "materia-nombre")).toContain('value="Cálculo Diferencial"');
    expect(entrada(html, "materia-codigo")).toContain('value="MATE-1214"');
    expect(html).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="id"[^>]*value="${MATERIA.id}"`));
    expect(botones(html).map((b) => b.nombre)).toEqual(["Guardar cambios"]);
  });

  it("mientras envía, el botón dice «Guardando…»", () => {
    h.enviando = true;
    expect(botones(pintarEditar())[0].nombre).toBe("Guardando…");
  });

  it("el éxito sale como estado: «Cambios guardados.»", () => {
    h.estado = { errores: {}, error: null, exito: "Cambios guardados.", valores: { nombre: "Cálculo Diferencial", codigo: "MATE-1214" } };
    expect(pintarEditar()).toMatch(/<p role="status"[^>]*>Cambios guardados\.<\/p>/);
  });

  it("sin cambios en el código, no avisa de nada", () => {
    expect(pintarEditar()).not.toContain(AVISO_DEL_CODIGO);
  });

  it("tras un envío con error con otro código escrito, los campos traen lo escrito y avisa del código", () => {
    h.estado = { errores: { nombre: ERRORES.nombreDeMateria }, error: null, exito: null, valores: { nombre: "", codigo: "mate-1215" } };
    const html = pintarEditar();
    expect(entrada(html, "materia-codigo")).toContain('value="mate-1215"');
    expect(html).toContain(AVISO_DEL_CODIGO);
  });
});

describe("CampoDelCodigo: el aviso de que cambiar el código afecta los enlaces", () => {
  const pintar = (inicial: string, guardado: string | undefined, error?: string) =>
    renderToStaticMarkup(createElement(CampoDelCodigo, { prefijo: "m", inicial, guardado, error }));

  it("aparece, como estado, en cuanto el código difiere del guardado", () => {
    const html = pintar("MATE-1215", "MATE-1214");
    expect(html).toMatch(/<p id="m-codigo-aviso" role="status"[^>]*>Los enlaces con el código anterior dejarán de encontrar esta materia\.<\/p>/);
    expect(html).toMatch(/aria-describedby="m-codigo-ayuda m-codigo-aviso"/);
  });

  it("no aparece si el código es el guardado, aunque llegue en minúsculas o con espacios", () => {
    for (const inicial of ["MATE-1214", "mate-1214", " MATE-1214 "]) {
      expect(pintar(inicial, "MATE-1214"), inicial).not.toContain(AVISO_DEL_CODIGO);
    }
    expect(pintar("PRB-2", " prb-2 ")).not.toContain(AVISO_DEL_CODIGO);
  });

  it("aparece si se borra el código", () => {
    expect(pintar("", "MATE-1214")).toContain(AVISO_DEL_CODIGO);
  });

  it("al crear (sin código guardado) nunca aparece", () => {
    expect(pintar("MATE-1215", undefined)).not.toContain(AVISO_DEL_CODIGO);
  });

  it("junto a un error de campo, los dos van unidos al campo", () => {
    const html = pintar("MATE-1215", "MATE-1214", "Ya existe una materia con ese código.");
    expect(html).toMatch(/aria-describedby="m-codigo-ayuda m-codigo-error m-codigo-aviso"/);
  });
});
