import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ascendientes, elementosHijos, leerHtml, porClase, porEtiqueta, textoDe, type Nodo } from "../../../pruebas/arbol-html";
import { filaDeEjemplo, preguntasDeEjemplo } from "../../../pruebas/vista-del-monitor-ejemplo";
import { leerVistaDelMonitor, TEXTOS, type PreguntaDelMonitor } from "@/lib/diagnostico/vista-del-monitor";
import { PreguntasDelDiagnostico } from "./PreguntasDelDiagnostico";

// HU-022, punto 8 (D-54 c): las preguntas que respondió el estudiante, para el monitor. Se lee el HTML (`renderToStaticMarkup`).

const PREGUNTAS = leerVistaDelMonitor([filaDeEjemplo()])!.diagnostico!.preguntas!;

const pintar = (preguntas: PreguntaDelMonitor[] | null) => renderToStaticMarkup(createElement(PreguntasDelDiagnostico, { preguntas }));

/** Las tarjetas de pregunta, en el orden en que salen. */
const tarjetasDe = (html: string): Nodo[] => elementosHijos(porEtiqueta(leerHtml(html), "ol")[0]);
/** Las opciones de una tarjeta. */
const opcionesDe = (tarjeta: Nodo): Nodo[] => elementosHijos(porEtiqueta(tarjeta, "ul")[0]);
/** Las marcas escritas de una opción («Eligió», «Correcta»), en el orden en que salen. */
const marcasDe = (opcion: Nodo): string[] => porClase(opcion, "marcas").flatMap((m) => elementosHijos(m).map(textoDe));
const letraDe = (opcion: Nodo): string => textoDe(porClase(opcion, "letra")[0]);
/**
 * Las clases de estado de una opción (`elegida`, `laCorrecta`), en el orden en que salen, sin el prefijo ni el sufijo que le pone el
 * módulo de estilos. `opcion` es la base de toda opción y no cuenta como estado.
 */
const clasesDe = (opcion: Nodo): string[] =>
  (opcion.atributos.class ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => ["elegida", "laCorrecta", "opcion"].find((nombre) => c === nombre || c.includes(`_${nombre}_`)) ?? c)
    .filter((c) => c !== "opcion");

