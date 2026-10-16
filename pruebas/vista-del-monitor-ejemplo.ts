import type { Letra } from "@/lib/diagnostico/motor";

/**
 * Lo que devuelve `public.diagnostico_de_mi_monitoria(id)` (HU-022) para una cita con diagnóstico, tal como lo entrega PostgREST: una
 * fila con 16 columnas, cuatro de ellas `jsonb`. Es el ejemplo de las pruebas de Vitest del lector, de los componentes y de las
 * páginas del monitor; solo tiene `import type` de `src/`, así que también lo puede cargar la e2e.
 *
 * Trae ocho habilidades (tres que domina y cinco por mirar, con los cuatro niveles y dos del mismo nivel), un error confirmado con
 * detalle y una fórmula en el título, dos en sospecha (uno de una habilidad que no es de la Evaluación y uno cuya descripción cayó a
 * la clave y por eso es `null`), un prerrequisito de la misma materia y otro de otra, y ocho preguntas, tres falladas y cinco
 * acertadas, con las opciones en el orden en que las vio la persona (la correcta nunca es la A). El diagnóstico es de las 23:30 del
 * 4 de octubre de 2026 en Bogotá, que ya es el 5 en UTC.
 */

export type FilaDelMonitor = Record<string, unknown>;

/** Un valor reconocible que ninguna pantalla debe mostrar: se siembra en lugares donde una fuga lo dejaría ver. */
export const CENTINELA_DEL_MONITOR = "centinela-secreto-0022";

/** Las ocho preguntas: la correcta de cada una y la que se eligió, ya en las letras que vio la persona. */
const PLAN_DE_PREGUNTAS: { correcta: Letra; elegida: Letra; conSolucion: boolean }[] = [
  { correcta: "B", elegida: "B", conSolucion: true }, // acertó
  { correcta: "C", elegida: "A", conSolucion: true }, // falló
  { correcta: "D", elegida: "D", conSolucion: false }, // acertó
  { correcta: "B", elegida: "C", conSolucion: true }, // falló
  { correcta: "C", elegida: "C", conSolucion: true }, // acertó
  { correcta: "D", elegida: "A", conSolucion: true }, // falló
  { correcta: "B", elegida: "B", conSolucion: false }, // acertó
  { correcta: "C", elegida: "C", conSolucion: true }, // acertó
];

const LETRAS: readonly Letra[] = ["A", "B", "C", "D"];

/** Las preguntas como las entrega la función: opciones en el orden visto, `letraElegida` y `letraCorrecta` en ese mismo orden. */
export function preguntasDeEjemplo(): Record<string, unknown>[] {
  return PLAN_DE_PREGUNTAS.map((plan, i) => ({
    enunciado: `Enunciado de la pregunta ${i + 1}`,
    opciones: LETRAS.map((letra) => ({ letra, texto: `Opción ${letra} de la pregunta ${i + 1}` })),
    letraElegida: plan.elegida,
    letraCorrecta: plan.correcta,
    solucion: plan.conSolucion ? `Solución de la pregunta ${i + 1}` : null,
  }));
}

export function habilidadesDeEjemplo(): Record<string, unknown>[] {
  return [
    { descripcion: "calcula la fuerza neta con $F = ma$", nivel: "lo_domina", respuestas: 3, aciertos: 3 },
    { descripcion: "aplica la conservación de la energía", nivel: "en_proceso", respuestas: 2, aciertos: 1 },
    { descripcion: "interpreta gráficas de posición", nivel: "no_lo_domina", respuestas: 2, aciertos: 0 },
    { descripcion: "resuelve problemas con rozamiento", nivel: "sin_medir", respuestas: 0, aciertos: 0 },
    { descripcion: "lee un diagrama de fuerzas", nivel: "no_lo_domina", respuestas: 1, aciertos: 0 },
    { descripcion: "descompone vectores", nivel: "lo_domina", respuestas: 1, aciertos: 1 },
    { descripcion: "relaciona trabajo y energía cinética", nivel: "en_proceso", respuestas: 1, aciertos: 1 },
    { descripcion: "usa la segunda ley de Newton", nivel: "lo_domina", respuestas: 2, aciertos: 2 },
  ];
}

