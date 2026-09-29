import { describe, expect, it } from "vitest";
import { mensajeDeError } from "./mensajes";

describe("mensajeDeError", () => {
  it("traduce los códigos conocidos", () => {
    expect(mensajeDeError("invalid_credentials")).toBe("Correo o contraseña incorrectos.");
    expect(mensajeDeError("user_banned")).toMatch(/desactivada/);
  });

  it("usa el mensaje por defecto para lo desconocido", () => {
    expect(mensajeDeError("codigo_raro")).toBe("Algo falló. Intenta de nuevo.");
    expect(mensajeDeError(undefined, "Otro")).toBe("Otro");
  });
});
