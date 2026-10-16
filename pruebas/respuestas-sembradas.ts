import type { CopiaDePaso, Letra, NivelHabilidad, OrdenDeOpciones } from "../src/lib/diagnostico/motor";
import type { ResultadoGuardado } from "../src/lib/diagnostico/resultado";

/**
 * Diagnósticos sembrados con las copias de las preguntas que respondió la persona (HU-022), para la integración, la e2e y el
 * pgTAP-espejo del diagnóstico del monitor. Lo que ve el monitor de cada pregunta depende de tres cosas que una copia mal armada
 * esconde: el orden en que la persona vio las opciones (`orden[i]` es la letra del banco de la opción que se vio en la posición
 * `i`), la letra que eligió (la que vio, no la del banco) y cuál es la correcta (la letra del banco). Aquí cada pregunta se
 * describe con esas tres cosas, con el texto de cada opción distinto, y de ahí salen la copia que se guarda y lo que el monitor
 * debe ver. Lo segundo se arma contando posiciones, sin pasar por `opcionDeLetra` ni `opcionElegida` del motor: la prueba de este
 * archivo compara las dos cuentas.
 *
 * `marca` es un texto único por siembra (un sufijo al azar): va en el enunciado, las opciones, la solución y las claves, para
 * buscarlo en el HTML y en las respuestas sin confundirlo con lo de otra prueba que corre a la vez. Las claves internas y los
 * textos de error de las opciones que no se eligieron no pueden salir en nada que vea el monitor: `valoresInternos` los lista.
 *
 * Solo hay `import type` de `src/`: lo cargan Vitest, la integración y Playwright, que no comparten alias de rutas.
 */

const LETRAS: readonly Letra[] = ["A", "B", "C", "D"];

/** La semilla que se siembra: reconocible, para buscarla en cualquier respuesta (cabe en 32 bits sin signo). */
export const SEMILLA_SEMBRADA = 3141592653;

export type PlanDePregunta = {
  /** 1, 2, ...: aparece en los textos y es la posición de la pregunta en el diagnóstico. */
  numero: number;
  /** `orden[i]` es la letra del banco de la opción que se vio en la posición `i` (la 0 es la A que ve la persona). */
  orden: OrdenDeOpciones;
  /** La letra del banco de la opción correcta. */
  correctaDelBanco: Letra;
  /** La letra del banco de la opción que eligió. Si es la correcta, acertó. */
  elegidaDelBanco: Letra;
  /** `undefined`: una solución con texto propio; `null`: la pregunta no trae solución. */
  solucion?: string | null;
  /** Sustituye al enunciado de siempre (por ejemplo, uno con un bloque de código). */
  enunciado?: string;
  /** Sustituye el texto de las opciones, por letra del banco (por ejemplo, la fórmula más ancha del banco). */
  textos?: Partial<Record<Letra, string>>;
};

/** Lo que el monitor debe ver de una pregunta: las letras ya son las que vio la persona. */
export type PreguntaEsperada = {
  enunciado: string;
  opciones: { letra: Letra; texto: string }[];
  letraElegida: Letra;
  letraCorrecta: Letra;
  solucion: string | null;
  acerto: boolean;
};

// ---------------------------------------------------------------------------
// Los textos de una pregunta
// ---------------------------------------------------------------------------

export const enunciadoDe = (p: PlanDePregunta, marca: string): string => p.enunciado ?? `Enunciado ${p.numero} de ${marca}`;
export const textoDeOpcion = (p: PlanDePregunta, marca: string, letraDelBanco: Letra): string =>
  p.textos?.[letraDelBanco] ?? `Opción ${letraDelBanco} del banco, pregunta ${p.numero} de ${marca}`;
export const solucionDe = (p: PlanDePregunta, marca: string): string | null =>
  p.solucion === undefined ? `Solución de la pregunta ${p.numero} de ${marca}` : p.solucion;
export const claveDePregunta = (p: PlanDePregunta, marca: string): string => `clave-secreta-${marca}-p${p.numero}`;
export const temaDePregunta = (marca: string): string => `tema-secreto-${marca}`;
export const habilidadDePregunta = (p: PlanDePregunta, marca: string): string => `habilidad-secreta-${marca}-p${p.numero}`;
export const misconcepcionDeOpcion = (p: PlanDePregunta, marca: string, letraDelBanco: Letra): string =>
  `misconcepcion-secreta-${marca}-p${p.numero}${letraDelBanco}`;
