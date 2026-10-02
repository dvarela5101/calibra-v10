import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { esEnlaceHttps, ResumenDeCita, type DatosDeCita } from "./ResumenDeCita";

// El resumen de la reserva (HU-017) y de la cita confirmada (HU-019, D-5, D-21): sin navegador, se lee su HTML.

const BASE: DatosDeCita = {
  nombreMateria: "Cálculo Diferencial",
  nombreMonitor: "Laura Gómez",
  fecha: "2026-10-07",
  hora: "10:00:00",
  duracionMin: 60,
  presencial: true,
  valor: 32_000,
};

const pintar = (cambios: Partial<DatosDeCita> = {}) => renderToStaticMarkup(createElement(ResumenDeCita, { cita: { ...BASE, ...cambios } }));

describe("ResumenDeCita: sin lugar ni enlace (la reserva, antes de confirmarse)", () => {
  it("no trae las filas de lugar ni de videollamada", () => {
    const html = pintar();
    expect(html).not.toContain("Lugar");
    expect(html).not.toContain("videollamada");
    expect(html).toContain("Cálculo Diferencial");
    expect(html).toContain("Presencial");
  });

  it("vacíos o nulos tampoco las trae", () => {
    for (const html of [pintar({ lugar: null, enlace: null }), pintar({ lugar: "", enlace: "" })]) {
      expect(html).not.toContain("Lugar");
      expect(html).not.toContain("videollamada");
    }
  });
});

describe("ResumenDeCita: la cita confirmada (D-5)", () => {
  it("la presencial muestra el lugar", () => {
    const html = pintar({ lugar: "Edificio Santo Domingo, salón 301" });
    expect(html).toContain("<dt");
    expect(html).toMatch(/Lugar<\/dt><dd[^>]*>Edificio Santo Domingo, salón 301<\/dd>/);
  });

  it("la virtual muestra el enlace como https con rel seguro y que se abre aparte", () => {
    const html = pintar({ presencial: false, enlace: "https://meet.example/abc-defg-hij" });
    expect(html).toContain("Enlace de la videollamada");
    const enlace = /<a[^>]*>/.exec(html)?.[0] ?? "";
    expect(enlace).toContain('href="https://meet.example/abc-defg-hij"');
    expect(enlace).toContain('rel="noopener noreferrer"');
    expect(enlace).toContain('target="_blank"');
  });

  it.each(["javascript:alert(1)", "http://meet.example/a", "data:text/html,hola", "meet.example/a", "//meet.example/a", "no es un enlace"])(
    "un enlace que no es https (%s) no se pinta",
    (enlace) => {
      const html = pintar({ presencial: false, enlace });
      expect(html).not.toContain("<a");
      expect(html).not.toContain("videollamada");
    },
  );
});

describe("esEnlaceHttps", () => {
  it("solo acepta https", () => {
    expect(esEnlaceHttps("https://meet.example/a")).toBe(true);
    expect(esEnlaceHttps("HTTPS://meet.example/a")).toBe(true);
    for (const no of ["http://meet.example/a", "javascript:alert(1)", "ftp://meet.example", "", "https"]) expect(esEnlaceHttps(no), no).toBe(false);
  });
});
