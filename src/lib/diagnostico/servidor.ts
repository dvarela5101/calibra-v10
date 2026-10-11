import "server-only";
import { randomInt } from "node:crypto";
import type { Sesion } from "@/lib/auth/sesion";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/tipos";
import { candidataDe, entradaDeLaFila, leerFotoDelBanco, type EntradaDeLaFila } from "./entrada";
import { calificar, maximoDePreguntas, paraNavegador, siguientePregunta, type CopiaDePaso, type EntradaMotor, type Letra } from "./motor";
import {
  esLetra,
  esPasoValido,
  esUuid,
  proyectarEnCurso,
  proyectarNinguno,
  proyectarNoDisponible,
  proyectarSinPreguntas,
  proyectarTerminado,
  type EnCurso,
  type Ninguno,
  type RespuestaDeConsulta,
  type RespuestaDeIniciar,
  type RespuestaDeResponder,
  type Terminado,
} from "./reglas";
import { aciertosDe, armarResultadoGuardado, faltaMaterialDe } from "./resultado";

/**
 * El servidor del diagnóstico (HU-081): lleva cada diagnóstico de principio a fin con el motor de HU-060, lejos del navegador.
 * Todo con la llave secreta: ninguna sesión lee `diagnostico_en_curso`, el banco ni las copias de las preguntas. Quien llama
 * ya comprobó la sesión (`obtenerSesion()`) y pasa la suya, nunca un id que venga del navegador; las acciones de HU-009 son
 * envoltorios de estas tres operaciones.
 *
 * Qué recibe el navegador: solo las cinco formas de `reglas.ts` (`en_curso`, `sin_preguntas`, `terminado`, `ninguno` y
 * `no_disponible`), construidas con una lista de claves permitidas. Nunca la clave de la pregunta, la dificultad, la correcta,
 * la misconcepción, el texto de error, la solución, la semilla ni el `token_recuperacion` (D-14).
 *
 * Qué lanza: solo las fallas de infraestructura (la base, el motor, una fila que no sirve), con un mensaje sin contenido: un
 * error de PostgREST trae en `details` la fila completa (semilla, candidatas con la correcta y la solución), así que de él solo
 * se usa `code` y el nombre de la función, y nunca se relanza el objeto. Un dato del navegador que no vale (un id que no es
 * UUID, un paso o una letra fuera de rango) no lanza: no aplica nada y devuelve el estado actual.
 */

/** Lo que las pruebas pueden cambiar. Por omisión, el cliente de la llave secreta y una semilla de `crypto`. */
export type Dependencias = {
  cliente?: ClienteDelDiagnostico;
  /** Semilla fija para iniciar (entero de 32 bits sin signo). */
  semilla?: number;
};

/** Lo único que el servidor usa del cliente de Supabase. */
export type ClienteDelDiagnostico = Pick<ReturnType<typeof crearClienteAdmin>, "rpc" | "from">;

export type PedidoDeIniciar = {
  idEvaluacion: unknown;
  /** D-51: solo vale si la persona ya vio todas las preguntas de la Evaluación; con preguntas libres se ignora. */
  volverATomar?: boolean;
};

export type PedidoDeResponder = {
  idDiagnostico: unknown;
  /** El `paso` que mostró la pantalla: las preguntas ya respondidas, desde 0. */
  paso: unknown;
  /** La letra que vio la persona, de la A a la D (la posición, no la letra del banco). */
  letra: unknown;
};

// ---------------------------------------------------------------------------
// Errores sin contenido
// ---------------------------------------------------------------------------

const esDelEquipo = (sesion: Sesion) => sesion.rol === "admin" || sesion.rol === "monitor";

const comoJson = (valor: unknown): Json => valor as Json;

/**
 * El resultado de una consulta o de una función de la base, o un error que dice cuál falló y con qué código. Nunca `message`,
 * `details` ni `hint`: un check o una llave que falla en `diagnostico_en_curso` o `diagnostico` imprime en `details` la fila
 * completa. Tampoco se relanza el objeto de error.
 */
