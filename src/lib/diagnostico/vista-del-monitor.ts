import type { Letra, NivelHabilidad } from "./motor";
import type { EstadoDeError } from "./presentacion";

/**
 * Lo que el monitor ve del diagnóstico de su cita (HU-022), sin React ni servidor. Aquí están los tipos de la vista, el lector
 * estricto de lo que devuelve `public.diagnostico_de_mi_monitoria`, el orden por nivel y los textos. Lo que las pruebas y la e2e
 * buscan en pantalla está en `TEXTOS`; ni los componentes ni la página lo escriben a mano.
 *
 * La función de la base ya proyecta: no trae claves de pregunta, habilidad, misconcepción ni materia, ni contacto, ni ids del Lead o
 * de la sesión. Este módulo no se fía de eso: valida cada valor y construye objetos nuevos con las claves de la vista y nada más.
 *
 * Esto llega al navegador (lo importa `ResultadoDelDiagnostico` para «Lo eligió N veces»), y la e2e importa los textos desde una
 * spec: por eso solo hay imports relativos, y de `motor.ts` y `presentacion.ts` únicamente tipos (`import type`), para no arrastrar
 * el motor.
 */

// ---------------------------------------------------------------------------
// Textos (B8 del SPEC)
// ---------------------------------------------------------------------------

export const TEXTOS = {
  // Pantalla
  eyebrow: "Mi agenda",
  tituloDeLaPestana: "Diagnóstico de la cita · Calibra",
  tituloSinNombre: "Diagnóstico de la cita",
  volver: "Volver a mi agenda",
  errorDeCarga: "No pudimos cargar el diagnóstico. Recarga la página; si sigue igual, avisa al equipo.",
  sinDiagnostico: "No hay diagnóstico de esta materia ligado a esta monitoría.",
  // Resumen
  repetido: "Lo tomó otra vez; puede incluir preguntas que ya había visto.",
  resumen: "Resumen del diagnóstico",
  evaluacion: "Evaluación:",
  fecha: "Fecha:",
  // Habilidades
  habilidades: "Habilidades",
  noSeMidio: "No se midió",
  // Errores y prerrequisitos
  errores: "Errores",
  sinErrores: "No se detectaron errores concretos.",
  prerrequisitos: "Prerrequisitos",
  // Preguntas
  preguntas: "Preguntas",
  acerto: "Acertó",
  fallo: "Falló",
  eligio: "Eligió",
  correcta: "Correcta",
  solucion: "Solución",
  noAutorizo: "El estudiante no autorizó compartir sus respuestas.",
  // La agenda y el panel
  verDiagnostico: "Ver diagnóstico",
  panel: "Abre tus franjas para que te agenden. En tu agenda ves quién agendó y abres el diagnóstico de cada cita confirmada o realizada.",
} as const;

// ---------------------------------------------------------------------------
// Tipos de la vista
// ---------------------------------------------------------------------------

export type HabilidadParaElMonitor = { descripcion: string; nivel: NivelHabilidad; respuestas: number; aciertos: number };

export type ErrorParaElMonitor = {
  titulo: string;
  estado: EstadoDeError;
  /** Cuántas veces eligió una opción de ese error. */
  veces: number;
  /** La descripción de la habilidad, también si no es de la Evaluación; null si la foto solo guardó su clave. */
  descripcionDeLaHabilidad: string | null;
  /** El texto de error propio de la opción elegida (D-49 d); vacío si ninguna lo trae. */
  detalles: string[];
};

/** `materia` es el nombre de la otra materia, o null si es la misma. */
export type PrerrequisitoParaElMonitor = { materia: string | null; descripcion: string };

export type OpcionDeLaPregunta = { letra: Letra; texto: string };

/** Una pregunta que respondió, con las opciones en el orden en que él las vio y las letras ya en ese orden. */
export type PreguntaDelMonitor = {
  enunciado: string;
  opciones: OpcionDeLaPregunta[];
  letraElegida: Letra;
  letraCorrecta: Letra;
  solucion: string | null;
};