describe("las ocho preguntas (criterio 14)", () => {
  const html = pintar(PREGUNTAS);
  const tarjetas = tarjetasDe(html);

  it("salen todas, en el orden en que las respondió, cada una con su encabezado «Pregunta N»", () => {
    expect(tarjetas).toHaveLength(8);
    tarjetas.forEach((tarjeta, i) => {
      expect(textoDe(porEtiqueta(tarjeta, "h3")[0])).toMatch(new RegExp(`^Pregunta ${i + 1} (Acertó|Falló)$`));
      expect(textoDe(porClase(tarjeta, "enunciado")[0])).toBe(`Enunciado de la pregunta ${i + 1}`);
    });
  });

  it("3 dicen «Falló» y 5 «Acertó», en texto y en el mismo encabezado (M48)", () => {
    const marcas = tarjetas.map((t) => textoDe(porEtiqueta(t, "h3")[0]).replace(/^Pregunta \d+ /, ""));
    expect(marcas).toEqual(["Acertó", "Falló", "Acertó", "Falló", "Acertó", "Falló", "Acertó", "Acertó"]);
    expect(html.match(/>Falló</g)).toHaveLength(3);
    expect(html.match(/>Acertó</g)).toHaveLength(5);
  });

  it("las cuatro opciones salen en el orden en que las vio, con su letra de A a D", () => {
    tarjetas.forEach((tarjeta, i) => {
      const opciones = opcionesDe(tarjeta);
      expect(opciones.map(letraDe)).toEqual(["A", "B", "C", "D"]);
      expect(opciones.map((o) => textoDe(porClase(o, "textoDeOpcion")[0]))).toEqual(["A", "B", "C", "D"].map((l) => `Opción ${l} de la pregunta ${i + 1}`));
    });
  });

  it("la que eligió lleva «Eligió» y la correcta «Correcta», escritas; una misma opción puede llevar las dos (M49)", () => {
    // Pregunta 1: eligió B y B es la correcta. Pregunta 2: eligió A y la correcta es C.
    const [p1, p2] = tarjetas.map(opcionesDe);
    expect(p1.map(marcasDe)).toEqual([[], ["Eligió", "Correcta"], [], []]);
    expect(p2.map(marcasDe)).toEqual([["Eligió"], [], ["Correcta"], []]);
    // En total, una de cada por pregunta.
    expect(html.match(/>Eligió</g)).toHaveLength(8);
    expect(html.match(/>Correcta</g)).toHaveLength(8);
    // La opción sin marca no tiene el contenedor de marcas.
    expect(porClase(p1[0], "marcas")).toHaveLength(0);
  });

  it("el borde de cada opción sigue a su marca escrita: `elegida` solo en la que eligió y `laCorrecta` solo en la correcta (M49b)", () => {
    // Pregunta 1: eligió B y B es la correcta, así que la misma opción lleva las dos clases. Pregunta 2: eligió A y la correcta es C.
    const [p1, p2] = tarjetas.map(opcionesDe);
    expect(p1.map(clasesDe)).toEqual([[], ["elegida", "laCorrecta"], [], []]);
    expect(p2.map(clasesDe)).toEqual([["elegida"], [], ["laCorrecta"], []]);
    // En las ocho preguntas, la clase va en la opción que lleva la marca escrita y en ninguna otra.
    for (const opciones of tarjetas.map(opcionesDe)) {
      for (const opcion of opciones) {
        expect(clasesDe(opcion).includes("elegida")).toBe(marcasDe(opcion).includes("Eligió"));
        expect(clasesDe(opcion).includes("laCorrecta")).toBe(marcasDe(opcion).includes("Correcta"));
      }
      expect(opciones.filter((o) => clasesDe(o).includes("elegida"))).toHaveLength(1);
      expect(opciones.filter((o) => clasesDe(o).includes("laCorrecta"))).toHaveLength(1);
    }
  });

  it("el borde de color de «Acertó» y de «Falló» sigue a la marca escrita, no al revés (M48)", () => {
    const marcas = tarjetas.map((t) => porClase(t, "marca")[0]);
    expect(marcas.map((m) => [textoDe(m), m.atributos.class])).toEqual(
      ["Acertó", "Falló", "Acertó", "Falló", "Acertó", "Falló", "Acertó", "Acertó"].map((texto) => [texto, expect.stringContaining(texto === "Acertó" ? "acerto" : "fallo")]),
    );
    for (const m of marcas) expect(m.atributos.class).not.toContain(textoDe(m) === "Acertó" ? "fallo" : "acerto");
  });

  it("con las letras que vio la persona, no las del banco: la correcta de la pregunta 4 es la B y eligió la C", () => {
    const [, , , p4] = tarjetas.map(opcionesDe);
    expect(p4.map(marcasDe)).toEqual([[], ["Correcta"], ["Eligió"], []]);
  });

  it("la solución sale solo si la pregunta la tiene, bajo un «Solución»", () => {
    const conSolucion = tarjetas.map((t) => porEtiqueta(t, "h4").length);
    expect(conSolucion).toEqual([1, 1, 0, 1, 1, 1, 0, 1]);
    const t1 = tarjetas[0];
    expect(textoDe(porEtiqueta(t1, "h4")[0])).toBe(TEXTOS.solucion);
    expect(textoDe(porClase(t1, "textoDeSolucion")[0])).toBe("Solución de la pregunta 1");
    expect(html.match(/<h4/g)).toHaveLength(6);
    expect(textoDe(tarjetas[2])).not.toContain("Solución");
  });

  it("no hay mensaje de «no autorizó» ni ninguna región de estado", () => {
    expect(html).not.toContain("role=");
    expect(html).not.toContain(TEXTOS.noAutorizo);
  });
});

