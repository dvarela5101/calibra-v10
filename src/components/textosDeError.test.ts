import { describe, expect, it } from "vitest";
import { TEXTOS_DE_ERROR, datosDelRegistro } from "./textosDeError";

describe("textos de error (HU-133)", () => {
  it("están en español, sin detalles técnicos", () => {
    const todo = Object.values(TEXTOS_DE_ERROR).join(" ");
    expect(TEXTOS_DE_ERROR.reintentar).toBe("Intentar de nuevo");
    expect(todo).not.toMatch(/error \d{3}|stack|exception|supabase|undefined|something went wrong/i);
  });

  it("del error solo se registra el digest", () => {
    const error = Object.assign(new Error("correo@uniandes.edu.co falló"), { digest: "abc123" });
    expect(datosDelRegistro(error)).toEqual({ digest: "abc123" });
    expect(JSON.stringify(datosDelRegistro(error))).not.toContain("correo");
    expect(datosDelRegistro(new Error("x"))).toEqual({ digest: "sin-digest" });
  });
});
