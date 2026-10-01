import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { analizarBanco, formatearDiagnostico } from "../scripts/contenido/banco.mts";
import {
  cargarOraculo,
  compararConOraculo,
  leerArgumentos,
  leerPrototipo,
  migrarMateria,
  principal,
} from "../scripts/contenido/migrar-prototipo.mts";
import type { MateriaOraculo } from "../scripts/contenido/migrar-prototipo.mts";
import type { ArchivoBanco } from "../scripts/contenido/modelo.mts";

// HU-005: migración del banco del prototipo (scripts/contenido/migrar-prototipo.mts). Usa un prototipo
// sintético mínimo en línea y no el real (que no está en este repo):
// - zz-con-kc, como Cálculo Integral: declara kc y mc. P2 (revisada) va antes que P1 (borrador) en el
//   archivo; hay opciones cuyo error es idéntico a la descripción de su mc (quedan "· [mc]") y otras con
//   texto propio, y una opción con " · " dentro del texto.
// - zz-sin-kc, como las otras 7: sin kc. El error "confundes % con //" se repite dentro de tipos (una sola
//   mc) y aparece también en cadenas (otra mc, la de ese tema). P1 tiene una cerca con sangría.

const CON_KC = [
  "---",
  "id: zz-con-kc",
  "codigo: ZZPR-0101",
  "nombre: Materia con habilidades",
  "libro: Libro de prueba",
  "contexto: antes del parcial 2",
  "activa: true",
  "longitud: 12",
  "---",
  "",
  "Introducción de la materia.",
  "",
  "## derivadas · Derivadas",
  "",
  "kc: potencia · Derivar xⁿ con la regla de la potencia",
  "kc: cadena · Aplicar la regla de la cadena",
  "mc: baja-exponente · potencia · olvidas bajar el exponente",
  "mc: sin-interna · cadena · no multiplicas por la derivada interna",
  "",
  "### P2 · dificultad 2 · kc: potencia",
  "¿Cuál es la derivada de $x^3$?",
  "",
  "- A) $3x^2$ · CORRECTA",
  "- B) $x^2$ · [baja-exponente] olvidas bajar el exponente",
  "- C) x · 3 · [baja-exponente] multiplicas por 3 sin bajar el exponente",
  "- D) $3x^{3}$ · [baja-exponente] te equivocas al restar 1 al exponente",
  "",
  "### P1 · dificultad 3 · kc: potencia, cadena · borrador",
  "Deriva (2x + 1)².",
  "",
  "- A) 4(2x + 1) · CORRECTA",
  "- B) 2(2x + 1) · [sin-interna] no multiplicas por la derivada interna",
  "- C) 2(2x + 1)·2x · [sin-interna] multiplicas por algo que no es la derivada interna",
  "- D) (2x + 1) · [baja-exponente] olvidas bajar el exponente",
  "",
].join("\n");

const SIN_KC = [
  "---",
  "id: zz-sin-kc",
  "codigo: ZZPR-0102",
  "nombre: Materia sin habilidades",
  "contexto: antes del parcial 1",
  "activa: true",
  "longitud: 12",
  "---",
  "",
  "Introducción con ``` a mitad de línea, que no es una cerca.",
  "",
  "## tipos · Tipos y operadores",
  "",
  "Errores que vale la pena cazar: `//` y `%`.",
  "",
  "### P1 · dificultad 1",
  "¿Qué imprime este programa?",
  "```",
  "def f(x):",
  "    return x % 5",
  "print(f(17))",
  "```",
  "",
  "- A) 2 · CORRECTA",
  "- B) 3 · confundes % con //",
  "- C) 3.4 · confundes % con /",
  "- D) 0 · confundes % con //",
  "",
  "## cadenas · Cadenas",
  "",
  "### P2 · dificultad 2",
  '¿Qué da len("hola")?',
  "",
  "- A) 4 · CORRECTA",
  "- B) 5 · confundes % con //",
  "- C) 3 · cuentas desde cero",
  '- D) "hola" · confundes la función con su argumento',
  "",
].join("\n");

