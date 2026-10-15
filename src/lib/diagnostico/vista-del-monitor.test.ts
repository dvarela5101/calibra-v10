import { describe, expect, it } from "vitest";
import {
  CENTINELA_DEL_MONITOR,
  erroresDeEjemplo,
  filaDeEjemplo,
  filaSinDiagnostico,
  filaSinRespuestasAutorizadas,
  habilidadesDeEjemplo,
  preguntasDeEjemplo,
} from "../../../pruebas/vista-del-monitor-ejemplo";
import type { NivelHabilidad } from "./motor";
import {
  agruparHabilidades,
  CLAVES_DE_LA_VISTA,
  CLAVES_DE_LA_VISTA_POR_NIVEL,
  ErrorDeVistaDelMonitor,
  etiquetaDeNivelParaElMonitor,
  leerVistaDelMonitor,
  marcaDeLaPregunta,
  TEXTOS,
  textoDeCorrectas,
  textoDeLasDominadas,
  textoDeRespuestas,
  textoDeVeces,
  type HabilidadParaElMonitor,
} from "./vista-del-monitor";

// HU-022: las reglas puras de lo que el monitor ve del diagnóstico de su cita: el lector estricto de lo que devuelve la base, el
// orden por nivel y los textos.

const leer = (fila: Record<string, unknown>) => leerVistaDelMonitor([fila]);

/** El error que lanza el lector con esa fila, para mirar su ruta y su mensaje. */
function errorDe(fila: Record<string, unknown>): ErrorDeVistaDelMonitor {
  try {
    leer(fila);
  } catch (error) {
    if (error instanceof ErrorDeVistaDelMonitor) return error;
    throw error;
  }
  throw new Error("El lector aceptó una fila que no cuadra.");
}