function exigir<T>(consulta: string, respuesta: { data: T; error: { code?: string } | null }): T {
  if (respuesta.error) {
    throw new Error(`Falló «${consulta}» en el servidor del diagnóstico (código ${respuesta.error.code || "sin código"}).`);
  }
  return respuesta.data;
}

/**
 * Llama al motor. Un banco mal cargado lo hace lanzar `RangeError`: se registra sin contenido (las claves de las preguntas y
 * las letras, nunca los textos) y la operación lanza un error genérico. No se inventa un estado ni se salta una pregunta.
 */
function delMotor<T>(calcular: () => T): T {
  try {
    return calcular();
  } catch (error) {
    // Los mensajes del motor traen entre paréntesis el valor que llegó, que puede ser la semilla: se quita.
    const mensaje = error instanceof Error ? error.message.replace(/\(llegó[^)]*\)/g, "(llegó un valor inválido)") : "error desconocido";
    console.error(`[diagnostico] el motor rechazó los datos: ${mensaje}`);
    throw new Error("El motor del diagnóstico rechazó los datos de este diagnóstico.");
  }
}

// ---------------------------------------------------------------------------
// Lectura del diagnóstico en curso
// ---------------------------------------------------------------------------

/** El diagnóstico en curso vigente de la sesión, con su entrada lista, o `null` si no hay, venció o es de otra versión de la foto. */
async function leerDiagnosticoEnCurso(cliente: ClienteDelDiagnostico, idUsuario: string): Promise<EntradaDeLaFila | null> {
  const filas = exigir("diagnostico_en_curso_de", await cliente.rpc("diagnostico_en_curso_de", { p_id_sesion: idUsuario }));
  const fila = filas?.[0];
  return fila ? entradaDeLaFila(fila) : null;
}

/** La pregunta pendiente de un diagnóstico en curso, tal como se la muestra al navegador. */
function enCursoDe({ fila, contexto, entrada, pasos }: EntradaDeLaFila): EnCurso {
  const siguiente = delMotor(() => siguientePregunta(entrada, pasos));
  // El último paso termina el diagnóstico en la misma transacción que lo cierra: una fila sin pregunta pendiente no existe.
  if ("terminado" in siguiente) throw new Error(`El diagnóstico en curso ${fila.id} no tiene pregunta pendiente.`);
  return proyectarEnCurso({
    idDiagnostico: fila.id,
    evaluacion: contexto.evaluacion,
    materia: contexto.materia,
    paso: fila.paso,
    maximo: delMotor(() => maximoDePreguntas(entrada)),
    pregunta: paraNavegador(candidataDe(entrada, siguiente.clave), siguiente.orden),
  });
}

/**
 * Qué decirle a quien responde algo que no se aplicó (un paso viejo, otra pestaña, el doble clic en el último paso), en este
 * orden: (a) hay un diagnóstico en curso vigente con el id pedido: su pregunta pendiente; (b) ese id ya es un diagnóstico
 * terminado de la sesión: `terminado`; (c) hay otro diagnóstico en curso vigente: el de ahora (la pantalla compara el
 * `idDiagnostico` con el suyo); (d) nada: `ninguno`. `actual` es lo que se acaba de leer; `undefined` lo vuelve a leer.
 */
async function estadoActual(
  cliente: ClienteDelDiagnostico,
  idUsuario: string,
  idDiagnostico: string | null,
  actual?: EntradaDeLaFila | null,
): Promise<EnCurso | Terminado | Ninguno> {
  const leido = actual === undefined ? await leerDiagnosticoEnCurso(cliente, idUsuario) : actual;
  if (leido !== null && idDiagnostico !== null && leido.fila.id === idDiagnostico) return enCursoDe(leido);

  if (idDiagnostico !== null) {
    const terminado = exigir(
      "la búsqueda de diagnósticos terminados",
      await cliente.from("diagnostico").select("id").eq("id", idDiagnostico).eq("id_sesion_anonima", idUsuario).maybeSingle(),
    );
    if (terminado) return proyectarTerminado(terminado.id);
  }

  return leido !== null ? enCursoDe(leido) : proyectarNinguno();
}

