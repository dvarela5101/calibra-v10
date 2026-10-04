import { describe, expect, it } from "vitest";
import { esResultadoDeReportar, mensajeDeReportar, RESULTADOS_DE_REPORTAR } from "./reportar-reglas";

describe("los resultados de reportar (HU-029)", () => {
  it("son los ocho que devuelven las puertas de la base, en este orden", () => {
    expect([...RESULTADOS_DE_REPORTAR]).toEqual([
      "reportada",
      "ya_reportada",
      "aun_no_empieza",
      "fuera_de_ventana",
      "no_reportable",
      "no_individual",
      "sin_admin",
      "no_existe",
    ]);
  });

  it("esResultadoDeReportar reconoce los ocho y nada más", () => {
    for (const resultado of RESULTADOS_DE_REPORTAR) expect(esResultadoDeReportar(resultado), resultado).toBe(true);
    for (const malo of ["cancelada", "ya_cancelada", "", "Reportada", "fuera_de_plazo", null, undefined, 1, ["reportada"], {}]) {
      expect(esResultadoDeReportar(malo), JSON.stringify(malo)).toBe(false);
    }
  });
});

describe("mensajeDeReportar", () => {
  it("reportada y ya_reportada no llevan mensaje: la página ya muestra el estado del reporte", () => {
    expect(mensajeDeReportar("reportada")).toBeNull();
    expect(mensajeDeReportar("ya_reportada")).toBeNull();
    expect(mensajeDeReportar("reportada", "ayuda@calibra.test")).toBeNull();
    expect(mensajeDeReportar("ya_reportada", "ayuda@calibra.test")).toBeNull();
  });

  it("cada resultado con motivo tiene su texto exacto", () => {
    expect(mensajeDeReportar("aun_no_empieza")).toBe(
      "La monitoría todavía no empieza. Puedes reportar que el monitor no llegó desde su hora de inicio.",
    );
    expect(mensajeDeReportar("fuera_de_ventana")).toBe("Ya pasó el plazo para reportar que el monitor no llegó.");
    expect(mensajeDeReportar("no_reportable")).toBe("Esta monitoría ya no se puede reportar.");
    expect(mensajeDeReportar("no_individual")).toBe("Las monitorías grupales todavía no se reportan desde esta página.");
    expect(mensajeDeReportar("no_existe")).toBe("No encontramos esta monitoría. Solo quien la agendó puede reportar.");
  });

  it("sin_admin ofrece el correo de soporte si se conoce y, si no, no promete un canal que no existe", () => {
    expect(mensajeDeReportar("sin_admin", "ayuda@calibra.test")).toBe(
      "No pudimos recibir tu reporte en este momento. Intenta de nuevo en unos minutos o escríbenos a ayuda@calibra.test.",
    );
    const sin = "No pudimos recibir tu reporte en este momento. Intenta de nuevo en unos minutos.";
    expect(mensajeDeReportar("sin_admin")).toBe(sin);
    for (const vacio of [null, "", "   "]) expect(mensajeDeReportar("sin_admin", vacio), JSON.stringify(vacio)).toBe(sin);
    expect(mensajeDeReportar("sin_admin", "  ayuda@calibra.test  ")).toContain("escríbenos a ayuda@calibra.test.");
  });

  it("todo resultado tiene mensaje o es uno de los dos que no lo llevan", () => {
    const sinMensaje = RESULTADOS_DE_REPORTAR.filter((r) => mensajeDeReportar(r) === null);
    expect(sinMensaje).toEqual(["reportada", "ya_reportada"]);
  });

  it("ningún mensaje habla de comisión ni lleva datos de contacto del monitor, y no distingue una cita ajena", () => {
    for (const resultado of RESULTADOS_DE_REPORTAR) {
      const mensaje = mensajeDeReportar(resultado);
      if (mensaje === null) continue;
      expect(mensaje.length, resultado).toBeGreaterThan(0);
      expect(mensaje, resultado).not.toMatch(/comisi|neto|desembolso|@|tel[eé]fono|whatsapp|celular/i);
    }
    expect(mensajeDeReportar("no_existe")).not.toMatch(/otra persona|ajena/i);
  });
});
