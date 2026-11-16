import { describe, expect, it } from "vitest";
import { agruparMateriasPorArea, areaDeMateria } from "./areas";

const m = (codigo: string, nombre = codigo) => ({ codigo, nombre });

describe("areaDeMateria", () => {
  it("deriva el área del prefijo del código", () => {
    expect(areaDeMateria("MATE-1214")).toBe("Matemáticas");
    expect(areaDeMateria("FISI-1528")).toBe("Física");
    expect(areaDeMateria("ISIS-1221")).toBe("Programación y sistemas");
    expect(areaDeMateria("IIND-2106")).toBe("Probabilidad y estadística");
  });

  it("no distingue mayúsculas ni espacios y manda lo desconocido a «Otras»", () => {
    expect(areaDeMateria(" mate-1214 ")).toBe("Matemáticas");
    expect(areaDeMateria("QUIM-1101")).toBe("Otras");
    expect(areaDeMateria("")).toBe("Otras");
    expect(areaDeMateria("MATEMATICAS")).toBe("Otras");
  });
});

describe("agruparMateriasPorArea", () => {
  it("ordena los grupos como la lista, con «Otras» al final, y conserva el orden dentro de cada uno", () => {
    const grupos = agruparMateriasPorArea([
      m("QUIM-1101"),
      m("IIND-2106", "Probabilidad"),
      m("FISI-1518", "Física I"),
      m("MATE-1203", "Cálculo Diferencial"),
      m("FISI-1528", "Física II"),
      m("MATE-1214", "Cálculo Integral"),
      m("ISIS-1221"),
    ]);
    expect(grupos.map((g) => g.area)).toEqual(["Matemáticas", "Física", "Programación y sistemas", "Probabilidad y estadística", "Otras"]);
    expect(grupos[0].materias.map((x) => x.codigo)).toEqual(["MATE-1203", "MATE-1214"]);
    expect(grupos[1].materias.map((x) => x.codigo)).toEqual(["FISI-1518", "FISI-1528"]);
    expect(grupos[4].materias.map((x) => x.codigo)).toEqual(["QUIM-1101"]);
  });

  it("no muestra los grupos vacíos y con ninguna materia no hay grupos", () => {
    expect(agruparMateriasPorArea([m("FISI-1518")]).map((g) => g.area)).toEqual(["Física"]);
    expect(agruparMateriasPorArea([])).toEqual([]);
  });

  it("no pierde ninguna materia", () => {
    const entrada = [m("A-1"), m("MATE-1"), m("ISIS-1"), m("B-2"), m("IIND-1")];
    expect(agruparMateriasPorArea(entrada).flatMap((g) => g.materias)).toHaveLength(entrada.length);
  });
});