// ---------------------------------------------------------------------------
// Iniciar
// ---------------------------------------------------------------------------

/**
 * Inicia el diagnóstico de una Evaluación, o devuelve el que la sesión ya tiene de esa Evaluación (D-49: al recargar sigue la
 * misma pregunta, con el mismo orden de opciones, y las 2 horas no se alargan).
 *
 * - Una cuenta del equipo, una Evaluación que no existe, está inactiva o no tiene preguntas revisadas: `no_disponible`, sin
 *   crear nada ni tocar el diagnóstico en curso de otra Evaluación.
 * - Una pendiente de la misma Evaluación gana aunque la Evaluación ya esté inactiva (tiene sus copias): no se vuelve a leer el
 *   banco ni se llama a `iniciar_diagnostico`.
 * - Si la sesión ya vio todas las preguntas revisadas (el motor no tiene ninguna para elegir): `sin_preguntas`, sin crear ni
 *   descartar nada (D-51). Con `volverATomar` se crea sin excluir las vistas antes y queda marcado repetido; es la única forma
 *   de repetir preguntas (D-49 a), así que con preguntas libres `volverATomar` se ignora.
 */
export async function iniciarDiagnostico(sesion: Sesion, pedido: PedidoDeIniciar, dependencias: Dependencias = {}): Promise<RespuestaDeIniciar> {
  if (esDelEquipo(sesion)) return proyectarNoDisponible("cuenta_del_equipo");
  if (!esUuid(pedido.idEvaluacion)) return proyectarNoDisponible("evaluacion");

  const cliente = dependencias.cliente ?? crearClienteAdmin();
  const idEvaluacion = pedido.idEvaluacion.toLowerCase();
  const volverATomar = pedido.volverATomar === true;
  // Si otra pestaña termina el diagnóstico (o vence) entre la función de la base y la lectura, no hay qué mostrar: se empieza
  // otra vez, una sola vez.
  for (let intento = 1; intento <= 2; intento++) {
    const respuesta = await intentarIniciar(cliente, sesion.idUsuario, idEvaluacion, volverATomar, dependencias.semilla);
    if (respuesta !== null) return respuesta;
  }
  throw new Error("No se pudo iniciar el diagnóstico: el diagnóstico en curso desapareció dos veces seguidas.");
}

