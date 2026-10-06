import { describe, expect, it } from "vitest";
import {
  LETRAS,
  calificar,
  siguientePregunta,
  type CopiaDePaso,
  type Dificultad,
  type EntradaMotor,
  type Letra,
  type PreguntaCandidata,
  type ResultadoDiagnostico,
} from "./motor";
import { aciertosDe, armarResultadoGuardado, faltaMaterialDe } from "./resultado";

// HU-081: lo que se guarda de un diagnóstico terminado. El resultado es el de `calificar`, con nombres legibles y sin la marca
// de falta de material (esa va en su propia columna sin grant, para que ninguna sesión la lea).

function candidata(clave: string, dificultad: Dificultad, habilidades: string[], trampas: [string, string, string]): PreguntaCandidata {
  return {
    clave,
    tema: "tema-1",
    enunciado: `Enunciado de ${clave}`,
    opciones: [
      { texto: `${clave} correcta`, correcta: true, misconcepcion: null, error: null },
      ...trampas.map((trampa, i) => ({ texto: `${clave} ${trampa}`, correcta: false, misconcepcion: trampa, error: `Detalle de ${trampa} en ${clave}${i}` })),
    ],
    dificultad,
    habilidades,
    solucion: null,
  };
}

const MISCONCEPCIONES = [
  { clave: "h1.a", habilidad: "h1", descripcion: "Error h1.a" },
  { clave: "h1.b", habilidad: "h1", descripcion: "Error h1.b" },
  { clave: "h1.c", habilidad: "h1", descripcion: "Error h1.c" },
  { clave: "h2.a", habilidad: "h2", descripcion: "Error h2.a" },
  { clave: "h2.b", habilidad: "h2", descripcion: "Error h2.b" },
  { clave: "h2.c", habilidad: "h2", descripcion: "Error h2.c" },
  // De una habilidad que no es de la Evaluación (regla 8 de HU-060): sale en los errores, pero la habilidad no tiene nivel.
  { clave: "h9.x", habilidad: "h9", descripcion: "Error h9.x" },
];

const DESCRIPCIONES = { h1: "Primera habilidad", h2: "Segunda habilidad", h9: "Una de fuera de la Evaluación" };

function entradaDe(candidatas: PreguntaCandidata[], parte: Partial<EntradaMotor> = {}): EntradaMotor {
  return {
    habilidades: [
      { clave: "h1", descripcion: "Primera habilidad", prerrequisitos: [{ materia: "Otra materia", habilidad: "base", descripcion: "Una base" }] },
      { clave: "h2", descripcion: "Segunda habilidad", prerrequisitos: [] },
    ],
    misconcepciones: MISCONCEPCIONES,
    candidatas,
    vistasAntes: [],
    semilla: 3,
    ...parte,
  };
}

/** Juega el diagnóstico hasta que termina; `elegir` da la posición (0 a 3) de la opción del banco que se marca en cada paso. */
function jugar(entrada: EntradaMotor, elegir: (pregunta: PreguntaCandidata, paso: number) => number): CopiaDePaso[] {
  const pasos: CopiaDePaso[] = [];
  for (;;) {
    const siguiente = siguientePregunta(entrada, pasos);
    if ("terminado" in siguiente) return pasos;
    const pregunta = entrada.candidatas.find((c) => c.clave === siguiente.clave) as PreguntaCandidata;
    const delBanco: Letra = LETRAS[elegir(pregunta, pasos.length)];
    const mostrada = LETRAS[siguiente.orden.indexOf(delBanco)];
    pasos.push({ ...pregunta, orden: [...siguiente.orden], letraElegida: mostrada, fecha: "2026-10-05T12:00:00.000Z" });
  }
}

const todasCorrectas = () => 0;

const BANCO = [
  candidata("P1", 2, ["h1"], ["h1.a", "h1.b", "h1.c"]),
  candidata("P2", 2, ["h1"], ["h1.a", "h1.b", "h1.c"]),
  candidata("P3", 3, ["h1"], ["h1.a", "h1.b", "h1.c"]),
  candidata("P4", 2, ["h2"], ["h2.a", "h2.b", "h2.c"]),
  candidata("P5", 3, ["h2"], ["h2.a", "h2.b", "h2.c"]),
];

