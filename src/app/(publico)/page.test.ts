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

const H1_LANDING = "Monitorías de ciclo básico que empiezan por tu error.";
const SECCIONES = [
  H1_LANDING,
  "Estudiar más horas no arregla un error que no sabes que tienes.",
  "Cómo funciona",
  "La hora de monitoría rinde, porque nadie empieza a ciegas.",
  "Hecho con los parciales de ciclo básico",
  "Preguntas frecuentes",
  "Averigua qué te falla antes del próximo parcial.",
];
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

describe("/ sin resultado: la landing (HU-108)", () => {
  it("lleva el h1 de la landing, único, y «Hacer mi diagnóstico gratis» a /diagnostico en el hero, al final y en la barra móvil", async () => {
    const html = await pintar();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${H1_LANDING}</h1>`));
    expect(html.match(/<a[^>]*href="\/diagnostico"[^>]*>Hacer mi diagnóstico gratis<\/a>/g)).toHaveLength(3);
    expect(html.match(/data-evento="clic_cta_diagnostico"/g)).toHaveLength(3);
    expect(texto(html)).toContain("Sin crear cuenta.");
  });

  it("tiene las secciones en el orden del diseño", async () => {
    const t = texto(await pintar());
    const posiciones = SECCIONES.map((seccion) => t.indexOf(seccion));
    expect(posiciones.every((p) => p >= 0), String(posiciones)).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
  });

  it("no tiene menú ni más enlaces que el aviso de privacidad (D-77 b); el acceso lo prueba su propio archivo", async () => {
    const hrefs = [...(await pintar()).matchAll(/<a[^>]*href="([^"]*)"/g)].map(([, href]) => href);
    expect(new Set(hrefs)).toEqual(new Set(["/", "/diagnostico", "/privacidad"]));
    expect(hrefs).not.toContain("/monitores");
    expect(hrefs).not.toContain("/quiero-ser-monitor");
  });

  it("marca la página como landing para que globals.css esconda el pie global (D-77 b)", async () => {
    expect(await pintar()).toContain("data-landing");
  });

  it("no trae nada del resultado ni del inicio de antes", async () => {
    const t = texto(await pintar());
    for (const ajeno of ["Tu último diagnóstico", "Puntaje global", "Respondiste", "Tomar otro diagnóstico", "Nueva versión en construcción", "Ver monitores certificados"]) {
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

  it("no pinta la landing debajo (M27, HU-108): ni su h1 ni su CTA", async () => {
    const html = await pintar();
    const t = texto(html);
    expect(t).not.toContain(H1_LANDING);
    expect(t).not.toContain("Hacer mi diagnóstico gratis");
    expect(html).not.toContain("data-landing");
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
