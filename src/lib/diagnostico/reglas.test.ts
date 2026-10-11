import { describe, expect, it } from "vitest";
import {
  CLAVES_PERMITIDAS_AL_NAVEGADOR,
  CLAVES_PROHIBIDAS_AL_NAVEGADOR,
  HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO,
  clavesNoPermitidas,
  esLetra,
  esPasoValido,
  esUuid,
  proyectarEnCurso,
  proyectarNinguno,
  proyectarNoDisponible,
  proyectarSinPreguntas,
  proyectarTerminado,
  type DatosDeEnCurso,
} from "./reglas";

// HU-081: lo puro del servidor del diagnóstico. Los validadores de lo que llega del navegador y la proyección de lo que vuelve.

const UUID = "3f8a9c52-7d1e-4b6a-9e20-5c4d8a1b7f03";

describe("HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO (D-49 d)", () => {
  it("son 2, como privado.vigencia_del_diagnostico_en_curso()", () => {
    expect(HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO).toBe(2);
  });
});

describe("esUuid", () => {
  it("acepta un UUID en minúscula, en mayúscula y mezclado", () => {
    expect(esUuid(UUID)).toBe(true);
    expect(esUuid(UUID.toUpperCase())).toBe(true);
    expect(esUuid("3F8a9c52-7d1e-4B6a-9e20-5c4d8a1b7f03")).toBe(true);
  });

  it("rechaza lo que se parece pero no lo es", () => {
    expect(esUuid("")).toBe(false);
    expect(esUuid(` ${UUID}`)).toBe(false);
    expect(esUuid(`${UUID} `)).toBe(false);
    expect(esUuid(`${UUID}\n`)).toBe(false);
    expect(esUuid(UUID.slice(0, -1))).toBe(false);
    expect(esUuid(`${UUID}0`)).toBe(false);
    expect(esUuid(UUID.replaceAll("-", ""))).toBe(false);
    expect(esUuid(UUID.replace("f03", "g03"))).toBe(false);
    expect(esUuid("abc")).toBe(false);
  });

  it("rechaza lo que no es un texto", () => {
    for (const valor of [null, undefined, 1, true, {}, [], [UUID], { toString: () => UUID }]) expect(esUuid(valor)).toBe(false);
  });
});

describe("esPasoValido", () => {
  it("acepta los enteros no negativos", () => {
    for (const valor of [0, 1, 7, 19, 20]) expect(esPasoValido(valor)).toBe(true);
  });

  it("rechaza fracciones, negativos, textos y lo que no es un número finito", () => {
    for (const valor of [1.5, -1, -0.5, "1", "", NaN, Infinity, -Infinity, null, undefined, {}, [], [1], true]) {
      expect(esPasoValido(valor)).toBe(false);
    }
  });
});

describe("esLetra", () => {
  it("acepta de la A a la D en mayúscula", () => {
    for (const letra of ["A", "B", "C", "D"]) expect(esLetra(letra)).toBe(true);
  });

  it("rechaza minúsculas, otras letras, textos largos y lo que no es un texto", () => {
    for (const valor of ["a", "d", "E", "AB", " A", "A ", "", "0", 1, null, undefined, ["A"], {}]) expect(esLetra(valor)).toBe(false);
  });
});

// Lo que recibiría la proyección si alguien le pasara de más: una fila de la base y la pregunta con todo.
function datosConDeMas(): DatosDeEnCurso {
  const pregunta = {
    enunciado: "¿Cuánto es 2 + 2?",
    opciones: [
      { letra: "A", texto: "3", correcta: false, misconcepcion: "suma.mal", error: "No sumó bien", clave: "P1" },
      { letra: "B", texto: "4", correcta: true, misconcepcion: null, error: null, clave: "P1" },
      { letra: "C", texto: "5", correcta: false, misconcepcion: "suma.otra", error: null, clave: "P1" },
      { letra: "D", texto: "22", correcta: false, misconcepcion: "suma.junta", error: null, clave: "P1" },
    ],
    clave: "P1",
    dificultad: 2,
    habilidades: ["suma"],
    solucion: "La solución de P1",
    semilla: 4_294_967_295,
  };
  // También de más en el primer nivel: una fila de la base con la semilla, las candidatas y los pasos.
  const fila = { semilla: 4_294_967_295, candidatas: [{ clave: "P1" }], pasos: [], token_recuperacion: "t".repeat(64), faltaMaterial: [] };
  return {
    ...fila,
    idDiagnostico: UUID,
    evaluacion: { id: "e1", nombre: "Parcial 1", semilla: 123_456_789, token_recuperacion: "t".repeat(64) } as DatosDeEnCurso["evaluacion"],
    materia: { codigo: "MATE-1", nombre: "Matemáticas", id: "m1", candidatas: [] } as DatosDeEnCurso["materia"],
    paso: 2,
    maximo: 6,
    pregunta: pregunta as DatosDeEnCurso["pregunta"],
  };
}

