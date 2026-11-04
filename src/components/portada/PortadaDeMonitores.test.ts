import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortadaDeMonitores } from "./PortadaDeMonitores";

// HU-121 (D-87): el HTML de la landing con el ejemplo y sin él. Intl separa el signo de pesos con un espacio duro.
const GANANCIA = { porMonitoria: { laura: 22_500, santiago: 31_500, camila: 27_000 }, porSemana: 81_000, porCuatroSemanas: 324_000 };

const pintar = (ganancia: typeof GANANCIA | null) =>
  renderToStaticMarkup(createElement(PortadaDeMonitores, { materias: ["Física I"], parametros: null, ganancia, solicitud: null })).replace(/\xa0|&nbsp;/g, " ");

/** Lo que lee una persona: sin etiquetas. */
const textoDe = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("PortadaDeMonitores con el ejemplo (HU-121)", () => {
  const texto = textoDe(pintar(GANANCIA));

  it("el hero lleva el titular y la bajada de la HU", () => {
    expect(texto).toContain("Gana plata enseñando lo que ya dominas, y llega sabiendo qué explicar.");
    expect(texto).toContain("Tú pones tus horarios y tu precio. Los estudiantes te encuentran en Calibra, que revisa los pagos y te muestra el diagnóstico antes de cada sesión.");
  });

  it("la tarjeta dice lo de cada monitoría y el total, y la sección suma las cuatro semanas", () => {
    for (const monto of ["$ 22.500", "$ 31.500", "$ 27.000"]) expect(texto).toContain(`Recibes ${monto}`);
    expect(texto).toContain("Por estas tres monitorías recibes $ 81.000");
    expect(texto).toContain("Ejemplo con precios de muestra");
    expect(texto).toContain("A la semana $ 81.000");
    expect(texto).toContain("En cuatro semanas $ 324.000");
  });

  it("dice que es una muestra, que cada monitor pone sus precios y que depende de cuántos estudiantes agenden", () => {
    expect(texto).toContain("Los precios son de muestra y cada monitor pone los suyos.");
    expect(texto).toContain("Lo que recibas depende de cuántos estudiantes te agenden.");
  });

  it("no da el porcentaje, el tope, la parte de Calibra ni la palabra", () => {
    expect(texto).not.toMatch(/comisi[oó]n|bruto|\d\s?%/i);
    expect(texto).not.toMatch(/\$ (2\.500|3\.500|3\.000|9\.000|36\.000|15\.000)\b/);
  });

  it("«Tus horarios» y la tarjeta usan los mismos precios y los mismos días", () => {
    expect(texto).toContain("Domingo, 10:00 a. m.");
    expect(texto).toContain("$ 30.000");
    expect(texto).not.toContain("Sáb");
  });
});

describe("PortadaDeMonitores sin los parámetros (HU-121)", () => {
  const texto = textoDe(pintar(null));

  it("no muestra ningún monto de lo que se recibe, y el resto de la página sale", () => {
    expect(texto).not.toMatch(/recibes|Cuánto recibirías|22\.500|31\.500|27\.000|81\.000|324\.000/i);
    expect(texto).toContain("Gana plata enseñando");
    expect(texto).toContain("Tus próximas monitorías");
    expect(texto).toContain("Cómo llegas a tu primera monitoría");
  });
});
