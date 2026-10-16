import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sesion } from "@/lib/auth/sesion";
import { leerMiDiagnostico } from "@/lib/diagnostico/lectura";
import { CLAVES_DEL_RESULTADO, type ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import {
  calificar,
  LETRAS,
  opcionElegida,
  paraNavegador,
  siguientePregunta,
  type CopiaDePaso,
  type EntradaMotor,
  type PreguntaCandidata,
} from "@/lib/diagnostico/motor";
import type { EnCurso } from "@/lib/diagnostico/reglas";
import { cargarEvaluacionesActivas } from "@/lib/diagnostico/selector";
import { iniciarDiagnostico, responderDiagnostico } from "@/lib/diagnostico/servidor";
import type { Banco } from "../scripts/contenido/modelo.mts";
import { CLAVES_INTERNAS_DE_EJEMPLO, sembrarDiagnostico } from "../pruebas/diagnostico-sembrado";
import { activarEvaluacion, borrarBancoDePrueba, cargarBancoDePrueba, CODIGO_A, CODIGO_B, idDeEvaluacion } from "./banco-de-prueba";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente } from "./utilidades";

/**
 * HU-009 contra el Supabase LOCAL: lo que lee la persona de un diagnóstico terminado, `public.mi_diagnostico(id)`, con sesiones
 * de verdad (la Data API con el JWT de cada una), y el selector de materias con el PostgREST real.
 *
 * - El recorrido completo (D.3-1): se hace un diagnóstico con las operaciones reales de HU-081 y `leerMiDiagnostico` devuelve lo
 *   que el motor calificaría con las mismas respuestas, calculado desde el banco leído del disco. Es la prueba de que lo que
 *   guarda HU-081 es lo que lee HU-009.
 * - Quién lo lee (D.3-2 y D.3-3): la sesión que lo hizo y la cuenta de Estudiante de su Lead sí; otra sesión, la sesión que creó
 *   el Lead, una sesión ligada por `lead_sesion` (el enlace de P-23) y la cuenta de Estudiante de otro Lead, no (D-53 e).
 * - Qué sale (D.3-4): ninguna clave fuera de `CLAVES_DEL_RESULTADO` ni el token de recuperación.
 * - El selector (B5): `cargarEvaluacionesActivas` de verdad, con el cliente anónimo en lugar del de las cookies.
 *
 * Las acciones (`acciones.ts`) no se prueban aquí: necesitan una petición de Next y se prueban con Vitest y el módulo simulado.
 *
 * Presupuesto del Auth local (150 sesiones anónimas por hora y 30 inicios con contraseña cada 5 minutos, de toda la suite): las
 * cuatro sesiones anónimas y los dos inicios con contraseña se crean una sola vez para todo el archivo.
 */

// El selector llama a `crearClienteServidor()`, que lee las cookies de una petición de Next y aquí no hay ninguna: se le da el
// cliente anónimo de la API, que es lo que recibe una primera visita (todavía sin sesión).
vi.mock("@/lib/supabase/servidor", async () => {
  const { crearCliente: clienteAnonimo } = await import("./utilidades");
  return { crearClienteServidor: async () => clienteAnonimo() };
});

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
/** Las cinco preguntas candidatas de `parcial-1` del ejemplo: con todas vistas, una sesión del Lead no tiene preguntas nuevas. */
const PREGUNTAS_DE_PARCIAL_1 = ["P1", "P2", "P3", "P4", "P5"];

type Persona = { cliente: Cliente; id: string };

let bd: pg.Client;
let fx: Fixtures | undefined;
let ejemplo: Banco;
let parcial1: string;
/** Los diagnósticos que creó la prueba en curso: se borran al terminar (los de las sesiones se irían con ellas, pero no con el Lead). */
let diagnosticos: string[] = [];