describe("leerVistaDelMonitor: lo que devuelve la base", () => {
  it("nada (`[]`, `null` o `undefined`) es una cita que no se ve: null, sin distinguir por qué", () => {
    expect(leerVistaDelMonitor([])).toBeNull();
    expect(leerVistaDelMonitor(null)).toBeNull();
    expect(leerVistaDelMonitor(undefined)).toBeNull();
  });

  it("una cita con diagnóstico y con las respuestas autorizadas, entera", () => {
    const vista = leer(filaDeEjemplo());
    expect(vista).not.toBeNull();
    expect(vista!.cita).toEqual({ fecha: "2026-10-12", hora: "10:00:00", duracionMin: 60, nombreMateria: "Física II", nombreEstudiante: "Camila Rojas" });
    const d = vista!.diagnostico!;
    expect(d).toMatchObject({ nombreEvaluacion: "Parcial 1", respondidas: 8, aciertos: 5, repetido: false });
    // La fecha de la base ("+00:00") sale como ISO con Z: el componente la formatea en hora de Bogotá.
    expect(d.fechaRealizacion).toBe("2026-10-05T04:30:00.000Z");
    expect(d.habilidades).toHaveLength(8);
    expect(d.habilidades[0]).toEqual({ descripcion: "calcula la fuerza neta con $F = ma$", nivel: "lo_domina", respuestas: 3, aciertos: 3 });
    expect(d.errores).toHaveLength(4);
    expect(d.errores[0]).toEqual({
      titulo: String.raw`usas $\frac{1}{2}$ sin cuadrar la velocidad`,
      estado: "confirmada",
      veces: 2,
      descripcionDeLaHabilidad: "interpreta gráficas de posición",
      detalles: ["Revisa qué magnitud va arriba."],
    });
    expect(d.errores[3].descripcionDeLaHabilidad).toBeNull();
    expect(d.prerrequisitos).toEqual([
      { materia: null, descripcion: "despeja una incógnita" },
      { materia: "Cálculo Diferencial", descripcion: "deriva polinomios" },
    ]);
    expect(d.preguntas).toHaveLength(8);
    expect(d.preguntas![1]).toEqual({
      enunciado: "Enunciado de la pregunta 2",
      opciones: [
        { letra: "A", texto: "Opción A de la pregunta 2" },
        { letra: "B", texto: "Opción B de la pregunta 2" },
        { letra: "C", texto: "Opción C de la pregunta 2" },
        { letra: "D", texto: "Opción D de la pregunta 2" },
      ],
      letraElegida: "A",
      letraCorrecta: "C",
      solucion: "Solución de la pregunta 2",
    });
    expect(d.preguntas![2].solucion).toBeNull();
  });

  it("una cita sin diagnóstico: la cabecera y `diagnostico` nulo", () => {
    const vista = leer(filaSinDiagnostico());
    expect(vista).toEqual({
      cita: { fecha: "2026-10-12", hora: "10:00:00", duracionMin: 60, nombreMateria: "Física II", nombreEstudiante: "Camila Rojas" },
      diagnostico: null,
    });
  });

  it("un Lead con el texto viejo: el resto de la vista y `preguntas` nulo", () => {
    const d = leer(filaSinRespuestasAutorizadas())!.diagnostico!;
    expect(d.preguntas).toBeNull();
    expect(d.habilidades).toHaveLength(8);
    expect(d.errores).toHaveLength(4);
  });

  it("`repetido` verdadero llega como verdadero", () => {
    expect(leer(filaDeEjemplo({ repetido: true }))!.diagnostico!.repetido).toBe(true);
  });

  it("acepta la hora con y sin segundos y la duración de cualquier tamaño positivo", () => {
    expect(leer(filaDeEjemplo({ hora: "09:30" }))!.cita.hora).toBe("09:30");
    expect(leer(filaDeEjemplo({ duracion_min: 1 }))!.cita.duracionMin).toBe(1);
  });

  it("un diagnóstico sin una sola respuesta cuadra si tampoco hay preguntas", () => {
    const d = leer(filaDeEjemplo({ respondidas: 0, aciertos: 0, preguntas: [] }))!.diagnostico!;
    expect(d.preguntas).toEqual([]);
  });

  it("construye objetos nuevos: cambiar la fila después no cambia la vista", () => {
    const fila = filaDeEjemplo();
    const vista = leer(fila)!;
    (fila.habilidades as { nivel: string }[])[0].nivel = "no_lo_domina";
    (fila.preguntas as { enunciado: string }[])[0].enunciado = "otro";
    expect(vista.diagnostico!.habilidades[0].nivel).toBe("lo_domina");
    expect(vista.diagnostico!.preguntas![0].enunciado).toBe("Enunciado de la pregunta 1");
  });

  it("las claves de más en la entrada no salen (criterio 13)", () => {
    const sucia = filaDeEjemplo({
      correo: CENTINELA_DEL_MONITOR,
      token_recuperacion: CENTINELA_DEL_MONITOR,
      semilla: 4242,
      id_lead: CENTINELA_DEL_MONITOR,
      habilidades: habilidadesDeEjemplo().map((h) => ({ ...h, habilidad: CENTINELA_DEL_MONITOR })),
      errores: erroresDeEjemplo().map((e) => ({ ...e, misconcepcion: CENTINELA_DEL_MONITOR, habilidad: CENTINELA_DEL_MONITOR })),
      prerrequisitos: [{ materia: null, descripcion: "despeja una incógnita", habilidad: CENTINELA_DEL_MONITOR }],
      preguntas: preguntasDeEjemplo().map((p) => ({
        ...p,
        clave: CENTINELA_DEL_MONITOR,
        dificultad: 3,
        orden: ["C", "A", "D", "B"],
        opciones: (p.opciones as Record<string, unknown>[]).map((o) => ({ ...o, correcta: true, misconcepcion: CENTINELA_DEL_MONITOR, error: CENTINELA_DEL_MONITOR })),
      })),
    });
    const vista = leer(sucia)!;
    expect(JSON.stringify(vista)).not.toContain(CENTINELA_DEL_MONITOR);
    // Cada nivel de la vista tiene exactamente las claves de la lista cerrada.
    const d = vista.diagnostico!;
    expect(Object.keys(vista.cita).sort()).toEqual(["duracionMin", "fecha", "hora", "nombreEstudiante", "nombreMateria"]);
    expect(Object.keys(d.habilidades[0]).sort()).toEqual([...CLAVES_DE_LA_VISTA_POR_NIVEL.habilidad].sort());
    expect(Object.keys(d.errores[0]).sort()).toEqual([...CLAVES_DE_LA_VISTA_POR_NIVEL.error].sort());
    expect(Object.keys(d.prerrequisitos[0]).sort()).toEqual([...CLAVES_DE_LA_VISTA_POR_NIVEL.prerrequisito].sort());
    expect(Object.keys(d.preguntas![0]).sort()).toEqual([...CLAVES_DE_LA_VISTA_POR_NIVEL.pregunta].sort());
    expect(Object.keys(d.preguntas![0].opciones[0]).sort()).toEqual([...CLAVES_DE_LA_VISTA_POR_NIVEL.opcion].sort());
  });
});

