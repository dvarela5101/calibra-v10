// Modelo del banco de preguntas por habilidades (HU-005). Lo comparten el lector y validador
// (banco.mts), el cargador (cargar.mts), la línea de comandos (convertir.mts) y la migración del
// prototipo (migrar-prototipo.mts).
//
// Solo tipos: Node los borra al correr los .mts (type stripping), así que aquí no puede haber enum,
// namespace ni nada que genere código.

export type EstadoPregunta = "borrador" | "revisada" | "retirada";

export type Letra = "A" | "B" | "C" | "D";

/** Un lugar del banco: ruta relativa a la raíz del banco, con "/", y línea desde 1. */
export interface Lugar {
  archivo: string;
  linea: number;
}

/** Un error o un aviso, con su lugar. Se imprime como `archivo:linea  mensaje`. */
export interface Diagnostico extends Lugar {
  mensaje: string;
}

/** Un archivo del banco ya leído. La ruta es relativa a la raíz del banco y usa "/". */
export interface ArchivoBanco {
  ruta: string;
  texto: string;
}

export interface Banco {
  /** En el orden de las carpetas (alfabético). */
  materias: Materia[];
}

export interface Materia {
  /** Nombre de la carpeta, por ejemplo "calculo-integral". Es la llave de los prerrequisitos entre materias. */
  carpeta: string;
  /** Código Uniandes, por ejemplo "MATE-1214". Es la llave de la materia en la base. */
  codigo: string;
  nombre: string;
  libro: string | null;
  /** Texto libre de materia.md entre el frontmatter y la primera sección. No se carga. */
  introduccion: string;
  /** En el orden de la sección "## Temas". */
  temas: Tema[];
  evaluaciones: Evaluacion[];
  lugar: Lugar;
}

export interface Tema {
  /** Nombre del archivo sin ".md". */
  clave: string;
  /** El título "# ..." del archivo. */
  nombre: string;
  /** 1, 2, ... según la sección "## Temas" de materia.md. */
  orden: number;
  /** Texto libre entre el título y "## Habilidades". No se carga. */
  introduccion: string;
  habilidades: Habilidad[];
  misconcepciones: Misconcepcion[];
  /** En el orden del archivo. */
  preguntas: Pregunta[];
  lugar: Lugar;
}

/** Un prerrequisito: "clave" (misma materia) o "carpeta/clave" (otra materia). */
export interface ReferenciaHabilidad {
  /** Carpeta de la materia, o null si es de la misma materia. */
  materia: string | null;
  clave: string;
}

export interface Habilidad {
  clave: string;
  descripcion: string;
  prerrequisitos: ReferenciaHabilidad[];
  lugar: Lugar;
}

export interface Misconcepcion {
  clave: string;
  /** Clave de la habilidad (de la misma materia) a la que pertenece. */
  habilidad: string;
  descripcion: string;
  lugar: Lugar;
}

export interface Opcion {
  letra: Letra;
  texto: string;
  correcta: boolean;
  /** Clave de la misconcepción. Solo en las incorrectas. */
  misconcepcion: string | null;
  /** Texto de error propio de la opción, escrito después de "[clave]". Null: vale el de la misconcepción. */
  error: string | null;
  lugar: Lugar;
}

export interface Pregunta {
  /** Id estable dentro de la materia, tal como está escrito ("P4"). */
  clave: string;
  dificultad: 1 | 2 | 3;
  /** Claves de las habilidades que mide, en el orden escrito. */
  habilidades: string[];
  estado: EstadoPregunta;
  /** "humano" o "ia (<modelo>)". */
  origen: string;
  /** Quien la revisó ("revisó: ..."). Obligatorio si está revisada. */
  revisor: string | null;
  /** Marca "⚠ revisar" que deja la verificación cruzada de HU-061. No se carga. */
  porRevisar: boolean;
  enunciado: string;
  opciones: Opcion[];
  solucion: string | null;
  lugar: Lugar;
}

export interface Evaluacion {
  clave: string;
  nombre: string;
  /** Semana del curso (RN-20). Ordena las evaluaciones: las "anteriores" son las de semana menor. */
  semana: number;
  acumulativa: boolean;
  /** Los temas escritos en la línea "temas:". */
  temasPropios: string[];
  /**
   * Los temas que cubre: los propios y, si es acumulativa, los de las evaluaciones de la misma materia
   * con semana menor. Sin repetir y en el orden de los temas de la materia. Lo llena el validador.
   */
  temas: string[];
  /** Todas las habilidades de sus temas cumplen la cobertura. Lo llena el validador. */
  activa: boolean;
  lugar: Lugar;
}

/** Cobertura de una habilidad: preguntas revisadas que la miden y en cuántas dificultades. */
export interface CoberturaHabilidad {
  materia: string;
  clave: string;
  revisadas: number;
  dificultades: number[];
  /** Al menos 3 revisadas en al menos 2 dificultades. */
  cumple: boolean;
}

/** Cobertura de una misconcepción: preguntas revisadas que la ofrecen como trampa. */
export interface CoberturaMisconcepcion {
  materia: string;
  clave: string;
  habilidad: string;
  preguntas: number;
  /** Ofrecida en al menos 2 preguntas revisadas. Solo se reporta: no decide si una evaluación queda activa. */
  cumple: boolean;
}

export interface Cobertura {
  habilidades: CoberturaHabilidad[];
  misconcepciones: CoberturaMisconcepcion[];
}

/** Filas por tabla. El --dry-run las calcula del banco y la carga las cuenta en la base. */
export interface Conteos {
  materias: number;
  temas: number;
  habilidades: number;
  prerrequisitos: number;
  misconcepciones: number;
  preguntas: number;
  opciones: number;
  preguntaHabilidad: number;
  evaluaciones: number;
  evaluacionTema: number;
}

export interface OpcionesCarga {
  /** Cargar también las preguntas en borrador. Las retiradas nunca se cargan. */
  borradores: boolean;
}

export interface ResultadoBanco {
  banco: Banco;
  errores: Diagnostico[];
  avisos: Diagnostico[];
  cobertura: Cobertura;
}