/** Lo que revisa el CHECK `diagnostico_resultado_completo` de la base. */
function cumpleElCheckDeLaBase(valor: unknown): boolean {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return false;
  const objeto = valor as Record<string, unknown>;
  return Array.isArray(objeto.habilidades) && Array.isArray(objeto.errores) && Array.isArray(objeto.prerrequisitos);
}

describe("armarResultadoGuardado", () => {
  it("guarda habilidades, errores y prerrequisitos con sus nombres, y cumple el check de la base", () => {
    const entrada = entradaDe(BANCO);
    // Siempre la primera trampa: h1 queda en no lo domina con una misconcepción y h2 igual.
    const pasos = jugar(entrada, () => 1);
    const resultado = calificar(entrada, pasos);
    const guardado = armarResultadoGuardado(resultado, DESCRIPCIONES);

    expect(cumpleElCheckDeLaBase(guardado)).toBe(true);
    expect(Object.keys(guardado).sort()).toEqual(["errores", "habilidades", "prerrequisitos"]);
    expect(guardado.habilidades.map((h) => h.habilidad)).toEqual(["h1", "h2"]);
    expect(guardado.habilidades[0]).toEqual({
      habilidad: "h1",
      descripcion: "Primera habilidad",
      nivel: resultado.habilidades[0].nivel,
      respuestas: resultado.habilidades[0].respuestas,
      aciertos: 0,
    });
    expect(guardado.errores.length).toBeGreaterThan(0);
    for (const [i, error] of guardado.errores.entries()) {
      expect(Object.keys(error).sort()).toEqual(["descripcionHabilidad", "detalles", "estado", "habilidad", "misconcepcion", "texto", "veces"]);
      // Cada error es el del motor con la descripción de su habilidad: el estado y las veces no se inventan.
      expect(error).toEqual({ ...resultado.errores[i], descripcionHabilidad: DESCRIPCIONES[error.habilidad as keyof typeof DESCRIPCIONES] });
      expect(error.texto).toBe(`Error ${error.misconcepcion}`);
    }
    // Los directos de la habilidad débil, con el nombre de la otra materia.
    expect(guardado.prerrequisitos).toEqual([{ materia: "Otra materia", habilidad: "base", descripcion: "Una base" }]);
  });

  it("guarda el estado y las veces que calculó el motor: una confirmada con varias veces y una en sospecha de una sola", () => {
    const banco = [
      candidata("R1", 2, ["h1"], ["h1.a", "h1.b", "h1.c"]),
      candidata("R2", 2, ["h1"], ["h1.a", "h1.b", "h1.c"]),
      candidata("R3", 2, ["h2"], ["h2.a", "h2.b", "h2.c"]),
    ];
    const entrada = entradaDe(banco);
    // En las de h1, la primera trampa (h1.a) siempre; en la de h2, la segunda (h2.b) una vez.
    const resultado = calificar(entrada, jugar(entrada, (pregunta) => (pregunta.habilidades[0] === "h1" ? 1 : 2)));
    expect(resultado.errores.find((e) => e.misconcepcion === "h1.a")).toMatchObject({ estado: "confirmada", veces: 2 });
    expect(resultado.errores.find((e) => e.misconcepcion === "h2.b")).toMatchObject({ estado: "sospecha", veces: 1 });

    const guardado = armarResultadoGuardado(resultado, DESCRIPCIONES);
    expect(guardado.errores.find((e) => e.misconcepcion === "h1.a")).toMatchObject({ estado: "confirmada", veces: 2 });
    expect(guardado.errores.find((e) => e.misconcepcion === "h2.b")).toMatchObject({ estado: "sospecha", veces: 1 });
    expect(guardado.errores).toEqual(
      resultado.errores.map((e) => ({ ...e, descripcionHabilidad: DESCRIPCIONES[e.habilidad as keyof typeof DESCRIPCIONES] })),
    );
  });

  it("conserva el orden del motor: habilidades en el orden de la materia y las confirmadas primero", () => {
    const entrada = entradaDe(BANCO);
    const pasos = jugar(entrada, () => 1);
    const resultado = calificar(entrada, pasos);
    const guardado = armarResultadoGuardado(resultado, DESCRIPCIONES);
    expect(guardado.habilidades.map((h) => h.habilidad)).toEqual(resultado.habilidades.map((h) => h.habilidad));
    expect(guardado.errores.map((e) => e.misconcepcion)).toEqual(resultado.errores.map((e) => e.misconcepcion));
    const estados = guardado.errores.map((e) => e.estado);
    expect(estados).toEqual([...estados].sort((a, b) => Number(b === "confirmada") - Number(a === "confirmada")));
  });

  it("quita faltaMaterial: ni la clave ni sus motivos quedan en lo que leen las sesiones", () => {
    // Con las preguntas de h2 ya vistas, h2 queda sin medir y marcada sin_preguntas_sin_ver.
    const entrada = entradaDe(BANCO, { vistasAntes: ["P4", "P5"] });
    const resultado = calificar(entrada, jugar(entrada, todasCorrectas));
    expect(resultado.habilidades.find((h) => h.habilidad === "h2")?.faltaMaterial).toEqual(["sin_preguntas_sin_ver"]);

    const guardado = armarResultadoGuardado(resultado, DESCRIPCIONES);
    const texto = JSON.stringify(guardado);
    expect(texto).not.toContain("faltaMaterial");
    expect(texto).not.toContain("sin_preguntas_sin_ver");
    expect(texto).not.toContain("tope_una_respuesta");
    // Y la entrada, que el motor devolvió, sigue intacta: no se le quitó nada.
    expect(resultado.habilidades.find((h) => h.habilidad === "h2")?.faltaMaterial).toEqual(["sin_preguntas_sin_ver"]);
  });

  it("agrega descripcionHabilidad, también al error de una habilidad que no es de la Evaluación", () => {
    // P1 mide h1 y ofrece como trampa la misconcepción de h9; elegirla en dos preguntas la confirma.
    const banco = [
      candidata("Q1", 2, ["h1"], ["h9.x", "h1.b", "h1.c"]),
      candidata("Q2", 2, ["h1"], ["h9.x", "h1.b", "h1.c"]),
      candidata("Q3", 2, ["h2"], ["h2.a", "h2.b", "h2.c"]),
    ];
    const entrada = entradaDe(banco);
    const resultado = calificar(entrada, jugar(entrada, (pregunta) => (pregunta.habilidades[0] === "h1" ? 1 : 0)));
    const delOtraHabilidad = resultado.errores.find((e) => e.misconcepcion === "h9.x");
    expect(delOtraHabilidad).toBeDefined();
    expect(resultado.habilidades.map((h) => h.habilidad)).not.toContain("h9");

    const guardado = armarResultadoGuardado(resultado, DESCRIPCIONES);
    expect(guardado.errores.find((e) => e.misconcepcion === "h9.x")).toMatchObject({
      habilidad: "h9",
      descripcionHabilidad: "Una de fuera de la Evaluación",
      texto: "Error h9.x",
    });
  });

  it("sin la descripción de la habilidad, queda su clave: un diagnóstico terminado no se bloquea por un dato de presentación", () => {
    const entrada = entradaDe(BANCO);
    const resultado = calificar(entrada, jugar(entrada, () => 1));
    const guardado = armarResultadoGuardado(resultado, {});
    expect(guardado.errores.length).toBeGreaterThan(0);
    for (const error of guardado.errores) expect(error.descripcionHabilidad).toBe(error.habilidad);
  });

  it("una clave como constructor o __proto__ no recoge nada del prototipo", () => {
    const resultado: ResultadoDiagnostico = {
      habilidades: [],
      errores: ["constructor", "__proto__", "toString"].map((habilidad) => ({
        misconcepcion: `${habilidad}.x`,
        habilidad,
        texto: "Error",
        estado: "sospecha" as const,
        veces: 1,
        detalles: [],
      })),
      prerrequisitos: [],
      puntaje: 0,
    };
    const guardado = armarResultadoGuardado(resultado, {});
    expect(guardado.errores.map((e) => e.descripcionHabilidad)).toEqual(["constructor", "__proto__", "toString"]);
  });

  it("construye objetos nuevos: cambiar lo guardado no cambia el resultado del motor", () => {
    const entrada = entradaDe(BANCO);
    const resultado = calificar(entrada, jugar(entrada, () => 1));
    const guardado = armarResultadoGuardado(resultado, DESCRIPCIONES);
    guardado.errores[0].detalles.push("cambiado");
    guardado.habilidades[0].nivel = "lo_domina";
    guardado.prerrequisitos.pop();
    expect(resultado.errores[0].detalles).not.toContain("cambiado");
    expect(resultado.habilidades[0].nivel).not.toBe("lo_domina");
    expect(resultado.prerrequisitos).toHaveLength(1);
  });

  it("un diagnóstico sin errores ni prerrequisitos guarda listas vacías y no solo las que hay", () => {
    const entrada = entradaDe(BANCO);
    const guardado = armarResultadoGuardado(calificar(entrada, jugar(entrada, todasCorrectas)), DESCRIPCIONES);
    expect(guardado.errores).toEqual([]);
    expect(guardado.prerrequisitos).toEqual([]);
    expect(cumpleElCheckDeLaBase(guardado)).toBe(true);
  });
});

