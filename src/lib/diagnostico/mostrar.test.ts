import { describe, expect, it } from "vitest";
import { CLAVES_INTERNAS_DE_EJEMPLO, FILA_DE_EJEMPLO, GUARDADO_DE_EJEMPLO } from "../../../pruebas/diagnostico-sembrado";
import { CLAVES_DEL_RESULTADO, ErrorDeResultadoGuardado, leerResultadoGuardado, proyectarResultado, type FilaDeMiDiagnostico } from "./mostrar";
import { CLAVES_PROHIBIDAS_AL_NAVEGADOR } from "./reglas";
import type { ResultadoGuardado } from "./resultado";

// HU-009: de lo guardado (HU-081) a lo que ve la persona. Es una proyección pura que se hace en el servidor.

const fila = (cambios: Partial<FilaDeMiDiagnostico> = {}): FilaDeMiDiagnostico => ({ ...FILA_DE_EJEMPLO, ...cambios });
const conResultado = (cambios: Partial<Record<keyof ResultadoGuardado, unknown>>) => fila({ resultado: { ...GUARDADO_DE_EJEMPLO, ...cambios } });

/** Todas las claves de un valor, anidadas incluidas. */
function claves(valor: unknown, encontradas = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) valor.forEach((hijo) => claves(hijo, encontradas));
  else if (typeof valor === "object" && valor !== null) {
    for (const [clave, hijo] of Object.entries(valor)) {
      encontradas.add(clave);
      claves(hijo, encontradas);
    }
  }
  return encontradas;
}