/** El texto de error propio (D-14) de una opción incorrecta. Solo el de la elegida llega al monitor, como detalle de un error. */
export const textoDeErrorDeOpcion = (p: PlanDePregunta, marca: string, letraDelBanco: Letra): string =>
  `Error propio de la opción ${letraDelBanco} de la pregunta ${p.numero} de ${marca}`;

/** La letra que vio la persona en la posición de una opción del banco. */
const letraVista = (orden: OrdenDeOpciones, letraDelBanco: Letra): Letra => LETRAS[orden.indexOf(letraDelBanco)];

// ---------------------------------------------------------------------------
// La copia que se guarda y lo que se espera ver
// ---------------------------------------------------------------------------

/** El instante de la respuesta de la pregunta `numero`: el 4 de octubre de 2026 a las 23:30 de Bogotá y un minuto por pregunta. */
const fechaDeRespuesta = (numero: number): string => new Date(Date.UTC(2026, 9, 5, 4, 29 + numero)).toISOString();

/** La copia del paso tal como la guarda `terminar_diagnostico`: con las opciones en el orden del banco y todo lo que no sale. */
export function copiaDePaso(p: PlanDePregunta, marca: string): CopiaDePaso {
  return {
    clave: claveDePregunta(p, marca),
    tema: temaDePregunta(marca),
    enunciado: enunciadoDe(p, marca),
    opciones: LETRAS.map((letra) => ({
      texto: textoDeOpcion(p, marca, letra),
      correcta: letra === p.correctaDelBanco,
      misconcepcion: letra === p.correctaDelBanco ? null : misconcepcionDeOpcion(p, marca, letra),
      error: letra === p.correctaDelBanco ? null : textoDeErrorDeOpcion(p, marca, letra),
    })),
    dificultad: ([1, 2, 3] as const)[(p.numero - 1) % 3],
    habilidades: [habilidadDePregunta(p, marca)],
    solucion: solucionDe(p, marca),
    orden: [...p.orden],
    letraElegida: letraVista(p.orden, p.elegidaDelBanco),
    fecha: fechaDeRespuesta(p.numero),
  };
}

export const copiasDe = (plan: readonly PlanDePregunta[], marca: string): CopiaDePaso[] => plan.map((p) => copiaDePaso(p, marca));

/**
 * Lo que el monitor debe ver: las cuatro opciones en el orden en que las vio la persona (la letra A es la primera que vio), la
 * letra que eligió y la de la correcta, las dos en ese orden. Se arma contando posiciones, no con las funciones del motor.
 */
export function preguntaEsperada(p: PlanDePregunta, marca: string): PreguntaEsperada {
  return {
    enunciado: enunciadoDe(p, marca),
    opciones: LETRAS.map((letra, posicion) => ({ letra, texto: textoDeOpcion(p, marca, p.orden[posicion]) })),
    letraElegida: letraVista(p.orden, p.elegidaDelBanco),
    letraCorrecta: letraVista(p.orden, p.correctaDelBanco),
    solucion: solucionDe(p, marca),
    acerto: p.elegidaDelBanco === p.correctaDelBanco,
  };
}

export const preguntasEsperadas = (plan: readonly PlanDePregunta[], marca: string): PreguntaEsperada[] =>
  plan.map((p) => preguntaEsperada(p, marca));

export const aciertosDe = (plan: readonly PlanDePregunta[]): number => plan.filter((p) => p.elegidaDelBanco === p.correctaDelBanco).length;

// ---------------------------------------------------------------------------
// Los planes
// ---------------------------------------------------------------------------

/**
 * Ocho preguntas, 3 falladas (la 2, la 4 y la 6) y 5 acertadas, con las opciones barajadas de modo que la letra que vio la persona
 * casi nunca es la del banco y la correcta del banco nunca es la A (en el banco real lo es en 132 de 135 preguntas, y es el error
 * fácil). Trae un ciclo de 4 (`C A D B`, cuya inversa `B D A C` es otra permutación), uno de 3, la identidad, dos involuciones y
 * una transposición. La 3 y la 7 no traen solución.
 */
