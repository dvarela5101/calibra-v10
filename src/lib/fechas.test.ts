import { describe, expect, it, vi } from "vitest";
import { ZONA_HORARIA_NEGOCIO, IDIOMA, LOCALE } from "@/config/regional";
import { formatearDia, formatearFechaHora } from "./fechas";

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

describe("formatearDia", () => {
  it.each([
    ["2020-01-06", "6 de enero de 2020"],
    ["2026-10-05", "5 de octubre de 2026"],
    ["2028-02-29", "29 de febrero de 2028"],
    ["2026-12-31", "31 de diciembre de 2026"],
  ])("%s se ve %s", (fecha, esperado) => {
    expect(formatearDia(fecha)).toBe(esperado);
  });

  it("no cambia de día con la zona del proceso", async () => {
    const zonaOriginal = process.env.TZ;
    try {
      const desfases = new Set<number>();
      for (const zona of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
        process.env.TZ = zona;
        desfases.add(new Date(2026, 9, 5, 10, 0, 0).getTimezoneOffset());
        // El formateador se crea al cargar el módulo: se recarga con cada zona ya puesta, o quitar
        // `timeZone: "UTC"` no haría fallar la prueba.
        vi.resetModules();
        const { formatearDia: enEstaZona } = await import("./fechas");
        expect(enEstaZona("2026-10-05")).toBe("5 de octubre de 2026");
      }
      // Si el cambio de zona no tuvo efecto, esta prueba no probaría nada.
      expect(desfases.size).toBeGreaterThan(1);
    } finally {
      if (zonaOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = zonaOriginal;
      vi.resetModules();
    }
  });

  it.each(["2026-02-30x", "2026-13-01", "5/10/2026", "", "2026-02-30", "2026-04-31", "2027-02-29", "2026-00-10", "2026-01-00"])("rechaza %j", (fecha) => {
    expect(() => formatearDia(fecha)).toThrow(RangeError);
  });
});

describe("formatearFechaHora: la hora y su a. m. no se separan", () => {
  it("usa espacios duros entre la hora y el marcador, y dentro del marcador", () => {
    const mañana = formatearFechaHora(new Date("2020-01-07T16:00:00Z")); // 11:00 en Bogotá
    expect(mañana).toContain("11:00\xa0a.\xa0m.");
    const tarde = formatearFechaHora(new Date("2020-01-07T20:30:00Z")); // 15:30 en Bogotá
    expect(tarde).toContain("3:30\xa0p.\xa0m.");
  });

  it("no cambia lo demás: el día y la fecha siguen con espacios normales", () => {
    const texto = formatearFechaHora(new Date("2026-09-28T17:00:00Z"));
    expect(texto).toMatch(/^lunes, 28 de septiembre de 2026, 12:00/);
  });
});
