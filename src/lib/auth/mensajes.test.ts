import { describe, expect, it } from "vitest";
import { mensajeDeError } from "./mensajes";

describe("mensajeDeError", () => {
  it("traduce los códigos conocidos", () => {
    expect(mensajeDeError("invalid_credentials")).toBe("Correo o contraseña incorrectos.");
    expect(mensajeDeError("user_banned")).toMatch(/desactivada/);
  });

  it("traduce el rechazo del CAPTCHA (HU-058) y pisa el mensaje por defecto de cada formulario", () => {
    const texto = "No pudimos verificar que eres una persona. Recarga la página e intenta de nuevo.";
    expect(mensajeDeError("captcha_failed")).toBe(texto);
    expect(mensajeDeError("captcha_failed", "No pudimos iniciar sesión. Intenta de nuevo.")).toBe(texto);
  });

  it("usa el mensaje por defecto para lo desconocido", () => {
    expect(mensajeDeError("codigo_raro")).toBe("Algo falló. Intenta de nuevo.");
    expect(mensajeDeError(undefined, "Otro")).toBe("Otro");
  });
});
