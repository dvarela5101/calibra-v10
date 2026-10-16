import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..");

/** Archivos que Git versiona o versionaría: los rastreados más los nuevos que no ignora .gitignore. */
const versionables = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: RAIZ,
  encoding: "utf8",
})
  .split("\n")
  .map((ruta) => ruta.trim())
  // Un archivo rastreado pero ya borrado del árbol no entra en el próximo commit.
  .filter((ruta) => ruta && existsSync(join(RAIZ, ruta)));

const PATRONES_DE_SECRETO: [string, RegExp][] = [
  ["llave secreta de Supabase", /sb_secret_[A-Za-z0-9_-]{16,}/],
  ["llave privada PEM", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["llave de Resend", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ["token de Vercel asignado", /VERCEL_TOKEN\s*=\s*\S{8,}/],
  ["secreto de Turnstile asignado", /TURNSTILE_SECRET_KEY[ \t]*=[ \t]*\S{8,}/],
];

/** Una sola pasada por archivo: descarta los que no tienen ningún patrón antes de mirar cuál de los cinco aparece. */
const ALGUN_SECRETO = new RegExp(PATRONES_DE_SECRETO.map(([, patron]) => `(?:${patron.source})`).join("|"));

/**
 * Los archivos se leen al cargar este archivo, una vez y fuera del tiempo de la prueba: son unos 900 y 11 MB, y con el
 * equipo cargado leerlos dentro de la prueba pasaba de sus 5 s (HU-098).
 */
const hallazgosDeSecretos: string[] = versionables
  .filter((ruta) => !/\.(ico|png|jpe?g|gif|webp|woff2?|ttf)$/i.test(ruta) && ruta !== "package-lock.json")
  .flatMap((ruta) => {
    const contenido = readFileSync(join(RAIZ, ruta), "utf8");
    if (!ALGUN_SECRETO.test(contenido)) return [];
    return PATRONES_DE_SECRETO.filter(([, patron]) => patron.test(contenido)).map(([nombre]) => `${ruta}: ${nombre}`);
  });

describe("secretos fuera del repo", () => {
  it("ningún .env con valores entra al repo, solo .env.example", () => {
    const envs = versionables.filter((ruta) => /(^|\/)\.env(\.|$)/.test(ruta));
    expect(envs).toEqual([".env.example"]);
  });

  it(".env.example deja vacías las llaves de servidor", () => {
    const ejemplo = readFileSync(join(RAIZ, ".env.example"), "utf8");
    const secretas = ejemplo
      .split("\n")
      .filter((linea) => /^[A-Z_]+=/.test(linea) && !linea.startsWith("NEXT_PUBLIC_"));
    expect(secretas.length).toBeGreaterThan(0);
    for (const linea of secretas) expect(linea).toMatch(/^[A-Z_]+=\s*$/);
  });

  it("ningún archivo versionable contiene una llave secreta", () => {
    expect(hallazgosDeSecretos).toEqual([]);
  });

  it("control: la expresión combinada ve cada patrón, así que descartar con ella no deja pasar ninguno", () => {
    const ejemplos: [string, string][] = [
      ["llave secreta de Supabase", "sb_secret_" + "A".repeat(20)],
      ["llave privada PEM", "-----BEGIN " + "PRIVATE KEY-----"],
      ["llave de Resend", "re_" + "abcdefgh_" + "B".repeat(16)],
      ["token de Vercel asignado", "VERCEL_TOKEN=" + "c".repeat(12)],
      ["secreto de Turnstile asignado", "TURNSTILE_SECRET_KEY=" + "d".repeat(12)],
    ];
    expect(ejemplos.map(([nombre]) => nombre)).toEqual(PATRONES_DE_SECRETO.map(([nombre]) => nombre));
    for (const [nombre, texto] of ejemplos) {
      expect(ALGUN_SECRETO.test(texto), nombre).toBe(true);
      expect(PATRONES_DE_SECRETO.find(([n]) => n === nombre)![1].test(texto), nombre).toBe(true);
    }
    expect(ALGUN_SECRETO.test("sin nada que esconder")).toBe(false);
  });
});
