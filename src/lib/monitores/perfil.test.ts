import { describe, expect, it } from "vitest";
import {
  leerPerfil,
  lineaDeEstudios,
  MENSAJE_CONTACTO,
  MENSAJES,
  normalizarCarrera,
  normalizarPresentacion,
  parrafos,
  tieneContacto,
} from "./perfil";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

// Los mismos casos que supabase/tests/perfil_monitor.test.sql: la app y la base aplican la misma regla (D-58 b).
const CON_CONTACTO = [
  "3001234567",
  "300 123 4567",
  "+57 300-123-4567",
  "300.123.4567",
  "1234567",
  "2022-2023",
  "escríbeme a ana@uniandes.edu.co",
  "@usuario",
  "https://calibra.co",
  "mira HTTP://ejemplo.com",
  "www.ejemplo.com",
  "WWW.EJEMPLO.COM",
];
const SIN_CONTACTO = ["Monitor de Cálculo 2 desde 2024-1, nota 4,8", "de 2022 a 2023", "123456", "Ingeniería de Sistemas"];

describe("tieneContacto (D-58 b)", () => {
  it.each(CON_CONTACTO)("rechaza %j", (texto) => expect(tieneContacto(texto)).toBe(true));
  it.each(SIN_CONTACTO)("acepta %j", (texto) => expect(tieneContacto(texto)).toBe(false));
});

describe("normalizar", () => {
  it("la carrera queda en una línea, sin espacios de sobra ni caracteres de control", () => {
    expect(normalizarCarrera("  Ingeniería \n  de\tSistemas ")).toBe("Ingeniería de Sistemas");
    expect(normalizarCarrera("Física\u0007")).toBe("Física");
    expect(normalizarCarrera("   ")).toBeNull();
    expect(normalizarCarrera(null)).toBeNull();
  });

  it("la presentación: CRLF a LF, líneas recortadas, vacías fuera", () => {
    expect(normalizarPresentacion("  Hola  \r\n\r\n   soy   Ana \r\r\nMonitora\u0000 ")).toBe("Hola\nsoy Ana\nMonitora");
    expect(normalizarPresentacion(" \n \r\n ")).toBeNull();
  });

  it("los párrafos son las líneas de la presentación", () => {
    expect(parrafos("Uno\nDos")).toEqual(["Uno", "Dos"]);
    expect(parrafos(null)).toEqual([]);
  });
});

describe("leerPerfil", () => {
  it("guarda los tres campos normalizados", () => {
    expect(leerPerfil(formulario({ carrera: " Matemáticas ", semestre: " 5 ", presentacion: "Hola\r\nChao" }))).toEqual({
      ok: true,
      datos: { carrera: "Matemáticas", semestre: 5, presentacion: "Hola\nChao" },
    });
  });

  it("cada campo es opcional: vacío (o solo espacios) se guarda como nulo", () => {
    expect(leerPerfil(formulario({ carrera: "  ", semestre: "", presentacion: " \n " }))).toEqual({
      ok: true,
      datos: { carrera: null, semestre: null, presentacion: null },
    });
    expect(leerPerfil(new FormData())).toEqual({ ok: true, datos: { carrera: null, semestre: null, presentacion: null } });
  });

  it("los bordes de la carrera: 80 sí, 81 no (en caracteres, no en bytes)", () => {
    expect(leerPerfil(formulario({ carrera: "á".repeat(80) })).ok).toBe(true);
    expect(leerPerfil(formulario({ carrera: "á".repeat(81) }))).toEqual({ ok: false, errores: { carrera: MENSAJES.carrera } });
  });

  it.each(["1", "12"])("semestre %s sí", (semestre) => {
    expect(leerPerfil(formulario({ semestre }))).toEqual({ ok: true, datos: { carrera: null, semestre: Number(semestre), presentacion: null } });
  });

  it.each(["0", "13", "2.5", "2,5", "-1", "tres", "1e1", "007"])("semestre %j no", (semestre) => {
    expect(leerPerfil(formulario({ semestre }))).toEqual({ ok: false, errores: { semestre: MENSAJES.semestre } });
  });

  it("los bordes de la presentación: 500 sí, 501 no", () => {
    expect(leerPerfil(formulario({ presentacion: "ñ".repeat(500) })).ok).toBe(true);
    expect(leerPerfil(formulario({ presentacion: "ñ".repeat(501) }))).toEqual({
      ok: false,
      errores: { presentacion: MENSAJES.presentacion },
    });
  });

  it("rechaza contacto en la carrera y en la presentación, cada uno con su mensaje", () => {
    expect(leerPerfil(formulario({ carrera: "Sistemas 300 123 4567", semestre: "4", presentacion: "Trabajé de 2022-2023" }))).toEqual({
      ok: false,
      errores: { carrera: MENSAJE_CONTACTO, presentacion: MENSAJE_CONTACTO },
    });
    expect(leerPerfil(formulario({ presentacion: "Trabajé de 2022 a 2023" })).ok).toBe(true);
  });

  it("informa todos los campos con error a la vez", () => {
    const resultado = leerPerfil(formulario({ carrera: "x".repeat(81), semestre: "13", presentacion: "x".repeat(501) }));
    expect(resultado).toEqual({ ok: false, errores: { carrera: MENSAJES.carrera, semestre: MENSAJES.semestre, presentacion: MENSAJES.presentacion } });
  });
});

describe("lineaDeEstudios", () => {
  it("carrera y semestre, o lo que haya", () => {
    expect(lineaDeEstudios({ carrera: "Economía", semestre: 6 })).toBe("Economía · 6.º semestre");
    expect(lineaDeEstudios({ carrera: "Economía", semestre: null })).toBe("Economía");
    expect(lineaDeEstudios({ carrera: null, semestre: 3 })).toBe("3.º semestre");
    expect(lineaDeEstudios({ carrera: null, semestre: null })).toBeNull();
  });
});