let duena: Persona;
let otra: Persona;
let creadora: Persona;
let ligada: Persona;
let estudianteDelLead: Cliente;
let estudianteAjeno: Cliente;
let lead: { id: string };

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();

  ({ ejemplo } = await cargarBancoDePrueba(bd));
  parcial1 = await idDeEvaluacion(bd, CODIGO_A, "parcial-1");

  fx = new Fixtures();
  duena = await fx.crearAnonimo();
  otra = await fx.crearAnonimo();
  creadora = await fx.crearAnonimo();
  ligada = await fx.crearAnonimo();

  // El Lead lo creó `creadora` (como al dejar el contacto), la sesión `ligada` lo confirmó por el enlace de P-23 (`lead_sesion`) y
  // tiene una cuenta de Estudiante. `estudianteAjeno` es la cuenta de otro Lead.
  lead = await fx.crearLeadDeSesion(creadora.id);
  exito(await fx.admin.from("lead_sesion").insert({ id_sesion: ligada.id, id_lead: lead.id }).select().single(), "ligar la sesión al Lead");
  const cuenta = await fx.crearUsuario();
  exito(await fx.admin.from("estudiante").insert({ id: cuenta.id, id_lead: lead.id }).select().single(), "insertar la cuenta de Estudiante del Lead");
  estudianteDelLead = await fx.iniciarSesion(cuenta);
  estudianteAjeno = await fx.iniciarSesion(await fx.crearEstudiante());
});

afterEach(async () => {
  if (diagnosticos.length) await bd.query("delete from public.diagnostico where id = any($1::uuid[])", [diagnosticos]);
  diagnosticos = [];
});

afterAll(async () => {
  try {
    await fx?.limpiar();
  } finally {
    try {
      if (bd) await borrarBancoDePrueba(bd);
    } finally {
      await bd?.end();
    }
  }
});

/** Siembra con la llave secreta (la base, no la aplicación) y lo anota para borrarlo. */
async function sembrar(datos: Omit<Parameters<typeof sembrarDiagnostico>[1], "idEvaluacion">) {
  const sembrado = await sembrarDiagnostico(bd, { idEvaluacion: parcial1, ...datos });
  diagnosticos.push(sembrado.id);
  return sembrado;
}

// ---------------------------------------------------------------------------------------------------------------
// El motor puro como referencia: la entrada se arma desde el banco leído del disco (no desde lo que guardó la base)
// ---------------------------------------------------------------------------------------------------------------

const porClave = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * La `EntradaMotor` que arma el servidor, pero desde el banco en memoria y no desde la foto de la base: el orden de las
 * habilidades es el de la base (`tema.orden` y luego `clave`), `materia` de un prerrequisito es el nombre de la otra materia y su
 * `descripcion` la de la habilidad destino. Es la misma construcción de `integracion/diagnostico.test.ts` (HU-081).
 */
function entradaDeReferencia(banco: Banco, carpeta: string, evaluacion: string, semilla: number): EntradaMotor {
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
  return { habilidades, misconcepciones, candidatas, vistasAntes: [], semilla };
}

/** Lo que haría el motor puro con una persona que contesta mal todas las preguntas menos la tercera. */
function correrReferencia(entrada: EntradaMotor) {
  const pasos: CopiaDePaso[] = [];
  for (;;) {
    const siguiente = siguientePregunta(entrada, pasos);
    if ("terminado" in siguiente) break;
    const candidata = entrada.candidatas.find((c) => c.clave === siguiente.clave)!;
    const posicionDeLaCorrecta = siguiente.orden.findIndex((letra) => candidata.opciones[LETRAS.indexOf(letra)].correcta);
    // La tercera, bien; las demás, la opción que sigue a la correcta (una trampa). Con la semilla 11 son 4 preguntas, un acierto,
    // niveles distintos y tres errores en sospecha, uno de ellos con el texto de error propio de la opción.
    const posicion = pasos.length === 2 ? posicionDeLaCorrecta : (posicionDeLaCorrecta + 1) % LETRAS.length;
    pasos.push({ ...candidata, orden: siguiente.orden, letraElegida: LETRAS[posicion], fecha: "2026-10-05T00:00:00.000Z" });
  }
  return { pasos, resultado: calificar(entrada, pasos) };
}

