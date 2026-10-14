import type { Letra } from "./motor";
import type { ResultadoParaMostrar } from "./mostrar";
import { TEXTOS } from "./presentacion";
import type { EnCurso, RespuestaDeIniciar, RespuestaDeResponder } from "./reglas";
import { rutaDeResultado } from "./rutas";

/**
 * Lo puro de las pantallas del diagnóstico (HU-009): los tipos de lo que devuelven las acciones, la traducción de lo que
 * responde el módulo del servidor (HU-081), las transiciones del recorrido y el orden del selector. Va al navegador, así que
 * de `reglas.ts` y `mostrar.ts` solo importa tipos (`import type`): un import de valores arrastraría el motor al paquete.
 */

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

export type EvaluacionParaElegir = { id: string; nombre: string; semana: number; temas: string[] };
export type MateriaConEvaluaciones = { codigo: string; nombre: string; evaluaciones: EvaluacionParaElegir[] };

/**
 * Las materias por nombre y, en empate, por código; y las Evaluaciones de cada una por semana, luego por nombre y por id. La
 * base no pone el orden: su colación puede mandar «Álgebra» después de «Zoología», así que se ordena aquí con `localeCompare`
 * en español, como el resto del repo. Devuelve listas nuevas.
 */
export function ordenarMaterias(materias: readonly MateriaConEvaluaciones[]): MateriaConEvaluaciones[] {
  return materias
    .map((materia) => ({
      ...materia,
      evaluaciones: [...materia.evaluaciones].sort(
        (a, b) => a.semana - b.semana || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id),
      ),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.codigo.localeCompare(b.codigo));
}

/** Lo que la persona eligió en el selector, guardado como el código de la materia y el id de la Evaluación. */
export type Seleccion = { materia: MateriaConEvaluaciones | null; evaluacion: EvaluacionParaElegir | null };

/**
 * Lo elegido, validado contra las `materias` que llegan en este render: tras un `router.refresh()` (la Evaluación se apagó) lo
 * que ya no existe se descarta y no se envía. Con una sola Evaluación queda elegida; con varias se elige una.
 */
export function resolverSeleccion(materias: readonly MateriaConEvaluaciones[], codigo: string | null, idEvaluacion: string | null): Seleccion {
  const materia = materias.find((m) => m.codigo === codigo) ?? null;
  const evaluaciones = materia?.evaluaciones ?? [];
  const evaluacion = evaluaciones.length === 1 ? evaluaciones[0] : (evaluaciones.find((e) => e.id === idEvaluacion) ?? null);
  return { materia, evaluacion };
}

/** Por qué todavía no se puede empezar, o `null` si ya se eligió todo. */
export function errorDeSeleccion(seleccion: Seleccion): string | null {
  if (!seleccion.materia) return TEXTOS.elegirMateria;
  if (!seleccion.evaluacion) return TEXTOS.elegirEvaluacion;
  return null;
}

/**
 * Qué hace «Responder»: nada mientras hay una llamada en curso, pedir que elija si no eligió ninguna opción (sin llamar a nada)
 * y enviar si eligió. Elegir una opción no envía nada: solo este botón.
 */
export function decidirEnvioDeRespuesta(elegida: Letra | null, ocupado: boolean): "nada" | "falta_elegir" | "enviar" {
  if (ocupado) return "nada";
  return elegida === null ? "falta_elegir" : "enviar";
}

// ---------------------------------------------------------------------------
// Lo que devuelven las acciones (todo serializable)
// ---------------------------------------------------------------------------

export type ResultadoDeEmpezar =
  | { tipo: "pregunta"; enCurso: EnCurso }
  | { tipo: "sin_preguntas"; ultimo: ResultadoParaMostrar | null }
  /** La Evaluación se apagó o ya no existe. */
  | { tipo: "no_disponible"; mensaje: string }
  /** Cuenta del equipo, sin sesión o un fallo. */
  | { tipo: "error"; mensaje: string };

export type ResultadoDeResponder =
  /** La siguiente pregunta, o la actual si el paso era viejo. */
  | { tipo: "pregunta"; enCurso: EnCurso }
  | { tipo: "terminado"; ruta: string }
  /** El diagnóstico venció (pasaron 2 horas sin responder). */
  | { tipo: "vencido" }
  /** Hay otro diagnóstico en curso: la persona empezó otro en otra pestaña. */
  | { tipo: "reemplazado"; enCurso: EnCurso }
  | { tipo: "error"; mensaje: string };

/**
 * Las claves de primer nivel que puede tener lo que devuelve una acción. `clavesNoPermitidas` del módulo del servidor solo
 * conoce las cinco formas de HU-081, así que se usa únicamente sobre `enCurso`; el resto se compara con esta lista.
 */
export const CLAVES_DE_LAS_ACCIONES: readonly string[] = ["tipo", "enCurso", "ultimo", "ruta", "mensaje"];

/**
 * La respuesta del módulo al iniciar, en lo que la pantalla necesita. `ultimo` es el resultado que ya leyó la acción para el
 * mensaje de D-51. De `sin_preguntas` no sale `idUltimoDiagnostico`: es el id de otro diagnóstico y el navegador no lo necesita.
 */
export function traducirEmpezar(respuesta: RespuestaDeIniciar, ultimo: ResultadoParaMostrar | null): ResultadoDeEmpezar {
  switch (respuesta.estado) {
    case "en_curso":
      return { tipo: "pregunta", enCurso: respuesta };
    case "sin_preguntas":
      return { tipo: "sin_preguntas", ultimo };
    case "no_disponible":
      return respuesta.motivo === "cuenta_del_equipo"
        ? { tipo: "error", mensaje: TEXTOS.cuentaDelEquipo }
        : { tipo: "no_disponible", mensaje: TEXTOS.evaluacionNoDisponible };
  }
}

/**
 * La respuesta del módulo al responder. Una respuesta que no se aplicó (paso viejo, otra pestaña) vuelve como el estado actual:
 * si es el mismo diagnóstico que mostraba la pantalla es su pregunta de ahora (`pregunta`) y si es otro, la persona empezó uno
 * en otra pestaña (`reemplazado`). Los ids se comparan sin importar mayúsculas, como hace el servidor.
 */
export function traducirResponder(respuesta: RespuestaDeResponder, idPedido: unknown): ResultadoDeResponder {
  switch (respuesta.estado) {
    case "en_curso":
      return typeof idPedido === "string" && idPedido.toLowerCase() === respuesta.idDiagnostico.toLowerCase()
        ? { tipo: "pregunta", enCurso: respuesta }
        : { tipo: "reemplazado", enCurso: respuesta };
    case "terminado":
      return { tipo: "terminado", ruta: rutaDeResultado(respuesta.idDiagnostico) };
    case "ninguno":
      return { tipo: "vencido" };
  }
}

/**
 * Llama a una acción sin que un fallo de la red tumbe la pantalla: un `TypeError: Failed to fetch` (o un despliegue nuevo que
 * ya no conoce la acción) da el mismo `error` que un fallo del servidor. Las acciones no lanzan `redirect`, así que no hace
 * falta dejar pasar nada con `unstable_rethrow`.
 */
export async function llamarSinCaerse<R extends { tipo: string }>(
  llamada: () => Promise<R>,
  mensajeDeError: string,
): Promise<R | { tipo: "error"; mensaje: string }> {
  try {
    return await llamada();
  } catch {
    return { tipo: "error", mensaje: mensajeDeError };
  }
}

// ---------------------------------------------------------------------------
// Pantallas del recorrido
// ---------------------------------------------------------------------------

/**
 * Qué pantalla ve la persona. `enfocar` es verdadero solo cuando se llega a ella por una transición (nunca al cargar o recargar
 * la página, ni cuando solo aparece un mensaje): ahí el foco pasa al enunciado de la pregunta o al título.
 */
export type PantallaDelRecorrido =
  | { tipo: "selector"; enCurso: EnCurso | null; mensaje: string | null; enfocar: boolean }
  | { tipo: "pregunta"; enCurso: EnCurso; mensaje: string | null; enfocar: boolean }
  | {
      tipo: "sin_preguntas";
      /** La Evaluación que se intentó empezar: «Sí, volver a tomarlo» la vuelve a pedir. */
      idEvaluacion: string;
      ultimo: ResultadoParaMostrar | null;
      /** El diagnóstico que seguía en curso, para que «No» no pierda el aviso del selector. */
      enCursoPrevio: EnCurso | null;
      mensaje: string | null;
      enfocar: boolean;
    };

export type EventoDelRecorrido =
  | { tipo: "cambiar_materia" }
  /** «Volver a mi pregunta»: del selector al diagnóstico que sigue en curso, sin llamar a nada. */
  | { tipo: "volver" }
  /**
   * Empieza una llamada a una acción: se quita el mensaje de la anterior. Así, si la siguiente falla con el mismo texto, el
   * `role="alert"` vuelve a insertarse en la página y un lector de pantalla lo anuncia otra vez.
   */
  | { tipo: "llamando" }
  | { tipo: "empezo"; idEvaluacion: string; respuesta: ResultadoDeEmpezar }
  | { tipo: "respondio"; respuesta: ResultadoDeResponder }
  /** «No» a volver a tomar el diagnóstico (D-51). */
  | { tipo: "no" };

/** La pantalla con la que carga la página: la pregunta pendiente si hay un diagnóstico en curso, y si no el selector. */
export function pantallaInicial(enCurso: EnCurso | null): PantallaDelRecorrido {
  return enCurso ? { tipo: "pregunta", enCurso, mensaje: null, enfocar: false } : { tipo: "selector", enCurso: null, mensaje: null, enfocar: false };
}

/** El diagnóstico que sigue en curso, según la pantalla de la que se parte. */
function enCursoDe(pantalla: PantallaDelRecorrido): EnCurso | null {
  return pantalla.tipo === "sin_preguntas" ? pantalla.enCursoPrevio : pantalla.enCurso;
}

/** Cada transición del recorrido (B8 del SPEC). Pura: el componente solo la aplica. */
export function siguientePantalla(actual: PantallaDelRecorrido, evento: EventoDelRecorrido): PantallaDelRecorrido {
  switch (evento.tipo) {
    case "cambiar_materia":
      return actual.tipo === "pregunta" ? { tipo: "selector", enCurso: actual.enCurso, mensaje: null, enfocar: true } : actual;
    case "volver":
      // Solo hay a qué volver si el selector se abrió con un diagnóstico en curso (la salida si su Evaluación ya no se ofrece).
      return actual.tipo === "selector" && actual.enCurso ? { tipo: "pregunta", enCurso: actual.enCurso, mensaje: null, enfocar: true } : actual;
    case "llamando":
      // `enfocar: false`: el foco ya está en el botón que se pulsó y no debe volver a moverse al enunciado ni al título.
      return actual.mensaje === null ? actual : { ...actual, mensaje: null, enfocar: false };
    case "no":
      return actual.tipo === "sin_preguntas" ? { tipo: "selector", enCurso: actual.enCursoPrevio, mensaje: null, enfocar: true } : actual;
    case "empezo":
      return despuesDeEmpezar(actual, evento.idEvaluacion, evento.respuesta);
    case "respondio":
      return despuesDeResponder(actual, evento.respuesta);
  }
}

function despuesDeEmpezar(actual: PantallaDelRecorrido, idEvaluacion: string, respuesta: ResultadoDeEmpezar): PantallaDelRecorrido {
  switch (respuesta.tipo) {
    case "pregunta":
      return { tipo: "pregunta", enCurso: respuesta.enCurso, mensaje: null, enfocar: true };
    case "sin_preguntas":
      return { tipo: "sin_preguntas", idEvaluacion, ultimo: respuesta.ultimo, enCursoPrevio: enCursoDe(actual), mensaje: null, enfocar: true };
    case "no_disponible":
      // Vuelve al selector con el aviso, sin perder el de lo que sigue en curso.
      return { tipo: "selector", enCurso: enCursoDe(actual), mensaje: respuesta.mensaje, enfocar: true };
    case "error":
      // Se queda donde está, con el mensaje: un fallo pasajero no tira a la persona a otra pantalla.
      return { ...actual, mensaje: respuesta.mensaje, enfocar: false };
  }
}

function despuesDeResponder(actual: PantallaDelRecorrido, respuesta: ResultadoDeResponder): PantallaDelRecorrido {
  // Solo se responde desde una pregunta; una respuesta que llega a otra pantalla no la cambia.
  if (actual.tipo !== "pregunta") return actual;
  switch (respuesta.tipo) {
    case "pregunta":
      return { tipo: "pregunta", enCurso: respuesta.enCurso, mensaje: null, enfocar: true };
    case "error":
      // Sin remontar la pregunta: la opción elegida se conserva.
      return { ...actual, mensaje: respuesta.mensaje, enfocar: false };
    case "vencido":
      return { tipo: "selector", enCurso: null, mensaje: TEXTOS.diagnosticoVencido, enfocar: true };
    case "reemplazado":
      return { tipo: "selector", enCurso: respuesta.enCurso, mensaje: TEXTOS.diagnosticoVencido, enfocar: true };
    case "terminado":
      // La pantalla no cambia: el cliente navega al resultado.
      return actual;
  }
}
