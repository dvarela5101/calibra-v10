import {
  LETRAS,
  type CopiaDePaso,
  type Dificultad,
  type EntradaMotor,
  type HabilidadDeEntrada,
  type Letra,
  type MisconcepcionDeEntrada,
  type OpcionDeCopia,
  type PreguntaCandidata,
  type PrerrequisitoDeEntrada,
} from "./motor";

/**
 * De la base al motor (HU-081): lo que guarda el diagnóstico en curso y cómo se arma, con eso, la `EntradaMotor`. Puro: no
 * lee la base ni usa la hora.
 *
 * La foto del banco se toma al empezar y vive en la fila (`candidatas` y `contexto`). Armar la entrada sale solo de ahí, nunca
 * del banco de hoy: si HU-061 recarga el banco a mitad de un diagnóstico, la pregunta pendiente y las ya respondidas siguen
 * siendo las que la persona vio.
 *
 * Los mensajes de error nombran rutas y claves de preguntas, nunca enunciados, opciones, errores ni soluciones: llegan a los
 * registros del servidor.
 */

/** Versión del formato de la foto. Una fila con otra versión se trata como inexistente (vive 2 horas como máximo). */
export const VERSION_DEL_CONTEXTO = 1;

/** El contexto de la foto del banco (`public.banco_de_la_evaluacion`, `contexto`): lo que no son preguntas. */
export interface ContextoGuardado {
  version: number;
  evaluacion: { id: string; nombre: string };
  materia: { id: string; codigo: string; nombre: string };
  /** Las de la Evaluación, en el orden de la materia (por tema y luego por clave). */
  habilidades: HabilidadDeEntrada[];
  /** Todas las de la materia. */
  misconcepciones: MisconcepcionDeEntrada[];
  /** Todas las habilidades de la materia, para los errores de habilidades que no son de la Evaluación. */
  descripcionesDeHabilidad: Record<string, string>;
}

export interface FotoDelBanco {
  contexto: ContextoGuardado;
  candidatas: PreguntaCandidata[];
}

/** La fila de `diagnostico_en_curso` como la devuelve `public.diagnostico_en_curso_de`. Los json llegan sin validar. */
export interface FilaEnCurso {
  id: string;
  id_sesion: string;
  id_evaluacion: string;
  id_materia: string;
  semilla: number;
  vistas_antes: string[];
  repetido: boolean;
  candidatas: unknown;
  contexto: unknown;
  pasos: unknown;
  paso: number;
  iniciado_en: string;
  actualizado_en: string;
}

export type LecturaDeFoto =
  | { ok: true; foto: FotoDelBanco }
  /** `otra_version`: la foto es de un formato que este código no conoce. `forma`: no tiene la forma esperada; `detalle` dice dónde. */
  | { ok: false; motivo: "otra_version" | "forma"; detalle: string };

/** Una fila de `diagnostico_en_curso` con todo lo que el motor necesita. */
export interface EntradaDeLaFila {
  fila: FilaEnCurso;
  contexto: ContextoGuardado;
  entrada: EntradaMotor;
  /** Las copias de los pasos ya respondidos. */
  pasos: CopiaDePaso[];
}

// ---------------------------------------------------------------------------
// Validación de forma
// ---------------------------------------------------------------------------

class FormaInvalida extends Error {}

function invalida(ruta: string, esperado: string): never {
  throw new FormaInvalida(`${ruta} debe ser ${esperado}`);
}

function objeto(valor: unknown, ruta: string): Record<string, unknown> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) invalida(ruta, "un objeto");
  return valor as Record<string, unknown>;
}

function arreglo(valor: unknown, ruta: string): unknown[] {
  if (!Array.isArray(valor)) invalida(ruta, "una lista");
  return valor as unknown[];
}

function texto(valor: unknown, ruta: string): string {
  if (typeof valor !== "string") invalida(ruta, "un texto");
  return valor as string;
}

function textoONulo(valor: unknown, ruta: string): string | null {
  return valor === null ? null : texto(valor, ruta);
}

function listaDeTextos(valor: unknown, ruta: string): string[] {
  return arreglo(valor, ruta).map((elemento, i) => texto(elemento, `${ruta}[${i}]`));
}

function letra(valor: unknown, ruta: string): Letra {
  if (typeof valor !== "string" || !(LETRAS as readonly string[]).includes(valor)) invalida(ruta, "una letra de la A a la D");
  return valor as Letra;
}

