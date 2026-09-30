import { describe, expect, it } from "vitest";
import {
  generarToken,
  hashDeToken,
  leerRegistro,
  normalizarCorreo,
  rutaDeRegistro,
  tieneFormaDeToken,
  validarLlave,
} from "./invitacion";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

const VALIDO = {
  nombre: "  Camilo   Rojas ",
  numero_telefono: "+57 300 123 4567",
  llave: " 3001234567 ",
  contrasena: "clave-segura",
  confirmacion: "clave-segura",
};

describe("token de invitación", () => {
  it("son 256 bits en hex y la base solo guarda su SHA-256", () => {
    const { token, hash } = generarToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hashDeToken(token)).toBe(hash);
  });

  it("cada invitación tiene su propio token", () => {
    expect(generarToken().token).not.toBe(generarToken().token);
  });

  it("el SHA-256 es el estándar", () => {
    expect(hashDeToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it.each([undefined, null, "", "abc", "A".repeat(64), `${"a".repeat(63)}g`, ["a".repeat(64)]])(
    "%j no tiene forma de token",
    (valor) => {
      expect(tieneFormaDeToken(valor)).toBe(false);
    },
  );

  it("el enlace lleva el token a la página de registro", () => {
    expect(rutaDeRegistro("f".repeat(64))).toBe(`/monitores/registro?token=${"f".repeat(64)}`);
  });
});

describe("normalizarCorreo", () => {
  it("deja el correo en minúsculas y sin espacios", () => {
    expect(normalizarCorreo("  Ana@Uniandes.EDU.co ")).toBe("ana@uniandes.edu.co");
  });

  it.each(["", "ana", "ana@uniandes", "a@b.co,c@d.co", null])("%j no es un correo", (valor) => {
    expect(normalizarCorreo(valor)).toBeNull();
  });
});

describe("leerRegistro", () => {
  it("limpia los campos y no pide el correo (es el de la invitación)", () => {
    expect(leerRegistro(formulario(VALIDO))).toEqual({
      ok: true,
      datos: { nombre: "Camilo Rojas", numeroTelefono: "+57 300 123 4567", llave: "3001234567", contrasena: "clave-segura" },
    });
  });

  it.each([
    ["sin nombre", { nombre: "  " }, "Escribe tu nombre."],
    ["con un teléfono con letras", { numero_telefono: "300-abc" }, "Escribe un teléfono válido, por ejemplo 300 123 4567."],
    ["con un teléfono corto", { numero_telefono: "12345" }, "Escribe un teléfono válido, por ejemplo 300 123 4567."],
    ["sin llave", { llave: "" }, "Escribe tu llave para recibir tus pagos."],
    ["con una contraseña corta", { contrasena: "corta", confirmacion: "corta" }, "La contraseña debe tener al menos 8 caracteres."],
    ["con contraseñas distintas", { confirmacion: "otra-clave" }, "Las dos contraseñas no coinciden."],
  ])("rechaza el formulario %s", (_caso, cambios, error) => {
    expect(leerRegistro(formulario({ ...VALIDO, ...cambios }))).toEqual({ ok: false, error });
  });
});

describe("validarLlave", () => {
  it("acepta un celular, un correo o un alias", () => {
    for (const llave of ["3001234567", "ana@banco.co", "@ana-rojas"]) expect(validarLlave(llave)).toBeNull();
  });

  it("rechaza una llave vacía o demasiado larga", () => {
    expect(validarLlave("")).not.toBeNull();
    expect(validarLlave("x".repeat(201))).not.toBeNull();
  });
});
