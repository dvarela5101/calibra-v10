import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { leerBanco } from "../../../scripts/contenido/banco.mts";
import type { Banco } from "../../../scripts/contenido/modelo.mts";
import {
  LETRAS,
  TOPE_DIAGNOSTICO,
  calificar,
  estadosDeMisconcepciones,
  maximoDePreguntas,
  mulberry32,
  opcionDeLetra,
  opcionElegida,
  paraNavegador,
  siguientePregunta,
  type CopiaDePaso,
  type Dificultad,
  type EntradaMotor,
  type HabilidadDeEntrada,
  type Letra,
  type MisconcepcionDeEntrada,
  type OrdenDeOpciones,
  type PreguntaCandidata,
  type PreguntaElegida,
  type ResultadoDiagnostico,
} from "./motor";

// HU-060: el motor puro del diagnóstico. Las pruebas de lógica usan bancos pequeños armados aquí, con historias de
// pasos a mano (el motor no guarda estado: dada una historia, elige igual que si la hubiera armado él). El último bloque
// corre el banco real, leído con `leerBanco` como pruebas/contenido.test.ts, con las semillas 1 a 1000.
//
// Convenciones de los bancos de prueba: la opción A del banco es la correcta, y B, C y D ofrecen una misconcepción cada
// una. La clave de una misconcepción es `habilidad.nombre` y de ahí sale su habilidad ("h1.x" es de h1).

const FECHA = "2026-10-05T10:00:00.000Z";
const CORRECTA = "correcta";

function pregunta(
  clave: string,
  dificultad: Dificultad,
  habilidades: string[],
  trampas: [string, string, string] = [`${habilidades[0]}.a`, `${habilidades[0]}.b`, `${habilidades[0]}.c`],
  errores: [string | null, string | null, string | null] = [null, null, null],
): PreguntaCandidata {
  return {
    clave,
    tema: "tema",
    enunciado: `Enunciado de ${clave}`,
    opciones: [
      { texto: `${clave} correcta`, correcta: true, misconcepcion: null, error: null },
      ...trampas.map((trampa, i) => ({ texto: `${clave} ${trampa}`, correcta: false, misconcepcion: trampa, error: errores[i] })),
    ],
    dificultad,
    habilidades,
    solucion: `Solución de ${clave}`,
  };
}

function entradaDe(datos: {
  habilidades: (string | HabilidadDeEntrada)[];
  candidatas: PreguntaCandidata[];
  vistasAntes?: string[];
  semilla?: number;
  misconcepciones?: MisconcepcionDeEntrada[];
}): EntradaMotor {
  const claves = [...new Set([...datos.candidatas.flatMap((c) => c.opciones.map((o) => o.misconcepcion)), ...(datos.misconcepciones ?? []).map((m) => m.clave)])];
  return {
    habilidades: datos.habilidades.map((h) =>
      typeof h === "string" ? { clave: h, descripcion: `Habilidad ${h}`, prerrequisitos: [] } : h,
    ),
    misconcepciones:
      datos.misconcepciones ??
      claves.flatMap((clave) => (clave === null ? [] : [{ clave, habilidad: clave.split(".")[0], descripcion: `Error ${clave}` }])),
    candidatas: datos.candidatas,
    vistasAntes: datos.vistasAntes ?? [],
    semilla: datos.semilla ?? 1,
  };
}

function letraDelBanco(candidata: PreguntaCandidata, eleccion: string): Letra {
  const indice = candidata.opciones.findIndex((o) => (eleccion === CORRECTA ? o.correcta : !o.correcta && o.misconcepcion === eleccion));
  if (indice < 0) throw new Error(`${candidata.clave} no ofrece ${eleccion}`);
  return LETRAS[indice];
}

/** El paso que queda al responder `candidata` con la correcta o con la trampa de esa misconcepción. */
function pasoDe(candidata: PreguntaCandidata, eleccion: string, orden: OrdenDeOpciones = LETRAS): CopiaDePaso {
  return { ...candidata, orden, letraElegida: LETRAS[orden.indexOf(letraDelBanco(candidata, eleccion))], fecha: FECHA };
}

/** Una historia a mano: cada par es [clave de la pregunta, "correcta" o la misconcepción que eligió]. */
function historia(candidatas: PreguntaCandidata[], ...pares: [string, string][]): CopiaDePaso[] {
  return pares.map(([clave, eleccion]) => {
    const candidata = candidatas.find((c) => c.clave === clave);
    if (!candidata) throw new Error(`no hay ${clave}`);
    return pasoDe(candidata, eleccion);
  });
}

function elegidaDe(entrada: EntradaMotor, pasos: CopiaDePaso[]): PreguntaElegida {
  const siguiente = siguientePregunta(entrada, pasos);
  if ("terminado" in siguiente) throw new Error("el diagnóstico ya terminó");
  return siguiente;
}

interface Corrida {
  pasos: CopiaDePaso[];
  elegidas: PreguntaElegida[];
}

/** Corre un diagnóstico entero: `decidir` dice qué responde el estudiante ("correcta" o una misconcepción). */
function correr(entrada: EntradaMotor, decidir: (candidata: PreguntaCandidata, paso: number) => string = () => CORRECTA): Corrida {
  const porClave = new Map(entrada.candidatas.map((c) => [c.clave, c]));
  const pasos: CopiaDePaso[] = [];
  const elegidas: PreguntaElegida[] = [];
  for (;;) {
    const siguiente = siguientePregunta(entrada, pasos);
    if ("terminado" in siguiente) return { pasos, elegidas };
    const candidata = porClave.get(siguiente.clave);
    if (!candidata) throw new Error(`el motor eligió ${siguiente.clave}, que no es candidata`);
    pasos.push(pasoDe(candidata, decidir(candidata, pasos.length), siguiente.orden));
    elegidas.push(siguiente);
    if (pasos.length > TOPE_DIAGNOSTICO) throw new Error("el diagnóstico pasó del tope");
  }
}

const claves = (pasos: { clave: string }[]) => pasos.map((p) => p.clave);

/** Un decididor al azar con semilla: acierta con esa probabilidad y si no elige una trampa cualquiera. */
function alAzar(semilla: number, probabilidadDeAcierto = 0.6) {
  const azar = mulberry32(semilla);
  return (candidata: PreguntaCandidata): string => {
    if (azar() < probabilidadDeAcierto) return CORRECTA;
    const incorrectas = candidata.opciones.filter((o) => !o.correcta);
    return incorrectas[Math.floor(azar() * incorrectas.length)].misconcepcion ?? CORRECTA;
  };
}

// ---------------------------------------------------------------------------
// El banco real, leído como lo hace pruebas/contenido.test.ts
// ---------------------------------------------------------------------------

const RAIZ_CONTENIDO = join(__dirname, "../../../contenido");

function entradaDelBanco(banco: Banco, carpeta: string, evaluacion: string, borradores = false, semilla = 1, vistasAntes: string[] = []): EntradaMotor {
  const materia = banco.materias.find((m) => m.carpeta === carpeta);
  const clave = materia?.evaluaciones.find((e) => e.clave === evaluacion);
  if (!materia || !clave) throw new Error(`no encontré ${carpeta}/${evaluacion}`);
  const descripcionDe = (carpetaDeLaHabilidad: string | null, habilidad: string): string =>
    banco.materias
      .find((m) => m.carpeta === (carpetaDeLaHabilidad ?? carpeta))
      ?.temas.flatMap((t) => t.habilidades)
      .find((h) => h.clave === habilidad)?.descripcion ?? habilidad;

  const temas = materia.temas.filter((t) => clave.temas.includes(t.clave));
  const habilidades = temas.flatMap((t) =>
    t.habilidades.map((h) => ({
      clave: h.clave,
      descripcion: h.descripcion,
      prerrequisitos: h.prerrequisitos.map((p) => ({ materia: p.materia, habilidad: p.clave, descripcion: descripcionDe(p.materia, p.clave) })),
    })),
  );
  const delaEvaluacion = new Set(habilidades.map((h) => h.clave));
  const candidatas = materia.temas.flatMap((t) =>
    t.preguntas
      .filter((p) => (p.estado === "revisada" || (borradores && p.estado === "borrador")) && p.habilidades.some((h) => delaEvaluacion.has(h)))
      .map((p) => ({
        clave: p.clave,
        tema: t.clave,
        enunciado: p.enunciado,
        opciones: p.opciones.map((o) => ({ texto: o.texto, correcta: o.correcta, misconcepcion: o.misconcepcion, error: o.error })),
        dificultad: p.dificultad,
        habilidades: p.habilidades,
        solucion: p.solucion,
      })),
  );
  const misconcepciones = materia.temas.flatMap((t) => t.misconcepciones).map((m) => ({ clave: m.clave, habilidad: m.habilidad, descripcion: m.descripcion }));
  return { habilidades, misconcepciones, candidatas, vistasAntes, semilla };
}

// ---------------------------------------------------------------------------
// Azar y opciones barajadas (reglas 1 y 2)
// ---------------------------------------------------------------------------

