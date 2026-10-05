/**
 * Motor del diagnóstico adaptativo (HU-060): funciones puras que eligen la siguiente pregunta, califican por
 * habilidad y preparan lo que ve el navegador. Las reglas con número ("regla 4") son las de `backlog/HU-060.md`; el
 * porqué está en `docs/diseno/2026-09-29-banco-por-habilidades.md`. D-49 (nunca se repite una pregunta) y D-51 (el
 * servidor pasa las vistas antes vacías al volver a tomar un diagnóstico) no cambian este archivo.
 *
 * No importa Supabase, Next ni `server-only`, y no usa `Math.random` ni la hora: todo entra por parámetros
 * (`EntradaMotor` y los pasos ya respondidos), así que las mismas entradas dan siempre la misma salida. La base, el
 * diagnóstico en curso y lo que viaja al navegador son de HU-081.
 *
 * No guarda nada entre llamadas: cada función vuelve a recorrer los pasos. Califica con la copia de cada paso
 * (`CopiaDePaso`) y nunca con el banco actual, para que editar o retirar una pregunta no cambie un diagnóstico ya
 * tomado. Del banco de ese momento solo sale lo que todavía puede preguntar (`candidatas`) y los textos de las
 * misconcepciones y de las habilidades.
 */

/** Preguntas máximas de un diagnóstico (regla 7). La Evaluación no tiene campo de tope. */
export const TOPE_DIAGNOSTICO = 20;

/** Dificultad a la que apunta la primera pregunta de cada habilidad (regla 4). */
const DIFICULTAD_RONDA_1 = 2;
/** Dificultad a la que apunta la segunda pregunta tras un acierto fácil o medio (regla 6). */
const DIFICULTAD_TRAS_ACIERTO = 3;
/** Como el prototipo: el flujo de cada paso es `semilla + paso × 7919 + 17` (regla 1). */
const PRIMO_DEL_PASO = 7919;
const SUMA_DEL_PASO = 17;
/** Flujo propio del orden de la ronda 1: el `barajarCon(…, 90001)` del prototipo (regla 1). */
const SALTO_ORDEN_RONDA_1 = 90_001;
const SUMA_ORDEN_RONDA_1 = 101;
/** Preguntas que el motor elige para una misma habilidad (regla 6). Puede sumar más con preguntas elegidas para otra. */
const MAXIMAS_ELEGIDAS_POR_HABILIDAD = 2;
const MAXIMA_SEMILLA = 0xffff_ffff;

export const LETRAS = ["A", "B", "C", "D"] as const;
export type Letra = (typeof LETRAS)[number];
export type Dificultad = 1 | 2 | 3;

/** Los cuatro niveles de una habilidad (regla 10). */
export type NivelHabilidad = "lo_domina" | "en_proceso" | "no_lo_domina" | "sin_medir";
/** Los tres estados de una misconcepción, los mismos de `evidenciaKc` del prototipo (regla 9). */
export type EstadoMisconcepcion = "sospecha" | "confirmada" | "descartada";
/** Por qué a una habilidad le falta material (regla 12, D-49 c). */
export type MotivoFaltaMaterial = "sin_preguntas_sin_ver" | "tope_una_respuesta";

// ---------------------------------------------------------------------------
// Entrada: la arma el servidor (HU-081)
// ---------------------------------------------------------------------------

/** Un prerrequisito directo de una habilidad. `materia` es la carpeta de otra materia, o null si es de la misma. */
export interface PrerrequisitoDeEntrada {
  materia: string | null;
  habilidad: string;
  descripcion: string;
}

/** Una habilidad de la Evaluación, con sus temas ya expandidos si es acumulativa. */
export interface HabilidadDeEntrada {
  clave: string;
  descripcion: string;
  prerrequisitos: PrerrequisitoDeEntrada[];
}

/** Una misconcepción de la materia y la habilidad a la que pertenece. */
export interface MisconcepcionDeEntrada {
  clave: string;
  habilidad: string;
  /** El título del error que ve el estudiante al terminar. */
  descripcion: string;
}

/** Una opción tal como está en el banco. Su posición en la lista es su letra del banco (A a D). */
export interface OpcionDeCopia {
  texto: string;
  correcta: boolean;
  /** Clave de la misconcepción. Solo en las incorrectas. */
  misconcepcion: string | null;
  /** Texto de error propio de la opción (D-14). Null: vale el de la misconcepción. */
  error: string | null;
}

/** Una pregunta `revisada` que mide al menos una habilidad de la Evaluación (D-13). */
export interface PreguntaCandidata {
  clave: string;
  tema: string;
  enunciado: string;
  /** Las 4 opciones en el orden del banco. */
  opciones: OpcionDeCopia[];
  dificultad: Dificultad;
  /** Claves de todas las habilidades que mide, también las que no son de la Evaluación. */
  habilidades: string[];
  solucion: string | null;
}

