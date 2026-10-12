import type { NivelHabilidad } from "./motor";

/**
 * Los textos y las reglas de presentación del diagnóstico de la persona (HU-009), sin React ni servidor. Lo que las pruebas y
 * la e2e buscan en pantalla está en `TEXTOS`; el componente y las acciones no lo escriben a mano.
 *
 * Esto llega al navegador: de `motor.ts` solo se importa un tipo (`import type`), porque un import de valores arrastraría el
 * motor entero al paquete del navegador.
 */

export const TEXTOS = {
  // Selector (D-53 a)
  eyebrow: "Diagnóstico",
  tituloDelSelector: "Elige tu materia",
  subtituloDelSelector: "Responde unas preguntas de opción múltiple y mira qué habilidades dominas. No necesitas crear una cuenta.",
  grupoDeMaterias: "Materia",
  grupoDeEvaluaciones: "Evaluación",
  elegirMateria: "Elige una materia",
  elegirEvaluacion: "Elige una evaluación",
  empezar: "Empezar",
  empezando: "Empezando…",
  sinMaterias: "Todavía no hay diagnósticos disponibles",
  noVesTuMateria: "¿No ves tu materia?",
  enlaceAMonitores: "Mira los monitores",
  errorDeCarga: "No pudimos cargar el diagnóstico. Recarga la página; si sigue igual, inténtalo más tarde.",
  evaluacionNoDisponible: "Esa evaluación no está disponible",
  errorAlEmpezar: "No pudimos empezar el diagnóstico. Inténtalo de nuevo.",

  // Pregunta
  tituloDeLaPregunta: "Tu diagnóstico",
  responder: "Responder",
  cambiarDeMateria: "Cambiar de materia",
  eligeUnaOpcion: "Elige una opción",
  errorAlResponder: "No pudimos guardar tu respuesta. Inténtalo de nuevo.",
  diagnosticoVencido: "Ese diagnóstico ya no está. Empieza uno nuevo.",

  // Sin preguntas nuevas (D-51)
  tituloSinPreguntas: "Ya viste todas las preguntas",
  mensajeSinPreguntas: "Ya respondiste todas las preguntas de esta evaluación. Si la vuelves a tomar, algunas se repetirán.",
  preguntaDeVolverATomar: "¿Quieres volver a tomar el diagnóstico?",
  volverATomar: "Sí, volver a tomarlo",
  noVolverATomar: "No",
  ultimoResultado: "Tu último resultado",

  // Resultado (D-53 c)
  tituloDelResultado: "Tu resultado",
  fecha: "Fecha:",
  habilidades: "Habilidades",
  sinMedir: "No medimos esta habilidad en esta prueba.",
  errores: "Errores",
  sinErrores: "No detectamos errores concretos en esta prueba.",
  habilidadDelError: "Habilidad:",
  repasarAntes: "Conviene repasar antes",
  otroDiagnostico: "Tomar otro diagnóstico",
  errorDeCargaDelResultado: "No pudimos cargar tu resultado. Recarga la página; si sigue igual, inténtalo más tarde.",

  // No encontrado
  tituloNoEncontrado: "No encontramos ese resultado",
  notaNoEncontrado: "Puede que el enlace esté incompleto o que el resultado no se pueda ver desde esta sesión.",
  hacerElDiagnostico: "Hacer el diagnóstico",

  // Sesión y cuenta del equipo
  sinSesion: "No pudimos verificar tu navegador. Recarga la página e intenta de nuevo.",
  // Cuarta copia de la que ya está en agendar (F-14): una prueba compara las cadenas para que no se desfasen.
  cuentaDelEquipo: "Estás con tu cuenta del equipo de Calibra. Para agendar como estudiante, sal de tu cuenta o usa otra ventana.",
} as const;

// ---------------------------------------------------------------------------
// Puntaje y cifras (D-53 c)
// ---------------------------------------------------------------------------

/**
 * El porcentaje de preguntas acertadas, redondeado al entero. Sale de lo guardado (`aciertos` y `respondidas`) y no del
 * `puntaje` de la base: para todo n de 1 a 20 y todo k de 0 a n, `Math.round` del puntaje que guarda el motor y este valor
 * coinciden. Una fila que no cuadra lanza: no se imprime «140 %».
 */