/** Un intento de iniciar. `null`: la fila que devolvió la base ya no está al releerla. */
async function intentarIniciar(
  cliente: ClienteDelDiagnostico,
  idUsuario: string,
  idEvaluacion: string,
  volverATomar: boolean,
  semillaFija: number | undefined,
): Promise<RespuestaDeIniciar | null> {
  const pendiente = await leerDiagnosticoEnCurso(cliente, idUsuario);
  if (pendiente !== null && pendiente.fila.id_evaluacion === idEvaluacion) return enCursoDe(pendiente);

  const banco = exigir("banco_de_la_evaluacion", await cliente.rpc("banco_de_la_evaluacion", { p_id_evaluacion: idEvaluacion }));
  if (banco === null) return proyectarNoDisponible("evaluacion");
  const lectura = leerFotoDelBanco(banco);
  if (!lectura.ok) {
    console.error(`[diagnostico] la foto del banco de la Evaluación ${idEvaluacion} no sirve (${lectura.motivo}): ${lectura.detalle}.`);
    return proyectarNoDisponible("evaluacion");
  }
  const { contexto, candidatas } = lectura.foto;
  // Sin candidatas «ya viste todas» sería falso, y volver a tomarlo crearía un diagnóstico vacío.
  if (candidatas.length === 0) return proyectarNoDisponible("evaluacion");

  const vistas = exigir("vistas_de_la_sesion", await cliente.rpc("vistas_de_la_sesion", { p_id_sesion: idUsuario, p_id_evaluacion: idEvaluacion }));
  const antes = vistas?.[0];
  const claves = antes?.claves ?? [];
  const semilla = semillaFija ?? randomInt(0, 2 ** 32);
  const entrada: EntradaMotor = {
    habilidades: contexto.habilidades,
    misconcepciones: contexto.misconcepciones,
    candidatas,
    vistasAntes: claves,
    semilla,
  };

  let vistasAntes = claves;
  let repetido = false;
  if ("terminado" in delMotor(() => siguientePregunta(entrada, []))) {
    if (!volverATomar) return proyectarSinPreguntas(antes?.id_ultimo ?? null);
    if ("terminado" in delMotor(() => siguientePregunta({ ...entrada, vistasAntes: [] }, []))) return proyectarNoDisponible("evaluacion");
    vistasAntes = [];
    repetido = true;
  }

  const iniciada = exigir(
    "iniciar_diagnostico",
    await cliente.rpc("iniciar_diagnostico", {
      p_id_sesion: idUsuario,
      p_id_evaluacion: idEvaluacion,
      p_semilla: semilla,
      p_vistas_antes: vistasAntes,
      p_repetido: repetido,
      p_candidatas: comoJson(candidatas),
      p_contexto: comoJson(contexto),
    }),
  )?.[0];

  switch (iniciada?.resultado) {
    case "creado":
    case "ya_en_curso": {
      // `ya_en_curso`: otra pestaña ganó la carrera, su fila vale y la mía se descarta. En los dos casos se muestra lo que quedó.
      const releida = await leerDiagnosticoEnCurso(cliente, idUsuario);
      return releida !== null && releida.fila.id === iniciada.id ? enCursoDe(releida) : null;
    }
    case "evaluacion_no_disponible":
      return proyectarNoDisponible("evaluacion");
    case "cuenta_del_equipo":
      return proyectarNoDisponible("cuenta_del_equipo");
    default:
      throw new Error("iniciar_diagnostico devolvió un resultado que el servidor no conoce.");
  }
}

// ---------------------------------------------------------------------------
// Responder
// ---------------------------------------------------------------------------

/**
 * Aplica la respuesta a la pregunta pendiente, una sola vez. Se aplica si el diagnóstico es el pedido (`idDiagnostico`), es
 * de la sesión, está en ese `paso` y no ha vencido. Si no (doble clic, dos pestañas, una pestaña vieja, otra Evaluación
 * empezada en otra pestaña, un diagnóstico vencido), no aplica nada y devuelve el estado actual: la letra de una pestaña
 * vieja nunca se califica contra una pregunta que la persona no vio. Con la última pregunta termina el diagnóstico.
 */
export async function responderDiagnostico(
  sesion: Sesion,
  pedido: PedidoDeResponder,
  dependencias: Dependencias = {},
): Promise<RespuestaDeResponder> {
  if (esDelEquipo(sesion)) return proyectarNinguno();

  const cliente = dependencias.cliente ?? crearClienteAdmin();
  const idDiagnostico = esUuid(pedido.idDiagnostico) ? pedido.idDiagnostico.toLowerCase() : null;
  const leido = await leerDiagnosticoEnCurso(cliente, sesion.idUsuario);

  if (
    idDiagnostico !== null &&
    esPasoValido(pedido.paso) &&
    esLetra(pedido.letra) &&
    leido !== null &&
    leido.fila.id === idDiagnostico &&
    leido.fila.paso === pedido.paso
  ) {
    const aplicada = await aplicarRespuesta(cliente, sesion.idUsuario, leido, pedido.letra);
    // Lo leído ya no vale: otra pestaña aplicó, terminó o venció entre la lectura y la escritura.
    if (aplicada !== null) return aplicada;
    return estadoActual(cliente, sesion.idUsuario, idDiagnostico);
  }
  return estadoActual(cliente, sesion.idUsuario, idDiagnostico, leido);
}