export function planDeEjemplo(): PlanDePregunta[] {
  return [
    { numero: 1, orden: ["C", "A", "D", "B"], correctaDelBanco: "B", elegidaDelBanco: "B" }, // ciclo de 4, acierta
    { numero: 2, orden: ["B", "C", "A", "D"], correctaDelBanco: "C", elegidaDelBanco: "A" }, // ciclo de 3, falla
    { numero: 3, orden: ["A", "B", "C", "D"], correctaDelBanco: "D", elegidaDelBanco: "D", solucion: null }, // identidad, acierta
    { numero: 4, orden: ["D", "C", "B", "A"], correctaDelBanco: "B", elegidaDelBanco: "C" }, // involución, falla
    { numero: 5, orden: ["B", "A", "C", "D"], correctaDelBanco: "C", elegidaDelBanco: "C" }, // transposición, acierta
    { numero: 6, orden: ["D", "A", "B", "C"], correctaDelBanco: "D", elegidaDelBanco: "A" }, // ciclo de 4, falla
    { numero: 7, orden: ["C", "D", "A", "B"], correctaDelBanco: "B", elegidaDelBanco: "B", solucion: null }, // involución, acierta
    { numero: 8, orden: ["A", "C", "D", "B"], correctaDelBanco: "C", elegidaDelBanco: "C" }, // ciclo de 3, acierta
  ];
}

/** Las 24 permutaciones de A a D, en orden alfabético. */
export function permutacionesDeLasLetras(): Letra[][] {
  const resultado: Letra[][] = [];
  const armar = (prefijo: Letra[], restantes: Letra[]) => {
    if (restantes.length === 0) {
      resultado.push(prefijo);
      return;
    }
    restantes.forEach((letra, i) => armar([...prefijo, letra], [...restantes.slice(0, i), ...restantes.slice(i + 1)]));
  };
  armar([], [...LETRAS]);
  return resultado;
}

/**
 * Los 96 casos: las 24 permutaciones de `orden` por las 4 letras que pudo ver la persona al elegir (una pregunta por caso). La
 * correcta del banco recorre las cuatro letras. Ignorar el orden cambia la opción elegida en 72 de los 96 casos, y usar la
 * permutación inversa, en 48.
 */
export function planDeLas96(): PlanDePregunta[] {
  return permutacionesDeLasLetras().flatMap((orden, k) =>
    LETRAS.map((_, j): PlanDePregunta => ({ numero: k * 4 + j + 1, orden, correctaDelBanco: LETRAS[(k + j) % 4], elegidaDelBanco: orden[j] })),
  );
}

// ---------------------------------------------------------------------------
// El resultado guardado
// ---------------------------------------------------------------------------

export type HabilidadSembrada = ResultadoGuardado["habilidades"][number];

/**
 * Las habilidades de la Evaluación sembrada, en el orden de la materia (no el de los niveles). `cantidad` > 8 agrega más, de
 * descripción larga y con los cuatro niveles repartidos, para probar una Evaluación de 18 habilidades.
 */
export function habilidadesSembradas(marca: string, cantidad = 8): HabilidadSembrada[] {
  const base: Omit<HabilidadSembrada, "habilidad">[] = [
    { descripcion: "calcula la fuerza neta con $F = ma$", nivel: "lo_domina", respuestas: 3, aciertos: 3 },
    { descripcion: "aplica la conservación de la energía", nivel: "en_proceso", respuestas: 2, aciertos: 1 },
    { descripcion: "interpreta gráficas de posición", nivel: "no_lo_domina", respuestas: 2, aciertos: 0 },
    { descripcion: "resuelve problemas con rozamiento", nivel: "sin_medir", respuestas: 0, aciertos: 0 },
    { descripcion: "lee un diagrama de fuerzas", nivel: "no_lo_domina", respuestas: 1, aciertos: 0 },
    { descripcion: "descompone vectores", nivel: "lo_domina", respuestas: 1, aciertos: 1 },
    { descripcion: "relaciona trabajo y energía cinética", nivel: "en_proceso", respuestas: 1, aciertos: 1 },
    { descripcion: "usa la segunda ley de Newton", nivel: "lo_domina", respuestas: 2, aciertos: 2 },
  ];
  const niveles: NivelHabilidad[] = ["no_lo_domina", "en_proceso", "sin_medir", "lo_domina"];
  const extra = Array.from({ length: Math.max(0, cantidad - base.length) }, (_, i): Omit<HabilidadSembrada, "habilidad"> => {
    const nivel = niveles[i % niveles.length];
    return {
      descripcion: `maneja el caso adicional ${i + 1} de la materia, con una descripción bastante larga que ocupa varios renglones en una pantalla angosta`,
      nivel,
      respuestas: nivel === "sin_medir" ? 0 : 1 + (i % 3),
      aciertos: nivel === "lo_domina" ? 1 + (i % 3) : 0,
    };
  });
  return [...base, ...extra].slice(0, Math.max(cantidad, 1)).map((h, i) => ({ habilidad: `habilidad-secreta-${marca}-h${i + 1}`, ...h }));
}