describe("leerVistaDelMonitor: lo que no cuadra lanza ErrorDeVistaDelMonitor con la ruta y sin el contenido", () => {
  /** Cada caso: la fila mala, la ruta que debe nombrar el error y, si lo hay, un valor suyo que el mensaje no debe traer. */
  const casos: [string, Record<string, unknown>, string, string?][] = [
    ["un nivel desconocido", filaDeEjemplo({ habilidades: [{ ...habilidadesDeEjemplo()[0], nivel: "valor-secreto-nivel" }] }), "habilidades[0].nivel", "valor-secreto-nivel"],
    ["un nivel que no es texto", filaDeEjemplo({ habilidades: [{ ...habilidadesDeEjemplo()[0], nivel: 3 }] }), "habilidades[0].nivel"],
    ["aciertos de una habilidad mayores que sus respuestas", filaDeEjemplo({ habilidades: [{ ...habilidadesDeEjemplo()[0], respuestas: 1, aciertos: 7919 }] }), "habilidades[0].aciertos", "7919"],
    ["respuestas negativas", filaDeEjemplo({ habilidades: [{ ...habilidadesDeEjemplo()[0], respuestas: -1 }] }), "habilidades[0].respuestas"],
    ["respuestas con decimales", filaDeEjemplo({ habilidades: [{ ...habilidadesDeEjemplo()[0], respuestas: 1.5 }] }), "habilidades[0].respuestas"],
    ["una descripción que no es texto", filaDeEjemplo({ habilidades: [{ ...habilidadesDeEjemplo()[0], descripcion: null }] }), "habilidades[0].descripcion"],
    ["una habilidad que no es un objeto", filaDeEjemplo({ habilidades: ["valor-secreto-habilidad"] }), "habilidades[0]", "valor-secreto-habilidad"],
    ["habilidades que no es una lista", filaDeEjemplo({ habilidades: { valor: "valor-secreto-lista" } }), "habilidades", "valor-secreto-lista"],
    ["un estado de error raro", filaDeEjemplo({ errores: [{ ...erroresDeEjemplo()[0], estado: "descartada" }] }), "errores[0].estado"],
    ["veces negativas", filaDeEjemplo({ errores: [{ ...erroresDeEjemplo()[0], veces: -2 }] }), "errores[0].veces"],
    ["un detalle que no es texto", filaDeEjemplo({ errores: [{ ...erroresDeEjemplo()[0], detalles: ["bien", 7] }] }), "errores[0].detalles[1]"],
    ["detalles que no es una lista", filaDeEjemplo({ errores: [{ ...erroresDeEjemplo()[0], detalles: null }] }), "errores[0].detalles"],
    ["un título de error que no es texto", filaDeEjemplo({ errores: [{ ...erroresDeEjemplo()[0], titulo: null }] }), "errores[0].titulo"],
    ["una materia de prerrequisito que no es texto ni nula", filaDeEjemplo({ prerrequisitos: [{ materia: 4, descripcion: "x" }] }), "prerrequisitos[0].materia"],
    ["tres opciones", filaDeEjemplo({ preguntas: [{ ...preguntasDeEjemplo()[0], opciones: (preguntasDeEjemplo()[0].opciones as unknown[]).slice(0, 3) }, ...preguntasDeEjemplo().slice(1)] }), "preguntas[0].opciones"],
    ["cinco opciones", filaDeEjemplo({ preguntas: [{ ...preguntasDeEjemplo()[0], opciones: [...(preguntasDeEjemplo()[0].opciones as unknown[]), { letra: "E", texto: "x" }] }, ...preguntasDeEjemplo().slice(1)] }), "preguntas[0].opciones"],
    [
      "una letra de opción E",
      filaDeEjemplo({ preguntas: [{ ...preguntasDeEjemplo()[0], opciones: ["A", "B", "C", "E"].map((letra) => ({ letra, texto: "x" })) }, ...preguntasDeEjemplo().slice(1)] }),
      "preguntas[0].opciones[3].letra",
    ],
    [
      "las letras de las opciones fuera de orden",
      filaDeEjemplo({ preguntas: [{ ...preguntasDeEjemplo()[0], opciones: ["B", "A", "C", "D"].map((letra) => ({ letra, texto: "x" })) }, ...preguntasDeEjemplo().slice(1)] }),
      "preguntas[0].opciones[0].letra",
    ],
    [
      "el texto de una opción que no es texto",
      filaDeEjemplo({ preguntas: [{ ...preguntasDeEjemplo()[0], opciones: ["A", "B", "C", "D"].map((letra) => ({ letra, texto: null })) }, ...preguntasDeEjemplo().slice(1)] }),
      "preguntas[0].opciones[0].texto",
    ],
    ["una letra elegida E", filaDeEjemplo({ preguntas: [{ ...preguntasDeEjemplo()[0], letraElegida: "E" }, ...preguntasDeEjemplo().slice(1)] }), "preguntas[0].letraElegida"],
    ["una letra elegida en minúscula", filaDeEjemplo({ preguntas: [{ ...preguntasDeEjemplo()[0], letraElegida: "b" }, ...preguntasDeEjemplo().slice(1)] }), "preguntas[0].letraElegida"],
    ["una letra correcta nula (ninguna opción es la correcta)", filaDeEjemplo({ preguntas: [{ ...preguntasDeEjemplo()[0], letraCorrecta: null }, ...preguntasDeEjemplo().slice(1)] }), "preguntas[0].letraCorrecta"],
    ["un enunciado que no es texto", filaDeEjemplo({ preguntas: [{ ...preguntasDeEjemplo()[0], enunciado: 5 }, ...preguntasDeEjemplo().slice(1)] }), "preguntas[0].enunciado"],
    ["una solución que no es texto ni nula", filaDeEjemplo({ preguntas: [{ ...preguntasDeEjemplo()[0], solucion: 5 }, ...preguntasDeEjemplo().slice(1)] }), "preguntas[0].solucion"],
    ["aciertos mayores que respondidas", filaDeEjemplo({ respondidas: 8, aciertos: 9 }), "aciertos", "9"],
    ["menos preguntas que respondidas", filaDeEjemplo({ preguntas: preguntasDeEjemplo().slice(0, 7) }), "preguntas"],
    ["más preguntas que respondidas", filaDeEjemplo({ respondidas: 7, aciertos: 5 }), "preguntas"],
    ["respuestas autorizadas con las preguntas nulas", filaDeEjemplo({ respuestas_autorizadas: true, preguntas: null }), "preguntas"],
    ["respuestas no autorizadas con preguntas", filaDeEjemplo({ respuestas_autorizadas: false }), "preguntas"],
    ["la autorización nula con diagnóstico", filaDeEjemplo({ respuestas_autorizadas: null }), "respuestas_autorizadas"],
    ["repetido nulo con diagnóstico", filaDeEjemplo({ repetido: null }), "repetido"],
    ["con diagnóstico y sin el nombre de la Evaluación", filaDeEjemplo({ nombre_evaluacion: null }), "nombre_evaluacion"],
    ["con diagnóstico y una fecha de realización que no es fecha", filaDeEjemplo({ fecha_realizacion: "valor-secreto-fecha" }), "fecha_realizacion", "valor-secreto-fecha"],
    ["sin diagnóstico pero con una Evaluación", filaSinDiagnostico({ nombre_evaluacion: "Parcial 1" }), "nombre_evaluacion", "Parcial 1"],
    ["sin diagnóstico pero con habilidades", filaSinDiagnostico({ habilidades: [] }), "habilidades"],
    ["sin diagnóstico pero con preguntas", filaSinDiagnostico({ preguntas: [] }), "preguntas"],
    ["una columna del diagnóstico que falta", (() => { const fila = filaSinDiagnostico(); delete fila.repetido; return fila; })(), "repetido"],
    ["un día que no existe", filaDeEjemplo({ fecha: "2026-02-30" }), "fecha", "2026-02-30"],
    ["un día con otra forma", filaDeEjemplo({ fecha: "12/10/2026" }), "fecha", "12/10/2026"],
    ["una hora de 25", filaDeEjemplo({ hora: "25:00:00" }), "hora", "25:00:00"],
    ["una duración de cero", filaDeEjemplo({ duracion_min: 0 }), "duracion_min"],
    ["un nombre de materia que no es texto", filaDeEjemplo({ nombre_materia: null }), "nombre_materia"],
    ["un nombre de estudiante que no es texto", filaDeEjemplo({ nombre_estudiante: 7 }), "nombre_estudiante"],
    ["`hay_diagnostico` que no es booleano", filaDeEjemplo({ hay_diagnostico: "sí" }), "hay_diagnostico", "sí"],
  ];

  it.each(casos)("%s", (_nombre, fila, ruta, contenido) => {
    const error = errorDe(fila);
    expect(error.ruta).toBe(ruta);
    expect(error.message).toContain(ruta);
    expect(error.name).toBe("ErrorDeVistaDelMonitor");
    // El mensaje llega a los registros del servidor: nunca lleva el valor malo ni nada del diagnóstico.
    if (contenido) expect(error.message).not.toContain(contenido);
    for (const secreto of ["Camila", "Parcial 1", "Enunciado", "Opción", "Solución", "fuerza"]) expect(error.message).not.toContain(secreto);
  });

  it("más de una fila no es una cita: lanza", () => {
    expect(() => leerVistaDelMonitor([filaDeEjemplo(), filaDeEjemplo()])).toThrow(ErrorDeVistaDelMonitor);
    try {
      leerVistaDelMonitor([filaDeEjemplo(), filaDeEjemplo()]);
    } catch (error) {
      expect((error as ErrorDeVistaDelMonitor).ruta).toBe("filas");
    }
  });

  it("lo que no es una lista de filas lanza", () => {
    expect(() => leerVistaDelMonitor(filaDeEjemplo())).toThrow(ErrorDeVistaDelMonitor);
    expect(() => leerVistaDelMonitor("hola")).toThrow(ErrorDeVistaDelMonitor);
    expect(() => leerVistaDelMonitor([null])).toThrow(ErrorDeVistaDelMonitor);
    expect(() => leerVistaDelMonitor([[]])).toThrow(ErrorDeVistaDelMonitor);
  });
});