describe("el texto del banco (criterio 14, M47)", () => {
  const conCodigo: PreguntaDelMonitor = {
    ...PREGUNTAS[0],
    enunciado: "¿Qué imprime?\n```\nprint(1 + 1)\n```",
    solucion: "Imprime el resultado.\n```\n2\n```",
  };

  it("un enunciado con código sale en un `div` y nunca dentro de un título, un p ni un label", () => {
    const arbol = leerHtml(pintar([conCodigo]));
    const bloques = porEtiqueta(arbol, "pre");
    expect(bloques).toHaveLength(2);
    for (const bloque of bloques) {
      const arriba = ascendientes(bloque);
      for (const prohibido of ["h1", "h2", "h3", "h4", "h5", "h6", "p", "label", "span", "button"]) expect(arriba, `${prohibido} sobre un pre`).not.toContain(prohibido);
      expect(arriba.slice(0, 2)).toEqual(["div", "div"]);
    }
    expect(textoDe(porClase(arbol, "enunciado")[0])).toBe("¿Qué imprime?print(1 + 1)");
    // El bloque de código sigue siendo una región con nombre, alcanzable con el teclado (HU-083).
    expect(bloques[0].atributos).toMatchObject({ tabindex: "0", role: "region", "aria-label": "Código" });
  });

  it("el enunciado y la solución van en un `div` aunque no traigan código", () => {
    const arbol = leerHtml(pintar([PREGUNTAS[0]]));
    expect(porClase(arbol, "enunciado")[0].etiqueta).toBe("div");
    expect(porClase(arbol, "textoDeSolucion")[0].etiqueta).toBe("div");
    expect(ascendientes(porClase(arbol, "enunciado")[0])).not.toContain("p");
  });

  it("las fórmulas del enunciado, de las opciones y de la solución se dibujan como <math>", () => {
    const html = pintar([
      {
        ...PREGUNTAS[0],
        enunciado: String.raw`Calcula $\frac{1}{2}$`,
        opciones: PREGUNTAS[0].opciones.map((o) => ({ ...o, texto: `$x^2$ ${o.letra}` })),
        solucion: String.raw`Resulta $\frac{3}{4}$`,
      },
    ]);
    expect(html.match(/<math /g)?.length).toBe(6);
    expect(html).not.toContain("$");
  });

  it("el texto hostil sale escapado: nunca se arma HTML con el texto del banco", () => {
    const html = pintar([
      {
        ...PREGUNTAS[0],
        enunciado: "<img src=x onerror=alert(1)>",
        opciones: PREGUNTAS[0].opciones.map((o) => ({ ...o, texto: "<script>alert(1)</script>" })),
        solucion: "<b>negrita</b>",
      },
    ]);
    expect(html).not.toMatch(/<img|<script|<b>/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("sin la autorización del Lead (criterio 14, D-67)", () => {
  it("`preguntas` nulo da el mensaje y ningún enunciado, opción ni solución (M20)", () => {
    const html = pintar(null);
    expect(textoDe(leerHtml(html))).toBe(TEXTOS.noAutorizo);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("<li");
    expect(html).not.toContain("Enunciado");
    expect(html).not.toContain("Opción");
  });

  it("una sola región de estado", () => {
    expect(pintar(null).match(/role="status"/g)).toHaveLength(1);
  });
});

describe("las preguntas del ejemplo sembrado, sin pasar por el lector", () => {
  it("el componente solo lee los campos de la vista: una clave interna de la fila no sale", () => {
    const crudas = preguntasDeEjemplo().map((p) => ({ ...p, clave: "p-secreta-1", orden: ["C", "A", "D", "B"] })) as unknown as PreguntaDelMonitor[];
    const html = pintar(crudas);
    expect(html).not.toContain("p-secreta-1");
  });
});
