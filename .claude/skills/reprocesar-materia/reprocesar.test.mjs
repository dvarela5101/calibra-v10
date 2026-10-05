// Pruebas de los scripts de la skill. Corren con:
//
//   node --test .claude/skills/reprocesar-materia/reprocesar.test.mjs
//
// No están en `npm test` (Vitest solo mira src/ y pruebas/) porque la HU-061 limita su diff a esta carpeta.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import { analizar, faltantesDeMeta, minimoPorAgregar, principal as coberturaPrincipal } from "./cobertura-proyectada.mjs";
import { chequear, flujoDeArchivo, fragmentosMatematicos, principal as copiaPrincipal, tokenizar } from "./chequeo-copia.mjs";
import { leerBanco } from "../../../scripts/contenido/banco.mts";

const MATERIA = `---
codigo: ZZPR-0002
nombre: Materia de prueba X
---

Banco de prueba de la skill reprocesar-materia. No es contenido real.

## Temas
- t1

## Evaluaciones

### parcial-1 · Parcial 1 · semana 5
temas: t1
`;

/** Una pregunta con cuatro opciones; las incorrectas apuntan a m1..m3 (habilidad a) o n1..n3 (habilidad b). */
function pregunta(id, dificultad, kc, estado) {
  const p = kc === "a" ? "m" : "n";
  const cabecera = estado === "revisada" ? `revisada · origen: humano · revisó: Ana` : estado === "borrador" ? "borrador · origen: ia (modelo-de-prueba)" : "retirada · origen: humano";
  return `### ${id} · dificultad ${dificultad} · kc: ${kc} · ${cabecera}
Enunciado de ${id}.

- A) uno · CORRECTA
- B) dos · [${p}1]
- C) tres · [${p}2]
- D) cuatro · [${p}3]

solución: la correcta es la A.
`;
}

const TEMA = `# Tema uno

## Habilidades
kc: a · Primera habilidad
kc: b · Segunda habilidad

## Errores
mc: m1 · a · error uno de a
mc: m2 · a · error dos de a
mc: m3 · a · error tres de a
mc: n1 · b · error uno de b
mc: n2 · b · error dos de b
mc: n3 · b · error tres de b

## Preguntas

${[
  pregunta("P1", 2, "a", "revisada"),
  pregunta("P2", 2, "a", "revisada"),
  pregunta("P3", 1, "a", "borrador"),
  pregunta("P4", 3, "a", "borrador"),
  pregunta("P5", 2, "a", "retirada"),
  pregunta("P6", 2, "b", "borrador"),
  pregunta("P7", 2, "b", "borrador"),
  pregunta("P8", 2, "b", "borrador"),
  pregunta("P9", 2, "b", "borrador"),
].join("\n")}`;

let carpeta;
let banco;

before(() => {
  carpeta = mkdtempSync(join(tmpdir(), "reprocesar-"));
  banco = join(carpeta, "banco");
  mkdirSync(join(banco, "materia-x"), { recursive: true });
  writeFileSync(join(banco, "materia-x", "materia.md"), MATERIA);
  writeFileSync(join(banco, "materia-x", "t1.md"), TEMA);
});

after(() => rmSync(carpeta, { recursive: true, force: true }));

