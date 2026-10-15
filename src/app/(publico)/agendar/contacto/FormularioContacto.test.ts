import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CORREO_FIJO } from "@/lib/leads/avisos";
import { FormularioContacto } from "./FormularioContacto";

// Sin navegador: el formulario de contacto (HU-068) con las props que HU-032 le suma (`accion`, `textoDelBoton`,
// `ayudaDelCorreo` y `correoFijo`). Sin ellas, es el de siempre; con `correoFijo`, el correo se ve sin poder editarlo.

// La acción vive en el servidor y el formulario es del navegador: aquí solo se pinta.
vi.mock("./acciones", () => ({ dejarContacto: async () => ({ error: null, aviso: null, valores: {} }) }));

const INICIALES = { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numero_telefono: "+573001234567" };
const accion = async () => ({ error: null, aviso: null, valores: {} });

const pintar = (props: Partial<Parameters<typeof FormularioContacto>[0]> = {}) =>
  renderToStaticMarkup(createElement(FormularioContacto, { siguiente: "/", iniciales: INICIALES, ...props }));

/** La etiqueta `<input>` del correo. */
const entradaDelCorreo = (html: string) => /<input[^>]*id="correo"[^>]*>/.exec(html)?.[0] ?? "";

describe("FormularioContacto: los valores por defecto son los de agendar", () => {
  const html = pintar();

  it("dice «Seguir» y que ahí llega la confirmación de la cita", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Seguir<\/button>/);
    expect(html).toContain("Ahí te llega la confirmación de tu cita.");
    expect(html).not.toContain(CORREO_FIJO);
  });

  it("el correo se puede editar", () => {
    expect(entradaDelCorreo(html)).not.toContain("readOnly");
    expect(entradaDelCorreo(html)).toContain('value="camila@uniandes.edu.co"');
  });
});

describe("FormularioContacto: el texto del botón y la ayuda del correo (HU-032, /cuenta/crear)", () => {
  it("usa los que le pasan", () => {
    const html = pintar({ accion, textoDelBoton: "Crear mi cuenta", ayudaDelCorreo: "Ahí te llega el correo para confirmar tu cuenta." });

    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Crear mi cuenta<\/button>/);
    expect(html).toContain("Ahí te llega el correo para confirmar tu cuenta.");
    expect(html).not.toContain("Ahí te llega la confirmación de tu cita.");
    expect(html).not.toContain(">Seguir<");
  });
});

describe("FormularioContacto: el correo fijo de un Estudiante (D-55 b, HU-032)", () => {
  const html = pintar({ correoFijo: true });

  it("muestra el correo de la cuenta sin poder editarlo, y el campo viaja en el envío", () => {
    const entrada = entradaDelCorreo(html);
    expect(entrada).toContain("readOnly");
    expect(entrada).toContain('name="correo"');
    expect(entrada).toContain('value="camila@uniandes.edu.co"');
    expect(entrada).not.toContain("disabled");
  });

  it("dice por qué: es el de su cuenta y lo cambia soporte", () => {
    expect(html).toContain("Tu correo es el de tu cuenta y no se puede cambiar aquí. Si necesitas cambiarlo, escribe a soporte.");
    expect(html).not.toContain("Ahí te llega la confirmación de tu cita.");
  });

  it("el nombre y el teléfono siguen editables", () => {
    for (const id of ["nombre", "numero_telefono"]) {
      const entrada = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(entrada, id).not.toContain("readOnly");
    }
  });
});
