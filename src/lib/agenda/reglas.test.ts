import { describe, expect, it } from "vitest";
import type { ParametrosNegocio } from "@/lib/plazos/parametros";
import {
  cierreAutomaticoDe,
  esEstadoPago,
  esResultadoDeFinalizar,
  MENSAJES_DE_FINALIZAR,
  RESULTADOS_DE_FINALIZAR,
  sePuedeFinalizar,
  separarAgenda,
  textoDeEstado,
  textoDePago,
  type MonitoriaDeAgenda,
} from "./reglas";

/** Un "ahora" anterior a todas las fechas de prueba que no dicen otra cosa. */
const AHORA = new Date("2026-10-01T12:00:00Z");

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
    ], AHORA);
    expect(proximas.map((m) => m.idMonitoria)).toEqual(["a", "b", "c"]);
  });

  it("pasadas: realizadas, canceladas y reservas vencidas, de la más reciente a la más antigua", () => {
    const { proximas, pasadas } = separarAgenda([
      monitoria("realizada", "2026-09-01T15:00:00Z", { estado: "realizada" }),
      monitoria("cancelada", "2026-10-20T15:00:00Z", { estado: "cancelada", motivoCancelacion: "estudiante" }),
      monitoria("vencida", "2026-10-10T15:00:00Z", { estado: "pendiente_pago", reservaVencida: true, estadoPago: "sin_pagar" }),
    ], AHORA);
    expect(proximas).toEqual([]);
    expect(pasadas.map((m) => m.idMonitoria)).toEqual(["cancelada", "vencida", "realizada"]);
  });

  it("HU-023: una confirmada que ya empezó va a por finalizar, de la más antigua a la más reciente, hasta que se finaliza", () => {
    const { porFinalizar, proximas, pasadas } = separarAgenda(
      [
        monitoria("ayer", "2026-09-30T15:00:00Z"),
        monitoria("hace-una-semana", "2026-09-24T15:00:00Z"),
        monitoria("manana", "2026-10-02T15:00:00Z"),
        monitoria("realizada", "2026-09-29T15:00:00Z", { estado: "realizada" }),
      ],
      AHORA,
    );
    expect(porFinalizar.map((m) => m.idMonitoria)).toEqual(["hace-una-semana", "ayer"]);
    expect(proximas.map((m) => m.idMonitoria)).toEqual(["manana"]);
    expect(pasadas.map((m) => m.idMonitoria)).toEqual(["realizada"]);
  });

  it("una pendiente de pago cuyo inicio pasó no es por finalizar: no hay sesión confirmada", () => {
    const { porFinalizar } = separarAgenda([monitoria("p", "2026-09-30T15:00:00Z", { estado: "pendiente_pago", estadoPago: "sin_pagar" })], AHORA);
    expect(porFinalizar).toEqual([]);
  });

  it("en el mismo instante desempata por id, para que el orden no cambie entre cargas", () => {
    const { proximas } = separarAgenda([monitoria("y", "2026-10-05T15:00:00Z"), monitoria("x", "2026-10-05T15:00:00Z")], AHORA);
    expect(proximas.map((m) => m.idMonitoria)).toEqual(["x", "y"]);
  });
});

describe("sePuedeFinalizar (HU-023, D-13, P-40)", () => {
  const inicio = new Date("2026-10-05T15:00:00Z");
  it("desde el inicio exacto, no un instante antes", () => {
    expect(sePuedeFinalizar({ estado: "confirmada", inicio }, new Date(inicio.getTime() - 1))).toBe(false);
    expect(sePuedeFinalizar({ estado: "confirmada", inicio }, inicio)).toBe(true);
    expect(sePuedeFinalizar({ estado: "confirmada", inicio }, new Date(inicio.getTime() + 60_000))).toBe(true);
  });

  it.each(["pendiente_pago", "realizada", "cancelada"] as const)("una %s no se finaliza", (estado) => {
    expect(sePuedeFinalizar({ estado, inicio }, new Date(inicio.getTime() + 60_000))).toBe(false);
  });
});

describe("cierreAutomaticoDe (P-05, D-14)", () => {
  it("es el fin programado más el cierre automático", () => {
    const p = { cierreAutomaticoMin: 1440 } as ParametrosNegocio;
    const cierre = cierreAutomaticoDe({ inicio: new Date("2026-10-05T15:00:00Z"), duracionMin: 90 }, p);
    expect(cierre.toISOString()).toBe("2026-10-06T16:30:00.000Z");
  });
});

describe("resultados de finalizar", () => {
  it("reconoce los de public.finalizar_monitoria y cada uno que no finaliza tiene su mensaje", () => {
    for (const r of RESULTADOS_DE_FINALIZAR) expect(esResultadoDeFinalizar(r)).toBe(true);
    expect(esResultadoDeFinalizar("otro")).toBe(false);
    for (const r of RESULTADOS_DE_FINALIZAR.filter((r) => r !== "finalizada" && r !== "ya_finalizada")) {
      expect(MENSAJES_DE_FINALIZAR[r]).toMatch(/\S/);
    }
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