export function erroresDeEjemplo(): Record<string, unknown>[] {
  return [
    {
      titulo: String.raw`usas $\frac{1}{2}$ sin cuadrar la velocidad`,
      estado: "confirmada",
      veces: 2,
      descripcionDeLaHabilidad: "interpreta gráficas de posición",
      detalles: ["Revisa qué magnitud va arriba."],
    },
    {
      titulo: "confundes energía con potencia",
      estado: "sospecha",
      veces: 1,
      descripcionDeLaHabilidad: "aplica la conservación de la energía",
      detalles: [],
    },
    {
      titulo: "ignoras la fricción",
      estado: "sospecha",
      veces: 1,
      // Una habilidad que no es de la Evaluación: su descripción se muestra igual.
      descripcionDeLaHabilidad: "calcula el trabajo de la fricción",
      detalles: ["La fricción también hace trabajo.", "Piensa en el sentido del movimiento."],
    },
    {
      titulo: "mezclas unidades",
      estado: "sospecha",
      veces: 1,
      // La foto solo guardó la clave de la habilidad: no hay descripción que mostrar.
      descripcionDeLaHabilidad: null,
      detalles: [],
    },
  ];
}

export function prerrequisitosDeEjemplo(): Record<string, unknown>[] {
  return [
    { materia: null, descripcion: "despeja una incógnita" },
    { materia: "Cálculo Diferencial", descripcion: "deriva polinomios" },
  ];
}

/**
 * La fila de una cita con diagnóstico, hecho por un Lead que autorizó con el texto nuevo (`v2`): trae las ocho preguntas. 5 de 8
 * correctas, no repetido. `cambios` sobrescribe columnas.
 */
export function filaDeEjemplo(cambios: FilaDelMonitor = {}): FilaDelMonitor {
  return {
    fecha: "2026-10-12",
    hora: "10:00:00",
    duracion_min: 60,
    nombre_materia: "Física II",
    nombre_estudiante: "Camila Rojas",
    hay_diagnostico: true,
    nombre_evaluacion: "Parcial 1",
    fecha_realizacion: "2026-10-05T04:30:00+00:00",
    respondidas: 8,
    aciertos: 5,
    repetido: false,
    habilidades: habilidadesDeEjemplo(),
    errores: erroresDeEjemplo(),
    prerrequisitos: prerrequisitosDeEjemplo(),
    respuestas_autorizadas: true,
    preguntas: preguntasDeEjemplo(),
    ...cambios,
  };
}

/** La fila de una cita que se ve y no tiene diagnóstico ligado: la cabecera y diez nulos. */
export function filaSinDiagnostico(cambios: FilaDelMonitor = {}): FilaDelMonitor {
  return {
    fecha: "2026-10-12",
    hora: "10:00:00",
    duracion_min: 60,
    nombre_materia: "Física II",
    nombre_estudiante: "Camila Rojas",
    hay_diagnostico: false,
    nombre_evaluacion: null,
    fecha_realizacion: null,
    respondidas: null,
    aciertos: null,
    repetido: null,
    habilidades: null,
    errores: null,
    prerrequisitos: null,
    respuestas_autorizadas: null,
    preguntas: null,
    ...cambios,
  };
}

/** La fila de un Lead que autorizó con el texto viejo (`v1`): todo menos las preguntas, y `respuestas_autorizadas` falso. */
export function filaSinRespuestasAutorizadas(cambios: FilaDelMonitor = {}): FilaDelMonitor {
  return filaDeEjemplo({ respuestas_autorizadas: false, preguntas: null, ...cambios });
}
