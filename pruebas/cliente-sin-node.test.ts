import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// HU-032 (revisión): lo que importa un componente de cliente viaja en el paquete que baja el navegador. Un módulo que usa
// `node:crypto` o `server-only` y llega a un componente de cliente, aunque sea por un import de una constante, mete el
// polyfill de Node en ese paquete (`avisos.ts` importaba `verificacion.ts` solo por `HORAS_DE_VIGENCIA` y el formulario de
// contacto arrastraba `crypto-browserify`, 417 KB). La prueba recorre los imports de valor de cada archivo con
// "use client" (no los `import type`, que se borran al compilar) y falla si por algún camino se llega a un módulo de Node o
// a uno marcado `server-only`.

const RAIZ = join(__dirname, "..");
const SRC = join(RAIZ, "src");
const DE_NODE = new Set(builtinModules.flatMap((nombre) => [nombre, `node:${nombre}`]));

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const leidos = new Map<string, string>();
const leer = (ruta: string) => {
  let texto = leidos.get(ruta);
  if (texto === undefined) {
    texto = readFileSync(ruta, "utf8");
    leidos.set(ruta, texto);
  }
  return texto;
};

/** Los especificadores de los imports y re-exports que quedan en el JavaScript compilado (sin los `import type`). */
function importsDeValor(codigo: string): string[] {
  const sinComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const especificadores: string[] = [];
  const declaracion = /\b(import|export)\s+(type\s+)?([^;"'()]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const [, , esDeTipo, , especificador] of sinComentarios.matchAll(declaracion)) {
    if (!esDeTipo) especificadores.push(especificador);
  }
  for (const [, especificador] of sinComentarios.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) especificadores.push(especificador);
  return especificadores;
}

function resolver(desde: string, especificador: string): string | null {
  const base = especificador.startsWith("@/")
    ? join(SRC, especificador.slice(2))
    : especificador.startsWith(".")
      ? join(desde, "..", especificador)
      : null;
  if (!base) return null;
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (statSync(candidato).isFile()) return candidato;
    } catch {
      // no es ese
    }
  }
  return null;
}

const esDeCliente = (ruta: string) => /^\s*["']use client["']/.test(leer(ruta));
/** Un archivo "use server" que importa un componente de cliente se vuelve una llamada al servidor: lo que importa no baja al navegador. */
const esAccionDelServidor = (ruta: string) => /^\s*["']use server["']/.test(leer(ruta));

/** Para cada archivo con "use client": los caminos que llegan a un módulo de Node o a uno `server-only`. */
function caminosProhibidos(): string[] {
  const hallazgos: string[] = [];
  for (const entrada of archivosDe(SRC).filter(esDeCliente)) {
    const vistos = new Set<string>([entrada]);
    const pendientes: string[][] = [[entrada]];
    while (pendientes.length) {
      const camino = pendientes.shift()!;
      const actual = camino[camino.length - 1];
      for (const especificador of importsDeValor(leer(actual))) {
        const nombre = (ruta: string) => relative(RAIZ, ruta).replaceAll("\\", "/");
        if (DE_NODE.has(especificador) || especificador === "server-only") {
          hallazgos.push(`${[...camino.map(nombre), especificador].join(" -> ")}`);
          continue;
        }
        const siguiente = resolver(actual, especificador);
        if (siguiente && !vistos.has(siguiente) && !esAccionDelServidor(siguiente)) {
          vistos.add(siguiente);
          pendientes.push([...camino, siguiente]);
        }
      }
    }
  }
  return hallazgos;
}

describe("importsDeValor", () => {
  it("cuenta los imports y re-exports de valor, y no los de tipo ni los comentados", () => {
    const codigo = `
      import { a } from "./a";
      import type { B } from "./b";
      import { type C, d } from "./c";
      import "./efecto";
      export { e } from "./e";
      export type { F } from "./f";
      // import { g } from "./g";
      /* import { h } from "./h"; */
      const x = await import("./dinamico");
    `;

    expect(importsDeValor(codigo).sort()).toEqual(["./a", "./c", "./dinamico", "./e", "./efecto"]);
  });
});

describe("los componentes de cliente no arrastran módulos de Node (HU-032)", () => {
  it("hay componentes de cliente que revisar", () => {
    expect(archivosDe(SRC).filter(esDeCliente).length).toBeGreaterThan(10);
  });

  it("ningún camino de imports desde un archivo con \"use client\" llega a node:* ni a server-only", () => {
    expect(caminosProhibidos()).toEqual([]);
  });

  it("el formulario de contacto y sus avisos no llegan a verificacion.ts, que usa node:crypto", () => {
    const formulario = join(SRC, "components", "contacto", "FormularioContacto.tsx");
    const alcanzados = new Set<string>();
    const pendientes = [formulario];
    while (pendientes.length) {
      const ruta = pendientes.pop()!;
      if (alcanzados.has(ruta)) continue;
      alcanzados.add(ruta);
      for (const especificador of importsDeValor(leer(ruta))) {
        const siguiente = resolver(ruta, especificador);
        if (siguiente && !esAccionDelServidor(siguiente)) pendientes.push(siguiente);
      }
    }
    const nombres = [...alcanzados].map((ruta) => relative(RAIZ, ruta).replaceAll("\\", "/"));

    expect(nombres).toContain("src/lib/leads/avisos.ts");
    expect(nombres).not.toContain("src/lib/leads/verificacion.ts");
  });

  it("verificacion.ts es solo del servidor: lleva import \"server-only\" y sigue exportando HORAS_DE_VIGENCIA", () => {
    const verificacion = leer(join(SRC, "lib", "leads", "verificacion.ts"));

    expect(importsDeValor(verificacion)).toContain("server-only");
    expect(verificacion).toMatch(/export\s*\{\s*HORAS_DE_VIGENCIA\s*\}\s*from\s*["']\.\/vigencia["']/);
  });
});
