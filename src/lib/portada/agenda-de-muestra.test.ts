import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENDA_DE_MUESTRA, textoDelError } from "./agenda-de-muestra";

// HU-109: la agenda del hero de monitores usa las habilidades y los errores del banco tal como están. Si el banco cambia un texto,
// esta prueba lo dice.
const CONTENIDO = join(__dirname, "../../../contenido");

/** Todas las líneas de los .md de una materia del banco. */
function lineasDe(carpeta: string): string[] {
  const ruta = join(CONTENIDO, carpeta);
  return readdirSync(ruta)
    .filter((nombre) => nombre.endsWith(".md"))
    .flatMap((nombre) => readFileSync(join(ruta, nombre), "utf8").split(/\r?\n/));
}

/** `kc: <id> · <descripción>[ · prerrequisitos: ...]` del banco. */
function habilidadDelBanco(lineas: string[], id: string): string | null {
  const linea = lineas.find((l) => l.startsWith(`kc: ${id} · `));
  return linea ? linea.slice("kc: ".length).split(" · ")[1] : null;
}

/** `mc: <id> · <habilidad> · <descripción>` del banco. */
function errorDelBanco(lineas: string[], id: string): { idHabilidad: string; descripcion: string } | null {
  const linea = lineas.find((l) => l.startsWith(`mc: ${id} · `));
  if (!linea) return null;
  const [, idHabilidad, descripcion] = linea.slice("mc: ".length).split(" · ");
  return { idHabilidad, descripcion };
}

describe("la agenda de muestra usa el banco tal como está", () => {
  it.each(AGENDA_DE_MUESTRA)("$estudiante ($materia): sus habilidades", ({ carpeta, habilidades }) => {
    const lineas = lineasDe(carpeta);
    for (const habilidad of habilidades) expect(habilidadDelBanco(lineas, habilidad.id), habilidad.id).toBe(habilidad.descripcion);
  });

  it.each(AGENDA_DE_MUESTRA)("$estudiante ($materia): su error, de una habilidad que no domina", ({ carpeta, error, habilidades }) => {
    expect(errorDelBanco(lineasDe(carpeta), error.id)).toEqual({ idHabilidad: error.idHabilidad, descripcion: error.descripcion });
    expect(habilidades.find((h) => h.id === error.idHabilidad)?.nivel).toBe("no_lo_domina");
  });
});

describe("la agenda de muestra", () => {
  it("tiene tres monitorías con claves distintas y un solo «No lo domina» cada una, el que se encierra", () => {
    expect(new Set(AGENDA_DE_MUESTRA.map((m) => m.clave)).size).toBe(3);
    for (const monitoria of AGENDA_DE_MUESTRA) {
      expect(monitoria.habilidades.filter((h) => h.nivel === "no_lo_domina"), monitoria.clave).toHaveLength(1);
    }
  });

  it("escribe el error con mayúscula y punto, como el resultado", () => {
    expect(textoDelError("asumes que la normal siempre es igual al peso")).toBe("Asumes que la normal siempre es igual al peso.");
  });
});
