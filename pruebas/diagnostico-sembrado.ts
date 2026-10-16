import type pg from "pg";
import type { FilaDeMiDiagnostico } from "@/lib/diagnostico/mostrar";
import type { ResultadoGuardado } from "@/lib/diagnostico/resultado";

/**
 * Un resultado de ejemplo del diagnóstico (HU-009), para las pruebas de Vitest de la proyección, del componente y de las páginas.
 * Es el JSON que guarda HU-081 en `diagnostico.resultado_por_habilidad` y la fila que devuelve `public.mi_diagnostico(id)`.
 *
 * Trae los cuatro niveles, un error confirmado y dos en sospecha (uno de una habilidad que no es del resultado), un detalle
 * presente y otro ausente, un prerrequisito de otra materia y una fórmula `$…$` en cada sitio donde el resultado dibuja un
 * texto del banco: la descripción de una habilidad (que el error nombra con «Habilidad: …»), el título de un error, un detalle y
 * un prerrequisito. Así, si uno de esos sitios deja de pasar por `TextoDelBanco`, se ve el `$` crudo. Las claves internas (`habilidad`,
 * `misconcepcion`) son reconocibles a propósito: una prueba busca que ninguna salga, ni siquiera como valor de otro campo.
 * Está en `pruebas/` para que lo reutilicen las pruebas de integración y la e2e cuando necesiten sembrar un diagnóstico.
 *
 * `sembrarDiagnostico` (al final) escribe uno de esos en la base local con una conexión `pg`, para las pruebas de integración y
 * la e2e. Solo usa `import type` de `src/`: lo cargan Vitest y Playwright, que no comparten alias de rutas.
 */

/** Las claves internas del ejemplo: nada de esto puede aparecer en lo que ve la persona. */
export const CLAVES_INTERNAS_DE_EJEMPLO = [
  "habilidad-secreta-1",
  "habilidad-secreta-2",
  "habilidad-secreta-3",
  "habilidad-secreta-4",
  "habilidad-secreta-5",
  "habilidad-de-otra-evaluacion",
  "misc-secreta-1",
  "misc-secreta-2",
  "misc-secreta-3",
  "repasar-secreta-1",
  "repasar-secreta-2",
] as const;

export const GUARDADO_DE_EJEMPLO: ResultadoGuardado = {
  habilidades: [
    { habilidad: "habilidad-secreta-1", descripcion: "calcula la fuerza neta con $F = ma$", nivel: "lo_domina", respuestas: 3, aciertos: 3 },
    { habilidad: "habilidad-secreta-2", descripcion: "aplica la conservación de la energía", nivel: "en_proceso", respuestas: 2, aciertos: 1 },
    { habilidad: "habilidad-secreta-3", descripcion: "interpreta gráficas de posición como $x = vt$", nivel: "no_lo_domina", respuestas: 2, aciertos: 0 },
    { habilidad: "habilidad-secreta-4", descripcion: "resuelve problemas con rozamiento", nivel: "sin_medir", respuestas: 0, aciertos: 0 },
    { habilidad: "habilidad-secreta-5", descripcion: "lee un diagrama de fuerzas", nivel: "no_lo_domina", respuestas: 0, aciertos: 0 },
  ],
  errores: [
    {
      misconcepcion: "misc-secreta-1",
      habilidad: "habilidad-secreta-2",
      descripcionHabilidad: "aplica la conservación de la energía",
      texto: "confundes energía con potencia",
      estado: "sospecha",
      veces: 1,
      detalles: [],
    },
    {
      misconcepcion: "misc-secreta-2",
      habilidad: "habilidad-secreta-3",
      descripcionHabilidad: "interpreta gráficas de posición como $x = vt$",
      texto: String.raw`inviertes la relación $\frac{1}{2}$ entre dos magnitudes`,
      estado: "confirmada",
      veces: 2,
      detalles: [String.raw`Revisa qué magnitud va arriba en $\frac{a}{b}$.`],
    },
    {
      misconcepcion: "misc-secreta-3",
      habilidad: "habilidad-de-otra-evaluacion",
      descripcionHabilidad: "calcula el trabajo de la fricción",
      texto: "ignoras la fricción",
      estado: "sospecha",
      veces: 1,
      detalles: ["La fricción también hace trabajo.", "Piensa en el sentido del movimiento."],
    },
  ],
  prerrequisitos: [
    { materia: null, habilidad: "repasar-secreta-1", descripcion: "despeja una incógnita en $ax + b = c$" },
    { materia: "Cálculo Diferencial", habilidad: "repasar-secreta-2", descripcion: "deriva polinomios" },
  ],
};

/** 5 de 8: «Puntaje global: 63 %». La fecha es del 4 de octubre en Bogotá y del 5 en UTC. */
export const FILA_DE_EJEMPLO: FilaDeMiDiagnostico = {
  id_diagnostico: "d1a90000-0000-4000-8000-000000000009",
  codigo_materia: "FISI-1528",
  nombre_materia: "Física II",
  nombre_evaluacion: "Parcial 1",
  fecha_realizacion: "2026-10-05T03:30:00+00:00",
  respondidas: 8,
  aciertos: 5,
  resultado: GUARDADO_DE_EJEMPLO,
};

// ---------------------------------------------------------------------------
// Sembrar en la base local
// ---------------------------------------------------------------------------

