import type { NivelHabilidad } from "@/lib/diagnostico/motor";

/**
 * HU-109 (D-78): la agenda de ejemplo del hero de la landing de monitores. Cada monitoría abre el diagnóstico de quien agendó,
 * como lo ve el monitor (HU-022): las habilidades con su nivel y el error que más eligió, con los textos del banco tal como están
 * (`agenda-de-muestra.test.ts` los compara con `contenido/`). Las personas, horas y veces son de ejemplo.
 */

export type HabilidadDeMuestra = {
  /** El `kc` del banco. */
  id: string;
  descripcion: string;
  nivel: NivelHabilidad;
};

export type MonitoriaDeMuestra = {
  clave: string;
  /** Como se lee en la tarjeta del hero: «Mar». */
  dia: string;
  /** Como se lee en «Tus horarios»: «Martes». */
  diaCompleto: string;
  hora: string;
  /** El precio de muestra de la monitoría, en pesos: de él salen «Tus horarios» y el ejemplo de lo que se recibe (HU-121). */
  precio: number;
  estudiante: string;
  materia: string;
  /** La carpeta de la materia en `contenido/`. */
  carpeta: string;
  detalle: string;
  habilidades: HabilidadDeMuestra[];
  error: { id: string; idHabilidad: string; descripcion: string; veces: number };
};

export const AGENDA_DE_MUESTRA: MonitoriaDeMuestra[] = [
  {
    clave: "laura",
    dia: "Mar",
    diaCompleto: "Martes",
    hora: "4:00 p. m.",
    precio: 25_000,
    estudiante: "Laura",
    materia: "Cálculo Diferencial",
    carpeta: "calculo-diferencial",
    detalle: "60 min · Presencial",
    habilidades: [
      { id: "reglas-derivacion", descripcion: "Derivar potencias, sumas, productos y cocientes con las reglas de derivación", nivel: "lo_domina" },
      {
        id: "derivadas-trascendentes",
        descripcion: "Derivar funciones trigonométricas, exponenciales, logarítmicas y trigonométricas inversas",
        nivel: "en_proceso",
      },
      { id: "regla-cadena", descripcion: "Derivar una composición de funciones con la regla de la cadena", nivel: "no_lo_domina" },
    ],
    error: {
      id: "omite-derivada-interior",
      idHabilidad: "regla-cadena",
      descripcion: "derivas la función de afuera y olvidas multiplicar por la derivada de lo que está adentro",
      veces: 2,
    },
  },
  {
    clave: "santiago",
    dia: "Mié",
    diaCompleto: "Miércoles",
    hora: "6:00 p. m.",
    precio: 35_000,
    estudiante: "Santiago",
    materia: "Física I",
    carpeta: "fisica-1",
    detalle: "90 min · Virtual",
    habilidades: [
      { id: "cinematica", descripcion: "Cinemática", nivel: "lo_domina" },
      { id: "newton", descripcion: "Leyes de Newton", nivel: "no_lo_domina" },
      { id: "energia", descripcion: "Trabajo y energía", nivel: "en_proceso" },
    ],
    error: { id: "newton-e1", idHabilidad: "newton", descripcion: "asumes que la normal siempre es igual al peso", veces: 3 },
  },
  {
    clave: "camila",
    dia: "Dom",
    diaCompleto: "Domingo",
    hora: "10:00 a. m.",
    precio: 30_000,
    estudiante: "Camila",
    materia: "Álgebra Lineal",
    carpeta: "algebra-lineal",
    detalle: "60 min · Presencial",
    habilidades: [
      { id: "vectores", descripcion: "Vectores, rectas y planos", nivel: "lo_domina" },
      { id: "sistemas", descripcion: "Sistemas lineales y Gauss-Jordan", nivel: "no_lo_domina" },
    ],
    error: {
      id: "sistemas-e2",
      idHabilidad: "sistemas",
      descripcion: "confundes un sistema consistente dependiente con uno inconsistente",
      veces: 2,
    },
  },
];

/**
 * HU-121 (D-87 b): lo que recibe el monitor en el ejemplo, ya calculado en el servidor. Solo netos: ni el precio al lado, ni el
 * porcentaje, ni el tope.
 */
export type GananciaDeMuestra = {
  /** Lo que recibe por cada monitoría, por su `clave`. */
  porMonitoria: Record<string, number>;
  porSemana: number;
  porCuatroSemanas: number;
};

/** El error como se lee en la tarjeta: con mayúscula y punto, como en el resultado. */
export const textoDelError = (descripcion: string) => `${descripcion.charAt(0).toUpperCase()}${descripcion.slice(1)}.`;