function leerOpcion(valor: unknown, ruta: string): OpcionDeCopia {
  const opcion = objeto(valor, ruta);
  if (typeof opcion.correcta !== "boolean") invalida(`${ruta}.correcta`, "verdadero o falso");
  return {
    texto: texto(opcion.texto, `${ruta}.texto`),
    correcta: opcion.correcta as boolean,
    misconcepcion: textoONulo(opcion.misconcepcion, `${ruta}.misconcepcion`),
    error: textoONulo(opcion.error, `${ruta}.error`),
  };
}

function leerCandidata(valor: unknown, ruta: string): PreguntaCandidata {
  const pregunta = objeto(valor, ruta);
  const clave = texto(pregunta.clave, `${ruta}.clave`);
  const opciones = arreglo(pregunta.opciones, `${ruta}.opciones`);
  if (opciones.length !== LETRAS.length) throw new FormaInvalida(`La pregunta ${clave} debe tener 4 opciones (tiene ${opciones.length})`);
  const dificultad = pregunta.dificultad;
  if (dificultad !== 1 && dificultad !== 2 && dificultad !== 3) invalida(`${ruta}.dificultad`, "1, 2 o 3");
  return {
    clave,
    tema: texto(pregunta.tema, `${ruta}.tema`),
    enunciado: texto(pregunta.enunciado, `${ruta}.enunciado`),
    opciones: opciones.map((opcion, i) => leerOpcion(opcion, `${ruta}.opciones[${i}]`)),
    dificultad: dificultad as Dificultad,
    habilidades: listaDeTextos(pregunta.habilidades, `${ruta}.habilidades`),
    solucion: textoONulo(pregunta.solucion, `${ruta}.solucion`),
  };
}

function leerPrerrequisito(valor: unknown, ruta: string): PrerrequisitoDeEntrada {
  const prerrequisito = objeto(valor, ruta);
  return {
    materia: textoONulo(prerrequisito.materia, `${ruta}.materia`),
    habilidad: texto(prerrequisito.habilidad, `${ruta}.habilidad`),
    descripcion: texto(prerrequisito.descripcion, `${ruta}.descripcion`),
  };
}

function leerHabilidad(valor: unknown, ruta: string): HabilidadDeEntrada {
  const habilidad = objeto(valor, ruta);
  return {
    clave: texto(habilidad.clave, `${ruta}.clave`),
    descripcion: texto(habilidad.descripcion, `${ruta}.descripcion`),
    prerrequisitos: arreglo(habilidad.prerrequisitos, `${ruta}.prerrequisitos`).map((p, i) => leerPrerrequisito(p, `${ruta}.prerrequisitos[${i}]`)),
  };
}

function leerMisconcepcion(valor: unknown, ruta: string): MisconcepcionDeEntrada {
  const misconcepcion = objeto(valor, ruta);
  return {
    clave: texto(misconcepcion.clave, `${ruta}.clave`),
    habilidad: texto(misconcepcion.habilidad, `${ruta}.habilidad`),
    descripcion: texto(misconcepcion.descripcion, `${ruta}.descripcion`),
  };
}

function leerContexto(valor: unknown): ContextoGuardado {
  const contexto = objeto(valor, "contexto");
  const evaluacion = objeto(contexto.evaluacion, "contexto.evaluacion");
  const materia = objeto(contexto.materia, "contexto.materia");
  const descripciones = objeto(contexto.descripcionesDeHabilidad, "contexto.descripcionesDeHabilidad");
  return {
    version: VERSION_DEL_CONTEXTO,
    evaluacion: { id: texto(evaluacion.id, "contexto.evaluacion.id"), nombre: texto(evaluacion.nombre, "contexto.evaluacion.nombre") },
    materia: {
      id: texto(materia.id, "contexto.materia.id"),
      codigo: texto(materia.codigo, "contexto.materia.codigo"),
      nombre: texto(materia.nombre, "contexto.materia.nombre"),
    },
    habilidades: arreglo(contexto.habilidades, "contexto.habilidades").map((h, i) => leerHabilidad(h, `contexto.habilidades[${i}]`)),
    misconcepciones: arreglo(contexto.misconcepciones, "contexto.misconcepciones").map((m, i) =>
      leerMisconcepcion(m, `contexto.misconcepciones[${i}]`),
    ),
    descripcionesDeHabilidad: Object.fromEntries(
      Object.entries(descripciones).map(([clave, descripcion]) => [clave, texto(descripcion, `contexto.descripcionesDeHabilidad.${clave}`)]),
    ),
  };
}