/** Lo que se siembra. Todo lo que no se dice sale del ejemplo de arriba: 8 respondidas, 5 aciertos y el resultado de cuatro niveles. */
export type DatosParaSembrar = {
  /** La sesión que hizo el diagnóstico. Sin ella, `idLead` es obligatorio (`diagnostico_tiene_dueno`). */
  idSesionAnonima?: string | null;
  /** El Lead al que quedó ligado (`registrar_lead` lo pone al dejar el contacto). */
  idLead?: string | null;
  idEvaluacion: string;
  /**
   * Las claves de las preguntas que cuenta como vistas: una por respuesta, así que su largo es `respondidas`. Por omisión
   * `P1`..`P8`. Para que una sesión del mismo Lead no tenga preguntas nuevas, que sean todas las de la Evaluación.
   */
  claves?: string[];
  aciertos?: number;
  resultado?: ResultadoGuardado;
  /** `repetido = true` es lo que deja «Sí, volver a tomarlo» (D-51). */
  repetido?: boolean;
  /** ISO. Por omisión, ahora. */
  fecha?: string;
  /** La marca interna de falta de material: por omisión, una habilidad con motivo, para que una fuga se note. */
  faltaMaterial?: unknown;
  /**
   * Las respuestas tal como las guarda la base (la copia de la pregunta de cada paso), en lugar de `{clave}` por cada clave. No
   * se combina con `claves`; su largo es `respondidas`. HU-011: `pruebas/respuestas-con-centinelas.ts` arma unas con un valor
   * reconocible en cada campo que no puede llegar al navegador.
   */
  respuestas?: unknown[];
  /** El id del diagnóstico, para fijar un empate de fecha (HU-011). Por omisión lo genera la base. */
  id?: string;
  /** Entero de 0 a 4294967295 (HU-011: uno reconocible para buscarlo en el HTML). Por omisión, 4242. */
  semilla?: number;
};

export type DiagnosticoSembrado = {
  id: string;
  /** El token de recuperación que generó la base: nada de lo que ve la persona puede llevarlo. */
  tokenDeRecuperacion: string;
  puntaje: number;
};

const CLAVES_POR_OMISION = Array.from({ length: FILA_DE_EJEMPLO.respondidas }, (_, i) => `P${i + 1}`);

/**
 * Inserta un diagnóstico terminado, completo como los que deja `terminar_diagnostico` (HU-081): un elemento de `respuestas`
 * por clave, semilla, aciertos, resultado y marca de falta de material. `puntaje` sale de `aciertos` y de las respuestas, como
 * lo calcula el motor (dos decimales). La materia es la de la Evaluación. No borra nada: quien lo siembra lo borra por su `id`
 * (o con su sesión, que lo arrastra en cascada) y, si hay una cita que lo apunta, después de ella.
 */
export async function sembrarDiagnostico(bd: pg.ClientBase, datos: DatosParaSembrar): Promise<DiagnosticoSembrado> {
  if (datos.claves && datos.respuestas) throw new Error("El diagnóstico a sembrar no cuadra: `claves` y `respuestas` no se combinan.");
  const respuestas = datos.respuestas ?? (datos.claves ?? CLAVES_POR_OMISION).map((clave) => ({ clave }));
  const aciertos = datos.aciertos ?? Math.min(FILA_DE_EJEMPLO.aciertos, respuestas.length);
  if (respuestas.length < 1 || aciertos < 0 || aciertos > respuestas.length) {
    throw new Error("El diagnóstico a sembrar no cuadra: necesita al menos una respuesta y aciertos entre 0 y las respuestas.");
  }
  if (!datos.idSesionAnonima && !datos.idLead) throw new Error("El diagnóstico a sembrar necesita una sesión o un Lead dueños.");

  const puntaje = Math.round((aciertos / respuestas.length) * 10000) / 100;
  const { rows } = await bd.query<{ id: string; token_recuperacion: string }>(
    `insert into public.diagnostico (id, id_sesion_anonima, id_lead, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                     resultado_por_habilidad, semilla, aciertos, repetido, falta_material)
     select coalesce($11::uuid, gen_random_uuid()), $1::uuid, $2::uuid, e.id, e.id_materia, $4::jsonb, coalesce($5::timestamptz, now()),
            $6::numeric, $7::jsonb, coalesce($12::bigint, 4242), $8::integer, $9::boolean, $10::jsonb
     from public.evaluacion e
     where e.id = $3::uuid
     returning id, token_recuperacion`,
    [
      datos.idSesionAnonima ?? null,
      datos.idLead ?? null,
      datos.idEvaluacion,
      JSON.stringify(respuestas),
      datos.fecha ?? null,
      puntaje,
      JSON.stringify(datos.resultado ?? GUARDADO_DE_EJEMPLO),
      aciertos,
      datos.repetido ?? false,
      JSON.stringify(datos.faltaMaterial ?? [{ habilidad: "habilidad-secreta-4", motivos: ["tope_una_respuesta"] }]),
      datos.id ?? null,
      datos.semilla ?? null,
    ],
  );
  if (rows.length !== 1) throw new Error(`No se sembró el diagnóstico: no existe la Evaluación ${datos.idEvaluacion}.`);
  return { id: rows[0].id, tokenDeRecuperacion: rows[0].token_recuperacion, puntaje };
}