describe("proyectarResultado", () => {
  const resultado = proyectarResultado(FILA_DE_EJEMPLO);

  it("la entrada válida de HU-081 produce el resultado esperado", () => {
    expect(resultado).toEqual({
      idDiagnostico: "d1a90000-0000-4000-8000-000000000009",
      materia: { codigo: "FISI-1018", nombre: "Física II" },
      evaluacion: { nombre: "Parcial 1" },
      fecha: "2026-10-05T03:30:00.000Z",
      respondidas: 8,
      aciertos: 5,
      habilidades: [
        { descripcion: "calcula la fuerza neta con $F = ma$", nivel: "lo_domina", respuestas: 3, aciertos: 3 },
        { descripcion: "aplica la conservación de la energía", nivel: "en_proceso", respuestas: 2, aciertos: 1 },
        { descripcion: "interpreta gráficas de posición como $x = vt$", nivel: "no_lo_domina", respuestas: 2, aciertos: 0 },
        { descripcion: "resuelve problemas con rozamiento", nivel: "sin_medir", respuestas: 0, aciertos: 0 },
        { descripcion: "lee un diagrama de fuerzas", nivel: "no_lo_domina", respuestas: 0, aciertos: 0 },
      ],
      errores: [
        { titulo: "confundes energía con potencia", estado: "sospecha", descripcionDeLaHabilidad: "aplica la conservación de la energía", detalles: [] },
        {
          titulo: String.raw`inviertes la relación $\frac{1}{2}$ entre dos magnitudes`,
          estado: "confirmada",
          descripcionDeLaHabilidad: "interpreta gráficas de posición como $x = vt$",
          detalles: [String.raw`Revisa qué magnitud va arriba en $\frac{a}{b}$.`],
        },
        {
          titulo: "ignoras la fricción",
          estado: "sospecha",
          descripcionDeLaHabilidad: null,
          detalles: ["La fricción también hace trabajo.", "Piensa en el sentido del movimiento."],
        },
      ],
      prerrequisitos: [
        { materia: null, descripcion: "despeja una incógnita en $ax + b = c$" },
        { materia: "Cálculo Diferencial", descripcion: "deriva polinomios" },
      ],
    });
  });

  it("conserva el orden guardado de las habilidades y de los errores (ordenar los errores es de la presentación)", () => {
    expect(resultado.habilidades.map((h) => h.nivel)).toEqual(["lo_domina", "en_proceso", "no_lo_domina", "sin_medir", "no_lo_domina"]);
    expect(resultado.errores.map((e) => e.estado)).toEqual(["sospecha", "confirmada", "sospecha"]);
  });

  it("la habilidad de un error que no es del resultado sale null, y la de uno que sí lo es sale con su descripción", () => {
    expect(resultado.errores[2].descripcionDeLaHabilidad).toBeNull();
    expect(resultado.errores[0].descripcionDeLaHabilidad).toBe(resultado.habilidades[1].descripcion);
  });

  it("nada de claves internas: todas las claves que salen están en CLAVES_DEL_RESULTADO", () => {
    const salidas = claves(resultado);
    expect([...salidas].filter((clave) => !CLAVES_DEL_RESULTADO.includes(clave))).toEqual([]);
    for (const prohibida of ["habilidad", "misconcepcion", "clave", "faltaMaterial", "semilla", "repetido", "token_recuperacion", "veces", "descripcionHabilidad", "texto"]) {
      expect(salidas.has(prohibida), prohibida).toBe(false);
    }
    // `habilidades` es del resultado (la lista de habilidades) aunque `CLAVES_PROHIBIDAS_AL_NAVEGADOR`, la del módulo, la prohíba.
    expect(CLAVES_PROHIBIDAS_AL_NAVEGADOR).toContain("habilidades");
    expect(CLAVES_DEL_RESULTADO).toContain("habilidades");
  });

  it("tampoco por valor: una clave interna no sale como título, descripción ni nada", () => {
    const json = JSON.stringify(resultado);
    for (const clave of CLAVES_INTERNAS_DE_EJEMPLO) expect(json, clave).not.toContain(clave);
  });

  it("aunque la entrada traiga de más, no sale: no copia la fila ni el JSON", () => {
    const sucia = {
      ...FILA_DE_EJEMPLO,
      repetido: true,
      semilla: 123456789,
      token_recuperacion: "TOKEN-SECRETO",
      respuestas: [{ clave: "pregunta-secreta", correcta: "B" }],
      falta_material: [{ habilidad: "habilidad-secreta-4", motivos: ["sin_preguntas_sin_ver"] }],
      puntaje: 62.5,
      resultado: {
        ...GUARDADO_DE_EJEMPLO,
        faltaMaterial: [{ habilidad: "habilidad-secreta-4" }],
        repetido: true,
        habilidades: GUARDADO_DE_EJEMPLO.habilidades.map((h) => ({ ...h, faltaMaterial: ["tope_una_respuesta"], dificultad: 3 })),
        errores: GUARDADO_DE_EJEMPLO.errores.map((e) => ({ ...e, solucion: "SOLUCION-SECRETA" })),
      },
    } as FilaDeMiDiagnostico;
    const salida = proyectarResultado(sucia);
    expect(salida).toEqual(resultado);
    const json = JSON.stringify(salida);
    for (const sentinela of ["TOKEN-SECRETO", "pregunta-secreta", "SOLUCION-SECRETA", "123456789", "faltaMaterial", "falta_material", "repetido", "semilla"]) {
      expect(json, sentinela).not.toContain(sentinela);
    }
  });

  it("devuelve objetos nuevos: cambiar la salida no cambia lo guardado", () => {
    const copia = proyectarResultado(FILA_DE_EJEMPLO);
    copia.habilidades[0].descripcion = "cambiada";
    copia.errores[1].detalles.push("extra");
    expect(GUARDADO_DE_EJEMPLO.habilidades[0].descripcion).toBe("calcula la fuerza neta con $F = ma$");
    expect(GUARDADO_DE_EJEMPLO.errores[1].detalles).toEqual([String.raw`Revisa qué magnitud va arriba en $\frac{a}{b}$.`]);
  });

  it("quita los prerrequisitos repetidos (el motor no los repite, pero se comprueba) y conserva el primero", () => {
    const repetidos = conResultado({
      prerrequisitos: [
        { materia: null, habilidad: "repasar-secreta-1", descripcion: "despeja una incógnita" },
        { materia: null, habilidad: "repasar-secreta-1", descripcion: "despeja una incógnita" },
        { materia: "Cálculo Diferencial", habilidad: "repasar-secreta-1", descripcion: "despeja una incógnita (de otra materia)" },
        { materia: "Cálculo Diferencial", habilidad: "repasar-secreta-2", descripcion: "deriva polinomios" },
        { materia: "Cálculo Diferencial", habilidad: "repasar-secreta-2", descripcion: "deriva polinomios" },
      ],
    });
    expect(proyectarResultado(repetidos).prerrequisitos).toEqual([
      { materia: null, descripcion: "despeja una incógnita" },
      { materia: "Cálculo Diferencial", descripcion: "despeja una incógnita (de otra materia)" },
      { materia: "Cálculo Diferencial", descripcion: "deriva polinomios" },
    ]);
  });

  it("sin prerrequisitos ni errores, las listas salen vacías", () => {
    const vacio = proyectarResultado(conResultado({ prerrequisitos: [], errores: [] }));
    expect(vacio.prerrequisitos).toEqual([]);
    expect(vacio.errores).toEqual([]);
  });

  it("la fecha sale en ISO aunque la base la mande con otro formato", () => {
    expect(proyectarResultado(fila({ fecha_realizacion: "2026-10-05 03:30:00.123456+00" })).fecha).toBe("2026-10-05T03:30:00.123Z");
  });
});

