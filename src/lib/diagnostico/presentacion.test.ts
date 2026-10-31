import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NivelHabilidad } from "./motor";
import {
  TEXTOS,
  avisoDeCambioDeMateria,
  cifrasDeHabilidad,
  descripcionDeNiveles,
  descripcionDelPorcentaje,
  etiquetaDeNivel,
  ordenarErrores,
  prefijoDeError,
  puntajeGlobal,
  queTrabajar,
  textoDeAciertos,
  textoDeAvance,
  textoDeErroresDetectados,
  textoDeVerErrores,
  textoDePorcentaje,
  textoDeRespondidas,
  textoDeTemas,
  textoDeTramo,
  tramosDeNiveles,
  textoDeVerMonitores,
} from "./presentacion";

// HU-009: los textos y las reglas de presentación del diagnóstico de la persona. Lo que ve la persona sale de aquí.

describe("puntajeGlobal (D-53 c)", () => {
  it.each([
    [5, 8, 63],
    [1, 3, 33],
    [2, 3, 67],
    [0, 8, 0],
    [0, 1, 0],
    [8, 8, 100],
    [1, 1, 100],
    [1, 8, 13],
    [7, 8, 88],
  ])("%i de %i da %i", (aciertos, respondidas, esperado) => {
    expect(puntajeGlobal(aciertos, respondidas)).toBe(esperado);
  });

  it("coincide con el puntaje que guarda el motor, redondeado al entero, para toda cantidad de 1 a 20", () => {
    // El motor guarda `round(aciertos / respondidas * 10000) / 100` (`motor.ts`); la pantalla muestra su entero.
    for (let n = 1; n <= 20; n++) {
      for (let k = 0; k <= n; k++) {
        const guardado = Math.round((k / n) * 10000) / 100;
        expect(puntajeGlobal(k, n), `${k} de ${n}`).toBe(Math.round(guardado));
      }
    }
  });

  it("una fila que no cuadra lanza, en vez de imprimir «140 %»", () => {
    expect(() => puntajeGlobal(0, 0)).toThrow(RangeError);
    expect(() => puntajeGlobal(1, 0)).toThrow(RangeError);
    expect(() => puntajeGlobal(-1, 8)).toThrow(RangeError);
    expect(() => puntajeGlobal(9, 8)).toThrow(RangeError);
    expect(() => puntajeGlobal(1.5, 8)).toThrow(RangeError);
    expect(() => puntajeGlobal(5, 7.5)).toThrow(RangeError);
    expect(() => puntajeGlobal(Number.NaN, 8)).toThrow(RangeError);
    expect(() => puntajeGlobal(5, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("el mensaje del error no trae las cifras", () => {
    let mensaje = "";
    try {
      puntajeGlobal(77, 8);
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).not.toBe("");
    expect(mensaje).not.toContain("77");
  });
});

describe("textos del encabezado", () => {
  it("el porcentaje lleva un espacio normal entre la cifra y el %, sin «Puntaje global» (D-79 c)", () => {
    expect(textoDePorcentaje(5, 8)).toBe("63 %");
    expect(textoDePorcentaje(5, 8)).not.toMatch(/ /);
  });

  it("«Respondiste» va en singular con una pregunta y en plural con las demás", () => {
    expect(textoDeRespondidas(1)).toBe("Respondiste 1 pregunta");
    expect(textoDeRespondidas(2)).toBe("Respondiste 2 preguntas");
    expect(textoDeRespondidas(8)).toBe("Respondiste 8 preguntas");
    expect(textoDeRespondidas(20)).toBe("Respondiste 20 preguntas");
  });

  it("«Acertaste A de R»", () => {
    expect(textoDeAciertos(2, 3)).toBe("Acertaste 2 de 3");
    expect(textoDeAciertos(0, 1)).toBe("Acertaste 0 de 1");
  });
});

describe("resumen (D-79)", () => {
  const habilidad = (nivel: NivelHabilidad, descripcion: string = nivel) => ({ nivel, descripcion });

  it("tramosDeNiveles cuenta cada nivel en el orden de la barra y omite los niveles en cero", () => {
    const habilidades = [
      habilidad("no_lo_domina"),
      habilidad("lo_domina"),
      habilidad("sin_medir"),
      habilidad("lo_domina"),
      habilidad("no_lo_domina"),
    ];
    expect(tramosDeNiveles(habilidades)).toEqual([
      { nivel: "lo_domina", cantidad: 2 },
      { nivel: "no_lo_domina", cantidad: 2 },
      { nivel: "sin_medir", cantidad: 1 },
    ]);
    expect(tramosDeNiveles([])).toEqual([]);
  });

  it("la leyenda y la descripción de la barra dicen lo mismo, con la etiqueta de quien mira", () => {
    const tramos = tramosDeNiveles([habilidad("lo_domina"), habilidad("en_proceso"), habilidad("en_proceso"), habilidad("no_lo_domina")]);
    expect(tramos.map((tramo) => textoDeTramo(tramo, etiquetaDeNivel))).toEqual(["1 Lo dominas", "2 En proceso", "1 No lo dominas"]);
    expect(descripcionDeNiveles(tramos, etiquetaDeNivel)).toBe("Habilidades por nivel: 1 Lo dominas, 2 En proceso y 1 No lo dominas");
    expect(textoDeTramo({ nivel: "lo_domina", cantidad: 3 }, () => "Lo domina")).toBe("3 Lo domina");
  });

  it("la descripción del puntaje lleva el porcentaje y las cifras", () => {
    expect(descripcionDelPorcentaje(13, 20)).toBe("65 % de respuestas correctas (13 de 20)");
    expect(() => descripcionDelPorcentaje(21, 20)).toThrow(RangeError);
  });

  it("queTrabajar pone primero las que no domina y luego las en proceso, en el orden de la materia, hasta 3", () => {
    const habilidades = [
      habilidad("en_proceso", "a"),
      habilidad("lo_domina", "b"),
      habilidad("no_lo_domina", "c"),
      habilidad("sin_medir", "d"),
      habilidad("en_proceso", "e"),
      habilidad("no_lo_domina", "f"),
    ];
    expect(queTrabajar(habilidades).map((h) => h.descripcion)).toEqual(["c", "f", "a"]);
    expect(queTrabajar(habilidades, 5).map((h) => h.descripcion)).toEqual(["c", "f", "a", "e"]);
    expect(queTrabajar([habilidad("lo_domina"), habilidad("sin_medir")])).toEqual([]);
  });

  it("los errores detectados van en singular o plural", () => {
    expect(textoDeErroresDetectados(1)).toBe("1 error detectado");
    expect(textoDeErroresDetectados(3)).toBe("3 errores detectados");
  });

  it("el desplegable de los errores también (HU-112)", () => {
    expect(textoDeVerErrores(1)).toBe("Ver el error detectado");
    expect(textoDeVerErrores(13)).toBe("Ver los 13 errores detectados");
  });
});

describe("etiquetaDeNivel", () => {
  it("escribe los cuatro niveles", () => {
    expect(etiquetaDeNivel("lo_domina")).toBe("Lo dominas");
    expect(etiquetaDeNivel("en_proceso")).toBe("En proceso");
    expect(etiquetaDeNivel("no_lo_domina")).toBe("No lo dominas");
    expect(etiquetaDeNivel("sin_medir")).toBe("Sin medir");
  });
});

describe("cifrasDeHabilidad: la cifra y el aviso de «sin medir» son reglas independientes", () => {
  const caso = (nivel: NivelHabilidad, respuestas: number, aciertos: number) => cifrasDeHabilidad({ nivel, respuestas, aciertos });

  it("hay cifra con al menos una respuesta, en cualquier nivel", () => {
    expect(caso("lo_domina", 3, 3)).toEqual({ cifra: "Acertaste 3 de 3", sinMedir: null });
    expect(caso("en_proceso", 2, 1)).toEqual({ cifra: "Acertaste 1 de 2", sinMedir: null });
    expect(caso("no_lo_domina", 2, 0)).toEqual({ cifra: "Acertaste 0 de 2", sinMedir: null });
    expect(caso("no_lo_domina", 1, 0)).toEqual({ cifra: "Acertaste 0 de 1", sinMedir: null });
  });

  it("sin respuestas no hay cifra, también en «no lo domina»", () => {
    expect(caso("no_lo_domina", 0, 0)).toEqual({ cifra: null, sinMedir: null });
    expect(caso("lo_domina", 0, 0)).toEqual({ cifra: null, sinMedir: null });
  });

  it("«No medimos esta habilidad en esta prueba.» sale solo en «sin medir», sin importar las respuestas", () => {
    expect(caso("sin_medir", 0, 0)).toEqual({ cifra: null, sinMedir: "No medimos esta habilidad en esta prueba." });
    expect(caso("sin_medir", 1, 1)).toEqual({ cifra: "Acertaste 1 de 1", sinMedir: "No medimos esta habilidad en esta prueba." });
  });
});

describe("errores", () => {
  it("los prefijos: «Error detectado:» si está confirmado y «Posible error:» si está en sospecha", () => {
    expect(prefijoDeError("confirmada")).toBe("Error detectado:");
    expect(prefijoDeError("sospecha")).toBe("Posible error:");
  });

  it("ordenarErrores pone los confirmados primero y conserva el orden dentro de cada grupo", () => {
    const entrada = [
      { id: 1, estado: "sospecha" as const },
      { id: 2, estado: "confirmada" as const },
      { id: 3, estado: "sospecha" as const },
      { id: 4, estado: "confirmada" as const },
      { id: 5, estado: "sospecha" as const },
    ];
    expect(ordenarErrores(entrada).map((e) => e.id)).toEqual([2, 4, 1, 3, 5]);
  });

  it("no cambia la lista que recibe y devuelve una lista nueva", () => {
    const entrada = [
      { estado: "sospecha" as const },
      { estado: "confirmada" as const },
    ];
    const salida = ordenarErrores(entrada);
    expect(salida).not.toBe(entrada);
    expect(entrada.map((e) => e.estado)).toEqual(["sospecha", "confirmada"]);
    expect(ordenarErrores([])).toEqual([]);
  });
});

describe("textoDeAvance: «Pregunta N de hasta M»", () => {
  it("N es el paso más uno y M es la cota", () => {
    expect(textoDeAvance(0, 8)).toBe("Pregunta 1 de hasta 8");
    expect(textoDeAvance(2, 8)).toBe("Pregunta 3 de hasta 8");
    expect(textoDeAvance(7, 8)).toBe("Pregunta 8 de hasta 8");
  });

  it("si la cota fuera menor que la pregunta en que va, no promete un tope falso", () => {
    expect(textoDeAvance(8, 8)).toBe("Pregunta 9");
    expect(textoDeAvance(10, 4)).toBe("Pregunta 11");
  });
});

describe("avisoDeCambioDeMateria", () => {
  it("lleva la materia delante de la Evaluación, porque varias materias tienen un «Parcial 1» (G.3)", () => {
    expect(avisoDeCambioDeMateria("Física II", "Parcial 1")).toBe(
      "Llevas un diagnóstico de Física II · Parcial 1. Si empiezas otro de otra Evaluación, se descarta este.",
    );
  });
});

describe("textoDeTemas", () => {
  it("junta los temas en español", () => {
    expect(textoDeTemas(["Cinemática"])).toBe("Temas: Cinemática");
    expect(textoDeTemas(["Cinemática", "Dinámica"])).toBe("Temas: Cinemática y Dinámica");
    expect(textoDeTemas(["Cinemática", "Dinámica", "Energía"])).toBe("Temas: Cinemática, Dinámica y Energía");
  });
});

describe("textoDeVerMonitores", () => {
  it("nombra la materia", () => {
    expect(textoDeVerMonitores("Física II")).toBe("Ver monitores de Física II");
  });
});

describe("TEXTOS", () => {
  it("los que están en la HU, tal cual", () => {
    expect(TEXTOS.errorDeCarga).toBe("No pudimos cargar el diagnóstico. Recarga la página; si sigue igual, inténtalo más tarde.");
    expect(TEXTOS.sinMaterias).toBe("Todavía no hay diagnósticos disponibles");
    expect(TEXTOS.evaluacionNoDisponible).toBe("Esa evaluación no está disponible");
    expect(TEXTOS.eligeUnaOpcion).toBe("Elige una opción");
    expect(TEXTOS.errorAlResponder).toBe("No pudimos guardar tu respuesta. Inténtalo de nuevo.");
    expect(TEXTOS.diagnosticoVencido).toBe("Ese diagnóstico ya no está. Empieza uno nuevo.");
    expect(TEXTOS.preguntaDeVolverATomar).toBe("¿Quieres volver a tomar el diagnóstico?");
    expect(TEXTOS.volverATomar).toBe("Sí, volver a tomarlo");
    expect(TEXTOS.sinErrores).toBe("No detectamos errores concretos en esta prueba.");
    expect(TEXTOS.repasarAntes).toBe("Conviene repasar antes");
    expect(TEXTOS.tituloNoEncontrado).toBe("No encontramos ese resultado");
  });

  it("los del resumen de HU-110, tal cual", () => {
    expect(TEXTOS.queTrabajarPrimero).toBe("Qué trabajar primero");
    expect(TEXTOS.sinQueTrabajar).toBe("No encontramos habilidades por reforzar en esta prueba.");
    expect(TEXTOS.verDetalle).toBe("Ver el detalle por habilidad");
  });

  it("el botón que no está en la HU y que la e2e busca por su nombre (supuesto, A2)", () => {
    expect(TEXTOS.volverAMiPregunta).toBe("Volver a mi pregunta");
  });

  it("el aviso de la cuenta del equipo es el mismo de agendar: si uno cambia, esta prueba lo dice (F-14)", () => {
    const agendar = readFileSync(join(__dirname, "../../app/(publico)/agendar/acciones.ts"), "utf8");
    expect(agendar).toContain(TEXTOS.cuentaDelEquipo);
  });

  it("el aviso de sin sesión es el de agendar", () => {
    const reglas = readFileSync(join(__dirname, "../agendar/reglas.ts"), "utf8");
    expect(reglas).toContain(TEXTOS.sinSesion);
  });

  it("ningún texto menciona «subtema» ni dice que no hay nota", () => {
    for (const texto of Object.values(TEXTOS)) {
      expect(texto.toLowerCase()).not.toContain("subtema");
      expect(texto.toLowerCase()).not.toContain("sin nota");
    }
  });
});
