import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PedidoDeAgendar } from "@/lib/agendar/reglas";
import { agendarMonitoria } from "@/lib/agendar/servidor";
import type { Sesion } from "@/lib/auth/sesion";
import {
  calificar,
  LETRAS,
  maximoDePreguntas,
  mulberry32,
  paraNavegador,
  siguientePregunta,
  type CopiaDePaso,
  type EntradaMotor,
  type Letra,
  type PreguntaCandidata,
} from "@/lib/diagnostico/motor";
import {
  clavesNoPermitidas,
  HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO,
  type EnCurso,
  type Terminado,
} from "@/lib/diagnostico/reglas";
import { diagnosticoEnCurso, iniciarDiagnostico, responderDiagnostico, type ClienteDelDiagnostico } from "@/lib/diagnostico/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/tipos";
import type { Banco, Pregunta } from "../scripts/contenido/modelo.mts";
import {
  activarEvaluacion,
  borrarBancoDePrueba,
  cargarBancoDePrueba,
  CODIGO_A,
  CODIGO_B,
  CODIGO_FISICA_II,
  idDeEvaluacion,
  idDeMateria,
} from "./banco-de-prueba";
import { diaDelNegocio } from "@/lib/fechas";
import { diaIsoDeFecha } from "@/lib/plazos/motor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-081 contra el Supabase LOCAL: el servidor del diagnóstico por su puerta real, las tres operaciones de
 * `src/lib/diagnostico/servidor.ts` (`iniciarDiagnostico`, `responderDiagnostico` y `diagnosticoEnCurso`) con la llave secreta,
 * sobre el banco de ejemplo (`ZZDG-0001` y `ZZDG-0002`, cargado con el cargador real) y sobre Física II del contenido real
 * (`ZZDG-0003`). Una «pestaña» es una llamada concurrente con la misma sesión. Lo que reciben las sesiones por la Data API
 * (criterios 7 y 11) se lee con sesiones de verdad. Las carreras (A.5 del SPEC) van con conexiones `pg` que retienen el
 * candado de la base, como en `integracion/resolver-reportes.test.ts`, porque `Promise.all` puede no cruzarse nunca.
 *
 * El motor se comprueba con su propia salida: la prueba arma la `EntradaMotor` desde el banco leído del disco (no desde lo
 * que guardó la base) y compara pregunta por pregunta lo que ve el navegador. Las respuestas se eligen por el TEXTO de la opción
 * correcta del banco, no por la letra, que depende de la semilla. Las cifras de referencia del ejemplo salen del motor de
 * `main` con el orden de habilidades que da la base (`tema.orden` y luego `clave`: `[cadena, potencia]`).
 *
 * Presupuesto del Auth local (150 sesiones anónimas por hora y 30 inicios con contraseña cada 5 minutos, de toda la suite):
 * las operaciones del módulo reciben un objeto `sesion` y usan la llave secreta, así que casi todo corre con usuarios de la
 * API de administración (`fx.crearUsuario()`), que no gastan ese cupo. Las sesiones de verdad (tres anónimas y tres inicios
 * con contraseña) se crean una sola vez para las pruebas por la Data API.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
/** Cuánto se espera, como máximo, a que una conexión quede bloqueada por otra. */
const ESPERA_MAXIMA = 10_000;

let bd: pg.Client;
let fx: Fixtures;
let ejemplo: Banco;
let fisicaII: Banco | null = null;
/** Las Evaluaciones del ejemplo: `parcial-1` activa por cobertura; `parcial-2` y `examen-final` se activan a mano. */
let parcial1: string;
let parcial2: string;
let examenFinal: string;
let materiaA: string;

/** Las sesiones de esta prueba (usuarios de la API de administración) y los Leads que no creó `Fixtures`. */
let creadas: string[] = [];
let leadsExtra: string[] = [];
/** Todo lo que recibiría el navegador en esta prueba: se revisa al final de cada una. */
let vistos: unknown[] = [];
/** Valores que no pueden aparecer en nada de lo que recibe el navegador, además de los del banco. */
let secretos: string[] = [];

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
});

afterAll(async () => {
  if (!bd) return;
  try {
    await borrarBancoDePrueba(bd);
  } finally {
    await bd.end();
  }
});

/** Cada prueba parte del banco recién cargado: las que lo cambian (borradores, retiradas, Evaluaciones apagadas) no se estorban. */
async function prepararBanco(opciones: { borradores?: boolean; fisicaII?: boolean; cambiosAlEjemplo?: [string, string][] } = {}) {
  const cargados = await cargarBancoDePrueba(bd, opciones);
  ejemplo = cargados.ejemplo;
  fisicaII = cargados.fisicaII;
  parcial1 = await idDeEvaluacion(bd, CODIGO_A, "parcial-1");
  parcial2 = await activarEvaluacion(bd, CODIGO_A, "parcial-2");
  examenFinal = await activarEvaluacion(bd, CODIGO_B, "examen-final");
  materiaA = await idDeMateria(bd, CODIGO_A);
  indexarPreguntas();
}

beforeEach(async () => {
  fx = new Fixtures();
  creadas = [];
  leadsExtra = [];
  vistos = [];
  secretos = [];
  await prepararBanco();
});