describe("proyectarResultado: una fila que no cuadra lanza ErrorDeResultadoGuardado, sin contenido", () => {
  const malas: [string, FilaDeMiDiagnostico][] = [
    ["respondidas en 0", fila({ respondidas: 0 })],
    ["respondidas y aciertos en 0 (el puntaje sería 0 de 0)", fila({ respondidas: 0, aciertos: 0 })],
    ["respondidas negativas", fila({ respondidas: -1 })],
    ["respondidas con decimales", fila({ respondidas: 7.5 })],
    ["aciertos mayores que respondidas", fila({ aciertos: 9 })],
    ["aciertos negativos", fila({ aciertos: -1 })],
    ["aciertos con decimales", fila({ aciertos: 2.5 })],
    ["respondidas que no es un número", fila({ respondidas: "8" as unknown as number })],
    ["fecha que no es fecha", fila({ fecha_realizacion: "ayer" })],
    ["resultado null", fila({ resultado: null })],
    ["resultado que es una cadena", fila({ resultado: "no es json" })],
    ["resultado que es un arreglo", fila({ resultado: [] })],
    ["resultado sin habilidades", fila({ resultado: { errores: [], prerrequisitos: [] } })],
    ["resultado sin errores", fila({ resultado: { habilidades: [], prerrequisitos: [] } })],
    ["resultado sin prerrequisitos", fila({ resultado: { habilidades: [], errores: [] } })],
    ["materia sin nombre", fila({ nombre_materia: undefined as unknown as string })],
  ];

  it.each(malas)("%s", (_nombre, entrada) => {
    expect(() => proyectarResultado(entrada)).toThrow(ErrorDeResultadoGuardado);
  });

  it("el mensaje es fijo: no trae nada de la fila", () => {
    let mensaje = "";
    try {
      proyectarResultado(fila({ aciertos: 999, resultado: { ...GUARDADO_DE_EJEMPLO, habilidades: "TEXTO-DEL-BANCO" } }));
    } catch (error) {
      mensaje = (error as Error).message;
      expect(error).toBeInstanceOf(ErrorDeResultadoGuardado);
    }
    expect(mensaje).toBe(new ErrorDeResultadoGuardado().message);
    expect(mensaje).not.toContain("999");
    expect(mensaje).not.toContain("TEXTO-DEL-BANCO");
  });
});

describe("leerResultadoGuardado", () => {
  const valido = JSON.parse(JSON.stringify(GUARDADO_DE_EJEMPLO)) as Record<string, unknown>;
  const con = (cambios: (copia: ResultadoGuardado) => void) => {
    const copia = JSON.parse(JSON.stringify(GUARDADO_DE_EJEMPLO)) as ResultadoGuardado;
    cambios(copia);
    return copia;
  };

  it("devuelve lo mismo que se guardó, con solo esas claves", () => {
    expect(leerResultadoGuardado(valido)).toEqual(GUARDADO_DE_EJEMPLO);
    expect(leerResultadoGuardado({ ...valido, extra: 1 })).toEqual(GUARDADO_DE_EJEMPLO);
  });

  it.each([
    ["un nivel que no es de los cuatro", (r: ResultadoGuardado) => void ((r.habilidades[0] as { nivel: string }).nivel = "dominado")],
    ["aciertos mayores que respuestas", (r: ResultadoGuardado) => void (r.habilidades[0].aciertos = 4)],
    ["respuestas negativas", (r: ResultadoGuardado) => void (r.habilidades[0].respuestas = -1)],
    ["una descripción que no es texto", (r: ResultadoGuardado) => void ((r.habilidades[0] as { descripcion: unknown }).descripcion = 5)],
    ["un estado de error que no es confirmada ni sospecha", (r: ResultadoGuardado) => void ((r.errores[0] as { estado: string }).estado = "descartada")],
    ["un título de error que no es texto", (r: ResultadoGuardado) => void ((r.errores[0] as { texto: unknown }).texto = null)],
    ["detalles que no son una lista de textos", (r: ResultadoGuardado) => void ((r.errores[1] as { detalles: unknown }).detalles = [1])],
    ["detalles que no son una lista", (r: ResultadoGuardado) => void ((r.errores[1] as { detalles: unknown }).detalles = "x")],
    ["una materia de prerrequisito que no es texto ni null", (r: ResultadoGuardado) => void ((r.prerrequisitos[0] as { materia: unknown }).materia = 3)],
    ["un prerrequisito sin descripción", (r: ResultadoGuardado) => void ((r.prerrequisitos[1] as { descripcion: unknown }).descripcion = undefined)],
  ])("lanza con %s", (_nombre, cambiar) => {
    expect(() => leerResultadoGuardado(con(cambiar))).toThrow(ErrorDeResultadoGuardado);
  });
});
