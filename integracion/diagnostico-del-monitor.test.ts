import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DIAS_DE_VISTA_TRAS_REALIZADA, sePuedeVerDiagnostico } from "@/lib/agenda/reglas";
import { cargarDiagnosticoDeLaCita } from "@/lib/agenda/servidor";
import type { Sesion } from "@/lib/auth/sesion";
import { LETRAS, opcionElegida, paraNavegador, type CopiaDePaso, type Letra } from "@/lib/diagnostico/motor";
import type { EnCurso } from "@/lib/diagnostico/reglas";
import type { ResultadoGuardado } from "@/lib/diagnostico/resultado";
import { iniciarDiagnostico, responderDiagnostico } from "@/lib/diagnostico/servidor";
import {
  CLAVES_DE_LA_VISTA_POR_NIVEL,
  marcaDeLaPregunta,
  type PreguntaDelMonitor,
  type VistaDelMonitor,
} from "@/lib/diagnostico/vista-del-monitor";
import { diaDelNegocio } from "@/lib/fechas";
import { diaIsoDeFecha, finProgramado, inicioDeSesion } from "@/lib/plazos/motor";
import type { Json } from "@/lib/supabase/tipos";
import type { Banco, Pregunta } from "../scripts/contenido/modelo.mts";
import {
  aciertosDe,
  copiasDe,
  filaDeDiagnosticoConRespuestas,
  planDeEjemplo,
  planDeLas96,
  PRERREQUISITO_CON_FORMULA,
  preguntasEsperadas,
  resultadoGuardadoSembrado,
  SEMILLA_SEMBRADA,
  textoDeErrorDeOpcion,
  textosDeErrorDeLasQueNoEligio,
  valoresInternos,
  type PlanDePregunta,
} from "../pruebas/respuestas-sembradas";
import { borrarBancoDePrueba, cargarBancoDePrueba, CODIGO_A, idDeEvaluacion, idDeMateria } from "./banco-de-prueba";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, idsVisibles, type Cliente, type UsuarioPrueba } from "./utilidades";

/**
 * HU-022 contra el Supabase LOCAL: lo que el monitor ve del diagnóstico de su cita. `cargarDiagnosticoDeLaCita` (el mismo código de
 * la página) con la sesión de verdad de cada persona, así que también se prueban `public.diagnostico_de_mi_monitoria`, la capa
 * `_ahora`, los permisos y la política de `diagnostico`. La página (`exigirRol`, el 404, los textos) es de la e2e.
 *
 * El escenario se arma una sola vez (las pruebas solo leen, salvo las que lo dicen) para gastar pocas entradas del Auth local: tres
 * inicios con contraseña (dos monitores y un admin) y dos sesiones anónimas.
 *
 *  - Monitor A: certificado en la materia `ZZDG-0001` del banco de prueba, con sus citas. Monitor B: certificado también, hace de
 *    «otro monitor». Un admin.
 *  - Sesión Lead: anónima, dueña de un Lead que autorizó con el texto nuevo (`v2`); sesión sin Lead: anónima sin contacto.
 *  - Los Leads llevan nombre, correo y teléfono únicos, y los diagnósticos sembrados, una semilla, una marca de falta de material y
 *    un token que la respuesta de la función nunca puede traer.
 *
 * Las fechas se calculan desde hoy en Bogotá, nunca con la zona del proceso. La frontera de los 30 días se prueba con el núcleo
 * `privado.diagnostico_de_mi_monitoria(id, p_ahora)`, que no ejecuta ninguna sesión: se llama desde una conexión `pg` (como
 * `postgres`) con los claims del monitor puestos, patrón de `integracion/desembolsos.test.ts`.
 */

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
const LUNES = 1;
const INEXISTENTE = "00000000-0000-4000-8000-000000000022";

let bd: pg.Client;
let fx: Fixtures;
let ejemplo: Banco;
let parcial1: string;
let materiaA: string;
let nombreDeLaMateria: string;

type Persona = { usuario: UsuarioPrueba; cliente: Cliente };
type Franja = { id: string };
type LeadDePrueba = { id: string; nombre: string; correo: string; telefono: string; idSesion: string };
type EstadoDeCita = "pendiente_pago" | "confirmada" | "realizada" | "cancelada";

let monitorA: Persona;
let monitorB: Persona;
let admin: Persona;
let sesionLead: { cliente: Cliente; id: string };
let sesionSinLead: { cliente: Cliente; id: string };
let visitante: Cliente;
let franjaDeLosLunes: Franja;

/** Los Leads del escenario: `v2` autorizó compartir sus respuestas; `v1` no. */
let leadV2: LeadDePrueba;
let leadV1: LeadDePrueba;

/** El diagnóstico hecho con el motor real (caso 1) y su cita. */
let delMotor: { leadMotor: LeadDePrueba; idDiagnostico: string; idCita: string };
/** Una cita confirmada del monitor A con un diagnóstico sembrado del Lead `v2`: lo ven los casos de claves, centinelas y el cierre. */
let sembrada: { idCita: string; idDiagnostico: string; plan: PlanDePregunta[]; marca: string; resultado: ResultadoGuardado };

// ---------------------------------------------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------------------------------------------

const hoy = () => diaDelNegocio(new Date());

