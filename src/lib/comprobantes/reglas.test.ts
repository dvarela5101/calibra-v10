import { describe, expect, it } from "vitest";
import {
  BYTES_PARA_RECONOCER,
  LIMITE_COMPROBANTE_BYTES,
  TIPOS_DE_COMPROBANTE,
  VIGENCIA_ENLACE_COMPROBANTE_SEG,
  esRutaDeComprobante,
  rutaDeComprobante,
  rutaEsDelUsuario,
  tipoPorContenido,
  validarComprobante,
} from "./reglas";

const MB = 1024 * 1024;
const ID_A = "0f9d5e1c-3b7a-4c52-9d11-6a1f2b3c4d5e";
const ID_B = "a0000000-0000-0000-0000-000000000001";
const ARCHIVO = "b1c2d3e4-f5a6-4789-8abc-def012345678";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

describe("los tipos permitidos son los del criterio: JPG, PNG y PDF", () => {
  it("nada más", () => {
    expect(TIPOS_DE_COMPROBANTE).toEqual({ "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" });
  });
});

describe("las decisiones sobre los comprobantes están fijadas con su valor", () => {
  // Si alguien cambia el límite o la vigencia, esta prueba obliga a que lo haga a propósito.
  it("10 MiB por archivo (N-3) y enlaces firmados de 60 segundos", () => {
    expect(LIMITE_COMPROBANTE_BYTES).toBe(10_485_760);
    expect(VIGENCIA_ENLACE_COMPROBANTE_SEG).toBe(60);
  });
});

describe("validarComprobante: tipo y tamaño", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["application/pdf", "pdf"],
  ])("acepta %s y lo guarda como .%s", (type, extension) => {
    expect(validarComprobante({ name: "comprobante", type, size: 200_000 })).toEqual({ ok: true, tipo: type, extension });
  });

  it("acepta un archivo de 1 byte y uno del tamaño exacto del límite (10 MB)", () => {
    expect(validarComprobante({ name: "a.png", type: "image/png", size: 1 }).ok).toBe(true);
    expect(validarComprobante({ name: "a.png", type: "image/png", size: 10 * MB }).ok).toBe(true);
  });

  it("un archivo de más de 5 MB, que antes se rechazaba, ahora se acepta", () => {
    expect(validarComprobante({ name: "a.png", type: "image/png", size: 5 * MB + 1 }).ok).toBe(true);
    expect(validarComprobante({ name: "a.pdf", type: "application/pdf", size: 9 * MB }).ok).toBe(true);
  });

  it("rechaza un byte más que el límite y dice cuánto pesa y cuál es el máximo", () => {
    const r = validarComprobante({ name: "a.png", type: "image/png", size: LIMITE_COMPROBANTE_BYTES + 1 });
    expect(r).toEqual({
      ok: false,
      mensaje: "El comprobante pesa 10,1 MB y el máximo es 10 MB. Comprime la imagen o toma otra captura.",
    });
  });

  it("usa la coma decimal de es-CO en el mensaje de tamaño", () => {
    const r = validarComprobante({ name: "a.pdf", type: "application/pdf", size: 10.5 * MB });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.mensaje).toContain("10,5 MB");
    // Un archivo de 12 MB no se muestra con decimales que no dicen nada.
    const grande = validarComprobante({ name: "a.pdf", type: "application/pdf", size: 12 * MB });
    expect(grande.ok === false && grande.mensaje).toContain("pesa 12 MB");
  });

  it.each([
    ["texto plano", "text/plain"],
    ["GIF", "image/gif"],
    ["WebP", "image/webp"],
    ["SVG (puede llevar scripts)", "image/svg+xml"],
    ["HTML", "text/html"],
    ["ejecutable", "application/x-msdownload"],
    ["sin tipo", ""],
    ["tipo con parámetros", "image/png; charset=binary"],
    ["mayúsculas", "IMAGE/PNG"],
    ["una clave del prototipo de Object", "constructor"],
    ["otra clave del prototipo de Object", "__proto__"],
    ["toString", "toString"],
  ])("rechaza %s con un mensaje claro", (_nombre, type) => {
    expect(validarComprobante({ name: "x", type, size: 1000 })).toEqual({
      ok: false,
      mensaje: "El comprobante debe ser una imagen JPG o PNG, o un PDF.",
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rechaza un archivo de tamaño %s", (size) => {
    expect(validarComprobante({ name: "a.png", type: "image/png", size })).toEqual({
      ok: false,
      mensaje: "El archivo está vacío. Elige la captura o el PDF del comprobante.",
    });
  });

  it("revisa primero que no esté vacío, luego el tipo y luego el tamaño", () => {
    expect(validarComprobante({ name: "a", type: "text/plain", size: 0 })).toMatchObject({ mensaje: expect.stringContaining("vacío") });
    expect(validarComprobante({ name: "a", type: "text/plain", size: 99 * MB })).toMatchObject({ mensaje: expect.stringContaining("JPG o PNG") });
  });
});

