import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrecioConOferta } from "./PrecioConOferta";

// HU-119 (D-85 b): el precio de una oferta desde el listado.

const pintar = (precio: number) => renderToStaticMarkup(createElement(PrecioConOferta, { precio }));
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("PrecioConOferta", () => {
  it("muestra la etiqueta de oferta, el precio normal tachado y «Gratis»", () => {
    const html = pintar(55000);
    expect(html).toContain("Oferta · 100 % de descuento");
    expect(html).toMatch(/<del[^>]*>.*55\.000.*<\/del>/);
    expect(html).toContain("Gratis");
    expect(texto(html)).toContain("Precio normal:");
  });

  it("nunca dice «prueba»: esa palabra es del admin", () => {
    expect(texto(pintar(20000))).not.toMatch(/prueba/i);
  });
});