/** La descripción de un prerrequisito con una fórmula: se dibuja con `TextoDelBanco`, como todo texto del banco. */
export const PRERREQUISITO_CON_FORMULA = String.raw`reconoce $x^2$ como una potencia`;

/**
 * El resultado por habilidad que deja `terminar_diagnostico`, con lo necesario para ver cada caso del monitor: un error confirmado
 * con detalle (y una fórmula en el título), uno en sospecha sin detalle, uno de una habilidad que no es de la Evaluación y uno cuya
 * descripción cayó a la clave, y una sospecha guardada antes que la confirmada; prerrequisitos con uno de la misma materia
 * repetido, uno de otra materia, la misma clave en una tercera materia y otra clave con la misma descripción (cinco guardados, cuatro
 * al leer). `detalleDeLaElegida` es el texto de error de la opción que eligió en una pregunta fallada: va como detalle del error.
 */
export function resultadoGuardadoSembrado(marca: string, opciones: { habilidades?: number; detalleDeLaElegida?: string } = {}): ResultadoGuardado {
  const habilidades = habilidadesSembradas(marca, opciones.habilidades ?? 8);
  const de = (i: number) => habilidades[i % habilidades.length];
  const errores: ResultadoGuardado["errores"] = [
    {
      misconcepcion: `misconcepcion-secreta-${marca}-e1`,
      habilidad: de(2).habilidad,
      descripcionHabilidad: de(2).descripcion,
      texto: String.raw`usas $\frac{1}{2}$ sin cuadrar la velocidad`,
      estado: "confirmada",
      veces: 2,
      detalles: [opciones.detalleDeLaElegida ?? "Revisa qué magnitud va arriba."],
    },
    {
      misconcepcion: `misconcepcion-secreta-${marca}-e2`,
      habilidad: de(1).habilidad,
      descripcionHabilidad: de(1).descripcion,
      texto: "confundes energía con potencia",
      estado: "sospecha",
      veces: 1,
      detalles: [],
    },
    {
      misconcepcion: `misconcepcion-secreta-${marca}-e3`,
      habilidad: `habilidad-secreta-${marca}-de-otra-evaluacion`,
      descripcionHabilidad: "calcula el trabajo de la fricción",
      texto: "ignoras la fricción",
      estado: "sospecha",
      veces: 1,
      detalles: ["La fricción también hace trabajo.", "Piensa en el sentido del movimiento."],
    },
    {
      misconcepcion: `misconcepcion-secreta-${marca}-e4`,
      habilidad: `habilidad-secreta-${marca}-sin-descripcion`,
      // La foto guarda la clave cuando no hay descripción: el monitor no la ve.
      descripcionHabilidad: `habilidad-secreta-${marca}-sin-descripcion`,
      texto: "mezclas el sentido de dos vectores",
      estado: "sospecha",
      veces: 1,
      detalles: [],
    },
  ];
  // Se guarda una sospecha antes que la confirmada: el orden de la lectura (los confirmados primero) lo pone la base, no quien guarda.
  const [confirmada, ...sospechas] = errores;
  return {
    habilidades,
    errores: [sospechas[0], confirmada, ...sospechas.slice(1)],
    prerrequisitos: [
      { materia: null, habilidad: `repasar-secreto-${marca}-1`, descripcion: "despeja una incógnita" },
      { materia: null, habilidad: `repasar-secreto-${marca}-1`, descripcion: "despeja una incógnita" },
      { materia: "Cálculo Diferencial", habilidad: `repasar-secreto-${marca}-2`, descripcion: "deriva polinomios" },
      // La misma clave en otra materia es otro prerrequisito...
      { materia: "Precálculo", habilidad: `repasar-secreto-${marca}-2`, descripcion: PRERREQUISITO_CON_FORMULA },
      // ...y otra clave con la misma descripción también.
      { materia: null, habilidad: `repasar-secreto-${marca}-3`, descripcion: "despeja una incógnita" },
    ],
  };
}