/** Lo que la persona debe ver de lo que calificó el motor, armado sin pasar por `proyectarResultado`. */
function esperadoDe(referencia: ReturnType<typeof correrReferencia>) {
  const { pasos, resultado } = referencia;
  const descripcionPorHabilidad = new Map(resultado.habilidades.map((h) => [h.habilidad, h.descripcion]));
  return {
    respondidas: pasos.length,
    aciertos: pasos.filter((paso) => opcionElegida(paso).correcta).length,
    habilidades: resultado.habilidades.map((h) => ({ descripcion: h.descripcion, nivel: h.nivel, respuestas: h.respuestas, aciertos: h.aciertos })),
    errores: resultado.errores.map((e) => ({
      titulo: e.texto,
      estado: e.estado,
      descripcionDeLaHabilidad: descripcionPorHabilidad.get(e.habilidad) ?? null,
      detalles: e.detalles,
    })),
    prerrequisitos: resultado.prerrequisitos.map((p) => ({ materia: p.materia, descripcion: p.descripcion })),
  };
}

function exigirEnCurso(respuesta: { estado: string }): EnCurso {
  expect(respuesta.estado).toBe("en_curso");
  return respuesta as EnCurso;
}

/** Todas las claves de un valor, anidadas incluidas. */
function clavesDe(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(clavesDe);
  if (typeof valor !== "object" || valor === null) return [];
  return Object.entries(valor).flatMap(([clave, interior]) => [clave, ...clavesDe(interior)]);
}

// ---------------------------------------------------------------------------------------------------------------
// D.3-1: el recorrido completo contra el motor
// ---------------------------------------------------------------------------------------------------------------

