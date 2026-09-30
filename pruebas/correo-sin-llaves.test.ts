import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// HU-006, criterio 4: la llave del proveedor de correo nunca llega al navegador. Esta prueba lo
// vigila en el código; e2e/correo.spec.ts lo comprueba en el JavaScript que recibe un visitante.

const RAIZ = join(__dirname, "..");
const SRC = join(RAIZ, "src");

/** Todos los .ts y .tsx de una carpeta, sin las pruebas. */
function fuentes(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const archivos = fuentes(SRC).map((ruta) => ({ ruta: relative(RAIZ, ruta).replaceAll("\\", "/"), texto: readFileSync(ruta, "utf8") }));
const enCorreo = (ruta: string) => ruta.startsWith("src/lib/correo/");

/** Los archivos que se compilan para el navegador: componentes de cliente y todo lo que declara "use client". */
const esDeCliente = (a: { ruta: string; texto: string }) =>
  /^\s*["']use client["']/m.test(a.texto) || a.ruta.startsWith("src/components/");

describe("la llave del proveedor de correo no llega al navegador", () => {
  it("solo el código de src/lib/correo lee RESEND_API_KEY", () => {
    const lectores = archivos.filter((a) => a.texto.includes("RESEND_API_KEY")).map((a) => a.ruta);
    expect(lectores.length).toBeGreaterThan(0);
    for (const ruta of lectores) expect(enCorreo(ruta), `${ruta} lee RESEND_API_KEY`).toBe(true);
  });

  it("solo el código de src/lib/correo lee la contraseña de SMTP (HU-066)", () => {
    const lectores = archivos.filter((a) => a.texto.includes("SMTP_CONTRASENA")).map((a) => a.ruta);
    expect(lectores.length).toBeGreaterThan(0);
    for (const ruta of lectores) expect(enCorreo(ruta), `${ruta} lee SMTP_CONTRASENA`).toBe(true);
  });

  it("ninguna variable pública lleva la llave ni el remitente: nada con NEXT_PUBLIC_ y RESEND, SMTP o CORREO", () => {
    for (const { ruta, texto } of archivos) {
      expect(texto, ruta).not.toMatch(/NEXT_PUBLIC_\w*(RESEND|SMTP|CORREO)/);
    }
    const ejemplo = readFileSync(join(RAIZ, ".env.example"), "utf8");
    expect(ejemplo).not.toMatch(/NEXT_PUBLIC_\w*(RESEND|SMTP|CORREO)/);
  });

  it(".env.example documenta las variables del correo sin valor", () => {
    const ejemplo = readFileSync(join(RAIZ, ".env.example"), "utf8");
    for (const nombre of ["RESEND_API_KEY", "CORREO_REMITENTE", "SITIO_URL", "SMTP_SERVIDOR", "SMTP_PUERTO", "SMTP_USUARIO", "SMTP_CONTRASENA"]) {
      expect(ejemplo, `${nombre} falta en .env.example`).toMatch(new RegExp(`^${nombre}=\\s*$`, "m"));
    }
  });

  it("el punto de entrada del servidor es solo de servidor (server-only)", () => {
    const servidor = archivos.find((a) => a.ruta === "src/lib/correo/servidor.ts");
    expect(servidor?.texto.startsWith('import "server-only";')).toBe(true);
  });

  it("ningún componente de cliente importa el módulo de correo", () => {
    const culpables = archivos.filter((a) => esDeCliente(a) && /from\s+["'](@\/lib\/correo|.*\/lib\/correo)/.test(a.texto)).map((a) => a.ruta);
    expect(culpables).toEqual([]);
  });

  it("fuera de src/lib/correo nadie importa el proveedor, el registro ni el envío: se pasa por servidor.ts", () => {
    // Quien dispare un correo importa `@/lib/correo/servidor` (que es server-only). Las piezas de abajo se quedan
    // dentro del módulo, y por eso no hace falta vigilar quién importa `servidor`.
    const importadores = archivos
      .filter((a) => !enCorreo(a.ruta) && /from\s+["']@\/lib\/correo\/(proveedor|smtp|registro|enviar)["']/.test(a.texto))
      .map((a) => a.ruta);
    expect(importadores).toEqual([]);
  });

  it("los módulos que hablan con el proveedor no importan nada del navegador ni de React", () => {
    for (const nombre of ["proveedor.ts", "smtp.ts", "registro.ts", "enviar.ts", "servidor.ts"]) {
      const { texto } = archivos.find((a) => a.ruta === `src/lib/correo/${nombre}`)!;
      expect(texto, nombre).not.toMatch(/from\s+["']react["']|["']use client["']/);
    }
  });
});
