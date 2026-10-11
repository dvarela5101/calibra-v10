import { opcionElegida, type CopiaDePaso, type MotivoFaltaMaterial, type NivelHabilidad, type ResultadoDiagnostico } from "./motor";

/**
 * Lo que guarda un diagnóstico terminado (HU-081), puro. El resultado se calcula una vez, con las copias de cada paso y el
 * contexto de la foto del banco al empezar, y se guarda tal cual: nunca se recalcula con el banco de otro día. Editar el
 * banco no cambia un diagnóstico viejo (HU-060).
 */

/**
 * Lo que queda en `diagnostico.resultado_por_habilidad` y leen el dueño, el monitor de la cita y el admin: lo que calificó el
 * motor con nombres legibles, y nada de las copias de las preguntas ni de la marca de falta de material (esa va en su propia
 * columna sin grant, `falta_material`). HU-009, HU-011 y HU-022 tipan lo mismo con este tipo.
 */
export type ResultadoGuardado = {
  /** Todas las de la Evaluación, en el orden de la materia. */
  habilidades: { habilidad: string; descripcion: string; nivel: NivelHabilidad; respuestas: number; aciertos: number }[];
  /** Primero las confirmadas, luego por orden de aparición. */
  errores: {
    misconcepcion: string;
    habilidad: string;
    /** La descripción de la habilidad del error, aunque no sea de la Evaluación (regla 8 de HU-060). Sin ella, la clave. */
    descripcionHabilidad: string;
    /** El título del error. */
    texto: string;
    estado: "confirmada" | "sospecha";
    veces: number;
    /** Los textos de error de las opciones que la persona eligió (D-49 d). */
    detalles: string[];
  }[];
  /** `materia` es el nombre de la otra materia, o null si es la misma. */
  prerrequisitos: { materia: string | null; habilidad: string; descripcion: string }[];
};

/** Lo que guarda `diagnostico.falta_material`: solo las habilidades con marca (regla 12 de HU-060, D-49 c). */
export type FaltaMaterialGuardada = { habilidad: string; motivos: MotivoFaltaMaterial[] }[];

/**
 * La foto del resultado que se guarda en `resultado_por_habilidad`. Construye objetos nuevos: sin `faltaMaterial` ni nada que
 * el motor agregue después. `descripcionesDeHabilidad` es la del contexto (todas las habilidades de la materia).
 */
export function armarResultadoGuardado(
  resultado: ResultadoDiagnostico,
  descripcionesDeHabilidad: Readonly<Record<string, string>>,
): ResultadoGuardado {
  const descripcionDe = (clave: string): string => {
    const descripcion = Object.hasOwn(descripcionesDeHabilidad, clave) ? descripcionesDeHabilidad[clave] : undefined;
    // Un diagnóstico terminado no se bloquea por un dato de presentación.
    return typeof descripcion === "string" ? descripcion : clave;
  };
  return {
    habilidades: resultado.habilidades.map((h) => ({
      habilidad: h.habilidad,
      descripcion: h.descripcion,
      nivel: h.nivel,
      respuestas: h.respuestas,
      aciertos: h.aciertos,
    })),
    errores: resultado.errores.map((e) => ({
      misconcepcion: e.misconcepcion,
      habilidad: e.habilidad,
      descripcionHabilidad: descripcionDe(e.habilidad),
      texto: e.texto,
      estado: e.estado,
      veces: e.veces,
      detalles: [...e.detalles],
    })),
    prerrequisitos: resultado.prerrequisitos.map((p) => ({ materia: p.materia, habilidad: p.habilidad, descripcion: p.descripcion })),
  };
}

/** Las habilidades con marca de falta de material, tal como las calculó el motor al terminar. Sin recalcular con el banco de hoy. */
export function faltaMaterialDe(resultado: ResultadoDiagnostico): FaltaMaterialGuardada {
  return resultado.habilidades
    .filter((h) => h.faltaMaterial.length > 0)
    .map((h) => ({ habilidad: h.habilidad, motivos: [...h.faltaMaterial] }));
}

/**
 * Las preguntas acertadas. Una pregunta que mide varias habilidades cuenta una vez, así que no sale de sumar los aciertos de
 * `habilidades`. Es el mismo conteo con el que el motor saca el puntaje.
 */
export function aciertosDe(pasos: readonly CopiaDePaso[]): number {
  return pasos.filter((paso) => opcionElegida(paso).correcta).length;
}