const SEMANAS = { "zz-con-kc": 12, "zz-sin-kc": 6 };

/** Lo que tiene que escribir la migración, archivo por archivo. */
const ESPERADO: Record<string, string[]> = {
  "zz-con-kc/materia.md": [
    "---",
    "codigo: ZZPR-0101",
    "nombre: Materia con habilidades",
    "libro: Libro de prueba",
    "---",
    "",
    "Introducción de la materia.",
    "",
    "## Temas",
    "- derivadas",
    "",
    "## Evaluaciones",
    "",
    "### parcial-2 · Parcial 2 · semana 12",
    "temas: derivadas",
  ],
  "zz-con-kc/derivadas.md": [
    "# Derivadas",
    "",
    "## Habilidades",
    "kc: potencia · Derivar xⁿ con la regla de la potencia",
    "kc: cadena · Aplicar la regla de la cadena",
    "",
    "## Errores",
    "mc: baja-exponente · potencia · olvidas bajar el exponente",
    "mc: sin-interna · cadena · no multiplicas por la derivada interna",
    "",
    "## Preguntas",
    "",
    "### P2 · dificultad 2 · kc: potencia · revisada · origen: humano · revisó: prototipo",
    "¿Cuál es la derivada de $x^3$?",
    "",
    "- A) $3x^2$ · CORRECTA",
    "- B) $x^2$ · [baja-exponente]",
    "- C) x · 3 · [baja-exponente] multiplicas por 3 sin bajar el exponente",
    "- D) $3x^{3}$ · [baja-exponente] te equivocas al restar 1 al exponente",
    "",
    "### P1 · dificultad 3 · kc: potencia, cadena · borrador · origen: ia (desconocido)",
    "Deriva (2x + 1)².",
    "",
    "- A) 4(2x + 1) · CORRECTA",
    "- B) 2(2x + 1) · [sin-interna]",
    "- C) 2(2x + 1)·2x · [sin-interna] multiplicas por algo que no es la derivada interna",
    "- D) (2x + 1) · [baja-exponente]",
  ],
  "zz-sin-kc/materia.md": [
    "---",
    "codigo: ZZPR-0102",
    "nombre: Materia sin habilidades",
    "---",
    "",
    "Introducción con ``` a mitad de línea, que no es una cerca.",
    "",
    "## Temas",
    "- tipos",
    "- cadenas",
    "",
    "## Evaluaciones",
    "",
    "### parcial-1 · Parcial 1 · semana 6",
    "temas: tipos, cadenas",
  ],
  "zz-sin-kc/tipos.md": [
    "# Tipos y operadores",
    "",
    "Errores que vale la pena cazar: `//` y `%`.",
    "",
    "## Habilidades",
    "kc: tipos · Tipos y operadores",
    "",
    "## Errores",
    "mc: tipos-e1 · tipos · confundes % con //",
    "mc: tipos-e2 · tipos · confundes % con /",
    "",
    "## Preguntas",
    "",
    "### P1 · dificultad 1 · kc: tipos · revisada · origen: humano · revisó: prototipo",
    "¿Qué imprime este programa?",
    "```",
    "def f(x):",
    "    return x % 5",
    "print(f(17))",
    "```",
    "",
    "- A) 2 · CORRECTA",
    "- B) 3 · [tipos-e1]",
    "- C) 3.4 · [tipos-e2]",
    "- D) 0 · [tipos-e1]",
  ],
  "zz-sin-kc/cadenas.md": [
    "# Cadenas",
    "",
    "## Habilidades",
    "kc: cadenas · Cadenas",
    "",
    "## Errores",
    "mc: cadenas-e1 · cadenas · confundes % con //",
    "mc: cadenas-e2 · cadenas · cuentas desde cero",
    "mc: cadenas-e3 · cadenas · confundes la función con su argumento",
    "",
    "## Preguntas",
    "",
    "### P2 · dificultad 2 · kc: cadenas · revisada · origen: humano · revisó: prototipo",
    '¿Qué da len("hola")?',
    "",
    "- A) 4 · CORRECTA",
    "- B) 5 · [cadenas-e1]",
    "- C) 3 · [cadenas-e2]",
    '- D) "hola" · [cadenas-e3]',
  ],
};

