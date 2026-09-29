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
];

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
    const hallazgos: string[] = [];
    for (const ruta of versionables) {
      if (/\.(ico|png|jpe?g|gif|webp|woff2?|ttf)$/i.test(ruta) || ruta === "package-lock.json") continue;
      const contenido = readFileSync(join(RAIZ, ruta), "utf8");
      for (const [nombre, patron] of PATRONES_DE_SECRETO) {
        if (patron.test(contenido)) hallazgos.push(`${ruta}: ${nombre}`);
      }
    }
    expect(hallazgos).toEqual([]);
  });
});
