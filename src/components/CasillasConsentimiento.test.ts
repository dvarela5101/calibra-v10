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

describe("CasillasConsentimiento para el aspirante a monitor (HU-062)", () => {
  const htmlAspirante = renderToStaticMarkup(createElement(CasillasConsentimiento, { variante: "aspirante" }));
  const casillasAspirante = [...htmlAspirante.matchAll(/<input[^>]*>/g)].map(([etiqueta]) => etiqueta);

  it("trae solo la casilla de tratamiento, desmarcada y obligatoria", () => {
    expect(casillasAspirante).toHaveLength(1);
    expect(casillasAspirante[0]).toContain('name="acepta_tratamiento_datos"');
    expect(casillasAspirante[0]).toMatch(/\srequired/);
    expect(casillasAspirante[0]).not.toMatch(/\schecked/);
  });

  it("enlaza al aviso y dice para qué: contactarlo y evaluar su certificación, no el diagnóstico", () => {
    expect(htmlAspirante).toContain('href="/privacidad"');
    expect(htmlAspirante).toContain("para contactarme y evaluar mi certificación como monitor");
    expect(htmlAspirante).not.toContain("diagnóstico");
  });

  it("si ya la había marcado y el envío volvió con otro error, sigue marcada", () => {
    const marcada = renderToStaticMarkup(createElement(CasillasConsentimiento, { variante: "aspirante", tratamientoMarcado: true }));
    expect(marcada).toMatch(/<input[^>]*name="acepta_tratamiento_datos"[^>]*\schecked/);
  });
});