afterEach(async () => {
  try {
    exigirNadaSensible();
  } finally {
    try {
      if (leadsExtra.length) {
        await bd.query("delete from public.diagnostico where id_lead = any($1::uuid[])", [leadsExtra]);
        await bd.query("delete from public.lead where id = any($1::uuid[])", [leadsExtra]);
      }
    } finally {
      await fx.limpiar();
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// El banco de prueba como oráculo: las preguntas por enunciado, que es lo que ve el navegador
// ---------------------------------------------------------------------------------------------------------------

type PreguntaConCarpeta = { pregunta: Pregunta; carpeta: string };
let porEnunciado = new Map<string, PreguntaConCarpeta>();

function indexarPreguntas() {
  porEnunciado = new Map();
  for (const banco of [ejemplo, fisicaII]) {
    for (const materia of banco?.materias ?? []) {
      for (const tema of materia.temas) {
        for (const pregunta of tema.preguntas) {
          if (pregunta.estado !== "revisada") continue;
          if (porEnunciado.has(pregunta.enunciado)) throw new Error(`Dos preguntas revisadas con el mismo enunciado: ${pregunta.enunciado}`);
          porEnunciado.set(pregunta.enunciado, { pregunta, carpeta: materia.carpeta });
        }
      }
    }
  }
}

function preguntaMostrada(vista: EnCurso): Pregunta {
  const encontrada = porEnunciado.get(vista.pregunta.enunciado);
  if (!encontrada) throw new Error(`El servidor mostró una pregunta que no está en el banco de prueba: ${vista.pregunta.enunciado}`);
  return encontrada.pregunta;
}

const claveMostrada = (vista: EnCurso) => preguntaMostrada(vista).clave;

/** La letra que ve la persona en la posición de la opción correcta (o la siguiente, para equivocarse), buscándola por su texto. */
function letraDe(vista: EnCurso, cual: "correcta" | "incorrecta"): Letra {
  const correcta = preguntaMostrada(vista).opciones.find((opcion) => opcion.correcta)!.texto;
  const posiciones = vista.pregunta.opciones.flatMap((opcion, i) => (opcion.texto === correcta ? [i] : []));
  if (posiciones.length !== 1) throw new Error(`La opción correcta (${correcta}) debe estar una sola vez entre las que mostró el servidor.`);
  return LETRAS[cual === "correcta" ? posiciones[0] : (posiciones[0] + 1) % LETRAS.length];
}

type Decision = (vista: EnCurso) => Letra;
const acierta: Decision = (vista) => letraDe(vista, "correcta");
const falla: Decision = (vista) => letraDe(vista, "incorrecta");
/** Se equivoca con una opción que trae su propio texto de error (D-14) y, si no hay, con la primera incorrecta. */
const fallaConDetalle: Decision = (vista) => {
  const pregunta = preguntaMostrada(vista);
  const elegida = pregunta.opciones.find((o) => !o.correcta && o.error !== null) ?? pregunta.opciones.find((o) => !o.correcta)!;
  return LETRAS[vista.pregunta.opciones.findIndex((o) => o.texto === elegida.texto)];
};
/** Respuestas fijadas de antemano por la semilla y el paso, no por lo que se muestra: así la prueba y el motor de referencia coinciden. */
function letrasAlAzar(semilla: number): (paso: number) => Letra {
  const azar = mulberry32(semilla * 3 + 1);
  const letras = Array.from({ length: 24 }, () => LETRAS[Math.floor(azar() * LETRAS.length)]);
  return (paso) => letras[paso];
}
function alAzar(semilla: number): Decision {
  const letra = letrasAlAzar(semilla);
  return (vista) => letra(vista.paso);
}

// ---------------------------------------------------------------------------------------------------------------
// Lo que recibiría el navegador
// ---------------------------------------------------------------------------------------------------------------

/** Registra lo que devolvió una operación, tal como lo serializaría una acción, para revisarlo al final de la prueba. */
function ver<T>(respuesta: T): T {
  vistos.push(JSON.parse(JSON.stringify(respuesta)));
  return respuesta;
}

/** Todo lo del banco que nunca llega al navegador: claves, errores, misconcepciones y soluciones, como valores de texto JSON. */
function valoresDelBancoProhibidos(): string[] {
  const valores = new Set<string>();
  for (const banco of [ejemplo, fisicaII]) {
    for (const materia of banco?.materias ?? []) {
      for (const tema of materia.temas) {
        for (const m of tema.misconcepciones) {
          valores.add(JSON.stringify(m.clave));
          valores.add(JSON.stringify(m.descripcion));
        }
        for (const p of tema.preguntas) {
          valores.add(JSON.stringify(p.clave));
          if (p.solucion) valores.add(JSON.stringify(p.solucion));
          for (const o of p.opciones) {
            if (o.error) valores.add(JSON.stringify(o.error));
            if (o.misconcepcion) valores.add(JSON.stringify(o.misconcepcion));
          }
        }
      }
    }
  }
  return [...valores];
}

/** Las claves exactas de cada una de las cinco formas que recibe el navegador (criterio 10). */
const FORMAS: Record<string, string[]> = {
  en_curso: ["estado", "evaluacion", "idDiagnostico", "materia", "maximo", "paso", "pregunta"],
  sin_preguntas: ["estado", "idUltimoDiagnostico"],
  terminado: ["estado", "idDiagnostico"],
  ninguno: ["estado"],
  no_disponible: ["estado", "motivo"],
};

function exigirFormas() {
  for (const visto of vistos as Record<string, unknown>[]) {
    const estado = String(visto.estado);
    expect(Object.keys(FORMAS), `estado ${estado}`).toContain(estado);
    expect(Object.keys(visto).sort(), `forma de ${estado}`).toEqual(FORMAS[estado]);
    if (estado !== "en_curso") continue;
    const { evaluacion, materia, pregunta } = visto as unknown as {
      evaluacion: object;
      materia: object;
      pregunta: { opciones: { letra: string }[] };
    };
    expect(Object.keys(evaluacion).sort()).toEqual(["id", "nombre"]);
    expect(Object.keys(materia).sort()).toEqual(["codigo", "nombre"]);
    expect(Object.keys(pregunta).sort()).toEqual(["enunciado", "opciones"]);
    expect(pregunta.opciones.map((o) => o.letra)).toEqual(["A", "B", "C", "D"]);
    for (const opcion of pregunta.opciones) expect(Object.keys(opcion).sort()).toEqual(["letra", "texto"]);
  }
}

function exigirNadaSensible() {
  exigirFormas();
  expect(clavesNoPermitidas(vistos), "claves que no deberían llegar al navegador").toEqual([]);
  const texto = JSON.stringify(vistos);
  for (const prohibido of [...valoresDelBancoProhibidos(), ...secretos]) {
    expect(texto.includes(prohibido), `llegó al navegador: ${prohibido}`).toBe(false);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Las operaciones y las filas
// ---------------------------------------------------------------------------------------------------------------

async function nuevaSesion(rol: Sesion["rol"] = "anonimo"): Promise<Sesion> {
  const usuario = await fx.crearUsuario();
  creadas.push(usuario.id);
  return { idUsuario: usuario.id, rol };
}

type OpcionesDeIniciar = { volverATomar?: unknown; semilla?: number };

async function iniciar(sesion: Sesion, idEvaluacion: unknown, opciones: OpcionesDeIniciar = {}) {
  const dependencias = opciones.semilla === undefined ? {} : { semilla: opciones.semilla };
  return ver(await iniciarDiagnostico(sesion, { idEvaluacion, volverATomar: opciones.volverATomar as boolean | undefined }, dependencias));
}

async function responder(sesion: Sesion, vista: Pick<EnCurso, "idDiagnostico" | "paso">, letra: unknown) {
  return ver(await responderDiagnostico(sesion, { idDiagnostico: vista.idDiagnostico, paso: vista.paso, letra }));
}

const consultar = async (sesion: Sesion) => ver(await diagnosticoEnCurso(sesion));

function exigirEnCurso(respuesta: { estado: string }): EnCurso {
  expect(respuesta.estado).toBe("en_curso");
  return respuesta as EnCurso;
}

async function enCursoDe(idSesion: string) {
  const filas = exito(await fx.admin.from("diagnostico_en_curso").select("*").eq("id_sesion", idSesion), "leer el diagnóstico en curso");
  expect(filas.length).toBeLessThanOrEqual(1);
  return filas[0] ?? null;
}

async function diagnosticosDe(idSesion: string) {
  return exito(await fx.admin.from("diagnostico").select("*").eq("id_sesion_anonima", idSesion).order("fecha_realizacion").order("id"), "leer los diagnósticos");
}

async function contarEnCurso(): Promise<number> {
  const { rows } = await bd.query<{ n: number }>(
    "select count(*)::int as n from public.diagnostico_en_curso where id_sesion = any($1::uuid[])",
    [creadas],
  );
  return rows[0].n;
}

/** Hace envejecer el diagnóstico en curso de una sesión: su última respuesta fue hace ese tiempo. */
async function envejecer(idSesion: string, milisegundos: number) {
  const { rowCount } = await bd.query(
    "update public.diagnostico_en_curso set actualizado_en = now() - ($2::bigint * interval '1 millisecond') where id_sesion = $1",
    [idSesion, milisegundos],
  );
  expect(rowCount).toBe(1);
}

/** Una copia de un paso, como la guardan `diagnostico_en_curso.pasos` y `diagnostico.respuestas`. */
type CopiaGuardada = PreguntaCandidata & { orden: Letra[]; letraElegida: Letra; fecha: string };
const copiasDe = (json: unknown) => json as CopiaGuardada[];

type Corrida = { primera: EnCurso; vistas: EnCurso[]; fin: Terminado; claves: string[] };

/** Un diagnóstico ya empezado, de principio a fin por las operaciones reales. Falla si no termina en `terminado`. */
async function completar(sesion: Sesion, primera: EnCurso, decidir: Decision): Promise<Corrida> {
  const vistas: EnCurso[] = [primera];
  let respuesta = await responder(sesion, primera, decidir(primera));
  while (respuesta.estado === "en_curso") {
    expect(respuesta.paso).toBe(vistas.length);
    vistas.push(respuesta);
    respuesta = await responder(sesion, respuesta, decidir(respuesta));
  }
  expect(respuesta.estado).toBe("terminado");
  return { primera, vistas, fin: respuesta as Terminado, claves: vistas.map(claveMostrada) };
}

/** Empieza un diagnóstico y lo termina. */
async function correr(sesion: Sesion, idEvaluacion: string, decidir: Decision, opciones: OpcionesDeIniciar = {}): Promise<Corrida> {
  return completar(sesion, exigirEnCurso(await iniciar(sesion, idEvaluacion, opciones)), decidir);
}

/**
 * Responde con las letras al azar de `semilla` hasta quedar en la última pregunta (la que, al responderla, termina el
 * diagnóstico) de `parcial-1`. El largo sale del motor puro con las mismas respuestas.
 */
async function hastaLaUltima(sesion: Sesion, semilla: number, vistasAntes: string[] = []): Promise<EnCurso> {
  const letra = letrasAlAzar(semilla);
  const total = correrReferencia(entradaDeReferencia(ejemplo, "materia-a", "parcial-1", vistasAntes, semilla), letra).mostradas.length;
  let vista = exigirEnCurso(await iniciar(sesion, parcial1, { semilla }));
  for (let i = 1; i < total; i++) vista = exigirEnCurso(await responder(sesion, vista, letra(vista.paso)));
  expect(vista.paso).toBe(total - 1);
  return vista;
}

// ---------------------------------------------------------------------------------------------------------------
// El motor puro como referencia: la entrada se arma desde el banco leído del disco
// ---------------------------------------------------------------------------------------------------------------

const porClave = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * La `EntradaMotor` que arma el servidor, pero desde el banco en memoria y no desde la foto de la base. El orden de las
 * habilidades es el de la base (`tema.orden` y luego `clave`: el cargador no guarda el de archivo), `materia` de un prerrequisito es
 * el nombre de la otra materia y su `descripcion` la de la habilidad destino.
 */
function entradaDeReferencia(banco: Banco, carpeta: string, evaluacion: string, vistasAntes: string[], semilla: number): EntradaMotor {
  const materia = banco.materias.find((m) => m.carpeta === carpeta);
  const clave = materia?.evaluaciones.find((e) => e.clave === evaluacion);
  if (!materia || !clave) throw new Error(`No encontré ${carpeta}/${evaluacion} en el banco.`);
  const habilidadDe = (carpetaDe: string | null, nombre: string) =>
    banco.materias.find((m) => m.carpeta === (carpetaDe ?? carpeta))?.temas.flatMap((t) => t.habilidades).find((h) => h.clave === nombre);

  const temas = [...materia.temas].filter((t) => clave.temas.includes(t.clave)).sort((a, b) => a.orden - b.orden);
  const habilidades = temas.flatMap((t) =>
    [...t.habilidades]
      .sort((a, b) => porClave(a.clave, b.clave))
      .map((h) => ({
        clave: h.clave,
        descripcion: h.descripcion,
        prerrequisitos: h.prerrequisitos
          .map((p) => ({
            materia: p.materia === null ? null : (banco.materias.find((m) => m.carpeta === p.materia)?.nombre ?? null),
            habilidad: p.clave,
            descripcion: habilidadDe(p.materia, p.clave)?.descripcion ?? p.clave,
          }))
          .sort((a, b) => porClave(a.materia ?? "", b.materia ?? "") || porClave(a.habilidad, b.habilidad)),
      })),
  );
  const delaEvaluacion = new Set(habilidades.map((h) => h.clave));
  const candidatas: PreguntaCandidata[] = materia.temas
    .flatMap((t) =>
      t.preguntas
        .filter((p) => p.estado === "revisada" && p.habilidades.some((h) => delaEvaluacion.has(h)))
        .map((p) => ({
          clave: p.clave,
          tema: t.clave,
          enunciado: p.enunciado,
          opciones: p.opciones.map((o) => ({ texto: o.texto, correcta: o.correcta, misconcepcion: o.misconcepcion, error: o.error })),
          dificultad: p.dificultad,
          habilidades: [...p.habilidades].sort(porClave),
          solucion: p.solucion,
        })),
    )
    .sort((a, b) => porClave(a.clave, b.clave));
  const misconcepciones = materia.temas
    .flatMap((t) => t.misconcepciones)
    .map((m) => ({ clave: m.clave, habilidad: m.habilidad, descripcion: m.descripcion }))
    .sort((a, b) => porClave(a.clave, b.clave));
  return { habilidades, misconcepciones, candidatas, vistasAntes, semilla };
}

type PasoDeReferencia = { clave: string; pregunta: ReturnType<typeof paraNavegador>; copia: CopiaDePaso };
/** Qué letra (de las que ve la persona) elige en un paso: la del paso, o según la pregunta y el orden en que se muestran las opciones. */
type DecisionDeReferencia = (paso: number, candidata: PreguntaCandidata, orden: readonly Letra[]) => Letra;

const posicionDeLaCorrecta = (candidata: PreguntaCandidata, orden: readonly Letra[]) =>
  orden.findIndex((letra) => candidata.opciones[LETRAS.indexOf(letra)].correcta);
const refAcierta: DecisionDeReferencia = (_paso, candidata, orden) => LETRAS[posicionDeLaCorrecta(candidata, orden)];
const refFalla: DecisionDeReferencia = (_paso, candidata, orden) => LETRAS[(posicionDeLaCorrecta(candidata, orden) + 1) % LETRAS.length];

/** Lo que haría el motor puro con esas respuestas: las preguntas que mostraría y lo que calificaría. */
function correrReferencia(entrada: EntradaMotor, decidir: DecisionDeReferencia | ((paso: number) => Letra)) {
  const pasos: CopiaDePaso[] = [];
  const mostradas: PasoDeReferencia[] = [];
  for (;;) {
    const siguiente = siguientePregunta(entrada, pasos);
    if ("terminado" in siguiente) break;
    const candidata = entrada.candidatas.find((c) => c.clave === siguiente.clave)!;
    const copia: CopiaDePaso = {
      ...candidata,
      orden: siguiente.orden,
      letraElegida: decidir(pasos.length, candidata, siguiente.orden),
      fecha: "2026-10-05T00:00:00.000Z",
    };
    mostradas.push({ clave: candidata.clave, pregunta: paraNavegador(candidata, siguiente.orden), copia });
    pasos.push(copia);
  }
  return { mostradas, pasos, resultado: calificar(entrada, pasos), maximo: maximoDePreguntas(entrada) };
}

/** Lo que debe quedar en `resultado_por_habilidad`: el resultado del motor con los nombres legibles y sin la marca de falta de material. */
function resultadoEsperado(resultado: ReturnType<typeof calificar>, descripcionDe: (habilidad: string) => string) {
  return {
    habilidades: resultado.habilidades.map((h) => ({ habilidad: h.habilidad, descripcion: h.descripcion, nivel: h.nivel, respuestas: h.respuestas, aciertos: h.aciertos })),
    errores: resultado.errores.map((e) => ({
      misconcepcion: e.misconcepcion,
      habilidad: e.habilidad,
      descripcionHabilidad: descripcionDe(e.habilidad),
      texto: e.texto,
      estado: e.estado,
      veces: e.veces,
      detalles: e.detalles,
    })),
    prerrequisitos: resultado.prerrequisitos.map((p) => ({ materia: p.materia, habilidad: p.habilidad, descripcion: p.descripcion })),
  };
}

/** La descripción de una habilidad de una materia del banco en memoria. */
function descripcionDeHabilidad(banco: Banco, carpeta: string) {
  const habilidades = banco.materias.find((m) => m.carpeta === carpeta)!.temas.flatMap((t) => t.habilidades);
  return (clave: string) => habilidades.find((h) => h.clave === clave)?.descripcion ?? clave;
}

/** Las habilidades con marca de falta de material que calculó el motor, como las guarda `diagnostico.falta_material`. */
const faltaMaterialEsperada = (resultado: ReturnType<typeof calificar>) =>
  resultado.habilidades.filter((h) => h.faltaMaterial.length > 0).map((h) => ({ habilidad: h.habilidad, motivos: h.faltaMaterial }));

/** Una semilla y un paso del ejemplo donde contestar bien o mal lleva a preguntas distintas (la que sigue depende de la respuesta). */
function buscarBifurcacion(): { semilla: number; paso: number } {
  for (let semilla = 1; semilla <= 60; semilla++) {
    const entrada = entradaDeReferencia(ejemplo, "materia-a", "parcial-1", [], semilla);
    const pasos: CopiaDePaso[] = [];
    for (;;) {
      const actual = siguientePregunta(entrada, pasos);
      if ("terminado" in actual) break;
      const candidata = entrada.candidatas.find((c) => c.clave === actual.clave)!;
      const con = (decidir: DecisionDeReferencia): CopiaDePaso => ({
        ...candidata,
        orden: actual.orden,
        letraElegida: decidir(pasos.length, candidata, actual.orden),
        fecha: "2026-10-05T00:00:00.000Z",
      });
      const bien = siguientePregunta(entrada, [...pasos, con(refAcierta)]);
      const mal = siguientePregunta(entrada, [...pasos, con(refFalla)]);
      if (!("terminado" in bien) && !("terminado" in mal) && bien.clave !== mal.clave) return { semilla, paso: pasos.length };
      pasos.push(con(refAcierta));
    }
  }
  throw new Error("El ejemplo no tiene ninguna semilla con un paso donde la respuesta cambie la pregunta que sigue.");
}

// ---------------------------------------------------------------------------------------------------------------
// Criterio 1: iniciar
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 1: iniciar el diagnóstico de una Evaluación activa", () => {
  it("crea el en curso con la semilla, las candidatas revisadas, las vistas vacías y devuelve la primera pregunta", async () => {
    await prepararBanco({ borradores: true });
    const sesion = await nuevaSesion();
    // Con --borradores el borrador P7 (cadena) y P9 (antiderivada) están en la base: la foto no los trae.
    const { rows: [conteo] } = await bd.query<{ borradores: number }>(
      "select count(*)::int as borradores from public.pregunta where estado = 'borrador' and id_materia = $1",
      [materiaA],
    );
    expect(conteo.borradores).toBe(2);

    const respuesta = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));

    const fila = (await enCursoDe(sesion.idUsuario))!;
    expect(fila).toMatchObject({
      id: respuesta.idDiagnostico,
      id_evaluacion: parcial1,
      id_materia: materiaA,
      semilla: 1,
      vistas_antes: [],
      repetido: false,
      pasos: [],
      paso: 0,
    });
    const candidatas = fila.candidatas as { clave: string; opciones: unknown[] }[];
    expect(candidatas.map((c) => c.clave)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(candidatas.every((c) => c.opciones.length === 4)).toBe(true);
    expect(fila.contexto).toMatchObject({
      version: 1,
      evaluacion: { id: parcial1, nombre: "Parcial 1" },
      materia: { id: materiaA, codigo: CODIGO_A, nombre: "Materia de prueba A" },
    });

    // Lo que ve la persona: la Evaluación, la materia, el paso 0 de hasta 4, y la pregunta que el motor puro elige con esa semilla.
    const referencia = correrReferencia(entradaDeReferencia(ejemplo, "materia-a", "parcial-1", [], 1), (): Letra => "A");
    expect(respuesta).toEqual({
      estado: "en_curso",
      idDiagnostico: fila.id,
      evaluacion: { id: parcial1, nombre: "Parcial 1" },
      materia: { codigo: CODIGO_A, nombre: "Materia de prueba A" },
      paso: 0,
      maximo: 4,
      pregunta: referencia.mostradas[0].pregunta,
    });
    expect(claveMostrada(respuesta)).toBe("P3");
    expect(respuesta.pregunta.opciones.map((o) => o.letra)).toEqual(["A", "B", "C", "D"]);
  });

  it("la semilla por defecto sale de crypto: entera, de 32 bits sin signo (también por encima de 2^31) y distinta entre inicios", async () => {
    const sesion = await nuevaSesion();
    const semillas: number[] = [];
    for (let i = 0; i < 40; i++) {
      exigirEnCurso(await iniciar(sesion, parcial1));
      const { semilla } = (await enCursoDe(sesion.idUsuario))!;
      expect(Number.isInteger(semilla) && semilla >= 0 && semilla <= 4_294_967_295, `semilla ${semilla}`).toBe(true);
      semillas.push(semilla);
      await bd.query("delete from public.diagnostico_en_curso where id_sesion = $1", [sesion.idUsuario]);
    }
    expect(new Set(semillas).size).toBeGreaterThanOrEqual(39);
    // Con 40 semillas uniformes en 32 bits, que ninguna pase de 2^31 (o que todas pasen) tiene una probabilidad de 2^-40.
    expect(Math.max(...semillas)).toBeGreaterThan(2 ** 31);
    expect(Math.min(...semillas)).toBeLessThan(2 ** 31);
  });

  it("una Evaluación inactiva, inexistente o un id mal formado: no_disponible y no se crea nada", async () => {
    const sesion = await nuevaSesion();
    await bd.query("update public.evaluacion set activa = false where id = $1", [parcial2]);
    const inexistente = randomUUID();
    for (const idEvaluacion of [parcial2, inexistente, "no-es-un-uuid", `${parcial1} `, "", undefined, null, 7, {}]) {
      expect(await iniciar(sesion, idEvaluacion)).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    }
    expect(await enCursoDe(sesion.idUsuario)).toBeNull();
    expect(await diagnosticosDe(sesion.idUsuario)).toEqual([]);
  });

  it("pedir una Evaluación que no existe no toca el diagnóstico en curso de otra", async () => {
    const sesion = await nuevaSesion();
    exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 5 }));
    const antes = await enCursoDe(sesion.idUsuario);
    await bd.query("update public.evaluacion set activa = false where id = $1", [parcial2]);

    expect(await iniciar(sesion, parcial2)).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(await iniciar(sesion, randomUUID())).toEqual({ estado: "no_disponible", motivo: "evaluacion" });

    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
  });

  it("una Evaluación sin ninguna pregunta revisada es no_disponible, no sin_preguntas", async () => {
    const sesion = await nuevaSesion();
    await bd.query("update public.pregunta set estado = 'retirada' where id_materia = $1", [materiaA]);

    expect(await iniciar(sesion, parcial1)).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(await iniciar(sesion, parcial1, { volverATomar: true })).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(await enCursoDe(sesion.idUsuario)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 2: recargar
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 2: al recargar sigue la misma pregunta; con otra Evaluación empieza uno nuevo (D-49)", () => {
  it("iniciar la misma Evaluación devuelve la misma pregunta con las opciones en el mismo orden, sin tocar la semilla ni las 2 horas", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 7 }));
    const antes = await enCursoDe(sesion.idUsuario);

    // Otra semilla en la petición no cambia nada: la pendiente gana, con la que ya tenía.
    const recargada = await iniciar(sesion, parcial1, { semilla: 99 });

    expect(recargada).toEqual(primera);
    expect(JSON.stringify(recargada)).toBe(JSON.stringify(primera));
    expect(await consultar(sesion)).toEqual(primera);
    // Ni `actualizado_en` (recargar no alarga las 2 horas) ni la semilla ni nada de la fila.
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
    expect(antes!.semilla).toBe(7);
  });

  it("después de responder, recargar muestra la pregunta del paso siguiente", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 7 }));
    const segunda = exigirEnCurso(await responder(sesion, primera, acierta(primera)));

    expect(segunda.paso).toBe(1);
    expect(segunda.idDiagnostico).toBe(primera.idDiagnostico);
    expect(segunda.pregunta).not.toEqual(primera.pregunta);
    expect(await iniciar(sesion, parcial1)).toEqual(segunda);
    expect(await consultar(sesion)).toEqual(segunda);
  });

  it("con otra Evaluación el anterior se descarta y empieza uno nuevo: a lo sumo uno por sesión", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 7 }));
    exigirEnCurso(await responder(sesion, primera, acierta(primera)));

    const nueva = exigirEnCurso(await iniciar(sesion, parcial2, { semilla: 8 }));

    expect(nueva.idDiagnostico).not.toBe(primera.idDiagnostico);
    expect(nueva.evaluacion).toEqual({ id: parcial2, nombre: "Parcial 2" });
    // parcial-2 es acumulativa: mide potencia, cadena y antiderivada, con P1 a P5 y P8 de candidatas.
    expect(nueva.paso).toBe(0);
    expect(nueva.maximo).toBe(maximoDePreguntas(entradaDeReferencia(ejemplo, "materia-a", "parcial-2", [], 8)));
    expect(nueva.maximo).toBe(6);
    expect(await contarEnCurso()).toBe(1);
    const fila = (await enCursoDe(sesion.idUsuario))!;
    expect(fila).toMatchObject({ id: nueva.idDiagnostico, id_evaluacion: parcial2, paso: 0, pasos: [], semilla: 8 });
    expect((fila.candidatas as { clave: string }[]).map((c) => c.clave)).toEqual(["P1", "P2", "P3", "P4", "P5", "P8"]);
    const { rows } = await bd.query("select 1 from public.diagnostico_en_curso where id = $1", [primera.idDiagnostico]);
    expect(rows).toEqual([]);
  });

  it("dos pestañas que inician la misma Evaluación a la vez: una sola fila y la misma pregunta en las dos", async () => {
    const sesion = await nuevaSesion();

    const [una, otra] = await Promise.all([iniciar(sesion, parcial1), iniciar(sesion, parcial1)]);

    expect(una).toEqual(otra);
    expect(await contarEnCurso()).toBe(1);
    expect((await enCursoDe(sesion.idUsuario))!.id).toBe(exigirEnCurso(una).idDiagnostico);
  });

  it("dos pestañas que inician Evaluaciones distintas a la vez: queda una fila, la de una de las dos", async () => {
    const sesion = await nuevaSesion();

    const resultados = await Promise.allSettled([iniciar(sesion, parcial1), iniciar(sesion, parcial2)]);

    // Si cada una desaparece de la otra dos veces seguidas, la base queda bien y la pestaña que no pudo recibe un error genérico.
    for (const resultado of resultados) {
      if (resultado.status === "rejected") expect(String(resultado.reason)).toContain("desapareció dos veces seguidas");
    }
    expect(resultados.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await contarEnCurso()).toBe(1);
    const fila = (await enCursoDe(sesion.idUsuario))!;
    const recibidos = resultados.flatMap((r) => (r.status === "fulfilled" ? [exigirEnCurso(r.value)] : []));
    // La que ganó recibe el id que quedó; la que perdió pudo leer el suyo antes de que lo reemplazaran: ese id queda viejo.
    expect(recibidos.map((r) => r.idDiagnostico)).toContain(fila.id);
    for (const vista of recibidos) {
      if (vista.idDiagnostico === fila.id) continue;
      const actual = exigirEnCurso(await consultar(sesion));
      expect(await responder(sesion, vista, "A")).toEqual(actual);
      expect(await enCursoDe(sesion.idUsuario)).toEqual(fila);
    }
  });

  it("si la Evaluación se desactiva a mitad, la pendiente sigue (tiene sus preguntas guardadas); y pedir otra inactiva no la descarta", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 3 }));
    await bd.query("update public.evaluacion set activa = false where id = any($1::uuid[])", [[parcial1, parcial2]]);

    expect(await iniciar(sesion, parcial1)).toEqual(primera);
    expect(await consultar(sesion)).toEqual(primera);
    const segunda = exigirEnCurso(await responder(sesion, primera, acierta(primera)));
    expect(segunda.paso).toBe(1);
    // Otra Evaluación inactiva: no_disponible y la pendiente queda como estaba.
    expect(await iniciar(sesion, parcial2)).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(await consultar(sesion)).toEqual(segunda);
  });

  it("con otro formato de la foto el en curso se trata como inexistente: consultar da ninguno e iniciar lo reemplaza", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 3 }));
    await bd.query("update public.diagnostico_en_curso set contexto = jsonb_set(contexto, '{version}', '2') where id_sesion = $1", [sesion.idUsuario]);

    expect(await consultar(sesion)).toEqual({ estado: "ninguno" });
    expect(await responder(sesion, primera, "A")).toEqual({ estado: "ninguno" });
    const nueva = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 4 }));

    expect(nueva.idDiagnostico).not.toBe(primera.idDiagnostico);
    expect(await contarEnCurso()).toBe(1);
    expect((await enCursoDe(sesion.idUsuario))!.contexto).toMatchObject({ version: 1 });
  });

  it("editar o retirar preguntas del banco a mitad de un diagnóstico no cambia la pregunta pendiente ni lo ya respondido (HU-061)", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    const segunda = exigirEnCurso(await responder(sesion, primera, acierta(primera)));

    // Alguien recarga el banco: las preguntas cambian de enunciado y de texto en sus opciones, y se retiran.
    await bd.query("update public.pregunta set enunciado = 'ZZ editada en la base', estado = 'retirada' where id_materia = $1", [materiaA]);
    await bd.query("update public.opcion set texto = 'ZZ otra opción ' || letra where id_materia = $1", [materiaA]);

    expect(await iniciar(sesion, parcial1)).toEqual(segunda);
    expect(await consultar(sesion)).toEqual(segunda);
    // Se puede seguir hasta el final con lo que la persona vio.
    let respuesta: { estado: string } = await responder(sesion, segunda, acierta(segunda));
    while (respuesta.estado === "en_curso") respuesta = await responder(sesion, respuesta as EnCurso, acierta(respuesta as EnCurso));
    expect(respuesta.estado).toBe("terminado");
    const [diagnostico] = await diagnosticosDe(sesion.idUsuario);
    expect(JSON.stringify(diagnostico.respuestas)).not.toContain("ZZ editada");
    expect(JSON.stringify(diagnostico.respuestas)).not.toContain("ZZ otra opción");
    expect(diagnostico.puntaje).toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Otra pestaña entre la función de la base y la lectura de iniciar (5.5, paso 7)
// ---------------------------------------------------------------------------------------------------------------

/**
 * El cliente de la llave secreta con un gancho que corre justo después de cada función de la base: así una prueba hace lo que haría
 * otra pestaña en el hueco entre `iniciar_diagnostico` y la lectura que le sigue, sin depender de que dos llamadas se crucen.
 */
function clienteConGancho(
  despuesDe: (funcion: string, llamada: number) => Promise<void>,
  cambiarArgumentos: (funcion: string, argumentos?: object) => object | undefined = (_funcion, argumentos) => argumentos,
) {
  const real = crearClienteAdmin();
  const llamadas: Record<string, number> = {};
  const rpc = real.rpc as unknown as (funcion: string, argumentos?: object) => PromiseLike<unknown>;
  const cliente = {
    from: real.from.bind(real),
    rpc: async (funcion: string, argumentos?: object) => {
      const respuesta = await rpc.call(real, funcion, cambiarArgumentos(funcion, argumentos));
      llamadas[funcion] = (llamadas[funcion] ?? 0) + 1;
      await despuesDe(funcion, llamadas[funcion]);
      return respuesta;
    },
  } as unknown as ClienteDelDiagnostico;
  return { cliente, llamadas };
}

describe("el módulo frente a un error de la base y a otra pestaña que se mete entre la función de la base y la lectura de iniciar (5.5 y 5.8)", () => {
  it("un error real de la base no deja la fila, la semilla ni la solución en el mensaje que lanza el módulo (5.8)", async () => {
    const sesion = await nuevaSesion();
    const ultima = await hastaLaUltima(sesion, 27_182_818);
    const antes = (await enCursoDe(sesion.idUsuario))!;
    // La respuesta final llega con unos aciertos imposibles: el INSERT viola un check y PostgREST trae en `details` la fila completa.
    const { cliente } = clienteConGancho(
      async () => {},
      (funcion, argumentos) => (funcion === "terminar_diagnostico" ? { ...argumentos, p_aciertos: 99 } : argumentos),
    );

    const fallo = await responderDiagnostico(sesion, { idDiagnostico: ultima.idDiagnostico, paso: ultima.paso, letra: acierta(ultima) }, { cliente }).then(
      () => null,
      (error: unknown) => error,
    );

    // Lo que habría salido sin cuidado: el error de PostgREST con la fila (semilla, copias con la correcta y la solución).
    const crudo = await fx.admin.rpc("terminar_diagnostico", {
      p_id_sesion: sesion.idUsuario,
      p_id: antes.id,
      p_paso: antes.paso,
      p_copia: { clave: "P1" },
      p_resultado: { habilidades: [], errores: [], prerrequisitos: [] },
      p_falta_material: [],
      p_aciertos: 99,
      p_puntaje: 0,
    });
    expect(crudo.error?.code).toBe("23514");
    expect(JSON.stringify(crudo.error)).toContain(String(antes.semilla));

    expect(fallo).toBeInstanceOf(Error);
    expect((fallo as Error).message).toBe("Falló «terminar_diagnostico» en el servidor del diagnóstico (código 23514).");
    expect((fallo as Error).message).not.toMatch(/Failing row|violates|candidatas|"correcta"|olvida-interna/);
    expect(antes.semilla).toBe(27_182_818);
    expect((fallo as Error).message).not.toContain("27182818");
    // No se aplicó nada.
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
    expect(await diagnosticosDe(sesion.idUsuario)).toEqual([]);
  });

  it("si el diagnóstico recién creado desaparece (otra pestaña lo terminó o venció), iniciar vuelve a empezar una vez y devuelve el nuevo", async () => {
    const sesion = await nuevaSesion();
    const { cliente, llamadas } = clienteConGancho(async (funcion, llamada) => {
      if (funcion === "iniciar_diagnostico" && llamada === 1) await bd.query("delete from public.diagnostico_en_curso where id_sesion = $1", [sesion.idUsuario]);
    });

    const respuesta = exigirEnCurso(ver(await iniciarDiagnostico(sesion, { idEvaluacion: parcial1 }, { cliente, semilla: 4 })));

    expect(llamadas.iniciar_diagnostico).toBe(2);
    expect(await contarEnCurso()).toBe(1);
    expect((await enCursoDe(sesion.idUsuario))!.id).toBe(respuesta.idDiagnostico);
  });

  it("si desaparece las dos veces, lanza un error genérico después de exactamente dos intentos y no deja nada creado", async () => {
    const sesion = await nuevaSesion();
    const { cliente, llamadas } = clienteConGancho(async (funcion) => {
      if (funcion === "iniciar_diagnostico") await bd.query("delete from public.diagnostico_en_curso where id_sesion = $1", [sesion.idUsuario]);
    });

    await expect(iniciarDiagnostico(sesion, { idEvaluacion: parcial1 }, { cliente, semilla: 4 })).rejects.toThrow(/desapareció dos veces seguidas/);

    expect(llamadas.iniciar_diagnostico).toBe(2);
    expect(await contarEnCurso()).toBe(0);
  });

  it("si otra pestaña lo reemplazó por otra Evaluación en ese hueco, iniciar no muestra la de esa pestaña: crea la que pidió", async () => {
    const sesion = await nuevaSesion();
    const { cliente, llamadas } = clienteConGancho(async (funcion, llamada) => {
      if (funcion === "iniciar_diagnostico" && llamada === 1) {
        expect(await iniciarDiagnostico(sesion, { idEvaluacion: parcial2 }, { semilla: 9 })).toMatchObject({ estado: "en_curso" });
      }
    });

    const respuesta = exigirEnCurso(ver(await iniciarDiagnostico(sesion, { idEvaluacion: parcial1 }, { cliente, semilla: 4 })));

    expect(llamadas.iniciar_diagnostico).toBe(2);
    expect(respuesta.evaluacion.id).toBe(parcial1);
    expect(await contarEnCurso()).toBe(1);
    expect(await enCursoDe(sesion.idUsuario)).toMatchObject({ id: respuesta.idDiagnostico, id_evaluacion: parcial1 });
  });

  it("si otra pestaña lo reemplaza entre la lectura y la escritura de responder, la respuesta con el id viejo no se aplica al diagnóstico nuevo", async () => {
    const sesion = await nuevaSesion();
    const vieja = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    let nueva: EnCurso | null = null;
    const { cliente, llamadas } = clienteConGancho(async (funcion, llamada) => {
      // Justo después de que el módulo leyó el diagnóstico viejo, otra pestaña empieza otra Evaluación.
      if (funcion === "diagnostico_en_curso_de" && llamada === 1) nueva = exigirEnCurso(await iniciarDiagnostico(sesion, { idEvaluacion: parcial2 }, { semilla: 2 }));
    });

    const respuesta = ver(await responderDiagnostico(sesion, { idDiagnostico: vieja.idDiagnostico, paso: 0, letra: acierta(vieja) }, { cliente }));

    // La escritura llegó a la base con el id viejo (el módulo lo había visto vigente) y la base no la aplicó.
    expect(nueva).not.toBeNull();
    expect(llamadas.responder_diagnostico).toBe(1);
    expect(respuesta).toEqual(nueva);
    expect(await enCursoDe(sesion.idUsuario)).toMatchObject({ id: nueva!.idDiagnostico, id_evaluacion: parcial2, paso: 0, pasos: [] });
  });

  it("la base sola: iniciar_diagnostico con una Evaluación inactiva no borra el diagnóstico de otra, y con la misma devuelve el vigente sin tocarlo", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    const antes = await enCursoDe(sesion.idUsuario);
    const llamar = (idEvaluacion: string) =>
      fx.admin.rpc("iniciar_diagnostico", {
        p_id_sesion: sesion.idUsuario,
        p_id_evaluacion: idEvaluacion,
        p_semilla: 99,
        p_vistas_antes: ["P1"],
        p_repetido: true,
        p_candidatas: [],
        p_contexto: { version: 1 },
      });

    // Otra Evaluación inactiva o inexistente: no_disponible y el vigente de la otra queda como estaba (se comprueba antes de borrar).
    await bd.query("update public.evaluacion set activa = false where id = $1", [parcial2]);
    for (const idEvaluacion of [parcial2, randomUUID()]) {
      const { data, error } = await llamar(idEvaluacion);
      expect(error).toBeNull();
      expect(data).toEqual([{ resultado: "evaluacion_no_disponible", id: null }]);
      expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
    }

    // La misma Evaluación: ya_en_curso con el id vigente, sin tocar la semilla ni las 2 horas, aunque lleguen otros parámetros...
    const misma = await llamar(parcial1);
    expect(misma.data).toEqual([{ resultado: "ya_en_curso", id: primera.idDiagnostico }]);
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
    // ... y aunque la Evaluación ya esté inactiva: gana la pendiente.
    await bd.query("update public.evaluacion set activa = false where id = $1", [parcial1]);
    const inactiva = await llamar(parcial1);
    expect(inactiva.data).toEqual([{ resultado: "ya_en_curso", id: primera.idDiagnostico }]);
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
    // Con otra versión de la foto no es la misma: se reemplaza (la Evaluación activa de nuevo).
    await bd.query("update public.evaluacion set activa = true where id = $1", [parcial1]);
    const otraVersion = await fx.admin.rpc("iniciar_diagnostico", {
      p_id_sesion: sesion.idUsuario,
      p_id_evaluacion: parcial1,
      p_semilla: 99,
      p_vistas_antes: [],
      p_repetido: false,
      p_candidatas: [],
      p_contexto: { version: 2 },
    });
    expect(otraVersion.data).toEqual([{ resultado: "creado", id: expect.any(String) }]);
    expect(otraVersion.data![0].id).not.toBe(primera.idDiagnostico);
    expect(await contarEnCurso()).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 3: responder
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 3: una respuesta se aplica una sola vez; la repetida o la vieja devuelve el estado actual", () => {
  it("responder el paso pendiente guarda una copia con el orden de las opciones y la letra que vio la persona", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    const letra = letraDe(primera, "incorrecta");

    const segunda = exigirEnCurso(await responder(sesion, primera, letra));

    expect(segunda).toMatchObject({ idDiagnostico: primera.idDiagnostico, paso: 1 });
    const fila = (await enCursoDe(sesion.idUsuario))!;
    expect(fila.paso).toBe(1);
    const copias = copiasDe(fila.pasos);
    expect(copias).toHaveLength(1);
    expect(copias[0]).toMatchObject({ clave: claveMostrada(primera), letraElegida: letra });
    expect([...copias[0].orden].sort()).toEqual(["A", "B", "C", "D"]);
    expect(copias[0].opciones).toHaveLength(4);
    expect(Number.isNaN(Date.parse(copias[0].fecha))).toBe(false);
    // El orden guardado es el que vio la persona: la opción de la posición `letra` es la que dice la copia.
    const elegida = copias[0].opciones[LETRAS.indexOf(copias[0].orden[LETRAS.indexOf(letra)])];
    expect(elegida.correcta).toBe(false);
    expect(elegida.texto).toBe(primera.pregunta.opciones[LETRAS.indexOf(letra)].texto);
  });

  it("repetir la respuesta con el paso viejo no aplica nada y devuelve la pregunta pendiente", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    const segunda = exigirEnCurso(await responder(sesion, primera, "A"));
    const antes = await enCursoDe(sesion.idUsuario);

    // Doble clic, o una pestaña que no se enteró: mismo paso 0, otra letra.
    expect(await responder(sesion, primera, "C")).toEqual(segunda);
    expect(await responder(sesion, primera, "A")).toEqual(segunda);

    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
    expect(antes!.paso).toBe(1);
  });

  it("un paso adelantado, una letra que no es de la A a la D, un paso que no es un entero o un id mal formado no aplican nada y no lanzan", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    const antes = await enCursoDe(sesion.idUsuario);
    const pedido = (parcial: Record<string, unknown>) =>
      responderDiagnostico(sesion, { idDiagnostico: primera.idDiagnostico, paso: 0, letra: "A", ...parcial });

    for (const parcial of [
      { paso: 1 },
      { paso: 5 },
      { paso: -1 },
      { paso: 1.5 },
      { paso: "0" },
      { paso: Number.NaN },
      { paso: null },
      { paso: undefined },
      { letra: "E" },
      { letra: "a" },
      { letra: "AB" },
      { letra: "" },
      { letra: 1 },
      { letra: null },
      { letra: undefined },
      { letra: { toString: () => "A" } },
      { idDiagnostico: "xyz" },
      { idDiagnostico: undefined },
      { idDiagnostico: 42 },
      { idDiagnostico: null },
      { idDiagnostico: ` ${primera.idDiagnostico}` },
      { idDiagnostico: randomUUID() },
    ]) {
      const respuesta = ver(await pedido(parcial));
      expect(respuesta, JSON.stringify(parcial)).toEqual(primera);
    }

    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
  });

  it("un id de diagnóstico de otra sesión no aplica nada y devuelve el estado de la propia", async () => {
    const duena = await nuevaSesion();
    const ajena = await nuevaSesion();
    const deLaDuena = exigirEnCurso(await iniciar(duena, parcial1, { semilla: 1 }));
    const antes = await enCursoDe(duena.idUsuario);

    // La ajena no tiene diagnóstico: ninguno, y no se entera de que el de la dueña existe.
    expect(await responder(ajena, deLaDuena, acierta(deLaDuena))).toEqual({ estado: "ninguno" });
    // La ajena con uno propio: recibe el suyo, ni se aplica en el suyo ni en el de la dueña.
    const deLaAjena = exigirEnCurso(await iniciar(ajena, parcial1, { semilla: 2 }));
    const antesDeLaAjena = await enCursoDe(ajena.idUsuario);
    expect(await responder(ajena, deLaDuena, acierta(deLaDuena))).toEqual(deLaAjena);
    expect(await responder(ajena, { idDiagnostico: deLaDuena.idDiagnostico, paso: 0 }, "A")).toEqual(deLaAjena);

    expect(await enCursoDe(duena.idUsuario)).toEqual(antes);
    expect(await enCursoDe(ajena.idUsuario)).toEqual(antesDeLaAjena);
  });

  it("después de que otra pestaña empezó otra Evaluación, la respuesta con el id viejo no se califica contra la pregunta nueva", async () => {
    const sesion = await nuevaSesion();
    const vieja = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    const nueva = exigirEnCurso(await iniciar(sesion, parcial2, { semilla: 2 }));
    expect(nueva.idDiagnostico).not.toBe(vieja.idDiagnostico);
    const antes = await enCursoDe(sesion.idUsuario);

    // Mismo paso (0), pero el id es el del diagnóstico que ya no existe: devuelve el actual para que la pantalla avise.
    expect(await responder(sesion, vieja, acierta(nueva))).toEqual(nueva);

    const despues = await enCursoDe(sesion.idUsuario);
    expect(despues).toEqual(antes);
    expect(despues).toMatchObject({ id: nueva.idDiagnostico, paso: 0, pasos: [] });
  });

  it("después de terminar, una respuesta atrasada con el id del diagnóstico terminado devuelve terminado y no crea otro", async () => {
    const sesion = await nuevaSesion();
    const ultima = await hastaLaUltima(sesion, 4);
    const fin = await responder(sesion, ultima, acierta(ultima));
    expect(fin).toEqual({ estado: "terminado", idDiagnostico: ultima.idDiagnostico });

    // La pestaña que llega tarde (doble clic en la última pregunta, o una pestaña vieja) con el mismo paso y la misma letra.
    expect(await responder(sesion, ultima, acierta(ultima))).toEqual(fin);
    expect(await responder(sesion, ultima, "B")).toEqual(fin);
    // Con un paso que ya no existe también: el id es lo que dice que el diagnóstico ya terminó.
    expect(await responder(sesion, { idDiagnostico: ultima.idDiagnostico, paso: 9 }, "A")).toEqual(fin);

    expect(await diagnosticosDe(sesion.idUsuario)).toHaveLength(1);
    expect(await enCursoDe(sesion.idUsuario)).toBeNull();
    expect(await consultar(sesion)).toEqual({ estado: "ninguno" });
  });

  it("el doble clic en la última respuesta, con las dos llamadas a la vez: una sola fila y las dos reciben terminado con el mismo id", async () => {
    const sesion = await nuevaSesion();
    const ultima = await hastaLaUltima(sesion, 6);

    const [una, otra] = await Promise.all([responder(sesion, ultima, acierta(ultima)), responder(sesion, ultima, acierta(ultima))]);

    expect(una).toEqual({ estado: "terminado", idDiagnostico: ultima.idDiagnostico });
    expect(otra).toEqual(una);
    expect(await diagnosticosDe(sesion.idUsuario)).toHaveLength(1);
    expect(await enCursoDe(sesion.idUsuario)).toBeNull();
  });

  it("la pestaña vieja de un diagnóstico ya terminado recibe terminado aunque haya otro en curso; otra sesión con ese id no se entera", async () => {
    const sesion = await nuevaSesion();
    const ajena = await nuevaSesion();
    const ultima = await hastaLaUltima(sesion, 4);
    const fin = await responder(sesion, ultima, acierta(ultima));
    expect(fin).toEqual({ estado: "terminado", idDiagnostico: ultima.idDiagnostico });
    // La persona empezó otra Evaluación en otra pestaña: hay uno en curso y uno terminado.
    const otro = exigirEnCurso(await iniciar(sesion, parcial2, { semilla: 5 }));
    const antes = await enCursoDe(sesion.idUsuario);

    // El terminado va antes que el que sigue en curso (5.6.b: b antes que c).
    expect(await responder(sesion, ultima, "A")).toEqual(fin);
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
    expect(await consultar(sesion)).toEqual(otro);

    // Otra sesión no puede enterarse de que ese diagnóstico existe: sin diagnóstico propio, ninguno; con uno, el suyo.
    expect(await responder(ajena, ultima, "A")).toEqual({ estado: "ninguno" });
    const deLaAjena = exigirEnCurso(await iniciar(ajena, parcial1, { semilla: 6 }));
    expect(await responder(ajena, ultima, "A")).toEqual(deLaAjena);
  });

  it("un UUID en mayúsculas vale igual: responder con el id en mayúsculas aplica la respuesta una vez", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 2 }));
    expect(await iniciar(sesion, parcial1.toUpperCase())).toEqual(primera);

    const segunda = ver(await responderDiagnostico(sesion, { idDiagnostico: primera.idDiagnostico.toUpperCase(), paso: 0, letra: acierta(primera) }));

    expect(exigirEnCurso(segunda)).toMatchObject({ idDiagnostico: primera.idDiagnostico, paso: 1 });
    expect((await enCursoDe(sesion.idUsuario))!.paso).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 4: terminar