export type DiagnosticoParaElMonitor = {
  nombreEvaluacion: string;
  /** ISO; el componente la formatea en hora de Bogotá. */
  fechaRealizacion: string;
  respondidas: number;
  /** Preguntas acertadas (no la suma por habilidad, que cuenta dos veces una pregunta de varias habilidades). */
  aciertos: number;
  repetido: boolean;
  /** En el orden guardado, que es el de la materia. El nivel es el que guardó el motor. */
  habilidades: HabilidadParaElMonitor[];
  /** Los confirmados primero. */
  errores: ErrorParaElMonitor[];
  prerrequisitos: PrerrequisitoParaElMonitor[];
  /** Null si el Lead de la cita no autorizó compartir las respuestas (D-67). */
  preguntas: PreguntaDelMonitor[] | null;
};

export type VistaDelMonitor = {
  cita: { fecha: string; hora: string; duracionMin: number; nombreMateria: string; nombreEstudiante: string };
  /** Null: la cita se ve pero no tiene diagnóstico ligado. */
  diagnostico: DiagnosticoParaElMonitor | null;
};

/**
 * Todas las claves que puede tener la respuesta de `diagnostico_de_mi_monitoria`, por nivel. Una prueba compara lo que sale de la
 * base contra estas listas cerradas.
 */
export const CLAVES_DE_LA_VISTA_POR_NIVEL = {
  fila: [
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
  ],
  habilidad: ["descripcion", "nivel", "respuestas", "aciertos"],
  error: ["titulo", "estado", "veces", "descripcionDeLaHabilidad", "detalles"],
  prerrequisito: ["materia", "descripcion"],
  pregunta: ["enunciado", "opciones", "letraElegida", "letraCorrecta", "solucion"],
  opcion: ["letra", "texto"],
} as const satisfies Record<string, readonly string[]>;

/** La unión de todas, para el recorrido recursivo de las claves de una respuesta (como `CLAVES_DEL_RESULTADO` de HU-009). */
export const CLAVES_DE_LA_VISTA: readonly string[] = [...new Set(Object.values(CLAVES_DE_LA_VISTA_POR_NIVEL).flat())];

// ---------------------------------------------------------------------------
// Lector estricto
// ---------------------------------------------------------------------------

/**
 * La forma en que lo que devolvió la base no cuadra. Lleva solo la ruta del dato malo (`habilidades[2].nivel`), nunca su
 * contenido: el mensaje llega a los registros del servidor.
 */
export class ErrorDeVistaDelMonitor extends Error {
  readonly ruta: string;

  constructor(ruta: string) {
    super(`La vista del diagnóstico no tiene la forma esperada (${ruta}).`);
    this.name = "ErrorDeVistaDelMonitor";
    this.ruta = ruta;
  }
}

/** Las columnas de la fila que son del diagnóstico: todas son nulas cuando la cita no tiene uno. */
const COLUMNAS_DEL_DIAGNOSTICO = [
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
] as const;

const NIVELES: readonly string[] = ["lo_domina", "en_proceso", "no_lo_domina", "sin_medir"];
const ESTADOS: readonly string[] = ["confirmada", "sospecha"];
const LETRAS_DE_LAS_OPCIONES: readonly Letra[] = ["A", "B", "C", "D"];
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

function exigirObjeto(valor: unknown, ruta: string): Record<string, unknown> {
  if (!esObjeto(valor)) throw new ErrorDeVistaDelMonitor(ruta);
  return valor;
}

function exigirTexto(valor: unknown, ruta: string): string {
  if (typeof valor !== "string") throw new ErrorDeVistaDelMonitor(ruta);
  return valor;
}

function exigirTextoONulo(valor: unknown, ruta: string): string | null {
  return valor === null ? null : exigirTexto(valor, ruta);
}

function exigirEntero(valor: unknown, ruta: string, minimo = 0): number {
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < minimo) throw new ErrorDeVistaDelMonitor(ruta);
  return valor;
}

function exigirBooleano(valor: unknown, ruta: string): boolean {
  if (typeof valor !== "boolean") throw new ErrorDeVistaDelMonitor(ruta);
  return valor;
}