export interface EntradaMotor {
  /** Las de la Evaluación, en el orden de la materia. */
  habilidades: HabilidadDeEntrada[];
  /** Las de la materia. */
  misconcepciones: MisconcepcionDeEntrada[];
  candidatas: PreguntaCandidata[];
  /** Claves de preguntas que la misma persona vio en diagnósticos terminados (D-49 a). Vacía al repetir (D-51). */
  vistasAntes: readonly string[];
  /** Entero de 32 bits sin signo. */
  semilla: number;
}

/**
 * Orden en que se mostraron las opciones: `orden[i]` es la letra del banco de la opción que se vio en la posición `i`
 * (la posición 0 es la A que ve el estudiante). Siempre es una permutación de A a D.
 */
export type OrdenDeOpciones = readonly Letra[];

/**
 * La copia de un paso respondido, que guarda HU-081: la pregunta tal como estaba en el banco al mostrarla, el orden
 * en que se vieron las opciones y lo que eligió el estudiante. `letraElegida` es la letra que vio, no la del banco.
 */
export interface CopiaDePaso extends PreguntaCandidata {
  orden: OrdenDeOpciones;
  letraElegida: Letra;
  /** Instante de la respuesta, en ISO 8601. El motor no lo lee: no usa la hora. */
  fecha: string;
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export interface PreguntaElegida {
  clave: string;
  orden: OrdenDeOpciones;
  /** Habilidad para la que se eligió la pregunta. Es para pruebas y bitácora: no se guarda ni llega al navegador. */
  habilidad: string;
  ronda: 1 | 2;
}

export interface DiagnosticoTerminado {
  terminado: true;
}

export type SiguientePregunta = PreguntaElegida | DiagnosticoTerminado;

export interface ResultadoHabilidad {
  habilidad: string;
  descripcion: string;
  nivel: NivelHabilidad;
  /** Respuestas que le cuenta la regla 8. */
  respuestas: number;
  aciertos: number;
  /** Vacía si no le falta material. */
  faltaMaterial: MotivoFaltaMaterial[];
}

export interface ErrorDetectado {
  misconcepcion: string;
  habilidad: string;
  /** La descripción de la misconcepción: el título del error (D-49 d). */
  texto: string;
  estado: "confirmada" | "sospecha";
  veces: number;
  /** Textos de error propios (D-14) de las opciones que eligió, sin repetir: el detalle (D-49 d). */
  detalles: string[];
}

export interface PrerrequisitoDeResultado {
  /** Carpeta de la otra materia, o null si es de la misma. */
  materia: string | null;
  habilidad: string;
  descripcion: string;
}

export interface ResultadoDiagnostico {
  /** Todas las de la Evaluación, en el orden de la materia. */
  habilidades: ResultadoHabilidad[];
  /** Primero las confirmadas, luego por orden de aparición. */
  errores: ErrorDetectado[];
  prerrequisitos: PrerrequisitoDeResultado[];
  /** Aciertos sobre preguntas respondidas, de 0 a 100 con dos decimales. */
  puntaje: number;
}

/** Lo único que recibe el navegador de una pregunta: sin clave, dificultad, correcta, misconcepción ni solución. */
export interface PreguntaParaNavegador {
  enunciado: string;
  opciones: { letra: Letra; texto: string }[];
}

/** Estado de una misconcepción tras recorrer los pasos (regla 9). */
export interface EstadoDeMisconcepcion {
  estado: EstadoMisconcepcion;
  /** Cuántas veces la eligió. */
  veces: number;
  /** Cuántas veces la pregunta la ofrecía en sospecha y no la eligió. */
  sondeos: number;
  /** Índice del primer paso donde la eligió. */
  primerPaso: number;
  /** Textos de error propios de las opciones que eligió, sin repetir. */
  detalles: string[];
}

// ---------------------------------------------------------------------------
// Azar (regla 1)
// ---------------------------------------------------------------------------

/** El generador del prototipo: la misma semilla da siempre la misma corriente. */
export function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flujoDelPaso(semilla: number, paso: number): () => number {
  return mulberry32((semilla + paso * PRIMO_DEL_PASO + SUMA_DEL_PASO) >>> 0);
}

function flujoDelOrden(semilla: number): () => number {
  return mulberry32((semilla + SALTO_ORDEN_RONDA_1 * PRIMO_DEL_PASO + SUMA_ORDEN_RONDA_1) >>> 0);
}

/** Baraja una copia de la lista (Fisher-Yates, como el prototipo). */
function barajar<T>(lista: readonly T[], azar: () => number): T[] {
  const copia = lista.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** De las candidatas, una al azar entre las de dificultad más cercana al objetivo. Exige al menos una. */
function azarCercana(candidatas: readonly PreguntaCandidata[], objetivo: number, azar: () => number): PreguntaCandidata {
  const distancia = (candidata: PreguntaCandidata) => Math.abs(candidata.dificultad - objetivo);
  const mejor = Math.min(...candidatas.map(distancia));
  const empatadas = candidatas.filter((candidata) => distancia(candidata) === mejor);
  return empatadas[Math.floor(azar() * empatadas.length)];
}

// ---------------------------------------------------------------------------
// Validación y opciones barajadas (regla 2)
// ---------------------------------------------------------------------------

function exigirSemilla(semilla: number): void {
  if (!Number.isInteger(semilla) || semilla < 0 || semilla > MAXIMA_SEMILLA) {
    throw new RangeError(`semilla debe ser un entero de 32 bits sin signo (llegó ${String(semilla)}).`);
  }
}

function exigirOrden(orden: OrdenDeOpciones): void {
  if (orden.length !== LETRAS.length || LETRAS.some((letra) => !orden.includes(letra))) {
    throw new RangeError(`orden debe ser una permutación de A, B, C y D (llegó ${JSON.stringify(orden)}).`);
  }
}

function posicionDeLetra(letra: Letra): number {
  const posicion = LETRAS.indexOf(letra);
  if (posicion < 0) throw new RangeError(`La letra debe ser A, B, C o D (llegó ${String(letra)}).`);
  return posicion;
}

function exigirPregunta(pregunta: PreguntaCandidata): void {
  if (pregunta.opciones.length !== LETRAS.length) {
    throw new RangeError(`La pregunta ${pregunta.clave} debe tener 4 opciones (tiene ${pregunta.opciones.length}).`);
  }
  if (pregunta.dificultad !== 1 && pregunta.dificultad !== 2 && pregunta.dificultad !== 3) {
    throw new RangeError(`La dificultad de ${pregunta.clave} debe ser 1, 2 o 3 (llegó ${String(pregunta.dificultad)}).`);
  }
}

function exigirEntrada(entrada: EntradaMotor): void {
  exigirSemilla(entrada.semilla);
  const claves = new Set<string>();
  for (const candidata of entrada.candidatas) {
    exigirPregunta(candidata);
    if (claves.has(candidata.clave)) throw new RangeError(`La pregunta ${candidata.clave} está repetida en las candidatas.`);
    claves.add(candidata.clave);
  }
  if (new Set(entrada.habilidades.map((habilidad) => habilidad.clave)).size !== entrada.habilidades.length) {
    throw new RangeError("Las habilidades de la Evaluación no pueden repetirse.");
  }
}

/** La letra del banco que corresponde a la letra que vio el estudiante (regla 2). */
export function opcionDeLetra(orden: OrdenDeOpciones, letra: Letra): Letra {
  exigirOrden(orden);
  return orden[posicionDeLetra(letra)];
}

/** La opción que eligió el estudiante en un paso, tal como estaba en el banco. */
export function opcionElegida(paso: Pick<CopiaDePaso, "opciones" | "orden" | "letraElegida">): OpcionDeCopia {
  return paso.opciones[posicionDeLetra(opcionDeLetra(paso.orden, paso.letraElegida))];
}

/**
 * Lo que recibe el navegador (criterio de D-14): el enunciado y las opciones en el orden barajado, con la letra de la
 * posición mostrada y nunca la del banco. Los objetos son nuevos: no arrastran la correcta, la misconcepción ni el error.
 */
export function paraNavegador(copia: Pick<PreguntaCandidata, "enunciado" | "opciones">, orden: OrdenDeOpciones): PreguntaParaNavegador {
  exigirOrden(orden);
  return {
    enunciado: copia.enunciado,
    opciones: LETRAS.map((letra, posicion) => ({ letra, texto: copia.opciones[posicionDeLetra(orden[posicion])].texto })),
  };
}

// ---------------------------------------------------------------------------
// Estados de las misconcepciones (regla 9)
// ---------------------------------------------------------------------------

/** Las misconcepciones que una pregunta ofrece como trampa, sin repetir. */
function trampasDe(opciones: readonly OpcionDeCopia[]): string[] {
  const trampas: string[] = [];
  for (const opcion of opciones) {
    if (!opcion.correcta && opcion.misconcepcion !== null && !trampas.includes(opcion.misconcepcion)) {
      trampas.push(opcion.misconcepcion);
    }
  }
  return trampas;
}

/**
 * Recorre los pasos en orden, como `evidenciaKc` del prototipo (index.html:5458-5491):
 * - si eligió X, sube `veces`: con 2 o más X queda confirmada; si no, en sospecha;
 * - si X estaba en sospecha, la pregunta la ofrecía y no la eligió, sube `sondeos`; si además acertó, X queda descartada;
 * - una descartada que vuelve a elegir llega a 2 veces y queda confirmada; una confirmada no cambia.
 */
export function estadosDeMisconcepciones(pasos: readonly CopiaDePaso[]): Map<string, EstadoDeMisconcepcion> {
  const estados = new Map<string, EstadoDeMisconcepcion>();
  pasos.forEach((paso, indice) => aplicarPasoAEstados(estados, paso, indice));
  return estados;
}

/** Un paso de `estadosDeMisconcepciones`: `recorrer` lo aplica uno a uno para saber qué sabía el motor antes de cada paso. */
function aplicarPasoAEstados(estados: Map<string, EstadoDeMisconcepcion>, paso: CopiaDePaso, indice: number): void {
  const elegida = opcionElegida(paso);
  const acierto = elegida.correcta;
  const elegidaMisconcepcion = acierto ? null : elegida.misconcepcion;

  for (const trampa of trampasDe(paso.opciones)) {
    const estado = estados.get(trampa);
    if (!estado || estado.estado !== "sospecha" || elegidaMisconcepcion === trampa) continue;
    estado.sondeos += 1;
    if (acierto) estado.estado = "descartada";
  }

  if (elegidaMisconcepcion !== null) {
    let estado = estados.get(elegidaMisconcepcion);
    if (!estado) {
      estado = { estado: "sospecha", veces: 0, sondeos: 0, primerPaso: indice, detalles: [] };
      estados.set(elegidaMisconcepcion, estado);
    }
    estado.veces += 1;
    estado.estado = estado.veces >= 2 ? "confirmada" : "sospecha";
    if (elegida.error !== null && !estado.detalles.includes(elegida.error)) estado.detalles.push(elegida.error);
  }
}

// ---------------------------------------------------------------------------
// Lo que dicen los pasos hasta ahora
// ---------------------------------------------------------------------------

interface RespuestaContada {
  paso: number;
  dificultad: Dificultad;
  acierto: boolean;
}

interface DatosDePaso {
  acierto: boolean;
  /** La misconcepción de la opción incorrecta elegida. */
  misconcepcion: string | null;
}

interface Recorrido {
  entrada: EntradaMotor;
  pasos: readonly CopiaDePaso[];
  datos: DatosDePaso[];
  misconcepciones: Map<string, EstadoDeMisconcepcion>;
  /** Por habilidad de la Evaluación: los pasos cuya pregunta la mide, la haya acreditado o no (regla 4: "cubre"). */
  preguntasDe: Map<string, number[]>;
  /** Por habilidad de la Evaluación: las respuestas que le cuenta la regla 8. */
  respuestasDe: Map<string, RespuestaContada[]>;
  /** Por habilidad de la Evaluación: ¿tiene una misconcepción suya confirmada? */
  confirmadaDe: Map<string, boolean>;
  /**
   * Por habilidad de la Evaluación: cuántas preguntas eligió el motor para ella (regla 6). No se guarda en los pasos:
   * `recorrer` lo reproduce, porque el motor es determinista y sabe a quién atendía antes de cada paso.
   */
  elegidasPara: Map<string, number>;
  /** El orden barajado de las habilidades (regla 4), que también desempata la ronda 2. */
  ordenRonda1: string[];
  /** La habilidad de cada misconcepción de la materia. */
  habilidadDeMisconcepcion: Map<string, string>;
  /** Por habilidad de la Evaluación: cuántas candidatas libres la miden. */
  cuantasLibres: Map<string, number>;
  /** Candidatas libres (regla 3), ordenadas por clave para que no dependan del orden en que llegaron. */
  libres: PreguntaCandidata[];
}

function porClave(a: PreguntaCandidata, b: PreguntaCandidata): number {
  return a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0;
}

/** Candidatas libres (regla 3): las que no salieron en este diagnóstico ni están en las vistas antes. */
function candidatasLibres(entrada: EntradaMotor, pasos: readonly CopiaDePaso[]): PreguntaCandidata[] {
  const vistas = new Set<string>(entrada.vistasAntes);
  for (const paso of pasos) vistas.add(paso.clave);
  const claves = new Set(entrada.habilidades.map((habilidad) => habilidad.clave));
  return entrada.candidatas
    .filter((candidata) => !vistas.has(candidata.clave) && candidata.habilidades.some((habilidad) => claves.has(habilidad)))
    .sort(porClave);
}

/**
 * Recorre los pasos en orden. Antes de aplicar cada uno pregunta al motor a quién atendía (`elegirAtencion`) para contar
 * las preguntas elegidas para cada habilidad, así que lo que sabe es lo mismo que sabía `siguientePregunta` en ese paso.
 */
function recorrer(entrada: EntradaMotor, pasos: readonly CopiaDePaso[]): Recorrido {
  const claves = entrada.habilidades.map((habilidad) => habilidad.clave);
  const enEvaluacion = new Set(claves);
  const habilidadDeMisconcepcion = new Map(entrada.misconcepciones.map((m) => [m.clave, m.habilidad]));
  const porHabilidad = <T>(inicial: () => T) => new Map<string, T>(claves.map((clave) => [clave, inicial()]));

  const datos: DatosDePaso[] = pasos.map((paso) => {
    exigirPregunta(paso);
    const elegida = opcionElegida(paso);
    const misconcepcion = elegida.correcta ? null : elegida.misconcepcion;
    if (misconcepcion !== null && !habilidadDeMisconcepcion.has(misconcepcion)) {
      throw new RangeError(`La misconcepción ${misconcepcion} de la pregunta ${paso.clave} no está en la entrada.`);
    }
    return { acierto: elegida.correcta, misconcepcion };
  });

  const recorrido: Recorrido = {
    entrada,
    pasos,
    datos,
    misconcepciones: new Map(),
    preguntasDe: porHabilidad<number[]>(() => []),
    respuestasDe: porHabilidad<RespuestaContada[]>(() => []),
    confirmadaDe: porHabilidad(() => false),
    elegidasPara: porHabilidad(() => 0),
    ordenRonda1: barajar(claves, flujoDelOrden(entrada.semilla)),
    habilidadDeMisconcepcion,
    cuantasLibres: porHabilidad(() => 0),
    libres: [],
  };

  // Las libres de cada habilidad al empezar; cada paso resta la que muestra.
  const libresAlEmpezar = new Map(candidatasLibres(entrada, []).map((candidata) => [candidata.clave, candidata]));
  for (const candidata of libresAlEmpezar.values()) {
    for (const habilidad of new Set(candidata.habilidades)) {
      if (enEvaluacion.has(habilidad)) recorrido.cuantasLibres.set(habilidad, (recorrido.cuantasLibres.get(habilidad) ?? 0) + 1);
    }
  }
  const mostradas = new Set<string>();

  pasos.forEach((paso, indice) => {
    const { acierto, misconcepcion } = datos[indice];

    // La pregunta cuenta como elegida para la habilidad que el motor atendía en este paso, si la pregunta la mide. Una
    // historia armada a mano puede traer pasos que el motor no habría elegido: esos no cuentan para nadie.
    const atendida = elegirAtencion(recorrido);
    if (atendida !== null && paso.habilidades.includes(atendida.habilidad)) {
      recorrido.elegidasPara.set(atendida.habilidad, (recorrido.elegidasPara.get(atendida.habilidad) ?? 0) + 1);
    }

    const medidas = [...new Set(paso.habilidades)].filter((habilidad) => enEvaluacion.has(habilidad));
    for (const habilidad of medidas) recorrido.preguntasDe.get(habilidad)?.push(indice);

    // Regla 8. Un acierto suma a todas las habilidades de la Evaluación que mide la pregunta. Un fallo con la
    // misconcepción de una habilidad que la pregunta mide es un fallo solo para esa; si no la mide, para todas.
    const habilidadDelError = misconcepcion === null ? null : (habilidadDeMisconcepcion.get(misconcepcion) ?? null);
    const acreditadas =
      acierto || habilidadDelError === null || !paso.habilidades.includes(habilidadDelError)
        ? medidas
        : medidas.filter((habilidad) => habilidad === habilidadDelError);
    for (const habilidad of acreditadas) {
      recorrido.respuestasDe.get(habilidad)?.push({ paso: indice, dificultad: paso.dificultad, acierto });
    }

    aplicarPasoAEstados(recorrido.misconcepciones, paso, indice);
    if (misconcepcion !== null && recorrido.misconcepciones.get(misconcepcion)?.estado === "confirmada") {
      const habilidad = habilidadDeMisconcepcion.get(misconcepcion);
      if (habilidad !== undefined && recorrido.confirmadaDe.has(habilidad)) recorrido.confirmadaDe.set(habilidad, true);
    }

    const candidata = libresAlEmpezar.get(paso.clave);
    if (candidata !== undefined && !mostradas.has(paso.clave)) {
      for (const habilidad of new Set(candidata.habilidades)) {
        if (enEvaluacion.has(habilidad)) recorrido.cuantasLibres.set(habilidad, (recorrido.cuantasLibres.get(habilidad) ?? 0) - 1);
      }
    }
    mostradas.add(paso.clave);
  });

  recorrido.libres = candidatasLibres(entrada, pasos);
  return recorrido;
}

function libresDe(recorrido: Recorrido, habilidad: string): PreguntaCandidata[] {
  return recorrido.libres.filter((candidata) => candidata.habilidades.includes(habilidad));
}

/** La duda de una habilidad (regla 5): el paso de referencia para elegirle la pregunta y si fue un fallo. */
interface Duda {
  paso: number;
  fallo: boolean;
  /** ¿Tiene una respuesta que le cuente la regla 8? Si no, las preguntas que la cubrieron se acreditaron a otra habilidad. */
  propia: boolean;
}

/**
 * Regla 5: la habilidad tiene duda si alguna pregunta la cubrió, ninguna misconcepción suya está confirmada, tiene a lo
 * más una respuesta que le cuenta la regla 8 y esa respuesta no fue un acierto en dificultad 3. Se cuentan las respuestas
 * que le acreditó la regla 8 y no las preguntas que la miden: una pregunta de varias habilidades cuyo fallo se acredita a
 * otra la cubre sin darle respuesta, y sin esto la habilidad podía quedar sin medir con preguntas libres.
 *
 * Con una respuesta, el paso de referencia es el de esa respuesta. Sin ninguna, es el de la última pregunta que la cubrió,
 * que fue un fallo acreditado a otra habilidad, y cuenta como fallo.
 */
function dudaDe(recorrido: Recorrido, habilidad: string): Duda | null {
  const preguntas = recorrido.preguntasDe.get(habilidad) ?? [];
  if (preguntas.length === 0 || recorrido.confirmadaDe.get(habilidad)) return null;
  const respuestas = recorrido.respuestasDe.get(habilidad) ?? [];
  if (respuestas.length === 0) return { paso: preguntas[preguntas.length - 1], fallo: true, propia: false };
  if (respuestas.length > 1) return null;
  const [unica] = respuestas;
  return unica.acierto && unica.dificultad === 3 ? null : { paso: unica.paso, fallo: !unica.acierto, propia: true };
}

/** Una duda se puede atender si queda una pregunta libre y a la habilidad no se le han elegido ya dos (regla 6). */
function esAtendible(recorrido: Recorrido, habilidad: string): boolean {
  return (recorrido.cuantasLibres.get(habilidad) ?? 0) > 0 && (recorrido.elegidasPara.get(habilidad) ?? 0) < MAXIMAS_ELEGIDAS_POR_HABILIDAD;
}

/** La habilidad a la que toca la siguiente pregunta y por qué. `paso` y `fallo` son los de su duda (solo en la ronda 2). */
interface Atencion {
  habilidad: string;
  ronda: 1 | 2;
  paso: number;
  fallo: boolean;
  propia: boolean;
}

/**
 * Reglas 4, 6 y 7 sin el azar: a quién le toca la siguiente pregunta con lo que dicen los pasos hasta ahora, o null si el
 * diagnóstico terminó (no queda habilidad por cubrir ni con duda atendible).
 * - Ronda 1: la primera habilidad, en el orden barajado, que todavía no tiene preguntas y tiene una libre.
 * - Ronda 2: primero las dudas de un fallo, la del fallo más reciente primero; luego las de un acierto. El desempate es
 *   el orden de la ronda 1.
 */
function elegirAtencion(recorrido: Recorrido): Atencion | null {
  for (const habilidad of recorrido.ordenRonda1) {
    const sinPreguntas = (recorrido.preguntasDe.get(habilidad) ?? []).length === 0;
    if (sinPreguntas && (recorrido.cuantasLibres.get(habilidad) ?? 0) > 0) {
      return { habilidad, ronda: 1, paso: -1, fallo: false, propia: false };
    }
  }
  const dudas = recorrido.ordenRonda1
    .flatMap((habilidad, posicion) => {
      const duda = dudaDe(recorrido, habilidad);
      return duda !== null && esAtendible(recorrido, habilidad) ? [{ habilidad, posicion, ...duda }] : [];
    })
    .sort((a, b) => Number(b.fallo) - Number(a.fallo) || (a.fallo ? b.paso - a.paso : 0) || a.posicion - b.posicion);
  return dudas.length === 0 ? null : { ...dudas[0], ronda: 2 };
}

// ---------------------------------------------------------------------------
// Siguiente pregunta (reglas 3, 4, 6 y 7)
// ---------------------------------------------------------------------------

/**
 * El máximo que se informa al empezar (regla 7): el menor entre 20, el doble de las habilidades con candidatas libres y
 * el número de candidatas libres. Cuenta las libres y no todas para que, con las vistas antes (D-49 a), el estudiante no
 * vea "1 de 8" en un diagnóstico que solo puede tener 4. El diagnóstico puede terminar antes.
 */
export function maximoDePreguntas(entrada: EntradaMotor): number {
  exigirEntrada(entrada);
  const libres = candidatasLibres(entrada, []);
  const conLibres = entrada.habilidades.filter((habilidad) => libres.some((candidata) => candidata.habilidades.includes(habilidad.clave)));
  return Math.min(TOPE_DIAGNOSTICO, 2 * conLibres.length, libres.length);
}

/**
 * ¿La respuesta a esta pregunta le cuenta a la habilidad pase lo que pase? No le cuenta si una trampa es de otra
 * habilidad que la misma pregunta mide: ese fallo se acredita solo a la otra (regla 8).
 */
function cuentaSiempreA(recorrido: Recorrido, candidata: PreguntaCandidata, habilidad: string): boolean {
  return trampasDe(candidata.opciones).every((misconcepcion) => {
    const delError = recorrido.habilidadDeMisconcepcion.get(misconcepcion);
    return delError === undefined || delError === habilidad || !candidata.habilidades.includes(delError);
  });
}

/** La pregunta elegida con sus opciones barajadas con lo que queda del flujo del paso (regla 2). */
function armarEleccion(candidata: PreguntaCandidata, habilidad: string, ronda: 1 | 2, azar: () => number): PreguntaElegida {
  return { clave: candidata.clave, orden: barajar(LETRAS, azar), habilidad, ronda };
}

/**
 * Elige la siguiente pregunta dados los pasos ya respondidos, o dice que terminó. `pasos.length` es el paso: la semilla y
 * ese número fijan el flujo de azar de la elección y del orden de las opciones (reglas 1 y 2).
 */
export function siguientePregunta(entrada: EntradaMotor, pasos: readonly CopiaDePaso[]): SiguientePregunta {
  exigirEntrada(entrada);
  if (pasos.length >= TOPE_DIAGNOSTICO) return { terminado: true };
  const recorrido = recorrer(entrada, pasos);
  const atencion = elegirAtencion(recorrido);
  if (atencion === null) return { terminado: true };

  const azar = flujoDelPaso(entrada.semilla, pasos.length);
  const { habilidad, paso, fallo } = atencion;
  let libres = libresDe(recorrido, habilidad);
  if (atencion.ronda === 1) return armarEleccion(azarCercana(libres, DIFICULTAD_RONDA_1, azar), habilidad, 1, azar);
  if (!fallo) return armarEleccion(azarCercana(libres, DIFICULTAD_TRAS_ACIERTO, azar), habilidad, 2, azar);

  // Una habilidad sin respuesta propia ya perdió una pregunta de varias habilidades: ahora se prefieren las que le
  // contarán pase lo que pase, para que no se pierda otra.
  if (!atencion.propia) {
    const seguras = libres.filter((candidata) => cuentaSiempreA(recorrido, candidata, habilidad));
    if (seguras.length > 0) libres = seguras;
  }

  // Tras un fallo con X: una que la ofrezca, de dificultad cercana a la de la pregunta donde la eligió; si ninguna la
  // ofrece, la más cercana a esa dificultad menos 1.
  const dificultad = recorrido.pasos[paso].dificultad;
  const misconcepcion = recorrido.datos[paso].misconcepcion;
  const queLaOfrecen = misconcepcion === null ? [] : libres.filter((candidata) => trampasDe(candidata.opciones).includes(misconcepcion));
  return queLaOfrecen.length > 0
    ? armarEleccion(azarCercana(queLaOfrecen, dificultad, azar), habilidad, 2, azar)
    : armarEleccion(azarCercana(libres, dificultad - 1, azar), habilidad, 2, azar);
}

// ---------------------------------------------------------------------------
// Calificar (reglas 8 a 12)
// ---------------------------------------------------------------------------

/** Regla 10, en ese orden. */
function nivelDe(respuestas: readonly RespuestaContada[], tieneConfirmada: boolean): NivelHabilidad {
  const aciertos = respuestas.filter((respuesta) => respuesta.acierto).length;
  if (tieneConfirmada || (respuestas.length >= 2 && aciertos === 0)) return "no_lo_domina";
  if (respuestas.length === 0) return "sin_medir";
  const unicoAciertoDificil = respuestas.length === 1 && aciertos === 1 && respuestas[0].dificultad === 3;
  if ((respuestas.length >= 2 && aciertos === respuestas.length) || unicoAciertoDificil) return "lo_domina";
  return "en_proceso";
}

/**
 * Regla 12 (D-49 c). `sin_preguntas_sin_ver`: a la habilidad le faltó una pregunta, antes de medirla o antes de la segunda
 * que la duda pedía, y no queda ninguna libre; también cuando se le eligieron ya dos preguntas, todas de varias
 * habilidades acreditadas a otra, y sigue sin una respuesta propia aunque le queden libres: le falta una pregunta que la
 * mida sola. `tope_una_respuesta`: el tope cortó con la habilidad en duda, con una sola respuesta acreditada y con
 * preguntas libres que no alcanzó a hacer. Una habilidad que el tope dejó sin ninguna pregunta queda sin medir y sin marca.
 */
function faltaMaterialDe(recorrido: Recorrido, habilidad: string): MotivoFaltaMaterial[] {
  const sinPreguntas = (recorrido.preguntasDe.get(habilidad) ?? []).length === 0;
  const duda = dudaDe(recorrido, habilidad);
  if (!sinPreguntas && duda === null) return [];
  if ((recorrido.cuantasLibres.get(habilidad) ?? 0) === 0) return ["sin_preguntas_sin_ver"];
  if (duda === null) return [];
  if (!esAtendible(recorrido, habilidad)) return duda.propia ? [] : ["sin_preguntas_sin_ver"];
  return recorrido.pasos.length >= TOPE_DIAGNOSTICO && duda.propia ? ["tope_una_respuesta"] : [];
}

/**
 * Califica los pasos respondidos (regla 11) con la copia de cada paso. Sirve con un diagnóstico terminado; con uno a
 * medias marca solo lo que ya es seguro. De las candidatas solo mira cuáles siguen libres, para la regla 12.
 */
export function calificar(entrada: EntradaMotor, pasos: readonly CopiaDePaso[]): ResultadoDiagnostico {
  exigirEntrada(entrada);
  const recorrido = recorrer(entrada, pasos);
  const descripcionDeMisconcepcion = new Map(entrada.misconcepciones.map((m) => [m.clave, m]));

  const habilidades: ResultadoHabilidad[] = entrada.habilidades.map((habilidad) => {
    const respuestas = recorrido.respuestasDe.get(habilidad.clave) ?? [];
    return {
      habilidad: habilidad.clave,
      descripcion: habilidad.descripcion,
      nivel: nivelDe(respuestas, recorrido.confirmadaDe.get(habilidad.clave) ?? false),
      respuestas: respuestas.length,
      aciertos: respuestas.filter((respuesta) => respuesta.acierto).length,
      faltaMaterial: faltaMaterialDe(recorrido, habilidad.clave),
    };
  });

  // Confirmadas primero; dentro de cada grupo, por orden de aparición (la primera vez que la eligió).
  const errores: ErrorDetectado[] = [];
  const aparecidas = [...recorrido.misconcepciones].sort(
    ([, a], [, b]) => Number(b.estado === "confirmada") - Number(a.estado === "confirmada") || a.primerPaso - b.primerPaso,
  );
  for (const [clave, estado] of aparecidas) {
    if (estado.estado === "descartada") continue;
    const misconcepcion = descripcionDeMisconcepcion.get(clave);
    if (!misconcepcion) throw new RangeError(`La misconcepción ${clave} no está en la entrada.`);
    errores.push({
      misconcepcion: clave,
      habilidad: misconcepcion.habilidad,
      texto: misconcepcion.descripcion,
      estado: estado.estado,
      veces: estado.veces,
      detalles: [...estado.detalles],
    });
  }

  // Los directos de las habilidades en no lo domina o en proceso, sin repetir (D-49 d).
  const prerrequisitos: PrerrequisitoDeResultado[] = [];
  entrada.habilidades.forEach((habilidad, indice) => {
    if (habilidades[indice].nivel !== "no_lo_domina" && habilidades[indice].nivel !== "en_proceso") return;
    for (const prerrequisito of habilidad.prerrequisitos) {
      const repetido = prerrequisitos.some((p) => p.materia === prerrequisito.materia && p.habilidad === prerrequisito.habilidad);
      if (!repetido) {
        prerrequisitos.push({ materia: prerrequisito.materia, habilidad: prerrequisito.habilidad, descripcion: prerrequisito.descripcion });
      }
    }
  });

  // Una pregunta cuenta una vez aunque mida varias habilidades.
  const aciertos = recorrido.datos.filter((dato) => dato.acierto).length;
  const puntaje = pasos.length === 0 ? 0 : Math.round((aciertos / pasos.length) * 10_000) / 100;

  return { habilidades, errores, prerrequisitos, puntaje };
}