/** Una opción como la devuelve convertir.js: error y mc vacíos en la correcta. */
const op = (letra: string, texto: string, error = "", mc = "") => ({ letra, texto, correcta: error === "", error, mc });

// Lo que devolvería leerMateria de convertir.js con --borradores para el prototipo sintético: ids en
// minúsculas y preguntas ordenadas por número. Escrito a mano, sin pasar por el lector de la migración.
const ORACULO: MateriaOraculo[] = [
  {
    id: "zz-con-kc",
    codigo: "ZZPR-0101",
    nombre: "Materia con habilidades",
    libro: "Libro de prueba",
    contexto: "antes del parcial 2",
    subtemas: { derivadas: "Derivadas" },
    kcs: {
      potencia: { subtema: "derivadas", nombre: "Derivar xⁿ con la regla de la potencia" },
      cadena: { subtema: "derivadas", nombre: "Aplicar la regla de la cadena" },
    },
    misconcepciones: {
      "baja-exponente": { kc: "potencia", texto: "olvidas bajar el exponente" },
      "sin-interna": { kc: "cadena", texto: "no multiplicas por la derivada interna" },
    },
    preguntas: [
      {
        id: "p1",
        subtema: "derivadas",
        dificultad: 3,
        kcs: ["potencia", "cadena"],
        borrador: true,
        enunciado: "Deriva (2x + 1)².",
        opciones: [
          op("A", "4(2x + 1)"),
          op("B", "2(2x + 1)", "no multiplicas por la derivada interna", "sin-interna"),
          op("C", "2(2x + 1)·2x", "multiplicas por algo que no es la derivada interna", "sin-interna"),
          op("D", "(2x + 1)", "olvidas bajar el exponente", "baja-exponente"),
        ],
      },
      {
        id: "p2",
        subtema: "derivadas",
        dificultad: 2,
        kcs: ["potencia"],
        borrador: false,
        enunciado: "¿Cuál es la derivada de $x^3$?",
        opciones: [
          op("A", "$3x^2$"),
          op("B", "$x^2$", "olvidas bajar el exponente", "baja-exponente"),
          op("C", "x · 3", "multiplicas por 3 sin bajar el exponente", "baja-exponente"),
          op("D", "$3x^{3}$", "te equivocas al restar 1 al exponente", "baja-exponente"),
        ],
      },
    ],
  },
  {
    id: "zz-sin-kc",
    codigo: "ZZPR-0102",
    nombre: "Materia sin habilidades",
    libro: "",
    contexto: "antes del parcial 1",
    subtemas: { tipos: "Tipos y operadores", cadenas: "Cadenas" },
    kcs: {},
    misconcepciones: {},
    preguntas: [
      {
        id: "p1",
        subtema: "tipos",
        dificultad: 1,
        kcs: [],
        borrador: false,
        enunciado: "¿Qué imprime este programa?\n```\ndef f(x):\n    return x % 5\nprint(f(17))\n```",
        opciones: [op("A", "2"), op("B", "3", "confundes % con //"), op("C", "3.4", "confundes % con /"), op("D", "0", "confundes % con //")],
      },
      {
        id: "p2",
        subtema: "cadenas",
        dificultad: 2,
        kcs: [],
        borrador: false,
        enunciado: '¿Qué da len("hola")?',
        opciones: [
          op("A", "4"),
          op("B", "5", "confundes % con //"),
          op("C", "3", "cuentas desde cero"),
          op("D", '"hola"', "confundes la función con su argumento"),
        ],
      },
    ],
  },
];