describe("agruparHabilidades (criterio 1)", () => {
  const habilidad = (descripcion: string, nivel: NivelHabilidad): HabilidadParaElMonitor => ({ descripcion, nivel, respuestas: 1, aciertos: 1 });
  const descripciones = (lista: HabilidadParaElMonitor[]) => lista.map((h) => h.descripcion);

  it("cuatro habilidades en los cuatro niveles: no lo domina, en proceso, sin medir y, aparte, lo domina", () => {
    const { paraMirar, dominadas } = agruparHabilidades([
      habilidad("domina", "lo_domina"),
      habilidad("sin medir", "sin_medir"),
      habilidad("en proceso", "en_proceso"),
      habilidad("no domina", "no_lo_domina"),
    ]);
    expect(descripciones(paraMirar)).toEqual(["no domina", "en proceso", "sin medir"]);
    expect(descripciones(dominadas)).toEqual(["domina"]);
  });

  it("dos del mismo nivel van en el orden de la materia (M39)", () => {
    const { paraMirar } = agruparHabilidades([
      habilidad("b en proceso", "en_proceso"),
      habilidad("a no domina", "no_lo_domina"),
      habilidad("a en proceso", "en_proceso"),
      habilidad("b no domina", "no_lo_domina"),
      habilidad("b sin medir", "sin_medir"),
      habilidad("a sin medir", "sin_medir"),
    ]);
    expect(descripciones(paraMirar)).toEqual(["a no domina", "b no domina", "b en proceso", "a en proceso", "b sin medir", "a sin medir"]);
  });

  it("las que domina conservan el orden de la materia, sin reordenarlas por nada", () => {
    const { dominadas } = agruparHabilidades([habilidad("z", "lo_domina"), habilidad("x", "no_lo_domina"), habilidad("a", "lo_domina"), habilidad("m", "lo_domina")]);
    expect(descripciones(dominadas)).toEqual(["z", "a", "m"]);
  });

  it("18 habilidades de la Evaluación: todas aparecen una vez, las dominadas aparte, cada nivel en su lugar", () => {
    const niveles: NivelHabilidad[] = ["lo_domina", "en_proceso", "no_lo_domina", "sin_medir", "lo_domina", "no_lo_domina"];
    const lista = Array.from({ length: 18 }, (_, i) => habilidad(`h${String(i + 1).padStart(2, "0")}`, niveles[i % niveles.length]));
    const { paraMirar, dominadas } = agruparHabilidades(lista);
    expect(paraMirar.length + dominadas.length).toBe(18);
    expect(dominadas).toHaveLength(6);
    expect(paraMirar).toHaveLength(12);
    expect(new Set([...paraMirar, ...dominadas].map((h) => h.descripcion)).size).toBe(18);
    // Los rangos no se mezclan y, dentro de cada nivel, el orden de entrada se conserva.
    const rango = { no_lo_domina: 0, en_proceso: 1, sin_medir: 2, lo_domina: 3 };
    const rangos = paraMirar.map((h) => rango[h.nivel]);
    expect(rangos).toEqual([...rangos].sort((a, b) => a - b));
    for (const nivel of ["no_lo_domina", "en_proceso", "sin_medir"] as const) {
      const delNivel = descripciones(paraMirar.filter((h) => h.nivel === nivel));
      expect(delNivel).toEqual([...delNivel].sort());
    }
    expect(dominadas.map((h) => h.nivel)).toEqual(Array(6).fill("lo_domina"));
  });

  it("no cambia el nivel guardado aunque las cifras lo contradigan (M40)", () => {
    // El motor guardó «no lo domina» con todo acertado (las reglas del motor, no la aritmética, deciden el nivel): se muestra el guardado.
    const contradice: HabilidadParaElMonitor = { descripcion: "rara", nivel: "no_lo_domina", respuestas: 3, aciertos: 3 };
    const { paraMirar, dominadas } = agruparHabilidades([contradice, { descripcion: "otra", nivel: "lo_domina", respuestas: 2, aciertos: 0 }]);
    expect(paraMirar).toEqual([contradice]);
    expect(dominadas[0]).toMatchObject({ descripcion: "otra", nivel: "lo_domina", respuestas: 2, aciertos: 0 });
  });

  it("sin habilidades no hay nada que mirar ni plegar, y no toca la lista de entrada", () => {
    expect(agruparHabilidades([])).toEqual({ paraMirar: [], dominadas: [] });
    const entrada = [habilidad("b", "en_proceso"), habilidad("a", "no_lo_domina")];
    agruparHabilidades(entrada);
    expect(descripciones(entrada)).toEqual(["b", "a"]);
  });

  it("con la vista leída de la base: el ejemplo de ocho habilidades queda 5 por mirar y 3 que domina", () => {
    const { paraMirar, dominadas } = agruparHabilidades(leer(filaDeEjemplo())!.diagnostico!.habilidades);
    expect(descripciones(paraMirar)).toEqual([
      "interpreta gráficas de posición",
      "lee un diagrama de fuerzas",
      "aplica la conservación de la energía",
      "relaciona trabajo y energía cinética",
      "resuelve problemas con rozamiento",
    ]);
    expect(dominadas).toHaveLength(3);
  });
});