function exigirLista(valor: unknown, ruta: string): unknown[] {
  if (!Array.isArray(valor)) throw new ErrorDeVistaDelMonitor(ruta);
  return valor;
}

function exigirNulo(valor: unknown, ruta: string): void {
  if (valor !== null) throw new ErrorDeVistaDelMonitor(ruta);
}

/** `AAAA-MM-DD` que existe en el calendario. */
function exigirDia(valor: unknown, ruta: string): string {
  const dia = exigirTexto(valor, ruta);
  const instante = new Date(`${dia}T12:00:00Z`);
  if (!DIA.test(dia) || Number.isNaN(instante.getTime()) || instante.toISOString().slice(0, 10) !== dia) throw new ErrorDeVistaDelMonitor(ruta);
  return dia;
}

function exigirHora(valor: unknown, ruta: string): string {
  const hora = exigirTexto(valor, ruta);
  if (!HORA.test(hora)) throw new ErrorDeVistaDelMonitor(ruta);
  return hora;
}

function exigirInstante(valor: unknown, ruta: string): string {
  const instante = new Date(exigirTexto(valor, ruta));
  if (Number.isNaN(instante.getTime())) throw new ErrorDeVistaDelMonitor(ruta);
  return instante.toISOString();
}

function exigirLetra(valor: unknown, ruta: string): Letra {
  if (typeof valor !== "string" || !LETRAS_DE_LAS_OPCIONES.includes(valor as Letra)) throw new ErrorDeVistaDelMonitor(ruta);
  return valor as Letra;
}

function leerHabilidad(valor: unknown, ruta: string): HabilidadParaElMonitor {
  const h = exigirObjeto(valor, ruta);
  const descripcion = exigirTexto(h.descripcion, `${ruta}.descripcion`);
  const nivel = exigirTexto(h.nivel, `${ruta}.nivel`);
  if (!NIVELES.includes(nivel)) throw new ErrorDeVistaDelMonitor(`${ruta}.nivel`);
  const respuestas = exigirEntero(h.respuestas, `${ruta}.respuestas`);
  const aciertos = exigirEntero(h.aciertos, `${ruta}.aciertos`);
  if (aciertos > respuestas) throw new ErrorDeVistaDelMonitor(`${ruta}.aciertos`);
  return { descripcion, nivel: nivel as NivelHabilidad, respuestas, aciertos };
}

function leerError(valor: unknown, ruta: string): ErrorParaElMonitor {
  const e = exigirObjeto(valor, ruta);
  const titulo = exigirTexto(e.titulo, `${ruta}.titulo`);
  const estado = exigirTexto(e.estado, `${ruta}.estado`);
  if (!ESTADOS.includes(estado)) throw new ErrorDeVistaDelMonitor(`${ruta}.estado`);
  const veces = exigirEntero(e.veces, `${ruta}.veces`);
  const descripcionDeLaHabilidad = exigirTextoONulo(e.descripcionDeLaHabilidad, `${ruta}.descripcionDeLaHabilidad`);
  const detalles = exigirLista(e.detalles, `${ruta}.detalles`).map((detalle, i) => exigirTexto(detalle, `${ruta}.detalles[${i}]`));
  return { titulo, estado: estado as EstadoDeError, veces, descripcionDeLaHabilidad, detalles };
}

function leerPrerrequisito(valor: unknown, ruta: string): PrerrequisitoParaElMonitor {
  const p = exigirObjeto(valor, ruta);
  return { materia: exigirTextoONulo(p.materia, `${ruta}.materia`), descripcion: exigirTexto(p.descripcion, `${ruta}.descripcion`) };
}

