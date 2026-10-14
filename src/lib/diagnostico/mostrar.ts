import type { NivelHabilidad } from "./motor";
import type { ResultadoGuardado } from "./resultado";

/**
 * Del resultado guardado a lo que ve la persona (HU-009): una proyección pura que se hace en el servidor, antes de que nada
 * viaje al navegador. Construye objetos nuevos con las claves de `CLAVES_DEL_RESULTADO` y nada más: ni las claves internas
 * (`habilidad`, `misconcepcion`), ni `veces`, ni `repetido`, ni `semilla`, ni la marca de falta de material. No recalcula nada
 * con el banco de hoy: la Evaluación puede haberse apagado o editado desde que se hizo el diagnóstico.
 *
 * `resultado.ts` y `motor.ts` se importan con `import type`: arrastrarlos como valores llevaría el motor al navegador.
 */

/** La forma en que el resultado guardado no cuadra. Sin contenido: el mensaje nunca trae un valor de la fila. */
export class ErrorDeResultadoGuardado extends Error {
  constructor() {
    super("El resultado guardado del diagnóstico no tiene la forma esperada.");
    this.name = "ErrorDeResultadoGuardado";
  }
}

/** Lo que devuelve `public.mi_diagnostico(id)`: las 8 columnas, y nada más. `resultado` es el JSON guardado. */
export type FilaDeMiDiagnostico = {
  id_diagnostico: string;
  codigo_materia: string;
  nombre_materia: string;
  nombre_evaluacion: string;
  fecha_realizacion: string;
  respondidas: number;
  aciertos: number;
  resultado: unknown;
};

/** Lo único que la persona ve de un diagnóstico terminado. Serializable: viaja del servidor al navegador. */
export type ResultadoParaMostrar = {
  idDiagnostico: string;
  materia: { codigo: string; nombre: string };
  evaluacion: { nombre: string };
  /** ISO; el componente la formatea en hora de Bogotá. */
  fecha: string;
  respondidas: number;
  /** Preguntas acertadas (no la suma por habilidad, que cuenta dos veces una pregunta de varias habilidades). */
  aciertos: number;
  /** En el orden guardado, que es el de la materia. */
  habilidades: { descripcion: string; nivel: NivelHabilidad; respuestas: number; aciertos: number }[];
  errores: {
    titulo: string;
    estado: "confirmada" | "sospecha";
    /** La descripción de la habilidad, solo si es una de las del resultado. */
    descripcionDeLaHabilidad: string | null;
    detalles: string[];
  }[];
  /** `materia` es el nombre de la otra materia, o null si es la misma. */
  prerrequisitos: { materia: string | null; descripcion: string }[];
};

/**
 * Todas las claves que puede tener un `ResultadoParaMostrar`, las anidadas incluidas. Una prueba compara todo lo que sale
 * contra esta lista (la del módulo del servidor, `CLAVES_PERMITIDAS_AL_NAVEGADOR`, no conoce estas claves).
 */
export const CLAVES_DEL_RESULTADO: readonly string[] = [
  "idDiagnostico",
  "materia",
  "codigo",
  "nombre",
  "evaluacion",
  "fecha",
  "respondidas",
  "aciertos",
  "habilidades",
  "descripcion",
  "nivel",
  "respuestas",
  "errores",
  "titulo",
  "estado",
  "descripcionDeLaHabilidad",
  "detalles",
  "prerrequisitos",
];

// ---------------------------------------------------------------------------
// Lectura del JSON guardado
// ---------------------------------------------------------------------------

const NIVELES: readonly string[] = ["lo_domina", "en_proceso", "no_lo_domina", "sin_medir"];

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

const esCadena = (valor: unknown): valor is string => typeof valor === "string";

const esEnteroNoNegativo = (valor: unknown): valor is number => typeof valor === "number" && Number.isInteger(valor) && valor >= 0;

/** Una lista de objetos, o el error. */
function lista(valor: unknown): Record<string, unknown>[] {
  if (!Array.isArray(valor) || !valor.every(esObjeto)) throw new ErrorDeResultadoGuardado();
  return valor;
}

/**
 * Valida la forma de `ResultadoGuardado` (el tipo de HU-081) y devuelve una copia con solo esas claves. Lanza
 * `ErrorDeResultadoGuardado`, sin contenido, si algo no cuadra: un nivel que no es uno de los cuatro, `aciertos` mayor que
 * `respuestas`, un estado que no es `confirmada` ni `sospecha`, un texto que no es cadena.
 */
