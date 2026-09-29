import { describe, expect, it } from "vitest";
import { enlaceAbsoluto, esCorreo, urlDelSitio } from "./contacto";

describe("esCorreo", () => {
  it.each([
    "ana@uniandes.edu.co",
    "ana.perez+calibra@uniandes.edu.co",
    "a@b.co",
    "ANA@Uniandes.EDU.CO",
    "primer_apellido-2@sub.dominio.com",
  ])("acepta %s", (correo) => {
    expect(esCorreo(correo)).toBe(true);
  });

  it.each([
    ["vacío", ""],
    ["sin arroba", "ana.uniandes.edu.co"],
    ["sin dominio", "ana@"],
    ["sin usuario", "@uniandes.edu.co"],
    ["dominio sin punto", "ana@uniandes"],
    ["dos arrobas", "ana@@uniandes.edu.co"],
    ["con espacio", "ana perez@uniandes.edu.co"],
    ["con salto de línea al final", "ana@uniandes.edu.co\n"],
    ["con un salto de línea y otra cabecera", "ana@uniandes.edu.co\nBcc: otro@dominio.co"],
    ["dos destinatarios con coma", "ana@uniandes.edu.co,otro@dominio.co"],
    ["dos destinatarios con punto y coma", "ana@uniandes.edu.co;otro@dominio.co"],
    ["entre ángulos", "<ana@uniandes.edu.co>"],
    ["con nombre", "Ana <ana@uniandes.edu.co>"],
    ["con comillas", '"ana"@uniandes.edu.co'],
    ["un teléfono", "3001234567"],
    ["un teléfono con indicativo", "+57 300 123 4567"],
  ])("rechaza %s", (_nombre, valor) => {
    expect(esCorreo(valor)).toBe(false);
  });

  it("rechaza uno de más de 254 caracteres y acepta uno de exactamente 254", () => {
    const relleno = (n: number) => "a".repeat(n);
    const largo = (total: number) => `${relleno(total - "@b.co".length)}@b.co`;
    expect(esCorreo(largo(254))).toBe(true);
    expect(esCorreo(largo(255))).toBe(false);
  });
});

describe("enlaceAbsoluto", () => {
  it("une el sitio y la ruta, con consulta y ancla", () => {
    expect(enlaceAbsoluto("https://calibra.example", "/admin")).toBe("https://calibra.example/admin");
    expect(enlaceAbsoluto("https://calibra.example/", "/resultados?token=abc#pagos")).toBe(
      "https://calibra.example/resultados?token=abc#pagos",
    );
    expect(enlaceAbsoluto("http://localhost:3000", "/")).toBe("http://localhost:3000/");
  });

  it("el sitio con ruta no se traga la ruta pedida", () => {
    expect(enlaceAbsoluto("https://calibra.example/base", "/admin")).toBe("https://calibra.example/admin");
  });

  it.each([
    ["una ruta sin barra", "admin"],
    ["una ruta que empieza con //", "//otro.sitio/admin"],
    ["una URL completa", "https://otro.sitio/admin"],
    ["vacía", ""],
  ])("rechaza %s", (_nombre, ruta) => {
    expect(() => enlaceAbsoluto("https://calibra.example", ruta)).toThrow(RangeError);
  });

  it.each(["ftp://calibra.example", "javascript:alert(1)", "calibra.example", ""])("rechaza el sitio %j", (sitio) => {
    expect(() => enlaceAbsoluto(sitio, "/admin")).toThrow();
  });

  it.each([
    ["una barra invertida (los navegadores la leen como barra)", "/\\otro.sitio/x"],
    ["una tabulación entre las barras", "/\t/otro.sitio/x"],
    ["un salto de línea entre las barras", "/\n/otro.sitio/x"],
    ["barras invertidas dobles", "/\\\\otro.sitio/x"],
  ])("rechaza una ruta con %s: el enlace tiene que quedarse en el sitio", (_nombre, ruta) => {
    expect(() => enlaceAbsoluto("https://calibra.example", ruta)).toThrow(RangeError);
  });

  it("los mensajes de error no repiten la ruta, que puede traer un token", () => {
    for (const ruta of ["sin-barra?token=SECRETO123", "//otro.sitio/?token=SECRETO123"]) {
      try {
        enlaceAbsoluto("https://calibra.example", ruta);
        expect.unreachable();
      } catch (error) {
        expect(String(error)).not.toContain("SECRETO123");
      }
    }
  });
});

describe("urlDelSitio", () => {
  it("con SITIO_URL arma la URL pública", () => {
    expect(urlDelSitio("/admin", { SITIO_URL: "https://calibra.example" })).toBe("https://calibra.example/admin");
    expect(urlDelSitio("/r?token=abc", { SITIO_URL: "  https://calibra.example/  " })).toBe("https://calibra.example/r?token=abc");
  });

  it("en desarrollo, sin SITIO_URL, usa localhost:3000", () => {
    expect(urlDelSitio("/admin", {})).toBe("http://localhost:3000/admin");
    expect(urlDelSitio("/admin", { NODE_ENV: "development", SITIO_URL: "" })).toBe("http://localhost:3000/admin");
    expect(urlDelSitio("/admin", { NODE_ENV: "test" })).toBe("http://localhost:3000/admin");
  });

  it("en producción sin SITIO_URL falla: un enlace a localhost en un correo real no sirve", () => {
    expect(() => urlDelSitio("/admin", { NODE_ENV: "production" })).toThrow(/SITIO_URL/);
    expect(() => urlDelSitio("/admin", { NODE_ENV: "production", SITIO_URL: "   " })).toThrow(/SITIO_URL/);
  });

  it("en producción con SITIO_URL, la usa", () => {
    expect(urlDelSitio("/admin", { NODE_ENV: "production", SITIO_URL: "https://calibra.example" })).toBe("https://calibra.example/admin");
  });

  it("una ruta inválida sigue siendo un error", () => {
    expect(() => urlDelSitio("admin", { SITIO_URL: "https://calibra.example" })).toThrow(RangeError);
  });
});