function leerPregunta(valor: unknown, ruta: string): PreguntaDelMonitor {
  const p = exigirObjeto(valor, ruta);
  const enunciado = exigirTexto(p.enunciado, `${ruta}.enunciado`);
  const crudas = exigirLista(p.opciones, `${ruta}.opciones`);
  // Exactamente cuatro, y la letra de cada una es la de su posición: la base las numeró en el orden en que las vio.
  if (crudas.length !== LETRAS_DE_LAS_OPCIONES.length) throw new ErrorDeVistaDelMonitor(`${ruta}.opciones`);
  const opciones = crudas.map((cruda, i): OpcionDeLaPregunta => {
    const o = exigirObjeto(cruda, `${ruta}.opciones[${i}]`);
    const letra = exigirLetra(o.letra, `${ruta}.opciones[${i}].letra`);
    if (letra !== LETRAS_DE_LAS_OPCIONES[i]) throw new ErrorDeVistaDelMonitor(`${ruta}.opciones[${i}].letra`);
    return { letra, texto: exigirTexto(o.texto, `${ruta}.opciones[${i}].texto`) };
  });
  return {
    enunciado,
    opciones,
    letraElegida: exigirLetra(p.letraElegida, `${ruta}.letraElegida`),
    letraCorrecta: exigirLetra(p.letraCorrecta, `${ruta}.letraCorrecta`),
    solucion: exigirTextoONulo(p.solucion, `${ruta}.solucion`),
  };
}

/**
 * Lo que devuelve `rpc("diagnostico_de_mi_monitoria")` a la vista que pinta la pantalla. `[]` o `null` es que la cita no se ve (no
 * existe, no es suya, es grupal o su estado no se ve): devuelve `null` sin distinguir cuál. Más de una fila, o un valor que no
 * cuadra (un nivel desconocido, tres opciones, `aciertos` mayor que `respondidas`, tantas preguntas como respondidas, una
 * autorización que no cuadra con las preguntas), lanza `ErrorDeVistaDelMonitor` con la ruta del dato y nunca su contenido.
 * Construye objetos nuevos: una clave de más en la fila no sale.
 */
export function leerVistaDelMonitor(datos: unknown): VistaDelMonitor | null {
  if (datos === null || datos === undefined) return null;
  const filas = exigirLista(datos, "filas");
  if (filas.length === 0) return null;
  if (filas.length > 1) throw new ErrorDeVistaDelMonitor("filas");
  const fila = exigirObjeto(filas[0], "fila");

  const cita = {
    fecha: exigirDia(fila.fecha, "fecha"),
    hora: exigirHora(fila.hora, "hora"),
    duracionMin: exigirEntero(fila.duracion_min, "duracion_min", 1),
    nombreMateria: exigirTexto(fila.nombre_materia, "nombre_materia"),
    nombreEstudiante: exigirTexto(fila.nombre_estudiante, "nombre_estudiante"),
  };

  if (!exigirBooleano(fila.hay_diagnostico, "hay_diagnostico")) {
    // Sin diagnóstico, todo lo suyo es nulo: una cita con datos de un diagnóstico que no hay no cuadra.
    for (const columna of COLUMNAS_DEL_DIAGNOSTICO) exigirNulo(fila[columna], columna);
    return { cita, diagnostico: null };
  }

  const nombreEvaluacion = exigirTexto(fila.nombre_evaluacion, "nombre_evaluacion");
  const fechaRealizacion = exigirInstante(fila.fecha_realizacion, "fecha_realizacion");
  const respondidas = exigirEntero(fila.respondidas, "respondidas");
  const aciertos = exigirEntero(fila.aciertos, "aciertos");
  if (aciertos > respondidas) throw new ErrorDeVistaDelMonitor("aciertos");
  const repetido = exigirBooleano(fila.repetido, "repetido");
  const habilidades = exigirLista(fila.habilidades, "habilidades").map((h, i) => leerHabilidad(h, `habilidades[${i}]`));
  const errores = exigirLista(fila.errores, "errores").map((e, i) => leerError(e, `errores[${i}]`));
  const prerrequisitos = exigirLista(fila.prerrequisitos, "prerrequisitos").map((p, i) => leerPrerrequisito(p, `prerrequisitos[${i}]`));

  // Las preguntas salen solo si el Lead de la cita autorizó con el texto que nombra las respuestas (D-67), y entonces son tantas
  // como las que respondió.
  const autorizadas = exigirBooleano(fila.respuestas_autorizadas, "respuestas_autorizadas");
  let preguntas: PreguntaDelMonitor[] | null = null;
  if (autorizadas) {
    preguntas = exigirLista(fila.preguntas, "preguntas").map((p, i) => leerPregunta(p, `preguntas[${i}]`));
    if (preguntas.length !== respondidas) throw new ErrorDeVistaDelMonitor("preguntas");
  } else {
    exigirNulo(fila.preguntas, "preguntas");
  }

  return {
    cita,
    diagnostico: { nombreEvaluacion, fechaRealizacion, respondidas, aciertos, repetido, habilidades, errores, prerrequisitos, preguntas },
  };
}