describe("lo que vuelve al navegador", () => {
  it("proyectarEnCurso construye objetos nuevos con las claves permitidas y nada más", () => {
    const datos = datosConDeMas();
    const salida = proyectarEnCurso(datos);
    expect(salida).toEqual({
      estado: "en_curso",
      idDiagnostico: UUID,
      evaluacion: { id: "e1", nombre: "Parcial 1" },
      materia: { codigo: "MATE-1", nombre: "Matemáticas" },
      paso: 2,
      maximo: 6,
      pregunta: {
        enunciado: "¿Cuánto es 2 + 2?",
        opciones: [
          { letra: "A", texto: "3" },
          { letra: "B", texto: "4" },
          { letra: "C", texto: "5" },
          { letra: "D", texto: "22" },
        ],
      },
    });
    expect(clavesNoPermitidas(salida)).toEqual([]);
    // Objetos nuevos: no son los que entraron.
    expect(salida.evaluacion).not.toBe(datos.evaluacion);
    expect(salida.materia).not.toBe(datos.materia);
    expect(salida.pregunta).not.toBe(datos.pregunta);
    expect(salida.pregunta.opciones[0]).not.toBe(datos.pregunta.opciones[0]);
  });

  it("ninguna de las cinco formas lleva algo de lo prohibido, ni como clave ni como valor", () => {
    const formas = [
      proyectarEnCurso(datosConDeMas()),
      proyectarEnCurso({ ...datosConDeMas(), paso: 0, maximo: 0 }),
      proyectarSinPreguntas(UUID),
      proyectarSinPreguntas(null),
      proyectarTerminado(UUID),
      proyectarNinguno(),
      proyectarNoDisponible("evaluacion"),
      proyectarNoDisponible("cuenta_del_equipo"),
    ];
    for (const forma of formas) {
      expect(clavesNoPermitidas(forma)).toEqual([]);
      const texto = JSON.stringify(forma);
      for (const prohibida of CLAVES_PROHIBIDAS_AL_NAVEGADOR) expect(texto).not.toContain(`"${prohibida}"`);
      for (const secreto of ["4294967295", "123456789", "La solución de P1", "No sumó bien", "suma.mal", "P1", "t".repeat(64)]) {
        expect(texto).not.toContain(secreto);
      }
    }
  });

  it("las formas de cada estado", () => {
    expect(proyectarSinPreguntas(UUID)).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: UUID });
    expect(proyectarSinPreguntas(null)).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: null });
    expect(proyectarTerminado(UUID)).toEqual({ estado: "terminado", idDiagnostico: UUID });
    expect(proyectarNinguno()).toEqual({ estado: "ninguno" });
    expect(proyectarNoDisponible("evaluacion")).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(proyectarNoDisponible("cuenta_del_equipo")).toEqual({ estado: "no_disponible", motivo: "cuenta_del_equipo" });
  });
});

describe("clavesNoPermitidas", () => {
  it("encuentra las claves de fuera a cualquier profundidad, en objetos y en listas", () => {
    const sucio = {
      estado: "en_curso",
      pregunta: { enunciado: "x", opciones: [{ letra: "A", texto: "y", correcta: true }, { letra: "B", texto: "z", solucion: "s" }] },
      pasos: [],
    };
    expect(clavesNoPermitidas(sucio).sort()).toEqual(["correcta", "pasos", "solucion"]);
  });

  it("no se queja de valores sueltos ni de lo vacío", () => {
    for (const valor of [null, undefined, 1, "clave", [], {}, [[]], [null, 3]]) expect(clavesNoPermitidas(valor)).toEqual([]);
  });

  it("la lista permitida y la prohibida no comparten ninguna clave", () => {
    for (const clave of CLAVES_PROHIBIDAS_AL_NAVEGADOR) expect(CLAVES_PERMITIDAS_AL_NAVEGADOR).not.toContain(clave);
  });
});
