import { describe, expect, it } from "vitest";
import { VERSION_DEL_CONTEXTO, candidataDe, entradaDeLaFila, leerFotoDelBanco, type FilaEnCurso, type FotoDelBanco } from "./entrada";
import {
  calificar,
  maximoDePreguntas,
  siguientePregunta,
  type CopiaDePaso,
  type Dificultad,
  type EntradaMotor,
  type Letra,
  type PreguntaCandidata,
} from "./motor";

// HU-081: de la fila del diagnóstico en curso al motor. La foto del banco manda: nada se lee del banco de hoy.

function candidata(clave: string, dificultad: Dificultad, habilidades: string[]): PreguntaCandidata {
  const base = habilidades[0];
  return {
    clave,
    tema: "tema-1",
    enunciado: `Enunciado de ${clave}`,
    opciones: [
      { texto: `${clave} correcta`, correcta: true, misconcepcion: null, error: null },
      { texto: `${clave} trampa a`, correcta: false, misconcepcion: `${base}.a`, error: `Error propio de ${clave} a` },
      { texto: `${clave} trampa b`, correcta: false, misconcepcion: `${base}.b`, error: null },
      { texto: `${clave} trampa c`, correcta: false, misconcepcion: `${base}.c`, error: null },
    ],
    dificultad,
    habilidades,
    solucion: clave === "P3" ? "La solución secreta de P3" : null,
  };
}

function foto(): FotoDelBanco {
  return {
    contexto: {
      version: VERSION_DEL_CONTEXTO,
      evaluacion: { id: "e0000000-0000-4000-8000-000000000001", nombre: "Parcial 1" },
      materia: { id: "a0000000-0000-4000-8000-000000000001", codigo: "MAT-1", nombre: "Matemáticas" },
      habilidades: [
        { clave: "h1", descripcion: "Primera habilidad", prerrequisitos: [{ materia: "Otra materia", habilidad: "base", descripcion: "Una base" }] },
        { clave: "h2", descripcion: "Segunda habilidad", prerrequisitos: [] },
      ],
      misconcepciones: ["h1", "h2"].flatMap((h) => ["a", "b", "c"].map((x) => ({ clave: `${h}.${x}`, habilidad: h, descripcion: `Error ${h}.${x}` }))),
      descripcionesDeHabilidad: { h1: "Primera habilidad", h2: "Segunda habilidad", h9: "Una de fuera de la Evaluación" },
    },
    candidatas: [
      candidata("P1", 2, ["h1"]),
      candidata("P2", 2, ["h1"]),
      candidata("P3", 3, ["h1"]),
      candidata("P4", 2, ["h2"]),
      candidata("P5", 3, ["h2"]),
      candidata("P6", 1, ["h1", "h2"]),
    ],
  };
}

function filaDe(parte: Partial<FilaEnCurso> = {}, base: FotoDelBanco = foto()): FilaEnCurso {
  // Lo que devuelve la base: json que viaja por la red.
  return {
    id: "d0000000-0000-4000-8000-000000000001",
    id_sesion: "5e000000-0000-4000-8000-000000000001",
    id_evaluacion: base.contexto.evaluacion.id,
    id_materia: base.contexto.materia.id,
    semilla: 7,
    vistas_antes: [],
    repetido: false,
    candidatas: JSON.parse(JSON.stringify(base.candidatas)),
    contexto: JSON.parse(JSON.stringify(base.contexto)),
    pasos: [],
    paso: 0,
    iniciado_en: "2026-10-05T12:00:00Z",
    actualizado_en: "2026-10-05T12:00:00Z",
    ...parte,
  };
}

type Ruta = (string | number)[];

function padreDe(raiz: unknown, ruta: Ruta): Record<string | number, unknown> {
  return ruta.slice(0, -1).reduce<unknown>((actual, clave) => (actual as Record<string | number, unknown>)[clave], raiz) as Record<string | number, unknown>;
}

