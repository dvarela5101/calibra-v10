import { describe, expect, it } from "vitest";
import { FILA_DE_EJEMPLO } from "../../../pruebas/diagnostico-sembrado";
import { proyectarResultado } from "./mostrar";
import {
  CLAVES_DE_LAS_ACCIONES,
  decidirEnvioDeRespuesta,
  errorDeSeleccion,
  llamarSinCaerse,
  ordenarMaterias,
  pantallaInicial,
  resolverSeleccion,
  siguientePantalla,
  traducirEmpezar,
  traducirResponder,
  type MateriaConEvaluaciones,
  type PantallaDelRecorrido,
  type ResultadoDeEmpezar,
  type ResultadoDeResponder,
} from "./pantalla";
import { TEXTOS } from "./presentacion";
import {
  CLAVES_PROHIBIDAS_AL_NAVEGADOR,
  clavesNoPermitidas,
  proyectarEnCurso,
  proyectarNinguno,
  proyectarNoDisponible,
  proyectarSinPreguntas,
  proyectarTerminado,
  type EnCurso,
} from "./reglas";

// HU-009: lo puro de las pantallas: lo que devuelven las acciones, las transiciones del recorrido y el orden del selector.

const ID_A = "a1000000-0000-4000-8000-000000000001";
const ID_B = "b2000000-0000-4000-8000-000000000002";

function enCurso(idDiagnostico = ID_A, paso = 0): EnCurso {
  return proyectarEnCurso({
    idDiagnostico,
    evaluacion: { id: "e0000000-0000-4000-8000-00000000000a", nombre: "Parcial 1" },
    materia: { codigo: "FISI-1018", nombre: "Física II" },
    paso,
    maximo: 8,
    pregunta: {
      enunciado: "¿Cuánto vale $2 + 2$?",
      opciones: [
        { letra: "A", texto: "3" },
        { letra: "B", texto: "4" },
        { letra: "C", texto: "5" },
        { letra: "D", texto: "6" },
      ],
    },
  });
}

const ultimo = proyectarResultado(FILA_DE_EJEMPLO);

describe("traducirEmpezar", () => {
  it("una pregunta pendiente pasa tal cual", () => {
    const pendiente = enCurso();
    expect(traducirEmpezar(pendiente, null)).toEqual({ tipo: "pregunta", enCurso: pendiente });
  });

  it("sin preguntas nuevas lleva el último resultado, y no el id de otro diagnóstico (D-51)", () => {
    const respuesta = traducirEmpezar(proyectarSinPreguntas(ID_B), ultimo);
    expect(respuesta).toEqual({ tipo: "sin_preguntas", ultimo });
    expect(JSON.stringify(respuesta)).not.toContain(ID_B);
    expect(Object.keys(respuesta)).not.toContain("idUltimoDiagnostico");
  });

  it("sin preguntas nuevas y sin último resultado, el mensaje y la pregunta salen igual", () => {
    expect(traducirEmpezar(proyectarSinPreguntas(null), null)).toEqual({ tipo: "sin_preguntas", ultimo: null });
    expect(traducirEmpezar(proyectarSinPreguntas(ID_B), null)).toEqual({ tipo: "sin_preguntas", ultimo: null });
  });

  it("una Evaluación que no está disponible dice «Esa evaluación no está disponible»", () => {
    expect(traducirEmpezar(proyectarNoDisponible("evaluacion"), null)).toEqual({ tipo: "no_disponible", mensaje: "Esa evaluación no está disponible" });
  });

  it("una cuenta del equipo recibe el aviso de agendar", () => {
    expect(traducirEmpezar(proyectarNoDisponible("cuenta_del_equipo"), null)).toEqual({ tipo: "error", mensaje: TEXTOS.cuentaDelEquipo });
  });
});