// ---------------------------------------------------------------------------------------------------------------


describe("criterio 4: terminar inserta el diagnóstico completo y borra el en curso en una sola transacción", () => {
  it("un diagnóstico completo del ejemplo queda guardado con el mismo id, las copias, la semilla, el resultado por habilidad y el puntaje", async () => {
    const sesion = await nuevaSesion();
    const referencia = correrReferencia(entradaDeReferencia(ejemplo, "materia-a", "parcial-1", [], 1), refAcierta);

    const corrida = await correr(sesion, parcial1, acierta, { semilla: 1 });

    // Las cifras de referencia del motor de main: con todo correcto y la semilla 1, P3, P5 y P2 de hasta 4.
    expect(corrida.claves).toEqual(["P3", "P5", "P2"]);
    expect(corrida.claves).toEqual(referencia.mostradas.map((m) => m.clave));
    expect(corrida.vistas.map((v) => v.pregunta)).toEqual(referencia.mostradas.map((m) => m.pregunta));
    expect(corrida.vistas.map((v) => v.maximo)).toEqual([4, 4, 4]);
    expect(corrida.vistas.map((v) => v.paso)).toEqual([0, 1, 2]);
    expect(corrida.fin).toEqual({ estado: "terminado", idDiagnostico: corrida.primera.idDiagnostico });

    const diagnosticos = await diagnosticosDe(sesion.idUsuario);
    expect(diagnosticos).toHaveLength(1);
    const [fila] = diagnosticos;
    expect(fila).toMatchObject({
      id: corrida.fin.idDiagnostico,
      id_lead: null,
      id_sesion_anonima: sesion.idUsuario,
      id_evaluacion: parcial1,
      id_materia: materiaA,
      id_monitoria: null,
      semilla: 1,
      repetido: false,
      puntaje: 100,
      aciertos: 3,
      respondidas: 3,
    });
    expect(Math.abs(Date.now() - Date.parse(fila.fecha_realizacion))).toBeLessThan(5 * MINUTO);
    expect(fila.token_recuperacion).toMatch(/^[0-9a-f]{64}$/);
    secretos.push(fila.token_recuperacion);

    // Las copias, en orden, tal como las vio la persona: con el orden de las opciones, la letra elegida y la pregunta completa.
    const copias = copiasDe(fila.respuestas);
    expect(copias.map((c) => c.clave)).toEqual(corrida.claves);
    copias.forEach((copia, i) => {
      expect(copia.orden).toEqual(referencia.pasos[i].orden);
      expect(copia.letraElegida).toBe(referencia.pasos[i].letraElegida);
      expect(copia.opciones).toEqual(referencia.pasos[i].opciones);
      expect(copia.solucion).toBe(referencia.pasos[i].solucion);
      expect(copia.dificultad).toBe(referencia.pasos[i].dificultad);
      expect(copia.habilidades).toEqual(referencia.pasos[i].habilidades);
      expect(Number.isNaN(Date.parse(copia.fecha))).toBe(false);
    });

    // El resultado es el del motor con nombres legibles, sin la marca de falta de material (esa va en su columna).
    expect(fila.resultado_por_habilidad).toEqual(resultadoEsperado(referencia.resultado, descripcionDeHabilidad(ejemplo, "materia-a")));
    expect(fila.falta_material).toEqual(faltaMaterialEsperada(referencia.resultado));
    expect(JSON.stringify(fila.resultado_por_habilidad)).not.toContain("faltaMaterial");

    expect(await enCursoDe(sesion.idUsuario)).toBeNull();
    expect(await consultar(sesion)).toEqual({ estado: "ninguno" });
  });

  it("con respuestas equivocadas guarda los errores con su detalle y el puntaje bajo", async () => {
    const sesion = await nuevaSesion();
    const referencia = correrReferencia(entradaDeReferencia(ejemplo, "materia-a", "parcial-1", [], 1), refFalla);

    const corrida = await correr(sesion, parcial1, falla, { semilla: 1 });

    // Con la estrategia «la opción que sigue a la correcta» y la semilla 1: P3, P5, P1, P2, puntaje 0 y tres errores.
    expect(corrida.claves).toEqual(["P3", "P5", "P1", "P2"]);
    const [fila] = await diagnosticosDe(sesion.idUsuario);
    expect(fila).toMatchObject({ puntaje: 0, aciertos: 0, respondidas: 4 });
    const resultado = fila.resultado_por_habilidad as ReturnType<typeof resultadoEsperado>;
    expect(resultado.errores.map((e) => [e.misconcepcion, e.estado, e.veces])).toEqual([
      ["olvida-interna", "confirmada", 2],
      ["no-resta-uno", "sospecha", 1],
      ["suma-uno", "sospecha", 1],
    ]);
    expect(resultado).toEqual(resultadoEsperado(referencia.resultado, descripcionDeHabilidad(ejemplo, "materia-a")));
    expect(resultado.errores.every((e) => e.descripcionHabilidad.length > 0)).toBe(true);
  });

  it("el detalle de cada error es el texto de error de las opciones que la persona eligió (D-49 d) y la descripción de su habilidad", async () => {
    const sesion = await nuevaSesion();
    const decidirReferencia: DecisionDeReferencia = (_paso, candidata, orden) => {
      const conError = candidata.opciones.findIndex((o) => !o.correcta && o.error !== null);
      const elegida = conError >= 0 ? conError : candidata.opciones.findIndex((o) => !o.correcta);
      return LETRAS[orden.findIndex((letra) => LETRAS.indexOf(letra) === elegida)];
    };
    const referencia = correrReferencia(entradaDeReferencia(ejemplo, "materia-a", "parcial-1", [], 2), decidirReferencia);

    const corrida = await correr(sesion, parcial1, fallaConDetalle, { semilla: 2 });

    expect(corrida.claves).toEqual(referencia.mostradas.map((m) => m.clave));
    const [fila] = await diagnosticosDe(sesion.idUsuario);
    const resultado = fila.resultado_por_habilidad as ReturnType<typeof resultadoEsperado>;
    expect(resultado).toEqual(resultadoEsperado(referencia.resultado, descripcionDeHabilidad(ejemplo, "materia-a")));
    const textosDeError = new Set(ejemplo.materias[0].temas.flatMap((t) => t.preguntas.flatMap((p) => p.opciones.flatMap((o) => (o.error ? [o.error] : [])))));
    const detalles = resultado.errores.flatMap((e) => e.detalles);
    expect(detalles.length).toBeGreaterThan(0);
    expect(detalles.every((detalle) => textosDeError.has(detalle))).toBe(true);
    // Lo que eligió queda en la copia: cada detalle sale de una opción que eligió.
    const elegidas = copiasDe(fila.respuestas).map((c) => c.opciones[LETRAS.indexOf(c.orden[LETRAS.indexOf(c.letraElegida)])]);
    expect(detalles.every((detalle) => elegidas.some((o) => o.error === detalle))).toBe(true);
  });

  it("el prerrequisito de otra materia sale con el nombre de esa materia (no con su carpeta ni su código)", async () => {
    const sesion = await nuevaSesion();
    const referencia = correrReferencia(entradaDeReferencia(ejemplo, "materia-b", "examen-final", [], 5), refFalla);

    const corrida = await correr(sesion, examenFinal, falla, { semilla: 5 });

    expect(corrida.claves).toEqual(["P1"]);
    expect(corrida.primera.maximo).toBe(1);
    const [fila] = await diagnosticosDe(sesion.idUsuario);
    expect(fila.resultado_por_habilidad).toEqual(resultadoEsperado(referencia.resultado, descripcionDeHabilidad(ejemplo, "materia-b")));
    expect((fila.resultado_por_habilidad as ReturnType<typeof resultadoEsperado>).prerrequisitos).toEqual([
      { materia: "Materia de prueba A", habilidad: "potencia", descripcion: "Derivar potencias de x con la regla de la potencia" },
    ]);
    expect(await enCursoDe(sesion.idUsuario)).toBeNull();
  });

  it("si el INSERT viola un check (aciertos imposibles) todo se deshace: el en curso sigue y no hay diagnóstico", async () => {
    const sesion = await nuevaSesion();
    const ultima = await hastaLaUltima(sesion, 4);
    const antes = (await enCursoDe(sesion.idUsuario))!;
    expect(antes.id).toBe(ultima.idDiagnostico);

    const { error } = await fx.admin.rpc("terminar_diagnostico", {
      p_id_sesion: sesion.idUsuario,
      p_id: antes.id,
      p_paso: antes.paso,
      p_copia: { clave: "P1" },
      p_resultado: { habilidades: [], errores: [], prerrequisitos: [] },
      p_falta_material: [],
      p_aciertos: 99,
      p_puntaje: 50,
    });

    expect(error?.code).toBe("23514");
    expect(await diagnosticosDe(sesion.idUsuario)).toEqual([]);
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
    // Con un resultado sin sus tres claves también: la base no deja un diagnóstico a medias.
    const sinClaves = await fx.admin.rpc("terminar_diagnostico", {
      p_id_sesion: sesion.idUsuario,
      p_id: antes.id,
      p_paso: antes.paso,
      p_copia: { clave: "P1" },
      p_resultado: { habilidades: [] },
      p_falta_material: [],
      p_aciertos: 0,
      p_puntaje: 0,
    });
    expect(sinClaves.error?.code).toBe("23514");
    expect(await diagnosticosDe(sesion.idUsuario)).toEqual([]);
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
  });

  it("la última respuesta ya no se puede repetir en la base: terminar con el paso viejo o con un id ajeno no escribe nada", async () => {
    const sesion = await nuevaSesion();
    const ajena = await nuevaSesion();
    const ultima = await hastaLaUltima(sesion, 4);
    const antes = (await enCursoDe(sesion.idUsuario))!;
    const terminar = (sobre: Partial<{ p_id_sesion: string; p_id: string; p_paso: number }>) =>
      fx.admin.rpc("terminar_diagnostico", {
        p_id_sesion: sesion.idUsuario,
        p_id: antes.id,
        p_paso: antes.paso,
        p_copia: { clave: "P1" },
        p_resultado: { habilidades: [], errores: [], prerrequisitos: [] },
        p_falta_material: [],
        p_aciertos: 0,
        p_puntaje: 0,
        ...sobre,
      });

    for (const cambio of [{ p_paso: antes.paso - 1 }, { p_paso: antes.paso + 1 }, { p_id: randomUUID() }, { p_id_sesion: ajena.idUsuario }]) {
      const { data, error } = await terminar(cambio);
      expect(error).toBeNull();
      expect(data).toEqual([{ resultado: "no_aplicada", id: null }]);
    }
    expect(await diagnosticosDe(sesion.idUsuario)).toEqual([]);
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
    expect(ultima.paso).toBe(antes.paso);
  });

  it("la base sola no aplica una respuesta a un diagnóstico vencido ni con una copia que no es un objeto, aunque se salten el módulo", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    const responderEnBd = (copia: unknown) =>
      fx.admin.rpc("responder_diagnostico", { p_id_sesion: sesion.idUsuario, p_id: primera.idDiagnostico, p_paso: 0, p_copia: copia as Json });
    const antes = (await enCursoDe(sesion.idUsuario))!;

    // Otra sesión con el id y el paso de la fila no la toca.
    const ajena = await nuevaSesion();
    const deLaAjena = await fx.admin.rpc("responder_diagnostico", { p_id_sesion: ajena.idUsuario, p_id: primera.idDiagnostico, p_paso: 0, p_copia: { clave: "P1" } });
    expect(deLaAjena.data).toBe(false);
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);

    // Una copia que no es un objeto no se agrega: la función dice false y la fila queda igual.
    for (const copia of [[], "texto", 7, null]) {
      const { data, error } = await responderEnBd(copia);
      expect(error, JSON.stringify(copia)).toBeNull();
      expect(data, JSON.stringify(copia)).toBe(false);
    }
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);

    // Vencido: ni responder ni terminar aplican nada, aunque el paso y el id sean los de la fila.
    await envejecer(sesion.idUsuario, 2 * HORA + MINUTO);
    const vencido = (await enCursoDe(sesion.idUsuario))!;
    expect((await responderEnBd({ clave: "P1" })).data).toBe(false);
    const terminar = await fx.admin.rpc("terminar_diagnostico", {
      p_id_sesion: sesion.idUsuario,
      p_id: vencido.id,
      p_paso: vencido.paso,
      p_copia: { clave: "P1" },
      p_resultado: { habilidades: [], errores: [], prerrequisitos: [] },
      p_falta_material: [],
      p_aciertos: 0,
      p_puntaje: 0,
    });
    expect(terminar.error).toBeNull();
    expect(terminar.data).toEqual([{ resultado: "no_aplicada", id: null }]);
    expect(await enCursoDe(sesion.idUsuario)).toEqual(vencido);
    expect(await diagnosticosDe(sesion.idUsuario)).toEqual([]);
  });

  it("terminar con una copia que no es un objeto falla con 22023 y no escribe nada", async () => {
    const sesion = await nuevaSesion();
    await hastaLaUltima(sesion, 4);
    const antes = (await enCursoDe(sesion.idUsuario))!;

    for (const copia of [[], "texto", 7, null]) {
      const { error } = await fx.admin.rpc("terminar_diagnostico", {
        p_id_sesion: sesion.idUsuario,
        p_id: antes.id,
        p_paso: antes.paso,
        p_copia: copia as Json,
        p_resultado: { habilidades: [], errores: [], prerrequisitos: [] },
        p_falta_material: [],
        p_aciertos: 0,
        p_puntaje: 0,
      });
      expect(error?.code, JSON.stringify(copia)).toBe("22023");
    }
    expect(await diagnosticosDe(sesion.idUsuario)).toEqual([]);
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 5: las vistas antes
// ---------------------------------------------------------------------------------------------------------------

/** Una sesión que es Lead: creó el Lead (HU-068). Los diagnósticos que termine nacen con `id_lead`. */
async function sesionLead() {
  const sesion = await nuevaSesion();
  const lead = await fx.crearLeadDeSesion(sesion.idUsuario);
  return { sesion, lead };
}

/** Otra sesión del mismo Lead, por el enlace de verificación del correo (`lead_sesion`). */
async function sesionConfirmada(idLead: string) {
  const sesion = await nuevaSesion();
  exito(await fx.admin.from("lead_sesion").insert({ id_sesion: sesion.idUsuario, id_lead: idLead }).select().single(), "ligar la sesión al Lead");
  return sesion;
}

/** La cuenta de Estudiante del Lead. */
async function cuentaDeEstudiante(idLead: string) {
  const sesion = await nuevaSesion("estudiante");
  exito(await fx.admin.from("estudiante").insert({ id: sesion.idUsuario, id_lead: idLead }).select().single(), "crear el Estudiante del Lead");
  return sesion;
}

/** Las preguntas que el motor tendría que dejar de elegir: las `vistas_antes` que guardó el diagnóstico en curso. */
async function vistasAntesDe(idSesion: string): Promise<string[]> {
  return ((await enCursoDe(idSesion))?.vistas_antes ?? []) as string[];
}

describe("criterio 5 (D-49 a): las vistas antes son las preguntas de los diagnósticos terminados de la materia de la sesión o de un Lead de la sesión", () => {
  it("el segundo diagnóstico de la misma sesión no repite ninguna pregunta del primero, y la falta de material queda marcada", async () => {
    const sesion = await nuevaSesion();
    const uno = await correr(sesion, parcial1, acierta, { semilla: 1 });
    expect(uno.claves).toEqual(["P3", "P5", "P2"]);

    const segunda = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 101 }));

    expect(await vistasAntesDe(sesion.idUsuario)).toEqual(["P2", "P3", "P5"]);
    const referencia = correrReferencia(entradaDeReferencia(ejemplo, "materia-a", "parcial-1", ["P2", "P3", "P5"], 101), refAcierta);
    // Sobran P1 y P4, de hasta 2 preguntas (cifras de referencia).
    expect(segunda.maximo).toBe(2);
    expect(segunda.maximo).toBe(referencia.maximo);
    const dos = await completar(sesion, segunda, acierta);
    expect(dos.claves).toEqual(referencia.mostradas.map((m) => m.clave));
    expect([...dos.claves].sort()).toEqual(["P1", "P4"]);

    // Criterio 7: las dos habilidades quedan en proceso y marcadas, y la marca se guarda aparte del resultado.
    const [, fila] = await diagnosticosDe(sesion.idUsuario);
    expect(fila.id).toBe(dos.fin.idDiagnostico);
    expect(fila.falta_material).toEqual([
      { habilidad: "cadena", motivos: ["sin_preguntas_sin_ver"] },
      { habilidad: "potencia", motivos: ["sin_preguntas_sin_ver"] },
    ]);
    expect(fila.falta_material).toEqual(faltaMaterialEsperada(referencia.resultado));
    expect(JSON.stringify(fila.resultado_por_habilidad)).not.toMatch(/sin_preguntas_sin_ver|tope_una_respuesta|faltaMaterial|falta_material/);
  });

  it("cuentan los diagnósticos de otra sesión del mismo Lead (enlace de verificación) y de la cuenta de Estudiante del Lead", async () => {
    const { sesion, lead } = await sesionLead();
    const uno = await correr(sesion, parcial1, acierta, { semilla: 1 });
    expect(uno.claves).toEqual(["P3", "P5", "P2"]);
    // Nace con el Lead: es lo que permite que las otras sesiones del Lead lo vean.
    expect((await diagnosticosDe(sesion.idUsuario))[0].id_lead).toBe(lead.id);

    const confirmada = await sesionConfirmada(lead.id);
    const estudiante = await cuentaDeEstudiante(lead.id);

    for (const otra of [confirmada, estudiante]) {
      exigirEnCurso(await iniciar(otra, parcial1, { semilla: 101 }));
      expect(await vistasAntesDe(otra.idUsuario), `sesión ${otra.rol}`).toEqual(["P2", "P3", "P5"]);
    }
  });

  it("también cuentan los que la sesión hizo antes de ser Lead, una vez que el contacto los liga (P-33)", async () => {
    const sesion = await nuevaSesion();
    const uno = await correr(sesion, parcial1, acierta, { semilla: 1 });
    expect((await diagnosticosDe(sesion.idUsuario))[0].id_lead).toBeNull();

    // La sesión deja su contacto después: registrar_lead (HU-068) crea el Lead y le liga el diagnóstico que ya había hecho.
    const idLead = exito(
      await fx.admin.rpc("registrar_lead", {
        p_id_sesion: sesion.idUsuario,
        p_nombre: "Lead de la prueba",
        p_correo: `prueba-${randomUUID()}@calibra.test`,
        p_numero_telefono: "",
        p_acepta_contacto: false,
        p_fecha_consentimiento: new Date().toISOString(),
        p_origen: "",
      }),
      "registrar el Lead",
    );
    leadsExtra.push(idLead);
    expect((await diagnosticosDe(sesion.idUsuario))[0].id_lead).toBe(idLead);

    const confirmada = await sesionConfirmada(idLead);
    exigirEnCurso(await iniciar(confirmada, parcial1, { semilla: 101 }));
    expect(await vistasAntesDe(confirmada.idUsuario)).toEqual([...uno.claves].sort());
  });

  it("no cuentan los de un Lead ajeno, los de otra sesión sin Lead, los de otra materia ni un diagnóstico en curso abandonado", async () => {
    const { sesion, lead } = await sesionLead();
    const { sesion: ajena } = await sesionLead();
    const suelta = await nuevaSesion();
    const confirmada = await sesionConfirmada(lead.id);

    // Un Lead ajeno y una sesión suelta terminaron un diagnóstico de la materia.
    await correr(ajena, parcial1, acierta, { semilla: 1 });
    await correr(suelta, parcial1, acierta, { semilla: 1 });
    // El Lead hizo el examen final de la otra materia.
    await correr(sesion, examenFinal, acierta, { semilla: 1 });
    // La sesión de nuestro Lead empezó uno y lo dejó.
    exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 2 }));

    // La confirmada ve el examen de la otra materia solo para esa materia: en la materia A parte de cero.
    const primera = exigirEnCurso(await iniciar(confirmada, parcial1, { semilla: 1 }));
    expect(await vistasAntesDe(confirmada.idUsuario)).toEqual([]);
    expect(claveMostrada(primera)).toBe("P3");
    expect(primera.maximo).toBe(4);
  });

  it("D-49 a, con 30 semillas y respuestas al azar: el segundo diagnóstico nunca repite una pregunta del primero", { timeout: 180_000 }, async () => {
    const sesion = await nuevaSesion();
    for (let semilla = 1; semilla <= 30; semilla++) {
      const uno = await correr(sesion, parcial1, alAzar(semilla), { semilla });
      const segunda = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: semilla + 1000 }));
      expect(await vistasAntesDe(sesion.idUsuario), `semilla ${semilla}`).toEqual([...uno.claves].sort());
      const dos = await completar(sesion, segunda, alAzar(semilla + 1000));
      expect(dos.claves.length, `semilla ${semilla}`).toBeGreaterThan(0);
      expect(dos.claves.filter((clave) => uno.claves.includes(clave)), `semilla ${semilla}: ${uno.claves} y ${dos.claves}`).toEqual([]);
      // Cada vuelta parte de cero con la misma sesión: 30 sesiones anónimas gastarían el cupo del Auth local.
      await bd.query("delete from public.diagnostico where id_sesion_anonima = $1", [sesion.idUsuario]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Vistas antes y foto del banco: casos que solo distingue la base
// ---------------------------------------------------------------------------------------------------------------

describe("vistas antes: la regla del Lead no depende de quién llegó primero y lee solo pasos con clave", () => {
  it("la sesión que creó el Lead ve lo que hicieron otra sesión suya y su cuenta de Estudiante", async () => {
    const { sesion: creadora, lead } = await sesionLead();
    const confirmada = await sesionConfirmada(lead.id);
    const estudiante = await cuentaDeEstudiante(lead.id);
    const deLaConfirmada = await correr(confirmada, parcial1, acierta, { semilla: 1 });
    expect(deLaConfirmada.claves).toEqual(["P3", "P5", "P2"]);

    // Quien creó el Lead, y la cuenta de Estudiante, parten de lo que hizo la sesión que confirmó el correo.
    for (const otra of [creadora, estudiante]) {
      exigirEnCurso(await iniciar(otra, parcial1, { semilla: 101 }));
      expect(await vistasAntesDe(otra.idUsuario), `sesión ${otra.rol}`).toEqual(["P2", "P3", "P5"]);
    }
  });

  it("las claves son distintas y ordenadas, y lo que no es un paso con clave de texto no cuenta", async () => {
    const sesion = await nuevaSesion();
    // Un diagnóstico hecho a mano con pasos raros (como los de una versión vieja o un dato dañado): solo cuentan los objetos con clave.
    exito(
      await fx.admin
        .from("diagnostico")
        .insert({
          id_sesion_anonima: sesion.idUsuario,
          id_evaluacion: parcial1,
          id_materia: materiaA,
          respuestas: ["clave", 5, null, { clave: "P2" }, { clave: null }, { otra: "x" }, { clave: "P1" }],
          puntaje: 50,
          resultado_por_habilidad: { habilidades: [], errores: [], prerrequisitos: [] },
          semilla: 1,
          aciertos: 1,
        })
        .select()
        .single(),
      "insertar el diagnóstico a mano",
    );
    // Otro que repite P2: la clave sale una sola vez.
    await fx.crearDiagnostico({ idSesionAnonima: sesion.idUsuario, idEvaluacion: parcial1, idMateria: materiaA, claves: ["P3", "P2"] });

    exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 7 }));

    expect(await vistasAntesDe(sesion.idUsuario)).toEqual(["P1", "P2", "P3"]);
  });

  it("con dos diagnósticos de la misma fecha, el último es el de id mayor", async () => {
    const sesion = await nuevaSesion();
    const todas = ["P1", "P2", "P3", "P4", "P5", "P8"];
    const uno = await fx.crearDiagnostico({ idSesionAnonima: sesion.idUsuario, idEvaluacion: parcial1, idMateria: materiaA, claves: todas });
    const otro = await fx.crearDiagnostico({ idSesionAnonima: sesion.idUsuario, idEvaluacion: parcial1, idMateria: materiaA, claves: todas });
    const fecha = new Date(Date.now() - HORA).toISOString();
    exito(await fx.admin.from("diagnostico").update({ fecha_realizacion: fecha }).in("id", [uno.id, otro.id]).select(), "igualar las fechas");

    // parcial-2 no se tomó nunca: vale el último de la materia, y con el empate de fecha gana el id mayor (el orden de agendar).
    expect(await iniciar(sesion, parcial2, { semilla: 1 })).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: [uno.id, otro.id].sort()[1] });
  });
});

