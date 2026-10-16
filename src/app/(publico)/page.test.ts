import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILA_DE_EJEMPLO } from "../../../pruebas/diagnostico-sembrado";
import { ResultadoDelDiagnostico } from "@/components/diagnostico/ResultadoDelDiagnostico";
import { proyectarResultado, type ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";

// HU-011: la portada, sin navegador ni base: `connection()` y la lectura del último diagnóstico son inventadas y registran el orden en
// que se llaman. Aquí se fija qué se pinta con y sin resultado, que el resultado es el marcado del componente de HU-009 sin tocar
// sus propiedades, y que la página pide la conexión antes de leer. De quién es el diagnóstico lo decide la base (pgTAP); que la ruta
// salga con `Cache-Control` privado en el build real, la e2e (`CI=1`) y el build.

const falsos = vi.hoisted(() => ({
  orden: [] as string[],
  ultimo: null as ResultadoParaMostrar | null,
}));

vi.mock("next/server", () => ({
  connection: async () => {
    falsos.orden.push("connection");
  },
}));
vi.mock("@/lib/diagnostico/ultimo", () => ({
  ultimoDiagnosticoDeLaSesion: async () => {
    falsos.orden.push("lectura");
    return falsos.ultimo;
  },
}));

import * as modulo from "./page";

const Inicio = modulo.default;

const H1_NORMAL = "Descubre en qué tema fallas antes de tu monitoría";
// Un código que necesita codificación: `URLSearchParams` escribe el espacio como `+`. Se fija el literal, no se recalcula con
// `rutaDeMonitores` (sería comparar la función consigo misma).
const CODIGO = "E2E-a b";
const HREF_DE_MONITORES = "/monitores?materia=E2E-a+b";

const RESULTADO = proyectarResultado({ ...FILA_DE_EJEMPLO, codigo_materia: CODIGO });

async function pintar(): Promise<string> {
  return renderToStaticMarkup(await Inicio());
}

/** El texto visible: sin etiquetas y con los espacios normalizados. */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const escapar = (cadena: string) => cadena.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");

/** Un enlace con ese `href` (tal como lo escribe Next, con el `+` del espacio) y ese texto. */
const enlace = (href: string, nombre: string) => new RegExp(`<a[^>]*href="${escapar(href)}"[^>]*>${escapar(nombre)}</a>`);

beforeEach(() => {
  falsos.orden.length = 0;
  falsos.ultimo = null;
});

describe("/ sin resultado: el inicio de siempre", () => {
  it("lleva el h1, «Hacer el diagnóstico» a /diagnostico y «Ver monitores certificados» a /monitores", async () => {
    const html = await pintar();
    expect(html).toMatch(new RegExp(`<h1[^>]*>${H1_NORMAL}</h1>`));
    expect(html).toMatch(enlace("/diagnostico", "Hacer el diagnóstico"));
    expect(html).toMatch(enlace("/monitores", "Ver monitores certificados"));
    expect(texto(html)).toContain("Nueva versión en construcción");
    expect(texto(html)).toContain("Una prueba corta muestra en qué habilidad está el error");
  });

  it("no trae nada del resultado", async () => {
    const t = texto(await pintar());
    for (const ajeno of ["Tu último diagnóstico", "Puntaje global", "Respondiste", "Habilidades", "Tomar otro diagnóstico", "Ver monitores de"]) {
      expect(t).not.toContain(ajeno);
    }
  });
});

describe("/ con el último diagnóstico", () => {
  beforeEach(() => {
    falsos.ultimo = RESULTADO;
  });

  it("el h1 es «Tu último diagnóstico», único, con la materia de eyebrow y el subtítulo", async () => {
    const html = await pintar();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Tu último diagnóstico<\/h1>/);
    expect(html).toMatch(/<p[^>]*>Física II<\/p>/);
    expect(texto(html)).toContain("Lo hiciste desde este navegador. Puedes ver los monitores de la materia o tomar otro diagnóstico.");
  });

  it("el resultado es exactamente el marcado del componente con sus propiedades por omisión (M26)", async () => {
    const componente = renderToStaticMarkup(createElement(ResultadoDelDiagnostico, { resultado: RESULTADO }));
    expect(componente.length).toBeGreaterThan(1000);
    expect(await pintar()).toContain(componente);
  });

  it("el marcado de la portada se rompe si cambian las propiedades del componente", () => {
    // Prueba de la prueba: lo que `toContain` de arriba distingue. Si estas tres variantes dieran el mismo marcado que las propiedades
    // por omisión, M26 (acciones, nivel de títulos o ranura) pasaría sin que nadie lo note.
    const base = renderToStaticMarkup(createElement(ResultadoDelDiagnostico, { resultado: RESULTADO }));
    const sinAcciones = renderToStaticMarkup(createElement(ResultadoDelDiagnostico, { resultado: RESULTADO, acciones: "ninguna" }));
    const titulosTres = renderToStaticMarkup(createElement(ResultadoDelDiagnostico, { resultado: RESULTADO, nivelDeTitulos: 3 }));
    const conRanura = renderToStaticMarkup(createElement(ResultadoDelDiagnostico, { resultado: RESULTADO, ranura: "RANURA" }));
    expect(new Set([base, sinAcciones, titulosTres, conRanura]).size).toBe(4);
  });

  it("«Ver monitores de {materia}» lleva a /monitores?materia=<código>, con el código y no con el nombre (M30)", async () => {
    const html = await pintar();
    expect(html).toMatch(enlace(HREF_DE_MONITORES, "Ver monitores de Física II"));
    expect(html).not.toContain("materia=F%C3%ADsica");
    expect(html).not.toContain("materia=Física");
  });

  it("«Tomar otro diagnóstico» lleva a /diagnostico", async () => {
    expect(await pintar()).toMatch(enlace("/diagnostico", "Tomar otro diagnóstico"));
  });

  it("no pinta el inicio normal debajo (M27): ni el h1 de siempre ni sus dos enlaces", async () => {
    const html = await pintar();
    const t = texto(html);
    expect(t).not.toContain(H1_NORMAL);
    expect(t).not.toContain("Hacer el diagnóstico");
    expect(t).not.toContain("Ver monitores certificados");
    expect(t).not.toContain("Nueva versión en construcción");
    // El único enlace a /diagnostico es el del componente.
    expect(html.match(/href="\/diagnostico"/g)).toHaveLength(1);
  });

  it("muestra las cifras de D-53 c y no habla de repetido", async () => {
    const html = await pintar();
    expect(html).toContain("Puntaje global: 63 %");
    expect(html).toContain("Respondiste 8 preguntas");
    expect(html.toLowerCase()).not.toContain("repetid");
  });
});

describe("/ es dinámica", () => {
  it("pide la conexión una vez y antes de leer, con y sin resultado (M24, M25)", async () => {
    await pintar();
    expect(falsos.orden).toEqual(["connection", "lectura"]);

    falsos.orden.length = 0;
    falsos.ultimo = RESULTADO;
    await pintar();
    expect(falsos.orden).toEqual(["connection", "lectura"]);
  });

  it("no fija `dynamic` ni `revalidate`: ninguna configuración de segmento la vuelve estática o cacheada (M29)", () => {
    expect(modulo).toHaveProperty("default");
    expect(modulo).not.toHaveProperty("dynamic");
    expect(modulo).not.toHaveProperty("revalidate");
    expect(modulo).not.toHaveProperty("fetchCache");
  });
});
