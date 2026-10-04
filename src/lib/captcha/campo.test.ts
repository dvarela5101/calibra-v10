import { describe, expect, it } from "vitest";
import { CAMPO_TOKEN_CAPTCHA, leerTokenCaptcha } from "./campo";

function datos(valores: Record<string, string>): FormData {
  const formulario = new FormData();
  for (const [nombre, valor] of Object.entries(valores)) formulario.set(nombre, valor);
  return formulario;
}

describe("leerTokenCaptcha", () => {
  it("el campo se llama captcha_token", () => {
    expect(CAMPO_TOKEN_CAPTCHA).toBe("captcha_token");
  });

  it("devuelve el token que trae el formulario", () => {
    expect(leerTokenCaptcha(datos({ captcha_token: "XXXX.DUMMY.TOKEN.XXXX" }))).toBe("XXXX.DUMMY.TOKEN.XXXX");
  });

  it("quita los espacios de los bordes", () => {
    expect(leerTokenCaptcha(datos({ captcha_token: "  abc  " }))).toBe("abc");
  });

  it("un token vacío o en blanco se trata como ausente", () => {
    expect(leerTokenCaptcha(datos({ captcha_token: "" }))).toBeUndefined();
    expect(leerTokenCaptcha(datos({ captcha_token: "   " }))).toBeUndefined();
  });

  it("un valor que no es texto (un archivo) es ausente", () => {
    const formulario = new FormData();
    formulario.set("captcha_token", new File(["abc"], "token.txt"));
    expect(leerTokenCaptcha(formulario)).toBeUndefined();
  });

  it("un token de más de 2048 caracteres es ausente; uno de 2048 se acepta", () => {
    expect(leerTokenCaptcha(datos({ captcha_token: "a".repeat(2049) }))).toBeUndefined();
    expect(leerTokenCaptcha(datos({ captcha_token: "a".repeat(2048) }))).toBe("a".repeat(2048));
  });

  it("sin el campo (sin llave de sitio) es ausente", () => {
    expect(leerTokenCaptcha(datos({ correo: "a@b.co" }))).toBeUndefined();
  });
});