/** `AAAA-MM-DD` más `dias` días (aritmética de calendario, sin zona). */
function sumarDias(fecha: string, dias: number): string {
  const instante = new Date(`${fecha}T12:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() + dias);
  return instante.toISOString().slice(0, 10);
}

/** El lunes número `n` desde el 7 de enero de 2030: cada cita de la franja del lunes necesita el suyo (índice único por franja y fecha). */
let lunesUsados = 0;
const siguienteLunes = () => sumarDias("2030-01-07", 7 * lunesUsados++);

async function crearLeadConContacto(idSesion: string, version: "v1" | "v2", etiqueta: string): Promise<LeadDePrueba> {
  const contacto = {
    nombre: `${etiqueta} Veintidós ${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    correo: `lead-secreto-${randomUUID()}@calibra.test`,
    // Un número de móvil colombiano de siete cifras al azar: se busca tal cual en las respuestas.
    telefono: `310${randomInt(1_000_000, 9_999_999)}`,
  };
  const lead = exito(
    await fx.admin
      .from("lead")
      .insert({
        id_sesion_anonima: idSesion,
        nombre: contacto.nombre,
        correo: contacto.correo,
        numero_telefono: contacto.telefono,
        acepta_tratamiento_datos: true,
        fecha_consentimiento: new Date().toISOString(),
        version_autorizacion: version,
      })
      .select()
      .single(),
    "insertar lead",
  );
  fx.registrarLead(lead.id);
  return { id: lead.id, idSesion, ...contacto };
}

async function crearPersona(usuario: UsuarioPrueba): Promise<Persona> {
  return { usuario, cliente: await fx.iniciarSesion(usuario) };
}

async function crearCita(datos: {
  lead: LeadDePrueba;
  franja?: Franja;
  fecha?: string;
  estado?: EstadoDeCita;
  idDiagnostico?: string | null;
  fechaFinalizacion?: string;
}): Promise<string> {
  const estado = datos.estado ?? "confirmada";
  const fila = exito(
    await fx.admin
      .from("monitoria")
      .insert({
        id_franja: (datos.franja ?? franjaDeLosLunes).id,
        id_monitor: monitorA.usuario.id,
        id_materia: materiaA,
        id_lead: datos.lead.id,
        fecha: datos.fecha ?? siguienteLunes(),
        valor_total: 25_000,
        estado,
        id_diagnostico: datos.idDiagnostico ?? null,
        // Una realizada exige su fecha de finalización; una cancelada, su motivo (restricciones de la tabla).
        fecha_finalizacion: estado === "realizada" ? (datos.fechaFinalizacion ?? new Date().toISOString()) : null,
        motivo_cancelacion: estado === "cancelada" ? "estudiante" : null,
      })
      .select()
      .single(),
    "insertar monitoria",
  );
  fx.registrarMonitoria(fila.id);
  return fila.id;
}

/** La fila que devuelve la función por la Data API, sin pasar por el lector: para mirar sus claves y su texto crudos. */
async function filaCruda(cliente: Cliente, idMonitoria: string): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
  const { data, error } = await cliente.rpc("diagnostico_de_mi_monitoria", { p_id_monitoria: idMonitoria });
  return { data, error };
}

async function vistaDe(cliente: Cliente, idMonitoria: string): Promise<VistaDelMonitor | null> {
  return cargarDiagnosticoDeLaCita(cliente, idMonitoria);
}

function exigirVista(vista: VistaDelMonitor | null): VistaDelMonitor {
  expect(vista, "la cita se ve").not.toBeNull();
  return vista!;
}

/**
 * Siembra un diagnóstico con las copias de `plan` y devuelve su id. El dueño es el Lead (y, si se pide, también su sesión). Con
 * `lead: null` es un diagnóstico sin Lead: de la sesión `idSesion`, como el de quien aún no dejaba su contacto.
 */
async function sembrarDiagnostico(datos: {
  lead: LeadDePrueba | null;
  /** Solo con `lead: null`: la sesión dueña. */
  idSesion?: string;
  conSesion?: boolean;
  plan: PlanDePregunta[];
  marca: string;
  resultado: ResultadoGuardado;
  repetido?: boolean;
}): Promise<string> {
  const idSesionAnonima = datos.lead === null ? (datos.idSesion ?? null) : datos.conSesion ? datos.lead.idSesion : null;
  const fila = filaDeDiagnosticoConRespuestas({
    idLead: datos.lead?.id ?? null,
    idSesionAnonima,
    idEvaluacion: parcial1,
    idMateria: materiaA,
    plan: datos.plan,
    marca: datos.marca,
    resultado: datos.resultado,
    repetido: datos.repetido,
  });
  const diagnostico = await fx.crearDiagnostico({
    idLead: datos.lead?.id,
    idSesionAnonima: idSesionAnonima ?? undefined,
    idEvaluacion: parcial1,
    idMateria: materiaA,
    respuestas: fila.respuestas as unknown as Json,
    resultado: fila.resultado_por_habilidad as unknown as Json,
    aciertos: fila.aciertos,
    repetido: fila.repetido,
    fechaRealizacion: fila.fecha_realizacion,
    puntaje: fila.puntaje,
    semilla: fila.semilla,
    faltaMaterial: fila.falta_material as unknown as NonNullable<Json>,
  });
  return diagnostico.id;
}

/** Los errores como los debe leer el monitor: los confirmados primero (estable), con la descripción de la habilidad nula si cayó a su clave. */
function erroresEsperados(guardado: ResultadoGuardado) {
  const confirmadosPrimero = [...guardado.errores].sort((a, b) => Number(b.estado === "confirmada") - Number(a.estado === "confirmada"));
  return confirmadosPrimero.map((e) => ({
    titulo: e.texto,
    estado: e.estado,
    veces: e.veces,
    descripcionDeLaHabilidad: e.descripcionHabilidad !== e.habilidad ? e.descripcionHabilidad : null,
    detalles: e.detalles,
  }));
}

/** Los prerrequisitos sin repetir por (materia, habilidad), en el orden de la primera aparición. */
function prerrequisitosEsperados(guardado: ResultadoGuardado) {
  const vistos = new Set<string>();
  return guardado.prerrequisitos
    .filter((p) => {
      const llave = JSON.stringify([p.materia, p.habilidad]);
      if (vistos.has(llave)) return false;
      vistos.add(llave);
      return true;
    })
    .map((p) => ({ materia: p.materia, descripcion: p.descripcion }));
}

/** Todas las claves de todos los objetos de un valor JSON, y el texto de todos sus valores. */
function recorrer(valor: unknown, claves: Set<string> = new Set()): Set<string> {
  if (Array.isArray(valor)) for (const elemento of valor) recorrer(elemento, claves);
  else if (typeof valor === "object" && valor !== null) {
    for (const [clave, interno] of Object.entries(valor)) {
      claves.add(clave);
      recorrer(interno, claves);
    }
  }
  return claves;
}

// ---------------------------------------------------------------------------------------------------------------
// El motor real como productor de un diagnóstico (caso 1)
// ---------------------------------------------------------------------------------------------------------------

const preguntasDelBanco = (): Pregunta[] =>
  ejemplo.materias.flatMap((m) => m.temas).flatMap((t) => t.preguntas).filter((p) => p.estado === "revisada");

function preguntaMostrada(vista: EnCurso): Pregunta {
  const encontrada = preguntasDelBanco().find((p) => p.enunciado === vista.pregunta.enunciado);
  if (!encontrada) throw new Error(`El servidor mostró una pregunta que no está en el banco de prueba: ${vista.pregunta.enunciado}`);
  return encontrada;
}

/** La letra que ve la persona en la posición de la opción correcta (o de una incorrecta), buscándola por su texto. */
function letraPorTexto(vista: EnCurso, texto: string): Letra {
  const posiciones = vista.pregunta.opciones.flatMap((o, i) => (o.texto === texto ? [i] : []));
  if (posiciones.length !== 1) throw new Error(`La opción (${texto}) debe estar una sola vez entre las que mostró el servidor.`);
  return LETRAS[posiciones[0]];
}