describe("cobertura proyectada", () => {
  it("el banco de prueba es válido", () => {
    assert.deepEqual(leerBanco(banco).errores, []);
  });

  it("cuenta revisadas y borradores, no retiradas, y deja la actual como la del convertidor", () => {
    const materia = leerBanco(banco).banco.materias[0];
    const r = analizar(materia);
    const a = r.habilidades.find((h) => h.clave === "a");
    assert.equal(a.actual.preguntas, 2);
    assert.equal(a.actual.cumpleD13, false);
    assert.equal(a.proyectada.preguntas, 4);
    assert.deepEqual(a.proyectada.porDificultad, { 1: 1, 2: 2, 3: 1 });
    assert.equal(a.proyectada.cumpleMeta, true);
    assert.equal(a.proyectada.resisteRechazo, true);
    const b = r.habilidades.find((h) => h.clave === "b");
    assert.equal(b.proyectada.cumpleMeta, false);
    assert.equal(b.proyectada.cumpleD13, false);
    assert.equal(b.proyectada.porAgregar, 2);
    assert.deepEqual(r.sinMeta, ["b"]);
    assert.deepEqual(r.preguntas, { total: 9, revisadas: 2, borradores: 6, retiradas: 1, porRevisar: 0, origenIa: 6, origenHumano: 3 });
  });

  it("cuenta las misconcepciones como trampa sin las preguntas retiradas", () => {
    const r = analizar(leerBanco(banco).banco.materias[0], ["a"]);
    const m1 = r.misconcepciones.lista.find((m) => m.clave === "m1");
    assert.equal(m1.actual, 2);
    assert.equal(m1.proyectada, 4);
    assert.equal(r.misconcepciones.total, 3);
    assert.equal(r.misconcepciones.conTrampaEn2oMas, 3);
  });

  it("calcula lo que falta para la meta", () => {
    assert.deepEqual(faltantesDeMeta({ 1: 1, 2: 2, 3: 1 }), []);
    assert.equal(faltantesDeMeta({ 1: 0, 2: 3, 3: 0 }).length, 3);
    assert.equal(minimoPorAgregar({ 1: 1, 2: 2, 3: 1 }), 0);
    assert.equal(minimoPorAgregar({ 1: 0, 2: 0, 3: 0 }), 4);
    assert.equal(minimoPorAgregar({ 1: 0, 2: 3, 3: 0 }), 2);
  });

  it("sale con 2 si alguna habilidad no llega, con 0 si todas llegan y con 1 si el uso está mal", () => {
    const log = mock.method(console, "log", () => {});
    const error = mock.method(console, "error", () => {});
    try {
      assert.equal(coberturaPrincipal(["materia-x", "--banco", banco]), 2);
      assert.equal(coberturaPrincipal(["materia-x", "--banco", banco, "--temas", "t1", "--json"]), 2);
      assert.equal(coberturaPrincipal(["materia-x", "--banco", banco, "--evaluacion", "no-existe"]), 1);
      assert.equal(coberturaPrincipal(["no-existe", "--banco", banco]), 1);
      assert.equal(coberturaPrincipal([]), 1);
    } finally {
      log.mock.restore();
      error.mock.restore();
    }
  });
});

