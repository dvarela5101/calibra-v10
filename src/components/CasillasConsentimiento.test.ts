import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CasillasConsentimiento } from "./CasillasConsentimiento";

// El formulario de contacto (HU-010) usa estas casillas; aquí se lee su HTML sin navegador.
const html = renderToStaticMarkup(createElement(CasillasConsentimiento));
const casillas = [...html.matchAll(/<input[^>]*>/g)].map(([etiqueta]) => etiqueta);
const casilla = (nombre: string) => casillas.find((etiqueta) => etiqueta.includes(`name="${nombre}"`)) ?? "";

describe("CasillasConsentimiento", () => {
  it("trae dos casillas separadas, las dos desmarcadas", () => {
    expect(casillas).toHaveLength(2);
    for (const etiqueta of casillas) {
      expect(etiqueta).toContain('type="checkbox"');
      expect(etiqueta).not.toMatch(/\schecked/);
    }
  });

  it("la de tratamiento es obligatoria y la de contacto comercial es opcional", () => {
    expect(casilla("acepta_tratamiento_datos")).toMatch(/\srequired/);
    expect(casilla("acepta_contacto")).not.toMatch(/\srequired/);
  });

  it("la de tratamiento enlaza al aviso y dice que el diagnóstico se comparte con el monitor", () => {
    expect(html).toContain('href="/privacidad"');
    expect(html).toContain("compartir el resultado de mi diagnóstico con el monitor");
  });
});