/** Migra los textos del prototipo sintético; falla si el lector o la migración reportan errores. */
function migrar(textos: [string, string][]): ArchivoBanco[] {
  const archivos: ArchivoBanco[] = [];
  for (const [nombre, texto] of textos) {
    const leida = leerPrototipo(nombre, texto);
    expect(leida.errores).toEqual([]);
    const migrada = migrarMateria(leida.materia, SEMANAS);
    expect(migrada.errores).toEqual([]);
    archivos.push(...migrada.archivos);
  }
  return archivos;
}

const PROTOTIPO: [string, string][] = [
  ["zz-con-kc.md", CON_KC],
  ["zz-sin-kc.md", SIN_KC],
];

describe("migración del formato viejo al nuevo", () => {
  const archivos = migrar(PROTOTIPO);

  it("escribe materia.md y un archivo por tema, en el formato nuevo, con LF y salto final", () => {
    expect(archivos.map((a) => a.ruta).sort()).toEqual(Object.keys(ESPERADO).sort());
    for (const a of archivos) expect(a.texto, a.ruta).toBe(`${ESPERADO[a.ruta].join("\n")}\n`);
  });

  it("lee igual un archivo con CRLF y BOM", () => {
    const conCrlf = migrar(PROTOTIPO.map(([nombre, texto]) => [nombre, `﻿${texto.replaceAll("\n", "\r\n")}`]));
    expect(conCrlf).toEqual(archivos);
  });

  it("el validador nuevo lo lee sin errores; el único aviso es el borrador de IA sin solución", () => {
    const resultado = analizarBanco(archivos);
    expect(resultado.errores.map(formatearDiagnostico)).toEqual([]);
    expect(resultado.avisos.map(formatearDiagnostico)).toEqual([
      'zz-con-kc/derivadas.md:21  la pregunta P1 es un borrador de IA sin "solución:": hay que escribirla antes de marcarla revisada',
    ]);
  });

  it("reparsea igual que el oráculo: mismos temas, enunciados, opciones y errores efectivos", () => {
    const { banco } = analizarBanco(archivos);
    const { diferencias, totales } = compararConOraculo(ORACULO, banco, SEMANAS);
    expect(diferencias).toEqual([]);
    // zz-con-kc: 2 kc y 2 mc; zz-sin-kc: una habilidad por tema y 2 + 3 errores distintos por tema.
    expect(totales).toEqual({ materias: 2, temas: 3, habilidades: 4, misconcepciones: 7, preguntas: 4, borradores: 1, opciones: 16 });
  });
});

