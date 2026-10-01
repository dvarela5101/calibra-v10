import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analizarBanco,
  armarEnunciado,
  contar,
  formatearDiagnostico,
  formatearReporte,
  leerBanco,
  partirOpcion,
  seCarga,
} from "../scripts/contenido/banco.mts";
import { principal } from "../scripts/contenido/convertir.mts";
import type { ArchivoBanco, Pregunta, ResultadoBanco } from "../scripts/contenido/modelo.mts";

// HU-005: lector y validador del banco de preguntas (scripts/contenido/banco.mts) y su línea de comandos
// en --dry-run. Usa un banco de ejemplo pequeño (pruebas/banco-ejemplo) y no el contenido real, para que
// editar el banco no rompa las pruebas.
//
// El banco de ejemplo tiene dos materias:
// - materia-a (ZZPR-0001), temas derivadas e integrales.
//   - derivadas: habilidades potencia y cadena (cadena tiene de prerrequisito a potencia).
//     P1 (dif. 1), P2 (2), P3 (2, mide potencia y cadena, origen IA con solución de varias líneas), P4 (1) y
//     P5 (3) están revisadas; P6 retirada; P7 borrador de IA con solución y "⚠ revisar".
//   - integrales: habilidad antiderivada (prerrequisito potencia). P8 revisada (una opción con " · " en
//     el texto) y P9 borrador de IA sin solución (el único aviso).
//   - parcial-1 (semana 6, derivadas) y parcial-2 (semana 12, acumulativa, integrales: hereda derivadas).
// - materia-b (ZZPR-0002), tema diferencias: diferencia-adelante, con prerrequisito materia-a/potencia.
//   P1 revisada con una cerca de código en el enunciado. examen-final (semana 16).
//
// Cobertura (solo revisadas): potencia P1, P2, P3 → 3 en dificultades 1 y 2, cumple; cadena P3, P4, P5 → 3
// en 1, 2 y 3, cumple; antiderivada solo P8 y diferencia-adelante solo P1, no cumplen. Por eso solo
// parcial-1 queda activa: parcial-2 incluye integrales (antiderivada) y examen-final, diferencia-adelante.

const EJEMPLO = join(__dirname, "banco-ejemplo");

