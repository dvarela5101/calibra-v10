import { describe, expect, it } from "vitest";
import type { ParametrosNegocio } from "@/lib/plazos/parametros";
import { respuestaDeCancelar, respuestaDeCuenta, textoDelBeneficioDeCancelar } from "./textos";

// Los de la migración 20261001054024 (RN-35, RN-60, RN-62); los demás no se leen aquí.
const PARAMETROS = {
  antelacionGrupalMin: 2160,
  cancelacionIndividualMin: 720,
  cancelacionGrupalMin: 1440,
  reporteInasistenciaMin: 1440,
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