/** Acierta si `acertar`; si no, elige una incorrecta que traiga su propio texto de error (D-14) y, si no hay, la primera incorrecta. */
function decidir(vista: EnCurso, acertar: boolean): Letra {
  const pregunta = preguntaMostrada(vista);
  if (acertar) return letraPorTexto(vista, pregunta.opciones.find((o) => o.correcta)!.texto);
  const elegida = pregunta.opciones.find((o) => !o.correcta && o.error !== null) ?? pregunta.opciones.find((o) => !o.correcta)!;
  return letraPorTexto(vista, elegida.texto);
}

async function hacerElDiagnosticoConElMotor(sesion: Sesion): Promise<string> {
  const inicio = await iniciarDiagnostico(sesion, { idEvaluacion: parcial1 }, { semilla: 22 });
  expect(inicio.estado).toBe("en_curso");
  let vista = inicio as EnCurso;
  // Aciertos y fallos mezclados: empieza fallando.
  for (let i = 0; i < 25; i++) {
    const respuesta = await responderDiagnostico(sesion, { idDiagnostico: vista.idDiagnostico, paso: vista.paso, letra: decidir(vista, i % 2 === 1) });
    if (respuesta.estado === "terminado") return respuesta.idDiagnostico;
    expect(respuesta.estado).toBe("en_curso");
    vista = respuesta as EnCurso;
  }
  throw new Error("El diagnóstico no terminó en 25 respuestas.");
}

