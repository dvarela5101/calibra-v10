import { describe, expect, it } from "vitest";
import { partirEnunciado } from "./enunciado";

// HU-083: un enunciado con bloques de código se parte en prosa y programa. Dentro del bloque todo es literal.

const prosa = (texto: string) => ({ codigo: false, texto });
const codigo = (texto: string) => ({ codigo: true, texto });

describe("partirEnunciado", () => {
  it("un texto sin cercas es un solo trozo de prosa", () => {
    expect(partirEnunciado("¿Cuánto vale $x$?")).toEqual([prosa("¿Cuánto vale $x$?")]);
  });

  it("une las líneas de la prosa con un espacio, recortadas, y ignora las líneas en blanco", () => {
    expect(partirEnunciado("  Calcula\n\n   el límite  \n")).toEqual([prosa("Calcula el límite")]);
  });

  it("un bloque entre dos cercas", () => {
    expect(partirEnunciado("```\nx = 1\n```")).toEqual([codigo("x = 1")]);
  });

  it("prosa, código y prosa", () => {
    expect(partirEnunciado("¿Qué imprime?\n```\nprint(1)\n```\nElige una opción.")).toEqual([
      prosa("¿Qué imprime?"),
      codigo("print(1)"),
      prosa("Elige una opción."),
    ]);
  });

  it("dos bloques", () => {
    expect(partirEnunciado("A\n```\none\n```\nB\n```\ntwo\n```")).toEqual([prosa("A"), codigo("one"), prosa("B"), codigo("two")]);
  });

  it("conserva la sangría y las líneas en blanco de adentro", () => {
    const programa = "def doble(x):\n    y = x * 2\n\n    return y";
    expect(partirEnunciado(`¿Qué devuelve?\n\`\`\`\n${programa}\n\`\`\``)).toEqual([prosa("¿Qué devuelve?"), codigo(programa)]);
  });

  it("no recorta la sangría de la primera línea", () => {
    expect(partirEnunciado("```\n    sangrada\n```")).toEqual([codigo("    sangrada")]);
  });

  it("quita las líneas en blanco del principio y del final del bloque, y los espacios del final", () => {
    expect(partirEnunciado("```\n\n  \n  a  \n\n\n```")).toEqual([codigo("  a")]);
  });

  it("entiende CRLF y CR", () => {
    expect(partirEnunciado("Hola\r\n```\r\nx = 1\r\n    y = 2\r\n```\r\n")).toEqual([prosa("Hola"), codigo("x = 1\n    y = 2")]);
    expect(partirEnunciado("Hola\r```\rx = 1\r```")).toEqual([prosa("Hola"), codigo("x = 1")]);
  });

  it("una cerca sin cerrar toma el resto como código", () => {
    expect(partirEnunciado("Hola\n```\nx = 1\ny = 2")).toEqual([prosa("Hola"), codigo("x = 1\ny = 2")]);
  });

  it("tolera una cerca con lenguaje o con sangría", () => {
    expect(partirEnunciado("```python\nx = 1\n```")).toEqual([codigo("x = 1")]);
    expect(partirEnunciado("  ```\nx = 1\n  ```  ")).toEqual([codigo("x = 1")]);
  });

  it("dentro del bloque todo es literal: fórmulas, TeX, HTML y acentos graves", () => {
    const programa = "a = '$x$' + \"\\frac{1}{2}\"\n<b>negrita</b> & `comillas`\nuna `` doble ``";
    expect(partirEnunciado(`\`\`\`\n${programa}\n\`\`\``)).toEqual([codigo(programa)]);
  });

  it("un acento grave suelto en la prosa no abre un bloque", () => {
    expect(partirEnunciado("Usa `x` y ``y``.")).toEqual([prosa("Usa `x` y ``y``.")]);
  });

  it("un bloque vacío no se devuelve y la prosa de los dos lados se une", () => {
    expect(partirEnunciado("Antes\n```\n```\nDespués")).toEqual([prosa("Antes Después")]);
    expect(partirEnunciado("Antes\n```\n  \n\n```")).toEqual([prosa("Antes")]);
    expect(partirEnunciado("```\n```")).toEqual([]);
    expect(partirEnunciado("```\n```\n```\nx\n```")).toEqual([codigo("x")]);
  });

  it("un texto vacío o nulo no deja nada y nunca lanza", () => {
    expect(partirEnunciado("")).toEqual([]);
    expect(partirEnunciado("  \n \n")).toEqual([]);
    expect(partirEnunciado(null)).toEqual([]);
    expect(partirEnunciado(undefined)).toEqual([]);
  });
});