describe("la foto del banco que guarda la base", () => {
  it("banco_de_la_evaluacion da null con una Evaluación inactiva o inexistente y, con una activa, el contexto y las candidatas", async () => {
    const activa = await fx.admin.rpc("banco_de_la_evaluacion", { p_id_evaluacion: parcial1 });
    expect(activa.error).toBeNull();
    expect(Object.keys(activa.data as object).sort()).toEqual(["candidatas", "contexto"]);

    await bd.query("update public.evaluacion set activa = false where id = $1", [parcial1]);
    for (const id of [parcial1, randomUUID()]) {
      const { data, error } = await fx.admin.rpc("banco_de_la_evaluacion", { p_id_evaluacion: id });
      expect(error).toBeNull();
      expect(data).toBeNull();
    }
  });

  it("una pregunta que mide una habilidad de fuera de la Evaluación y una opción con una misconcepción de fuera: la foto trae todo y el resultado la cuenta", async () => {
    await prepararBanco({
      cambiosAlEjemplo: [
        // P1 ofrece una trampa de `antiderivada`, que no es de parcial-1.
        ["- B) $3x^{3}$ · [no-resta-uno]", "- B) $3x^{3}$ · [olvida-constante]"],
        // P8 mide también `potencia`, así que es candidata de parcial-1 y mide además una habilidad de fuera.
        ["kc: antiderivada · revisada · origen: humano · revisó: Ana", "kc: antiderivada, potencia · revisada · origen: humano · revisó: Ana"],
      ],
    });
    const sesion = await nuevaSesion();
    const trampa: Decision = (vista) => {
      const pregunta = preguntaMostrada(vista);
      const elegida = pregunta.opciones.find((o) => o.misconcepcion === "olvida-constante") ?? pregunta.opciones.find((o) => !o.correcta)!;
      return LETRAS[vista.pregunta.opciones.findIndex((o) => o.texto === elegida.texto)];
    };
    const trampaDeReferencia: DecisionDeReferencia = (_paso, candidata, orden) => {
      const buscada = candidata.opciones.findIndex((o) => o.misconcepcion === "olvida-constante");
      const elegida = buscada >= 0 ? buscada : candidata.opciones.findIndex((o) => !o.correcta);
      return LETRAS[orden.findIndex((letra) => LETRAS.indexOf(letra) === elegida)];
    };
    // Una semilla con la que el motor llega a caer en la trampa de fuera.
    let semilla = 0;
    for (let s = 1; s <= 60 && semilla === 0; s++) {
      const prueba = correrReferencia(entradaDeReferencia(ejemplo, "materia-a", "parcial-1", [], s), trampaDeReferencia);
      if (prueba.resultado.errores.some((e) => e.misconcepcion === "olvida-constante")) semilla = s;
    }
    expect(semilla, "una semilla del ejemplo que caiga en la trampa de antiderivada").toBeGreaterThan(0);
    const entrada = entradaDeReferencia(ejemplo, "materia-a", "parcial-1", [], semilla);
    const referencia = correrReferencia(entrada, trampaDeReferencia);

    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla }));

    // La foto es la que arma el banco leído del disco: P8 entra (mide `potencia`) con las dos claves, las misconcepciones y las
    // descripciones son las de toda la materia, no solo las de la Evaluación.
    const fila = (await enCursoDe(sesion.idUsuario))!;
    expect(fila.candidatas).toEqual(entrada.candidatas);
    expect((fila.candidatas as { clave: string; habilidades: string[] }[]).find((c) => c.clave === "P8")?.habilidades).toEqual(["antiderivada", "potencia"]);
    const contexto = fila.contexto as { habilidades: unknown; misconcepciones: unknown; descripcionesDeHabilidad: Record<string, string> };
    expect(contexto.habilidades).toEqual(entrada.habilidades);
    expect(contexto.misconcepciones).toEqual(entrada.misconcepciones);
    expect(Object.keys(contexto.descripcionesDeHabilidad).sort()).toEqual(["antiderivada", "cadena", "potencia"]);
    expect(contexto.descripcionesDeHabilidad.antiderivada).toBe("Encontrar antiderivadas de potencias de x");
    expect(primera.maximo).toBe(referencia.maximo);

    const corrida = await completar(sesion, primera, trampa);
    expect(corrida.claves).toEqual(referencia.mostradas.map((m) => m.clave));
    const [guardado] = await diagnosticosDe(sesion.idUsuario);
    expect(guardado.resultado_por_habilidad).toEqual(resultadoEsperado(referencia.resultado, descripcionDeHabilidad(ejemplo, "materia-a")));
    const errores = (guardado.resultado_por_habilidad as ReturnType<typeof resultadoEsperado>).errores;
    expect(errores.find((e) => e.misconcepcion === "olvida-constante")).toMatchObject({
      habilidad: "antiderivada",
      descripcionHabilidad: "Encontrar antiderivadas de potencias de x",
    });
  });
});