describe("traducirResponder", () => {
  it("la pregunta siguiente del mismo diagnóstico es una pregunta", () => {
    const siguiente = enCurso(ID_A, 1);
    expect(traducirResponder(siguiente, ID_A)).toEqual({ tipo: "pregunta", enCurso: siguiente });
  });

  it("un id en mayúsculas es el mismo diagnóstico, como lo entiende el servidor", () => {
    expect(traducirResponder(enCurso(ID_A, 1), ID_A.toUpperCase()).tipo).toBe("pregunta");
  });

  it("un diagnóstico en curso con otro id es que la persona empezó otro: «reemplazado»", () => {
    const otro = enCurso(ID_B);
    expect(traducirResponder(otro, ID_A)).toEqual({ tipo: "reemplazado", enCurso: otro });
  });

  it("si el id pedido no era un texto, lo que vuelve no es «la misma pregunta»", () => {
    expect(traducirResponder(enCurso(ID_A), undefined).tipo).toBe("reemplazado");
    expect(traducirResponder(enCurso(ID_A), 5).tipo).toBe("reemplazado");
  });

  it("terminado lleva la ruta del resultado", () => {
    expect(traducirResponder(proyectarTerminado(ID_A), ID_A)).toEqual({ tipo: "terminado", ruta: `/diagnostico/resultado/${ID_A}` });
  });

  it("ninguno es un diagnóstico vencido", () => {
    expect(traducirResponder(proyectarNinguno(), ID_A)).toEqual({ tipo: "vencido" });
  });
});

describe("lo que sale hacia el navegador (criterio 13)", () => {
  const respuestasDeEmpezar: ResultadoDeEmpezar[] = [
    traducirEmpezar(enCurso(), null),
    traducirEmpezar(proyectarSinPreguntas(ID_B), ultimo),
    traducirEmpezar(proyectarSinPreguntas(null), null),
    traducirEmpezar(proyectarNoDisponible("evaluacion"), null),
    traducirEmpezar(proyectarNoDisponible("cuenta_del_equipo"), null),
  ];
  const respuestasDeResponder: ResultadoDeResponder[] = [
    traducirResponder(enCurso(ID_A, 1), ID_A),
    traducirResponder(enCurso(ID_B), ID_A),
    traducirResponder(proyectarTerminado(ID_A), ID_A),
    traducirResponder(proyectarNinguno(), ID_A),
  ];

  it("las claves de primer nivel de toda respuesta están en CLAVES_DE_LAS_ACCIONES", () => {
    for (const respuesta of [...respuestasDeEmpezar, ...respuestasDeResponder]) {
      expect(Object.keys(respuesta).filter((clave) => !CLAVES_DE_LAS_ACCIONES.includes(clave)), JSON.stringify(respuesta)).toEqual([]);
    }
  });

  it("el enCurso que viaja solo tiene claves de la lista permitida del módulo", () => {
    for (const respuesta of [...respuestasDeEmpezar, ...respuestasDeResponder]) {
      if ("enCurso" in respuesta) expect(clavesNoPermitidas(respuesta.enCurso)).toEqual([]);
    }
    expect(respuestasDeEmpezar.filter((r) => "enCurso" in r)).toHaveLength(1);
    expect(respuestasDeResponder.filter((r) => "enCurso" in r)).toHaveLength(2);
  });

  it("el último resultado de D-51 sale con una proyección sin claves internas", () => {
    const json = JSON.stringify(respuestasDeEmpezar[1]);
    for (const prohibida of CLAVES_PROHIBIDAS_AL_NAVEGADOR.filter((clave) => clave !== "habilidades")) {
      expect(json, prohibida).not.toContain(`"${prohibida}"`);
    }
  });
});

