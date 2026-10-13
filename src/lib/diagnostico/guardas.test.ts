import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// HU-009: dos guardas sobre el código de las pantallas del diagnóstico, leyendo los archivos.
//
// 1. Lo que llega al navegador no importa VALORES de `reglas.ts`, `resultado.ts`, `motor.ts` ni `mostrar.ts`: `reglas.ts` importa
//    `LETRAS` del motor y `resultado.ts` importa valores del motor, así que un import de valores arrastraría el motor entero
//    (y con él el banco de preguntas) al paquete del navegador. Solo `import type`.
// 2. Ningún texto del banco pasa por `innerHTML` ni nada parecido: se dibuja con `TextoDelBanco` (HU-083).

const RAIZ = join(__dirname, "../../..");
const ruta = (relativa: string) => join(RAIZ, relativa);

/** Lo que llega al navegador: los componentes de cliente, el resultado (que usa el mensaje de D-51) y las funciones puras que importan. */
const ARCHIVOS_DEL_NAVEGADOR = [
  "src/app/(publico)/diagnostico/Recorrido.tsx",
  "src/app/(publico)/diagnostico/SelectorDeMateria.tsx",
  "src/app/(publico)/diagnostico/Pregunta.tsx",
  "src/app/(publico)/diagnostico/SinPreguntasNuevas.tsx",
  "src/components/diagnostico/ResultadoDelDiagnostico.tsx",
  "src/lib/diagnostico/pantalla.ts",
  "src/lib/diagnostico/presentacion.ts",
  "src/lib/diagnostico/rutas.ts",
];

/** Los módulos del servidor del diagnóstico que arrastran el motor. */
const MODULOS_PESADOS = ["reglas", "resultado", "motor", "mostrar"];

/**
 * Los módulos pesados de los que `fuente` importa algo que no es `import type` (también `import { type A } from`, que algunos
 * empaquetadores conservan como import de efectos). Cubre varias líneas, porque el patrón no cruza un `;` ni una comilla.
 */
function importesDeValores(fuente: string): string[] {
  const importes = [...fuente.matchAll(/^import\s+(?!type\s)[\w$*{},\s]+?\s+from\s+["']([^"']+)["']/gm)];
  return importes.map(([, modulo]) => modulo).filter((modulo) => MODULOS_PESADOS.some((pesado) => modulo === `./${pesado}` || modulo.endsWith(`/diagnostico/${pesado}`)));
}

describe("la guarda de importaciones sabe lo que busca", () => {
  it("encuentra un import de valores", () => {
    expect(importesDeValores('import { LETRAS } from "./motor";')).toEqual(["./motor"]);
    expect(importesDeValores('import { esLetra, esUuid } from "@/lib/diagnostico/reglas";')).toEqual(["@/lib/diagnostico/reglas"]);
    expect(importesDeValores('import {\n  proyectarResultado,\n  type ResultadoParaMostrar,\n} from "@/lib/diagnostico/mostrar";')).toEqual([
      "@/lib/diagnostico/mostrar",
    ]);
    expect(importesDeValores('import * as motor from "../diagnostico/motor";')).toEqual(["../diagnostico/motor"]);
    expect(importesDeValores('import resultado from "./resultado";')).toEqual(["./resultado"]);
  });

  it("encuentra el import con todos sus nombres marcados como tipo, que no se borra en todos los empaquetadores", () => {
    expect(importesDeValores('import { type Letra } from "./motor";')).toEqual(["./motor"]);
  });

  it("deja pasar los imports de tipos y los de otros módulos", () => {
    expect(importesDeValores('import type { Letra } from "./motor";')).toEqual([]);
    expect(importesDeValores('import type {\n  EnCurso,\n  RespuestaDeIniciar,\n} from "./reglas";')).toEqual([]);
    expect(importesDeValores('import { TEXTOS } from "./presentacion";')).toEqual([]);
    expect(importesDeValores('import { rutaDeResultado } from "./rutas";')).toEqual([]);
    // Otro `reglas`: el de la lista de monitores no arrastra el motor.
    expect(importesDeValores('import { rutaDeMonitores } from "@/lib/disponibilidad/reglas";')).toEqual([]);
  });

  it("no cruza de un import de efectos al siguiente", () => {
    expect(importesDeValores('import "./estilos.css";\nimport type { Letra } from "./motor";')).toEqual([]);
  });
});