export function leerResultadoGuardado(json: unknown): ResultadoGuardado {
  if (!esObjeto(json)) throw new ErrorDeResultadoGuardado();

  const habilidades = lista(json.habilidades).map((h) => {
    const { habilidad, descripcion, nivel, respuestas, aciertos } = h;
    if (!esCadena(habilidad) || !esCadena(descripcion) || !esCadena(nivel) || !NIVELES.includes(nivel)) throw new ErrorDeResultadoGuardado();
    if (!esEnteroNoNegativo(respuestas) || !esEnteroNoNegativo(aciertos) || aciertos > respuestas) throw new ErrorDeResultadoGuardado();
    return { habilidad, descripcion, nivel: nivel as NivelHabilidad, respuestas, aciertos };
  });

  const errores = lista(json.errores).map((e) => {
    const { misconcepcion, habilidad, descripcionHabilidad, texto, estado, veces, detalles } = e;
    if (!esCadena(misconcepcion) || !esCadena(habilidad) || !esCadena(descripcionHabilidad) || !esCadena(texto)) throw new ErrorDeResultadoGuardado();
    if (estado !== "confirmada" && estado !== "sospecha") throw new ErrorDeResultadoGuardado();
    if (!esEnteroNoNegativo(veces) || !Array.isArray(detalles) || !detalles.every(esCadena)) throw new ErrorDeResultadoGuardado();
    return { misconcepcion, habilidad, descripcionHabilidad, texto, estado: estado as "confirmada" | "sospecha", veces, detalles: [...detalles] as string[] };
  });

  const prerrequisitos = lista(json.prerrequisitos).map((p) => {
    const { materia, habilidad, descripcion } = p;
    if (materia !== null && !esCadena(materia)) throw new ErrorDeResultadoGuardado();
    if (!esCadena(habilidad) || !esCadena(descripcion)) throw new ErrorDeResultadoGuardado();
    return { materia: materia as string | null, habilidad, descripcion };
  });

  return { habilidades, errores, prerrequisitos };
}

// ---------------------------------------------------------------------------
// Proyección
// ---------------------------------------------------------------------------

/**
 * La fila de `mi_diagnostico` a lo que ve la persona. Además de la forma del JSON valida `respondidas >= 1` y
 * `0 <= aciertos <= respondidas` (enteros) y que la fecha sea una fecha: el componente nunca recibe una fila con la que no
 * pueda dibujar el puntaje. Lanza `ErrorDeResultadoGuardado`, sin contenido.
 */
export function proyectarResultado(fila: FilaDeMiDiagnostico): ResultadoParaMostrar {
  const { id_diagnostico, codigo_materia, nombre_materia, nombre_evaluacion, fecha_realizacion, respondidas, aciertos } = fila;
  if (!esCadena(id_diagnostico) || !esCadena(codigo_materia) || !esCadena(nombre_materia) || !esCadena(nombre_evaluacion) || !esCadena(fecha_realizacion)) {
    throw new ErrorDeResultadoGuardado();
  }
  if (!esEnteroNoNegativo(respondidas) || respondidas < 1 || !esEnteroNoNegativo(aciertos) || aciertos > respondidas) {
    throw new ErrorDeResultadoGuardado();
  }
  const instante = new Date(fecha_realizacion);
  if (Number.isNaN(instante.getTime())) throw new ErrorDeResultadoGuardado();

  const guardado = leerResultadoGuardado(fila.resultado);

  // Se compara con las claves ANTES de soltarlas: la habilidad de un error solo se muestra si es una del resultado.
  const descripcionPorHabilidad = new Map(guardado.habilidades.map((h) => [h.habilidad, h.descripcion]));

  // El motor ya entrega los prerrequisitos sin repetir; esto es defensivo. Se repite por (materia, habilidad a repasar).
  const vistos = new Set<string>();
  const prerrequisitos: ResultadoParaMostrar["prerrequisitos"] = [];
  for (const p of guardado.prerrequisitos) {
    const llave = JSON.stringify([p.materia, p.habilidad]);
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    prerrequisitos.push({ materia: p.materia, descripcion: p.descripcion });
  }

  return {
    idDiagnostico: id_diagnostico,
    materia: { codigo: codigo_materia, nombre: nombre_materia },
    evaluacion: { nombre: nombre_evaluacion },
    fecha: instante.toISOString(),
    respondidas,
    aciertos,
    habilidades: guardado.habilidades.map((h) => ({ descripcion: h.descripcion, nivel: h.nivel, respuestas: h.respuestas, aciertos: h.aciertos })),
    errores: guardado.errores.map((e) => ({
      titulo: e.texto,
      estado: e.estado,
      descripcionDeLaHabilidad: descripcionPorHabilidad.get(e.habilidad) ?? null,
      detalles: [...e.detalles],
    })),
    prerrequisitos,
  };
}