export function puntajeGlobal(aciertos: number, respondidas: number): number {
  if (!Number.isInteger(aciertos) || !Number.isInteger(respondidas) || respondidas < 1 || aciertos < 0 || aciertos > respondidas) {
    throw new RangeError("Los aciertos y las preguntas respondidas no cuadran para calcular el puntaje.");
  }
  return Math.round((aciertos * 100) / respondidas);
}

/** `Puntaje global: 63 %`, con un espacio normal entre la cifra y el `%`. */
export function textoDePuntaje(aciertos: number, respondidas: number): string {
  return `Puntaje global: ${puntajeGlobal(aciertos, respondidas)} %`;
}

export function textoDeRespondidas(respondidas: number): string {
  return respondidas === 1 ? "Respondiste 1 pregunta" : `Respondiste ${respondidas} preguntas`;
}

export function textoDeAciertos(aciertos: number, respuestas: number): string {
  return `Acertaste ${aciertos} de ${respuestas}`;
}

// ---------------------------------------------------------------------------
// Habilidades, errores y prerrequisitos
// ---------------------------------------------------------------------------

const ETIQUETAS_DE_NIVEL: Record<NivelHabilidad, string> = {
  lo_domina: "Lo dominas",
  en_proceso: "En proceso",
  no_lo_domina: "No lo dominas",
  sin_medir: "Sin medir",
};

/** El nivel escrito: nunca solo color. */
export function etiquetaDeNivel(nivel: NivelHabilidad): string {
  return ETIQUETAS_DE_NIVEL[nivel];
}

/**
 * Qué se dice de una habilidad además de su nivel. Son dos reglas independientes: la cifra sale con al menos una respuesta
 * contada (una `no_lo_domina` sin respuestas no la lleva, una `sin_medir` con respuestas sí), y el aviso de que no se midió
 * sale solo con el nivel `sin_medir` y no dice el motivo (`faltaMaterial` es interno).
 */
export function cifrasDeHabilidad(h: { nivel: NivelHabilidad; respuestas: number; aciertos: number }): {
  cifra: string | null;
  sinMedir: string | null;
} {
  return {
    cifra: h.respuestas > 0 ? textoDeAciertos(h.aciertos, h.respuestas) : null,
    sinMedir: h.nivel === "sin_medir" ? TEXTOS.sinMedir : null,
  };
}

export type EstadoDeError = "confirmada" | "sospecha";

export function prefijoDeError(estado: EstadoDeError): string {
  return estado === "confirmada" ? "Error detectado:" : "Posible error:";
}

/** Los confirmados primero y, dentro de cada grupo, el orden en que llegaron. */
export function ordenarErrores<T extends { estado: EstadoDeError }>(errores: readonly T[]): T[] {
  return [...errores.filter((e) => e.estado === "confirmada"), ...errores.filter((e) => e.estado !== "confirmada")];
}

// ---------------------------------------------------------------------------
// Avance, avisos y listas
// ---------------------------------------------------------------------------

/**
 * `paso` cuenta las preguntas ya respondidas, desde 0, y `maximo` es una cota: el diagnóstico puede terminar antes. Si la cota
 * fuera menor que la pregunta en que va (no debería pasar) no se promete un tope falso.
 */
export function textoDeAvance(paso: number, maximo: number): string {
  const numero = paso + 1;
  return maximo < numero ? `Pregunta ${numero}` : `Pregunta ${numero} de hasta ${maximo}`;
}

/** El aviso del selector cuando hay un diagnóstico en curso: lleva la materia porque varias materias tienen un «Parcial 1». */
export function avisoDeCambioDeMateria(materia: string, evaluacion: string): string {
  return `Llevas un diagnóstico de ${materia} · ${evaluacion}. Si empiezas otro de otra Evaluación, se descarta este.`;
}

const LISTA_EN_ESPANOL = new Intl.ListFormat("es", { style: "long", type: "conjunction" });

/** `Temas: Cinemática, Dinámica y Energía`. */
export function textoDeTemas(temas: readonly string[]): string {
  return `Temas: ${LISTA_EN_ESPANOL.format(temas)}`;
}

export function textoDeVerMonitores(materia: string): string {
  return `Ver monitores de ${materia}`;
}
