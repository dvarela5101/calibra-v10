import type { CopiaDePaso, Dificultad, Letra, OpcionDeCopia } from "../src/lib/diagnostico/motor";

/**
 * Las `respuestas` de un diagnóstico sembrado (HU-011): la copia de cada pregunta como la guarda `terminar_diagnostico`
 * (HU-081), con un valor CENTINELA distinto en cada campo que no puede llegar al navegador (criterio 7 de HU-011): la clave de la
 * pregunta, su enunciado, el texto de cada opción, el de la opción correcta, la misconcepción y el texto de error de cada opción
 * incorrecta y la solución. Una prueba siembra estas copias con `sembrarDiagnostico({ respuestas })` y busca cada centinela en lo
 * que recibe el navegador: si la portada dejara pasar uno, el nombre del campo dice por dónde se fugó.
 *
 * La dificultad (1, 2 o 3) y `correcta` (true o false) no son textos únicos y no sirven de centinela: se buscan por su nombre de
 * campo entre comillas (`CAMPOS_SIN_CENTINELA`). Solo usa `import type` de `src/`: lo cargan Vitest y Playwright, que no comparten
 * alias de rutas.
 */

const LETRAS_DEL_BANCO: readonly Letra[] = ["A", "B", "C", "D"];

/** Los nombres de campo de lo que no tiene un texto único: la dificultad y cuál opción es la correcta. */
export const CAMPOS_SIN_CENTINELA = ["dificultad", "correcta"] as const;

/** Un centinela por campo y por pregunta. La opción correcta cambia de posición de una pregunta a otra. */
function centinelasDe(n: number) {
  const posicionDeLaCorrecta = (n - 1) % LETRAS_DEL_BANCO.length;
  return {
    clave: `p-secreta-${n}`,
    tema: `tema-secreto-${n}`,
    enunciado: `enunciado-secreto-${n}`,
    habilidad: `habilidad-de-pregunta-secreta-${n}`,
    solucion: `solucion-secreta-${n}`,
    opciones: LETRAS_DEL_BANCO.map((letra, i): OpcionDeCopia =>
      i === posicionDeLaCorrecta
        ? { texto: `opcion-correcta-secreta-${n}`, correcta: true, misconcepcion: null, error: null }
        : {
            texto: `texto-secreto-${n}-${letra}`,
            correcta: false,
            misconcepcion: `misc-opcion-secreta-${n}-${letra}`,
            error: `error-opcion-secreta-${n}-${letra}`,
          },
    ),
  };
}

/**
 * `cantidad` copias de pasos respondidos. Pasan por `leerPaso` de HU-081 (`entrada.ts`): cuatro opciones, una dificultad de 1 a 3,
 * un orden que es una permutación de A a D y una letra elegida.
 */
export function respuestasConCentinelas(cantidad: number): CopiaDePaso[] {
  return Array.from({ length: cantidad }, (_, i) => {
    const n = i + 1;
    const centinelas = centinelasDe(n);
    return {
      clave: centinelas.clave,
      tema: centinelas.tema,
      enunciado: centinelas.enunciado,
      opciones: centinelas.opciones,
      dificultad: (((n - 1) % 3) + 1) as Dificultad,
      habilidades: [centinelas.habilidad],
      solucion: centinelas.solucion,
      // Una permutación distinta en cada pregunta, y la letra que vio la persona.
      orden: [...LETRAS_DEL_BANCO.slice(n % 4), ...LETRAS_DEL_BANCO.slice(0, n % 4)],
      letraElegida: LETRAS_DEL_BANCO[(n + 1) % 4],
      fecha: "2026-10-05T03:00:00.000Z",
    };
  });
}

/** Todos los textos centinela de esas copias, para buscarlos uno por uno en lo que recibe el navegador. */
export function centinelasDeLasRespuestas(cantidad: number): string[] {
  return respuestasConCentinelas(cantidad).flatMap((copia) => [
    copia.clave,
    copia.tema,
    copia.enunciado,
    ...copia.habilidades,
    ...(copia.solucion === null ? [] : [copia.solucion]),
    ...copia.opciones.flatMap((opcion) => [opcion.texto, ...(opcion.misconcepcion === null ? [] : [opcion.misconcepcion]), ...(opcion.error === null ? [] : [opcion.error])]),
  ]);
}