describe("siguientePantalla (B8)", () => {
  type Selector = Extract<PantallaDelRecorrido, { tipo: "selector" }>;
  type Pregunta = Extract<PantallaDelRecorrido, { tipo: "pregunta" }>;
  type SinPreguntas = Extract<PantallaDelRecorrido, { tipo: "sin_preguntas" }>;
  const selector = (cambios: Partial<Selector> = {}): Selector => ({ tipo: "selector", enCurso: null, mensaje: null, enfocar: false, ...cambios });
  const pregunta = (cambios: Partial<Pregunta> = {}): Pregunta => ({ tipo: "pregunta", enCurso: enCurso(ID_A, 2), mensaje: null, enfocar: false, ...cambios });
  const sinPreguntas = (cambios: Partial<SinPreguntas> = {}): SinPreguntas => ({
    tipo: "sin_preguntas",
    idEvaluacion: "e0000000-0000-4000-8000-00000000000a",
    ultimo,
    enCursoPrevio: enCurso(ID_B),
    mensaje: null,
    enfocar: false,
    ...cambios,
  });
  const empezo = (respuesta: ResultadoDeEmpezar, idEvaluacion = "e0000000-0000-4000-8000-00000000000a") => ({ tipo: "empezo", idEvaluacion, respuesta }) as const;

  it("la pantalla con que carga la página: la pregunta pendiente o el selector, sin robar el foco", () => {
    const pendiente = enCurso(ID_A, 3);
    expect(pantallaInicial(pendiente)).toEqual({ tipo: "pregunta", enCurso: pendiente, mensaje: null, enfocar: false });
    expect(pantallaInicial(null)).toEqual({ tipo: "selector", enCurso: null, mensaje: null, enfocar: false });
  });

  describe("cambiar de materia", () => {
    it("desde la pregunta va al selector con el diagnóstico en curso, para el aviso del criterio 7", () => {
      const actual = pregunta();
      expect(siguientePantalla(actual, { tipo: "cambiar_materia" })).toEqual({ tipo: "selector", enCurso: actual.enCurso, mensaje: null, enfocar: true });
    });

    it("desde otra pantalla no cambia nada", () => {
      expect(siguientePantalla(selector(), { tipo: "cambiar_materia" })).toEqual(selector());
      expect(siguientePantalla(sinPreguntas(), { tipo: "cambiar_materia" })).toEqual(sinPreguntas());
    });
  });

  describe("empezar", () => {
    it("una pregunta pendiente lleva a la pregunta, con el foco", () => {
      const primera = enCurso(ID_B);
      expect(siguientePantalla(selector(), empezo({ tipo: "pregunta", enCurso: primera }))).toEqual({ tipo: "pregunta", enCurso: primera, mensaje: null, enfocar: true });
    });

    it("sin preguntas nuevas lleva a D-51 guardando el diagnóstico que seguía en curso y la Evaluación pedida", () => {
      const enMarcha = enCurso(ID_A);
      const idEvaluacion = "e0000000-0000-4000-8000-0000000000bb";
      expect(siguientePantalla(selector({ enCurso: enMarcha }), empezo({ tipo: "sin_preguntas", ultimo }, idEvaluacion))).toEqual({
        tipo: "sin_preguntas",
        idEvaluacion,
        ultimo,
        enCursoPrevio: enMarcha,
        mensaje: null,
        enfocar: true,
      });
    });

    it("sin preguntas nuevas y sin último resultado, la pantalla sale igual", () => {
      const siguiente = siguientePantalla(selector(), empezo({ tipo: "sin_preguntas", ultimo: null }));
      expect(siguiente).toMatchObject({ tipo: "sin_preguntas", ultimo: null, enCursoPrevio: null });
    });

    it("una Evaluación que no está disponible vuelve al selector con el mensaje, sin perder el aviso de lo que sigue en curso", () => {
      const enMarcha = enCurso(ID_A);
      expect(siguientePantalla(selector({ enCurso: enMarcha }), empezo({ tipo: "no_disponible", mensaje: TEXTOS.evaluacionNoDisponible }))).toEqual({
        tipo: "selector",
        enCurso: enMarcha,
        mensaje: "Esa evaluación no está disponible",
        enfocar: true,
      });
    });

    it("un error desde el selector se queda en el selector con el mensaje, y no mueve el foco", () => {
      const enMarcha = enCurso(ID_A);
      expect(siguientePantalla(selector({ enCurso: enMarcha }), empezo({ tipo: "error", mensaje: "No pudimos empezar el diagnóstico. Inténtalo de nuevo." }))).toEqual({
        tipo: "selector",
        enCurso: enMarcha,
        mensaje: "No pudimos empezar el diagnóstico. Inténtalo de nuevo.",
        enfocar: false,
      });
    });

    it("un error de «Sí, volver a tomarlo» se queda en D-51 con su mensaje y su último resultado (M45)", () => {
      const actual = sinPreguntas();
      const siguiente = siguientePantalla(actual, empezo({ tipo: "error", mensaje: "No pudimos empezar el diagnóstico. Inténtalo de nuevo." }));
      expect(siguiente).toEqual({ ...actual, mensaje: "No pudimos empezar el diagnóstico. Inténtalo de nuevo.", enfocar: false });
      expect(siguiente.tipo).toBe("sin_preguntas");
    });

    it("«Sí, volver a tomarlo» que empieza lleva a la pregunta", () => {
      const nueva = enCurso(ID_B);
      expect(siguientePantalla(sinPreguntas(), empezo({ tipo: "pregunta", enCurso: nueva }))).toEqual({ tipo: "pregunta", enCurso: nueva, mensaje: null, enfocar: true });
    });

    it("«Sí, volver a tomarlo» con la Evaluación apagada vuelve al selector con el aviso de lo que seguía en curso", () => {
      const actual = sinPreguntas();
      expect(siguientePantalla(actual, empezo({ tipo: "no_disponible", mensaje: TEXTOS.evaluacionNoDisponible }))).toEqual({
        tipo: "selector",
        enCurso: actual.enCursoPrevio,
        mensaje: TEXTOS.evaluacionNoDisponible,
        enfocar: true,
      });
    });
  });

  describe("«No» (D-51)", () => {
    it("vuelve al selector con el diagnóstico que seguía en curso (M24) y sin mensaje", () => {
      const previo = enCurso(ID_A, 4);
      expect(siguientePantalla(sinPreguntas({ enCursoPrevio: previo, mensaje: "x" }), { tipo: "no" })).toEqual({
        tipo: "selector",
        enCurso: previo,
        mensaje: null,
        enfocar: true,
      });
    });

    it("sin diagnóstico previo, el selector queda sin aviso", () => {
      expect(siguientePantalla(sinPreguntas({ enCursoPrevio: null }), { tipo: "no" })).toMatchObject({ tipo: "selector", enCurso: null });
    });

    it("desde otra pantalla no cambia nada", () => {
      expect(siguientePantalla(pregunta(), { tipo: "no" })).toEqual(pregunta());
    });
  });

  describe("responder", () => {
    const respondio = (respuesta: ResultadoDeResponder) => ({ tipo: "respondio", respuesta }) as const;

    it("la siguiente pregunta reemplaza a la actual, con el foco y sin mensaje", () => {
      const siguiente = enCurso(ID_A, 3);
      expect(siguientePantalla(pregunta({ mensaje: "No pudimos guardar tu respuesta. Inténtalo de nuevo." }), respondio({ tipo: "pregunta", enCurso: siguiente }))).toEqual({
        tipo: "pregunta",
        enCurso: siguiente,
        mensaje: null,
        enfocar: true,
      });
    });

    it("un error deja la misma pregunta con el mensaje, sin cambiarla (la opción elegida se conserva) y sin mover el foco", () => {
      const actual = pregunta();
      const siguiente = siguientePantalla(actual, respondio({ tipo: "error", mensaje: TEXTOS.errorAlResponder }));
      expect(siguiente).toEqual({ ...actual, mensaje: TEXTOS.errorAlResponder, enfocar: false });
      expect(siguiente.tipo === "pregunta" && siguiente.enCurso === actual.enCurso).toBe(true);
    });

    it("un diagnóstico vencido lleva al selector con «Ese diagnóstico ya no está. Empieza uno nuevo.» y sin aviso de lo que sigue", () => {
      expect(siguientePantalla(pregunta(), respondio({ tipo: "vencido" }))).toEqual({
        tipo: "selector",
        enCurso: null,
        mensaje: "Ese diagnóstico ya no está. Empieza uno nuevo.",
        enfocar: true,
      });
    });

    it("un diagnóstico reemplazado lleva al selector con ese mensaje y el aviso del que sí está en curso", () => {
      const otro = enCurso(ID_B);
      expect(siguientePantalla(pregunta(), respondio({ tipo: "reemplazado", enCurso: otro }))).toEqual({
        tipo: "selector",
        enCurso: otro,
        mensaje: "Ese diagnóstico ya no está. Empieza uno nuevo.",
        enfocar: true,
      });
    });

    it("terminado no cambia la pantalla: el cliente navega", () => {
      const actual = pregunta();
      expect(siguientePantalla(actual, respondio({ tipo: "terminado", ruta: `/diagnostico/resultado/${ID_A}` }))).toBe(actual);
    });

    it("una respuesta que llega a una pantalla que no es la pregunta no la cambia", () => {
      const actual = selector();
      expect(siguientePantalla(actual, respondio({ tipo: "vencido" }))).toBe(actual);
    });
  });
});