describe("lo que llega al navegador no importa valores del motor (M46)", () => {
  it("hay archivos que revisar, y existen", () => {
    expect(ARCHIVOS_DEL_NAVEGADOR.length).toBeGreaterThan(5);
    for (const archivo of ARCHIVOS_DEL_NAVEGADOR) expect(statSync(ruta(archivo)).isFile(), archivo).toBe(true);
  });

  it.each(ARCHIVOS_DEL_NAVEGADOR)("%s", (archivo) => {
    expect(importesDeValores(readFileSync(ruta(archivo), "utf8"))).toEqual([]);
  });
});

/** Los archivos de código (no de prueba) de una carpeta y sus subcarpetas. */
function codigoDe(carpeta: string): string[] {
  return readdirSync(ruta(carpeta)).flatMap((nombre) => {
    const relativa = `${carpeta}/${nombre}`;
    if (statSync(ruta(relativa)).isDirectory()) return codigoDe(relativa);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [relativa] : [];
  });
}

describe("nunca innerHTML con texto del banco", () => {
  const CARPETAS = ["src/lib/diagnostico", "src/components/diagnostico", "src/app/(publico)/diagnostico"];
  const archivos = CARPETAS.flatMap(codigoDe);

  it("hay código que revisar", () => {
    const nombres = archivos.map((archivo) => relative(RAIZ, ruta(archivo)).replaceAll("\\", "/"));
    expect(nombres).toEqual(
      expect.arrayContaining([
        "src/lib/diagnostico/servidor.ts",
        "src/lib/diagnostico/mostrar.ts",
        "src/components/diagnostico/ResultadoDelDiagnostico.tsx",
        "src/app/(publico)/diagnostico/Pregunta.tsx",
        "src/app/(publico)/diagnostico/resultado/[id]/page.tsx",
      ]),
    );
  });

  it.each(["innerHTML", "dangerouslySetInnerHTML", "outerHTML", "insertAdjacentHTML", "document.write"])("ningún archivo usa %s", (prohibido) => {
    const usan = archivos.filter((archivo) => readFileSync(ruta(archivo), "utf8").includes(prohibido));
    expect(usan).toEqual([]);
  });
});

describe("los formularios que crean un diagnóstico esperan la sesión anónima antes de enviar (HU-058, M27)", () => {
  // La guardia frena el envío si la sesión no está lista y lo reenvía sola: tiene que ir primero en `onSubmit`, antes de validar y
  // antes de llamar a la acción. Que de verdad frene y reenvíe lo prueba la e2e con Cloudflare cortado.
  it.each([
    ["src/app/(publico)/diagnostico/SelectorDeMateria.tsx", "alEmpezar(evaluacion.id)"],
    ["src/app/(publico)/diagnostico/SinPreguntasNuevas.tsx", "alVolverATomar()"],
  ])("%s", (archivo, llamada) => {
    const fuente = readFileSync(ruta(archivo), "utf8");
    const guardia = fuente.indexOf("if (sesion.alEnviar(evento)) return;");
    const previene = fuente.indexOf("evento.preventDefault();");
    const llama = fuente.indexOf(llamada);
    expect(guardia, "la guardia").toBeGreaterThan(-1);
    expect(guardia).toBeLessThan(previene);
    expect(previene).toBeLessThan(llama);
    expect(fuente).toContain("{sesion.aviso}");
    expect(fuente).toContain("sesion.verificando");
  });
});
