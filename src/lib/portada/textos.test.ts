import { describe, expect, it } from "vitest";
import type { ParametrosNegocio } from "@/lib/plazos/parametros";
import {
  respuestaDeCancelar,
  respuestaDeCancelarParaMonitor,
  respuestaDeCuenta,
  respuestaDeGrupalesParaMonitor,
  respuestaDePagoAlMonitor,
  textoDelBeneficioDeCancelar,
  textoDelBeneficioDeCancelarParaMonitor,
} from "./textos";

// Los de las migraciones 20260929054533 y 20261001054024 (RN-35, RN-60, RN-62, RN-83); los demás no se leen aquí.
const PARAMETROS = {
  antelacionGrupalMin: 2160,
  cancelacionIndividualMin: 720,
  cancelacionGrupalMin: 1440,
  reporteInasistenciaMin: 1440,
  desembolsoMin: 1440,
} as ParametrosNegocio;

describe("textos de la portada con plazos", () => {
  it("dicen los plazos que llegan de la base", () => {
    expect(textoDelBeneficioDeCancelar(PARAMETROS)).toBe("Cancelas hasta 12 horas antes y te devolvemos todo.");
    expect(respuestaDeCancelar(PARAMETROS)).toBe(
      "Cancelas hasta 12 horas antes de una sesión individual, o 24 horas antes de una grupal, y te devolvemos todo. " +
        "Si el monitor no llega, lo reportas hasta 24 horas después y revisamos el caso.",
    );
    expect(respuestaDeCuenta(PARAMETROS)).toBe(
      "No para el diagnóstico ni para agendar una sesión individual. Solo si quieres organizar una sesión grupal, con 36 horas de antelación.",
    );
  });

  it("siguen el valor de la base, no uno escrito", () => {
    expect(textoDelBeneficioDeCancelar({ ...PARAMETROS, cancelacionIndividualMin: 60 })).toBe(
      "Cancelas hasta 1 hora antes y te devolvemos todo.",
    );
  });

  it("sin parámetros no inventan cifras", () => {
    for (const texto of [textoDelBeneficioDeCancelar(null), respuestaDeCancelar(null), respuestaDeCuenta(null)]) {
      expect(texto).not.toMatch(/\d/);
    }
  });
});

describe("textos de la landing de monitores con plazos (HU-109)", () => {
  it("dicen los plazos que llegan de la base", () => {
    expect(textoDelBeneficioDeCancelarParaMonitor(PARAMETROS)).toBe("Una individual se cancela hasta 12 horas antes; una grupal, hasta 24 horas.");
    expect(respuestaDePagoAlMonitor(PARAMETROS)).toBe(
      "Por cada monitoría realizada, Calibra te transfiere a tu llave. El pago sale a partir de 24 horas después de que termina la sesión.",
    );
    expect(respuestaDeCancelarParaMonitor(PARAMETROS)).toBe(
      "Una individual se puede cancelar hasta 12 horas antes y una grupal hasta 24 horas. " +
        "Después de eso no se cancela, salvo casos extremos que revisa Calibra.",
    );
    expect(respuestaDeGrupalesParaMonitor(PARAMETROS)).toBe(
      "Un estudiante con cuenta puede organizar una grupal en uno de tus horarios, con 36 horas de antelación, y cada integrante paga su parte.",
    );
  });

  it("no prometen el diagnóstico en las grupales: el monitor solo lo ve en las individuales (HU-022)", () => {
    expect(respuestaDeGrupalesParaMonitor(PARAMETROS)).not.toMatch(/diagn/i);
  });

  it("sin parámetros no inventan cifras", () => {
    const textos = [
      textoDelBeneficioDeCancelarParaMonitor(null),
      respuestaDePagoAlMonitor(null),
      respuestaDeCancelarParaMonitor(null),
      respuestaDeGrupalesParaMonitor(null),
    ];
    for (const texto of textos) expect(texto).not.toMatch(/\d/);
  });
});
