import { describe, expect, it } from "vitest";
import {
  MOTIVO_CANCELACION_A_TIEMPO,
  RUTA_DE_LLAVE,
  rutaDeLlave,
  TEXTO_PAGO_EN_REVISION_AL_CANCELAR,
  tieneFormaDeTokenDeLlave,
} from "./reglas";

const TOKEN = "e".repeat(64);

describe("el enlace de la llave (HU-024, D-27)", () => {
  it("la ruta lleva el token en la consulta, para la página de HU-025", () => {
    expect(RUTA_DE_LLAVE).toBe("/reembolso");
    expect(rutaDeLlave(TOKEN)).toBe(`/reembolso?token=${TOKEN}`);
  });

  it("reconoce 64 hexadecimales en minúscula y nada más", () => {
    expect(tieneFormaDeTokenDeLlave(TOKEN)).toBe(true);
    expect(tieneFormaDeTokenDeLlave("0123456789abcdef".repeat(4))).toBe(true);
    for (const malo of ["E".repeat(64), "e".repeat(63), "e".repeat(65), `${"e".repeat(63)}\n`, `${"e".repeat(63)}g`, "", " ".repeat(64)]) {
      expect(tieneFormaDeTokenDeLlave(malo), JSON.stringify(malo)).toBe(false);
    }
    expect(tieneFormaDeTokenDeLlave(undefined)).toBe(false);
    expect(tieneFormaDeTokenDeLlave(null)).toBe(false);
    // `?token=a&token=b` llega como lista: no es un token.
    expect(tieneFormaDeTokenDeLlave([TOKEN, TOKEN])).toBe(false);
  });
});

describe("los textos fijos del reembolso al cancelar", () => {
  it("el motivo es el de D-26, exacto", () => {
    expect(MOTIVO_CANCELACION_A_TIEMPO).toBe("Cancelaste la monitoría dentro del plazo.");
  });

  it("el pago en revisión explica las dos salidas (D-27), sin cifras de comisión", () => {
    expect(TEXTO_PAGO_EN_REVISION_AL_CANCELAR).toBe(
      "Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.",
    );
    expect(TEXTO_PAGO_EN_REVISION_AL_CANCELAR).not.toMatch(/comisi|neto/i);
  });
});