describe("faltaMaterialDe", () => {
  it("solo trae las habilidades con marca, con su motivo, como las calculó el motor", () => {
    const entrada = entradaDe(BANCO, { vistasAntes: ["P4", "P5"] });
    const resultado = calificar(entrada, jugar(entrada, todasCorrectas));
    expect(faltaMaterialDe(resultado)).toEqual([{ habilidad: "h2", motivos: ["sin_preguntas_sin_ver"] }]);
  });

  it("sin marcas es una lista vacía", () => {
    const entrada = entradaDe(BANCO);
    expect(faltaMaterialDe(calificar(entrada, jugar(entrada, todasCorrectas)))).toEqual([]);
  });

  it("conserva los dos motivos, también tope_una_respuesta, y no recalcula nada", () => {
    // El motor solo llega a `tope_una_respuesta` con 20 preguntas: aquí se arma el resultado a mano.
    const habilidad = (clave: string, faltaMaterial: ResultadoDiagnostico["habilidades"][number]["faltaMaterial"]) => ({
      habilidad: clave,
      descripcion: clave,
      nivel: "en_proceso" as const,
      respuestas: 1,
      aciertos: 0,
      faltaMaterial,
    });
    const resultado: ResultadoDiagnostico = {
      habilidades: [habilidad("a", ["tope_una_respuesta"]), habilidad("b", []), habilidad("c", ["sin_preguntas_sin_ver"])],
      errores: [],
      prerrequisitos: [],
      puntaje: 0,
    };
    const falta = faltaMaterialDe(resultado);
    expect(falta).toEqual([
      { habilidad: "a", motivos: ["tope_una_respuesta"] },
      { habilidad: "c", motivos: ["sin_preguntas_sin_ver"] },
    ]);
    // Una copia: guardarla no comparte lista con el resultado.
    falta[0].motivos.push("sin_preguntas_sin_ver");
    expect(resultado.habilidades[0].faltaMaterial).toEqual(["tope_una_respuesta"]);
  });
});