function leerCandidatas(valor: unknown): PreguntaCandidata[] {
  const candidatas = arreglo(valor, "candidatas").map((c, i) => leerCandidata(c, `candidatas[${i}]`));
  const claves = new Set<string>();
  for (const candidata of candidatas) {
    if (claves.has(candidata.clave)) throw new FormaInvalida(`La pregunta ${candidata.clave} está repetida en las candidatas`);
    claves.add(candidata.clave);
  }
  return candidatas;
}

function leerPaso(valor: unknown, ruta: string): CopiaDePaso {
  const paso = objeto(valor, ruta);
  const orden = arreglo(paso.orden, `${ruta}.orden`).map((l, i) => letra(l, `${ruta}.orden[${i}]`));
  if (orden.length !== LETRAS.length || new Set(orden).size !== LETRAS.length) invalida(`${ruta}.orden`, "una permutación de A, B, C y D");
  return {
    ...leerCandidata(valor, ruta),
    orden,
    letraElegida: letra(paso.letraElegida, `${ruta}.letraElegida`),
    fecha: texto(paso.fecha, `${ruta}.fecha`),
  };
}

function conForma<T>(leer: () => T): { ok: true; valor: T } | { ok: false; detalle: string } {
  try {
    return { ok: true, valor: leer() };
  } catch (error) {
    if (error instanceof FormaInvalida) return { ok: false, detalle: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// La foto del banco
// ---------------------------------------------------------------------------

/**
 * Valida lo que devuelve `public.banco_de_la_evaluacion` (o lo que quedó guardado en la fila): la versión del formato, la
 * forma del contexto y de cada candidata, cuatro opciones por pregunta y claves de pregunta únicas. El motor lanza
 * `RangeError` con una pregunta de otro largo (`exigirEntrada`); aquí se rechaza antes de crear nada.
 */
export function leerFotoDelBanco(json: unknown): LecturaDeFoto {
  const lectura = conForma(() => {
    const raiz = objeto(json, "la foto");
    const contexto = objeto(raiz.contexto, "contexto");
    if (contexto.version !== VERSION_DEL_CONTEXTO) return null;
    return { contexto: leerContexto(contexto), candidatas: leerCandidatas(raiz.candidatas) };
  });
  if (!lectura.ok) return { ok: false, motivo: "forma", detalle: lectura.detalle };
  if (lectura.valor === null) return { ok: false, motivo: "otra_version", detalle: `contexto.version no es ${VERSION_DEL_CONTEXTO}` };
  return { ok: true, foto: lectura.valor };
}

/**
 * La entrada del motor de una fila en curso, con sus pasos ya respondidos: `habilidades`, `misconcepciones` y los nombres
 * salen de `contexto`; `candidatas`, `vistasAntes` y `semilla` de la fila. Mismas filas, misma entrada. `null` si la foto es de
 * otra versión del formato (la fila se trata como inexistente). Una fila de esta versión pero malformada lanza.
 */
export function entradaDeLaFila(fila: FilaEnCurso): EntradaDeLaFila | null {
  const lectura = leerFotoDelBanco({ contexto: fila.contexto, candidatas: fila.candidatas });
  if (!lectura.ok) {
    if (lectura.motivo === "otra_version") return null;
    throw new Error(`El diagnóstico en curso ${fila.id} guarda una foto del banco que no sirve: ${lectura.detalle}.`);
  }
  const { contexto, candidatas } = lectura.foto;

  const pasos = conForma(() => arreglo(fila.pasos, "pasos").map((paso, i) => leerPaso(paso, `pasos[${i}]`)));
  if (!pasos.ok) throw new Error(`El diagnóstico en curso ${fila.id} guarda pasos que no sirven: ${pasos.detalle}.`);

  return {
    fila,
    contexto,
    entrada: {
      habilidades: contexto.habilidades,
      misconcepciones: contexto.misconcepciones,
      candidatas,
      vistasAntes: [...fila.vistas_antes],
      semilla: fila.semilla,
    },
    pasos: pasos.valor,
  };
}

/** La candidata de la entrada con esa clave. El motor solo elige claves de la entrada, así que faltar es un error. */
export function candidataDe(entrada: EntradaMotor, clave: string): PreguntaCandidata {
  const candidata = entrada.candidatas.find((c) => c.clave === clave);
  if (!candidata) throw new Error(`La pregunta ${clave} no está entre las candidatas de la entrada.`);
  return candidata;
}
