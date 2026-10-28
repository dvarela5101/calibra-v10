/**
 * HU-108 (D-77 e): la pregunta de muestra del hero de la portada. La pregunta (la derivada de sen(x²)) es la del diseño y no
 * está en el banco; sus errores y sus habilidades sí, con el texto de `contenido/calculo-diferencial/reglas-derivacion.md`
 * (lo compara `pregunta-de-muestra.test.ts`). Va como datos para que la HU que la vuelva una pregunta real y cambiable solo
 * cambie de dónde salen. Los textos van en la sintaxis del banco (`$…$`) y se dibujan con `TextoDelBanco`.
 */

export const CLAVES_DE_OPCION = ["a", "b", "c", "d", "e"] as const;
export type ClaveDeOpcion = (typeof CLAVES_DE_OPCION)[number];

/** De dónde es la pregunta, como lo muestra el diagnóstico. */
export const CONTEXTO = "Cálculo Diferencial, parcial 2";

export const ENUNCIADO = "¿Cuál es la derivada de $f(x) = \\sen(x^2)$?";

export const TEXTOS_DE_OPCION: Record<ClaveDeOpcion, string> = {
  a: "$\\cos(x^2)$",
  b: "$2x\\cos(x^2)$",
  c: "$x^2\\cos(x^2)$",
  d: "$\\cos(2x)$",
  e: "$2x\\sen(x^2)$",
};

/** Un error del banco: su id (`mc:`), la descripción tal cual y la habilidad (`kc:`) a la que pertenece. */
export type ErrorDelBanco = { id: string; descripcion: string; idHabilidad: string };

/** Una habilidad del banco: su id (`kc:`) y su descripción tal cual. */
export type HabilidadDelBanco = { id: string; descripcion: string };

export const HABILIDADES: Record<"regla-cadena" | "derivadas-trascendentes", HabilidadDelBanco> = {
  "regla-cadena": { id: "regla-cadena", descripcion: "Derivar una composición de funciones con la regla de la cadena" },
  "derivadas-trascendentes": {
    id: "derivadas-trascendentes",
    descripcion: "Derivar funciones trigonométricas, exponenciales, logarítmicas y trigonométricas inversas",
  },
};

/** La correcta: 2x cos(x²). */
export const CORRECTA = "b" satisfies ClaveDeOpcion;

export const ERRORES: Record<Exclude<ClaveDeOpcion, typeof CORRECTA>, ErrorDelBanco> = {
  a: {
    id: "omite-derivada-interior",
    descripcion: "derivas la función de afuera y olvidas multiplicar por la derivada de lo que está adentro",
    idHabilidad: "regla-cadena",
  },
  c: {
    id: "interior-sin-derivar",
    descripcion: "multiplicas por la expresión de adentro, o por parte de ella, en vez de multiplicar por su derivada",
    idHabilidad: "regla-cadena",
  },
  d: {
    id: "interior-derivado-queda-adentro",
    descripcion: "derivas la expresión de adentro pero la dejas dentro de la función de afuera en lugar de multiplicar por ella",
    idHabilidad: "regla-cadena",
  },
  e: {
    id: "seno-no-cambia-a-coseno",
    descripcion: "al derivar sen u dejas sen u y solo multiplicas por la derivada del interior, sin pasarlo a cos u",
    idHabilidad: "derivadas-trascendentes",
  },
};

/** El orden en que se muestran: cos(x²), x² cos(x²), 2x cos(x²), 2x sen(x²) y cos(2x). */
export const ORDEN: readonly ClaveDeOpcion[] = ["a", "c", "b", "e", "d"];

/** Lo que se muestra debajo de las opciones según lo elegido. */
export type ResultadoDeMuestra =
  | { tipo: "sin_elegir" }
  | { tipo: "error"; texto: string; habilidad: string }
  | { tipo: "correcta"; habilidad: string };

const conMayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

export function resultadoDeMuestra(elegida: ClaveDeOpcion | null): ResultadoDeMuestra {
  if (elegida === null) return { tipo: "sin_elegir" };
  if (elegida === CORRECTA) return { tipo: "correcta", habilidad: "regla de la cadena" };
  const error = ERRORES[elegida];
  return {
    tipo: "error",
    texto: `${conMayuscula(error.descripcion)}.`,
    habilidad: HABILIDADES[error.idHabilidad as keyof typeof HABILIDADES].descripcion,
  };
}
