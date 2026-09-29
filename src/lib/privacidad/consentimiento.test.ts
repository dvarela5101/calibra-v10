import { describe, expect, it } from "vitest";
import {
  CASILLA_CONTACTO,
  CASILLA_TRATAMIENTO,
  ERROR_SIN_AUTORIZACION,
  MARCADA,
  correoConsultasDatos,
  leerConsentimiento,
} from "./consentimiento";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

const AHORA = new Date("2026-09-29T22:15:00.000Z");

describe("leerConsentimiento", () => {
  it("sin la casilla de tratamiento no hay consentimiento, aunque acepte el contacto", () => {
    expect(leerConsentimiento(formulario({}), AHORA)).toEqual({ ok: false, error: ERROR_SIN_AUTORIZACION });
    expect(leerConsentimiento(formulario({ [CASILLA_CONTACTO]: MARCADA }), AHORA)).toEqual({
      ok: false,
      error: ERROR_SIN_AUTORIZACION,
    });
  });

  it.each(["", "on", "true", "Si", "no"])("un valor distinto de la casilla marcada (%j) no autoriza", (valor) => {
    expect(leerConsentimiento(formulario({ [CASILLA_TRATAMIENTO]: valor }), AHORA).ok).toBe(false);
  });

  it("con la autorización guarda los tres campos, con la fecha del servidor", () => {
    expect(leerConsentimiento(formulario({ [CASILLA_TRATAMIENTO]: MARCADA }), AHORA)).toEqual({
      ok: true,
      consentimiento: {
        acepta_tratamiento_datos: true,
        fecha_consentimiento: "2026-09-29T22:15:00.000Z",
        acepta_contacto: false,
      },
    });
  });

  it("el contacto comercial es aparte y opcional", () => {
    const resultado = leerConsentimiento(
      formulario({ [CASILLA_TRATAMIENTO]: MARCADA, [CASILLA_CONTACTO]: MARCADA }),
      AHORA,
    );
    expect(resultado.ok && resultado.consentimiento.acepta_contacto).toBe(true);
  });

  it("ignora una fecha que mande el navegador", () => {
    const resultado = leerConsentimiento(
      formulario({ [CASILLA_TRATAMIENTO]: MARCADA, fecha_consentimiento: "2020-01-01T00:00:00.000Z" }),
      AHORA,
    );
    expect(resultado.ok && resultado.consentimiento.fecha_consentimiento).toBe(AHORA.toISOString());
  });
});

describe("correoConsultasDatos", () => {
  it("lee CORREO_DATOS_PERSONALES", () => {
    expect(correoConsultasDatos({ CORREO_DATOS_PERSONALES: " datos@calibra.example " })).toBe("datos@calibra.example");
  });

  it.each([undefined, "", "   ", "no-es-correo", "a@b.co,otro@c.co"])("sin un correo válido (%j) da null", (valor) => {
    expect(correoConsultasDatos({ CORREO_DATOS_PERSONALES: valor })).toBeNull();
  });
});