/** Guarda la respuesta al paso pendiente. `null`: no se aplicó (otra pestaña llegó antes). */
async function aplicarRespuesta(
  cliente: ClienteDelDiagnostico,
  idUsuario: string,
  leido: EntradaDeLaFila,
  letraElegida: Letra,
): Promise<EnCurso | Terminado | null> {
  const { fila, contexto, entrada, pasos } = leido;
  const pendiente = delMotor(() => siguientePregunta(entrada, pasos));
  if ("terminado" in pendiente) throw new Error(`El diagnóstico en curso ${fila.id} no tiene pregunta pendiente.`);

  // La copia de la pregunta como estaba al mostrarla, con el orden de las opciones y lo que eligió la persona. Los plazos usan
  // la hora de la base: `fecha` es informativa y el motor no la lee.
  const copia: CopiaDePaso = {
    ...candidataDe(entrada, pendiente.clave),
    orden: [...pendiente.orden],
    letraElegida,
    fecha: new Date().toISOString(),
  };
  const nuevos = [...pasos, copia];
  const siguiente = delMotor(() => siguientePregunta(entrada, nuevos));

  if ("terminado" in siguiente) {
    const resultado = delMotor(() => calificar(entrada, nuevos));
    const terminada = exigir(
      "terminar_diagnostico",
      await cliente.rpc("terminar_diagnostico", {
        p_id_sesion: idUsuario,
        p_id: fila.id,
        p_paso: fila.paso,
        p_copia: comoJson(copia),
        p_resultado: comoJson(armarResultadoGuardado(resultado, contexto.descripcionesDeHabilidad)),
        p_falta_material: comoJson(faltaMaterialDe(resultado)),
        p_aciertos: aciertosDe(nuevos),
        p_puntaje: resultado.puntaje,
      }),
    )?.[0];
    if (terminada?.resultado === "terminado" && terminada.id) return proyectarTerminado(terminada.id);
    if (terminada?.resultado === "no_aplicada") return null;
    throw new Error("terminar_diagnostico devolvió un resultado que el servidor no conoce.");
  }

  const aplicada = exigir(
    "responder_diagnostico",
    await cliente.rpc("responder_diagnostico", { p_id_sesion: idUsuario, p_id: fila.id, p_paso: fila.paso, p_copia: comoJson(copia) }),
  );
  if (!aplicada) return null;
  return proyectarEnCurso({
    idDiagnostico: fila.id,
    evaluacion: contexto.evaluacion,
    materia: contexto.materia,
    paso: nuevos.length,
    maximo: delMotor(() => maximoDePreguntas(entrada)),
    pregunta: paraNavegador(candidataDe(entrada, siguiente.clave), siguiente.orden),
  });
}

// ---------------------------------------------------------------------------
// Consultar
// ---------------------------------------------------------------------------

/**
 * El diagnóstico en curso de la sesión, sin crear nada: la pregunta pendiente, o `ninguno` si no hay, venció o es de otra
 * versión del formato. No escribe nada, ni siquiera el vencimiento (`iniciar` y la purga lo borran). Trae la Evaluación y la
 * materia, para el aviso de «Cambiar de materia» de la pantalla (HU-009).
 */
export async function diagnosticoEnCurso(sesion: Sesion, dependencias: Dependencias = {}): Promise<RespuestaDeConsulta> {
  if (esDelEquipo(sesion)) return proyectarNinguno();
  const leido = await leerDiagnosticoEnCurso(dependencias.cliente ?? crearClienteAdmin(), sesion.idUsuario);
  return leido === null ? proyectarNinguno() : enCursoDe(leido);
}