/** Cambia un valor del json que viaja por la red, en la ruta dada. */
function poner(json: unknown, ruta: Ruta, valor: unknown): void {
  padreDe(json, ruta)[ruta[ruta.length - 1]] = valor;
}

function quitar(json: unknown, ruta: Ruta): void {
  delete padreDe(json, ruta)[ruta[ruta.length - 1]];
}

/** Responde `n` pasos con la letra dada, como lo haría el servidor, y devuelve las copias. */
function responder(entrada: EntradaMotor, n: number, letraElegida: Letra = "A"): CopiaDePaso[] {
  const pasos: CopiaDePaso[] = [];
  for (let i = 0; i < n; i++) {
    const siguiente = siguientePregunta(entrada, pasos);
    if ("terminado" in siguiente) break;
    const elegida = entrada.candidatas.find((c) => c.clave === siguiente.clave) as PreguntaCandidata;
    pasos.push({ ...elegida, orden: [...siguiente.orden], letraElegida, fecha: "2026-10-05T12:01:00.000Z" });
  }
  return pasos;
}

describe("leerFotoDelBanco", () => {
  it("lee una foto válida y devuelve objetos nuevos con lo mismo", () => {
    const original = foto();
    const json = JSON.parse(JSON.stringify(original));
    const lectura = leerFotoDelBanco(json);
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;
    expect(lectura.foto).toEqual(original);
    expect(lectura.foto.candidatas[0]).not.toBe(json.candidatas[0]);
  });

  it("una foto de otra versión del formato no es de esta", () => {
    const json = JSON.parse(JSON.stringify(foto()));
    json.contexto.version = VERSION_DEL_CONTEXTO + 1;
    expect(leerFotoDelBanco(json)).toMatchObject({ ok: false, motivo: "otra_version" });
    delete json.contexto.version;
    expect(leerFotoDelBanco(json)).toMatchObject({ ok: false, motivo: "otra_version" });
  });

  it("rechaza una candidata con 3 opciones y nombra la pregunta, no su texto", () => {
    const json = JSON.parse(JSON.stringify(foto()));
    json.candidatas[1].opciones.pop();
    const lectura = leerFotoDelBanco(json);
    expect(lectura).toMatchObject({ ok: false, motivo: "forma" });
    if (lectura.ok) return;
    expect(lectura.detalle).toContain("P2");
    expect(lectura.detalle).toContain("4 opciones");
    expect(lectura.detalle).not.toContain("Enunciado");
  });

  it("rechaza una candidata con 5 opciones", () => {
    const json = JSON.parse(JSON.stringify(foto()));
    json.candidatas[0].opciones.push(json.candidatas[0].opciones[0]);
    expect(leerFotoDelBanco(json)).toMatchObject({ ok: false, motivo: "forma" });
  });

  it("rechaza claves de pregunta repetidas", () => {
    const json = JSON.parse(JSON.stringify(foto()));
    json.candidatas[2].clave = "P1";
    const lectura = leerFotoDelBanco(json);
    expect(lectura).toMatchObject({ ok: false, motivo: "forma" });
    if (!lectura.ok) expect(lectura.detalle).toContain("P1");
  });

  it.each([
    ["no es un objeto", null],
    ["es un texto", "foto"],
    ["es una lista", []],
    ["no trae contexto", { candidatas: [] }],
    ["trae el contexto como lista", { contexto: [], candidatas: [] }],
  ])("rechaza una foto que %s", (_caso, json) => {
    expect(leerFotoDelBanco(json).ok).toBe(false);
  });

  it.each([
    ["las candidatas no son una lista", (j: unknown) => poner(j, ["candidatas"], {})],
    ["falta la lista de habilidades", (j: unknown) => quitar(j, ["contexto", "habilidades"])],
    ["falta la materia", (j: unknown) => quitar(j, ["contexto", "materia"])],
    ["una dificultad no es 1, 2 ni 3", (j: unknown) => poner(j, ["candidatas", 0, "dificultad"], 4)],
    ["una opción no dice si es correcta", (j: unknown) => quitar(j, ["candidatas", 0, "opciones", 1, "correcta"])],
    ["una opción trae el texto como número", (j: unknown) => poner(j, ["candidatas", 0, "opciones", 0, "texto"], 4)],
    ["la solución no es texto ni nulo", (j: unknown) => poner(j, ["candidatas", 0, "solucion"], 3)],
    ["las habilidades de una pregunta no son textos", (j: unknown) => poner(j, ["candidatas", 0, "habilidades"], [1])],
    ["una descripción de habilidad no es texto", (j: unknown) => poner(j, ["contexto", "descripcionesDeHabilidad", "h1"], 5)],
  ])("rechaza una foto en que %s", (_caso, estropear) => {
    const json = JSON.parse(JSON.stringify(foto()));
    estropear(json);
    expect(leerFotoDelBanco(json)).toMatchObject({ ok: false, motivo: "forma" });
  });
});

