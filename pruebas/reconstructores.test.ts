import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANTILLAS } from "@/lib/correo/plantillas";

// HU-065: el registro de correos no guarda el cuerpo, así que reintentar un correo exige reconstruirlo a
// partir de su entidad. Esta prueba obliga a que toda plantilla que el código dispara tenga su
// reconstructor en src/lib/correo/reconstructores.ts (y no `null`). Se lee el texto del archivo porque
// ese módulo es solo de servidor.

const RAIZ = join(__dirname, "..");
const SRC = join(RAIZ, "src");

function fuentes(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const archivos = fuentes(SRC).map((ruta) => ({ ruta: relative(RAIZ, ruta).replaceAll("\\", "/"), texto: readFileSync(ruta, "utf8") }));
const registro = readFileSync(join(SRC, "lib/correo/reconstructores.ts"), "utf8");

/** Plantillas que algún módulo fuera de src/lib/correo manda con `plantilla: "..."`. */
const disparadas = new Set(
  archivos
    .filter((a) => !a.ruta.startsWith("src/lib/correo/"))
    .flatMap((a) => [...a.texto.matchAll(/plantilla:\s*"([a-z_]+)"/g)].map((m) => m[1])),
);

describe("reconstructores de correos (HU-065)", () => {
  it("el registro nombra todas las plantillas", () => {
    for (const plantilla of PLANTILLAS) {
      expect(registro, `falta ${plantilla} en reconstructores.ts`).toMatch(new RegExp(`\\b${plantilla}:`));
    }
  });

  it("la búsqueda de plantillas disparadas encuentra al menos la invitación de monitor", () => {
    expect(disparadas.has("invitacion_monitor")).toBe(true);
  });

  it.each([...PLANTILLAS])("si alguien dispara %s, tiene reconstructor", (plantilla) => {
    const sinReconstructor = new RegExp(`\\b${plantilla}:\\s*null\\b`).test(registro);
    if (disparadas.has(plantilla)) expect(sinReconstructor, `${plantilla} se dispara pero no tiene reconstructor`).toBe(false);
  });
});
