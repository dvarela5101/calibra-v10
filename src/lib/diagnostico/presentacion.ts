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
  // D-74 c: con materias, el botón de debajo de «Empezar» reemplaza la línea de arriba.
  verMonitoresSinPrueba: "Ver monitores sin hacer la prueba",
  errorDeCarga: "No pudimos cargar el diagnóstico. Recarga la página; si sigue igual, inténtalo más tarde.",
  evaluacionNoDisponible: "Esa evaluación no está disponible",
  errorAlEmpezar: "No pudimos empezar el diagnóstico. Inténtalo de nuevo.",
  // Solo con un diagnóstico en curso: la salida del selector que se abrió con «Cambiar de materia».
  volverAMiPregunta: "Volver a mi pregunta",

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
  // Resumen (D-79)
  resumen: "Resumen de tu resultado",
  queTrabajarPrimero: "Qué trabajar primero",
  sinQueTrabajar: "No encontramos habilidades por reforzar en esta prueba.",
  verDetalle: "Ver el detalle por habilidad",
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

/** `63 %`, con un espacio normal entre la cifra y el `%` (D-79 c: sin «Puntaje global»). */
export function textoDePorcentaje(aciertos: number, respondidas: number): string {
  return `${puntajeGlobal(aciertos, respondidas)} %`;
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

// ---------------------------------------------------------------------------
// Resumen (D-79)
// ---------------------------------------------------------------------------

/** El orden de los tramos de la barra y de la leyenda: de lo dominado a lo que no se midió. */
const ORDEN_DE_NIVELES: readonly NivelHabilidad[] = ["lo_domina", "en_proceso", "no_lo_domina", "sin_medir"];

export type TramoDeNivel = { nivel: NivelHabilidad; cantidad: number };

/** Cuántas habilidades hay en cada nivel, en el orden de la barra y sin los niveles en cero. */
export function tramosDeNiveles(habilidades: readonly { nivel: NivelHabilidad }[]): TramoDeNivel[] {
  return ORDEN_DE_NIVELES.map((nivel) => ({ nivel, cantidad: habilidades.filter((h) => h.nivel === nivel).length })).filter(
    (tramo) => tramo.cantidad > 0,
  );
}

/** `4 Lo dominas`: un renglón de la leyenda. La etiqueta es la de quien mira (la persona o el monitor). */
export function textoDeTramo(tramo: TramoDeNivel, etiqueta: (nivel: NivelHabilidad) => string): string {
  return `${tramo.cantidad} ${etiqueta(tramo.nivel)}`;
}

/** Lo que dice la barra de niveles a un lector de pantalla: lo mismo que la leyenda. */
export function descripcionDeNiveles(tramos: readonly TramoDeNivel[], etiqueta: (nivel: NivelHabilidad) => string): string {
  return `Habilidades por nivel: ${LISTA_EN_ESPANOL.format(tramos.map((tramo) => textoDeTramo(tramo, etiqueta)))}`;
}

/** Lo que dice la barra del puntaje a un lector de pantalla: `63 % de respuestas correctas (5 de 8)`. */
export function descripcionDelPorcentaje(aciertos: number, respondidas: number): string {
  return `${textoDePorcentaje(aciertos, respondidas)} de respuestas correctas (${aciertos} de ${respondidas})`;
}

/** Hasta `maximo` habilidades para trabajar: primero las que no domina y luego las en proceso, cada grupo en el orden de la materia. */
export function queTrabajar<T extends { nivel: NivelHabilidad }>(habilidades: readonly T[], maximo = 3): T[] {
  return [...habilidades.filter((h) => h.nivel === "no_lo_domina"), ...habilidades.filter((h) => h.nivel === "en_proceso")].slice(0, maximo);
}

/** `1 error detectado` / `3 errores detectados`: los confirmados y los posibles, todos. */
export function textoDeErroresDetectados(cantidad: number): string {
  return cantidad === 1 ? "1 error detectado" : `${cantidad} errores detectados`;
}

/** El desplegable de los errores en el resumen (HU-112, D-81 a): `Ver el error detectado` / `Ver los 3 errores detectados`. */
export function textoDeVerErrores(cantidad: number): string {
  return cantidad === 1 ? "Ver el error detectado" : `Ver los ${cantidad} errores detectados`;
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