describe("el recorrido completo: lo que guarda HU-081 es lo que lee HU-009", () => {
  it("después de responder todo, la dueña lee los niveles, los errores, las cifras y los prerrequisitos que calificó el motor", async () => {
    const semilla = 11;
    const sesion: Sesion = { idUsuario: duena.id, rol: "anonimo" };
    const referencia = correrReferencia(entradaDeReferencia(ejemplo, "materia-a", "parcial-1", semilla));
    const esperado = esperadoDe(referencia);
    // Sin esto la comparación podría pasar con un resultado vacío: se hacen varias preguntas, se falla alguna y hay un error.
    expect(referencia.pasos.length).toBeGreaterThanOrEqual(3);
    expect(esperado.aciertos).toBeLessThan(esperado.respondidas);
    expect(esperado.errores.length).toBeGreaterThan(0);

    let vista = exigirEnCurso(await iniciarDiagnostico(sesion, { idEvaluacion: parcial1 }, { semilla }));
    for (const [i, paso] of referencia.pasos.entries()) {
      // La pregunta que muestra el servidor es la que el motor eligió, con las opciones en el mismo orden.
      expect(vista.pregunta, `pregunta ${i + 1}`).toEqual(paraNavegador(paso, paso.orden));
      const respuesta = await responderDiagnostico(sesion, { idDiagnostico: vista.idDiagnostico, paso: vista.paso, letra: paso.letraElegida });
      if (i < referencia.pasos.length - 1) {
        vista = exigirEnCurso(respuesta);
        continue;
      }
      expect(respuesta).toEqual({ estado: "terminado", idDiagnostico: vista.idDiagnostico });
    }
    diagnosticos.push(vista.idDiagnostico);

    const leido = await leerMiDiagnostico(duena.cliente, vista.idDiagnostico);
    expect(leido).not.toBeNull();
    const resultado = leido as ResultadoParaMostrar;
    expect(resultado.idDiagnostico).toBe(vista.idDiagnostico);
    expect(resultado.materia).toEqual({ codigo: CODIGO_A, nombre: "Materia de prueba A" });
    expect(resultado.evaluacion).toEqual({ nombre: "Parcial 1" });
    expect(resultado.respondidas).toBe(esperado.respondidas);
    expect(resultado.aciertos).toBe(esperado.aciertos);
    expect(resultado.habilidades).toEqual(esperado.habilidades);
    expect(resultado.errores).toEqual(esperado.errores);
    expect(resultado.prerrequisitos).toEqual(esperado.prerrequisitos);
    // La fecha es la de ahora (la guardó la base al terminar).
    expect(Math.abs(Date.now() - new Date(resultado.fecha).getTime())).toBeLessThan(5 * 60_000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D.3-2: quien no es dueño no recibe nada
// ---------------------------------------------------------------------------------------------------------------

describe("otra sesión y una llamada sin sesión", () => {
  it("la dueña lo recibe; otra sesión anónima y un id que no existe, no; sin sesión, la base niega ejecutarla", async () => {
    const { id } = await sembrar({ idSesionAnonima: duena.id });

    expect(await leerMiDiagnostico(duena.cliente, id), "la dueña").toMatchObject({ idDiagnostico: id, respondidas: 8, aciertos: 5 });
    expect(await leerMiDiagnostico(otra.cliente, id), "otra sesión anónima").toBeNull();
    expect(await leerMiDiagnostico(duena.cliente, randomUUID()), "un id que no existe").toBeNull();
    // `anon` no ejecuta la función (42501): la lectura lanza con solo el código, sin contenido.
    await expect(leerMiDiagnostico(crearCliente(), id)).rejects.toThrow(/código 42501/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D.3-3: D-53 e con sesiones reales
// ---------------------------------------------------------------------------------------------------------------

describe("D-53 e: la dueña y la cuenta de Estudiante de su Lead, y nadie más del Lead", () => {
  it("un diagnóstico ya ligado a un Lead lo leen la sesión que lo hizo y la cuenta de Estudiante, y no la creadora del Lead, la ligada por lead_sesion ni la cuenta de otro Lead", async () => {
    const { id } = await sembrar({ idSesionAnonima: duena.id, idLead: lead.id });

    expect(await leerMiDiagnostico(duena.cliente, id), "la sesión que lo hizo").toMatchObject({ idDiagnostico: id });
    expect(await leerMiDiagnostico(estudianteDelLead, id), "la cuenta de Estudiante del Lead").toMatchObject({ idDiagnostico: id });

    // Desde HU-095 la política de `diagnostico` dice lo mismo que la función: la creadora y la ligada tampoco leen la fila de la tabla.
    const filaVisible = async (persona: Persona) =>
      exito(await persona.cliente.from("diagnostico").select("id").eq("id", id), "leer diagnostico con la sesión").length;
    expect(await filaVisible(creadora), "la creadora no ve la fila de la tabla").toBe(0);
    expect(await filaVisible(ligada), "la ligada no ve la fila de la tabla").toBe(0);

    expect(await leerMiDiagnostico(creadora.cliente, id), "la sesión que creó el Lead").toBeNull();
    expect(await leerMiDiagnostico(ligada.cliente, id), "la sesión ligada por lead_sesion").toBeNull();
    expect(await leerMiDiagnostico(estudianteAjeno, id), "la cuenta de Estudiante de otro Lead").toBeNull();
    expect(await leerMiDiagnostico(otra.cliente, id), "otra sesión").toBeNull();
  });

  it("con el último resultado de D-51 hecho por otra sesión del Lead, la lectura da null y el mensaje sale sin resultado", async () => {
    // La dueña ya vio las cinco preguntas de la Evaluación, con un Lead de por medio.
    const { id } = await sembrar({ idSesionAnonima: duena.id, idLead: lead.id, claves: PREGUNTAS_DE_PARCIAL_1, aciertos: 3 });

    // HU-081 cuenta como vistas las del Lead (D-49 a): las dos sesiones se quedan sin preguntas y el último es el mismo.
    const deLaDuena = await iniciarDiagnostico({ idUsuario: duena.id, rol: "anonimo" }, { idEvaluacion: parcial1 });
    const deLaLigada = await iniciarDiagnostico({ idUsuario: ligada.id, rol: "anonimo" }, { idEvaluacion: parcial1 });
    expect(deLaDuena).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: id });
    expect(deLaLigada).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: id });

    expect(await leerMiDiagnostico(duena.cliente, id), "la dueña lo lee").toMatchObject({ idDiagnostico: id, respondidas: 5, aciertos: 3 });
    expect(await leerMiDiagnostico(ligada.cliente, id), "la ligada, no").toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D.3-4: qué sale
// ---------------------------------------------------------------------------------------------------------------

describe("qué recibe el servidor y qué sale de la proyección", () => {
  it("la función devuelve solo sus 8 columnas y la proyección no trae ninguna clave interna ni el token de recuperación", async () => {
    const sembrado = await sembrar({ idSesionAnonima: duena.id, repetido: true });

    const { data, error } = await duena.cliente.rpc("mi_diagnostico", { p_id: sembrado.id });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(Object.keys(data![0]).sort()).toEqual([
      "aciertos",
      "codigo_materia",
      "fecha_realizacion",
      "id_diagnostico",
      "nombre_evaluacion",
      "nombre_materia",
      "respondidas",
      "resultado",
    ]);

    const leido = await leerMiDiagnostico(duena.cliente, sembrado.id);
    expect(leido).not.toBeNull();
    expect(leido!.respondidas).toBe(8);
    expect(leido!.aciertos).toBe(5);
    expect(sembrado.puntaje).toBe(62.5);

    // Ninguna clave fuera de la lista cerrada, y ningún valor interno, ni siquiera dentro de un texto.
    expect(clavesDe(leido).filter((clave) => !CLAVES_DEL_RESULTADO.includes(clave))).toEqual([]);
    const texto = JSON.stringify(leido);
    for (const prohibido of [sembrado.tokenDeRecuperacion, ...CLAVES_INTERNAS_DE_EJEMPLO, "repetido", "semilla", "faltaMaterial", "falta_material", "token"]) {
      expect(texto.includes(prohibido), `llegó a lo que ve la persona: ${prohibido}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B5: el selector con el PostgREST real
// ---------------------------------------------------------------------------------------------------------------

describe("el selector: las materias con Evaluación activa y los nombres de sus temas", () => {
  it("ofrece solo las Evaluaciones activas, cada una con sus temas por orden, y una Evaluación que se activa o se apaga entra o sale", async () => {
    const delBanco = (materias: Awaited<ReturnType<typeof cargarEvaluacionesActivas>>) =>
      materias.filter((materia) => materia.codigo === CODIGO_A || materia.codigo === CODIGO_B);

    // El cargador deja activa solo `parcial-1` (D-13: es la única con cobertura): la materia B no tiene ninguna.
    const inicial = delBanco(await cargarEvaluacionesActivas());
    expect(inicial.map((materia) => materia.codigo)).toEqual([CODIGO_A]);
    expect(inicial[0].nombre).toBe("Materia de prueba A");
    expect(inicial[0].evaluaciones).toEqual([{ id: parcial1, nombre: "Parcial 1", semana: 6, temas: ["Derivadas"] }]);

    const parcial2 = await activarEvaluacion(bd, CODIGO_A, "parcial-2");
    const examenFinal = await activarEvaluacion(bd, CODIGO_B, "examen-final");
    try {
      const ahora = delBanco(await cargarEvaluacionesActivas());
      expect(ahora.map((materia) => materia.codigo)).toEqual([CODIGO_A, CODIGO_B]);
      const [a, b] = ahora;
      // Por semana: Parcial 1 (6) y Parcial 2 (12). La acumulativa trae también los temas de antes.
      expect(a.evaluaciones.map((evaluacion) => [evaluacion.id, evaluacion.nombre, evaluacion.semana])).toEqual([
        [parcial1, "Parcial 1", 6],
        [parcial2, "Parcial 2", 12],
      ]);
      expect(a.evaluaciones[1].temas).toContain("Integrales");
      expect(b.evaluaciones).toEqual([{ id: examenFinal, nombre: "Examen final", semana: 16, temas: ["Diferencias finitas"] }]);
    } finally {
      await bd.query("update public.evaluacion set activa = false where id = any($1::uuid[])", [[parcial2, examenFinal]]);
    }

    // Apagada otra vez, vuelve a no ofrecerse.
    expect(delBanco(await cargarEvaluacionesActivas()).map((materia) => materia.codigo)).toEqual([CODIGO_A]);
  });
});
