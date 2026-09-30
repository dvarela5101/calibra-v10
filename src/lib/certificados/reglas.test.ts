import { describe, expect, it } from "vitest";
import { leerCertificacion, mensajeDeErrorDeCertificado } from "./reglas";

const HOY = "2026-09-30";
const MONITOR = "b0000000-0000-4000-8000-000000000001";
const MATERIA = "10000000-0000-4000-8000-000000000001";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

const VALIDO = { id_monitor: MONITOR, id_materia: MATERIA, fecha_evaluacion: "2026-09-28" };

describe("leerCertificacion (HU-014, P-19)", () => {
  it("lee el monitor, la materia y la fecha de la evaluación", () => {
    expect(leerCertificacion(formulario(VALIDO), HOY)).toEqual({
      ok: true,
      datos: { idMonitor: MONITOR, idMateria: MATERIA, fechaEvaluacion: "2026-09-28" },
    });
  });

  it("la evaluación puede ser hoy", () => {
    expect(leerCertificacion(formulario({ ...VALIDO, fecha_evaluacion: HOY }), HOY).ok).toBe(true);
  });

  it.each([
    ["sin monitor", { id_monitor: "" }, "Elige el monitor que vas a certificar."],
    ["con un monitor que no es un id", { id_monitor: "monitor-1" }, "Elige el monitor que vas a certificar."],
    ["sin materia", { id_materia: "" }, "Elige la materia."],
    ["sin fecha", { fecha_evaluacion: "" }, "Escribe la fecha de la evaluación presencial."],
    ["con una fecha que no existe", { fecha_evaluacion: "2026-02-30" }, "Escribe la fecha de la evaluación presencial."],
    ["con otro formato de fecha", { fecha_evaluacion: "28/09/2026" }, "Escribe la fecha de la evaluación presencial."],
    ["con la evaluación en el futuro", { fecha_evaluacion: "2026-10-01" }, "La fecha de la evaluación no puede ser posterior a hoy."],
  ])("rechaza un formulario %s", (_caso, cambios, error) => {
    expect(leerCertificacion(formulario({ ...VALIDO, ...cambios }), HOY)).toEqual({ ok: false, error });
  });
});

describe("mensajeDeErrorDeCertificado", () => {
  it.each([
    ["23505", "Ese monitor ya está certificado en esa materia."],
    ["23514", "La fecha de la evaluación no puede ser posterior a hoy."],
    ["23503", "No encontramos ese monitor o esa materia. Recarga la página."],
    ["42501", "Tu cuenta no puede certificar monitores."],
    ["08006", "No pudimos crear el certificado. Intenta de nuevo."],
  ])("%s da un mensaje para la persona, sin detalles técnicos", (code, mensaje) => {
    expect(mensajeDeErrorDeCertificado({ code })).toBe(mensaje);
  });

  it("sin error conocido, el mensaje genérico", () => {
    expect(mensajeDeErrorDeCertificado(null)).toBe("No pudimos crear el certificado. Intenta de nuevo.");
  });
});
