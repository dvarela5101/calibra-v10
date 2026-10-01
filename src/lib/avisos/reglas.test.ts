import { describe, expect, it } from "vitest";
import { avisoVigente, datosDeCancelada, datosDeConfirmada, esEventoDeAviso, type DatosDeAviso } from "./reglas";

const DATOS: DatosDeAviso = {
  estado: "confirmada",
  motivoCancelacion: null,
  grupal: false,
  correoMonitor: "monitor@calibra.test",
  nombreMonitor: "Camilo",
  nombreEstudiante: "Ana",
  nombreMateria: "Cálculo",
  inicio: "2026-10-05T15:00:00.000Z",
  duracionMin: 60,
  presencial: true,
};

/** Antes del inicio de DATOS. */
const AHORA = new Date("2026-10-01T12:00:00.000Z");

describe("avisoVigente (HU-051, D-16)", () => {
  it("el de confirmada vale mientras la monitoría siga confirmada", () => {
    expect(avisoVigente("confirmada", DATOS, AHORA)).toBe(true);
    expect(avisoVigente("confirmada", { ...DATOS, estado: "cancelada", motivoCancelacion: "estudiante" }, AHORA)).toBe(false);
    expect(avisoVigente("confirmada", { ...DATOS, estado: "realizada" }, AHORA)).toBe(false);
  });

  it("el de cancelada vale solo si la canceló el estudiante", () => {
    expect(avisoVigente("cancelada", { ...DATOS, estado: "cancelada", motivoCancelacion: "estudiante" }, AHORA)).toBe(true);
    expect(avisoVigente("cancelada", { ...DATOS, estado: "cancelada", motivoCancelacion: "pago_rechazado" }, AHORA)).toBe(false);
    expect(avisoVigente("cancelada", DATOS, AHORA)).toBe(false);
  });

  it("no se avisa de una sesión que ya empezó: el aviso llegaría tarde", () => {
    const inicio = new Date(DATOS.inicio);
    expect(avisoVigente("confirmada", DATOS, new Date(inicio.getTime() - 1))).toBe(true);
    expect(avisoVigente("confirmada", DATOS, inicio)).toBe(false);
    const cancelada = { ...DATOS, estado: "cancelada" as const, motivoCancelacion: "estudiante" };
    expect(avisoVigente("cancelada", cancelada, new Date(inicio.getTime() + 60_000))).toBe(false);
  });

  it("nunca para una grupal", () => {
    expect(avisoVigente("confirmada", { ...DATOS, grupal: true }, AHORA)).toBe(false);
    expect(avisoVigente("cancelada", { ...DATOS, grupal: true, estado: "cancelada", motivoCancelacion: "estudiante" }, AHORA)).toBe(false);
  });
});

describe("datos del correo", () => {
  it("lleva el nombre del estudiante y nunca su contacto (P-37)", () => {
    const confirmada = datosDeConfirmada(DATOS, "https://calibra.test/monitor/agenda");
    expect(confirmada).toEqual({
      nombreMonitor: "Camilo",
      nombreEstudiante: "Ana",
      materia: "Cálculo",
      inicio: "2026-10-05T15:00:00.000Z",
      duracionMin: 60,
      presencial: true,
      enlace: "https://calibra.test/monitor/agenda",
    });
    const cancelada = datosDeCancelada(DATOS, "https://calibra.test/monitor/agenda");
    expect(Object.keys(cancelada).sort()).toEqual(["enlace", "inicio", "materia", "nombreEstudiante", "nombreMonitor"]);
  });

  it("reconoce solo los eventos que anota la base", () => {
    expect(esEventoDeAviso("confirmada")).toBe(true);
    expect(esEventoDeAviso("cancelada")).toBe(true);
    expect(esEventoDeAviso("realizada")).toBe(false);
    expect(esEventoDeAviso(undefined)).toBe(false);
  });
});
