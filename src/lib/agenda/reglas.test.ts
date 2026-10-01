import { describe, expect, it } from "vitest";
import { esEstadoPago, separarAgenda, textoDeEstado, textoDePago, type MonitoriaDeAgenda } from "./reglas";

const monitoria = (id: string, inicio: string, datos: Partial<MonitoriaDeAgenda> = {}): MonitoriaDeAgenda => ({
  idMonitoria: id,
  fecha: inicio.slice(0, 10),
  hora: "10:00:00",
  duracionMin: 60,
  presencial: true,
  nombreMateria: "Cálculo",
  codigoMateria: "MATE-1214",
  nombreEstudiante: "Lina",
  estado: "confirmada",
  motivoCancelacion: null,
  reservaVencida: false,
  estadoPago: "aprobado",
  inicio: new Date(inicio),
  ...datos,
});

describe("separarAgenda (HU-021, D-12)", () => {
  it("próximas: pendientes vigentes y confirmadas, de la más cercana a la más lejana", () => {
    const { proximas } = separarAgenda([
      monitoria("b", "2026-10-12T15:00:00Z"),
      monitoria("a", "2026-10-05T15:00:00Z", { estado: "pendiente_pago", estadoPago: "sin_pagar" }),
      monitoria("c", "2026-10-19T15:00:00Z"),
    ]);
    expect(proximas.map((m) => m.idMonitoria)).toEqual(["a", "b", "c"]);
  });

  it("pasadas: realizadas, canceladas y reservas vencidas, de la más reciente a la más antigua", () => {
    const { proximas, pasadas } = separarAgenda([
      monitoria("realizada", "2026-09-01T15:00:00Z", { estado: "realizada" }),
      monitoria("cancelada", "2026-10-20T15:00:00Z", { estado: "cancelada", motivoCancelacion: "estudiante" }),
      monitoria("vencida", "2026-10-10T15:00:00Z", { estado: "pendiente_pago", reservaVencida: true, estadoPago: "sin_pagar" }),
    ]);
    expect(proximas).toEqual([]);
    expect(pasadas.map((m) => m.idMonitoria)).toEqual(["cancelada", "vencida", "realizada"]);
  });

  it("una confirmada cuyo inicio ya pasó sigue en próximas hasta que se finaliza (HU-023)", () => {
    const { proximas } = separarAgenda([monitoria("sin-finalizar", "2020-01-06T15:00:00Z")]);
    expect(proximas.map((m) => m.idMonitoria)).toEqual(["sin-finalizar"]);
  });

  it("en el mismo instante desempata por id, para que el orden no cambie entre cargas", () => {
    const { proximas } = separarAgenda([monitoria("y", "2026-10-05T15:00:00Z"), monitoria("x", "2026-10-05T15:00:00Z")]);
    expect(proximas.map((m) => m.idMonitoria)).toEqual(["x", "y"]);
  });
});

describe("textoDeEstado", () => {
  it("dice el estado y, si se canceló, por qué", () => {
    expect(textoDeEstado({ estado: "pendiente_pago", motivoCancelacion: null, reservaVencida: false })).toBe("Reservada, esperando el pago");
    expect(textoDeEstado({ estado: "pendiente_pago", motivoCancelacion: null, reservaVencida: true })).toBe(
      "Reserva vencida: no llegó el pago a tiempo",
    );
    expect(textoDeEstado({ estado: "confirmada", motivoCancelacion: null, reservaVencida: false })).toBe("Confirmada");
    expect(textoDeEstado({ estado: "realizada", motivoCancelacion: null, reservaVencida: false })).toBe("Realizada");
    expect(textoDeEstado({ estado: "cancelada", motivoCancelacion: "pago_rechazado", reservaVencida: false })).toBe(
      "Cancelada: el pago fue rechazado",
    );
  });

  it.each(["reserva_expirada", "pago_rechazado", "estudiante", "monitor_no_asistio", "diferencia_no_cubierta"] as const)(
    "cada motivo de cancelación (%s) tiene su texto",
    (motivo) => {
      expect(textoDeEstado({ estado: "cancelada", motivoCancelacion: motivo, reservaVencida: false })).toMatch(/^Cancelada: \S/);
    },
  );
});

describe("textoDePago (P-24, D-11)", () => {
  it("dice el estado del pago sin cifras", () => {
    expect(textoDePago("sin_pagar")).toBe("Sin pagar");
    expect(textoDePago("en_revision")).toBe("Pago en revisión");
    expect(textoDePago("aprobado")).toBe("Pago aprobado");
    expect(textoDePago("rechazado")).toBe("Pago rechazado");
    for (const estado of ["sin_pagar", "en_revision", "aprobado", "rechazado"] as const) {
      expect(textoDePago(estado)).not.toMatch(/\d|\$/);
    }
  });

  it("reconoce solo los estados que da la base", () => {
    expect(esEstadoPago("en_revision")).toBe(true);
    expect(esEstadoPago("pendiente")).toBe(false);
    expect(esEstadoPago("toString")).toBe(false);
    expect(esEstadoPago(undefined)).toBe(false);
  });
});
