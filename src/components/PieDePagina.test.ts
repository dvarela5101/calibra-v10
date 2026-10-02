import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PieDePagina } from "./PieDePagina";

describe("PieDePagina", () => {
  const html = renderToStaticMarkup(createElement(PieDePagina));
  const enlaces = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(([, href, nombre]) => [nombre, href]);

  it("lleva a todos el aviso de privacidad, Mis citas (HU-019, D-24) y Quiero ser monitor", () => {
    expect(enlaces).toEqual([
      ["Aviso de privacidad", "/privacidad"],
      ["Mis citas", "/cita"],
      ["Quiero ser monitor", "/quiero-ser-monitor"],
    ]);
  });
});