describe("llamarSinCaerse", () => {
  it("devuelve lo que responde la acción", async () => {
    const respuesta: ResultadoDeResponder = { tipo: "vencido" };
    expect(await llamarSinCaerse(async () => respuesta, "x")).toBe(respuesta);
  });

  it("un TypeError: Failed to fetch es un error de la pantalla y no una excepción", async () => {
    const llamada = async (): Promise<ResultadoDeResponder> => {
      throw new TypeError("Failed to fetch");
    };
    await expect(llamarSinCaerse(llamada, TEXTOS.errorAlResponder)).resolves.toEqual({ tipo: "error", mensaje: TEXTOS.errorAlResponder });
  });

  it("tampoco cae si la acción lanza otra cosa", async () => {
    const llamada = async (): Promise<ResultadoDeEmpezar> => {
      throw new Error("lo que sea");
    };
    await expect(llamarSinCaerse(llamada, TEXTOS.errorAlEmpezar)).resolves.toEqual({ tipo: "error", mensaje: TEXTOS.errorAlEmpezar });
  });
});

describe("ordenarMaterias (B5)", () => {
  const materia = (codigo: string, nombre: string, evaluaciones: MateriaConEvaluaciones["evaluaciones"] = []): MateriaConEvaluaciones => ({ codigo, nombre, evaluaciones });
  const evaluacion = (id: string, nombre: string, semana: number) => ({ id, nombre, semana, temas: [] });

  it("«Álgebra Lineal» antes que «Física II» y que «Zoología», aunque la base las mande en otro orden", () => {
    const orden = ordenarMaterias([materia("ZOOL-1", "Zoología"), materia("FISI-2", "Física II"), materia("ALGE-1", "Álgebra Lineal")]);
    expect(orden.map((m) => m.nombre)).toEqual(["Álgebra Lineal", "Física II", "Zoología"]);
  });

  it("con el mismo nombre, desempata por código", () => {
    const orden = ordenarMaterias([materia("MATE-2", "Cálculo"), materia("MATE-1", "Cálculo")]);
    expect(orden.map((m) => m.codigo)).toEqual(["MATE-1", "MATE-2"]);
  });

  it("las Evaluaciones van por semana, luego por nombre y luego por id", () => {
    const [ordenada] = ordenarMaterias([
      materia("FISI-2", "Física II", [
        evaluacion("id-4", "Parcial 2", 8),
        evaluacion("id-3", "Parcial 1", 4),
        evaluacion("id-2", "Álgebra de vectores", 4),
        evaluacion("id-1", "Álgebra de vectores", 4),
      ]),
    ]);
    expect(ordenada.evaluaciones.map((e) => e.id)).toEqual(["id-1", "id-2", "id-3", "id-4"]);
  });

  it("devuelve listas nuevas y no cambia las que recibe", () => {
    const entrada = [materia("ZOOL-1", "Zoología", [evaluacion("b", "B", 2), evaluacion("a", "A", 1)]), materia("ALGE-1", "Álgebra")];
    const salida = ordenarMaterias(entrada);
    expect(entrada.map((m) => m.codigo)).toEqual(["ZOOL-1", "ALGE-1"]);
    expect(entrada[0].evaluaciones.map((e) => e.id)).toEqual(["b", "a"]);
    expect(salida).not.toBe(entrada);
  });

  it("sin materias da una lista vacía", () => {
    expect(ordenarMaterias([])).toEqual([]);
  });
});