// ---------------------------------------------------------------------------------------------------------------
// El escenario
// ---------------------------------------------------------------------------------------------------------------

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
  fx = new Fixtures();
  try {
    const cargados = await cargarBancoDePrueba(bd);
    ejemplo = cargados.ejemplo;
    parcial1 = await idDeEvaluacion(bd, CODIGO_A, "parcial-1");
    materiaA = await idDeMateria(bd, CODIGO_A);
    nombreDeLaMateria = (await bd.query<{ nombre: string }>("select nombre from public.materia where id = $1", [materiaA])).rows[0].nombre;

    admin = await crearPersona(await fx.crearAdmin());
    monitorA = await crearPersona(await fx.crearMonitor());
    monitorB = await crearPersona(await fx.crearMonitor());
    for (const monitor of [monitorA, monitorB]) {
      await fx.crearCertificado({ idMonitor: monitor.usuario.id, idMateria: materiaA, idAdmin: admin.usuario.id });
    }
    sesionLead = await fx.crearAnonimo();
    sesionSinLead = await fx.crearAnonimo();
    visitante = crearCliente();
    franjaDeLosLunes = await fx.crearFranja({ idMonitor: monitorA.usuario.id, dia: LUNES, hora: "10:00", duracionMin: 60, presencial: false });

    leadV2 = await crearLeadConContacto(sesionLead.id, "v2", "Camila");
    // El Lead v1 es de una sesión que no gasta cupo del Auth (la API de administración).
    leadV1 = await crearLeadConContacto((await fx.crearUsuario()).id, "v1", "Mateo");

    // Caso 1: el diagnóstico lo hace el motor real, de una persona cuyo Lead autorizó con el texto nuevo.
    const duenoDelMotor = await fx.crearUsuario();
    const leadMotor = await crearLeadConContacto(duenoDelMotor.id, "v2", "Nora");
    const idDiagnosticoDelMotor = await hacerElDiagnosticoConElMotor({ idUsuario: duenoDelMotor.id, rol: "anonimo" });
    delMotor = {
      leadMotor,
      idDiagnostico: idDiagnosticoDelMotor,
      idCita: await crearCita({ lead: leadMotor, idDiagnostico: idDiagnosticoDelMotor }),
    };

    // Una cita del Lead v2 con las 8 preguntas sembradas (3 falladas), repetido, y la semilla y la falta de material reconocibles.
    const marca = `m${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const plan = planDeEjemplo();
    const resultado = resultadoGuardadoSembrado(marca, { detalleDeLaElegida: textoDeErrorDeOpcion(plan[1], marca, plan[1].elegidaDelBanco) });
    const idDiagnostico = await sembrarDiagnostico({ lead: leadV2, conSesion: true, plan, marca, resultado, repetido: true });
    sembrada = { idCita: await crearCita({ lead: leadV2, idDiagnostico }), idDiagnostico, plan, marca, resultado };
  } catch (error) {
    await fx.limpiar();
    await borrarBancoDePrueba(bd).catch(() => undefined);
    await bd.end();
    throw error;
  }
}, 180_000);

afterAll(async () => {
  if (!bd) return;
  // `diagnostico_monitoria_fk` no cae en cascada: los diagnósticos que apuntan a una cita con `id_monitoria` (el cierre de la
  // política) se sueltan antes de que `limpiar()` borre las monitorías.
  const errores: unknown[] = [];
  const intentar = async (accion: () => Promise<unknown>) => {
    try {
      await accion();
    } catch (error) {
      errores.push(error);
    }
  };
  await intentar(() => bd.query("update public.diagnostico set id_monitoria = null where id_monitoria is not null and id_materia = $1", [materiaA]));
  await intentar(() => fx.limpiar());
  await intentar(() => borrarBancoDePrueba(bd));
  await intentar(() => bd.end());
  if (errores.length) throw errores[0];
});

// ---------------------------------------------------------------------------------------------------------------
// 1. El motor real de punta a punta: lo que guarda HU-081 es lo que lee HU-022
// ---------------------------------------------------------------------------------------------------------------

describe("el motor real de punta a punta (criterios 1 a 5, 14)", () => {
  it("el monitor ve lo que el motor guardó: cifras, habilidades, errores, prerrequisitos y, por pregunta, la opción elegida, la correcta, la solución y Acertó o Falló", async () => {
    const fila = exito(
      await fx.admin.from("diagnostico").select("*").eq("id", delMotor.idDiagnostico).single(),
      "leer el diagnóstico del motor",
    );
    const guardado = fila.resultado_por_habilidad as unknown as ResultadoGuardado;
    const copias = fila.respuestas as unknown as CopiaDePaso[];
    expect(copias.length, "el motor terminó con varias respuestas").toBeGreaterThanOrEqual(2);
    expect(fila.aciertos, "mezcló aciertos y fallos").toBeGreaterThan(0);
    expect(fila.aciertos).toBeLessThan(copias.length);

    const vista = exigirVista(await vistaDe(monitorA.cliente, delMotor.idCita));
    const cita = exito(await fx.admin.from("monitoria").select("fecha").eq("id", delMotor.idCita).single(), "leer la cita del motor");
    expect(vista.cita).toEqual({
      fecha: cita.fecha,
      hora: "10:00:00",
      duracionMin: 60,
      nombreMateria: nombreDeLaMateria,
      nombreEstudiante: delMotor.leadMotor.nombre,
    });
    const d = vista.diagnostico!;
    expect(d).not.toBeNull();

    expect(d.respondidas).toBe(fila.respondidas);
    expect(d.aciertos).toBe(fila.aciertos);
    expect(d.repetido).toBe(fila.repetido);
    expect(d.fechaRealizacion).toBe(new Date(fila.fecha_realizacion).toISOString());
    const evaluacion = exito(await fx.admin.from("evaluacion").select("nombre").eq("id", fila.id_evaluacion).single(), "leer la Evaluación");
    expect(d.nombreEvaluacion).toBe(evaluacion.nombre);

    // Las habilidades, tal cual las guardó el motor y en el mismo orden (el nivel no se recalcula).
    expect(d.habilidades).toEqual(guardado.habilidades.map((h) => ({ descripcion: h.descripcion, nivel: h.nivel, respuestas: h.respuestas, aciertos: h.aciertos })));

    // Los errores: los confirmados primero (estable), el título, el estado, las veces, la descripción de la habilidad y el detalle.
    expect(d.errores).toEqual(erroresEsperados(guardado));
    expect(d.errores.length, "el diagnóstico tiene errores que mostrar").toBeGreaterThan(0);

    // Los prerrequisitos, sin repetir por (materia, habilidad), en orden de aparición.
    expect(d.prerrequisitos).toEqual(prerrequisitosEsperados(guardado));

    // Las preguntas: una por copia, en el orden en que respondió, con las letras de lo que vio.
    expect(d.preguntas).not.toBeNull();
    const preguntas = d.preguntas as PreguntaDelMonitor[];
    expect(preguntas).toHaveLength(copias.length);
    copias.forEach((copia, i) => {
      const pregunta = preguntas[i];
      const textoEn = (letra: Letra) => pregunta.opciones.find((o) => o.letra === letra)!.texto;
      expect(pregunta.enunciado).toBe(copia.enunciado);
      expect(textoEn(pregunta.letraElegida), `opción elegida de la pregunta ${i + 1}`).toBe(opcionElegida(copia).texto);
      expect(textoEn(pregunta.letraCorrecta), `opción correcta de la pregunta ${i + 1}`).toBe(copia.opciones.find((o) => o.correcta)!.texto);
      expect(pregunta.letraElegida).toBe(copia.letraElegida);
      expect(pregunta.opciones).toEqual(paraNavegador(copia, copia.orden).opciones);
      expect(pregunta.solucion).toBe(copia.solucion);
    });
    // Tantas «Acertó» como aciertos guardó el motor.
    expect(preguntas.filter((p) => marcaDeLaPregunta(p) === "Acertó")).toHaveLength(fila.aciertos);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Los 96 casos del mapeo de letras
// ---------------------------------------------------------------------------------------------------------------

describe("los 96 casos: las 24 permutaciones por las 4 letras vistas (criterio 14)", () => {
  it("para cada una, lo que sale coincide con opcionDeLetra, opcionElegida y paraNavegador del motor", async () => {
    const marca = `m${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const plan = planDeLas96();
    const resultado = resultadoGuardadoSembrado(marca);
    const idDiagnostico = await sembrarDiagnostico({ lead: leadV2, plan, marca, resultado });
    const idCita = await crearCita({ lead: leadV2, idDiagnostico });

    const vista = exigirVista(await vistaDe(monitorA.cliente, idCita));
    const d = vista.diagnostico!;
    expect(d.respondidas).toBe(96);
    expect(d.aciertos).toBe(aciertosDe(plan));
    const preguntas = d.preguntas as PreguntaDelMonitor[];
    expect(preguntas).toHaveLength(96);

    const copias = copiasDe(plan, marca);
    const esperadas = preguntasEsperadas(plan, marca);
    let distintasDeLaDelBanco = 0;
    copias.forEach((copia, i) => {
      const pregunta = preguntas[i];
      const textoEn = (letra: Letra) => pregunta.opciones.find((o) => o.letra === letra)!.texto;
      // Contra el motor (la referencia del mapeo)...
      expect(pregunta.opciones, `opciones del caso ${i + 1}`).toEqual(paraNavegador(copia, copia.orden).opciones);
      expect(textoEn(pregunta.letraElegida), `elegida del caso ${i + 1}`).toBe(opcionElegida(copia).texto);
      expect(textoEn(pregunta.letraCorrecta), `correcta del caso ${i + 1}`).toBe(copia.opciones.find((o) => o.correcta)!.texto);
      expect(pregunta.letraElegida).toBe(copia.letraElegida);
      // ...y contra la cuenta por posiciones del fixture.
      expect(pregunta).toMatchObject({
        enunciado: esperadas[i].enunciado,
        letraElegida: esperadas[i].letraElegida,
        letraCorrecta: esperadas[i].letraCorrecta,
        solucion: esperadas[i].solucion,
      });
      if (copia.opciones[LETRAS.indexOf(copia.letraElegida)].texto !== opcionElegida(copia).texto) distintasDeLaDelBanco++;
    });
    // El caso discrimina: con el mapeo mal hecho (sin orden) la opción sería otra en 72 de los 96.
    expect(distintasDeLaDelBanco).toBe(72);
    expect(preguntas.filter((p) => marcaDeLaPregunta(p) === "Acertó")).toHaveLength(aciertosDe(plan));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Paridad de la vigencia entre la base y la app
// ---------------------------------------------------------------------------------------------------------------

describe("paridad de la vigencia: la función y sePuedeVerDiagnostico dan lo mismo (criterios 8 y 9)", () => {
  /** Cuántas filas da el núcleo con esa hora, llamado como `postgres` con los claims del monitor A (sin `set local role`). */
  async function filasDelNucleo(idMonitoria: string, ahora: Date): Promise<number> {
    await bd.query("begin");
    try {
      await bd.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: monitorA.usuario.id, role: "authenticated" })]);
      const { rows } = await bd.query<{ n: number }>("select count(*)::int as n from privado.diagnostico_de_mi_monitoria($1::uuid, $2::timestamptz)", [
        idMonitoria,
        ahora.toISOString(),
      ]);
      return rows[0].n;
    } finally {
      await bd.query("rollback");
    }
  }

  it("DIAS_DE_VISTA_TRAS_REALIZADA es privado.dias_de_vista_tras_realizada()", async () => {
    const { rows } = await bd.query<{ dias: number }>("select privado.dias_de_vista_tras_realizada() as dias");
    expect(rows[0].dias).toBe(30);
    expect(DIAS_DE_VISTA_TRAS_REALIZADA).toBe(rows[0].dias);
  });

  it("una rejilla de estados por relojes (fin + 30 días menos un minuto, exacto y más un minuto, y 29 y 31 días) da lo mismo en SQL y en TypeScript", async () => {
    const hora = "10:00";
    const duracionMin = 60;
    const estados: EstadoDeCita[] = ["confirmada", "realizada", "pendiente_pago", "cancelada"];
    const ids = new Map<EstadoDeCita, string>();
    for (const estado of estados) {
      // El fin programado lo da la franja (fecha + 10:00 en Bogotá + 60 min); la finalización es otra cosa y no cuenta.
      ids.set(estado, await crearCita({ lead: leadV2, estado, fecha: sumarDias("2030-01-07", -7 * (60 + ids.size)) }));
    }
    const fechas = new Map<EstadoDeCita, string>();
    for (const estado of estados) {
      const { data } = await fx.admin.from("monitoria").select("fecha").eq("id", ids.get(estado)!).single();
      fechas.set(estado, (data as { fecha: string }).fecha);
    }

    const relojes: [string, (fin: Date) => Date][] = [
      ["antes de que termine la sesión", (fin) => new Date(fin.getTime() - 90 * MINUTO)],
      ["fin + 29 días", (fin) => new Date(fin.getTime() + 29 * DIA)],
      ["fin + 30 días menos un minuto", (fin) => new Date(fin.getTime() + 30 * DIA - MINUTO)],
      ["fin + 30 días, exacto", (fin) => new Date(fin.getTime() + 30 * DIA)],
      ["fin + 30 días más un minuto", (fin) => new Date(fin.getTime() + 30 * DIA + MINUTO)],
      ["fin + 31 días", (fin) => new Date(fin.getTime() + 31 * DIA)],
      ["fin + 40 días", (fin) => new Date(fin.getTime() + 40 * DIA)],
    ];
    // Lo que dice el punto 2 de la HU, escrito a mano: la confirmada siempre; la realizada, mientras ahora < fin + 30 días.
    const esperado: Record<EstadoDeCita, boolean[]> = {
      confirmada: [true, true, true, true, true, true, true],
      realizada: [true, true, true, false, false, false, false],
      pendiente_pago: [false, false, false, false, false, false, false],
      cancelada: [false, false, false, false, false, false, false],
    };

    for (const estado of estados) {
      const fin = finProgramado(inicioDeSesion(fechas.get(estado)!, hora), duracionMin);
      for (const [i, [nombre, reloj]] of relojes.entries()) {
        const ahora = reloj(fin);
        const enSql = (await filasDelNucleo(ids.get(estado)!, ahora)) === 1;
        const enTs = sePuedeVerDiagnostico(estado, fin, ahora);
        expect(enSql, `SQL: ${estado}, ${nombre}`).toBe(esperado[estado][i]);
        expect(enTs, `TypeScript: ${estado}, ${nombre}`).toBe(esperado[estado][i]);
      }
    }
  });

  it("por la puerta pública con la hora real y la sesión del monitor: una realizada que terminó hace 29 días se ve y una de hace 31 no (así una capa que pase otra hora que now() no queda sin probar)", async () => {
    const f29 = sumarDias(hoy(), -29);
    const f31 = sumarDias(hoy(), -31);
    // Empiezan a las 00:30 y duran 90 minutos: su fin queda a un lado y al otro de los 30 días sea cual sea la hora a la que corra la prueba.
    const franja29 = await fx.crearFranja({ idMonitor: monitorA.usuario.id, dia: diaIsoDeFecha(f29), hora: "00:30", duracionMin: 90, presencial: false });
    const franja31 = await fx.crearFranja({ idMonitor: monitorA.usuario.id, dia: diaIsoDeFecha(f31), hora: "00:30", duracionMin: 90, presencial: false });
    // Cada una con una fecha de finalización que NO es el fin de la sesión: la de 29 días, finalizada hace 40 (si el plazo contara desde
    // ahí, no se vería); la de 31, finalizada ahora (si contara desde ahí, se vería).
    const hace29 = await crearCita({ lead: leadV2, franja: franja29, fecha: f29, estado: "realizada", fechaFinalizacion: new Date(Date.now() - 40 * DIA).toISOString() });
    const hace31 = await crearCita({ lead: leadV2, franja: franja31, fecha: f31, estado: "realizada", fechaFinalizacion: new Date().toISOString() });

    const vista29 = await vistaDe(monitorA.cliente, hace29);
    expect(vista29, "terminó hace 29 días: se ve").not.toBeNull();
    expect(vista29!.cita.nombreEstudiante).toBe(leadV2.nombre);
    expect(await vistaDe(monitorA.cliente, hace31), "terminó hace 31 días: responde como una cita que no existe").toBeNull();
    const cruda = await filaCruda(monitorA.cliente, hace31);
    expect(cruda.error).toBeNull();
    expect(cruda.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Quién llama
// ---------------------------------------------------------------------------------------------------------------

describe("quién llama a la función (criterio 10)", () => {
  it("el monitor de la cita recibe la fila; otro monitor, un admin, el Lead de la cita y una sesión anónima sin Lead reciben [] igual que con un id inexistente", async () => {
    const delMonitor = await filaCruda(monitorA.cliente, sembrada.idCita);
    expect(delMonitor.error).toBeNull();
    expect(delMonitor.data).toHaveLength(1);

    const inexistente = await filaCruda(monitorA.cliente, INEXISTENTE);
    expect(inexistente).toEqual({ data: [], error: null });

    const otros: [string, Cliente][] = [
      ["otro monitor", monitorB.cliente],
      ["un admin", admin.cliente],
      ["el Lead de la cita", sesionLead.cliente],
      ["una sesión anónima sin Lead", sesionSinLead.cliente],
    ];
    for (const [quien, cliente] of otros) {
      expect(await filaCruda(cliente, sembrada.idCita), quien).toEqual(inexistente);
      expect(await vistaDe(cliente, sembrada.idCita), quien).toBeNull();
    }
    // Un monitor tampoco distingue «no es tuya» de «no existe» en las citas que no ve por su estado.
    expect(await filaCruda(monitorB.cliente, INEXISTENTE)).toEqual(inexistente);
  });

  it("el visitante sin sesión (anon) no puede ejecutarla: 42501", async () => {
    const respuesta = await filaCruda(visitante, sembrada.idCita);
    expect(respuesta.data).toBeNull();
    expect(respuesta.error?.code).toBe("42501");
  });

  it("ninguno de ellos ve el diagnóstico de esa cita por la tabla, el monitor incluido", async () => {
    for (const [quien, cliente] of [
      ["el monitor de la cita", monitorA.cliente],
      ["otro monitor", monitorB.cliente],
      ["una sesión anónima sin Lead", sesionSinLead.cliente],
    ] as [string, Cliente][]) {
      expect(await idsVisibles(cliente, "diagnostico", "id", sembrada.idDiagnostico), quien).toEqual([]);
    }
    // El visitante ni siquiera tiene el permiso de leer la tabla.
    const { error } = await visitante.from("diagnostico").select("id").eq("id", sembrada.idDiagnostico);
    expect(error?.code).toBe("42501");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 5. El cierre de la política
// ---------------------------------------------------------------------------------------------------------------

describe("el cierre de la política de diagnostico (criterio 12)", () => {
  it("el monitor lee 0 filas por sus citas individuales, también cuando el diagnóstico apunta a la cita con diagnostico.id_monitoria", async () => {
    // El que está ligado a su cita por monitoria.id_diagnostico (el del motor y el sembrado).
    expect(await idsVisibles(monitorA.cliente, "diagnostico", "id", delMotor.idDiagnostico)).toEqual([]);
    expect(await idsVisibles(monitorA.cliente, "diagnostico", "id", sembrada.idDiagnostico)).toEqual([]);

    // El hueco que dejaba dicta_monitoria: un diagnóstico de otra persona cuyo id_monitoria es una cita individual suya.
    const marca = `m${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const plan = planDeEjemplo();
    const ajeno = await fx.crearDiagnostico({
      idSesionAnonima: sesionSinLead.id,
      idEvaluacion: parcial1,
      idMateria: materiaA,
      respuestas: copiasDe(plan, marca) as unknown as Json,
      resultado: resultadoGuardadoSembrado(marca) as unknown as Json,
      aciertos: aciertosDe(plan),
    });
    exito(await fx.admin.from("diagnostico").update({ id_monitoria: sembrada.idCita }).eq("id", ajeno.id).select().single(), "apuntar a la cita individual");
    expect(await idsVisibles(monitorA.cliente, "diagnostico", "id", ajeno.id), "la cita individual no abre la tabla").toEqual([]);
    // La dueña sí lo lee, y el admin.
    expect(await idsVisibles(sesionSinLead.cliente, "diagnostico", "id", ajeno.id)).toEqual([ajeno.id]);
    expect(await idsVisibles(admin.cliente, "diagnostico", "id", ajeno.id)).toEqual([ajeno.id]);
  });

  it("con una grupal que dicta (fila en monitoria_grupal) lee 1; otro monitor, 0", async () => {
    const idGrupal = await crearCita({ lead: leadV2 });
    exito(
      await fx.admin.from("monitoria_grupal").insert({ id_monitoria: idGrupal, cupos: 3, modalidad_pago: "dividido", precio_por_persona: 15_000 }).select().single(),
      "convertir la cita en grupal",
    );
    const diagnostico = await fx.crearDiagnostico({ idSesionAnonima: sesionSinLead.id, idEvaluacion: parcial1, idMateria: materiaA });
    exito(await fx.admin.from("diagnostico").update({ id_monitoria: idGrupal }).eq("id", diagnostico.id).select().single(), "apuntar a la grupal");

    expect(await idsVisibles(monitorA.cliente, "diagnostico", "id", diagnostico.id)).toEqual([diagnostico.id]);
    expect(await idsVisibles(monitorB.cliente, "diagnostico", "id", diagnostico.id)).toEqual([]);
    // La ruta de HU-022 solo sirve citas individuales: la grupal responde como inexistente.
    expect(await vistaDe(monitorA.cliente, idGrupal)).toBeNull();
  });

  it("la sesión dueña y el admin siguen leyendo lo que leían; la sesión del Lead no lee el que hizo otra (HU-095)", async () => {
    // El sembrado es del Lead v2 y de su sesión.
    expect(await idsVisibles(sesionLead.cliente, "diagnostico", "id", sembrada.idDiagnostico)).toEqual([sembrada.idDiagnostico]);
    expect(await idsVisibles(admin.cliente, "diagnostico", "id", sembrada.idDiagnostico)).toEqual([sembrada.idDiagnostico]);
    expect(await idsVisibles(monitorB.cliente, "diagnostico", "id", sembrada.idDiagnostico)).toEqual([]);

    // Un diagnóstico que solo es del Lead (sin la sesión que lo hizo): desde HU-095 (D-53 e) la sesión que creó el Lead no lo lee
    // por la tabla; lo leerían la cuenta de Estudiante del Lead y el admin.
    const delLead = await fx.crearDiagnostico({ idLead: leadV2.id, idEvaluacion: parcial1, idMateria: materiaA });
    expect(await idsVisibles(sesionLead.cliente, "diagnostico", "id", delLead.id)).toEqual([]);
    expect(await idsVisibles(admin.cliente, "diagnostico", "id", delLead.id)).toEqual([delLead.id]);
    expect(await idsVisibles(monitorA.cliente, "diagnostico", "id", delLead.id)).toEqual([]);
    expect(await idsVisibles(sesionSinLead.cliente, "diagnostico", "id", delLead.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Foto guardada
// ---------------------------------------------------------------------------------------------------------------

describe("la foto guardada (criterio 4)", () => {
  it("editar o retirar preguntas del banco y agregar un prerrequisito no cambia lo que ve el monitor", async () => {
    const antes = await filaCruda(monitorA.cliente, delMotor.idCita);
    expect(antes.error).toBeNull();
    expect(antes.data).toHaveLength(1);
    const vistaAntes = await vistaDe(monitorA.cliente, delMotor.idCita);

    // Alguien recarga el banco: las preguntas cambian de enunciado y de texto en sus opciones, y se retiran; una habilidad gana un prerrequisito.
    await bd.query("update public.pregunta set enunciado = 'ZZ editada en la base', estado = 'retirada' where id_materia = $1", [materiaA]);
    await bd.query("update public.opcion set texto = 'ZZ otra opción ' || letra where id_materia = $1", [materiaA]);
    await bd.query("update public.habilidad set descripcion = 'ZZ descripción nueva ' || clave where id_materia = $1", [materiaA]);
    const habilidades = (await bd.query<{ id: string }>("select id from public.habilidad where id_materia = $1 order by clave limit 2", [materiaA])).rows;
    expect(habilidades).toHaveLength(2);
    await bd.query("insert into public.habilidad_prerrequisito (id_habilidad, id_prerrequisito) values ($1, $2) on conflict do nothing", [habilidades[0].id, habilidades[1].id]);

    const despues = await filaCruda(monitorA.cliente, delMotor.idCita);
    expect(despues).toEqual(antes);
    expect(await vistaDe(monitorA.cliente, delMotor.idCita)).toEqual(vistaAntes);
    expect(JSON.stringify(despues.data)).not.toContain("ZZ editada");
    expect(JSON.stringify(despues.data)).not.toContain("ZZ otra opción");
    expect(JSON.stringify(despues.data)).not.toContain("ZZ descripción nueva");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Borrado
// ---------------------------------------------------------------------------------------------------------------

describe("diagnóstico borrado (criterio 7)", () => {
  it("al borrar el diagnóstico (supresión de datos) la cita queda con id_diagnostico nulo y la función responde la cabecera sin diagnóstico", async () => {
    const marca = `m${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const plan = planDeEjemplo();
    const idDiagnostico = await sembrarDiagnostico({ lead: leadV2, plan, marca, resultado: resultadoGuardadoSembrado(marca) });
    const idCita = await crearCita({ lead: leadV2, idDiagnostico });
    expect((await vistaDe(monitorA.cliente, idCita))?.diagnostico, "antes de borrarlo tiene diagnóstico").not.toBeNull();

    exito(await fx.admin.from("diagnostico").delete().eq("id", idDiagnostico).select(), "borrar el diagnóstico");
    const cita = exito(await fx.admin.from("monitoria").select("id_diagnostico").eq("id", idCita).single(), "leer la cita");
    expect(cita.id_diagnostico).toBeNull();

    const vista = exigirVista(await vistaDe(monitorA.cliente, idCita));
    expect(vista.diagnostico).toBeNull();
    expect(vista.cita.nombreEstudiante).toBe(leadV2.nombre);
    const cruda = await filaCruda(monitorA.cliente, idCita);
    const [fila] = cruda.data as Record<string, unknown>[];
    expect(fila.hay_diagnostico).toBe(false);
    for (const columna of ["nombre_evaluacion", "fecha_realizacion", "respondidas", "aciertos", "repetido", "habilidades", "errores", "prerrequisitos", "respuestas_autorizadas", "preguntas"]) {
      expect(fila[columna], columna).toBeNull();
    }
  });

  it("una cita sin diagnóstico ligado (D-3) también devuelve la cabecera sin diagnóstico", async () => {
    const idCita = await crearCita({ lead: leadV2 });
    const vista = exigirVista(await vistaDe(monitorA.cliente, idCita));
    expect(vista.diagnostico).toBeNull();
    expect(vista.cita).toMatchObject({ nombreMateria: nombreDeLaMateria, nombreEstudiante: leadV2.nombre, hora: "10:00:00", duracionMin: 60 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 8. Claves y centinelas sobre la respuesta real
// ---------------------------------------------------------------------------------------------------------------

describe("errores y prerrequisitos de la cita sembrada (criterio 2)", () => {
  it("los confirmados van primero aunque se guardaron después, la habilidad ajena trae su descripción, la caída a su clave no, y los prerrequisitos salen sin repetir", async () => {
    const d = exigirVista(await vistaDe(monitorA.cliente, sembrada.idCita)).diagnostico!;
    expect(d.errores).toEqual(erroresEsperados(sembrada.resultado));
    // Guardados: una sospecha, la confirmada, otra sospecha de una habilidad que no es de la Evaluación y una cuya descripción cayó a la clave.
    expect(d.errores.map((e) => e.estado)).toEqual(["confirmada", "sospecha", "sospecha", "sospecha"]);
    expect(d.errores.map((e) => e.titulo)).toEqual([
      expect.stringContaining("sin cuadrar la velocidad"),
      "confundes energía con potencia",
      "ignoras la fricción",
      "mezclas el sentido de dos vectores",
    ]);
    expect(d.errores[2].descripcionDeLaHabilidad, "una habilidad que no es de la Evaluación se muestra igual").toBe("calcula el trabajo de la fricción");
    expect(d.errores[3].descripcionDeLaHabilidad, "la clave no se muestra como descripción").toBeNull();
    expect(d.errores[0].detalles).toHaveLength(1);
    expect(d.errores[1].detalles).toEqual([]);

    // Cinco guardados, cuatro al leer: el repetido sale una vez, la misma clave en otra materia es otro y otra clave con la misma descripción también.
    expect(d.prerrequisitos).toEqual(prerrequisitosEsperados(sembrada.resultado));
    expect(d.prerrequisitos).toEqual([
      { materia: null, descripcion: "despeja una incógnita" },
      { materia: "Cálculo Diferencial", descripcion: "deriva polinomios" },
      { materia: "Precálculo", descripcion: PRERREQUISITO_CON_FORMULA },
      { materia: null, descripcion: "despeja una incógnita" },
    ]);
    expect(d.habilidades).toEqual(sembrada.resultado.habilidades.map((h) => ({ descripcion: h.descripcion, nivel: h.nivel, respuestas: h.respuestas, aciertos: h.aciertos })));
  });
});

describe("nada sensible en la respuesta real (criterio 13)", () => {
  it("las claves de cada nivel son exactamente las de la lista cerrada, y ninguna clave interna sale como clave ni como valor", async () => {
    const cruda = await filaCruda(monitorA.cliente, sembrada.idCita);
    expect(cruda.error).toBeNull();
    const [fila] = cruda.data as Record<string, unknown>[];
    expect(Object.keys(fila).sort()).toEqual([...CLAVES_DE_LA_VISTA_POR_NIVEL.fila].sort());

    const exacto = (objetos: unknown, esperadas: readonly string[]) => {
      expect((objetos as Record<string, unknown>[]).length).toBeGreaterThan(0);
      for (const objeto of objetos as Record<string, unknown>[]) expect(Object.keys(objeto).sort()).toEqual([...esperadas].sort());
    };
    exacto(fila.habilidades, CLAVES_DE_LA_VISTA_POR_NIVEL.habilidad);
    exacto(fila.errores, CLAVES_DE_LA_VISTA_POR_NIVEL.error);
    exacto(fila.prerrequisitos, CLAVES_DE_LA_VISTA_POR_NIVEL.prerrequisito);
    exacto(fila.preguntas, CLAVES_DE_LA_VISTA_POR_NIVEL.pregunta);
    for (const pregunta of fila.preguntas as { opciones: unknown }[]) exacto(pregunta.opciones, CLAVES_DE_LA_VISTA_POR_NIVEL.opcion);
    const todas = recorrer(cruda.data);
    for (const prohibida of ["clave", "tema", "dificultad", "habilidad", "misconcepcion", "correcta", "error", "orden", "fecha", "falta_material", "faltaMaterial", "semilla", "token_recuperacion", "id_lead", "id_sesion_anonima", "correo", "numero_telefono"]) {
      // `habilidades` y `fecha` sí son columnas de la fila: se descartan los nombres que coinciden con las permitidas.
      if ((CLAVES_DE_LA_VISTA_POR_NIVEL.fila as readonly string[]).includes(prohibida)) continue;
      expect(todas.has(prohibida), `la clave ${prohibida} no puede salir`).toBe(false);
    }
  });

  it("el texto de la respuesta no trae el correo ni el teléfono del Lead, su token, la semilla, la falta de material, los ids del Lead y de la sesión ni los textos de error de las opciones que no eligió", async () => {
    const cruda = await filaCruda(monitorA.cliente, sembrada.idCita);
    const texto = JSON.stringify(cruda.data);
    const diagnostico = exito(
      await fx.admin.from("diagnostico").select("token_recuperacion").eq("id", sembrada.idDiagnostico).single(),
      "leer el token del diagnóstico",
    );
    const token = (diagnostico as unknown as { token_recuperacion: string }).token_recuperacion;
    expect(token.length, "el token existe").toBeGreaterThan(8);

    const prohibidos = [
      leadV2.correo,
      leadV2.telefono,
      token,
      String(SEMILLA_SEMBRADA),
      leadV2.id,
      leadV2.idSesion,
      sembrada.idDiagnostico,
      "faltaMaterial",
      "falta_material",
      "sin_preguntas_sin_ver",
      "tope_una_respuesta",
      ...valoresInternos(sembrada.plan, sembrada.marca),
      ...textosDeErrorDeLasQueNoEligio(sembrada.plan, sembrada.marca),
    ];
    for (const prohibido of prohibidos) expect(texto.includes(prohibido), `la respuesta trae ${prohibido}`).toBe(false);

    // Y sí trae lo que debe: el nombre de quien agendó y las 8 preguntas.
    expect(texto).toContain(leadV2.nombre);
    const vista = exigirVista(await vistaDe(monitorA.cliente, sembrada.idCita));
    expect(vista.diagnostico!.preguntas).toHaveLength(8);
    expect(vista.diagnostico!.repetido).toBe(true);
    // La única vez que sale un texto de error es como detalle del error de la opción elegida (D-49 d).
    const detalles = vista.diagnostico!.errores.flatMap((e) => e.detalles);
    expect(detalles).toContain(textoDeErrorDeOpcion(sembrada.plan[1], sembrada.marca, sembrada.plan[1].elegidaDelBanco));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 9. Autorización por versión
// ---------------------------------------------------------------------------------------------------------------

describe("de quién es la autorización (D-67, F-3 del SPEC)", () => {
  it("cuenta la del Lead de la cita, y el diagnóstico tiene que ser de ese Lead o no tener Lead", async () => {
    const marca = `m${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const plan = planDeEjemplo();
    const resultado = resultadoGuardadoSembrado(marca);
    const preguntasDe = async (idCita: string) => (exigirVista(await vistaDe(monitorA.cliente, idCita)).diagnostico!).preguntas;

    // Un diagnóstico de otro Lead (v2) ligado a la cita de un Lead v1: sin preguntas.
    const deOtroLead = await sembrarDiagnostico({ lead: leadV2, plan, marca, resultado });
    expect(await preguntasDe(await crearCita({ lead: leadV1, idDiagnostico: deOtroLead })), "cita del Lead v1, diagnóstico del Lead v2").toBeNull();
    // Y al revés: la cita de un Lead v2 con el diagnóstico de otro Lead (v1): tampoco, aunque la cita autorizó.
    const deLeadV1 = await sembrarDiagnostico({ lead: leadV1, plan, marca, resultado });
    expect(await preguntasDe(await crearCita({ lead: leadV2, idDiagnostico: deLeadV1 })), "cita del Lead v2, diagnóstico de otro Lead").toBeNull();

    // Un diagnóstico sin Lead (de una sesión que aún no dejaba su contacto) con la cita de un Lead v2: con preguntas...
    const sinLead = await sembrarDiagnostico({ lead: null, idSesion: sesionSinLead.id, plan, marca, resultado });
    const conPreguntas = await preguntasDe(await crearCita({ lead: leadV2, idDiagnostico: sinLead }));
    expect(conPreguntas, "cita del Lead v2, diagnóstico sin Lead").toHaveLength(8);
    // ...y con la cita de un Lead v1: sin preguntas (no se trata como autorizado por no tener Lead).
    expect(await preguntasDe(await crearCita({ lead: leadV1, idDiagnostico: sinLead })), "cita del Lead v1, diagnóstico sin Lead").toBeNull();
  });
});

describe("autorización por versión (D-67, criterio 14)", () => {
  it("con el texto viejo (v1) el monitor ve el resultado y no las respuestas; cuando el Lead autoriza con el texto nuevo, la misma cita ya las trae", async () => {
    const marca = `m${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const plan = planDeEjemplo();
    const idDiagnostico = await sembrarDiagnostico({ lead: leadV1, conSesion: true, plan, marca, resultado: resultadoGuardadoSembrado(marca) });
    const idCita = await crearCita({ lead: leadV1, idDiagnostico });

    const antes = exigirVista(await vistaDe(monitorA.cliente, idCita));
    expect(antes.diagnostico!.preguntas, "con v1 no hay preguntas").toBeNull();
    expect(antes.diagnostico).toMatchObject({ respondidas: 8, aciertos: 5 });
    expect(antes.diagnostico!.habilidades).toHaveLength(8);
    expect(antes.diagnostico!.errores.length).toBeGreaterThan(0);
    const cruda = await filaCruda(monitorA.cliente, idCita);
    const [fila] = cruda.data as Record<string, unknown>[];
    expect(fila.respuestas_autorizadas).toBe(false);
    expect(fila.preguntas).toBeNull();
    // Ningún texto de las preguntas sale en ninguna parte de la respuesta.
    for (const p of preguntasEsperadas(plan, marca)) {
      expect(JSON.stringify(cruda.data)).not.toContain(p.enunciado);
      if (p.solucion) expect(JSON.stringify(cruda.data)).not.toContain(p.solucion);
    }

    // El Lead edita su contacto marcando la casilla nueva (HU-087): pasa a v2 (el update equivalente con la llave secreta).
    exito(await fx.admin.from("lead").update({ version_autorizacion: "v2" }).eq("id", leadV1.id).select().single(), "pasar el Lead a v2");
    try {
      const despues = exigirVista(await vistaDe(monitorA.cliente, idCita));
      expect(despues.diagnostico!.preguntas, "con v2 hay preguntas").toHaveLength(8);
      expect(despues.diagnostico!.preguntas!.map((p) => p.enunciado)).toEqual(preguntasEsperadas(plan, marca).map((p) => p.enunciado));
    } finally {
      exito(await fx.admin.from("lead").update({ version_autorizacion: "v1" }).eq("id", leadV1.id).select().single(), "devolver el Lead a v1");
    }
  });
});