// ---------------------------------------------------------------------------
// Orden y textos
// ---------------------------------------------------------------------------

const RANGO_POR_MIRAR: readonly NivelHabilidad[] = ["no_lo_domina", "en_proceso", "sin_medir"];

/**
 * Las habilidades a mirar, por nivel (no lo domina, en proceso, sin medir) y, dentro de cada nivel, en el orden de la materia; y
 * aparte las que domina, que conservan el orden de la materia. No cambia ningún nivel: el que guardó el motor es el que se muestra.
 */
export function agruparHabilidades<T extends { nivel: NivelHabilidad }>(habilidades: readonly T[]): { paraMirar: T[]; dominadas: T[] } {
  return {
    paraMirar: RANGO_POR_MIRAR.flatMap((nivel) => habilidades.filter((h) => h.nivel === nivel)),
    dominadas: habilidades.filter((h) => h.nivel === "lo_domina"),
  };
}

const ETIQUETAS_DE_NIVEL: Record<NivelHabilidad, string> = {
  no_lo_domina: "No lo domina",
  en_proceso: "En proceso",
  sin_medir: "Sin medir",
  lo_domina: "Lo domina",
};

/** El nivel escrito, en tercera persona (la persona lo ve en segunda: «Lo dominas»). Nunca solo color. */
export function etiquetaDeNivelParaElMonitor(nivel: NivelHabilidad): string {
  return ETIQUETAS_DE_NIVEL[nivel];
}

/** `Lo domina (3)`: el resumen de las habilidades plegadas, con su número. */
export function textoDeLasDominadas(cantidad: number): string {
  return `${ETIQUETAS_DE_NIVEL.lo_domina} (${cantidad})`;
}

/** `5 de 8 correctas`: preguntas acertadas de las respondidas, no habilidades. Con una sola, `a de 1 correcta`. */
export function textoDeCorrectas(aciertos: number, respondidas: number): string {
  return `${aciertos} de ${respondidas} ${respondidas === 1 ? "correcta" : "correctas"}`;
}

/**
 * Qué se dice de las respuestas de una habilidad. «No se midió» (sin el motivo) solo si es `sin_medir` y no tiene respuestas: son dos
 * condiciones independientes, y una `no_lo_domina` sin respuestas o una `sin_medir` con alguna dicen sus cifras. Si no,
 * `1 respuesta · 1 acierto` o `3 respuestas · 2 aciertos`, cada una en su singular o plural.
 */
export function textoDeRespuestas(h: { nivel: NivelHabilidad; respuestas: number; aciertos: number }): string {
  if (h.respuestas === 0 && h.nivel === "sin_medir") return TEXTOS.noSeMidio;
  const respuestas = h.respuestas === 1 ? "1 respuesta" : `${h.respuestas} respuestas`;
  const aciertos = h.aciertos === 1 ? "1 acierto" : `${h.aciertos} aciertos`;
  return `${respuestas} · ${aciertos}`;
}

/** `Lo eligió 1 vez` / `Lo eligió 2 veces`. */
export function textoDeVeces(veces: number): string {
  return veces === 1 ? "Lo eligió 1 vez" : `Lo eligió ${veces} veces`;
}

/** «Acertó» si la letra que eligió es la correcta (las dos en el orden en que las vio); si no, «Falló». */
export function marcaDeLaPregunta(pregunta: { letraElegida: Letra; letraCorrecta: Letra }): typeof TEXTOS.acerto | typeof TEXTOS.fallo {
  return pregunta.letraElegida === pregunta.letraCorrecta ? TEXTOS.acerto : TEXTOS.fallo;
}
