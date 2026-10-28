import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { intentarAnalizar, partirMate } from "@/lib/contenido/mate";
import {
  CLAVES_DE_OPCION,
  CORRECTA,
  ENUNCIADO,
  ERRORES,
  HABILIDADES,
  ORDEN,
  resultadoDeMuestra,
  TEXTOS_DE_OPCION,
} from "./pregunta-de-muestra";

// D-77 e: la pregunta no está en el banco, pero sus errores y habilidades sí. Si el banco cambia un texto, esta prueba lo dice.
const banco = readFileSync(join(__dirname, "../../../contenido/calculo-diferencial/reglas-derivacion.md"), "utf8");

/** `mc: <id> · <habilidad> · <descripción>` del banco. */
function errorDelBanco(id: string): { idHabilidad: string; descripcion: string } | null {
  const linea = banco.split(/\r?\n/).find((l) => l.startsWith(`mc: ${id} · `));
  if (!linea) return null;
  const [, idHabilidad, descripcion] = linea.slice("mc: ".length).split(" · ");
  return { idHabilidad, descripcion };
}

/** `kc: <id> · <descripción>[ · prerrequisitos: ...]` del banco. */
function habilidadDelBanco(id: string): string | null {
  const linea = banco.split(/\r?\n/).find((l) => l.startsWith(`kc: ${id} · `));
  return linea ? linea.slice("kc: ".length).split(" · ")[1] : null;
}

describe("la pregunta de muestra usa los errores del banco tal como están", () => {
  it.each(Object.entries(ERRORES))("la opción %s: su error y su habilidad", (_clave, error) => {
    expect(errorDelBanco(error.id)).toEqual({ idHabilidad: error.idHabilidad, descripcion: error.descripcion });
  });

  it.each(Object.values(HABILIDADES))("la habilidad $id", (habilidad) => {
    expect(habilidadDelBanco(habilidad.id)).toBe(habilidad.descripcion);
  });
});

describe("resultadoDeMuestra", () => {
  it("sin elegir no dice nada todavía", () => {
    expect(resultadoDeMuestra(null)).toEqual({ tipo: "sin_elegir" });
  });

  it("la correcta dice que domina la regla de la cadena", () => {
    expect(resultadoDeMuestra(CORRECTA)).toEqual({ tipo: "correcta", habilidad: "regla de la cadena" });
  });

  it("cos(x²) es el error de olvidar la derivada de adentro, con mayúscula y punto", () => {
    expect(resultadoDeMuestra("a")).toEqual({
      tipo: "error",
      texto: "Derivas la función de afuera y olvidas multiplicar por la derivada de lo que está adentro.",
      habilidad: "Derivar una composición de funciones con la regla de la cadena",
    });
  });

  it("2x sen(x²) es de la habilidad de las derivadas trascendentes", () => {
    const resultado = resultadoDeMuestra("e");
    expect(resultado.tipo).toBe("error");
    expect(resultado).toMatchObject({ habilidad: HABILIDADES["derivadas-trascendentes"].descripcion });
  });

  it("el enunciado y cada opción son fórmulas que el banco sabe dibujar", () => {
    for (const texto of [ENUNCIADO, ...Object.values(TEXTOS_DE_OPCION)]) {
      const formulas = partirMate(texto).filter((trozo) => trozo.mate);
      expect(formulas.length, texto).toBeGreaterThan(0);
      for (const trozo of formulas) expect(intentarAnalizar(trozo.texto).ok, trozo.texto).toBe(true);
    }
  });

  it("muestra las cinco opciones, cada una una vez, y solo una es correcta", () => {
    expect([...ORDEN].sort()).toEqual([...CLAVES_DE_OPCION]);
    expect(CLAVES_DE_OPCION.filter((c) => resultadoDeMuestra(c).tipo === "correcta")).toEqual([CORRECTA]);
  });
});
