import { describe, expect, it } from "vitest";
import {
  datosDeResenaIndividual,
  LARGO_MAXIMO_COMENTARIO,
  rutaDeResena,
  tieneFormaDeTokenDeResena,
  validarResena,
  type DatosDeInvitacion,
} from "./reglas";

const TOKEN = "a".repeat(64);

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [clave, valor] of Object.entries(campos)) f.set(clave, valor);
  return f;
}

describe("token del enlace (HU-035, RN-72)", () => {
  it("reconoce 64 hexadecimales en minúscula y nada más", () => {
    expect(tieneFormaDeTokenDeResena(TOKEN)).toBe(true);
    expect(tieneFormaDeTokenDeResena("0123456789abcdef".repeat(4))).toBe(true);
    expect(tieneFormaDeTokenDeResena("A".repeat(64))).toBe(false);
    expect(tieneFormaDeTokenDeResena("a".repeat(63))).toBe(false);
    expect(tieneFormaDeTokenDeResena("a".repeat(65))).toBe(false);
    expect(tieneFormaDeTokenDeResena(`${"a".repeat(63)}\n`)).toBe(false);
    expect(tieneFormaDeTokenDeResena(undefined)).toBe(false);
    expect(tieneFormaDeTokenDeResena(["a".repeat(64)])).toBe(false);
  });

  it("arma la ruta del enlace con el token", () => {
    expect(rutaDeResena(TOKEN)).toBe(`/resena?token=${TOKEN}`);
  });
});

describe("validarResena (D-17)", () => {
  it("acepta de 1 a 5, con o sin comentario", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(validarResena(formulario({ calificacion: String(n) }))).toEqual({ ok: true, calificacion: n, comentario: null });
    }
    expect(validarResena(formulario({ calificacion: "4", comentario: "Muy clara" }))).toEqual({
      ok: true,
      calificacion: 4,
      comentario: "Muy clara",
    });
  });

  it("la calificación es obligatoria y entera", () => {
    for (const valor of ["", "  ", "0", "6", "-1", "3.5", "3,5", "cinco", "1e1", "+3", "99999999999999999999"]) {
      const lectura = validarResena(formulario({ calificacion: valor }));
      expect(lectura.ok, `calificación ${JSON.stringify(valor)}`).toBe(false);
    }
    expect(validarResena(new FormData()).ok).toBe(false);
  });

  it("explica el error en español", () => {
    expect(validarResena(new FormData())).toEqual({ ok: false, error: "Elige una calificación de 1 a 5." });
    expect(validarResena(formulario({ calificacion: "7" }))).toEqual({ ok: false, error: "La calificación va de 1 a 5." });
  });

  it("recorta el comentario y lo deja null si queda vacío", () => {
    expect(validarResena(formulario({ calificacion: "5", comentario: "  Excelente  " }))).toEqual({
      ok: true,
      calificacion: 5,
      comentario: "Excelente",
    });
    expect(validarResena(formulario({ calificacion: "5", comentario: " \n\t " }))).toEqual({ ok: true, calificacion: 5, comentario: null });
  });

  it("conserva los saltos de línea del medio", () => {
    const lectura = validarResena(formulario({ calificacion: "3", comentario: "Uno\n\nDos" }));
    expect(lectura).toEqual({ ok: true, calificacion: 3, comentario: "Uno\n\nDos" });
  });

  it("el comentario puede tener hasta 1000 caracteres, no más", () => {
    expect(validarResena(formulario({ calificacion: "5", comentario: "a".repeat(LARGO_MAXIMO_COMENTARIO) })).ok).toBe(true);
    expect(validarResena(formulario({ calificacion: "5", comentario: "a".repeat(LARGO_MAXIMO_COMENTARIO + 1) }))).toEqual({
      ok: false,
      error: "El comentario puede tener hasta 1000 caracteres.",
    });
  });

  it("cuenta caracteres, no unidades UTF-16 (como char_length de la base)", () => {
    expect(validarResena(formulario({ calificacion: "5", comentario: "😀".repeat(LARGO_MAXIMO_COMENTARIO) })).ok).toBe(true);
    expect(validarResena(formulario({ calificacion: "5", comentario: "😀".repeat(LARGO_MAXIMO_COMENTARIO + 1) })).ok).toBe(false);
  });
});

describe("datos del correo", () => {
  it("lleva el nombre del Lead, el monitor y el enlace, y nada más", () => {
    const d: DatosDeInvitacion = { token: TOKEN, disponible: true, correoLead: "ana@calibra.test", nombreLead: "Ana", nombreMonitor: "Camilo" };
    const datos = datosDeResenaIndividual(d, `https://calibra.test/resena?token=${TOKEN}`);
    expect(datos).toEqual({ nombre: "Ana", monitor: "Camilo", enlace: `https://calibra.test/resena?token=${TOKEN}` });
  });
});