describe("los textos", () => {
  it("el nivel va escrito en tercera persona, los cuatro", () => {
    expect(etiquetaDeNivelParaElMonitor("no_lo_domina")).toBe("No lo domina");
    expect(etiquetaDeNivelParaElMonitor("en_proceso")).toBe("En proceso");
    expect(etiquetaDeNivelParaElMonitor("sin_medir")).toBe("Sin medir");
    expect(etiquetaDeNivelParaElMonitor("lo_domina")).toBe("Lo domina");
  });

  it("«Lo domina (N)» lleva el número de las que domina", () => {
    expect(textoDeLasDominadas(3)).toBe("Lo domina (3)");
    expect(textoDeLasDominadas(1)).toBe("Lo domina (1)");
  });

  it("«5 de 8 correctas» (M41); con una sola pregunta, «a de 1 correcta»", () => {
    expect(textoDeCorrectas(5, 8)).toBe("5 de 8 correctas");
    expect(textoDeCorrectas(0, 8)).toBe("0 de 8 correctas");
    expect(textoDeCorrectas(1, 1)).toBe("1 de 1 correcta");
    expect(textoDeCorrectas(0, 1)).toBe("0 de 1 correcta");
  });

  it("«1 respuesta · 1 acierto» en singular y «3 respuestas · 2 aciertos» en plural, cada una por su cuenta (M43)", () => {
    expect(textoDeRespuestas({ nivel: "en_proceso", respuestas: 1, aciertos: 1 })).toBe("1 respuesta · 1 acierto");
    expect(textoDeRespuestas({ nivel: "no_lo_domina", respuestas: 1, aciertos: 0 })).toBe("1 respuesta · 0 aciertos");
    expect(textoDeRespuestas({ nivel: "en_proceso", respuestas: 3, aciertos: 1 })).toBe("3 respuestas · 1 acierto");
    expect(textoDeRespuestas({ nivel: "lo_domina", respuestas: 3, aciertos: 2 })).toBe("3 respuestas · 2 aciertos");
  });

  it("«No se midió» solo si es «sin medir» y no tiene respuestas, y sin decir el motivo", () => {
    expect(textoDeRespuestas({ nivel: "sin_medir", respuestas: 0, aciertos: 0 })).toBe("No se midió");
    // Con respuestas dice sus cifras, aunque el nivel sea «sin medir».
    expect(textoDeRespuestas({ nivel: "sin_medir", respuestas: 1, aciertos: 1 })).toBe("1 respuesta · 1 acierto");
    // Sin respuestas pero con otro nivel (el motor puede dejar «no lo domina» sin ninguna): sus cifras, no «No se midió».
    expect(textoDeRespuestas({ nivel: "no_lo_domina", respuestas: 0, aciertos: 0 })).toBe("0 respuestas · 0 aciertos");
    expect(textoDeRespuestas({ nivel: "en_proceso", respuestas: 0, aciertos: 0 })).not.toContain("No se midió");
    const t = textoDeRespuestas({ nivel: "sin_medir", respuestas: 0, aciertos: 0 }).toLowerCase();
    for (const motivo of ["falta", "material", "tope", "sin preguntas"]) expect(t).not.toContain(motivo);
  });

  it("«Lo eligió 1 vez» / «Lo eligió N veces»", () => {
    expect(textoDeVeces(1)).toBe("Lo eligió 1 vez");
    expect(textoDeVeces(2)).toBe("Lo eligió 2 veces");
    expect(textoDeVeces(10)).toBe("Lo eligió 10 veces");
  });

  it("«Acertó» si la letra elegida es la correcta y «Falló» si no, con las letras que vio la persona (M48)", () => {
    expect(marcaDeLaPregunta({ letraElegida: "B", letraCorrecta: "B" })).toBe("Acertó");
    expect(marcaDeLaPregunta({ letraElegida: "A", letraCorrecta: "C" })).toBe("Falló");
    expect(marcaDeLaPregunta({ letraElegida: "C", letraCorrecta: "A" })).toBe("Falló");
    // De las ocho preguntas del ejemplo, tres falladas y cinco acertadas.
    const marcas = leer(filaDeEjemplo())!.diagnostico!.preguntas!.map(marcaDeLaPregunta);
    expect(marcas.filter((m) => m === "Falló")).toHaveLength(3);
    expect(marcas.filter((m) => m === "Acertó")).toHaveLength(5);
  });

  it("los textos que fija la HU, tal cual", () => {
    expect(TEXTOS.verDiagnostico).toBe("Ver diagnóstico");
    expect(TEXTOS.sinDiagnostico).toBe("No hay diagnóstico de esta materia ligado a esta monitoría.");
    expect(TEXTOS.repetido).toBe("Lo tomó otra vez; puede incluir preguntas que ya había visto.");
    expect(TEXTOS.noAutorizo).toBe("El estudiante no autorizó compartir sus respuestas.");
    expect(TEXTOS.noSeMidio).toBe("No se midió");
    expect(TEXTOS.acerto).toBe("Acertó");
    expect(TEXTOS.fallo).toBe("Falló");
    expect(TEXTOS.panel).toBe(
      "Abre tus franjas para que te agenden. En tu agenda ves quién agendó y abres el diagnóstico de cada cita confirmada o realizada.",
    );
    expect(TEXTOS.panel).not.toContain("Pronto");
  });
});

