import { describe, expect, it } from "vitest";
import { leerOrigen } from "./origen";
import { enmascararCorreo, leerContacto, normalizarCorreo, normalizarTelefono, resumenDeError, rutaSiguiente } from "./reglas";
import { generarToken, hashDeToken, rutaDeVerificacion, tieneFormaDeToken } from "./verificacion";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

const VALIDO = { nombre: "  Ana   Pérez ", correo: " Ana.Perez@Uniandes.edu.co ", numero_telefono: "" };

describe("leerContacto (HU-068, P-21, P-22)", () => {
  it("lee nombre y correo normalizados; el teléfono es opcional", () => {
    expect(leerContacto(formulario(VALIDO))).toEqual({
      ok: true,
      datos: { nombre: "Ana Pérez", correo: "ana.perez@uniandes.edu.co", numeroTelefono: null },
    });
  });

  it("guarda el teléfono con indicativo", () => {
    expect(leerContacto(formulario({ ...VALIDO, numero_telefono: "+57 300 123 4567" }))).toMatchObject({
      ok: true,
      datos: { numeroTelefono: "+573001234567" },
    });
  });

  it.each([
    ["sin nombre", { nombre: "   " }, "Escribe tu nombre."],
    ["con un nombre demasiado largo", { nombre: "a".repeat(121) }, "Tu nombre es demasiado largo."],
    ["sin correo", { correo: "" }, "Escribe un correo válido, por ejemplo ana@uniandes.edu.co."],
    ["con un correo que no es correo", { correo: "ana@" }, "Escribe un correo válido, por ejemplo ana@uniandes.edu.co."],
    ["con dos correos", { correo: "a@b.co,c@d.co" }, "Escribe un correo válido, por ejemplo ana@uniandes.edu.co."],
    [
      "con un teléfono que no es teléfono",
      { numero_telefono: "llámame" },
      "Escribe el teléfono con su indicativo, por ejemplo +57 300 123 4567, o déjalo vacío.",
    ],
  ])("rechaza un contacto %s", (_caso, cambios, error) => {
    expect(leerContacto(formulario({ ...VALIDO, ...cambios }))).toEqual({ ok: false, error });
  });
});

describe("normalizarCorreo", () => {
  it("deja el correo en minúsculas y sin espacios", () => {
    expect(normalizarCorreo("  ANA@Example.COM ")).toBe("ana@example.com");
    expect(normalizarCorreo("no es correo")).toBeNull();
    expect(normalizarCorreo(null)).toBeNull();
  });
});

describe("normalizarTelefono (P-22)", () => {
  it.each([
    ["+57 300 123 4567", "+573001234567"],
    ["300 123 4567", "+573001234567"],
    ["(300) 123-4567", "+573001234567"],
    ["+1 (212) 555-0100", "+12125550100"],
    ["573001234567", "+573001234567"],
    ["57 300 123 4567", "+573001234567"],
    ["0057 300 123 4567", "+573001234567"],
    ["001 212 555 0100", "+12125550100"],
  ])("%j se guarda como %j", (entrada, guardado) => {
    expect(normalizarTelefono(entrada)).toBe(guardado);
  });

  it("vacío es null: el teléfono es opcional", () => {
    expect(normalizarTelefono("")).toBeNull();
    expect(normalizarTelefono("   ")).toBeNull();
  });

  it.each(["123", "+1234567890123456", "300-ABC-4567", "+57 300 123 4567 ext 2"])("%j no es un teléfono", (entrada) => {
    expect(normalizarTelefono(entrada)).toBeUndefined();
  });
});

describe("rutaSiguiente", () => {
  it.each([
    ["/agendar/monitores?materia=MATE-1207", "/agendar/monitores?materia=MATE-1207"],
    ["/", "/"],
    ["/agendar/x#fecha", "/agendar/x#fecha"],
  ])("deja pasar la ruta interna %j", (ruta, esperada) => {
    expect(rutaSiguiente(ruta)).toBe(esperada);
  });

  it.each([
    "https://otro.sitio/x",
    "//otro.sitio/x",
    "/\\otro.sitio/x",
    "/\t/otro.sitio",
    "/.//otro.sitio/x",
    "/..//otro.sitio",
    "/%2e//otro.sitio",
    "/%2E%2E//otro.sitio",
    "/a/..//otro.sitio",
    "javascript:alert(1)",
    "agendar",
    "",
    `/${"a".repeat(600)}`,
  ])("cualquier otra cosa (%j) vuelve al inicio", (ruta) => {
    expect(rutaSiguiente(ruta)).toBe("/");
  });

  it("sin valor, al inicio", () => {
    expect(rutaSiguiente(undefined)).toBe("/");
    expect(rutaSiguiente(["/a"])).toBe("/");
  });

  it("aplicarla dos veces da lo mismo", () => {
    for (const ruta of ["/agendar/x?a=1#b", "/./agendar", "/a/../agendar", "/.//otro.sitio", "/%2e%2e/x"]) {
      expect(rutaSiguiente(rutaSiguiente(ruta))).toBe(rutaSiguiente(ruta));
    }
    expect(rutaSiguiente("/a/../agendar")).toBe("/agendar");
  });
});

describe("enmascararCorreo", () => {
  it("deja ver solo la primera letra del usuario y del dominio", () => {
    expect(enmascararCorreo("ana.perez@uniandes.edu.co")).toBe("a***@u***.edu.co");
    expect(enmascararCorreo("b@ejemplo.com")).toBe("b***@e***.com");
  });
});

describe("resumenDeError", () => {
  it("registra código y mensaje, nunca los detalles con datos", () => {
    const error = { code: "23505", message: "duplicate key", details: "Key (correo)=(ana@ejemplo.com) already exists." };
    expect(resumenDeError(error)).toBe("23505 duplicate key");
    expect(resumenDeError(new Error("se cayó"))).toBe("se cayó");
    expect(resumenDeError("texto")).toBe("texto");
  });
});

describe("leerOrigen (RN-01)", () => {
  it("guarda la campaña si tiene forma de campaña", () => {
    expect(leerOrigen("feria-uniandes_2026.v2")).toBe("feria-uniandes_2026.v2");
    expect(leerOrigen("  instagram  ")).toBe("instagram");
  });

  it.each(["", "con espacio", "<script>", "a".repeat(101), "campaña"])("no guarda %j", (valor) => {
    expect(leerOrigen(valor)).toBeNull();
  });
});

describe("token de verificación (P-23)", () => {
  it("son 256 bits en hex y la base guarda su SHA-256", () => {
    const { token, hash } = generarToken();
    expect(tieneFormaDeToken(token)).toBe(true);
    expect(hash).toBe(hashDeToken(token));
    expect(hash).not.toBe(token);
    expect(rutaDeVerificacion(token)).toBe(`/contacto/verificar?token=${token}`);
  });

  it("lo que no tiene forma de token ni se consulta", () => {
    expect(tieneFormaDeToken("abc")).toBe(false);
    expect(tieneFormaDeToken("G".repeat(64))).toBe(false);
    expect(tieneFormaDeToken(undefined)).toBe(false);
  });
});