describe("entradaDeLaFila", () => {
  it("arma una entrada que el motor acepta, con lo de la fila y lo del contexto", () => {
    const original = foto();
    const leido = entradaDeLaFila(filaDe({ semilla: 4_294_967_295, vistas_antes: ["P9"] }));
    expect(leido).not.toBeNull();
    if (!leido) return;
    const { entrada, contexto, pasos } = leido;
    expect(entrada.habilidades).toEqual(original.contexto.habilidades);
    expect(entrada.misconcepciones).toEqual(original.contexto.misconcepciones);
    expect(entrada.candidatas).toEqual(original.candidatas);
    expect(entrada.vistasAntes).toEqual(["P9"]);
    expect(entrada.semilla).toBe(4_294_967_295);
    expect(contexto.materia.codigo).toBe("MAT-1");
    expect(contexto.descripcionesDeHabilidad.h9).toBe("Una de fuera de la Evaluación");
    expect(pasos).toEqual([]);
    expect(() => maximoDePreguntas(entrada)).not.toThrow();
    expect(() => siguientePregunta(entrada, pasos)).not.toThrow();
    // P1 a P6 sin vistas: el menor entre 20, el doble de las 2 habilidades y las 6 libres.
    expect(maximoDePreguntas(entrada)).toBe(4);
  });

  it("las vistas antes de la fila sacan esas preguntas del maximo y de la elección", () => {
    const leido = entradaDeLaFila(filaDe({ vistas_antes: ["P1", "P2", "P3", "P4", "P6"] }));
    if (!leido) throw new Error("la fila debía leerse");
    // Queda una sola libre (P5): el máximo es el menor entre 20, el doble de las habilidades con libres y las libres.
    expect(maximoDePreguntas(leido.entrada)).toBe(1);
    const siguiente = siguientePregunta(leido.entrada, []);
    expect("terminado" in siguiente).toBe(false);
    if (!("terminado" in siguiente)) expect(siguiente.clave).toBe("P5");
  });

  it("es determinista: la misma fila da la misma pregunta y el mismo orden de opciones", () => {
    const una = entradaDeLaFila(filaDe({ semilla: 42 }));
    const otra = entradaDeLaFila(filaDe({ semilla: 42 }));
    if (!una || !otra) throw new Error("la fila debía leerse");
    const a = siguientePregunta(una.entrada, []);
    const b = siguientePregunta(otra.entrada, []);
    expect(a).toEqual(b);
    // Con otra semilla el diagnóstico es otro (en al menos una de varias).
    const distintas = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(siguientePregunta(entradaDeLaFila(filaDe({ semilla: i + 1 }))!.entrada, []))));
    expect(distintas.size).toBeGreaterThan(1);
  });

  it("lee los pasos ya respondidos y el motor sigue donde iba", () => {
    const entrada = entradaDeLaFila(filaDe())!.entrada;
    const respondidos = responder(entrada, 3);
    expect(respondidos).toHaveLength(3);
    const leido = entradaDeLaFila(filaDe({ pasos: JSON.parse(JSON.stringify(respondidos)), paso: 3 }));
    if (!leido) throw new Error("la fila debía leerse");
    expect(leido.pasos).toEqual(respondidos);
    expect(siguientePregunta(leido.entrada, leido.pasos)).toEqual(siguientePregunta(entrada, respondidos));
    expect(calificar(leido.entrada, leido.pasos)).toEqual(calificar(entrada, respondidos));
  });

  it("la foto manda: editar o retirar una pregunta del banco después no cambia la pregunta pendiente ni las respondidas", () => {
    const banco = foto();
    const fila = filaDe({}, banco);
    const antes = entradaDeLaFila(fila)!;
    const pendienteAntes = siguientePregunta(antes.entrada, []);
    if ("terminado" in pendienteAntes) throw new Error("debía haber una pregunta");

    // El banco de hoy cambia: otro enunciado, otra correcta, y la pregunta pendiente se retira.
    const editada = banco.candidatas.find((c) => c.clave === pendienteAntes.clave) as PreguntaCandidata;
    editada.enunciado = "Enunciado editado en el banco";
    editada.opciones[0].correcta = false;
    banco.candidatas = banco.candidatas.filter((c) => c.clave !== pendienteAntes.clave);

    const despues = entradaDeLaFila(fila)!;
    const pendienteDespues = siguientePregunta(despues.entrada, []);
    expect(pendienteDespues).toEqual(pendienteAntes);
    expect(candidataDe(despues.entrada, pendienteAntes.clave).enunciado).toBe(`Enunciado de ${pendienteAntes.clave}`);
    expect(candidataDe(despues.entrada, pendienteAntes.clave).opciones[0].correcta).toBe(true);
  });

  it("una fila de otra versión del formato se trata como inexistente", () => {
    const fila = filaDe();
    (fila.contexto as { version: number }).version = VERSION_DEL_CONTEXTO + 1;
    expect(entradaDeLaFila(fila)).toBeNull();
  });

  it("una fila de esta versión con una pregunta que no sirve lanza, con el id de la fila y sin el texto de la pregunta", () => {
    const fila = filaDe();
    (fila.candidatas as { opciones: unknown[] }[])[0].opciones.pop();
    expect(() => entradaDeLaFila(fila)).toThrow(fila.id);
    try {
      entradaDeLaFila(fila);
    } catch (error) {
      expect(String(error)).toContain("P1");
      expect(String(error)).not.toContain("Enunciado de P1");
    }
  });

  it("lanza si un paso guardado no sirve", () => {
    const entrada = entradaDeLaFila(filaDe())!.entrada;
    const respondidos = JSON.parse(JSON.stringify(responder(entrada, 1)));
    for (const estropear of [
      (p: unknown) => poner(p, ["orden"], ["A", "A", "B", "C"]),
      (p: unknown) => poner(p, ["orden"], ["A", "B", "C"]),
      (p: unknown) => poner(p, ["letraElegida"], "E"),
      (p: unknown) => quitar(p, ["fecha"]),
      (p: unknown) => poner(p, ["opciones"], []),
    ]) {
      const paso = JSON.parse(JSON.stringify(respondidos[0]));
      estropear(paso);
      expect(() => entradaDeLaFila(filaDe({ pasos: [paso], paso: 1 }))).toThrow("pasos");
    }
    expect(() => entradaDeLaFila(filaDe({ pasos: {} as never }))).toThrow("pasos");
  });
});

describe("candidataDe", () => {
  it("devuelve la candidata de la entrada con esa clave", () => {
    const entrada = entradaDeLaFila(filaDe())!.entrada;
    expect(candidataDe(entrada, "P4")).toBe(entrada.candidatas.find((c) => c.clave === "P4"));
  });

  it("lanza, con la clave, si no está", () => {
    const entrada = entradaDeLaFila(filaDe())!.entrada;
    expect(() => candidataDe(entrada, "P99")).toThrow("P99");
  });
});