describe("azar con semilla (regla 1)", () => {
  it("mulberry32 da los mismos números que el del prototipo", () => {
    // Valores sacados de correr mulberry32 del index.html del prototipo.
    const primeros = (semilla: number) => {
      const azar = mulberry32(semilla);
      return [azar(), azar(), azar(), azar()];
    };
    expect(primeros(1)).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741]);
    expect(primeros(20260909)).toEqual([0.18776414799503982, 0.10559688392095268, 0.9784015375189483, 0.9012860404327512]);
    expect(primeros(4294967295)).toEqual([0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677]);
  });

  // Los tres valores de oro siguientes se calcularon con mulberry32 y barajarCon del index.html del prototipo y con las
  // fórmulas de la regla 1, no con este módulo. Si cambia una constante del flujo cambian todas las preguntas y todos
  // los órdenes que HU-081 recalcula al recargar un diagnóstico en curso.
  it("el flujo del paso 0 es mulberry32(semilla + 17): un número para el desempate y luego las opciones", () => {
    const candidatas = [pregunta("Q1", 2, ["h1"])];
    const orden = (semilla: number) => elegidaDe(entradaDe({ habilidades: ["h1"], candidatas, semilla }), []).orden.join("");
    expect(orden(1)).toBe("DABC");
    expect(orden(2)).toBe("ACDB");
    expect(orden(3)).toBe("CADB");
    expect(orden(4294967295)).toBe("BDCA");
  });

  it("el flujo de cada paso suma paso × 7919: el paso 1 no repite el del paso 0", () => {
    const candidatas = [pregunta("Q1", 2, ["h1"]), pregunta("Q2", 3, ["h1"])];
    const orden = (semilla: number) =>
      elegidaDe(entradaDe({ habilidades: ["h1"], candidatas, semilla }), historia(candidatas, ["Q1", CORRECTA])).orden.join("");
    expect(orden(1)).toBe("DCAB");
    expect(orden(2)).toBe("CBAD");
    expect(orden(3)).toBe("DACB");
  });

  it("el orden de la ronda 1 es barajarCon(habilidades, 90001) del prototipo", () => {
    const habilidades = ["h1", "h2", "h3", "h4"];
    const candidatas = habilidades.map((h) => pregunta(`Q-${h}`, 3, [h])); // un acierto en 3 no deja duda: solo hay ronda 1
    const ronda1 = (semilla: number) => claves(correr(entradaDe({ habilidades, candidatas, semilla })).pasos).join(",");
    expect(ronda1(1)).toBe("Q-h3,Q-h2,Q-h1,Q-h4");
    expect(ronda1(2)).toBe("Q-h4,Q-h2,Q-h1,Q-h3");
    expect(ronda1(3)).toBe("Q-h4,Q-h1,Q-h2,Q-h3");
  });

  it("las mismas entradas dan las mismas preguntas, las mismas opciones y el mismo resultado", () => {
    const { banco } = leerBanco(RAIZ_CONTENIDO);
    for (const semilla of [1, 2, 77, 4294967295]) {
      const entrada = entradaDelBanco(banco, "fisica-2", "parcial-1", false, semilla);
      const primera = correr(entrada, alAzar(semilla));
      const segunda = correr(structuredClone(entrada), alAzar(semilla));
      expect(segunda).toEqual(primera);
      expect(calificar(structuredClone(entrada), segunda.pasos)).toEqual(calificar(entrada, primera.pasos));
    }
  });

  it("no depende del orden en que llegan las candidatas", () => {
    const { banco } = leerBanco(RAIZ_CONTENIDO);
    const entrada = entradaDelBanco(banco, "fisica-2", "parcial-1", false, 5);
    const revuelta = { ...entrada, candidatas: [...entrada.candidatas].reverse() };
    expect(correr(revuelta, alAzar(5))).toEqual(correr(entrada, alAzar(5)));
  });

  it("con el banco de Física II y todo correcto, las semillas 1 a 100 dan al menos 50 secuencias distintas", () => {
    const { banco } = leerBanco(RAIZ_CONTENIDO);
    const secuencias = new Set<string>();
    for (let semilla = 1; semilla <= 100; semilla++) {
      secuencias.add(claves(correr(entradaDelBanco(banco, "fisica-2", "parcial-1", false, semilla)).pasos).join(","));
    }
    expect(secuencias.size).toBeGreaterThanOrEqual(50);
  });

  it("rechaza una semilla que no es un entero de 32 bits sin signo", () => {
    const candidatas = [pregunta("Q1", 2, ["h1"])];
    for (const semilla of [-1, 1.5, 2 ** 32, Number.NaN]) {
      expect(() => siguientePregunta(entradaDe({ habilidades: ["h1"], candidatas, semilla }), [])).toThrow(RangeError);
    }
  });

  it("el módulo no importa nada, ni Supabase, Next o server-only, y no usa Math.random ni la hora", () => {
    const fuente = readFileSync(join(__dirname, "motor.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(fuente).not.toMatch(/^\s*import\s/m);
    expect(fuente).not.toMatch(/\brequire\(/);
    expect(fuente).not.toMatch(/Math\.random|Date\.now|new Date\(|performance\.now|process\.env/);
  });
});

describe("opciones barajadas y lo que recibe el navegador (regla 2)", () => {
  const candidata = pregunta("Q1", 2, ["h1"]);

  it("la letra que ve el estudiante es la posición y el motor la traduce a la letra del banco", () => {
    const orden: OrdenDeOpciones = ["C", "A", "D", "B"];
    expect(LETRAS.map((letra) => opcionDeLetra(orden, letra))).toEqual(["C", "A", "D", "B"]);
    const paso = pasoDe(candidata, CORRECTA, orden);
    expect(paso.letraElegida).toBe("B"); // la correcta del banco es la A y en este orden se ve segunda
    expect(opcionElegida(paso).correcta).toBe(true);
    expect(opcionElegida({ ...paso, letraElegida: "A" }).texto).toBe("Q1 h1.b"); // la C del banco
  });

  it("paraNavegador devuelve solo {enunciado, opciones: [{letra, texto}]} en el orden barajado", () => {
    const vista = paraNavegador(candidata, ["C", "A", "D", "B"]);
    expect(vista).toEqual({
      enunciado: "Enunciado de Q1",
      opciones: [
        { letra: "A", texto: "Q1 h1.b" },
        { letra: "B", texto: "Q1 correcta" },
        { letra: "C", texto: "Q1 h1.c" },
        { letra: "D", texto: "Q1 h1.a" },
      ],
    });
    expect(Object.keys(vista)).toEqual(["enunciado", "opciones"]);
    for (const opcion of vista.opciones) expect(Object.keys(opcion)).toEqual(["letra", "texto"]);
  });

  it("no arrastra la clave, la dificultad, las habilidades, la correcta, la misconcepción, el texto de error ni la solución", () => {
    const secreta: PreguntaCandidata = {
      ...pregunta("CLAVE-SECRETA", 3, ["habilidad-secreta"], ["mc-secreta.a", "mc-secreta.b", "mc-secreta.c"], ["error propio uno", "error propio dos", null]),
      tema: "tema-secreto",
      enunciado: "¿Cuánto vale?",
      solucion: "paso a paso secreto",
    };
    secreta.opciones.forEach((opcion, i) => (opcion.texto = `opción ${i}`));
    const serializada = JSON.stringify(paraNavegador(secreta, ["B", "C", "D", "A"]));
    for (const secreto of ["CLAVE-SECRETA", "habilidad-secreta", "mc-secreta", "tema-secreto", "error propio", "paso a paso", "clave", "dificultad", "habilidades", "correcta", "misconcepcion", "solucion", "error", "tema"]) {
      expect(serializada, secreto).not.toContain(secreto);
    }
  });

  it("rechaza un orden que no es una permutación de A a D", () => {
    expect(() => paraNavegador(candidata, ["A", "A", "B", "C"])).toThrow(RangeError);
    expect(() => paraNavegador(candidata, ["A", "B", "C"])).toThrow(RangeError);
    expect(() => opcionDeLetra(["A", "B", "C", "D"], "E" as Letra)).toThrow(RangeError);
  });

  it("cada pregunta mostrada trae su orden de opciones distinto entre semillas", () => {
    const candidatas = [pregunta("Q1", 2, ["h1"])];
    const ordenes = new Set<string>();
    for (let semilla = 1; semilla <= 100; semilla++) {
      ordenes.add(elegidaDe(entradaDe({ habilidades: ["h1"], candidatas, semilla }), []).orden.join(""));
    }
    expect(ordenes.size).toBe(24); // las 24 permutaciones salen en 100 semillas
  });
});

// ---------------------------------------------------------------------------
// Ronda 1 (reglas 3 y 4)
// ---------------------------------------------------------------------------

describe("ronda 1: una pregunta por habilidad (regla 4)", () => {
  const habilidades = ["h1", "h2", "h3", "h4"];
  const candidatas = habilidades.flatMap((h) => [pregunta(`${h}-a`, 2, [h]), pregunta(`${h}-b`, 2, [h]), pregunta(`${h}-c`, 3, [h])]);

  it("cada habilidad recibe una pregunta antes de que alguna reciba la segunda", () => {
    for (let semilla = 1; semilla <= 50; semilla++) {
      const { elegidas } = correr(entradaDe({ habilidades, candidatas, semilla }));
      expect(elegidas.slice(0, 4).map((e) => [e.ronda, e.habilidad])).toEqual(expect.arrayContaining(habilidades.map((h) => [1, h])));
      expect(new Set(elegidas.slice(0, 4).map((e) => e.habilidad)).size).toBe(4);
      expect(elegidas.slice(4).every((e) => e.ronda === 2)).toBe(true);
    }
  });

  it("elige la libre de dificultad más cercana a 2 y sortea entre las empatadas", () => {
    const vistas = new Set<string>();
    for (let semilla = 1; semilla <= 50; semilla++) {
      const { elegidas } = correr(entradaDe({ habilidades, candidatas, semilla }));
      for (const e of elegidas.filter((x) => x.ronda === 1)) vistas.add(e.clave);
    }
    // Nunca la de dificultad 3; las dos de dificultad 2 de cada habilidad salen en algún momento.
    expect([...vistas].sort()).toEqual(habilidades.flatMap((h) => [`${h}-a`, `${h}-b`]));
  });

  it("con una habilidad que solo tiene dificultades 1 y 3, las semillas 1 a 50 sacan las dos", () => {
    const extremas = [pregunta("x1", 1, ["h1"]), pregunta("x3", 3, ["h1"]), pregunta("y2", 2, ["h2"])];
    const primeras = new Set<string>();
    for (let semilla = 1; semilla <= 50; semilla++) {
      const { elegidas } = correr(entradaDe({ habilidades: ["h1", "h2"], candidatas: extremas, semilla }));
      primeras.add(elegidas.find((e) => e.habilidad === "h1" && e.ronda === 1)?.clave ?? "ninguna");
    }
    expect([...primeras].sort()).toEqual(["x1", "x3"]);
  });

  it("una pregunta de varias habilidades cubre a todas las suyas", () => {
    const multiple = pregunta("M", 2, ["h1", "h2"], ["h1.a", "h2.a", "h1.b"]);
    for (let semilla = 1; semilla <= 20; semilla++) {
      const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas: [multiple], semilla });
      const { pasos } = correr(entrada);
      expect(claves(pasos)).toEqual(["M"]); // la otra habilidad ya estaba cubierta y no quedan libres para la segunda
      const resultado = calificar(entrada, pasos);
      expect(resultado.habilidades.map((h) => [h.respuestas, h.aciertos])).toEqual([[1, 1], [1, 1]]);
    }
  });

  it("una habilidad sin candidatas, o sin candidatas libres, se salta y queda sin medir", () => {
    const entrada = entradaDe({
      habilidades: ["h1", "h2", "h3"],
      candidatas: [pregunta("a", 2, ["h1"]), pregunta("b", 2, ["h2"]), pregunta("c", 3, ["h2"])],
      vistasAntes: ["a"],
    });
    const { pasos } = correr(entrada);
    expect(claves(pasos).sort()).toEqual(["b", "c"]); // h1 solo tenía una, ya vista, y h3 ninguna
    const resultado = calificar(entrada, pasos);
    expect(resultado.habilidades.map((h) => [h.habilidad, h.nivel, h.faltaMaterial])).toEqual([
      ["h1", "sin_medir", ["sin_preguntas_sin_ver"]],
      ["h2", "lo_domina", []],
      ["h3", "sin_medir", ["sin_preguntas_sin_ver"]],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Ronda 2 (regla 6)
// ---------------------------------------------------------------------------

describe("ronda 2: una segunda pregunta donde hay duda (regla 6)", () => {
  /** Misma habilidad, la pregunta de la historia más una por dificultad que ofrecen otras trampas. */
  const libresSinX = [
    pregunta("L1", 1, ["h1"], ["h1.p", "h1.q", "h1.r"]),
    pregunta("L2", 2, ["h1"], ["h1.p", "h1.q", "h1.r"]),
    pregunta("L3", 3, ["h1"], ["h1.p", "h1.q", "h1.r"]),
  ];
  const origen = (dificultad: Dificultad) => pregunta("Q0", dificultad, ["h1"], ["h1.x", "h1.y", "h1.z"]);
  const segunda = (previa: PreguntaCandidata, eleccion: string, libres: PreguntaCandidata[], semilla = 1) => {
    const candidatas = [previa, ...libres];
    return elegidaDe(entradaDe({ habilidades: ["h1"], candidatas, semilla }), historia(candidatas, [previa.clave, eleccion]));
  };

  it("tras un fallo con X, si hay candidatas que la ofrecen elige una de ellas, aunque otra esté más cerca", () => {
    const ofrecenX = [pregunta("Xa", 1, ["h1"], ["h1.x", "h1.p", "h1.q"]), pregunta("Xb", 3, ["h1"], ["h1.x", "h1.p", "h1.q"])];
    const cercana = pregunta("Nx", 2, ["h1"], ["h1.p", "h1.q", "h1.r"]);
    const elegidas = new Set<string>();
    for (let semilla = 1; semilla <= 50; semilla++) {
      const siguiente = segunda(origen(2), "h1.x", [...ofrecenX, cercana], semilla);
      expect(siguiente.ronda).toBe(2);
      elegidas.add(siguiente.clave);
    }
    expect([...elegidas].sort()).toEqual(["Xa", "Xb"]); // las dos están a distancia 1 de la dificultad 2
  });

  it("entre las que ofrecen X, la de dificultad más cercana a la de la pregunta donde la eligió", () => {
    const ofrecenX = [pregunta("Xa", 1, ["h1"], ["h1.x", "h1.p", "h1.q"]), pregunta("Xb", 3, ["h1"], ["h1.x", "h1.p", "h1.q"])];
    for (let semilla = 1; semilla <= 20; semilla++) {
      expect(segunda(origen(3), "h1.x", ofrecenX, semilla).clave).toBe("Xb");
      expect(segunda(origen(1), "h1.x", ofrecenX, semilla).clave).toBe("Xa");
    }
  });

  it("si ninguna ofrece X, la más cercana a la dificultad del fallo menos 1", () => {
    for (let semilla = 1; semilla <= 20; semilla++) {
      expect(segunda(origen(3), "h1.x", libresSinX, semilla).clave).toBe("L2"); // objetivo 2
      expect(segunda(origen(2), "h1.x", libresSinX, semilla).clave).toBe("L1"); // objetivo 1
      expect(segunda(origen(1), "h1.x", libresSinX, semilla).clave).toBe("L1"); // objetivo 0: la más fácil
      expect(segunda(origen(1), "h1.x", libresSinX.slice(1), semilla).clave).toBe("L2"); // sin la 1, la 2 es la más cercana a 0
    }
  });

  it("tras un acierto en dificultad 1 o 2, la más cercana a 3", () => {
    for (let semilla = 1; semilla <= 20; semilla++) {
      expect(segunda(origen(1), CORRECTA, libresSinX, semilla).clave).toBe("L3");
      expect(segunda(origen(2), CORRECTA, libresSinX, semilla).clave).toBe("L3");
      expect(segunda(origen(2), CORRECTA, libresSinX.slice(0, 2), semilla).clave).toBe("L2"); // sin la 3, la más cercana
    }
  });

  it("tras un acierto en dificultad 3, la habilidad no recibe segunda", () => {
    const candidatas = [origen(3), ...libresSinX];
    const entrada = entradaDe({ habilidades: ["h1"], candidatas });
    expect(siguientePregunta(entrada, historia(candidatas, ["Q0", CORRECTA]))).toEqual({ terminado: true });
  });

  it("con varias dudas atiende primero las de un fallo, la más reciente primero, y luego las de un acierto", () => {
    const habilidades = ["h1", "h2", "h3", "h4"];
    const candidatas = habilidades.flatMap((h) => [pregunta(`${h}-a`, 2, [h]), pregunta(`${h}-b`, 3, [h])]);
    const entrada = (semilla: number) => entradaDe({ habilidades, candidatas, semilla });
    for (let semilla = 1; semilla <= 30; semilla++) {
      // El orden de la ronda 1 de esta semilla, para el desempate de los aciertos.
      const ordenRonda1 = correr(entrada(semilla)).elegidas.filter((e) => e.ronda === 1).map((e) => e.habilidad);
      const pasos = historia(candidatas, ["h1-a", CORRECTA], ["h2-a", "h2.a"], ["h3-a", "h3.b"], ["h4-a", CORRECTA]);
      const atendidas: string[] = [];
      for (let i = 0; i < 4; i++) {
        const siguiente = elegidaDe(entrada(semilla), pasos);
        atendidas.push(siguiente.habilidad);
        pasos.push(pasoDe(candidatas.find((c) => c.clave === siguiente.clave) as PreguntaCandidata, CORRECTA, siguiente.orden));
      }
      expect(atendidas).toEqual(["h3", "h2", ...ordenRonda1.filter((h) => h === "h1" || h === "h4")]);
      expect(siguientePregunta(entrada(semilla), pasos)).toEqual({ terminado: true });
    }
  });

  it("a una habilidad le elige como máximo 2 preguntas, aunque siga fallando", () => {
    const candidatas = [1, 2, 3, 4, 5].map((n) => pregunta(`Q${n}`, 2, ["h1"], ["h1.x", "h1.y", "h1.z"]));
    for (let semilla = 1; semilla <= 20; semilla++) {
      const { elegidas, pasos } = correr(entradaDe({ habilidades: ["h1"], candidatas, semilla }), () => "h1.x");
      expect(pasos).toHaveLength(2);
      expect(elegidas.map((e) => e.ronda)).toEqual([1, 2]);
    }
  });

  it("no hay duda si una misconcepción de la habilidad ya está confirmada, aunque tenga una sola pregunta", () => {
    // h1 tiene una sola pregunta, pero h1.x queda confirmada con una pregunta de h2 que también la ofrece. h2 no tiene
    // más libres: si h1 siguiera en duda, la única pregunta posible sería A2.
    const candidatas = [
      pregunta("A1", 2, ["h1"], ["h1.x", "h1.y", "h1.z"]),
      pregunta("A2", 3, ["h1"], ["h1.x", "h1.y", "h1.z"]),
      pregunta("B1", 2, ["h2"], ["h1.x", "h2.a", "h2.b"]),
    ];
    const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas });
    const confirmada = historia(candidatas, ["A1", "h1.x"], ["B1", "h1.x"]);
    expect(estadosDeMisconcepciones(confirmada).get("h1.x")?.estado).toBe("confirmada");
    expect(siguientePregunta(entrada, confirmada)).toEqual({ terminado: true });
    // El contraste: si h1.x solo se eligió una vez (B1 con otra trampa), h1 sigue en duda y recibe A2.
    const sospecha = historia(candidatas, ["A1", "h1.x"], ["B1", "h2.a"]);
    expect(elegidaDe(entrada, sospecha)).toMatchObject({ clave: "A2", habilidad: "h1", ronda: 2 });
  });
});

describe("la duda cuenta respuestas que le acreditó la regla 8, no preguntas que la miden (regla 5)", () => {
  // M1 y M2 miden h1 y h2 y ofrecen la trampa h1.x, de h1: elegirla se acredita solo a h1. P mide solo h2.
  const m1 = pregunta("M1", 2, ["h1", "h2"], ["h1.x", "h1.y", "h1.z"]);
  const m2 = pregunta("M2", 2, ["h1", "h2"], ["h1.x", "h1.y", "h1.z"]);
  const propia = pregunta("P", 2, ["h2"], ["h2.a", "h2.b", "h2.c"]);

  it("una habilidad cubierta por dos preguntas que se acreditaron a otra recibe la suya, con cualquier orden de la ronda 1", () => {
    for (let semilla = 1; semilla <= 50; semilla++) {
      const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas: [m1, m2, propia], semilla });
      const { pasos } = correr(entrada, (candidata) => (candidata.clave === "P" ? CORRECTA : "h1.x"));
      expect(claves(pasos).sort(), `semilla ${semilla}`).toEqual(["M1", "M2", "P"]);
      const [h1, h2] = calificar(entrada, pasos).habilidades;
      expect(h1, `semilla ${semilla}`).toMatchObject({ nivel: "no_lo_domina", respuestas: 2 });
      // h2 tiene la respuesta de P, y ya no le queda ninguna libre para la segunda: es falta de material, no un hueco del motor.
      expect(h2, `semilla ${semilla}`).toMatchObject({ nivel: "en_proceso", respuestas: 1, aciertos: 1, faltaMaterial: ["sin_preguntas_sin_ver"] });
    }
  });

  it("a la habilidad sin respuesta propia le elige la pregunta que le cuenta pase lo que pase, aunque otra ofrezca la trampa", () => {
    const vistos = new Set<string>();
    const dificil = pregunta("P", 3, ["h2"], ["h2.a", "h2.b", "h2.c"]); // en dificultad 3 la ronda 1 empieza siempre por M1 o M2
    for (let semilla = 1; semilla <= 50; semilla++) {
      const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas: [m1, m2, dificil], semilla });
      const primera = elegidaDe(entrada, []);
      const siguiente = elegidaDe(entrada, historia([m1, m2], [primera.clave, "h1.x"]));
      // Si h2 iba primero en la ronda 1, M1 o M2 salió para ella: h2 no recibió respuesta y, con h1, empata en fallo
      // más reciente; gana h2 por el orden de la ronda 1 y su pregunta es P, no la M que ofrece h1.x.
      if (primera.habilidad === "h2") {
        expect(siguiente, `semilla ${semilla}`).toMatchObject({ clave: "P", habilidad: "h2", ronda: 2 });
        vistos.add("h2 primero");
      } else {
        expect(siguiente, `semilla ${semilla}`).toMatchObject({ habilidad: "h1", ronda: 2 });
        expect(["M1", "M2"].filter((c) => c !== primera.clave)).toContain(siguiente.clave);
        vistos.add("h1 primero");
      }
    }
    expect([...vistos].sort()).toEqual(["h1 primero", "h2 primero"]); // las semillas 1 a 50 prueban los dos órdenes
  });

  it("si todas las libres de la habilidad se acreditan a otra, se le eligen 2 y queda sin medir y marcada, con libres sin hacer", () => {
    // Cinco preguntas que miden h1 y h2 y ofrecen h1.x: ninguna le cuenta a h2 si el estudiante siempre elige h1.x.
    const todas = [1, 2, 3, 4, 5].map((n) => pregunta(`M${n}`, 2, ["h1", "h2"], ["h1.x", "h1.y", "h1.z"]));
    for (let semilla = 1; semilla <= 30; semilla++) {
      const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas: todas, semilla });
      const { pasos, elegidas } = correr(entrada, () => "h1.x");
      expect(elegidas.filter((e) => e.habilidad === "h2").length, `semilla ${semilla}`).toBeLessThanOrEqual(2);
      expect(elegidas.filter((e) => e.habilidad === "h1").length, `semilla ${semilla}`).toBeLessThanOrEqual(2);
      expect(pasos.length, `semilla ${semilla}`).toBeLessThan(todas.length); // quedan libres sin hacer
      const [, h2] = calificar(entrada, pasos).habilidades;
      expect(h2, `semilla ${semilla}`).toMatchObject({ nivel: "sin_medir", respuestas: 0, faltaMaterial: ["sin_preguntas_sin_ver"] });
    }
  });

  it("sin respuesta propia, la pregunta se elige mirando la última que la cubrió, no la primera", () => {
    // M1 (dificultad 1) y M2 (dificultad 3) miden h1 y h2 y se acreditan a h1 con trampas distintas, x e y. De las libres de
    // h2, Lx ofrece x y Ly ofrece y, las dos de varias habilidades: la última pregunta fue M2, así que sigue Ly.
    const m1 = pregunta("M1", 1, ["h1", "h2"], ["h1.x", "h1.p", "h1.q"]);
    const m2 = pregunta("M2", 3, ["h1", "h2"], ["h1.y", "h1.r", "h1.s"]);
    const lx = pregunta("Lx", 2, ["h1", "h2"], ["h1.x", "h1.t", "h1.u"]);
    const ly = pregunta("Ly", 2, ["h1", "h2"], ["h1.y", "h1.v", "h1.w"]);
    const candidatas = [m1, m2, lx, ly];
    let elegidas = 0;
    for (let semilla = 1; semilla <= 30; semilla++) {
      const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas, semilla });
      const siguiente = siguientePregunta(entrada, historia(candidatas, ["M1", "h1.x"], ["M2", "h1.y"]));
      // Si h2 iba antes que h1 en la ronda 1, los dos pasos se le atribuyen y no le queda ninguna: el tope de 2 la deja ahí.
      if ("terminado" in siguiente) continue;
      elegidas += 1;
      expect(siguiente, `semilla ${semilla}`).toMatchObject({ clave: "Ly", habilidad: "h2", ronda: 2 });
    }
    expect(elegidas).toBeGreaterThan(0);
  });

  it("la preferencia por las preguntas que le cuentan es solo de la habilidad sin respuesta propia", () => {
    // h1 falló A1 con h1.x: tiene respuesta propia. U ofrece h1.x pero tiene otra trampa de h2, que también mide, así que no
    // le cuenta siempre; S le cuenta siempre y está más cerca de la dificultad de A1. Gana U porque ofrece h1.x.
    const a1 = pregunta("A1", 2, ["h1"], ["h1.x", "h1.a", "h1.b"]);
    const b1 = pregunta("B1", 2, ["h2"]);
    const u = pregunta("U", 3, ["h1", "h2"], ["h1.x", "h2.y", "h2.z"]);
    const s = pregunta("S", 2, ["h1"], ["h1.p", "h1.q", "h1.r"]);
    const candidatas = [a1, b1, u, s];
    for (let semilla = 1; semilla <= 20; semilla++) {
      const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas, semilla });
      expect(elegidaDe(entrada, historia(candidatas, ["A1", "h1.x"], ["B1", CORRECTA])), `semilla ${semilla}`).toMatchObject({ clave: "U", habilidad: "h1" });
    }
  });

  it("con el tope de 2 elegidas y una respuesta propia que no cierra la duda, la habilidad queda en proceso sin marca y con libres", () => {
    // M1 (dificultad 2) mide h1 y h2 y se acredita a h1. Para h2, P1 y P2 (dificultad 1) son de ella sola. Si h2 iba primero
    // en la ronda 1, M1 y P1 son sus 2 elegidas: P1 acertada en dificultad 1 deja duda, pero P2 ya no se le elige.
    const m1 = pregunta("M1", 2, ["h1", "h2"], ["h1.x", "h1.y", "h1.z"]);
    const p1 = pregunta("P1", 1, ["h2"], ["h2.a", "h2.b", "h2.c"]);
    const p2 = pregunta("P2", 1, ["h2"], ["h2.a", "h2.b", "h2.c"]);
    const candidatas = [m1, p1, p2];
    const casos = new Set<string>();
    for (let semilla = 1; semilla <= 30; semilla++) {
      const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas, semilla });
      const { pasos, elegidas } = correr(entrada, (candidata) => (candidata.clave === "M1" ? "h1.x" : CORRECTA));
      const [, h2] = calificar(entrada, pasos).habilidades;
      if (elegidas[0].habilidad === "h2") {
        expect(pasos, `semilla ${semilla}`).toHaveLength(2);
        expect(h2, `semilla ${semilla}`).toMatchObject({ nivel: "en_proceso", respuestas: 1, aciertos: 1, faltaMaterial: [] });
        casos.add("tope");
      } else {
        expect(pasos, `semilla ${semilla}`).toHaveLength(3);
        expect(h2, `semilla ${semilla}`).toMatchObject({ nivel: "lo_domina", respuestas: 2, faltaMaterial: [] });
        casos.add("sin tope");
      }
    }
    expect([...casos].sort()).toEqual(["sin tope", "tope"]);
  });

  it("una habilidad con una respuesta propia y otra pregunta acreditada a otra sigue en duda y recibe su segunda", () => {
    // h1 falla A1 con h1.x (su respuesta) y luego M, de h1 y h2, se acredita a h2 (eligió h2.y): h1 tiene 2 preguntas y 1 respuesta.
    const a1 = pregunta("A1", 2, ["h1"], ["h1.x", "h1.y", "h1.z"]);
    const a2 = pregunta("A2", 2, ["h1"], ["h1.x", "h1.y", "h1.z"]);
    const m = pregunta("M", 2, ["h1", "h2"], ["h2.y", "h2.z", "h2.w"]);
    const candidatas = [a1, a2, m];
    for (let semilla = 1; semilla <= 20; semilla++) {
      const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas, semilla });
      const pasos = historia(candidatas, ["A1", "h1.x"], ["M", "h2.y"]);
      expect(calificar(entrada, pasos).habilidades[0], `semilla ${semilla}`).toMatchObject({ respuestas: 1, nivel: "en_proceso" });
      expect(elegidaDe(entrada, pasos), `semilla ${semilla}`).toMatchObject({ clave: "A2", habilidad: "h1", ronda: 2 });
    }
  });

  it("el tope de 20 sobre una habilidad con una respuesta propia y otra pregunta acreditada a otra la marca tope_una_respuesta", () => {
    // h1: A1 falla con h1.x (su única respuesta) y M se acredita a h2; A2 sigue libre. Los otros 18 pasos son habilidades
    // de una pregunta en dificultad 3, que se resuelven solas, así que el paso 20 llega con h1 todavía en duda.
    const rellenos = Array.from({ length: TOPE_DIAGNOSTICO - 2 }, (_, i) => pregunta(`F${i + 1}`, 3, [`f${i + 1}`]));
    const a1 = pregunta("A1", 2, ["h1"], ["h1.x", "h1.y", "h1.z"]);
    const a2 = pregunta("A2", 2, ["h1"], ["h1.x", "h1.y", "h1.z"]);
    const m = pregunta("M", 2, ["h1", "h2"], ["h2.y", "h2.z", "h2.w"]);
    const candidatas = [a1, a2, m, ...rellenos];
    const entrada = entradaDe({ habilidades: ["h1", "h2", ...rellenos.map((_, i) => `f${i + 1}`)], candidatas });
    const pasos = historia(candidatas, ["A1", "h1.x"], ["M", "h2.y"], ...rellenos.map((r): [string, string] => [r.clave, CORRECTA]));
    expect(pasos).toHaveLength(TOPE_DIAGNOSTICO);
    expect(siguientePregunta(entrada, pasos)).toEqual({ terminado: true });
    const [h1, h2] = calificar(entrada, pasos).habilidades;
    expect(h1).toMatchObject({ nivel: "en_proceso", respuestas: 1, faltaMaterial: ["tope_una_respuesta"] });
    expect(h2.faltaMaterial).toEqual(["sin_preguntas_sin_ver"]); // M era la única que la medía
    // Un paso antes el tope no ha cortado nada: la habilidad sigue en duda y es la marca la que sale vacía.
    expect(calificar(entrada, pasos.slice(0, -1)).habilidades[0].faltaMaterial).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fin del diagnóstico y repetición (reglas 3 y 7, D-49, D-51)
// ---------------------------------------------------------------------------

describe("fin del diagnóstico (regla 7)", () => {
  it("termina cuando no queda habilidad por cubrir ni con duda atendible", () => {
    const candidatas = [pregunta("a", 3, ["h1"]), pregunta("b", 3, ["h2"])];
    const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas });
    expect(correr(entrada).pasos).toHaveLength(2); // dos aciertos en dificultad 3: nada queda en duda
  });

  it("termina al mostrar 20 preguntas aunque quede duda", () => {
    const habilidades = Array.from({ length: 22 }, (_, i) => `h${i + 1}`);
    const candidatas = habilidades.flatMap((h) => [pregunta(`${h}-a`, 2, [h]), pregunta(`${h}-b`, 3, [h])]);
    const entrada = entradaDe({ habilidades, candidatas });
    const { pasos, elegidas } = correr(entrada);
    expect(pasos).toHaveLength(TOPE_DIAGNOSTICO);
    expect(elegidas.every((e) => e.ronda === 1)).toBe(true); // la ronda 1 se come los 20
    expect(siguientePregunta(entrada, pasos)).toEqual({ terminado: true });
  });

  it("el máximo que se informa es el menor entre 20, el doble de las habilidades y las candidatas", () => {
    const una = (h: string, n: number) => Array.from({ length: n }, (_, i) => pregunta(`${h}-${i}`, 2, [h]));
    expect(maximoDePreguntas(entradaDe({ habilidades: ["h1", "h2"], candidatas: [...una("h1", 5), ...una("h2", 5)] }))).toBe(4);
    expect(maximoDePreguntas(entradaDe({ habilidades: ["h1", "h2"], candidatas: [...una("h1", 1), ...una("h2", 2)] }))).toBe(3);
    const muchas = Array.from({ length: 15 }, (_, i) => `g${i}`);
    expect(maximoDePreguntas(entradaDe({ habilidades: muchas, candidatas: muchas.flatMap((h) => una(h, 3)) }))).toBe(20);
    // Una habilidad sin candidatas no suma al doble.
    expect(maximoDePreguntas(entradaDe({ habilidades: ["h1", "h2", "h3"], candidatas: [...una("h1", 4), ...una("h2", 4)] }))).toBe(4);
  });

  it("las candidatas que no miden ninguna habilidad de la Evaluación no cuentan en el máximo", () => {
    const dentro = [pregunta("a", 2, ["h1"]), pregunta("b", 2, ["h2"])];
    const fuera = ["x", "y", "z"].map((clave) => pregunta(clave, 2, ["otra"]));
    expect(maximoDePreguntas(entradaDe({ habilidades: ["h1", "h2"], candidatas: [...dentro, ...fuera] }))).toBe(2);
  });

  it("el máximo cuenta solo las libres: con las vistas antes no promete preguntas que no tiene", () => {
    const candidatas = [pregunta("a", 2, ["h1"]), pregunta("b", 2, ["h1"]), pregunta("c", 2, ["h2"]), pregunta("d", 2, ["h2"])];
    expect(maximoDePreguntas(entradaDe({ habilidades: ["h1", "h2"], candidatas }))).toBe(4);
    expect(maximoDePreguntas(entradaDe({ habilidades: ["h1", "h2"], candidatas, vistasAntes: ["a", "c"] }))).toBe(2);
    expect(maximoDePreguntas(entradaDe({ habilidades: ["h1", "h2"], candidatas, vistasAntes: ["a", "b", "c"] }))).toBe(1);
  });
});

