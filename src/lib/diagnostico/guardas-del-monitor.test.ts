import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// HU-022: dos guardas sobre el código del diagnóstico del monitor, leyendo los archivos (las mismas de HU-009 y HU-083).
//
// 1. Ningún texto del banco pasa por `innerHTML` ni nada parecido: se dibuja con `TextoDelBanco`.
// 2. Los componentes y las reglas de la vista importan de `motor.ts` y `resultado.ts` solo con `import type`: un import de valores
//    arrastraría el motor entero (y con él el banco de preguntas) al paquete del navegador, donde llega `ResultadoDelDiagnostico`
//    con «Lo eligió N veces».

const RAIZ = join(__dirname, "../../..");
const ruta = (relativa: string) => join(RAIZ, relativa);

/** El código nuevo de HU-022 que pinta o prepara lo que ve el monitor (los `.test.ts` quedan fuera). */
const ARCHIVOS_DE_LA_VISTA = [
  "src/lib/diagnostico/vista-del-monitor.ts",
  "src/components/diagnostico/DiagnosticoDelMonitor.tsx",
  "src/components/diagnostico/PreguntasDelDiagnostico.tsx",
  "src/app/monitor/agenda/[id]/page.tsx",
];

/** Lo que además llega al navegador: la vista, los componentes y el resultado de la persona, que ahora importa `textoDeVeces`. */
const ARCHIVOS_SIN_MOTOR = [...ARCHIVOS_DE_LA_VISTA.slice(0, 3), "src/components/diagnostico/ResultadoDelDiagnostico.tsx"];

const MODULOS_PESADOS = ["resultado", "motor", "mostrar", "reglas", "entrada", "servidor"];

/** Los módulos pesados de los que `fuente` importa algo que no es `import type` (también `import { type A } from`). */
function importesDeValores(fuente: string): string[] {
  const importes = [...fuente.matchAll(/^import\s+(?!type\s)[\w$*{},\s]+?\s+from\s+["']([^"']+)["']/gm)];
  return importes
    .map(([, modulo]) => modulo)
    .filter((modulo) => MODULOS_PESADOS.some((pesado) => modulo === `./${pesado}` || modulo.endsWith(`/diagnostico/${pesado}`)));
}

describe("la guarda de importaciones sabe lo que busca", () => {
  it("encuentra un import de valores del motor o del resultado", () => {
    expect(importesDeValores('import { LETRAS } from "./motor";')).toEqual(["./motor"]);
    expect(importesDeValores('import { armarResultadoGuardado } from "@/lib/diagnostico/resultado";')).toEqual(["@/lib/diagnostico/resultado"]);
    expect(importesDeValores('import { type Letra } from "./motor";')).toEqual(["./motor"]);
  });

  it("deja pasar los imports de tipos y los de otros módulos", () => {
    expect(importesDeValores('import type { Letra, NivelHabilidad } from "./motor";')).toEqual([]);
    expect(importesDeValores('import type { ResultadoGuardado } from "@/lib/diagnostico/resultado";')).toEqual([]);
    expect(importesDeValores('import { TEXTOS } from "@/lib/diagnostico/vista-del-monitor";')).toEqual([]);
    expect(importesDeValores('import { finProgramado } from "@/lib/plazos/motor";')).toEqual([]);
  });
});

describe("el código de la vista del monitor existe y no usa innerHTML ni nada parecido (M46)", () => {
  it("hay archivos que revisar, y existen", () => {
    for (const archivo of ARCHIVOS_DE_LA_VISTA) expect(statSync(ruta(archivo)).isFile(), archivo).toBe(true);
  });

  it.each(["innerHTML", "dangerouslySetInnerHTML", "outerHTML", "insertAdjacentHTML", "document.write"])("ningún archivo usa %s", (prohibido) => {
    const usan = ARCHIVOS_DE_LA_VISTA.filter((archivo) => readFileSync(ruta(archivo), "utf8").includes(prohibido));
    expect(usan).toEqual([]);
  });
});

describe("lo que pinta o prepara la vista no importa valores del motor ni del resultado guardado", () => {
  it.each(ARCHIVOS_SIN_MOTOR)("%s", (archivo) => {
    expect(importesDeValores(readFileSync(ruta(archivo), "utf8"))).toEqual([]);
  });
});

describe("los componentes pintan todo texto del banco con TextoDelBanco", () => {
  it.each(["src/components/diagnostico/DiagnosticoDelMonitor.tsx", "src/components/diagnostico/PreguntasDelDiagnostico.tsx"])("%s", (archivo) => {
    const fuente = readFileSync(ruta(archivo), "utf8");
    expect(fuente).toContain('from "@/components/contenido/TextoDelBanco"');
    expect(fuente).toContain("<TextoDelBanco");
  });
});
