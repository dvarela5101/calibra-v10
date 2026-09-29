import { describe, expect, it } from "vitest";
import { ZONA_HORARIA_NEGOCIO, IDIOMA, LOCALE } from "@/config/regional";
import { formatearFechaHora } from "./fechas";

describe("configuración regional", () => {
  it("fija la zona de negocio y el idioma", () => {
    expect(ZONA_HORARIA_NEGOCIO).toBe("America/Bogota");
    expect(IDIOMA).toBe("es");
    expect(LOCALE.startsWith("es")).toBe(true);
  });
});

describe("formatearFechaHora", () => {
  it("muestra la hora de Bogotá aunque el instante venga en UTC", () => {
    // 17:00 UTC son las 12:00 del mediodía en Bogotá (UTC-5, sin horario de verano).
    const texto = formatearFechaHora(new Date("2026-09-28T17:00:00Z"));
    expect(texto).toMatch(/lunes/);
    expect(texto).toMatch(/28 de septiembre de 2026/);
    expect(texto).toMatch(/12:00/);
  });

  it("cambia de día según Bogotá, no según UTC", () => {
    // 02:30 UTC del 1 de octubre sigue siendo 30 de septiembre en Bogotá.
    const texto = formatearFechaHora(new Date("2026-10-01T02:30:00Z"));
    expect(texto).toMatch(/30 de septiembre de 2026/);
    expect(texto).toMatch(/9:30/);
  });
});
