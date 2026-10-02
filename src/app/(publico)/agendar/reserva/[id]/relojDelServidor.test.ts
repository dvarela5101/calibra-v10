import { describe, expect, it } from "vitest";
import { desfaseDelReloj, horaDelServidor } from "./relojDelServidor";

// HU-018, revisión: el contador de la reserva no puede contar como desfase del reloj el tiempo que la persona
// estuvo fuera de la página cuando Next la reutiliza al volver con Atrás.

describe("hora del servidor vista desde el navegador", () => {
  it("mide el desfase la primera vez que se monta una página y lo recuerda si la página vuelve de la caché", () => {
    const ahora = "2026-10-01T17:02:00.000Z";
    // El teléfono va 30 s adelantado.
    const primera = desfaseDelReloj(ahora, Date.parse("2026-10-01T17:02:30.000Z"));
    expect(primera).toEqual({ desfase: 30_000, reutilizada: false });

    // Diez minutos después vuelve con Atrás: la página trae el mismo `ahora`. El desfase sigue siendo 30 s y
    // la hora del servidor es la de verdad, no la de cuando se pintó la página.
    const despues = Date.parse("2026-10-01T17:12:30.000Z");
    expect(desfaseDelReloj(ahora, despues)).toEqual({ desfase: 30_000, reutilizada: true });
    expect(horaDelServidor(ahora, despues).toISOString()).toBe("2026-10-01T17:12:00.000Z");
  });

  it("otra página (otro ahora) mide su propio desfase", () => {
    const ahora = "2026-10-01T18:00:00.000Z";
    expect(desfaseDelReloj(ahora, Date.parse("2026-10-01T17:59:50.000Z"))).toEqual({ desfase: -10_000, reutilizada: false });
    expect(horaDelServidor(ahora, Date.parse("2026-10-01T18:05:00.000Z")).toISOString()).toBe("2026-10-01T18:05:10.000Z");
  });
});