describe("chequeo de copia", () => {
  it("normaliza igual lo que sale de un PDF y lo que se escribe en TeX", () => {
    assert.deepEqual(tokenizar("x²−4"), ["x", "2", "4"]);
    assert.deepEqual(tokenizar("$x^2-4$"), ["x", "2", "4"]);
    assert.deepEqual(tokenizar("Límite \\sen(x) \\to"), ["limite", "sin", "x"]);
  });

  it("deja fuera del texto revisado los encabezados y las marcas de las opciones", () => {
    const { palabras } = flujoDeArchivo("---\ncodigo: X\n---\n### P1 · dificultad 2 · kc: a · borrador · origen: ia (m)\nSea la función dada\n\n- A) uno dos · CORRECTA\n- B) tres · [m1] cuatro cinco\n");
    assert.deepEqual(palabras.filter((p) => p !== null), ["sea", "la", "funcion", "dada", "uno", "dos", "tres", "cuatro", "cinco"]);
  });

  it("encuentra una secuencia compartida de 8 palabras o más y mide su largo", () => {
    const nuevos = [{ ruta: "m/t1.md", texto: "## Preguntas\nEl estudiante calcula la derivada de la función compuesta usando la regla de la cadena correctamente\n" }];
    const fuentes = [{ ruta: "a.txt", texto: "Aquí se dice que calcula la derivada de la función compuesta usando la regla de la cadena en clase" }];
    const r = chequear({ nuevos, fuentes });
    assert.equal(r.secuencias.length, 1);
    assert.equal(r.secuencias[0].palabras, 13);
    assert.equal(r.secuencias[0].ruta, "m/t1.md");
    assert.equal(r.secuencias[0].linea, 2);
  });

  it("no marca 7 palabras seguidas ni palabras repartidas", () => {
    const nuevos = [{ ruta: "m/t1.md", texto: "calcula la derivada de la función compuesta con cuidado\n" }];
    const fuentes = [{ ruta: "a.txt", texto: "calcula la derivada de la función compuesta y después con cuidado calcula la derivada" }];
    assert.equal(chequear({ nuevos, fuentes }).secuencias.length, 0);
    assert.equal(chequear({ nuevos, fuentes, palabras: 7 }).secuencias.length, 1);
  });

  it("una secuencia no cruza el límite entre dos opciones", () => {
    const nuevos = [{ ruta: "m/t1.md", texto: "- A) uno dos tres cuatro · CORRECTA\n- B) cinco seis siete ocho · [m1]\n" }];
    const fuentes = [{ ruta: "a.txt", texto: "uno dos tres cuatro cinco seis siete ocho" }];
    assert.equal(chequear({ nuevos, fuentes }).secuencias.length, 0);
  });

  it("marca la misma función con los mismos números y deja pasar otra", () => {
    const fuentes = [{ ruta: "a.txt", texto: "Ejercicio 3. Evalúe lim x→2 (x² − 4)/(x − 2)." }];
    const igual = { clave: "P1", enunciado: "Calcula $\\lim_{x\\to 2} \\frac{x^2 - 4}{x - 2}$", archivo: "m/t1.md", linea: 9 };
    const otra = { clave: "P2", enunciado: "Calcula $\\lim_{x\\to 3} \\frac{x^2 - 9}{x - 3}$", archivo: "m/t1.md", linea: 20 };
    const r = chequear({ nuevos: [], fuentes, preguntas: [igual, otra] });
    assert.deepEqual(r.pistas, [{ pregunta: "P1", ruta: "m/t1.md", linea: 9, fragmentos: 1 }]);
    assert.equal(r.preguntasMiradas, 2);
  });

  it("ignora los tramos de enunciado con una sola cifra o con palabras", () => {
    assert.deepEqual(fragmentosMatematicos("Sea f(x) = 2x para cada x"), []);
    assert.equal(fragmentosMatematicos("Calcula $\\lim_{x\\to 2} \\frac{x^2 - 4}{x - 2}$").length, 1);
  });

  it("no imprime texto del material ni, sin --detalle, sus nombres", () => {
    const texto = join(carpeta, "texto");
    mkdirSync(texto, { recursive: true });
    writeFileSync(join(texto, "secreto-no-imprimir.txt"), "uno dos tres cuatro cinco seis siete ocho nueve diez once doce Enunciado de P1 Enunciado de P2");
    const salida = [];
    const log = mock.method(console, "log", (x) => salida.push(String(x)));
    try {
      assert.equal(copiaPrincipal(["materia-x", "--banco", banco, "--texto", texto, "--palabras", "4"]), 2);
      assert.equal(copiaPrincipal(["materia-x", "--banco", banco, "--texto", texto, "--palabras", "4", "--detalle"]), 2);
    } finally {
      log.mock.restore();
    }
    assert.match(salida[0], /Secuencias compartidas de 4 palabras o más: \d+/);
    assert.doesNotMatch(salida[0], /secreto-no-imprimir/);
    assert.match(salida[1], /secreto-no-imprimir/);
    assert.doesNotMatch(salida.join("\n"), /siete ocho nueve/);
  });

  it("sale con 1 si no hay texto extraído", () => {
    const vacia = join(carpeta, "vacia");
    mkdirSync(vacia, { recursive: true });
    const error = mock.method(console, "error", () => {});
    try {
      assert.equal(copiaPrincipal(["materia-x", "--banco", banco, "--texto", vacia]), 1);
    } finally {
      error.mock.restore();
    }
  });
});