/**
 * Todo lo interno que no puede salir en nada que vea el monitor: la clave y el tema de cada pregunta, las claves de habilidad y de
 * misconcepción, la semilla, y el texto de error de cada opción incorrecta (el de la elegida sale solo como detalle del error de
 * `resultado`, que quien lo siembra decide).
 */
export function valoresInternos(plan: readonly PlanDePregunta[], marca: string): string[] {
  return [
    temaDePregunta(marca),
    `habilidad-secreta-${marca}`,
    `misconcepcion-secreta-${marca}`,
    `repasar-secreto-${marca}`,
    ...plan.flatMap((p) => [claveDePregunta(p, marca), habilidadDePregunta(p, marca)]),
    String(SEMILLA_SEMBRADA),
  ];
}

/** El texto de error de las opciones que NO eligió, en todas las preguntas: ninguno puede salir (D-54: «no se muestra»). */
export function textosDeErrorDeLasQueNoEligio(plan: readonly PlanDePregunta[], marca: string): string[] {
  return plan.flatMap((p) =>
    LETRAS.filter((letra) => letra !== p.correctaDelBanco && letra !== p.elegidaDelBanco).map((letra) => textoDeErrorDeOpcion(p, marca, letra)),
  );
}

// ---------------------------------------------------------------------------
// La fila de `diagnostico`
// ---------------------------------------------------------------------------

export type DatosDeLaFila = {
  idSesionAnonima?: string | null;
  idLead?: string | null;
  idEvaluacion: string;
  idMateria: string;
  plan: readonly PlanDePregunta[];
  marca: string;
  resultado: ResultadoGuardado;
  /** `repetido = true` es la nota de D-53 b. */
  repetido?: boolean;
  /** ISO. Por omisión, 23:30 de Bogotá del 4 de octubre de 2026, que en UTC ya es el 5. */
  fecha?: string;
};

/**
 * La fila que inserta `terminar_diagnostico` (HU-081), completa: una copia por pregunta, la semilla, los aciertos, la marca de falta
 * de material y el resultado. `puntaje` sale de los aciertos con dos decimales, como lo calcula el motor. Quien la siembra la
 * inserta con la llave secreta (`from("diagnostico").insert(fila).select().single()`); el token de recuperación lo pone la base.
 */
export function filaDeDiagnosticoConRespuestas(datos: DatosDeLaFila) {
  if (datos.plan.length < 1) throw new Error("El diagnóstico a sembrar necesita al menos una pregunta.");
  if (!datos.idSesionAnonima && !datos.idLead) throw new Error("El diagnóstico a sembrar necesita una sesión o un Lead dueños.");
  const aciertos = aciertosDe(datos.plan);
  return {
    id_sesion_anonima: datos.idSesionAnonima ?? null,
    id_lead: datos.idLead ?? null,
    id_evaluacion: datos.idEvaluacion,
    id_materia: datos.idMateria,
    respuestas: copiasDe(datos.plan, datos.marca),
    fecha_realizacion: datos.fecha ?? "2026-10-05T04:30:00.000Z",
    puntaje: Math.round((aciertos / datos.plan.length) * 10000) / 100,
    resultado_por_habilidad: datos.resultado,
    semilla: SEMILLA_SEMBRADA,
    aciertos,
    repetido: datos.repetido ?? false,
    falta_material: [{ habilidad: `habilidad-secreta-${datos.marca}-h4`, motivos: ["sin_preguntas_sin_ver", "tope_una_respuesta"] }],
  };
}