describe("resolverSeleccion y errorDeSeleccion (criterio 2)", () => {
  const evaluacion = (id: string, nombre: string) => ({ id, nombre, semana: 4, temas: ["Cinemática"] });
  const FISICA: MateriaConEvaluaciones = { codigo: "FISI-1018", nombre: "Física II", evaluaciones: [evaluacion("e1", "Parcial 1")] };
  const CALCULO: MateriaConEvaluaciones = { codigo: "MATE-1214", nombre: "Cálculo", evaluaciones: [evaluacion("e2", "Parcial 1"), evaluacion("e3", "Parcial 2")] };

  it("con una sola Evaluación queda elegida sin que la persona haga nada", () => {
    expect(resolverSeleccion([FISICA, CALCULO], "FISI-1018", null)).toEqual({ materia: FISICA, evaluacion: FISICA.evaluaciones[0] });
  });

  it("con varias hay que elegir una", () => {
    expect(resolverSeleccion([FISICA, CALCULO], "MATE-1214", null)).toEqual({ materia: CALCULO, evaluacion: null });
    expect(resolverSeleccion([FISICA, CALCULO], "MATE-1214", "e3")).toEqual({ materia: CALCULO, evaluacion: CALCULO.evaluaciones[1] });
  });

  it("sin materia elegida no hay Evaluación, aunque haya un id guardado", () => {
    expect(resolverSeleccion([FISICA, CALCULO], null, "e3")).toEqual({ materia: null, evaluacion: null });
  });

  it("una Evaluación de otra materia no vale", () => {
    expect(resolverSeleccion([FISICA, CALCULO], "MATE-1214", "e1")).toEqual({ materia: CALCULO, evaluacion: null });
  });

  it("tras un router.refresh() la selección que ya no existe se descarta y no se envía", () => {
    // La materia desapareció de la lista (su única Evaluación se apagó).
    expect(resolverSeleccion([CALCULO], "FISI-1018", "e1")).toEqual({ materia: null, evaluacion: null });
    // La Evaluación elegida desapareció, pero la materia sigue con otra.
    const sinParcial2: MateriaConEvaluaciones = { ...CALCULO, evaluaciones: [CALCULO.evaluaciones[0], evaluacion("e4", "Final")] };
    expect(resolverSeleccion([sinParcial2], "MATE-1214", "e3")).toEqual({ materia: sinParcial2, evaluacion: null });
    expect(errorDeSeleccion(resolverSeleccion([sinParcial2], "MATE-1214", "e3"))).toBe("Elige una evaluación");
    expect(errorDeSeleccion(resolverSeleccion([CALCULO], "FISI-1018", "e1"))).toBe("Elige una materia");
  });

  it("errorDeSeleccion pide primero la materia, luego la Evaluación, y no dice nada si ya se eligió todo", () => {
    expect(errorDeSeleccion({ materia: null, evaluacion: null })).toBe("Elige una materia");
    expect(errorDeSeleccion({ materia: CALCULO, evaluacion: null })).toBe("Elige una evaluación");
    expect(errorDeSeleccion({ materia: FISICA, evaluacion: FISICA.evaluaciones[0] })).toBeNull();
  });
});

describe("decidirEnvioDeRespuesta (criterio 5)", () => {
  it("sin opción elegida pide que elija y no envía", () => {
    expect(decidirEnvioDeRespuesta(null, false)).toBe("falta_elegir");
  });

  it("con opción elegida envía", () => {
    for (const letra of ["A", "B", "C", "D"] as const) expect(decidirEnvioDeRespuesta(letra, false)).toBe("enviar");
  });

  it("mientras hay una llamada en curso no hace nada, elija o no (el doble clic envía una sola vez)", () => {
    expect(decidirEnvioDeRespuesta("B", true)).toBe("nada");
    expect(decidirEnvioDeRespuesta(null, true)).toBe("nada");
  });
});