describe("aciertosDe", () => {
  it("cuenta las preguntas acertadas con la opción que eligió la persona, no con la letra que vio", () => {
    const entrada = entradaDe(BANCO);
    expect(aciertosDe(jugar(entrada, todasCorrectas))).toBe(jugar(entrada, todasCorrectas).length);
    expect(aciertosDe(jugar(entrada, () => 1))).toBe(0);
    expect(aciertosDe([])).toBe(0);
    // Acierta solo las de dificultad 3.
    const pasos = jugar(entrada, (pregunta) => (pregunta.dificultad === 3 ? 0 : 2));
    expect(aciertosDe(pasos)).toBe(pasos.filter((p) => p.dificultad === 3).length);
  });

  it("una pregunta que mide varias habilidades cuenta una vez, aunque sume a cada una", () => {
    const banco = [
      candidata("M1", 2, ["h1", "h2"], ["h1.a", "h1.b", "h1.c"]),
      candidata("M2", 3, ["h1", "h2"], ["h1.a", "h1.b", "h1.c"]),
    ];
    const entrada = entradaDe(banco);
    const pasos = jugar(entrada, todasCorrectas);
    expect(pasos.length).toBeGreaterThan(0);
    const resultado = calificar(entrada, pasos);
    const sumaPorHabilidad = resultado.habilidades.reduce((suma, h) => suma + h.aciertos, 0);
    expect(sumaPorHabilidad).toBe(2 * pasos.length);
    expect(aciertosDe(pasos)).toBe(pasos.length);
  });

  it("coincide con el puntaje del motor para muchas historias", () => {
    for (let semilla = 1; semilla <= 40; semilla++) {
      const entrada = entradaDe(BANCO, { semilla });
      const pasos = jugar(entrada, (_pregunta, paso) => (semilla + paso) % 4);
      const { puntaje } = calificar(entrada, pasos);
      expect(Math.round((aciertosDe(pasos) / pasos.length) * 10_000) / 100).toBe(puntaje);
    }
  });
});