describe("las claves de la vista", () => {
  it("la fila trae las 16 columnas de la función, en su orden", () => {
    expect(CLAVES_DE_LA_VISTA_POR_NIVEL.fila).toEqual([
      "fecha",
      "hora",
      "duracion_min",
      "nombre_materia",
      "nombre_estudiante",
      "hay_diagnostico",
      "nombre_evaluacion",
      "fecha_realizacion",
      "respondidas",
      "aciertos",
      "repetido",
      "habilidades",
      "errores",
      "prerrequisitos",
      "respuestas_autorizadas",
      "preguntas",
    ]);
    expect(Object.keys(filaDeEjemplo())).toEqual([...CLAVES_DE_LA_VISTA_POR_NIVEL.fila]);
    expect(Object.keys(filaSinDiagnostico())).toEqual([...CLAVES_DE_LA_VISTA_POR_NIVEL.fila]);
  });

  it("la lista plana es la unión de todos los niveles, sin repetidas", () => {
    expect(new Set(CLAVES_DE_LA_VISTA).size).toBe(CLAVES_DE_LA_VISTA.length);
    for (const nivel of Object.values(CLAVES_DE_LA_VISTA_POR_NIVEL)) for (const clave of nivel) expect(CLAVES_DE_LA_VISTA).toContain(clave);
  });

  it("ninguna clave interna, de contacto ni de pago está permitida (criterio 13)", () => {
    for (const prohibida of [
      "habilidad",
      "misconcepcion",
      "clave",
      "codigo",
      "tema",
      "dificultad",
      "orden",
      "correcta",
      "error",
      "correo",
      "numero_telefono",
      "telefono",
      "token_recuperacion",
      "semilla",
      "falta_material",
      "faltaMaterial",
      "id_lead",
      "id_sesion_anonima",
      "id_diagnostico",
      "puntaje",
      "valor_total",
    ]) {
      expect(CLAVES_DE_LA_VISTA, prohibida).not.toContain(prohibida);
    }
  });
});
