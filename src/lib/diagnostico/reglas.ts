import { LETRAS, type Letra, type PreguntaParaNavegador } from "./motor";

/**
 * Lo del servidor del diagnóstico (HU-081) que no necesita base ni Next: la vigencia, los validadores de lo que llega del
 * navegador y las cinco formas que vuelven a él. Sin `server-only`, para que HU-009 importe los tipos desde la pantalla.
 *
 * Todo lo que sale hacia el navegador se construye aquí con objetos nuevos y claves de una lista permitida. Nunca lleva
 * la clave de la pregunta, la dificultad, la correcta, la misconcepción, el texto de error, la solución, la semilla ni el
 * `token_recuperacion` (D-14, HU-060): con el banco y el motor públicos, la semilla bastaría para calcular el orden de las
 * opciones y cuál es la correcta.
 */

/**
 * D-49 d: un diagnóstico en curso vence cuando pasan 2 horas sin responder. La base tiene la misma cifra
 * (`privado.vigencia_del_diagnostico_en_curso()`); `integracion/diagnostico.test.ts` las compara.
 */
export const HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO = 2;

/** Por qué no se puede tomar el diagnóstico: la Evaluación no existe, está inactiva o no tiene preguntas, o la sesión es del equipo. */
export type MotivoNoDisponible = "evaluacion" | "cuenta_del_equipo";

/** Una pregunta pendiente. `paso` cuenta las preguntas ya respondidas, desde 0: la pantalla dice «Pregunta paso + 1 de hasta maximo». */
export type EnCurso = {
  estado: "en_curso";
  /** El `id` del diagnóstico en curso, que será el del diagnóstico al terminar. Nunca la semilla. */
  idDiagnostico: string;
  evaluacion: { id: string; nombre: string };
  materia: { codigo: string; nombre: string };
  paso: number;
  /** Una cota (`maximoDePreguntas`): el diagnóstico puede terminar antes. */
  maximo: number;
  pregunta: PreguntaParaNavegador;
};

/** La persona ya vio todas las preguntas revisadas de la Evaluación (D-51). `idUltimoDiagnostico` es el de su último resultado. */
export type SinPreguntas = { estado: "sin_preguntas"; idUltimoDiagnostico: string | null };
export type Terminado = { estado: "terminado"; idDiagnostico: string };
export type Ninguno = { estado: "ninguno" };
export type NoDisponible = { estado: "no_disponible"; motivo: MotivoNoDisponible };

export type RespuestaDeIniciar = EnCurso | SinPreguntas | NoDisponible;
export type RespuestaDeResponder = EnCurso | Terminado | Ninguno;
export type RespuestaDeConsulta = EnCurso | Ninguno;

/** Las claves que pueden aparecer en cualquier cosa que reciba el navegador. Una prueba compara todo lo que sale contra esta lista. */
export const CLAVES_PERMITIDAS_AL_NAVEGADOR: readonly string[] = [
  "estado",
  "idDiagnostico",
  "evaluacion",
  "id",
  "nombre",
  "materia",
  "codigo",
  "paso",
  "maximo",
  "pregunta",
  "enunciado",
  "opciones",
  "letra",
  "texto",
  "idUltimoDiagnostico",
  "motivo",
];

/** Las que nunca llegan al navegador (D-14, HU-060). La lista permitida ya las excluye; esta sirve para nombrarlas en las pruebas. */
export const CLAVES_PROHIBIDAS_AL_NAVEGADOR: readonly string[] = [
  "clave",
  "dificultad",
  "correcta",
  "misconcepcion",
  "error",
  "solucion",
  "habilidades",
  "semilla",
  "token_recuperacion",
  "pasos",
  "candidatas",
  "faltaMaterial",
];

/**
 * Las claves de `valor` (objetos anidados y listas incluidos) que no están en la lista permitida. Vacío si todo lo que se
 * vería en el navegador es de la lista.
 */
export function clavesNoPermitidas(valor: unknown): string[] {
  const fuera = new Set<string>();
  const recorrer = (actual: unknown) => {
    if (Array.isArray(actual)) {
      actual.forEach(recorrer);
    } else if (typeof actual === "object" && actual !== null) {
      for (const [clave, hijo] of Object.entries(actual)) {
        if (!CLAVES_PERMITIDAS_AL_NAVEGADOR.includes(clave)) fuera.add(clave);
        recorrer(hijo);
      }
    }
  };
  recorrer(valor);
  return [...fuera];
}

// ---------------------------------------------------------------------------
// Validadores de lo que llega del navegador
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un UUID en cualquier caso, sin espacios ni nada alrededor. */
export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/** El número de paso que muestra la pantalla: un entero no negativo (no `1.5`, `-1`, `"1"` ni `NaN`). */
export function esPasoValido(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0;
}

/** La letra que ve la persona: de la A a la D, en mayúscula. */
export function esLetra(valor: unknown): valor is Letra {
  return typeof valor === "string" && (LETRAS as readonly string[]).includes(valor);
}

// ---------------------------------------------------------------------------
// Lo que vuelve al navegador
// ---------------------------------------------------------------------------

export type DatosDeEnCurso = {
  idDiagnostico: string;
  evaluacion: { id: string; nombre: string };
  materia: { codigo: string; nombre: string };
  paso: number;
  maximo: number;
  pregunta: PreguntaParaNavegador;
};

/**
 * La pregunta pendiente para el navegador. Construye objetos nuevos con las claves de la lista permitida y nada más, no
 * copia lo que recibe: aunque `datos` traiga de más (una fila de la base, la pregunta con su correcta), no sale.
 */
export function proyectarEnCurso(datos: DatosDeEnCurso): EnCurso {
  return {
    estado: "en_curso",
    idDiagnostico: datos.idDiagnostico,
    evaluacion: { id: datos.evaluacion.id, nombre: datos.evaluacion.nombre },
    materia: { codigo: datos.materia.codigo, nombre: datos.materia.nombre },
    paso: datos.paso,
    maximo: datos.maximo,
    pregunta: {
      enunciado: datos.pregunta.enunciado,
      opciones: datos.pregunta.opciones.map((opcion) => ({ letra: opcion.letra, texto: opcion.texto })),
    },
  };
}

export function proyectarSinPreguntas(idUltimoDiagnostico: string | null): SinPreguntas {
  return { estado: "sin_preguntas", idUltimoDiagnostico };
}

export function proyectarTerminado(idDiagnostico: string): Terminado {
  return { estado: "terminado", idDiagnostico };
}

export function proyectarNinguno(): Ninguno {
  return { estado: "ninguno" };
}

export function proyectarNoDisponible(motivo: MotivoNoDisponible): NoDisponible {
  return { estado: "no_disponible", motivo };
}