describe("las cifras de referencia del motor de main con el banco de ejemplo y el orden de habilidades de la base", () => {
  it("con todo correcto: el primero hace P3, P5 y P2 (de hasta 4), el segundo P1 y P4 (de hasta 2) y el tercero ya no tiene preguntas", async () => {
    for (let k = 0; k < 3; k++) {
      const sesion = await nuevaSesion();
      const uno = await correr(sesion, parcial1, acierta, { semilla: 1 + k });
      expect(uno.claves, `semilla ${1 + k}`).toEqual(["P3", "P5", "P2"]);
      expect(uno.primera.maximo).toBe(4);

      const segunda = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 101 + k }));
      expect(segunda.maximo).toBe(2);
      const dos = await completar(sesion, segunda, acierta);
      expect([...dos.claves].sort(), `semilla ${101 + k}`).toEqual(["P1", "P4"]);
      // Con la 103 el orden de la ronda 1 es otro.
      if (k === 2) expect(dos.claves).toEqual(["P4", "P1"]);

      expect(await iniciar(sesion, parcial1, { semilla: 201 + k })).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: dos.fin.idDiagnostico });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 6: vencimiento
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 6 (D-49 d): un diagnóstico sin respuesta durante 2 horas vence", () => {
  it("la constante de la app es la de la base", async () => {
    const { rows } = await bd.query<{ segundos: number }>("select extract(epoch from privado.vigencia_del_diagnostico_en_curso())::int as segundos");
    expect(rows[0].segundos).toBe(HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO * 3600);
  });

  it("vencido: consultar da ninguno sin borrar nada, responder no aplica, e iniciar crea otro con otra semilla y borra el vencido", async () => {
    const sesion = await nuevaSesion();
    const vencido = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 11 }));
    await envejecer(sesion.idUsuario, 2 * HORA + MINUTO);
    const antes = await enCursoDe(sesion.idUsuario);

    expect(await consultar(sesion)).toEqual({ estado: "ninguno" });
    expect(await responder(sesion, vencido, acierta(vencido))).toEqual({ estado: "ninguno" });
    // Leer y responder no escriben nada, ni siquiera borran el vencido.
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);

    const nuevo = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 12 }));
    expect(nuevo.idDiagnostico).not.toBe(vencido.idDiagnostico);
    expect(await contarEnCurso()).toBe(1);
    expect(await enCursoDe(sesion.idUsuario)).toMatchObject({ id: nuevo.idDiagnostico, semilla: 12, paso: 0, pasos: [] });
  });

  it("a 1 h 59 min 55 s sigue vigente; responder alarga las 2 horas desde esa respuesta y recargar no", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 3 }));
    await envejecer(sesion.idUsuario, 2 * HORA - 5_000);
    const antes = (await enCursoDe(sesion.idUsuario))!;

    // Recargar y leer no mueven nada.
    expect(await iniciar(sesion, parcial1)).toEqual(primera);
    expect(await consultar(sesion)).toEqual(primera);
    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);

    // Responder sí: la hora corre desde esa respuesta.
    const segunda = exigirEnCurso(await responder(sesion, primera, acierta(primera)));
    const despues = (await enCursoDe(sesion.idUsuario))!;
    expect(despues.paso).toBe(1);
    expect(Date.parse(despues.actualizado_en)).toBeGreaterThan(Date.parse(antes.actualizado_en) + HORA);
    expect(Math.abs(Date.now() - Date.parse(despues.actualizado_en))).toBeLessThan(MINUTO);
    expect(despues.iniciado_en).toBe(antes.iniciado_en);

    // Una hora después de esa respuesta sigue vigente; con 2 h y 5 s ya venció.
    await envejecer(sesion.idUsuario, HORA);
    expect(await consultar(sesion)).toEqual(segunda);
    await envejecer(sesion.idUsuario, 2 * HORA + 5_000);
    expect(await consultar(sesion)).toEqual({ estado: "ninguno" });
  });

  it("el vencido de otra Evaluación también se reemplaza, y el de otra sesión no se toca", async () => {
    const sesion = await nuevaSesion();
    const otra = await nuevaSesion();
    exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    exigirEnCurso(await iniciar(otra, parcial1, { semilla: 2 }));
    await envejecer(sesion.idUsuario, 3 * HORA);
    await envejecer(otra.idUsuario, 3 * HORA);
    const deLaOtra = await enCursoDe(otra.idUsuario);

    const nuevo = exigirEnCurso(await iniciar(sesion, parcial2, { semilla: 5 }));

    expect(nuevo.evaluacion.id).toBe(parcial2);
    expect(await contarEnCurso()).toBe(2);
    // La de la otra sesión sigue ahí aunque esté vencida: la borran su propio iniciar o la purga.
    expect(await enCursoDe(otra.idUsuario)).toEqual(deLaOtra);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterios 8 y 9: D-51
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 8 (D-51): si ya vio todas las preguntas revisadas, no se crea nada y se responde sin_preguntas", () => {
  it("el tercer diagnóstico de la misma Evaluación: sin_preguntas con el último resultado, sin crear ni descartar nada", async () => {
    const sesion = await nuevaSesion();
    const uno = await correr(sesion, parcial1, acierta, { semilla: 1 });
    const dos = await correr(sesion, parcial1, acierta, { semilla: 101 });
    expect([...uno.claves, ...dos.claves].sort()).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(maximoDePreguntas(entradaDeReferencia(ejemplo, "materia-a", "parcial-1", [...uno.claves, ...dos.claves], 201))).toBe(0);
    // La pendiente de otra Evaluación (parcial-2 tiene también P8) sigue donde estaba.
    const pendiente = exigirEnCurso(await iniciar(sesion, parcial2, { semilla: 7 }));
    const enCursoAntes = await enCursoDe(sesion.idUsuario);
    const diagnosticosAntes = await diagnosticosDe(sesion.idUsuario);

    const respuesta = await iniciar(sesion, parcial1, { semilla: 201 });

    expect(respuesta).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: dos.fin.idDiagnostico });
    expect(await enCursoDe(sesion.idUsuario)).toEqual(enCursoAntes);
    expect(await diagnosticosDe(sesion.idUsuario)).toEqual(diagnosticosAntes);
    expect(await consultar(sesion)).toEqual(pendiente);
  });

  it("con la acumulativa vista por completo sin haberla tomado, el último resultado es el último de la materia; si la tomó, el de esa Evaluación", async () => {
    const sesion = await nuevaSesion();
    const otra = await nuevaSesion();
    const todas = ["P1", "P2", "P3", "P4", "P5", "P8"];
    // Desde parcial-1 el motor nunca llega a P8 (solo la mide antiderivada, del tema integrales): así se arma.
    const deParcial1 = await fx.crearDiagnostico({ idSesionAnonima: sesion.idUsuario, idEvaluacion: parcial1, idMateria: materiaA, claves: todas });

    expect(await iniciar(sesion, parcial2, { semilla: 1 })).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: deParcial1.id });
    expect(await enCursoDe(sesion.idUsuario)).toBeNull();

    // La otra sesión tomó parcial-2 hace dos días y parcial-1 hace un rato: para parcial-2 vale el de parcial-2.
    const viejo = await fx.crearDiagnostico({ idSesionAnonima: otra.idUsuario, idEvaluacion: parcial2, idMateria: materiaA, claves: todas });
    const reciente = await fx.crearDiagnostico({ idSesionAnonima: otra.idUsuario, idEvaluacion: parcial1, idMateria: materiaA, claves: ["P1"] });
    exito(await fx.admin.from("diagnostico").update({ fecha_realizacion: new Date(Date.now() - 48 * HORA).toISOString() }).eq("id", viejo.id).select(), "fechar");
    expect(reciente.id).not.toBe(viejo.id);
    expect(await iniciar(otra, parcial2, { semilla: 1 })).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: viejo.id });
    // Y para parcial-1 el más reciente es el de parcial-1.
    expect(await iniciar(otra, parcial1, { semilla: 1 })).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: reciente.id });
    expect(await enCursoDe(otra.idUsuario)).toBeNull();
  });

  it("lo vio otra sesión del mismo Lead: también sin_preguntas, con el último diagnóstico del Lead", async () => {
    const { sesion, lead } = await sesionLead();
    await correr(sesion, parcial1, acierta, { semilla: 1 });
    const dos = await correr(sesion, parcial1, acierta, { semilla: 101 });
    const confirmada = await sesionConfirmada(lead.id);
    const estudiante = await cuentaDeEstudiante(lead.id);

    for (const otra of [confirmada, estudiante]) {
      expect(await iniciar(otra, parcial1, { semilla: 5 })).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: dos.fin.idDiagnostico });
      expect(await enCursoDe(otra.idUsuario)).toBeNull();
    }
  });
});