/** Los archivos del banco de ejemplo, como los arma leerBanco. */
function archivosDelEjemplo(): ArchivoBanco[] {
  const archivos: ArchivoBanco[] = [];
  const recorrer = (carpeta: string) => {
    for (const nombre of readdirSync(carpeta)) {
      const ruta = join(carpeta, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else archivos.push({ ruta: relative(EJEMPLO, ruta).replaceAll("\\", "/"), texto: readFileSync(ruta, "utf8") });
    }
  };
  recorrer(EJEMPLO);
  return archivos;
}

function preguntaDe(resultado: ResultadoBanco, carpeta: string, clave: string): Pregunta {
  const pregunta = resultado.banco.materias
    .find((m) => m.carpeta === carpeta)
    ?.temas.flatMap((t) => t.preguntas)
    .find((p) => p.clave === clave);
  if (!pregunta) throw new Error(`no encontré ${carpeta}/${clave}`);
  return pregunta;
}

/**
 * Exige exactamente esos diagnósticos: cada uno como [lugar "archivo:linea", fragmento del mensaje].
 * Así una regla nueva que dispare de más también rompe la prueba.
 */
function comprobar(resultado: ResultadoBanco, tipo: "errores" | "avisos", esperados: [string, string][]) {
  const reales = resultado[tipo].map(formatearDiagnostico);
  const detalle = `${tipo} reales:\n${reales.join("\n") || "(ninguno)"}`;
  expect(reales.length, detalle).toBe(esperados.length);
  for (const [lugar, fragmento] of esperados) {
    expect(
      reales.some((r) => r.startsWith(`${lugar}  `) && r.includes(fragmento)),
      `falta ${lugar}  …${fragmento}…\n${detalle}`,
    ).toBe(true);
  }
}

describe("banco de ejemplo", () => {
  const resultado = leerBanco(EJEMPLO);
  const { banco } = resultado;

  it("pasa sin errores y con un solo aviso: el borrador de IA sin solución", () => {
    comprobar(resultado, "errores", []);
    comprobar(resultado, "avisos", [["materia-a/integrales.md:21", 'la pregunta P9 es un borrador de IA sin "solución:"']]);
  });

  it("cuenta las filas que se cargarían, sin y con borradores (las retiradas nunca)", () => {
    // Revisadas: P1-P5 y P8 de materia-a, P1 de materia-b. P3 mide 2 habilidades. Borradores: P7 y P9.
    expect(contar(banco, { borradores: false })).toEqual({
      materias: 2,
      temas: 3,
      habilidades: 4,
      prerrequisitos: 3,
      misconcepciones: 11,
      preguntas: 7,
      opciones: 28,
      preguntaHabilidad: 8,
      evaluaciones: 3,
      evaluacionTema: 4,
    });
    expect(contar(banco, { borradores: true })).toEqual({
      materias: 2,
      temas: 3,
      habilidades: 4,
      prerrequisitos: 3,
      misconcepciones: 11,
      preguntas: 9,
      opciones: 36,
      preguntaHabilidad: 10,
      evaluaciones: 3,
      evaluacionTema: 4,
    });
  });

  it("solo parcial-1 queda activa, y la acumulativa hereda los temas de la anterior", () => {
    const evaluaciones = banco.materias.flatMap((m) => m.evaluaciones.map((e) => [`${m.carpeta}/${e.clave}`, e] as const));
    expect(Object.fromEntries(evaluaciones.map(([clave, e]) => [clave, e.activa]))).toEqual({
      "materia-a/parcial-1": true,
      "materia-a/parcial-2": false,
      "materia-b/examen-final": false,
    });
    const parcial2 = evaluaciones.find(([clave]) => clave === "materia-a/parcial-2")?.[1];
    expect(parcial2).toMatchObject({ semana: 12, acumulativa: true, temasPropios: ["integrales"], temas: ["derivadas", "integrales"] });
  });

  it("reporta la cobertura por habilidad y por misconcepción con solo las revisadas", () => {
    expect(resultado.cobertura.habilidades).toEqual([
      { materia: "materia-a", clave: "potencia", revisadas: 3, dificultades: [1, 2], cumple: true },
      { materia: "materia-a", clave: "cadena", revisadas: 3, dificultades: [1, 2, 3], cumple: true },
      { materia: "materia-a", clave: "antiderivada", revisadas: 1, dificultades: [2], cumple: false },
      { materia: "materia-b", clave: "diferencia-adelante", revisadas: 1, dificultades: [2], cumple: false },
    ]);
    // solo-interna sale dos veces en P4 y en P5: cuenta una vez por pregunta. no-baja también está en P6,
    // pero P6 está retirada.
    expect(Object.fromEntries(resultado.cobertura.misconcepciones.map((m) => [`${m.materia}/${m.clave}`, m.preguntas]))).toEqual({
      "materia-a/no-resta-uno": 3,
      "materia-a/suma-uno": 2,
      "materia-a/no-baja": 2,
      "materia-a/olvida-interna": 3,
      "materia-a/solo-interna": 3,
      "materia-a/olvida-constante": 1,
      "materia-a/deriva-en-vez": 1,
      "materia-a/no-divide": 1,
      "materia-b/divide-mal": 1,
      "materia-b/resta-al-reves": 1,
      "materia-b/olvida-h": 1,
    });
  });

  it("lee materia.md: código, nombre, libro, introducción y temas en orden", () => {
    const [a, b] = banco.materias;
    expect(a).toMatchObject({
      carpeta: "materia-a",
      codigo: "ZZPR-0001",
      nombre: "Materia de prueba A",
      libro: "Libro de prueba, 1.ª ed.",
      introduccion: "Banco de ejemplo para las pruebas del convertidor (pruebas/contenido.test.ts). No es contenido real.",
    });
    expect(a.temas.map((t) => [t.clave, t.nombre, t.orden])).toEqual([
      ["derivadas", "Derivadas", 1],
      ["integrales", "Integrales", 2],
    ]);
    expect(a.temas[0].introduccion).toBe("Reglas básicas de derivación.");
    expect(b).toMatchObject({ carpeta: "materia-b", codigo: "ZZPR-0002", libro: null });
  });

  it("lee prerrequisitos de la misma materia y de otra", () => {
    const habilidad = (carpeta: string, clave: string) =>
      banco.materias.find((m) => m.carpeta === carpeta)?.temas.flatMap((t) => t.habilidades).find((h) => h.clave === clave);
    expect(habilidad("materia-a", "cadena")).toMatchObject({
      descripcion: "Derivar funciones compuestas con la regla de la cadena",
      prerrequisitos: [{ materia: null, clave: "potencia" }],
    });
    expect(habilidad("materia-b", "diferencia-adelante")?.prerrequisitos).toEqual([{ materia: "materia-a", clave: "potencia" }]);
  });

  it("lee el encabezado de cada pregunta: habilidades, estado, origen, revisor y la marca ⚠ revisar", () => {
    expect(preguntaDe(resultado, "materia-a", "P3")).toMatchObject({
      dificultad: 2,
      habilidades: ["potencia", "cadena"],
      estado: "revisada",
      origen: "ia (modelo-de-prueba)",
      revisor: "Ana",
      porRevisar: false,
    });
    expect(preguntaDe(resultado, "materia-a", "P6")).toMatchObject({ estado: "retirada", origen: "humano", revisor: null });
    expect(preguntaDe(resultado, "materia-a", "P7")).toMatchObject({ estado: "borrador", porRevisar: true });
  });

  it("parte las opciones: [mc] solo, [mc] con texto propio, ' · ' dentro del texto y $…$", () => {
    const p1 = preguntaDe(resultado, "materia-a", "P1");
    expect(p1.opciones.map(({ letra, texto, correcta, misconcepcion, error }) => ({ letra, texto, correcta, misconcepcion, error }))).toEqual([
      { letra: "A", texto: "$3x^{2}$", correcta: true, misconcepcion: null, error: null },
      { letra: "B", texto: "$3x^{3}$", correcta: false, misconcepcion: "no-resta-uno", error: null },
      { letra: "C", texto: "$\\frac{x^{4}}{4}$", correcta: false, misconcepcion: "suma-uno", error: "integras en vez de derivar" },
      { letra: "D", texto: "$x^{2}$", correcta: false, misconcepcion: "no-baja", error: null },
    ]);
    expect(p1.opciones[1].lugar).toEqual({ archivo: "materia-a/derivadas.md", linea: 22 });
    expect(preguntaDe(resultado, "materia-a", "P8").opciones[2]).toMatchObject({
      texto: "3 · x³ + C",
      misconcepcion: "no-divide",
      error: "subes el exponente a 3 pero no divides entre 3",
    });
    expect(preguntaDe(resultado, "materia-a", "P3").opciones[2]).toMatchObject({ texto: "3(x² + 1)³ · 2x", misconcepcion: "no-resta-uno" });
  });

  it("arma el enunciado con la cerca de código y guarda la solución de varias líneas", () => {
    expect(preguntaDe(resultado, "materia-b", "P1").enunciado).toBe(
      "¿Qué imprime este programa?\n```\ndef f(x):\n    return x ** 2\n\nh = 0.25\nprint((f(1 + h) - f(1)) / h)\n```\nEs la diferencia hacia adelante de f en 1.",
    );
    expect(preguntaDe(resultado, "materia-a", "P3").solucion).toBe("con la regla de la cadena,\nd/dx (x² + 1)³ = 3(x² + 1)² · 2x\n= 6x(x² + 1)²");
    expect(preguntaDe(resultado, "materia-a", "P1").solucion).toBeNull();
  });

  it("da lo mismo con CRLF y BOM (Windows) que con LF (CI)", () => {
    const conCrlf = archivosDelEjemplo().map(({ ruta, texto }) => ({ ruta, texto: `\uFEFF${texto.replace(/\r?\n/g, "\r\n")}` }));
    const conLf = archivosDelEjemplo().map(({ ruta, texto }) => ({ ruta, texto: texto.replace(/\r\n/g, "\n") }));
    const deCrlf = analizarBanco(conCrlf);
    expect(deCrlf.errores).toEqual([]);
    expect(deCrlf.banco).toEqual(analizarBanco(conLf).banco);
    expect(deCrlf.banco).toEqual(banco);
  });

  it("el reporte trae conteos, cobertura, evaluaciones con su motivo y avisos", () => {
    const reporte = formatearReporte(resultado, { borradores: false });
    expect(reporte).toContain("Filas que se cargarían (solo revisadas");
    expect(reporte).toMatch(/pregunta_habilidad\s+8/);
    expect(reporte).toContain("✓ cadena");
    expect(reporte).toContain("✗ antiderivada");
    expect(reporte).toContain("materia-a: cumplen 5 de 8. No cumplen: olvida-constante (1), deriva-en-vez (1), no-divide (1)");
    expect(reporte).toContain("✓ materia-a/parcial-1 (Parcial 1, semana 6; temas: derivadas): activa");
    expect(reporte).toContain("inactiva; no cumplen antiderivada (1 revisada, 1 dificultad)");
    expect(reporte).toContain("materia-a/integrales.md:21  la pregunta P9");
    expect(reporte.trimEnd().endsWith("✓ Sin errores (1 aviso).")).toBe(true);
    expect(formatearReporte(resultado, { borradores: true })).toMatch(/pregunta\s+9\n/);
  });
});

// ---------------------------------------------------------------------------------------------------
// Banco mínimo en línea: una materia "m" con un tema "t" y una pregunta. Cada caso le cambia algo.
// ---------------------------------------------------------------------------------------------------

const MATERIA = [
  "---", //                                         1
  "codigo: ZZPR-0101", //                           2
  "nombre: Materia mínima", //                      3
  "---", //                                         4
  "", //                                            5
  "## Temas", //                                    6
  "- t", //                                         7
  "", //                                            8
  "## Evaluaciones", //                             9
  "", //                                            10
  "### e1 · Parcial 1 · semana 6", //               11
  "temas: t", //                                    12
  "",
].join("\n");

const TEMA = [
  "# Tema", //                                      1
  "", //                                            2
  "## Habilidades", //                              3
  "kc: h · Una habilidad", //                       4
  "", //                                            5
  "## Errores", //                                  6
  "mc: e · h · un error", //                        7
  "", //                                            8
  "## Preguntas", //                                9
  "", //                                            10
  "### P1 · dificultad 2 · kc: h · revisada · origen: humano · revisó: Ana", // 11
  "¿Cuánto es 1 + 1?", //                           12
  "", //                                            13
  "- A) 2 · CORRECTA", //                           14
  "- B) 3 · [e]", //                                15
  "- C) 4 · [e] sumas de más", //                   16
  "- D) 0 · [e]", //                                17
  "",
].join("\n");

/** Un tema válido sin preguntas, con una sola habilidad. */
const temaSolo = (nombre: string, kc: string) => `# ${nombre}\n\n## Habilidades\n${kc}\n\n## Errores\n\n## Preguntas\n`;

const BASE: Record<string, string> = {
  // Los archivos sueltos de la raíz se ignoran.
  "README.md": "# Reglas del banco\n\nSe ignora.\n",
  "m/materia.md": MATERIA,
  "m/t.md": TEMA,
};

/** [ruta, texto a reemplazar (null: el archivo entero), texto nuevo (null: borra el archivo)]. */
type Cambio = [ruta: string, de: string | null, a: string | null];

function banco(...cambios: Cambio[]): ResultadoBanco {
  const textos = { ...BASE };
  for (const [ruta, de, a] of cambios) {
    if (a === null) delete textos[ruta];
    else if (de === null) textos[ruta] = a;
    else {
      // Un reemplazo que no encuentra su texto es un error de la prueba, no del banco.
      if (!textos[ruta]?.includes(de)) throw new Error(`"${de}" no está en ${ruta}`);
      // Con una función, "$$" en el texto nuevo queda literal (en un reemplazo de texto vale "$").
      textos[ruta] = textos[ruta].replace(de, () => a);
    }
  }
  return analizarBanco(Object.entries(textos).map(([ruta, texto]) => ({ ruta, texto })));
}

const OTRA_PREGUNTA = "### P2 · dificultad 2 · kc: h · revisada · origen: humano · revisó: Ana\n¿Y 2 + 2?\n\n- A) 4 · CORRECTA\n- B) 5 · [e]\n- C) 6 · [e]\n- D) 0 · [e]\n";

describe("banco mínimo", () => {
  it("pasa sin errores ni avisos, y su evaluación queda inactiva (una sola pregunta)", () => {
    const resultado = banco();
    comprobar(resultado, "errores", []);
    comprobar(resultado, "avisos", []);
    expect(resultado.banco.materias[0].evaluaciones[0]).toMatchObject({ temas: ["t"], activa: false });
  });
});

describe("reglas de error, con archivo:línea", () => {
  const casos: [string, Cambio[], [string, string][]][] = [
    // materia.md y carpetas
    ["frontmatter sin código", [["m/materia.md", "codigo: ZZPR-0101\n", ""]], [["m/materia.md:1", 'falta "codigo"']]],
    ["código con otra forma", [["m/materia.md", "ZZPR-0101", "zzpr-101"]], [["m/materia.md:2", 'el código "zzpr-101" no tiene la forma']]],
    ["clave desconocida en el frontmatter", [["m/materia.md", "nombre: Materia mínima\n", "nombre: Materia mínima\nactiva: true\n"]], [["m/materia.md:4", 'clave desconocida "activa"']]],
    ["materia.md sin frontmatter", [["m/materia.md", "---\ncodigo: ZZPR-0101\nnombre: Materia mínima\n---\n", ""]], [
      ["m/materia.md:1", "debe empezar con el frontmatter"],
      ["m/materia.md:1", 'falta "codigo"'],
      ["m/materia.md:1", 'falta "nombre"'],
    ]],
    ["sección desconocida en materia.md", [["m/materia.md", "temas: t\n", "temas: t\n## Notas\n"]], [["m/materia.md:13", 'sección desconocida "## Notas"']]],
    ["tema repetido en ## Temas", [["m/materia.md", "- t\n", "- t\n- t\n"]], [["m/materia.md:8", 'el tema "t" está repetido']]],
    ["tema listado sin archivo", [["m/materia.md", "- t\n", "- t\n- falta\n"]], [["m/materia.md:8", 'el tema "falta" no tiene su archivo falta.md']]],
    ["archivo de tema que no está en ## Temas", [["m/suelto.md", null, temaSolo("Suelto", "kc: s · Otra")]], [["m/suelto.md:1", 'el tema "suelto" no está en la sección "## Temas"']]],
    ["archivo que no es de tema", [["m/LEEME.md", null, "notas\n"]], [["m/LEEME.md:1", "archivo inesperado"]]],
    ["carpeta de materia sin materia.md", [["m/materia.md", null, null]], [
      ["m/materia.md:1", 'falta materia.md en la carpeta "m"'],
      ["m/t.md:1", 'el tema "t" no está en la sección "## Temas"'],
    ]],
    ["materia sin evaluaciones (RN-20)", [["m/materia.md", "### e1 · Parcial 1 · semana 6\ntemas: t\n", ""]], [["m/materia.md:9", "no tiene evaluaciones"]]],
    ["encabezado de evaluación mal formado", [["m/materia.md", "semana 6", "semana seis"]], [
      ["m/materia.md:11", "encabezado de evaluación mal formado"],
      ["m/materia.md:9", "no tiene evaluaciones"],
    ]],
    ["semana 0", [["m/materia.md", "semana 6", "semana 0"]], [
      ["m/materia.md:11", "mayor que 0"],
      ["m/materia.md:9", "no tiene evaluaciones"],
    ]],
    ["evaluación sin línea temas:", [["m/materia.md", "temas: t\n", ""]], [["m/materia.md:11", 'le falta la línea "temas: a, b"']]],
    ["temas: vacía en una evaluación no acumulativa", [["m/materia.md", "temas: t", "temas:"]], [["m/materia.md:12", "solo puede quedar vacía en una evaluación acumulativa"]]],
    ["tema de evaluación inexistente", [["m/materia.md", "temas: t", "temas: t, otro"]], [["m/materia.md:12", 'el tema "otro" de la evaluación "e1" no está en "## Temas"']]],
    ["tema repetido en temas:", [["m/materia.md", "temas: t", "temas: t, t"]], [["m/materia.md:12", 'el tema "t" está repetido en "temas:"']]],
    ["evaluación repetida", [["m/materia.md", "temas: t\n", "temas: t\n\n### e1 · Otra · semana 8\ntemas: t\n"]], [["m/materia.md:14", 'la evaluación "e1" está repetida']]],
    ["línea extraña en ## Evaluaciones", [["m/materia.md", "temas: t\n", "temas: t\nnotas: x\n"]], [["m/materia.md:13", 'línea extraña en "## Evaluaciones"']]],
    ["acumulativa sin temas ni evaluaciones anteriores", [["m/materia.md", "semana 6\ntemas: t", "semana 6 · acumulativa\ntemas:"]], [["m/materia.md:11", "queda sin temas"]]],

    // <tema>.md: estructura
    ["tema sin título", [["m/t.md", "# Tema\n", "Tema\n"]], [["m/t.md:1", "falta el título del tema"]]],
    ["secciones del tema fuera de orden", [["m/t.md", "## Habilidades\nkc: h · Una habilidad\n\n## Errores\nmc: e · h · un error\n", "## Errores\nmc: e · h · un error\n\n## Habilidades\nkc: h · Una habilidad\n"]], [
      ["m/t.md:6", 'la sección "## Habilidades" va antes de "## Errores"'],
    ]],
    ["sección desconocida en el tema", [["m/t.md", "- D) 0 · [e]\n", "- D) 0 · [e]\n\n## Notas\n"]], [["m/t.md:19", 'sección desconocida "## Notas"']]],
    ["sección del tema repetida", [["m/t.md", "- D) 0 · [e]\n", "- D) 0 · [e]\n\n## Errores\n"]], [["m/t.md:19", 'la sección "## Errores" está repetida']]],
    ["tema sin habilidades", [["m/t.md", "kc: h · Una habilidad\n", ""]], [
      ["m/t.md:3", "el tema no tiene habilidades"],
      ["m/t.md:6", 'la misconcepción "e" es de la habilidad "h", que no existe'],
      ["m/t.md:10", 'la pregunta P1 mide la habilidad "h", que no existe'],
    ]],
    ["línea extraña en ## Habilidades", [["m/t.md", "kc: h · Una habilidad\n", "kc: h · Una habilidad\nhabilidad suelta\n"]], [["m/t.md:5", 'en "## Habilidades" solo van líneas "kc:']]],
    ["línea kc: mal formada", [["m/t.md", "kc: h · Una habilidad\n", "kc: h · Una habilidad\nkc: otra\n"]], [["m/t.md:5", 'línea "kc:" mal formada']]],
    ["prerrequisitos vacíos", [["m/t.md", "kc: h · Una habilidad", "kc: h · Una habilidad · prerrequisitos:"]], [["m/t.md:4", 'la lista de prerrequisitos de "h" está vacía']]],
    ["línea mc: mal formada", [["m/t.md", "mc: e · h · un error\n", "mc: e · h · un error\nmc: rota · h\n"]], [["m/t.md:8", 'línea "mc:" mal formada']]],
    ["texto fuera de una pregunta", [["m/t.md", "## Preguntas\n\n", "## Preguntas\nsuelto\n\n"]], [["m/t.md:10", "texto fuera de una pregunta"]]],

    // Encabezado de pregunta
    ["encabezado de pregunta mal formado", [["m/t.md", "### P1 · dificultad 2", "### P1 dificultad 2"]], [["m/t.md:11", "encabezado de pregunta mal formado"]]],
    ["dificultad fuera de 1-3", [["m/t.md", "dificultad 2", "dificultad 4"]], [["m/t.md:11", 'debe ser 1, 2 o 3 (dice "4")']]],
    ["token desconocido", [["m/t.md", "revisó: Ana", "revisó: Ana · urgente"]], [["m/t.md:11", 'no entiendo "urgente"']]],
    ["token repetido", [["m/t.md", "· revisada ·", "· revisada · revisada ·"]], [["m/t.md:11", "tiene un estado más de una vez"]]],
    ["sin estado", [["m/t.md", " · revisada", ""]], [["m/t.md:11", "no tiene estado"]]],
    ["sin origen", [["m/t.md", " · origen: humano", ""]], [["m/t.md:11", "no tiene origen"]]],
    ["origen de IA sin modelo", [["m/t.md", "origen: humano", "origen: ia ()"]], [["m/t.md:11", 'debe ser "humano" o "ia (<modelo>)"']]],
    ["revisada sin revisó:", [["m/t.md", " · revisó: Ana", ""]], [["m/t.md:11", "está revisada pero no dice quién la revisó"]]],
    ["revisada de IA sin solución", [["m/t.md", "origen: humano", "origen: ia (modelo)"]], [["m/t.md:11", 'es de origen IA y está revisada sin "solución:"']]],
    ["habilidad inexistente en kc:", [["m/t.md", "dificultad 2 · kc: h ·", "dificultad 2 · kc: h, otra ·"]], [["m/t.md:11", 'mide la habilidad "otra", que no existe']]],

    // Cuerpo de la pregunta
    ["sin enunciado", [["m/t.md", "¿Cuánto es 1 + 1?\n", ""]], [["m/t.md:11", "la pregunta P1 no tiene enunciado"]]],
    ["tres opciones", [["m/t.md", "- D) 0 · [e]\n", ""]], [["m/t.md:11", "tiene 3 opciones, deben ser 4"]]],
    ["ninguna CORRECTA", [["m/t.md", "- A) 2 · CORRECTA", "- A) 2 · [e]"]], [["m/t.md:11", "tiene 0 opciones marcadas CORRECTA"]]],
    ["dos CORRECTA", [["m/t.md", "- B) 3 · [e]", "- B) 3 · CORRECTA"]], [["m/t.md:11", "tiene 2 opciones marcadas CORRECTA"]]],
    ["incorrecta sin [misconcepción]", [["m/t.md", "- B) 3 · [e]", "- B) 3 · sumas mal"]], [["m/t.md:15", "la opción B de P1 no dice qué error delata"]]],
    ["incorrecta sin separador", [["m/t.md", "- B) 3 · [e]", "- B) 3"]], [["m/t.md:15", "la opción B de P1 no dice qué error delata"]]],
    ["opción sin texto", [["m/t.md", "- B) 3 · [e]", "- B) · [e]"]], [["m/t.md:15", "la opción B de P1 no tiene texto"]]],
    ["opciones fuera de orden", [["m/t.md", "- B) 3 · [e]\n- C) 4 · [e] sumas de más", "- C) 4 · [e] sumas de más\n- B) 3 · [e]"]], [["m/t.md:11", "deben ir en orden"]]],
    ["misconcepción inexistente en una opción", [["m/t.md", "- B) 3 · [e]", "- B) 3 · [otra]"]], [["m/t.md:15", 'usa la misconcepción "otra", que no existe']]],
    ["línea extraña después de las opciones", [["m/t.md", "- D) 0 · [e]\n", "- D) 0 · [e]\nnota suelta\n"]], [["m/t.md:18", "línea inesperada después de las opciones"]]],
    ["cerca vacía", [["m/t.md", "¿Cuánto es 1 + 1?\n", "¿Cuánto es 1 + 1?\n```\n```\n"]], [["m/t.md:13", "la cerca de código de P1 está vacía"]]],
    ["cerca sin cerrar", [["m/t.md", "¿Cuánto es 1 + 1?\n", "¿Cuánto es 1 + 1?\n```\nx = 1\n"]], [
      ["m/t.md:13", "la cerca de código de P1 no se cierra"],
      ["m/t.md:11", "tiene 0 opciones"],
      ["m/t.md:11", "tiene 0 opciones marcadas CORRECTA"],
    ]],
    ["cerca con lenguaje", [["m/t.md", "¿Cuánto es 1 + 1?\n", "¿Cuánto es 1 + 1?\n```python\nx = 1\n```\n"]], [["m/t.md:13", "la cerca de apertura va sola en su línea"]]],
    ["cerca después de las opciones", [["m/t.md", "- D) 0 · [e]\n", "- D) 0 · [e]\n```\nx = 1\n```\n"]], [["m/t.md:18", "una cerca de código solo va en el enunciado"]]],
    ["solución vacía", [["m/t.md", "- D) 0 · [e]\n", "- D) 0 · [e]\n\nsolución:\n"]], [["m/t.md:19", "la solución de P1 está vacía"]]],

    // Matemática (validarMate del prototipo)
    ['"$" sin cerrar en el enunciado', [["m/t.md", "¿Cuánto es 1 + 1?", "¿Cuánto es $1 + 1?"]], [["m/t.md:12", 'el enunciado de P1 tiene un "$" sin cerrar']]],
    ["comando no soportado en una opción", [["m/t.md", "- C) 4 ·", "- C) $\\mathbf{4}$ ·"]], [["m/t.md:16", 'el texto de la opción C de P1 usa "\\mathbf"']]],
    ["comando fuera de $ en una misconcepción", [["m/t.md", "un error", "un \\frac error"]], [["m/t.md:7", 'la descripción de la misconcepción "e" tiene "\\frac" fuera de $...$']]],
    ["llaves desbalanceadas en la solución", [["m/t.md", "- D) 0 · [e]\n", "- D) 0 · [e]\n\nsolución: queda $\\frac{1{2}$\n"]], [["m/t.md:19", "la solución de P1 tiene las llaves { } desbalanceadas"]]],
    ["$$ vacío en el error propio de una opción", [["m/t.md", "sumas de más", "sumas $$ de más"]], [["m/t.md:16", 'el error de la opción C de P1 tiene un "$$" vacío']]],
    ["\\left sin \\right en el nombre del tema", [["m/t.md", "# Tema", "# Tema $\\left( x$"]], [["m/t.md:1", "el nombre del tema tiene un \\left sin su \\right"]]],

    // Reglas cruzadas
    ["habilidad repetida en la materia", [["m/materia.md", "- t\n", "- t\n- u\n"], ["m/u.md", null, temaSolo("U", "kc: h · Repetida")]], [["m/u.md:4", 'la habilidad "h" está repetida (ya está en m/t.md:4)']]],
    ["misconcepción repetida", [["m/t.md", "mc: e · h · un error\n", "mc: e · h · un error\nmc: e · h · otro\n"]], [["m/t.md:8", 'la misconcepción "e" está repetida']]],
    ["pregunta repetida sin distinguir mayúsculas", [["m/t.md", "- D) 0 · [e]\n", `- D) 0 · [e]\n\n${OTRA_PREGUNTA.replace("P2", "p1")}`]], [["m/t.md:19", 'la pregunta "p1" está repetida en la materia (ya está en m/t.md:11)']]],
    ["código repetido en el banco", [["n/materia.md", null, MATERIA], ["n/t.md", null, TEMA]], [["n/materia.md:2", 'el código ZZPR-0101 ya es de la materia "m"']]],
    ["misconcepción de una habilidad inexistente", [["m/t.md", "mc: e · h · un error\n", "mc: e · h · un error\nmc: f · nada · otro\n"]], [["m/t.md:8", 'la misconcepción "f" es de la habilidad "nada", que no existe']]],
    ["prerrequisito inexistente en la materia", [["m/t.md", "Una habilidad", "Una habilidad · prerrequisitos: nada"]], [["m/t.md:4", 'el prerrequisito "nada" de "h" no existe en la materia']]],
    ["prerrequisito de una materia que no está en el banco", [["m/t.md", "Una habilidad", "Una habilidad · prerrequisitos: otra-materia/x"]], [["m/t.md:4", 'no hay una materia "otra-materia" en el banco']]],
    ["prerrequisito mal escrito", [["m/t.md", "Una habilidad", "Una habilidad · prerrequisitos: Otra Cosa"]], [["m/t.md:4", 'el prerrequisito "Otra Cosa" de "h" está mal escrito']]],
    ["ciclo de prerrequisitos en la materia", [["m/t.md", "kc: h · Una habilidad\n", "kc: h · Una habilidad · prerrequisitos: h2\nkc: h2 · Otra · prerrequisitos: h\n"]], [["m/t.md:5", "ciclo de prerrequisitos: h → h2 → h"]]],
    ["auto-prerrequisito", [["m/t.md", "Una habilidad", "Una habilidad · prerrequisitos: h"]], [["m/t.md:4", "ciclo de prerrequisitos: h → h"]]],
  ];

  it.each(casos)("%s", (_nombre, cambios, esperados) => {
    comprobar(banco(...cambios), "errores", esperados);
  });

  // Revisión de HU-005: después de una solución, un encabezado mal escrito se pegaba a ella y la pregunta
  // se perdía sin ningún error. Ahora abre su propio bloque y se rechaza.
  it.each([
    ["sin espacio después de ###", "###P2 · dificultad 2 · kc: h · revisada · origen: humano · revisó: Ana"],
    ["con un espacio delante", " ### P2 · dificultad 2 · kc: h · revisada · origen: humano · revisó: Ana"],
    ["con cuatro #", "#### P2 · dificultad 2 · kc: h · revisada · origen: humano · revisó: Ana"],
  ])("un encabezado de pregunta %s después de una solución no se pierde: es error", (_nombre, encabezado) => {
    const resultado = banco([
      "m/t.md",
      "- D) 0 · [e]\n",
      `- D) 0 · [e]\n\nsolución: 1 + 1 = 2\n\n${encabezado}\n¿Y 2 + 2?\n\n- A) 4 · CORRECTA\n- B) 5 · [e]\n- C) 6 · [e]\n- D) 0 · [e]\n`,
    ]);
    comprobar(resultado, "errores", [["m/t.md:21", "encabezado de pregunta mal formado"]]);
    expect(preguntaDe(resultado, "m", "P1").solucion).toBe("1 + 1 = 2");
  });

  it("una sección con espacios delante dentro de una solución es error, no parte de la solución", () => {
    const resultado = banco(["m/t.md", "- D) 0 · [e]\n", "- D) 0 · [e]\n\nsolución: 1 + 1 = 2\n\n ## Errores\n"]);
    comprobar(resultado, "errores", [["m/t.md:21", "parece un encabezado"]]);
  });

  it("carpeta con un nombre que no sirve como clave de materia", () => {
    const resultado = analizarBanco([
      { ruta: "Mi_Materia/materia.md", texto: MATERIA },
      { ruta: "Mi_Materia/t.md", texto: TEMA },
    ]);
    comprobar(resultado, "errores", [["Mi_Materia/materia.md:1", 'la carpeta "Mi_Materia" no sirve como clave de materia']]);
  });

  it("prerrequisito a una habilidad que no existe en otra materia, y ciclo entre materias", () => {
    const otra = (kc: string): Cambio[] => [
      ["n/materia.md", null, MATERIA.replace("ZZPR-0101", "ZZPR-0102")],
      ["n/t.md", null, TEMA.replace("kc: h · Una habilidad", kc)],
    ];
    comprobar(banco(["m/t.md", "Una habilidad", "Una habilidad · prerrequisitos: n/zzz"], ...otra("kc: h · Una habilidad")), "errores", [
      ["m/t.md:4", 'el prerrequisito "n/zzz" de "h" no existe'],
    ]);
    comprobar(banco(["m/t.md", "Una habilidad", "Una habilidad · prerrequisitos: n/h"], ...otra("kc: h · Una habilidad · prerrequisitos: m/h")), "errores", [
      ["n/t.md:4", "ciclo de prerrequisitos: m/h → h → m/h"],
    ]);
  });
});

describe("avisos (no rechazan)", () => {
  const casos: [string, Cambio[], [string, string][]][] = [
    ["borrador de IA sin solución", [["m/t.md", "revisada · origen: humano · revisó: Ana", "borrador · origen: ia (modelo)"]], [["m/t.md:11", 'es un borrador de IA sin "solución:"']]],
    ["opción con la misconcepción de una habilidad que la pregunta no mide", [
      ["m/t.md", "kc: h · Una habilidad\n", "kc: h · Una habilidad\nkc: h2 · Otra habilidad\n"],
      ["m/t.md", "mc: e · h · un error\n", "mc: e · h · un error\nmc: f · h2 · otro error\n"],
      ["m/t.md", "- B) 3 · [e]", "- B) 3 · [f]"],
    ], [["m/t.md:17", 'la opción B de P1 usa "f", que es de la habilidad "h2" y la pregunta no la mide']]],
    ["pregunta que mide una habilidad de otro tema", [
      ["m/materia.md", "- t\n", "- t\n- u\n"],
      ["m/u.md", null, temaSolo("U", "kc: g · De otro tema")],
      ["m/t.md", "dificultad 2 · kc: h ·", "dificultad 2 · kc: h, g ·"],
    ], [["m/t.md:11", 'la pregunta P1 mide "g", que es del tema "u"']]],
    ["revisada que conserva ⚠ revisar", [["m/t.md", "revisó: Ana", "revisó: Ana · ⚠ revisar"]], [["m/t.md:11", 'conserva la marca "⚠ revisar"']]],
    ["enunciado que es solo código", [["m/t.md", "¿Cuánto es 1 + 1?", "```\nprint(1 + 1)\n```"]], [["m/t.md:12", "el enunciado de P1 es solo código"]]],
  ];

  it.each(casos)("%s", (_nombre, cambios, esperados) => {
    const resultado = banco(...cambios);
    comprobar(resultado, "errores", []);
    comprobar(resultado, "avisos", esperados);
  });
});

describe("partición de opciones y armado del enunciado (portados del prototipo)", () => {
  it("parte en el ÚLTIMO '·' aislado que no esté dentro de $…$", () => {
    expect(partirOpcion("x · ln(x) · [no-separa] no separas el producto")).toEqual({ texto: "x · ln(x)", cola: "[no-separa] no separas el producto" });
    expect(partirOpcion("$a · b$ · CORRECTA")).toEqual({ texto: "$a · b$", cola: "CORRECTA" });
    expect(partirOpcion("$p · q$ · r · [e]")).toEqual({ texto: "$p · q$ · r", cola: "[e]" });
    expect(partirOpcion("$a · b$")).toEqual({ texto: "$a · b$", cola: "" });
    // El "·" pegado es multiplicación y no separa.
    expect(partirOpcion("x·y · [e]")).toEqual({ texto: "x·y", cola: "[e]" });
  });

  it("une la prosa con espacios, conserva la sangría de las cercas y se detiene en la primera opción", () => {
    const numeradas = (lineas: string[]) => lineas.map((texto, i) => ({ texto, numero: i + 20 }));
    expect(armarEnunciado(numeradas(["", "Primera", "segunda", "", "tercera", "- A) 1 · CORRECTA"]), "P1")).toEqual({
      texto: "Primera segunda tercera",
      linea: 21,
      usadas: 5,
      problemas: [],
    });
    const conCerca = armarEnunciado(numeradas(["Qué imprime:", "```", "if x:", "    y()   ", "", "```", "fin.", "", "- A) 1 · CORRECTA"]), "P1");
    expect(conCerca.texto).toBe("Qué imprime:\n```\nif x:\n    y()\n\n```\nfin.");
    expect(conCerca.usadas).toBe(8);
    // Dentro de una cerca, una línea que parece opción es código.
    expect(armarEnunciado(numeradas(["```", "- A) no es opción", "```", "- A) sí"]), "P1")).toMatchObject({ texto: "```\n- A) no es opción\n```", usadas: 3 });
  });
});

describe("expansión de las evaluaciones acumulativas", () => {
  it("suma los temas de las evaluaciones de semana menor, sin repetir y en el orden de ## Temas", () => {
    const materia = [
      "---",
      "codigo: ZZPR-0103",
      "nombre: Expansión",
      "---",
      "## Temas",
      "- t1",
      "- t2",
      "- t3",
      "## Evaluaciones",
      // Escritas fuera de orden: lo que cuenta es la semana.
      "### e3 · Tercera · semana 8 · acumulativa",
      "temas: t1",
      "### e1 · Primera · semana 4",
      "temas: t2",
      "### e2 · Misma semana · semana 4 · acumulativa",
      "temas: t3",
      "### e4 · Final · semana 10 · acumulativa",
      "temas:",
      "",
    ].join("\n");
    const resultado = analizarBanco([
      { ruta: "x/materia.md", texto: materia },
      { ruta: "x/t1.md", texto: temaSolo("Uno", "kc: k1 · Uno") },
      { ruta: "x/t2.md", texto: temaSolo("Dos", "kc: k2 · Dos") },
      { ruta: "x/t3.md", texto: temaSolo("Tres", "kc: k3 · Tres") },
    ]);
    comprobar(resultado, "errores", []);
    const temas = Object.fromEntries(resultado.banco.materias[0].evaluaciones.map((e) => [e.clave, e.temas]));
    expect(temas).toEqual({
      e1: ["t2"],
      // e1 es de la misma semana: no es "anterior".
      e2: ["t3"],
      e3: ["t1", "t2", "t3"],
      e4: ["t1", "t2", "t3"],
    });
    expect(contar(resultado.banco, { borradores: false }).evaluacionTema).toBe(1 + 1 + 3 + 3);
  });
});

describe("cobertura y evaluación activa", () => {
  const pregunta = (clave: string, dificultad: number, estado: string, trampas = "[e]") =>
    `### ${clave} · dificultad ${dificultad} · kc: h · ${estado} · origen: humano · revisó: Ana\n¿${clave}?\n\n- A) 1 · CORRECTA\n- B) 2 · ${trampas}\n- C) 3 · ${trampas}\n- D) 4 · ${trampas}\n\n`;
  const conPreguntas = (...preguntas: string[]) => banco(["m/t.md", TEMA.slice(TEMA.indexOf("### P1")), preguntas.join("")]);

  it("una habilidad cumple con 3 revisadas en 2 dificultades; los borradores y las retiradas no cuentan", () => {
    const enUnaDificultad = conPreguntas(pregunta("P1", 2, "revisada"), pregunta("P2", 2, "revisada"), pregunta("P3", 2, "revisada"), pregunta("P4", 3, "borrador"), pregunta("P5", 1, "retirada"));
    comprobar(enUnaDificultad, "errores", []);
    expect(enUnaDificultad.cobertura.habilidades).toEqual([{ materia: "m", clave: "h", revisadas: 3, dificultades: [2], cumple: false }]);
    expect(enUnaDificultad.banco.materias[0].evaluaciones[0].activa).toBe(false);

    const cumple = conPreguntas(pregunta("P1", 2, "revisada"), pregunta("P2", 2, "revisada"), pregunta("P3", 3, "revisada"));
    expect(cumple.cobertura.habilidades).toEqual([{ materia: "m", clave: "h", revisadas: 3, dificultades: [2, 3], cumple: true }]);
    expect(cumple.banco.materias[0].evaluaciones[0].activa).toBe(true);

    const dos = conPreguntas(pregunta("P1", 2, "revisada"), pregunta("P3", 3, "revisada"));
    expect(dos.cobertura.habilidades[0]).toMatchObject({ revisadas: 2, cumple: false });
  });

  it("la cobertura de misconcepciones cuenta preguntas distintas y no decide si la evaluación queda activa", () => {
    // "e" sale en las tres opciones incorrectas de una pregunta: cuenta una vez. "f" no sale en ninguna.
    const resultado = banco(
      ["m/t.md", "mc: e · h · un error\n", "mc: e · h · un error\nmc: f · h · otro error\n"],
      ["m/t.md", TEMA.slice(TEMA.indexOf("### P1")), pregunta("P1", 1, "revisada") + pregunta("P2", 2, "revisada") + pregunta("P3", 3, "revisada")],
    );
    comprobar(resultado, "errores", []);
    expect(resultado.cobertura.misconcepciones).toEqual([
      { materia: "m", clave: "e", habilidad: "h", preguntas: 3, cumple: true },
      { materia: "m", clave: "f", habilidad: "h", preguntas: 0, cumple: false },
    ]);
    expect(resultado.banco.materias[0].evaluaciones[0].activa).toBe(true);
  });

  it("seCarga: revisadas siempre, borradores solo con --borradores, retiradas nunca", () => {
    const de = (estado: Pregunta["estado"]) => ({ estado }) as Pregunta;
    expect([seCarga(de("revisada"), { borradores: false }), seCarga(de("borrador"), { borradores: false }), seCarga(de("retirada"), { borradores: false })]).toEqual([true, false, false]);
    expect([seCarga(de("revisada"), { borradores: true }), seCarga(de("borrador"), { borradores: true }), seCarga(de("retirada"), { borradores: true })]).toEqual([true, true, false]);
  });
});

describe("línea de comandos (convertir.mts)", () => {
  afterEach(() => vi.restoreAllMocks());

  const correr = async (...argv: string[]) => {
    vi.restoreAllMocks();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const codigo = await principal(argv);
    const texto = (espia: typeof log) => espia.mock.calls.map((c) => c.join(" ")).join("\n");
    return { codigo, salida: texto(log), errores: texto(error) };
  };

  it("--dry-run sobre el banco de ejemplo imprime el reporte y sale con 0", async () => {
    const { codigo, salida } = await correr("--dry-run", "--banco", EJEMPLO);
    expect(codigo).toBe(0);
    expect(salida).toContain("✓ Sin errores (1 aviso).");
    expect((await correr("--dry-run", "--borradores", "--banco", EJEMPLO)).salida).toContain("revisadas y borradores, --borradores");
  });

  // La carga en sí se prueba contra la base local en integracion/banco.test.ts; aquí solo la barrera, que
  // corta antes de abrir una conexión.
  it("sin --dry-run se niega a cargar si SUPABASE_DB_URL no es local, sin mostrar la URL", async () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgresql://postgres:no-mostrar@db.ejemplo.com:5432/postgres");
    try {
      const { codigo, errores } = await correr("--banco", EJEMPLO);
      expect(codigo).toBe(1);
      expect(errores).toContain("SUPABASE_DB_URL no apunta a la base local");
      expect(errores).not.toContain("no-mostrar");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("un argumento desconocido o --banco sin ruta salen con 1 y el uso", async () => {
    for (const argv of [["--escribir"], ["--banco"]]) {
      const { codigo, errores } = await correr(...argv);
      expect(codigo).toBe(1);
      expect(errores).toContain("Uso: node scripts/contenido/convertir.mts");
    }
  });

  // Criterio 8: el CI corre el script con node, no principal(). Esto prueba el proceso de verdad: que el
  // script arranca solo y que un banco con errores termina con 1.
  it("como proceso, sale con 0 si el banco está bien y con 1 si tiene errores", () => {
    const script = join(__dirname, "..", "scripts", "contenido", "convertir.mts");
    const correrProceso = (banco: string) => spawnSync(process.execPath, [script, "--dry-run", "--banco", banco], { encoding: "utf8" });

    const bien = correrProceso(EJEMPLO);
    expect(bien.status, bien.stderr).toBe(0);
    expect(bien.stdout).toContain("✓ Sin errores");

    const roto = mkdtempSync(join(tmpdir(), "banco-roto-"));
    try {
      mkdirSync(join(roto, "m"));
      writeFileSync(join(roto, "m", "materia.md"), MATERIA);
      writeFileSync(join(roto, "m", "t.md"), TEMA.replace("- B) 3 · [e]", "- B) 3 · CORRECTA"));
      const mal = correrProceso(roto);
      expect(mal.status).toBe(1);
      expect(`${mal.stdout}${mal.stderr}`).toContain("m/t.md:11  la pregunta P1 tiene 2 opciones marcadas CORRECTA");
    } finally {
      rmSync(roto, { recursive: true, force: true });
    }
  });
});