describe("la comparación con el oráculo encuentra las diferencias", () => {
  const archivos = migrar(PROTOTIPO);
  const comparar = (cambiar: (a: ArchivoBanco[]) => ArchivoBanco[]) =>
    compararConOraculo(ORACULO, analizarBanco(cambiar(archivos)).banco, SEMANAS).diferencias;
  const reemplazar = (ruta: string, de: string | RegExp, a: string) => (xs: ArchivoBanco[]) =>
    xs.map((x) => (x.ruta === ruta ? { ruta, texto: x.texto.replace(de, a) } : x));

  it("un enunciado distinto, aunque sea dentro de la cerca", () => {
    const diferencias = comparar(reemplazar("zz-sin-kc/tipos.md", "    return x % 5", "    return x % 6"));
    expect(diferencias).toHaveLength(1);
    expect(diferencias[0]).toMatch(/^zz-sin-kc\/tipos\.md:14 P1: el enunciado no coincide/);
  });

  it("una opción que apunta a otra misconcepción (cambia el error efectivo)", () => {
    const diferencias = comparar(reemplazar("zz-sin-kc/tipos.md", "- B) 3 · [tipos-e1]", "- B) 3 · [tipos-e2]"));
    expect(diferencias).toHaveLength(1);
    expect(diferencias[0]).toMatch(/P1: la opción B .* no coincide/);
  });

  it("un texto propio que se perdió en una materia con kc", () => {
    const diferencias = comparar(reemplazar("zz-con-kc/derivadas.md", "[baja-exponente] multiplicas por 3 sin bajar el exponente", "[baja-exponente]"));
    expect(diferencias).toHaveLength(1);
    expect(diferencias[0]).toMatch(/P2: la opción C .* no coincide/);
  });

  it("un borrador que quedó revisado y una semana distinta", () => {
    const diferencias = comparar((xs) =>
      reemplazar("zz-sin-kc/materia.md", "semana 6", "semana 7")(
        reemplazar("zz-con-kc/derivadas.md", "· borrador · origen: ia (desconocido)", "· revisada · origen: humano · revisó: prototipo")(xs),
      ),
    );
    expect(diferencias).toHaveLength(2);
    expect(diferencias.some((d) => /P1: el estado no coincide/.test(d))).toBe(true);
    expect(diferencias.some((d) => /^zz-sin-kc\/materia\.md: la evaluación no coincide/.test(d))).toBe(true);
  });

  it("una pregunta o una materia que falta en la salida", () => {
    expect(comparar(reemplazar("zz-sin-kc/cadenas.md", /\n### P2[\s\S]*$/, "\n"))).toContain("zz-sin-kc: la pregunta p2 del prototipo no está en la salida");
    expect(comparar((xs) => xs.filter((x) => !x.ruta.startsWith("zz-con-kc/")))).toEqual(["zz-con-kc: la materia no está en la salida"]);
  });
});

describe("el lector del formato viejo no pierde nada en silencio", () => {
  const errores = (texto: string) => {
    const leida = leerPrototipo("x.md", texto);
    return [...leida.errores, ...migrarMateria(leida.materia, { "zz-sin-kc": 6 }).errores];
  };

  it("texto después de las opciones (convertir.js lo ignoraba)", () => {
    expect(errores(SIN_KC.replace("- D) 0 · confundes % con //", "- D) 0 · confundes % con //\nUna nota suelta."))).toEqual([
      "x.md:28  línea inesperada después de las opciones de P1",
    ]);
  });

  it("una clave desconocida en el frontmatter", () => {
    expect(errores(SIN_KC.replace("longitud: 12", "longitud: 12\nautor: alguien"))).toEqual([
      'x.md:8  clave "autor" desconocida en el frontmatter: la migración no sabría dónde ponerla',
    ]);
  });

  it("un contexto que no corresponde a ninguna evaluación y una materia sin semana", () => {
    expect(errores(SIN_KC.replace("antes del parcial 1", "antes del final").replace("id: zz-sin-kc", "id: zz-otra"))).toEqual([
      'x.md:1  no sé a qué evaluación corresponde el contexto "antes del final": agrégalo a EVALUACIONES en migrar-prototipo.mts',
      'x.md:1  falta la semana de "zz-otra" en SEMANAS (migrar-prototipo.mts)',
    ]);
  });

  it("un id que no sirve como carpeta (la carpeta se sobrescribe)", () => {
    expect(errores(SIN_KC.replace("id: zz-sin-kc", "id: ../afuera"))).toContain(
      'x.md:1  el id "../afuera" no sirve como carpeta: minúsculas y dígitos separados por guiones',
    );
  });

  it("una opción incorrecta sin error y un token desconocido en el encabezado", () => {
    expect(errores(SIN_KC.replace("- C) 3 · cuentas desde cero", "- C) 3"))).toEqual(["x.md:36  la opción C de P2 no dice qué error conceptual delata"]);
    expect(errores(SIN_KC.replace("### P2 · dificultad 2", "### P2 · dificultad 2 · revisada"))).toEqual([
      'x.md:31  no entiendo "revisada" en el encabezado de P2',
    ]);
  });

  it("una cerca sin cerrar: la corta el siguiente subtema y la pregunta se queda sin opciones", () => {
    expect(errores(SIN_KC.replace("print(f(17))\n```", "print(f(17))"))).toEqual([
      "x.md:18  la cerca de código de P1 no se cierra. Falta una línea con solo ```",
      "x.md:16  la pregunta P1 debe tener 4 opciones, A, B, C y D, en ese orden",
      "x.md:16  la pregunta P1 tiene 0 opciones marcadas CORRECTA",
    ]);
  });

  it("una materia sin kc que usa [mc]", () => {
    expect(errores(SIN_KC.replace("- B) 5 · confundes % con //", "- B) 5 · [mc-x] confundes % con //"))).toEqual([
      'x.md:31  la pregunta P2 usa kc o [mc] pero la materia no declara ningún "kc:"',
    ]);
  });
});

describe("oráculo y línea de comandos", () => {
  const temporal = mkdtempSync(join(tmpdir(), "migrar-prototipo-"));
  afterAll(() => rmSync(temporal, { recursive: true, force: true }));
  afterEach(() => vi.restoreAllMocks());

  it("carga convertir.js sin correr su programa principal, con --borradores y sus archivos ignorados", () => {
    const dir = join(temporal, "oraculo");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "convertir.js"),
      [
        "'use strict';",
        "const fs = require('fs');",
        "const path = require('path');",
        "const DIR = __dirname;",
        "const IGNORAR = ['README.md', 'plantilla-materia.md'];",
        "const INCLUIR_BORRADORES = process.argv.indexOf('--borradores') !== -1;",
        "const errores = [];",
        "function leerMateria(archivo) {",
        "  const texto = fs.readFileSync(path.join(DIR, archivo), 'utf8');",
        "  if (!texto.trim()) errores.push(archivo + ':1  vacío');",
        "  return { id: archivo.replace(/\\.md$/, ''), borradores: INCLUIR_BORRADORES };",
        "}",
        "/* ---------- Programa ---------- */",
        "throw new Error('el programa principal no debe correr');",
      ].join("\n"),
    );
    for (const nombre of ["a.md", "README.md", "plantilla-materia.md"]) writeFileSync(join(dir, nombre), "algo");
    writeFileSync(join(dir, "b.md"), "");
    const oraculo = cargarOraculo(dir);
    expect(JSON.parse(JSON.stringify(oraculo))).toEqual({
      materias: [
        { id: "a", borradores: true },
        { id: "b", borradores: true },
      ],
      errores: ["b.md:1  vacío"],
    });
  });

  it("si el prototipo tiene errores no escribe nada y sale con 1", () => {
    const prototipo = join(temporal, "prototipo-roto");
    const salida = join(temporal, "salida");
    mkdirSync(prototipo);
    mkdirSync(salida);
    writeFileSync(join(prototipo, "zz-con-kc.md"), CON_KC);
    writeFileSync(join(prototipo, "zz-sin-kc.md"), SIN_KC.replace("antes del parcial 1", "antes del final"));
    writeFileSync(join(prototipo, "README.md"), "no es una materia");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(principal([prototipo, "--salida", salida])).toBe(1);
    expect(readdirSync(salida)).toEqual([]);
    expect(error.mock.calls.flat().join("\n")).toContain('no sé a qué evaluación corresponde el contexto "antes del final"');
  });

  it("argumentos: la carpeta del prototipo es obligatoria y no acepta otros", () => {
    expect(leerArgumentos([])).toBe("Falta la carpeta contenido/ del prototipo.");
    expect(leerArgumentos(["p", "--borradores"])).toBe('No entiendo el argumento "--borradores".');
    expect(leerArgumentos(["p", "q"])).toBe('No entiendo el argumento "q".');
    expect(leerArgumentos(["p", "--salida"])).toBe("Falta la ruta después de --salida.");
    const argumentos = leerArgumentos(["p", "--salida", "s", "--verificar"]);
    expect(typeof argumentos === "object" && argumentos.soloVerificar).toBe(true);
  });
});