describe("criterio 9 (D-51): volver a tomarlo crea un diagnóstico sin excluir las vistas, marcado como repetido", () => {
  it("con volverATomar parte de cero: vistas vacías, repetido, y con la misma semilla arranca igual que el primero", async () => {
    const sesion = await nuevaSesion();
    const uno = await correr(sesion, parcial1, acierta, { semilla: 1 });
    const dos = await correr(sesion, parcial1, acierta, { semilla: 101 });
    expect(await iniciar(sesion, parcial1, { semilla: 1 })).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: dos.fin.idDiagnostico });

    const repetido = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1, volverATomar: true }));

    expect(await enCursoDe(sesion.idUsuario)).toMatchObject({ id: repetido.idDiagnostico, vistas_antes: [], repetido: true, semilla: 1 });
    // Como si no hubiera visto ninguna: el mismo máximo, la misma pregunta y las opciones en el mismo orden que el primero.
    expect(repetido.maximo).toBe(uno.primera.maximo);
    expect(repetido.pregunta).toEqual(uno.primera.pregunta);
    const tres = await completar(sesion, repetido, acierta);
    expect(tres.claves).toEqual(uno.claves);
    const diagnosticos = await diagnosticosDe(sesion.idUsuario);
    expect(diagnosticos.map((d) => d.repetido)).toEqual([false, false, true]);
    expect(diagnosticos[2].id).toBe(tres.fin.idDiagnostico);

    // Después de uno repetido, el siguiente vuelve a ser sin_preguntas.
    expect(await iniciar(sesion, parcial1, { semilla: 5 })).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: tres.fin.idDiagnostico });
    expect(await enCursoDe(sesion.idUsuario)).toBeNull();
  });

  it("con preguntas libres volverATomar se ignora, también con una petición armada a mano: vistas normales y sin marcar", async () => {
    const sesion = await nuevaSesion();
    const uno = await correr(sesion, parcial1, acierta, { semilla: 1 });

    const nuevo = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 101, volverATomar: true }));

    expect(await enCursoDe(sesion.idUsuario)).toMatchObject({ id: nuevo.idDiagnostico, vistas_antes: [...uno.claves].sort(), repetido: false });
    expect(["P1", "P4"]).toContain(claveMostrada(nuevo));
    expect(nuevo.maximo).toBe(2);
  });

  it("solo volverATomar === true cuenta: un texto, un número o un objeto no repiten", async () => {
    const sesion = await nuevaSesion();
    const uno = await correr(sesion, parcial1, acierta, { semilla: 1 });
    const dos = await correr(sesion, parcial1, acierta, { semilla: 101 });
    void uno;

    for (const valor of ["true", "sí", 1, {}, [], null, undefined, false]) {
      expect(await iniciar(sesion, parcial1, { volverATomar: valor }), JSON.stringify(valor)).toEqual({
        estado: "sin_preguntas",
        idUltimoDiagnostico: dos.fin.idDiagnostico,
      });
    }
    expect(await enCursoDe(sesion.idUsuario)).toBeNull();
  });

  it("con una pendiente de la misma Evaluación, volverATomar devuelve la pendiente sin cambiarla", async () => {
    const sesion = await nuevaSesion();
    const pendiente = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 9 }));
    const antes = await enCursoDe(sesion.idUsuario);

    expect(await iniciar(sesion, parcial1, { semilla: 10, volverATomar: true })).toEqual(pendiente);

    expect(await enCursoDe(sesion.idUsuario)).toEqual(antes);
    expect(antes).toMatchObject({ repetido: false, semilla: 9 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 10: lo que recibe el navegador
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 10: lo que recibe el navegador no trae nada que dé la respuesta", () => {
  it("un recorrido completo con las tres operaciones: solo las cinco formas, solo claves permitidas y ningún valor sembrado", async () => {
    const sesion = await nuevaSesion();
    const SEMILLA = 31_415_926;
    secretos.push(String(SEMILLA));

    // Con la semilla fija en 8 dígitos: un diagnóstico con respuestas equivocadas, otros hasta ver todas las preguntas, sin_preguntas y
    // uno repetido.
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: SEMILLA }));
    expect(await consultar(sesion)).toEqual(primera);
    expect(await iniciar(sesion, parcial1)).toEqual(primera);
    const uno = await completar(sesion, primera, fallaConDetalle);
    let ultimo = uno;
    let respuesta = await iniciar(sesion, parcial1, { semilla: SEMILLA + 1 });
    for (let vuelta = 2; respuesta.estado === "en_curso"; vuelta++) {
      expect(vuelta).toBeLessThan(6);
      ultimo = await completar(sesion, respuesta, acierta);
      respuesta = await iniciar(sesion, parcial1, { semilla: SEMILLA + vuelta });
    }
    expect(respuesta).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: ultimo.fin.idDiagnostico });
    const repetido = await correr(sesion, parcial1, falla, { semilla: SEMILLA + 10, volverATomar: true });
    // Un id viejo, una letra inválida y una Evaluación que no existe también devuelven solo las formas permitidas.
    await responder(sesion, uno.primera, "A");
    ver(await responderDiagnostico(sesion, { idDiagnostico: "no", paso: -1, letra: "Z" }));
    await iniciar(sesion, randomUUID());
    await consultar(sesion);
    expect([uno.fin, ultimo.fin, repetido.fin].every((fin) => Object.keys(fin).sort().join() === "estado,idDiagnostico")).toBe(true);

    // Los secretos de la base: el token de recuperación y la semilla de cada diagnóstico guardado.
    const diagnosticos = await diagnosticosDe(sesion.idUsuario);
    expect(diagnosticos.length).toBeGreaterThanOrEqual(3);
    for (const fila of diagnosticos) {
      secretos.push(fila.token_recuperacion, String(fila.semilla));
      expect(fila.semilla).toBeGreaterThan(9_999_999);
    }
    // La prueba busca de verdad: en lo que SÍ lee el servidor de la base están la correcta, las misconcepciones y las soluciones.
    const dePrueba = JSON.stringify(diagnosticos.map((d) => d.respuestas));
    expect(dePrueba).toContain("integras en vez de derivar");
    expect(dePrueba).toContain('"correcta":true');
    expect(dePrueba).toContain("olvida-interna");
    expect(JSON.stringify(vistos)).not.toContain("integras en vez de derivar");
    expect(vistos.length).toBeGreaterThan(10);
  });

  it("la letra de la opción correcta cambia con la semilla: no es siempre la misma entre doce inicios", async () => {
    const sesion = await nuevaSesion();
    const letras = new Set<Letra>();
    for (let semilla = 1; semilla <= 12; semilla++) {
      const vista = exigirEnCurso(await iniciar(sesion, parcial1, { semilla }));
      letras.add(letraDe(vista, "correcta"));
      await bd.query("delete from public.diagnostico_en_curso where id_sesion = $1", [sesion.idUsuario]);
    }
    // La distribución fina la prueba HU-060 con el motor (semillas 1 a 1000) y servidor.test.ts sobre lo que sale del módulo.
    expect(letras.size).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Cuentas del equipo
// ---------------------------------------------------------------------------------------------------------------

describe("cuentas del equipo: un monitor o un admin no toman el diagnóstico", () => {
  it("el módulo no llama a la base con el rol de monitor o admin, y la base lo vuelve a frenar mirando sus tablas", async () => {
    const admin = await fx.crearAdmin();
    const monitor = await fx.crearMonitor();
    const enBd = async (id: string) => (await bd.query("select 1 from public.diagnostico_en_curso where id_sesion = $1", [id])).rows.length;

    for (const [usuario, rol] of [
      [admin, "admin"],
      [monitor, "monitor"],
    ] as const) {
      const sesion: Sesion = { idUsuario: usuario.id, rol };
      expect(await iniciar(sesion, parcial1)).toEqual({ estado: "no_disponible", motivo: "cuenta_del_equipo" });
      expect(await consultar(sesion)).toEqual({ estado: "ninguno" });
      expect(await responder(sesion, { idDiagnostico: randomUUID(), paso: 0 }, "A")).toEqual({ estado: "ninguno" });
      // Aunque una acción se saltara la guarda del módulo (rol equivocado), la base responde cuenta_del_equipo y no escribe.
      for (const rolEquivocado of ["anonimo", "estudiante", null] as const) {
        const sinGuarda: Sesion = { idUsuario: usuario.id, rol: rolEquivocado };
        expect(await iniciar(sinGuarda, parcial1), `${rol} como ${rolEquivocado}`).toEqual({ estado: "no_disponible", motivo: "cuenta_del_equipo" });
      }
      expect(await enBd(usuario.id)).toBe(0);
    }
  });

  it("una cuenta del equipo con un diagnóstico en curso que le llegó por fuera del módulo: el módulo no lo muestra, no lo reanuda y no lo toca", async () => {
    const admin = await fx.crearAdmin();
    const monitor = await fx.crearMonitor();
    for (const [usuario, rol] of [
      [admin, "admin"],
      [monitor, "monitor"],
    ] as const) {
      // Un diagnóstico en curso corriente que se le pasa a la cuenta del equipo directamente en la base.
      const corriente = await nuevaSesion();
      const vista = exigirEnCurso(await iniciar(corriente, parcial1, { semilla: 3 }));
      await bd.query("update public.diagnostico_en_curso set id_sesion = $1 where id = $2", [usuario.id, vista.idDiagnostico]);
      const sesion: Sesion = { idUsuario: usuario.id, rol };
      const antes = await enCursoDe(usuario.id);
      expect(antes).toMatchObject({ id: vista.idDiagnostico, paso: 0 });

      expect(await iniciar(sesion, parcial1), `${rol}: iniciar`).toEqual({ estado: "no_disponible", motivo: "cuenta_del_equipo" });
      expect(await consultar(sesion), `${rol}: consultar`).toEqual({ estado: "ninguno" });
      expect(await responder(sesion, vista, acierta(vista)), `${rol}: responder`).toEqual({ estado: "ninguno" });
      expect(await enCursoDe(usuario.id), `${rol}: la fila`).toEqual(antes);
      await bd.query("delete from public.diagnostico_en_curso where id_sesion = $1", [usuario.id]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// id_lead al nacer
// ---------------------------------------------------------------------------------------------------------------

describe("el diagnóstico nace con id_lead si la sesión ya es de un Lead (P-33)", () => {
  it("por cada una de las tres vías de es_mi_lead el diagnóstico nace con el Lead; sin Lead nace sin él, y registrar_lead lo liga después", async () => {
    // Un Lead por vía, para que ningún diagnóstico excluya las preguntas del otro (D-49 a): el examen final tiene una sola.
    const { sesion: creadora, lead: leadDeLaCreadora } = await sesionLead();
    const { lead: leadDeLaConfirmada } = await sesionLead();
    const confirmada = await sesionConfirmada(leadDeLaConfirmada.id);
    const cuenta = await fx.crearEstudiante();
    creadas.push(cuenta.id);
    const idLeadDelEstudiante = exito(await fx.admin.from("estudiante").select("id_lead").eq("id", cuenta.id).single(), "leer el Estudiante").id_lead;
    const estudiante: Sesion = { idUsuario: cuenta.id, rol: "estudiante" };
    const sueltas = await nuevaSesion();

    const vias: [string, Sesion, string][] = [
      ["la sesión que creó el Lead", creadora, leadDeLaCreadora.id],
      ["otra sesión que confirmó el correo", confirmada, leadDeLaConfirmada.id],
      ["la cuenta de Estudiante", estudiante, idLeadDelEstudiante],
    ];
    for (const [via, sesion, esperado] of vias) {
      const corrida = await correr(sesion, examenFinal, acierta, { semilla: 1 });
      const [fila] = await diagnosticosDe(sesion.idUsuario);
      expect(fila.id, via).toBe(corrida.fin.idDiagnostico);
      expect(fila.id_lead, via).toBe(esperado);
    }

    await correr(sueltas, examenFinal, acierta, { semilla: 1 });
    expect((await diagnosticosDe(sueltas.idUsuario))[0].id_lead).toBeNull();
    // HU-068 sigue valiendo: al dejar su contacto, el Lead se queda con el diagnóstico que ya había hecho.
    const idLead = exito(
      await fx.admin.rpc("registrar_lead", {
        p_id_sesion: sueltas.idUsuario,
        p_nombre: "Lead de la prueba",
        p_correo: `prueba-${randomUUID()}@calibra.test`,
        p_numero_telefono: "",
        p_acepta_contacto: false,
        p_fecha_consentimiento: new Date().toISOString(),
        p_origen: "",
      }),
      "registrar el Lead",
    );
    leadsExtra.push(idLead);
    expect((await diagnosticosDe(sueltas.idUsuario))[0].id_lead).toBe(idLead);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Física II: el contenido real
// ---------------------------------------------------------------------------------------------------------------

describe("Física II (contenido real): un diagnóstico completo termina con el resultado guardado", () => {
  let idFisica: string;

  beforeEach(async () => {
    await prepararBanco({ fisicaII: true });
    idFisica = await idDeEvaluacion(bd, CODIGO_FISICA_II, "parcial-1");
  });

  it("de principio a fin con todo correcto: las cuatro habilidades, el resultado y la fila guardados", { timeout: 120_000 }, async () => {
    const sesion = await nuevaSesion();
    const banco = fisicaII!;
    const entrada = entradaDeReferencia(banco, "fisica-2", "parcial-1", [], 7);
    const referencia = correrReferencia(entrada, refAcierta);
    // Cuatro habilidades (una por tema) con tres preguntas revisadas cada una: hasta 8 preguntas.
    expect(entrada.habilidades.map((h) => h.clave)).toEqual(["electrostatica", "potencial", "circuitos", "magnetismo"]);
    expect(referencia.maximo).toBe(8);

    const corrida = await correr(sesion, idFisica, acierta, { semilla: 7 });

    expect(corrida.primera.evaluacion).toEqual({ id: idFisica, nombre: "Parcial 1" });
    expect(corrida.primera.materia).toEqual({ codigo: CODIGO_FISICA_II, nombre: "Física II" });
    expect(corrida.claves).toEqual(referencia.mostradas.map((m) => m.clave));
    expect(corrida.vistas.map((v) => v.pregunta)).toEqual(referencia.mostradas.map((m) => m.pregunta));
    expect(corrida.vistas.every((v) => v.maximo === 8)).toBe(true);
    expect(corrida.vistas.length).toBeLessThanOrEqual(8);

    const [fila] = await diagnosticosDe(sesion.idUsuario);
    expect(fila).toMatchObject({
      id: corrida.fin.idDiagnostico,
      id_evaluacion: idFisica,
      semilla: 7,
      repetido: false,
      puntaje: 100,
      aciertos: corrida.vistas.length,
      respondidas: corrida.vistas.length,
    });
    expect(fila.resultado_por_habilidad).toEqual(resultadoEsperado(referencia.resultado, descripcionDeHabilidad(banco, "fisica-2")));
    expect(fila.falta_material).toEqual(faltaMaterialEsperada(referencia.resultado));
    const resultado = fila.resultado_por_habilidad as ReturnType<typeof resultadoEsperado>;
    expect(resultado.habilidades.map((h) => h.habilidad)).toEqual(["electrostatica", "potencial", "circuitos", "magnetismo"]);
    expect(resultado.habilidades.every((h) => h.respuestas >= 1 && h.aciertos === h.respuestas)).toBe(true);
    expect(copiasDe(fila.respuestas).map((c) => c.clave)).toEqual(corrida.claves);
    expect(await enCursoDe(sesion.idUsuario)).toBeNull();

    // El peso de una fila en curso con el banco real de una Evaluación (las candidatas completas y el contexto).
    const otra = await nuevaSesion();
    exigirEnCurso(await iniciar(otra, idFisica, { semilla: 8 }));
    const { rows } = await bd.query<{ bytes: number; texto: number }>(
      "select pg_column_size(d.*)::int as bytes, length(d.candidatas::text) + length(d.contexto::text) as texto from public.diagnostico_en_curso d where d.id_sesion = $1",
      [otra.idUsuario],
    );
    console.info(`[HU-081] Fila en curso de Física II (12 preguntas revisadas): ${rows[0].bytes} bytes en la tabla, ${rows[0].texto} caracteres de foto.`);
    expect(rows[0].bytes).toBeLessThan(200_000);
  });

  it("con respuestas al azar coincide con el motor puro, y el segundo diagnóstico no repite las del primero", { timeout: 180_000 }, async () => {
    const sesion = await nuevaSesion();
    const banco = fisicaII!;
    for (const semilla of [1, 2, 3, 4, 5]) {
      const letra = letrasAlAzar(semilla);
      const referencia = correrReferencia(entradaDeReferencia(banco, "fisica-2", "parcial-1", [], semilla), letra);
      const uno = await correr(sesion, idFisica, alAzar(semilla), { semilla });
      expect(uno.claves, `semilla ${semilla}`).toEqual(referencia.mostradas.map((m) => m.clave));
      const [primera] = await diagnosticosDe(sesion.idUsuario);
      expect(primera.puntaje, `semilla ${semilla}`).toBe(referencia.resultado.puntaje);
      expect(primera.resultado_por_habilidad).toEqual(resultadoEsperado(referencia.resultado, descripcionDeHabilidad(banco, "fisica-2")));

      const referencia2 = correrReferencia(entradaDeReferencia(banco, "fisica-2", "parcial-1", uno.claves, semilla + 100), letrasAlAzar(semilla + 100));
      const segunda = await iniciar(sesion, idFisica, { semilla: semilla + 100 });
      if (referencia2.mostradas.length === 0) {
        expect(segunda).toMatchObject({ estado: "sin_preguntas" });
      } else {
        const dos = await completar(sesion, exigirEnCurso(segunda), alAzar(semilla + 100));
        expect(dos.claves, `semilla ${semilla}`).toEqual(referencia2.mostradas.map((m) => m.clave));
        expect(dos.claves.filter((c) => uno.claves.includes(c))).toEqual([]);
      }
      await bd.query("delete from public.diagnostico where id_sesion_anonima = $1", [sesion.idUsuario]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Paridad con el motor
// ---------------------------------------------------------------------------------------------------------------

describe("paridad con el motor: lo que guarda el servidor es lo que da el motor puro con la misma entrada", () => {
  async function comparar(sesion: Sesion, idEvaluacion: string, carpeta: string, clave: string, semilla: number) {
    const referencia = correrReferencia(entradaDeReferencia(ejemplo, carpeta, clave, [], semilla), letrasAlAzar(semilla));
    const corrida = await correr(sesion, idEvaluacion, alAzar(semilla), { semilla });
    const contexto = `${carpeta}/${clave} semilla ${semilla}`;

    expect(corrida.claves, contexto).toEqual(referencia.mostradas.map((m) => m.clave));
    expect(corrida.vistas.map((v) => v.pregunta), contexto).toEqual(referencia.mostradas.map((m) => m.pregunta));
    expect(corrida.vistas.map((v) => v.maximo), contexto).toEqual(corrida.vistas.map(() => referencia.maximo));
    const [fila] = await diagnosticosDe(sesion.idUsuario);
    expect(fila.puntaje, contexto).toBe(referencia.resultado.puntaje);
    expect(fila.resultado_por_habilidad, contexto).toEqual(resultadoEsperado(referencia.resultado, descripcionDeHabilidad(ejemplo, carpeta)));
    expect(fila.falta_material, contexto).toEqual(faltaMaterialEsperada(referencia.resultado));
    expect(fila).toMatchObject({ semilla, respondidas: referencia.pasos.length, repetido: false });
    // `aciertos` cuenta preguntas acertadas (una que mide dos habilidades cuenta una vez): lo dice el puntaje del motor.
    expect(Math.round((fila.aciertos / fila.respondidas!) * 10_000) / 100, contexto).toBe(referencia.resultado.puntaje);
    const { rows } = await bd.query<{ igual: boolean }>("select round(aciertos * 100.0 / respondidas, 2) = puntaje as igual from public.diagnostico where id = $1", [fila.id]);
    expect(rows[0].igual, contexto).toBe(true);
    await bd.query("delete from public.diagnostico where id_sesion_anonima = $1", [sesion.idUsuario]);
  }

  it("parcial-1, parcial-2 (acumulativa) y el examen final de la otra materia, con respuestas al azar", { timeout: 240_000 }, async () => {
    const sesion = await nuevaSesion();
    for (let semilla = 1; semilla <= 20; semilla++) await comparar(sesion, parcial1, "materia-a", "parcial-1", semilla);
    for (let semilla = 1; semilla <= 6; semilla++) await comparar(sesion, parcial2, "materia-a", "parcial-2", semilla);
    await comparar(sesion, examenFinal, "materia-b", "examen-final", 3);
  });

  it("el puntaje del motor es el de la base para todo n de 1 a 20 y a de 0 a n (round(a * 100.0 / n, 2))", async () => {
    const opcion = (texto: string, correcta: boolean) => ({ texto, correcta, misconcepcion: correcta ? null : "m", error: null });
    const pregunta = (clave: string): PreguntaCandidata => ({
      clave,
      tema: "t",
      enunciado: clave,
      opciones: [opcion("a", true), opcion("b", false), opcion("c", false), opcion("d", false)],
      dificultad: 2,
      habilidades: ["h"],
      solucion: null,
    });
    const { rows } = await bd.query<{ n: number; a: number; puntaje: string }>(
      "select n, a, round(a * 100.0 / n, 2)::text as puntaje from generate_series(1, 20) n cross join lateral generate_series(0, n) a",
    );
    expect(rows).toHaveLength(230);
    for (const { n, a, puntaje } of rows) {
      const candidatas = Array.from({ length: n }, (_, i) => pregunta(`Q${i}`));
      const entrada: EntradaMotor = {
        habilidades: [{ clave: "h", descripcion: "h", prerrequisitos: [] }],
        misconcepciones: [{ clave: "m", habilidad: "h", descripcion: "m" }],
        candidatas,
        vistasAntes: [],
        semilla: 1,
      };
      const pasos: CopiaDePaso[] = candidatas.map((c, i) => ({ ...c, orden: LETRAS, letraElegida: i < a ? "A" : "B", fecha: "2026-10-05T00:00:00.000Z" }));
      expect(calificar(entrada, pasos).puntaje, `${a} de ${n}`).toBe(Number(puntaje));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Purga y cron
// ---------------------------------------------------------------------------------------------------------------

describe("la purga de los diagnósticos en curso vencidos", () => {
  it("el cron calibra-purgar-diagnosticos corre cada media hora y llama a la purga", async () => {
    const { rows } = await bd.query("select schedule, command, active from cron.job where jobname = 'calibra-purgar-diagnosticos'");
    expect(rows).toEqual([{ schedule: "17,47 * * * *", command: "select privado.purgar_diagnosticos_en_curso(now())", active: true }]);
  });

  it("borra solo los vencidos de todas las sesiones, devuelve cuántos, no toca los terminados y la segunda corrida no borra nada", async () => {
    const [a, b, c, d] = [await nuevaSesion(), await nuevaSesion(), await nuevaSesion(), await nuevaSesion()];
    for (const sesion of [a, b, c]) exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    await correr(d, examenFinal, acierta, { semilla: 1 });
    await envejecer(a.idUsuario, 3 * HORA);
    await envejecer(b.idUsuario, 2 * HORA + MINUTO);

    // En una transacción que se revierte: la purga borra de verdad y puede haber otros vencidos en la base local.
    await bd.query("begin");
    try {
      const { rows: [esperados] } = await bd.query<{ n: number }>(
        "select count(*)::int as n from public.diagnostico_en_curso where actualizado_en + interval '2 hours' <= now()",
      );
      expect(esperados.n).toBeGreaterThanOrEqual(2);
      const primera = await bd.query<{ n: number }>("select privado.purgar_diagnosticos_en_curso(now()) as n");
      expect(primera.rows[0].n).toBe(esperados.n);
      const segunda = await bd.query<{ n: number }>("select privado.purgar_diagnosticos_en_curso(now()) as n");
      expect(segunda.rows[0].n).toBe(0);
      const quedan = await bd.query<{ id_sesion: string }>("select id_sesion from public.diagnostico_en_curso where id_sesion = any($1::uuid[])", [[a, b, c, d].map((s) => s.idUsuario)]);
      expect(quedan.rows.map((r) => r.id_sesion)).toEqual([c.idUsuario]);
      const terminados = await bd.query("select 1 from public.diagnostico where id_sesion_anonima = $1", [d.idUsuario]);
      expect(terminados.rows).toHaveLength(1);
    } finally {
      await bd.query("rollback");
    }
    // Lo revertido sigue ahí: nada se persistió.
    expect(await contarEnCurso()).toBe(3);
  });

  it("el borde de las 2 horas: a un segundo de vencer no se borra y a las 2 horas exactas sí", async () => {
    const sesion = await nuevaSesion();
    exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    // Como texto: JavaScript solo guarda milisegundos y la fila tiene microsegundos.
    const { rows: [borde] } = await bd.query<{ antes: string; justo: string }>(
      `select (actualizado_en + interval '2 hours' - interval '1 second')::text as antes, (actualizado_en + interval '2 hours')::text as justo
         from public.diagnostico_en_curso where id_sesion = $1`,
      [sesion.idUsuario],
    );

    await bd.query("begin");
    try {
      await bd.query("select privado.purgar_diagnosticos_en_curso($1::timestamptz)", [borde.antes]);
      expect(await contarEnCurso()).toBe(1);
      await bd.query("select privado.purgar_diagnosticos_en_curso($1::timestamptz)", [borde.justo]);
      expect(await contarEnCurso()).toBe(0);
    } finally {
      await bd.query("rollback");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Carreras con conexiones reales: cada una retiene un candado de la base y se comprueba quién espera a quién
// ---------------------------------------------------------------------------------------------------------------

const esperar = (milisegundos: number) => new Promise((resolver) => setTimeout(resolver, milisegundos));

/** Una conexión propia para una de las partes de la carrera, con su número de proceso en la base. */
async function conexion() {
  const cliente = new pg.Client({ connectionString: URL_BD });
  await cliente.connect();
  // Si algo no bloquea (o no suelta) como se espera, la consulta falla en vez de colgar la prueba.
  await cliente.query("set lock_timeout = '15s'");
  const { rows } = await cliente.query<{ pid: number }>("select pg_backend_pid() as pid");
  return { cliente, pid: rows[0].pid };
}

type Conexion = Awaited<ReturnType<typeof conexion>>;

/** Cierra las conexiones aunque tengan una consulta esperando: la base revierte su transacción y suelta los candados. */
async function cerrar(...conexiones: Conexion[]) {
  await Promise.allSettled(conexiones.map((c) => c.cliente.end()));
}

/** Una operación que se deja corriendo: se sabe si ya terminó sin esperarla, y su error no queda sin atender. */
function enMarcha<T>(promesa: PromiseLike<T>) {
  const consulta = { terminada: false, promesa: Promise.resolve(promesa) };
  consulta.promesa.then(
    () => (consulta.terminada = true),
    () => (consulta.terminada = true),
  );
  return consulta;
}

/** Espera a que `cuantas` conexiones queden esperando, directa o por otra que espera, a la conexión `pid` (pg_blocking_pids). */
async function esperarBloqueadas(pid: number, cuantas: number, ...operaciones: { terminada: boolean }[]) {
  const hasta = Date.now() + ESPERA_MAXIMA;
  let bloqueadas = 0;
  while (Date.now() < hasta) {
    const { rows } = await bd.query<{ n: number }>(
      `with recursive cadena as (
         select a.pid from pg_stat_activity a where $1::integer = any(pg_blocking_pids(a.pid))
         union
         select a.pid from pg_stat_activity a join cadena c on c.pid = any(pg_blocking_pids(a.pid))
       )
       select count(*)::int as n from cadena`,
      [pid],
    );
    bloqueadas = rows[0].n;
    if (bloqueadas >= cuantas) return;
    await esperar(50);
  }
  throw new Error(
    `Solo ${bloqueadas} de ${cuantas} conexiones quedaron esperando a la conexión ${pid} en ${ESPERA_MAXIMA} ms ` +
      `(operaciones ya terminadas: ${operaciones.filter((o) => o.terminada).length} de ${operaciones.length}).`,
  );
}

/** El candado por sesión (6801: el de registrar_lead; 6802: el de iniciar), tomado en la transacción de `conexion`. */
async function tomarCandado(conexion: Conexion, clase: 6801 | 6802, idSesion: string) {
  await conexion.cliente.query("begin");
  await conexion.cliente.query("select pg_advisory_xact_lock($1::integer, hashtext($2::text))", [clase, idSesion]);
}

const copiaDeCarrera = () => ({ clave: "P1", orden: ["A", "B", "C", "D"], letraElegida: "A", fecha: new Date().toISOString() });
const resultadoVacio = { habilidades: [], errores: [], prerrequisitos: [] };

/** `public.terminar_diagnostico` desde una conexión propia, la misma puerta que usa el módulo. */
async function terminarEn(conexion: Conexion, fila: { id: string; id_sesion: string; paso: number }) {
  const { rows } = await conexion.cliente.query<{ resultado: string; id: string | null }>(
    "select * from public.terminar_diagnostico($1::uuid, $2::uuid, $3::integer, $4::jsonb, $5::jsonb, $6::jsonb, $7::integer, $8::numeric)",
    [fila.id_sesion, fila.id, fila.paso, JSON.stringify(copiaDeCarrera()), JSON.stringify(resultadoVacio), "[]", 0, 0],
  );
  return rows[0];
}

const datosDeUnLead = (idSesion: string) => ({
  p_id_sesion: idSesion,
  p_nombre: "Lead de la carrera",
  p_correo: `carrera-${randomUUID()}@calibra.test`,
  p_numero_telefono: "",
  p_acepta_contacto: false,
  p_fecha_consentimiento: new Date().toISOString(),
  p_origen: "",
});

describe("carreras (A.5 del SPEC): los candados de la base ponen a cada quien en su lugar", () => {
  it("terminar contra registrar_lead, primero el Lead: terminar espera el candado 6801 y el diagnóstico nace con id_lead", async () => {
    const sesion = await nuevaSesion();
    const ultima = await hastaLaUltima(sesion, 4);
    const lead = await conexion();
    try {
      await tomarCandado(lead, 6801, sesion.idUsuario);
      const { rows } = await lead.cliente.query<{ id: string }>(
        `insert into public.lead (id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento)
         values ($1, 'Lead de la carrera', $2, true, now()) returning id`,
        [sesion.idUsuario, `carrera-${randomUUID()}@calibra.test`],
      );
      leadsExtra.push(rows[0].id);

      const final = enMarcha(responder(sesion, ultima, acierta(ultima)));
      await esperarBloqueadas(lead.pid, 1, final);
      expect(final.terminada).toBe(false);
      await lead.cliente.query("commit");

      expect(await final.promesa).toEqual({ estado: "terminado", idDiagnostico: ultima.idDiagnostico });
      expect((await diagnosticosDe(sesion.idUsuario))[0].id_lead).toBe(rows[0].id);
    } finally {
      await cerrar(lead);
    }
  });

  it("terminar contra registrar_lead, primero terminar: registrar_lead espera el candado 6801 y después le liga el diagnóstico", async () => {
    const sesion = await nuevaSesion();
    await hastaLaUltima(sesion, 4);
    const fila = (await enCursoDe(sesion.idUsuario))!;
    const termina = await conexion();
    try {
      await termina.cliente.query("begin");
      expect(await terminarEn(termina, fila)).toEqual({ resultado: "terminado", id: fila.id });

      const registro = enMarcha(fx.admin.rpc("registrar_lead", datosDeUnLead(sesion.idUsuario)));
      await esperarBloqueadas(termina.pid, 1, registro);
      expect(registro.terminada).toBe(false);
      await termina.cliente.query("commit");

      const { data, error } = await registro.promesa;
      expect(error).toBeNull();
      leadsExtra.push(data as string);
      expect((await diagnosticosDe(sesion.idUsuario))[0].id_lead).toBe(data);
    } finally {
      await cerrar(termina);
    }
  });

  it("dos terminar a la vez de la misma sesión (doble clic en la última): una fila, las dos reciben terminado", async () => {
    const sesion = await nuevaSesion();
    const ultima = await hastaLaUltima(sesion, 4);
    const sostiene = await conexion();
    try {
      // Las dos llegan a terminar_diagnostico con el candado ocupado: la primera espera el candado y la segunda, la fila de la primera.
      await tomarCandado(sostiene, 6801, sesion.idUsuario);
      const una = enMarcha(responder(sesion, ultima, acierta(ultima)));
      const otra = enMarcha(responder(sesion, ultima, acierta(ultima)));
      await esperarBloqueadas(sostiene.pid, 2, una, otra);
      await sostiene.cliente.query("commit");

      const fin = { estado: "terminado", idDiagnostico: ultima.idDiagnostico };
      expect(await una.promesa).toEqual(fin);
      expect(await otra.promesa).toEqual(fin);
      expect(await diagnosticosDe(sesion.idUsuario)).toHaveLength(1);
      expect(await enCursoDe(sesion.idUsuario)).toBeNull();
    } finally {
      await cerrar(sostiene);
    }
  });

  it("dos iniciar a la vez de la misma sesión: el candado 6802 los pone en fila, una sola fila y la misma pregunta en las dos", async () => {
    const sesion = await nuevaSesion();
    const sostiene = await conexion();
    try {
      await tomarCandado(sostiene, 6802, sesion.idUsuario);
      const una = enMarcha(iniciar(sesion, parcial1));
      const otra = enMarcha(iniciar(sesion, parcial1));
      await esperarBloqueadas(sostiene.pid, 2, una, otra);
      await sostiene.cliente.query("commit");

      const [primera, segunda] = [exigirEnCurso(await una.promesa), exigirEnCurso(await otra.promesa)];
      expect(primera).toEqual(segunda);
      expect(await contarEnCurso()).toBe(1);
      expect((await enCursoDe(sesion.idUsuario))!.id).toBe(primera.idDiagnostico);
    } finally {
      await cerrar(sostiene);
    }
  });

  it("dos respuestas al mismo paso con la fila ocupada: las dos llegan a la escritura y solo una se aplica (compare-and-swap)", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    const sostiene = await conexion();
    try {
      await sostiene.cliente.query("begin");
      await sostiene.cliente.query("select 1 from public.diagnostico_en_curso where id = $1 for update", [primera.idDiagnostico]);
      const una = enMarcha(responder(sesion, primera, "A"));
      const otra = enMarcha(responder(sesion, primera, "B"));
      await esperarBloqueadas(sostiene.pid, 2, una, otra);
      await sostiene.cliente.query("commit");

      const [x, y] = [exigirEnCurso(await una.promesa), exigirEnCurso(await otra.promesa)];
      expect(x).toMatchObject({ idDiagnostico: primera.idDiagnostico, paso: 1 });
      expect(y).toEqual(x);
      const fila = (await enCursoDe(sesion.idUsuario))!;
      expect(fila.paso).toBe(1);
      expect(fila.pasos as unknown[]).toHaveLength(1);
      expect(["A", "B"]).toContain(copiasDe(fila.pasos)[0].letraElegida);
    } finally {
      await cerrar(sostiene);
    }
  });

  it("dos respuestas distintas al mismo paso (una bien y otra mal) con la fila ocupada: se aplica una y las dos reciben la pregunta que sigue de esa", async () => {
    const { semilla, paso } = buscarBifurcacion();
    const sesion = await nuevaSesion();
    let vista = exigirEnCurso(await iniciar(sesion, parcial1, { semilla }));
    while (vista.paso < paso) vista = exigirEnCurso(await responder(sesion, vista, acierta(vista)));
    const sostiene = await conexion();
    try {
      await sostiene.cliente.query("begin");
      await sostiene.cliente.query("select 1 from public.diagnostico_en_curso where id = $1 for update", [vista.idDiagnostico]);
      const bien = enMarcha(responder(sesion, vista, acierta(vista)));
      const mal = enMarcha(responder(sesion, vista, falla(vista)));
      await esperarBloqueadas(sostiene.pid, 2, bien, mal);
      await sostiene.cliente.query("commit");

      const [x, y] = [exigirEnCurso(await bien.promesa), exigirEnCurso(await mal.promesa)];
      // La que no se aplicó no puede contestar con la pregunta que habría seguido de su respuesta: devuelve el estado de la base.
      expect(y).toEqual(x);
      expect(x.paso).toBe(paso + 1);
      expect(await consultar(sesion)).toEqual(x);
      expect(copiasDe((await enCursoDe(sesion.idUsuario))!.pasos)).toHaveLength(paso + 1);
    } finally {
      await cerrar(sostiene);
    }
  });

  it("responder contra la purga con la hora justo en el borde: la purga espera la fila y no borra la que acaba de refrescarse", async () => {
    const sesion = await nuevaSesion();
    const primera = exigirEnCurso(await iniciar(sesion, parcial1, { semilla: 1 }));
    // Vence en 30 segundos: la purga de dentro de cinco minutos la borraría si no fuera porque responder la refresca.
    await envejecer(sesion.idUsuario, 2 * HORA - 30_000);
    const responde = await conexion();
    const purga = await conexion();
    try {
      await responde.cliente.query("begin");
      const { rows } = await responde.cliente.query<{ aplicada: boolean }>("select public.responder_diagnostico($1::uuid, $2::uuid, 0, $3::jsonb) as aplicada", [
        sesion.idUsuario,
        primera.idDiagnostico,
        JSON.stringify(copiaDeCarrera()),
      ]);
      expect(rows[0].aplicada).toBe(true);

      const borrando = enMarcha(purga.cliente.query("select privado.purgar_diagnosticos_en_curso(now() + interval '5 minutes') as n"));
      await esperarBloqueadas(responde.pid, 1, borrando);
      await responde.cliente.query("commit");
      await borrando.promesa;

      expect(await contarEnCurso()).toBe(1);
      expect((await enCursoDe(sesion.idUsuario))!.paso).toBe(1);
    } finally {
      await cerrar(responde, purga);
    }
  });

  it("terminar contra iniciar de otra Evaluación: el reemplazo espera la fila de terminar y el diagnóstico terminado queda", async () => {
    const sesion = await nuevaSesion();
    const ultima = await hastaLaUltima(sesion, 4);
    const fila = (await enCursoDe(sesion.idUsuario))!;
    const termina = await conexion();
    try {
      await termina.cliente.query("begin");
      expect(await terminarEn(termina, fila)).toEqual({ resultado: "terminado", id: fila.id });

      const otra = enMarcha(iniciar(sesion, parcial2, { semilla: 9 }));
      await esperarBloqueadas(termina.pid, 1, otra);
      await termina.cliente.query("commit");

      const nueva = exigirEnCurso(await otra.promesa);
      expect(nueva.evaluacion.id).toBe(parcial2);
      expect(nueva.idDiagnostico).not.toBe(ultima.idDiagnostico);
      expect(await diagnosticosDe(sesion.idUsuario)).toHaveLength(1);
      expect(await contarEnCurso()).toBe(1);
      expect((await enCursoDe(sesion.idUsuario))!.id).toBe(nueva.idDiagnostico);
    } finally {
      await cerrar(termina);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// La migración
// ---------------------------------------------------------------------------------------------------------------

describe("criterio 12: la migración reemplaza resultado_por_tema", () => {
  it("diagnostico tiene resultado_por_habilidad y ya no resultado_por_tema; las columnas nuevas existen", async () => {
    const { rows } = await bd.query<{ column_name: string; is_generated: string }>(
      "select column_name, is_generated from information_schema.columns where table_schema = 'public' and table_name = 'diagnostico'",
    );
    const columnas = rows.map((r) => r.column_name);
    expect(columnas).not.toContain("resultado_por_tema");
    expect(columnas).toEqual(expect.arrayContaining(["resultado_por_habilidad", "semilla", "repetido", "respondidas", "aciertos", "falta_material"]));
    expect(rows.find((r) => r.column_name === "respondidas")?.is_generated).toBe("ALWAYS");
    const { rows: sobras } = await bd.query("select 1 from information_schema.columns where column_name = 'resultado_por_tema' and table_schema = 'public'");
    expect(sobras).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Sesiones de verdad: lo que leen la dueña, el Lead, el Estudiante, el monitor y el admin por la Data API
// ---------------------------------------------------------------------------------------------------------------

describe("criterios 4, 7 y 11 con sesiones de verdad", () => {
  type SesionDeVerdad = { cliente: Cliente; id: string };
  const COLUMNAS_SIN_LECTURA = ["respuestas", "semilla", "repetido", "respondidas", "aciertos", "falta_material", "token_recuperacion"];
  const TABLAS_DEL_BANCO = ["tema", "habilidad", "habilidad_prerrequisito", "misconcepcion", "pregunta", "pregunta_habilidad", "opcion", "evaluacion_tema"] as const;

  /** Las sesiones se crean una sola vez para el archivo (el Auth local limita las anónimas por hora y los inicios con contraseña cada 5 minutos). */
  let sesiones: Fixtures;
  let duena: SesionDeVerdad;
  let delLead: SesionDeVerdad;
  let ajena: SesionDeVerdad;
  let estudiante: SesionDeVerdad;
  let monitor: SesionDeVerdad & { usuario: UsuarioPrueba };
  let admin: SesionDeVerdad;
  let anonimo: Cliente;

  beforeAll(async () => {
    sesiones = new Fixtures();
    try {
      duena = await sesiones.crearAnonimo();
      delLead = await sesiones.crearAnonimo();
      ajena = await sesiones.crearAnonimo();
      anonimo = crearCliente();
      const deEstudiante = await sesiones.crearUsuario();
      estudiante = { cliente: await sesiones.iniciarSesion(deEstudiante), id: deEstudiante.id };
      const deMonitor = await sesiones.crearMonitor();
      monitor = { cliente: await sesiones.iniciarSesion(deMonitor), id: deMonitor.id, usuario: deMonitor };
      const deAdmin = await sesiones.crearAdmin();
      admin = { cliente: await sesiones.iniciarSesion(deAdmin), id: deAdmin.id };
    } catch (error) {
      await sesiones.limpiar();
      throw error;
    }
  });

  afterAll(async () => {
    await sesiones?.limpiar();
  });

  /** Lo que una prueba le pone a las sesiones compartidas, fuera de lo que borra `fx`: se quita antes de que `fx` borre el Lead y la materia. */
  afterEach(async () => {
    const ids = [duena, delLead, ajena, estudiante].map((s) => s.id);
    await bd.query("delete from public.diagnostico where id_sesion_anonima = any($1::uuid[])", [ids]);
    await bd.query("delete from public.diagnostico_en_curso where id_sesion = any($1::uuid[])", [ids]);
    await bd.query("delete from public.estudiante where id = $1", [estudiante.id]);
    await bd.query("delete from public.lead_sesion where id_sesion = any($1::uuid[])", [ids]);
    // El monitor es de todo el archivo: sus citas y su certificado (que apunta a la materia del banco de prueba) se van antes que la materia.
    await bd.query("delete from public.monitoria where id_monitor = $1", [monitor.id]);
    await bd.query("delete from public.certificado where id_monitor = $1", [monitor.id]);
  });

  const comoSesion = (s: { id: string }, rol: Sesion["rol"] = "anonimo"): Sesion => ({ idUsuario: s.id, rol });

  /** La dueña es Lead; otra sesión suya (enlace de verificación) y la cuenta de Estudiante son del mismo Lead. */
  async function armarLead() {
    const lead = await fx.crearLeadDeSesion(duena.id);
    exito(await fx.admin.from("lead_sesion").insert({ id_sesion: delLead.id, id_lead: lead.id }).select().single(), "ligar la otra sesión al Lead");
    exito(await fx.admin.from("estudiante").insert({ id: estudiante.id, id_lead: lead.id }).select().single(), "crear el Estudiante del Lead");
    return lead;
  }

  /** El monitor de una cita que apunta a ese diagnóstico (RN-13: lo ve para dictarla). */
  async function citaDelMonitor(idDiagnostico: string) {
    // La cita es de la materia del diagnóstico (la llave compuesta de monitoria lo exige).
    const { id_materia: idMateria } = exito(await fx.admin.from("diagnostico").select("id_materia").eq("id", idDiagnostico).single(), "leer la materia del diagnóstico");
    const materia = exito(await fx.admin.from("materia").select("*").eq("id", idMateria).single(), "leer la materia");
    await fx.crearCertificado({ idMonitor: monitor.id, idMateria, idAdmin: admin.id });
    const franja = await fx.crearFranja({ idMonitor: monitor.id, dia: 1 });
    const lead = await fx.crearLead();
    // 2030-01-07 cae en lunes, el día de la franja.
    const monitoria = await fx.crearMonitoria({ materia, monitor: monitor.usuario, franja, lead }, { fecha: "2030-01-07" });
    exito(await fx.admin.from("monitoria").update({ id_diagnostico: idDiagnostico }).eq("id", monitoria.id).select().single(), "ligar el diagnóstico a la cita");
  }

  it("criterio 11: ninguna sesión lee diagnostico_en_curso, el banco ni las copias y la semilla; sí resultado_por_habilidad y puntaje de lo suyo", async () => {
    await armarLead();
    // La dueña termina uno (nace con el Lead) y deja otro en curso; la ajena también tiene uno en curso.
    const terminado = await correr(comoSesion(duena), examenFinal, falla, { semilla: 1 });
    exigirEnCurso(await iniciar(comoSesion(duena), parcial1, { semilla: 2 }));
    exigirEnCurso(await iniciar(comoSesion(ajena), parcial1, { semilla: 3 }));
    const idDiagnostico = terminado.fin.idDiagnostico;
    await citaDelMonitor(idDiagnostico);
    const guardado = exito(await fx.admin.from("diagnostico").select("puntaje, resultado_por_habilidad").eq("id", idDiagnostico).single(), "leer lo guardado");

    const actores: [string, Cliente, boolean][] = [
      ["la dueña", duena.cliente, true],
      ["otra sesión del Lead", delLead.cliente, true],
      ["la cuenta de Estudiante del Lead", estudiante.cliente, true],
      ["el monitor de la cita", monitor.cliente, true],
      ["el admin", admin.cliente, true],
      ["una sesión ajena", ajena.cliente, false],
    ];
    for (const [actor, cliente, loVe] of actores) {
      const enCurso = await cliente.from("diagnostico_en_curso").select();
      expect(enCurso.error?.code, `${actor}: diagnostico_en_curso`).toBe("42501");
      expect(enCurso.data).toBeNull();
      for (const tabla of TABLAS_DEL_BANCO) {
        const lectura = await cliente.from(tabla).select();
        expect(lectura.error?.code, `${actor}: ${tabla}`).toBe("42501");
      }
      for (const columna of COLUMNAS_SIN_LECTURA) {
        const lectura = await cliente.from("diagnostico").select(`id, ${columna}`).eq("id", idDiagnostico);
        expect(lectura.error?.code, `${actor}: diagnostico.${columna}`).toBe("42501");
      }
      expect((await cliente.from("diagnostico").select()).error?.code, `${actor}: diagnostico.*`).toBe("42501");

      const suyo = await cliente.from("diagnostico").select("id, puntaje, resultado_por_habilidad").eq("id", idDiagnostico);
      expect(suyo.error, actor).toBeNull();
      if (loVe) expect(suyo.data, actor).toEqual([{ id: idDiagnostico, puntaje: guardado.puntaje, resultado_por_habilidad: guardado.resultado_por_habilidad }]);
      else expect(suyo.data, actor).toEqual([]);
    }

    // Sin sesión (anon): ni siquiera la tabla.
    expect((await anonimo.from("diagnostico_en_curso").select()).error?.code).toBe("42501");
    expect((await anonimo.from("diagnostico").select("id")).error?.code).toBe("42501");
    for (const tabla of TABLAS_DEL_BANCO) expect((await anonimo.from(tabla).select()).error?.code, `anon: ${tabla}`).toBe("42501");
  });

  it("criterio 11: las funciones del servidor no las ejecuta ninguna sesión, ni con sesión ni sin ella", async () => {
    const id = randomUUID();
    const llamadas = (c: Cliente) => [
      ["banco_de_la_evaluacion", c.rpc("banco_de_la_evaluacion", { p_id_evaluacion: parcial1 })],
      ["vistas_de_la_sesion", c.rpc("vistas_de_la_sesion", { p_id_sesion: id, p_id_evaluacion: parcial1 })],
      ["diagnostico_en_curso_de", c.rpc("diagnostico_en_curso_de", { p_id_sesion: id })],
      [
        "iniciar_diagnostico",
        c.rpc("iniciar_diagnostico", {
          p_id_sesion: id,
          p_id_evaluacion: parcial1,
          p_semilla: 1,
          p_vistas_antes: [],
          p_repetido: false,
          p_candidatas: [],
          p_contexto: {},
        }),
      ],
      ["responder_diagnostico", c.rpc("responder_diagnostico", { p_id_sesion: id, p_id: id, p_paso: 0, p_copia: {} })],
      [
        "terminar_diagnostico",
        c.rpc("terminar_diagnostico", {
          p_id_sesion: id,
          p_id: id,
          p_paso: 0,
          p_copia: {},
          p_resultado: {},
          p_falta_material: [],
          p_aciertos: 0,
          p_puntaje: 0,
        }),
      ],
    ] as const;
    for (const [actor, cliente] of [
      ["anon", anonimo],
      ["la dueña", duena.cliente],
      ["el Estudiante", estudiante.cliente],
      ["el monitor", monitor.cliente],
      ["el admin", admin.cliente],
    ] as const) {
      for (const [nombre, llamada] of llamadas(cliente)) {
        const { error } = await llamada;
        expect(error?.code, `${actor}: ${nombre}`).toBe("42501");
        // Es el permiso de la propia puerta el que falta, no el de lo que ella llama (el de las tablas del banco, por ejemplo).
        expect(error?.message, `${actor}: ${nombre}`).toMatch(new RegExp(`permission denied for function ${nombre}$`));
      }
    }
    // Y nada se escribió con esos intentos.
    const { rows } = await bd.query("select 1 from public.diagnostico_en_curso where id_sesion = $1", [id]);
    expect(rows).toEqual([]);
  });

  it("criterio 7: lo que leen la dueña, el Lead, el monitor y el admin no trae la marca de falta de material ni su motivo", async () => {
    await armarLead();
    const sesion = comoSesion(duena);
    await correr(sesion, parcial1, acierta, { semilla: 1 });
    const dos = await correr(sesion, parcial1, acierta, { semilla: 101 });
    await citaDelMonitor(dos.fin.idDiagnostico);

    // La marca está guardada, y solo la lee la llave secreta.
    const guardado = exito(await fx.admin.from("diagnostico").select("falta_material, resultado_por_habilidad").eq("id", dos.fin.idDiagnostico).single(), "leer");
    expect(guardado.falta_material).toEqual([
      { habilidad: "cadena", motivos: ["sin_preguntas_sin_ver"] },
      { habilidad: "potencia", motivos: ["sin_preguntas_sin_ver"] },
    ]);
    for (const [actor, cliente] of [
      ["la dueña", duena.cliente],
      ["otra sesión del Lead", delLead.cliente],
      ["el Estudiante", estudiante.cliente],
      ["el monitor de la cita", monitor.cliente],
      ["el admin", admin.cliente],
    ] as const) {
      const lectura = await cliente.from("diagnostico").select("id, puntaje, resultado_por_habilidad, fecha_realizacion").eq("id", dos.fin.idDiagnostico);
      expect(lectura.error, actor).toBeNull();
      expect(lectura.data, actor).toHaveLength(1);
      const texto = JSON.stringify(lectura.data);
      expect(texto, actor).not.toMatch(/faltaMaterial|falta_material|sin_preguntas_sin_ver|tope_una_respuesta/);
      expect(lectura.data![0].resultado_por_habilidad, actor).toEqual(guardado.resultado_por_habilidad);
      expect(Object.keys(lectura.data![0].resultado_por_habilidad as object).sort(), actor).toEqual(["errores", "habilidades", "prerrequisitos"]);
      const pedida = await cliente.from("diagnostico").select("id, falta_material").eq("id", dos.fin.idDiagnostico);
      expect(pedida.error?.code, `${actor}: falta_material`).toBe("42501");
    }
  });

  it("el diagnóstico de una sesión del Lead nace con el Lead: la otra sesión del Lead y el Estudiante lo leen aunque lo haya terminado la dueña", async () => {
    const lead = await armarLead();
    const terminado = await correr(comoSesion(duena), examenFinal, acierta, { semilla: 1 });

    const [fila] = await diagnosticosDe(duena.id);
    expect(fila.id_lead).toBe(lead.id);
    for (const cliente of [delLead.cliente, estudiante.cliente]) {
      const lectura = await cliente.from("diagnostico").select("id").eq("id", terminado.fin.idDiagnostico);
      expect(lectura.data).toEqual([{ id: terminado.fin.idDiagnostico }]);
    }
    expect((await ajena.cliente.from("diagnostico").select("id").eq("id", terminado.fin.idDiagnostico)).data).toEqual([]);
  });

  it("criterio 4: agendar no liga un diagnóstico en curso, y sí uno terminado aunque haya otro en curso", async () => {
    // La materia, el monitor certificado y su franja dentro de 2 días, como en integracion/agendar.test.ts.
    const sumarDias = (fecha: string, dias: number) => {
      const instante = new Date(`${fecha}T12:00:00Z`);
      instante.setUTCDate(instante.getUTCDate() + dias);
      return instante.toISOString().slice(0, 10);
    };
    const quien = await fx.crearAdmin();
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const deMonitor = await fx.crearMonitor();
    await fx.crearCertificado({ idMonitor: deMonitor.id, idMateria: materia.id, idAdmin: quien.id });
    const hoy = diaDelNegocio(new Date());
    const primera = sumarDias(hoy, 2);
    const franja = await fx.crearFranja({ idMonitor: deMonitor.id, dia: diaIsoDeFecha(primera), hora: "10:00", precio: 32_000, duracionMin: 90, abiertaDesde: hoy });
    const pedido = (fecha: string): PedidoDeAgendar => ({ idFranja: franja.id, fecha, codigoMateria: materia.codigo });
    await fx.crearLeadDeSesion(duena.id);
    const filaDe = async (id: string) => exito(await fx.admin.from("monitoria").select("id, id_diagnostico, estado").eq("id", id).single(), "leer la monitoría");

    // Un diagnóstico en curso y ninguno terminado: la cita queda sin diagnóstico (D-3).
    exito(
      await fx.admin
        .from("diagnostico_en_curso")
        .insert({ id_sesion: duena.id, id_evaluacion: evaluacion.id, id_materia: materia.id, semilla: 1, candidatas: [], contexto: {} })
        .select()
        .single(),
      "insertar el diagnóstico en curso",
    );
    const sinDiagnostico = await agendarMonitoria(duena.cliente, pedido(primera), true);
    expect(sinDiagnostico.resultado).toBe("agendada");
    fx.registrarMonitoria(sinDiagnostico.idMonitoria!);
    expect((await filaDe(sinDiagnostico.idMonitoria!)).id_diagnostico).toBeNull();

    // Con uno terminado de la sesión (y el otro todavía en curso) la cita nueva liga el terminado.
    exito(await fx.admin.from("monitoria").update({ estado: "cancelada", motivo_cancelacion: "reserva_expirada" }).eq("id", sinDiagnostico.idMonitoria!).select().single(), "cancelar");
    const terminado = await fx.crearDiagnostico({ idSesionAnonima: duena.id, idEvaluacion: evaluacion.id, idMateria: materia.id });
    const conDiagnostico = await agendarMonitoria(duena.cliente, pedido(sumarDias(primera, 7)), true);
    expect(conDiagnostico.resultado).toBe("agendada");
    fx.registrarMonitoria(conDiagnostico.idMonitoria!);
    expect((await filaDe(conDiagnostico.idMonitoria!)).id_diagnostico).toBe(terminado.id);
    expect((await enCursoDe(duena.id))?.id_evaluacion).toBe(evaluacion.id);
  });
});