describe("nunca se repite una pregunta (D-49 a) y volver a tomarlo (D-51)", () => {
  // El caso de Física II e IP cuando se escribió HU-060, armado en línea para que no dependa del contenido vivo: 4
  // habilidades con 3 preguntas cada una, de dificultades 2, 2 y 3.
  const habilidades = ["h1", "h2", "h3", "h4"];
  const candidatas = habilidades.flatMap((h) => [pregunta(`${h}-a`, 2, [h]), pregunta(`${h}-b`, 2, [h]), pregunta(`${h}-c`, 3, [h])]);
  const banco = (semilla: number, vistasAntes: string[]) => entradaDe({ habilidades, candidatas, semilla, vistasAntes });

  it("el primer diagnóstico tiene 8 preguntas, el segundo 4 no vistas y el tercero ninguna", () => {
    for (let semilla = 1; semilla <= 30; semilla++) {
      const primero = correr(banco(semilla, []), alAzar(semilla));
      expect(primero.pasos).toHaveLength(8);

      const segundo = correr(banco(semilla, claves(primero.pasos)), alAzar(semilla));
      expect(segundo.pasos).toHaveLength(4);
      expect(claves(segundo.pasos).filter((c) => claves(primero.pasos).includes(c))).toEqual([]);

      const vistas = [...claves(primero.pasos), ...claves(segundo.pasos)];
      const tercero = banco(semilla, vistas);
      expect(correr(tercero).pasos).toHaveLength(0);
      const resultado = calificar(tercero, []);
      expect(resultado.habilidades.map((h) => [h.nivel, h.faltaMaterial])).toEqual(Array(4).fill(["sin_medir", ["sin_preguntas_sin_ver"]]));
    }
  });

  it("el segundo diagnóstico deja cada habilidad con las respuestas que tiene y marcada como sin preguntas sin ver", () => {
    const primero = correr(banco(3, []));
    const segundo = banco(3, claves(primero.pasos));
    const resultado = calificar(segundo, correr(segundo).pasos);
    expect(resultado.habilidades.map((h) => [h.respuestas, h.nivel, h.faltaMaterial])).toEqual(
      Array(4).fill([1, "en_proceso", ["sin_preguntas_sin_ver"]]),
    );
  });

  it("al volver a tomarlo (D-51) con las vistas vacías el motor vuelve a preguntar, repite preguntas y no marca nada", () => {
    for (const semilla of [1, 9, 100]) {
      const primero = correr(banco(semilla, []));
      // Con el diagnóstico anterior terminado y todas sus preguntas vistas, el motor ya no tiene nada que preguntar...
      const agotado = banco(semilla, claves(primero.pasos));
      expect(correr(agotado).pasos.length).toBeLessThan(primero.pasos.length);
      // ...pero HU-081 le pasa la lista vacía: sin pasos ni estado guardado, vuelve a empezar por la misma pregunta.
      expect(siguientePregunta(banco(semilla, []), [])).toEqual(primero.elegidas[0]);
      const otraSemilla = correr(banco(semilla + 1000, []));
      expect(otraSemilla.pasos).toHaveLength(8);
      // 8 + 8 preguntas de un banco de 12: al menos 4 se repiten, y eso es lo que permite D-51.
      expect(claves(otraSemilla.pasos).filter((c) => claves(primero.pasos).includes(c)).length).toBeGreaterThanOrEqual(4);
      expect(calificar(banco(semilla + 1000, []), otraSemilla.pasos).habilidades.every((h) => h.faltaMaterial.length === 0)).toBe(true);
    }
  });

  it("con el banco real, ninguna pregunta de las vistas antes sale nunca, con vistas al azar y respuestas al azar", () => {
    const { banco: bancoReal } = leerBanco(RAIZ_CONTENIDO);
    const entradaBase = entradaDelBanco(bancoReal, "fisica-2", "parcial-1", false, 1, []);
    for (let semilla = 1; semilla <= 200; semilla++) {
      const azar = mulberry32(semilla * 13);
      const vistas = entradaBase.candidatas.filter(() => azar() < 0.4).map((c) => c.clave);
      const { pasos } = correr({ ...entradaBase, vistasAntes: vistas, semilla }, alAzar(semilla));
      expect(claves(pasos).filter((c) => vistas.includes(c))).toEqual([]);
      expect(new Set(claves(pasos)).size).toBe(pasos.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Crédito, estados y nivel (reglas 8, 9 y 10)
// ---------------------------------------------------------------------------

describe("crédito de cada respuesta (regla 8)", () => {
  // M mide h1 y h2. Ofrece una trampa de h1, una de h2 y una de h3, que M no mide.
  const multiple = pregunta("M", 2, ["h1", "h2"], ["h1.x", "h2.y", "h3.z"]);
  const entrada = entradaDe({ habilidades: ["h1", "h2", "h3"], candidatas: [multiple] });
  const cuentas = (eleccion: string) =>
    calificar(entrada, [pasoDe(multiple, eleccion)]).habilidades.map((h) => [h.habilidad, h.respuestas, h.aciertos]);

  it("si acierta, h1 y h2 suman un acierto", () => {
    expect(cuentas(CORRECTA)).toEqual([["h1", 1, 1], ["h2", 1, 1], ["h3", 0, 0]]);
  });

  it("si elige una trampa con una misconcepción de h1, h1 suma un fallo y h2 no cuenta la respuesta", () => {
    expect(cuentas("h1.x")).toEqual([["h1", 1, 0], ["h2", 0, 0], ["h3", 0, 0]]);
    expect(cuentas("h2.y")).toEqual([["h1", 0, 0], ["h2", 1, 0], ["h3", 0, 0]]);
  });

  it("si elige una trampa con una misconcepción de una habilidad que la pregunta no mide, h1 y h2 suman un fallo", () => {
    expect(cuentas("h3.z")).toEqual([["h1", 1, 0], ["h2", 1, 0], ["h3", 0, 0]]);
  });

  it("una pregunta que repite una habilidad en su lista cuenta una sola respuesta", () => {
    const repetida = pregunta("R", 2, ["h1", "h1"], ["h1.a", "h1.b", "h1.c"]);
    const unica = entradaDe({ habilidades: ["h1"], candidatas: [repetida] });
    expect(calificar(unica, [pasoDe(repetida, CORRECTA)]).habilidades[0]).toMatchObject({ respuestas: 1, aciertos: 1 });
  });

  it("la habilidad que no cuenta la respuesta sigue cubierta por la pregunta y se le pregunta aparte si hay duda", () => {
    const propia = pregunta("P", 2, ["h2"], ["h2.y", "h2.p", "h2.q"]);
    const candidatas = [multiple, propia];
    const pasos = [pasoDe(multiple, "h1.x")];
    expect(elegidaDe(entradaDe({ habilidades: ["h1", "h2"], candidatas }), pasos)).toMatchObject({ clave: "P", habilidad: "h2", ronda: 2 });
  });

  it("una habilidad que no es de la Evaluación no recibe nivel, y su misconcepción confirmada igual sale en los errores", () => {
    const mide = pregunta("F", 2, ["h1", "fuera"], ["fuera.w", "fuera.v", "h1.q"]);
    const entradaFuera = entradaDe({ habilidades: ["h1"], candidatas: [mide] });
    const pasos = [pasoDe(mide, "fuera.w"), pasoDe({ ...mide, clave: "F2" }, "fuera.w")];
    const resultado = calificar(entradaFuera, pasos);
    // La pregunta mide fuera: el fallo es solo para fuera y h1 no cuenta ninguna respuesta.
    expect(resultado.habilidades).toHaveLength(1);
    expect(resultado.habilidades[0]).toMatchObject({ habilidad: "h1", nivel: "sin_medir", respuestas: 0 });
    expect(resultado.errores).toEqual([{ misconcepcion: "fuera.w", habilidad: "fuera", texto: "Error fuera.w", estado: "confirmada", veces: 2, detalles: [] }]);
  });
});

describe("estados de una misconcepción: paridad con evidenciaKc del prototipo (regla 9)", () => {
  // Cada pregunta: [lo que ofrecen B, C y D, lo que elige]. Los resultados salen de correr evidenciaKc del index.html del
  // prototipo con las mismas secuencias (estado, veces, sondeos).
  type Secuencia = [[string, string, string], "A" | "B" | "C" | "D"][];
  const estadosDe = (secuencia: Secuencia) => {
    const candidatas = secuencia.map(([trampas], i) => pregunta(`Q${i}`, 2, ["h1"], trampas));
    const pasos = secuencia.map(([, letra], i) => ({ ...pasoDe(candidatas[i], CORRECTA), letraElegida: letra }));
    return Object.fromEntries([...estadosDeMisconcepciones(pasos)].map(([clave, e]) => [clave, [e.estado, e.veces, e.sondeos]]));
  };
  const XWZ: [string, string, string] = ["X", "W", "Z"];

  it("elige X y luego otra vez X: X confirmada", () => {
    expect(estadosDe([[XWZ, "B"], [XWZ, "B"]])).toEqual({ X: ["confirmada", 2, 0] });
  });

  it("elige X y luego acierta una que ofrece X: X descartada", () => {
    expect(estadosDe([[XWZ, "B"], [XWZ, "A"]])).toEqual({ X: ["descartada", 1, 1] });
  });

  it("elige X y luego, en una que ofrece X, elige otra trampa W: X y W en sospecha", () => {
    expect(estadosDe([[XWZ, "B"], [XWZ, "C"]])).toEqual({ X: ["sospecha", 1, 1], W: ["sospecha", 1, 0] });
  });

  it("elige X, luego W en una que ofrece X, luego acierta otra que ofrece X y no W: X descartada y W en sospecha", () => {
    expect(estadosDe([[["X", "U", "Z"], "B"], [XWZ, "C"], [["X", "U", "Z"], "A"]])).toEqual({
      X: ["descartada", 1, 2],
      W: ["sospecha", 1, 0],
    });
  });

  it("elige X, acierta una que ofrece X y luego elige X: X confirmada", () => {
    expect(estadosDe([[XWZ, "B"], [XWZ, "A"], [XWZ, "B"]])).toEqual({ X: ["confirmada", 2, 1] });
  });

  it("una confirmada no cambia aunque después acierte una que la ofrece", () => {
    expect(estadosDe([[XWZ, "B"], [XWZ, "B"], [XWZ, "A"]])).toEqual({ X: ["confirmada", 2, 0] });
  });

  it("una trampa ofrecida en dos opciones de la misma pregunta sondea una sola vez", () => {
    expect(estadosDe([[XWZ, "B"], [["X", "X", "Z"], "A"]])).toEqual({ X: ["descartada", 1, 1] });
  });

  it("una trampa ofrecida en dos opciones sondea una sola vez también cuando no se acierta", () => {
    expect(estadosDe([[XWZ, "B"], [["X", "X", "Z"], "D"]])).toEqual({ X: ["sospecha", 1, 1], Z: ["sospecha", 1, 0] });
  });

  it("el estado no depende del orden en que se vieron las opciones", () => {
    const candidata = pregunta("Q", 2, ["h1"], ["X", "W", "Z"]);
    for (const orden of [["A", "B", "C", "D"], ["D", "C", "B", "A"], ["B", "D", "A", "C"]] as Letra[][]) {
      const pasos = [pasoDe(candidata, "X", orden), pasoDe({ ...candidata, clave: "Q2" }, "X", orden)];
      expect(estadosDeMisconcepciones(pasos).get("X")).toMatchObject({ estado: "confirmada", veces: 2 });
    }
  });
});

describe("nivel por habilidad (regla 10)", () => {
  const q1 = pregunta("Q1", 1, ["h1"]);
  const q2 = pregunta("Q2", 2, ["h1"]);
  const q3 = pregunta("Q3", 3, ["h1"]);
  const entrada = entradaDe({ habilidades: ["h1"], candidatas: [q1, q2, q3] });
  const nivel = (...pasos: CopiaDePaso[]) => {
    const h = calificar(entrada, pasos).habilidades[0];
    return [h.nivel, h.respuestas, h.aciertos];
  };

  it("sin respuestas: sin medir", () => {
    expect(nivel()).toEqual(["sin_medir", 0, 0]);
  });

  it("un acierto en dificultad 3 o dos aciertos: lo domina", () => {
    expect(nivel(pasoDe(q3, CORRECTA))).toEqual(["lo_domina", 1, 1]);
    expect(nivel(pasoDe(q1, CORRECTA), pasoDe(q2, CORRECTA))).toEqual(["lo_domina", 2, 2]);
    expect(nivel(pasoDe(q1, CORRECTA), pasoDe(q2, CORRECTA), pasoDe(q3, CORRECTA))).toEqual(["lo_domina", 3, 3]);
  });

  it("un acierto y un fallo: en proceso", () => {
    expect(nivel(pasoDe(q1, CORRECTA), pasoDe(q2, "h1.a"))).toEqual(["en_proceso", 2, 1]);
    expect(nivel(pasoDe(q1, "h1.a"), pasoDe(q2, CORRECTA), pasoDe(q3, CORRECTA))).toEqual(["en_proceso", 3, 2]);
  });

  it("dos fallos: no lo domina", () => {
    expect(nivel(pasoDe(q1, "h1.a"), pasoDe(q2, "h1.b"))).toEqual(["no_lo_domina", 2, 0]);
  });

  it("una sola respuesta que no es un acierto en dificultad 3: en proceso (D-49 b)", () => {
    expect(nivel(pasoDe(q1, CORRECTA))).toEqual(["en_proceso", 1, 1]);
    expect(nivel(pasoDe(q2, CORRECTA))).toEqual(["en_proceso", 1, 1]);
    expect(nivel(pasoDe(q3, "h1.a"))).toEqual(["en_proceso", 1, 0]);
    expect(nivel(pasoDe(q1, "h1.a"))).toEqual(["en_proceso", 1, 0]);
  });

  it("una misconcepción suya confirmada: no lo domina, aunque tenga aciertos", () => {
    expect(nivel(pasoDe(q1, CORRECTA), pasoDe(q2, "h1.a"), pasoDe(q3, "h1.a"))).toEqual(["no_lo_domina", 3, 1]);
  });

  it("una misconcepción suya confirmada: no lo domina, aunque la regla 8 no le cuente ninguna respuesta", () => {
    // Dos preguntas de h2 ofrecen h1.x y la elige las dos veces: h1 no cuenta nada y aun así queda sin dominar.
    const deH2 = [pregunta("R1", 2, ["h2"], ["h1.x", "h2.a", "h2.b"]), pregunta("R2", 2, ["h2"], ["h1.x", "h2.a", "h2.b"])];
    const dos = entradaDe({ habilidades: ["h1", "h2"], candidatas: deH2 });
    const resultado = calificar(dos, historia(deH2, ["R1", "h1.x"], ["R2", "h1.x"]));
    expect(resultado.habilidades.map((h) => [h.habilidad, h.nivel, h.respuestas])).toEqual([
      ["h1", "no_lo_domina", 0],
      ["h2", "no_lo_domina", 2],
    ]);
  });

  it("una misconcepción en sospecha o descartada no baja el nivel", () => {
    expect(nivel(pasoDe(q1, "h1.a"), pasoDe(q2, CORRECTA))).toEqual(["en_proceso", 2, 1]); // h1.a en sospecha
    expect(nivel(pasoDe(q1, "h1.a"), pasoDe(q2, CORRECTA), pasoDe(q3, CORRECTA))).toEqual(["en_proceso", 3, 2]); // h1.a descartada
  });
});

// ---------------------------------------------------------------------------
// Resultado (regla 11) y falta de material (regla 12)
// ---------------------------------------------------------------------------

describe("resultado del diagnóstico (regla 11)", () => {
  it("5 aciertos de 8 respondidas dan puntaje 62.5, y una pregunta de varias habilidades cuenta una vez", () => {
    const candidatas = Array.from({ length: 8 }, (_, i) => pregunta(`Q${i}`, 2, i < 3 ? ["h1", "h2"] : ["h1"]));
    const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas });
    const pasos = historia(candidatas, ...candidatas.map((c, i): [string, string] => [c.clave, i < 5 ? CORRECTA : "h1.a"]));
    const resultado = calificar(entrada, pasos);
    expect(resultado.puntaje).toBe(62.5);
    // Q0 a Q2 miden las dos habilidades y no se cuentan dos veces en el puntaje.
    expect(resultado.habilidades.map((h) => h.respuestas)).toEqual([8, 3]);
  });

  it("redondea a dos decimales y sin pasos da 0", () => {
    const candidatas = [pregunta("a", 2, ["h1"]), pregunta("b", 2, ["h1"]), pregunta("c", 2, ["h1"])];
    const entrada = entradaDe({ habilidades: ["h1"], candidatas });
    expect(calificar(entrada, historia(candidatas, ["a", CORRECTA], ["b", "h1.a"], ["c", "h1.a"])).puntaje).toBe(33.33);
    expect(calificar(entrada, historia(candidatas, ["a", CORRECTA], ["b", CORRECTA], ["c", "h1.a"])).puntaje).toBe(66.67);
    expect(calificar(entrada, []).puntaje).toBe(0);
    expect(calificar(entrada, historia(candidatas, ["a", CORRECTA])).puntaje).toBe(100);
  });

  it("devuelve todas las habilidades de la Evaluación, en el orden de la materia y con su descripción", () => {
    const entrada = entradaDe({ habilidades: ["b", "a", "c"], candidatas: [pregunta("Q", 2, ["a"])] });
    expect(calificar(entrada, []).habilidades.map((h) => [h.habilidad, h.descripcion, h.nivel])).toEqual([
      ["b", "Habilidad b", "sin_medir"],
      ["a", "Habilidad a", "sin_medir"],
      ["c", "Habilidad c", "sin_medir"],
    ]);
  });

  it("los errores confirmados van antes que los que están en sospecha, y cada grupo por orden de aparición", () => {
    const candidatas = [
      ...Array.from({ length: 4 }, (_, i) => pregunta(`Q${i}`, 2, ["h1"], ["h1.y", "h1.x", "h1.z"])),
      pregunta("Q4", 2, ["h1"], ["h1.y", "h1.p", "h1.q"]),
    ];
    const entrada = entradaDe({ habilidades: ["h1"], candidatas });
    // y en sospecha (paso 0), x en sospecha (1), z en sospecha (2), x otra vez: confirmada (3); acierta una que ofrece y: descartada (4).
    const pasos = historia(candidatas, ["Q0", "h1.y"], ["Q1", "h1.x"], ["Q2", "h1.z"], ["Q3", "h1.x"], ["Q4", CORRECTA]);
    expect(calificar(entrada, pasos).errores.map((e) => [e.misconcepcion, e.estado, e.veces])).toEqual([
      ["h1.x", "confirmada", 2],
      ["h1.z", "sospecha", 1],
    ]);
    // Sin el último acierto, y sigue en sospecha y sale primero entre las sospechas, porque apareció antes que z.
    expect(calificar(entrada, pasos.slice(0, 4)).errores.map((e) => [e.misconcepcion, e.estado])).toEqual([
      ["h1.x", "confirmada"],
      ["h1.y", "sospecha"],
      ["h1.z", "sospecha"],
    ]);
  });

  it("cada error trae la descripción de la misconcepción como texto y los textos de error propios como detalles, sin repetir", () => {
    const candidatas = [
      pregunta("Q0", 2, ["h1"], ["h1.x", "h1.y", "h1.z"], ["se olvida del signo", null, null]),
      pregunta("Q1", 2, ["h1"], ["h1.x", "h1.y", "h1.z"], ["se olvida del signo", null, null]),
      pregunta("Q2", 3, ["h1"], ["h1.x", "h1.y", "h1.z"], ["cambia la constante", null, null]),
      pregunta("Q3", 3, ["h1"], ["h1.y", "h1.x", "h1.z"]),
    ];
    const entrada = entradaDe({
      habilidades: ["h1"],
      candidatas,
      misconcepciones: [
        { clave: "h1.x", habilidad: "h1", descripcion: "te olvidas del signo" },
        { clave: "h1.y", habilidad: "h1", descripcion: "confundes la regla" },
        { clave: "h1.z", habilidad: "h1", descripcion: "no distingues" },
      ],
    });
    const pasos = historia(candidatas, ["Q0", "h1.x"], ["Q1", "h1.x"], ["Q2", "h1.x"], ["Q3", "h1.y"]);
    expect(calificar(entrada, pasos).errores).toEqual([
      { misconcepcion: "h1.x", habilidad: "h1", texto: "te olvidas del signo", estado: "confirmada", veces: 3, detalles: ["se olvida del signo", "cambia la constante"] },
      { misconcepcion: "h1.y", habilidad: "h1", texto: "confundes la regla", estado: "sospecha", veces: 1, detalles: [] },
    ]);
  });

  it("los prerrequisitos son los directos de las habilidades en no lo domina o en proceso, sin repetir", () => {
    const prerrequisito = (habilidad: string, materia: string | null = null) => ({ materia, habilidad, descripcion: `Descripción de ${habilidad}` });
    const habilidades: HabilidadDeEntrada[] = [
      { clave: "h1", descripcion: "Uno", prerrequisitos: [prerrequisito("base"), prerrequisito("algebra", "algebra-lineal")] },
      { clave: "h2", descripcion: "Dos", prerrequisitos: [prerrequisito("base"), prerrequisito("otra")] },
      { clave: "h3", descripcion: "Tres", prerrequisitos: [prerrequisito("domina-esta")] },
      { clave: "h4", descripcion: "Cuatro", prerrequisitos: [prerrequisito("sin-medir")] },
    ];
    const candidatas = [pregunta("a", 2, ["h1"]), pregunta("b", 2, ["h1"]), pregunta("c", 2, ["h2"]), pregunta("d", 2, ["h2"]), pregunta("e", 3, ["h3"])];
    const entrada = entradaDe({ habilidades, candidatas });
    // h1 en proceso (acierto y fallo), h2 no lo domina (dos fallos), h3 lo domina (un acierto en 3), h4 sin medir.
    const pasos = historia(candidatas, ["a", CORRECTA], ["b", "h1.a"], ["c", "h2.a"], ["d", "h2.b"], ["e", CORRECTA]);
    expect(calificar(entrada, pasos).habilidades.map((h) => h.nivel)).toEqual(["en_proceso", "no_lo_domina", "lo_domina", "sin_medir"]);
    expect(calificar(entrada, pasos).prerrequisitos).toEqual([
      { materia: null, habilidad: "base", descripcion: "Descripción de base" },
      { materia: "algebra-lineal", habilidad: "algebra", descripcion: "Descripción de algebra" },
      { materia: null, habilidad: "otra", descripcion: "Descripción de otra" },
    ]);
  });
});

describe("falta de material (regla 12, D-49 c)", () => {
  it("el tope de 20 con habilidades de una sola respuesta las marca tope_una_respuesta y deja la lista vacía a las demás", () => {
    // 21 habilidades con 2 preguntas libres cada una: el tope corta en 20 con 20 de una sola respuesta y 1 sin medir.
    const habilidades = Array.from({ length: 21 }, (_, i) => `h${i + 1}`);
    const candidatas = habilidades.flatMap((h) => [pregunta(`${h}-a`, 2, [h]), pregunta(`${h}-b`, 3, [h])]);
    const entrada = entradaDe({ habilidades, candidatas });
    const { pasos } = correr(entrada);
    expect(pasos).toHaveLength(TOPE_DIAGNOSTICO);
    const resultado = calificar(entrada, pasos);
    const marcadas = resultado.habilidades.filter((h) => h.faltaMaterial.length > 0);
    expect(marcadas).toHaveLength(20);
    expect(marcadas.every((h) => h.faltaMaterial.join() === "tope_una_respuesta" && h.nivel === "en_proceso" && h.respuestas === 1)).toBe(true);
    const sinMedir = resultado.habilidades.filter((h) => h.nivel === "sin_medir");
    expect(sinMedir).toHaveLength(1);
    expect(sinMedir[0].faltaMaterial).toEqual([]); // no le faltó material: el tope no alcanzó
  });

  it("con el tope y una sola respuesta que falló, queda en proceso con el error en sospecha", () => {
    const habilidades = Array.from({ length: 21 }, (_, i) => `h${i + 1}`);
    const candidatas = habilidades.flatMap((h) => [pregunta(`${h}-a`, 2, [h]), pregunta(`${h}-b`, 3, [h])]);
    const entrada = entradaDe({ habilidades, candidatas });
    // Cada habilidad tiene sus propias trampas: el estudiante elige la primera incorrecta de cada pregunta.
    const propios = correr(entrada, (candidata) => candidata.opciones[1].misconcepcion ?? CORRECTA);
    const resultado = calificar(entrada, propios.pasos);
    expect(resultado.habilidades.filter((h) => h.nivel === "en_proceso" && h.faltaMaterial.join() === "tope_una_respuesta")).toHaveLength(20);
    expect(resultado.errores).toHaveLength(20);
    expect(resultado.errores.every((e) => e.estado === "sospecha" && e.veces === 1)).toBe(true);
  });

  it("sin preguntas libres antes de la segunda que la duda pedía: sin_preguntas_sin_ver, y la habilidad queda como estaba", () => {
    const candidatas = [pregunta("a", 2, ["h1"]), pregunta("b", 2, ["h2"]), pregunta("c", 3, ["h2"])];
    const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas });
    const { pasos } = correr(entrada);
    expect(claves(pasos).sort()).toEqual(["a", "b", "c"]);
    expect(calificar(entrada, pasos).habilidades.map((h) => [h.habilidad, h.nivel, h.faltaMaterial])).toEqual([
      ["h1", "en_proceso", ["sin_preguntas_sin_ver"]],
      ["h2", "lo_domina", []],
    ]);
  });

  it("una habilidad sin ninguna candidata queda sin medir y marcada", () => {
    const entrada = entradaDe({ habilidades: ["h1", "h2"], candidatas: [pregunta("a", 3, ["h1"])] });
    const { pasos } = correr(entrada);
    expect(calificar(entrada, pasos).habilidades.map((h) => [h.nivel, h.faltaMaterial])).toEqual([
      ["lo_domina", []],
      ["sin_medir", ["sin_preguntas_sin_ver"]],
    ]);
  });

  it("con un diagnóstico a medias no marca tope_una_respuesta: solo el tope de 20 la produce", () => {
    const candidatas = [pregunta("a", 2, ["h1"]), pregunta("b", 3, ["h1"])];
    const entrada = entradaDe({ habilidades: ["h1"], candidatas });
    const aMedias = calificar(entrada, historia(candidatas, ["a", CORRECTA]));
    expect(aMedias.habilidades[0]).toMatchObject({ nivel: "en_proceso", respuestas: 1, faltaMaterial: [] }); // todavía tiene a "b"
  });

  it("no marca a la habilidad que se resolvió, aunque el tope haya cortado a otras", () => {
    const habilidades = Array.from({ length: 21 }, (_, i) => `h${i + 1}`);
    const candidatas = habilidades.flatMap((h) => [pregunta(`${h}-a`, 3, [h]), pregunta(`${h}-b`, 3, [h])]);
    const entrada = entradaDe({ habilidades, candidatas });
    const { pasos } = correr(entrada); // todo correcto en dificultad 3: cada una queda en lo domina con una respuesta
    expect(pasos).toHaveLength(TOPE_DIAGNOSTICO);
    expect(calificar(entrada, pasos).habilidades.every((h) => h.faltaMaterial.length === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// La copia de cada paso, no el banco
// ---------------------------------------------------------------------------

describe("califica con la copia de cada paso y nunca con el banco actual", () => {
  const habilidades = ["h1", "h2"];
  const candidatas = [
    pregunta("a", 2, ["h1"], ["h1.x", "h1.y", "h1.z"], ["error a", null, null]),
    pregunta("b", 3, ["h1"], ["h1.x", "h1.y", "h1.z"]),
    pregunta("c", 2, ["h2"], ["h2.x", "h2.y", "h2.z"]),
    pregunta("d", 3, ["h2"], ["h2.x", "h2.y", "h2.z"]),
  ];
  const entrada = entradaDe({ habilidades, candidatas, semilla: 7 });
  const corrida = correr(entrada, (candidata) => `${candidata.habilidades[0]}.x`); // falla todo con la misma trampa de cada habilidad
  const esperado = calificar(entrada, corrida.pasos);

  it("el diagnóstico de la prueba tiene los cuatro pasos y errores", () => {
    expect(corrida.pasos).toHaveLength(4);
    expect(esperado.errores).toHaveLength(2);
  });

  it("retirar las preguntas mostradas del banco no cambia el resultado", () => {
    const retirado = { ...entrada, candidatas: [] };
    expect(calificar(retirado, corrida.pasos)).toEqual(esperado);
  });

  it("editar las preguntas mostradas (dificultad, habilidades, opciones, correcta, errores) no cambia el resultado", () => {
    const editadas = entrada.candidatas.map((c) => ({
      ...c,
      dificultad: 1 as Dificultad,
      habilidades: ["h2"],
      enunciado: "editado",
      opciones: c.opciones.map((o, i) => ({ texto: "otro texto", correcta: i === 3, misconcepcion: i === 3 ? null : `h2.${i}`, error: "otro error" })),
      solucion: null,
    }));
    expect(calificar({ ...entrada, candidatas: editadas }, corrida.pasos)).toEqual(esperado);
  });

  it("el paso guarda la letra que vio y el orden: otro orden de las mismas opciones da la misma opción elegida", () => {
    const [paso] = corrida.pasos;
    const eleccion = opcionElegida(paso);
    const otroOrden: OrdenDeOpciones = ["D", "C", "B", "A"];
    const mismaOpcion = { ...paso, orden: otroOrden, letraElegida: LETRAS[otroOrden.indexOf(letraDelBanco(paso, `${paso.habilidades[0]}.x`))] };
    expect(opcionElegida(mismaOpcion)).toEqual(eleccion);
  });

  it("falla con claridad si una misconcepción elegida no está en la entrada", () => {
    const sinMisconcepciones = { ...entrada, misconcepciones: [] };
    expect(() => calificar(sinMisconcepciones, corrida.pasos)).toThrow(/La misconcepción h\d\.x de la pregunta \w+ no está en la entrada/);
  });
});

// ---------------------------------------------------------------------------
// El banco real, semillas 1 a 1000
// ---------------------------------------------------------------------------

describe("banco real: todas las Evaluaciones, semillas 1 a 1000 con respuestas al azar", () => {
  interface Caso {
    nombre: string;
    carpeta: string;
    evaluacion: string;
    borradores: boolean;
    habilidadesConCandidatas: number;
    habilidades: number;
    corridas: Corrida[];
    resultados: ResultadoDiagnostico[];
    entrada: EntradaMotor;
  }
  let casos: Caso[] = [];

  beforeAll(() => {
    const { banco, errores } = leerBanco(RAIZ_CONTENIDO);
    expect(errores).toEqual([]);
    const pedidos = banco.materias.flatMap((m) => m.evaluaciones.map((e) => ({ carpeta: m.carpeta, evaluacion: e.clave, borradores: false })));
    // Cálculo Integral con sus borradores: tiene las preguntas de varias habilidades y las misconcepciones con dos trampas.
    pedidos.push({ carpeta: "calculo-integral", evaluacion: "parcial-2", borradores: true });
    casos = pedidos.map((pedido) => {
      const base = entradaDelBanco(banco, pedido.carpeta, pedido.evaluacion, pedido.borradores);
      const corridas: Corrida[] = [];
      const resultados: ResultadoDiagnostico[] = [];
      for (let semilla = 1; semilla <= 1000; semilla++) {
        const entrada = { ...base, semilla };
        const corrida = correr(entrada, alAzar(semilla));
        corridas.push(corrida);
        resultados.push(calificar(entrada, corrida.pasos));
      }
      return {
        nombre: `${pedido.carpeta}/${pedido.evaluacion}${pedido.borradores ? " (con borradores)" : ""}`,
        ...pedido,
        habilidades: base.habilidades.length,
        habilidadesConCandidatas: base.habilidades.filter((h) => base.candidatas.some((c) => c.habilidades.includes(h.clave))).length,
        corridas,
        resultados,
        entrada: base,
      };
    });
  }, 300_000);

  it("corre todas las Evaluaciones del banco, también las inactivas, y la de Cálculo Integral con borradores", () => {
    const { banco } = leerBanco(RAIZ_CONTENIDO);
    const evaluaciones = banco.materias.reduce((total, materia) => total + materia.evaluaciones.length, 0);
    expect(evaluaciones).toBeGreaterThan(0);
    expect(casos).toHaveLength(evaluaciones + 1);
    expect(casos.map((c) => c.nombre)).toContain("calculo-integral/parcial-2 (con borradores)");
  });

  it("ninguna pregunta sale dos veces y ninguna habilidad recibe más de 2 preguntas elegidas para ella", () => {
    const problemas: string[] = [];
    for (const caso of casos) {
      caso.corridas.forEach(({ pasos, elegidas }, i) => {
        if (new Set(claves(pasos)).size !== pasos.length) problemas.push(`${caso.nombre} semilla ${i + 1}: repite una pregunta`);
        const paraCada = new Map<string, number>();
        for (const e of elegidas) paraCada.set(e.habilidad, (paraCada.get(e.habilidad) ?? 0) + 1);
        if (Math.max(0, ...paraCada.values()) > 2) problemas.push(`${caso.nombre} semilla ${i + 1}: una habilidad recibió más de 2`);
      });
    }
    expect(problemas).toEqual([]);
  });

  it("el largo no pasa del menor entre 20 y el doble de las habilidades, ni del máximo que se informa", () => {
    const problemas: string[] = [];
    for (const caso of casos) {
      const maximo = maximoDePreguntas(caso.entrada);
      if (maximo > Math.min(TOPE_DIAGNOSTICO, 2 * caso.habilidades)) problemas.push(`${caso.nombre}: el máximo informado es ${maximo}`);
      caso.corridas.forEach(({ pasos }, i) => {
        if (pasos.length > Math.min(TOPE_DIAGNOSTICO, 2 * caso.habilidades, maximo)) {
          problemas.push(`${caso.nombre} semilla ${i + 1}: ${pasos.length} preguntas, máximo ${maximo}`);
        }
      });
    }
    expect(problemas).toEqual([]);
  });

  it("toda habilidad con candidatas tiene al menos una pregunta, salvo que haya cortado el tope", () => {
    const problemas: string[] = [];
    for (const caso of casos) {
      const conCandidatas = caso.entrada.habilidades.filter((h) => caso.entrada.candidatas.some((c) => c.habilidades.includes(h.clave)));
      caso.corridas.forEach(({ pasos }, i) => {
        if (pasos.length >= TOPE_DIAGNOSTICO) return;
        for (const habilidad of conCandidatas) {
          if (!pasos.some((p) => p.habilidades.includes(habilidad.clave))) problemas.push(`${caso.nombre} semilla ${i + 1}: ${habilidad.clave}`);
        }
      });
    }
    expect(problemas).toEqual([]);
  });

  it("sin medir es falta de material: antes del tope de 20, ninguna habilidad sin medir y sin marca tiene preguntas libres", () => {
    const problemas: string[] = [];
    for (const caso of casos) {
      caso.resultados.forEach((resultado, i) => {
        const { pasos } = caso.corridas[i];
        if (pasos.length >= TOPE_DIAGNOSTICO) return; // si cortó el tope, a alguna no le alcanzó y no es falta de material
        const vistas = new Set(claves(pasos));
        for (const h of resultado.habilidades.filter((x) => x.nivel === "sin_medir" && x.faltaMaterial.length === 0)) {
          const hayLibres = caso.entrada.candidatas.some((c) => c.habilidades.includes(h.habilidad) && !vistas.has(c.clave));
          if (hayLibres) problemas.push(`${caso.nombre} semilla ${i + 1}: ${h.habilidad}`);
        }
      });
    }
    expect(problemas).toEqual([]);
  });

  it("califica cada diagnóstico con cuentas coherentes: niveles, errores, marcas y puntaje", () => {
    const problemas: string[] = [];
    for (const caso of casos) {
      caso.resultados.forEach((resultado, i) => {
        const donde = `${caso.nombre} semilla ${i + 1}`;
        const { pasos } = caso.corridas[i];
        if (resultado.habilidades.map((h) => h.habilidad).join() !== caso.entrada.habilidades.map((h) => h.clave).join()) problemas.push(`${donde}: orden`);
        const aciertos = pasos.filter((p) => opcionElegida(p).correcta).length;
        if (resultado.puntaje !== (pasos.length === 0 ? 0 : Math.round((aciertos / pasos.length) * 10_000) / 100)) problemas.push(`${donde}: puntaje`);
        for (const h of resultado.habilidades) {
          if (h.aciertos > h.respuestas) problemas.push(`${donde}: ${h.habilidad} aciertos > respuestas`);
          if (h.nivel === "sin_medir" && h.respuestas !== 0) problemas.push(`${donde}: ${h.habilidad} sin medir con respuestas`);
          if (h.nivel === "lo_domina" && h.aciertos !== h.respuestas) problemas.push(`${donde}: ${h.habilidad} lo domina con fallos`);
          if (h.faltaMaterial.length > 1) problemas.push(`${donde}: ${h.habilidad} con dos marcas`);
        }
        const confirmadas = resultado.errores.filter((e) => e.estado === "confirmada").length;
        if (!resultado.errores.slice(0, confirmadas).every((e) => e.estado === "confirmada")) problemas.push(`${donde}: errores desordenados`);
      });
    }
    expect(problemas).toEqual([]);
  });

  it("Cálculo Integral con borradores corta en 20 y deja habilidades con una sola respuesta marcadas tope_una_respuesta", () => {
    const caso = casos.find((c) => c.borradores);
    if (!caso) throw new Error("falta el caso de Cálculo Integral con borradores");
    const cortadas = caso.corridas.filter((c) => c.pasos.length === TOPE_DIAGNOSTICO).length;
    expect(cortadas).toBeGreaterThan(caso.corridas.length / 2);
    const conTope = caso.resultados.filter((r) => r.habilidades.some((h) => h.faltaMaterial.includes("tope_una_respuesta")));
    expect(conTope.length).toBeGreaterThan(0);
    const problemas: string[] = [];
    for (const resultado of conTope) {
      for (const h of resultado.habilidades.filter((x) => x.faltaMaterial.includes("tope_una_respuesta"))) {
        if (h.respuestas !== 1 || h.nivel !== "en_proceso") problemas.push(`${h.habilidad}: ${h.nivel} con ${h.respuestas} respuestas`);
      }
    }
    expect(problemas).toEqual([]);
  });

  it("la opción correcta cae en cada posición entre el 20 % y el 30 % de las veces", () => {
    const problemas: string[] = [];
    const todas = [0, 0, 0, 0];
    let total = 0;
    for (const caso of casos) {
      const porCaso = [0, 0, 0, 0];
      let n = 0;
      for (const { pasos } of caso.corridas) {
        for (const paso of pasos) {
          const posicion = paso.orden.indexOf(LETRAS[paso.opciones.findIndex((o) => o.correcta)]);
          porCaso[posicion] += 1;
          todas[posicion] += 1;
          n += 1;
          total += 1;
        }
      }
      porCaso.forEach((cuenta, posicion) => {
        if (cuenta / n < 0.2 || cuenta / n > 0.3) problemas.push(`${caso.nombre}: posición ${LETRAS[posicion]} ${(100 * cuenta) / n} %`);
      });
    }
    todas.forEach((cuenta, posicion) => {
      if (cuenta / total < 0.2 || cuenta / total > 0.3) problemas.push(`todas: posición ${LETRAS[posicion]} ${(100 * cuenta) / total} %`);
    });
    expect(problemas).toEqual([]);
  });

  it("lo que recibe el navegador de cada pregunta mostrada son solo el enunciado y las letras con su texto", () => {
    const problemas: string[] = [];
    for (const caso of casos) {
      for (const { pasos } of caso.corridas.slice(0, 50)) {
        for (const paso of pasos) {
          const vista = paraNavegador(paso, paso.orden);
          if (Object.keys(vista).join() !== "enunciado,opciones") problemas.push(`${caso.nombre} ${paso.clave}: llaves ${Object.keys(vista).join()}`);
          if (vista.opciones.map((o) => o.letra).join("") !== "ABCD") problemas.push(`${caso.nombre} ${paso.clave}: letras`);
          if (vista.opciones.some((o) => Object.keys(o).join() !== "letra,texto")) problemas.push(`${caso.nombre} ${paso.clave}: llaves de opción`);
          if (vista.opciones.map((o) => o.texto).sort().join("|") !== paso.opciones.map((o) => o.texto).sort().join("|")) problemas.push(`${caso.nombre} ${paso.clave}: textos`);
        }
      }
    }
    expect(problemas).toEqual([]);
  });
});
