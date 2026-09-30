import { describe, expect, it } from "vitest";
import { agruparPorMonitor, leerCodigoDeMateria, rutaDeMonitores, SEMANAS_DEL_HORIZONTE, type FechaLibre } from "./reglas";

describe("leerCodigoDeMateria (HU-016)", () => {
  it("toma el código del enlace, sin espacios alrededor", () => {
    expect(leerCodigoDeMateria(" MATE-1214 ")).toBe("MATE-1214");
    expect(leerCodigoDeMateria(["FISI-1018", "MATE-1214"])).toBe("FISI-1018");
    // Pasa tal cual: la base lo compara exacto y, si no existe, la página dice que no la encontró.
    expect(leerCodigoDeMateria("<script>")).toBe("<script>");
  });

  it.each([undefined, "", "   ", [], "a".repeat(51), "MATE\n1214", "MATE\u00001214"])("sin código válido (%j) da null", (valor) => {
    expect(leerCodigoDeMateria(valor as string | string[] | undefined)).toBeNull();
  });
});

describe("rutaDeMonitores", () => {
  it("lleva a la lista de la materia, con el código escapado", () => {
    expect(rutaDeMonitores("MATE-1214")).toBe("/monitores?materia=MATE-1214");
    expect(rutaDeMonitores("A&B C")).toBe("/monitores?materia=A%26B+C");
    expect(rutaDeMonitores()).toBe("/monitores");
  });
});

const fecha = (idMonitor: string, nombreMonitor: string, dia: string, hora: string, idFranja = `f-${idMonitor}-${hora}`): FechaLibre => ({
  idMonitor,
  nombreMonitor,
  idFranja,
  fecha: dia,
  hora,
  duracionMin: 60,
  presencial: true,
  precio: 25000,
});

describe("agruparPorMonitor (D-4)", () => {
  it("agrupa por monitor, primero el de la fecha libre más próxima, y ordena sus fechas", () => {
    const grupos = agruparPorMonitor([
      fecha("b", "Beto", "2026-10-07", "18:00:00"),
      fecha("a", "Ana", "2026-10-12", "10:00:00"),
      fecha("b", "Beto", "2026-10-05", "23:00:00"),
      fecha("a", "Ana", "2026-10-06", "09:00:00"),
    ]);
    expect(grupos.map((g) => g.nombre)).toEqual(["Beto", "Ana"]);
    expect(grupos[0].fechas.map((f) => f.fecha)).toEqual(["2026-10-05", "2026-10-07"]);
    expect(grupos[1].fechas.map((f) => f.fecha)).toEqual(["2026-10-06", "2026-10-12"]);
  });

  it("con la misma primera fecha y hora, por nombre", () => {
    const grupos = agruparPorMonitor([fecha("z", "Zoe", "2026-10-05", "10:00:00"), fecha("a", "Álvaro", "2026-10-05", "10:00:00")]);
    expect(grupos.map((g) => g.nombre)).toEqual(["Álvaro", "Zoe"]);
  });

  it("sin fechas, sin monitores", () => {
    expect(agruparPorMonitor([])).toEqual([]);
  });

  it("el horizonte es de 4 semanas", () => {
    expect(SEMANAS_DEL_HORIZONTE).toBe(4);
  });
});