describe("tipoPorContenido y validación del contenido real", () => {
  it("reconoce PNG, JPEG y PDF por sus primeros bytes", () => {
    expect(tipoPorContenido(PNG)).toBe("image/png");
    expect(tipoPorContenido(JPG)).toBe("image/jpeg");
    expect(tipoPorContenido(PDF)).toBe("application/pdf");
  });

  it("no reconoce HTML, texto, vacío ni firmas incompletas", () => {
    expect(tipoPorContenido(HTML)).toBeNull();
    expect(tipoPorContenido(new TextEncoder().encode("hola"))).toBeNull();
    expect(tipoPorContenido(new Uint8Array())).toBeNull();
    expect(tipoPorContenido(PNG.slice(0, 7))).toBeNull(); // falta un byte de la firma
    expect(tipoPorContenido(JPG.slice(0, 2))).toBeNull();
    expect(tipoPorContenido(new TextEncoder().encode("%PDF"))).toBeNull(); // sin el guion
  });

  it("no reconoce una firma completa con un solo byte cambiado", () => {
    expect(tipoPorContenido(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]))).toBeNull(); // PNG, último byte
    expect(tipoPorContenido(Uint8Array.from([0x88, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull(); // PNG, primer byte
    expect(tipoPorContenido(new TextEncoder().encode("%PDF+"))).toBeNull(); // PDF, último byte
    expect(tipoPorContenido(Uint8Array.from([0xff, 0xd8, 0x00]))).toBeNull(); // JPEG, último byte
    expect(tipoPorContenido(Uint8Array.from([0xfe, 0xd8, 0xff]))).toBeNull(); // JPEG, primer byte
  });

  it("BYTES_PARA_RECONOCER alcanza para la firma más larga", () => {
    expect(BYTES_PARA_RECONOCER).toBe(8);
  });

  it("acepta cuando el contenido coincide con lo declarado", () => {
    expect(validarComprobante({ name: "a", type: "image/png", size: 10 }, PNG).ok).toBe(true);
    expect(validarComprobante({ name: "a", type: "image/jpeg", size: 10 }, JPG).ok).toBe(true);
    expect(validarComprobante({ name: "a", type: "application/pdf", size: 10 }, PDF).ok).toBe(true);
  });

  it.each([
    ["HTML declarado como PNG", "image/png", HTML],
    ["JPEG declarado como PNG", "image/png", JPG],
    ["PDF declarado como JPEG", "image/jpeg", PDF],
    ["contenido vacío", "application/pdf", new Uint8Array()],
  ])("rechaza %s", (_nombre, type, inicio) => {
    expect(validarComprobante({ name: "a", type, size: 10 }, inicio)).toEqual({
      ok: false,
      mensaje: "El contenido del archivo no coincide con su formato. Sube la captura o el PDF original.",
    });
  });
});

describe("rutas de comprobantes", () => {
  it("la ruta lleva la carpeta del usuario y un uuid nuevo", () => {
    expect(rutaDeComprobante(ID_A, "png", ARCHIVO)).toBe(`${ID_A}/${ARCHIVO}.png`);
    const a = rutaDeComprobante(ID_A, "pdf");
    const b = rutaDeComprobante(ID_A, "pdf");
    expect(a).not.toBe(b);
    expect(esRutaDeComprobante(a)).toBe(true);
  });

  it.each([
    ["un id que no es uuid", "usuario-1", "png"],
    ["un id con mayúsculas", ID_A.toUpperCase(), "png"],
    ["una extensión que no se permite", ID_A, "exe"],
    ["una extensión con mayúsculas", ID_A, "PNG"],
    ["un id con una barra", `${ID_A}/x`, "png"],
    ["un id que sube de carpeta", "../otro", "png"],
  ])("rechaza %s", (_nombre, id, extension) => {
    expect(() => rutaDeComprobante(id, extension)).toThrow(RangeError);
  });

  it.each([
    ["ruta válida jpg", `${ID_A}/${ARCHIVO}.jpg`, true],
    ["ruta válida pdf", `${ID_A}/${ARCHIVO}.pdf`, true],
    ["carpeta anidada", `${ID_A}/sub/${ARCHIVO}.png`, false],
    ["subir de carpeta", `${ID_A}/../${ID_B}/${ARCHIVO}.png`, false],
    ["sin carpeta", `${ARCHIVO}.png`, false],
    ["extensión gif", `${ID_A}/${ARCHIVO}.gif`, false],
    ["extensión con mayúsculas", `${ID_A}/${ARCHIVO}.PNG`, false],
    ["doble extensión", `${ID_A}/${ARCHIVO}.png.exe`, false],
    ["nombre que no es uuid", `${ID_A}/comprobante.png`, false],
    ["salto de línea al final", `${ID_A}/${ARCHIVO}.png\n`, false],
    ["vacía", "", false],
  ])("esRutaDeComprobante: %s", (_nombre, ruta, esperado) => {
    expect(esRutaDeComprobante(ruta)).toBe(esperado);
  });

  it("rutaEsDelUsuario solo dice que sí para la carpeta de ese usuario", () => {
    const ruta = `${ID_A}/${ARCHIVO}.png`;
    expect(rutaEsDelUsuario(ID_A, ruta)).toBe(true);
    expect(rutaEsDelUsuario(ID_B, ruta)).toBe(false);
    expect(rutaEsDelUsuario(ID_A, `${ID_A}/../${ID_B}/${ARCHIVO}.png`)).toBe(false);
    expect(rutaEsDelUsuario(ID_A, "cualquier cosa")).toBe(false);
  });
});
