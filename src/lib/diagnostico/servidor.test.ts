import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leerFotoDelBanco } from "./entrada";
import { LETRAS, calificar, paraNavegador, siguientePregunta, type CopiaDePaso, type EntradaMotor, type Letra, type PreguntaCandidata } from "./motor";
import { HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO, clavesNoPermitidas, type EnCurso, type Terminado } from "./reglas";

// HU-081: el servidor del diagnóstico con una base falsa. La base falsa repite lo que hacen las funciones de la migración
// (`diagnostico_en_curso_de`, `iniciar_diagnostico`, `responder_diagnostico` y `terminar_diagnostico`), así que estas pruebas
// recorren un diagnóstico completo por las tres operaciones sin base de datos. Lo que sí necesita la base (los candados, los
// permisos, la hora real) lo prueban pgTAP y `integracion/diagnostico.test.ts`.

// `crypto.randomInt` se espía para comprobar de dónde sale la semilla, pero por omisión sigue siendo el de verdad.
const { randomInt } = vi.hoisted(() => ({ randomInt: vi.fn<(min: number, max: number) => number>() }));
vi.mock("node:crypto", async (original) => {
  const real = await original<typeof import("node:crypto")>();
  randomInt.mockImplementation(real.randomInt as unknown as (min: number, max: number) => number);
  return { ...real, randomInt };
});

import { diagnosticoEnCurso, iniciarDiagnostico, responderDiagnostico, type ClienteDelDiagnostico } from "./servidor";

const SESION = { idUsuario: "5e000000-0000-4000-8000-000000000001", rol: "anonimo" as const };
const OTRA_SESION = { idUsuario: "5e000000-0000-4000-8000-000000000002", rol: "anonimo" as const };
const EV_A = "e0000000-0000-4000-8000-00000000000a";
const EV_B = "e0000000-0000-4000-8000-00000000000b";
const EV_INACTIVA = "e0000000-0000-4000-8000-00000000000c";
const ULTIMO = "d0000000-0000-4000-8000-0000000000aa";
const ID_MATERIA = "a0000000-0000-4000-8000-000000000001";
const SEMILLA = 3_141_592_653;
const SOLUCION_SECRETA = "SOLUCION-SECRETA-DE-LA-TERCERA";
const ERROR_SECRETO = "ERROR-SECRETO-DE-LA-OPCION";

// ---------------------------------------------------------------------------
// El banco de prueba: dos habilidades, tres preguntas de la primera y dos de la segunda
// ---------------------------------------------------------------------------

function candidata(clave: string, enunciado: string, dificultad: 1 | 2 | 3, habilidad: string): PreguntaCandidata {
  return {
    clave,
    tema: "tema-1",
    enunciado,
    opciones: [
      { texto: `${enunciado}: la buena`, correcta: true, misconcepcion: null, error: null },
      { texto: `${enunciado}: trampa uno`, correcta: false, misconcepcion: `${habilidad}.a`, error: ERROR_SECRETO },
      { texto: `${enunciado}: trampa dos`, correcta: false, misconcepcion: `${habilidad}.b`, error: null },
      { texto: `${enunciado}: trampa tres`, correcta: false, misconcepcion: `${habilidad}.c`, error: null },
    ],
    dificultad,
    habilidades: [habilidad],
    solucion: clave === "CLV-3" ? SOLUCION_SECRETA : null,
  };
}

const CANDIDATAS = [
  candidata("CLV-1", "Enunciado alfa", 2, "h1"),
  candidata("CLV-2", "Enunciado beta", 2, "h1"),
  candidata("CLV-3", "Enunciado gamma", 3, "h1"),
  candidata("CLV-4", "Enunciado delta", 2, "h2"),
  candidata("CLV-5", "Enunciado épsilon", 3, "h2"),
];
const TODAS_LAS_CLAVES = CANDIDATAS.map((c) => c.clave);

/** Lo que devuelve `public.banco_de_la_evaluacion`. */
function foto(idEvaluacion = EV_A, nombre = "Parcial 1", candidatas: PreguntaCandidata[] = CANDIDATAS): unknown {
  return JSON.parse(
    JSON.stringify({
      contexto: {
        version: 1,
        evaluacion: { id: idEvaluacion, nombre },
        materia: { id: ID_MATERIA, codigo: "MAT-1", nombre: "Matemáticas" },
        habilidades: [
          { clave: "h1", descripcion: "Primera habilidad", prerrequisitos: [{ materia: "Otra materia", habilidad: "base", descripcion: "Una base" }] },
          { clave: "h2", descripcion: "Segunda habilidad", prerrequisitos: [] },
        ],
        misconcepciones: ["h1", "h2"].flatMap((h) => ["a", "b", "c"].map((x) => ({ clave: `${h}.${x}`, habilidad: h, descripcion: `Error ${h}.${x}` }))),
        descripcionesDeHabilidad: { h1: "Primera habilidad", h2: "Segunda habilidad" },
      },
      candidatas,
    }),
  );
}

// ---------------------------------------------------------------------------
// La base falsa
// ---------------------------------------------------------------------------

type Fila = {
  id: string;
  id_sesion: string;
  id_evaluacion: string;
  id_materia: string;
  semilla: number;
  vistas_antes: string[];
  repetido: boolean;
  candidatas: unknown;
  contexto: unknown;
  pasos: unknown[];
  paso: number;
  iniciado_en: string;
  actualizado_en: string;
};

type Args = Record<string, unknown>;
type ErrorDePostgrest = { code: string; message: string; details: string; hint: string };

const copia = <T>(valor: T): T => structuredClone(valor);
const versionDe = (contexto: unknown) => (contexto as { version?: unknown }).version;

class BaseFalsa {
  ahora = new Date("2026-10-05T12:00:00.000Z");
  enCurso = new Map<string, Fila>();
  diagnosticos: Record<string, unknown>[] = [];
  /** Las Evaluaciones activas y su foto. `banco_de_la_evaluacion` da null para las demás. */
  bancos = new Map<string, unknown>();
  /** Cuenta los diagnósticos que se siembran, para que cada uno tenga una fecha de realización posterior a la anterior. */
  private terminados = 0;
  /** Sesiones que son de un admin o de un monitor en la base. */
  equipo = new Set<string>();
  llamadas: string[] = [];
  argumentos: Record<string, Args[]> = {};
  /** Un error que devuelve la función de ese nombre, como lo haría PostgREST. */
  errores = new Map<string, ErrorDePostgrest>();
  /** Lo que pasa justo después de que responde una función: otra pestaña que se mete en medio. */
  despues = new Map<string, () => void>();

  rpc = vi.fn(async (nombre: string, args: Args): Promise<{ data: unknown; error: ErrorDePostgrest | null }> => {
    this.llamadas.push(nombre);
    (this.argumentos[nombre] ??= []).push(copia(args));
    const error = this.errores.get(nombre);
    if (error) return { data: null, error };
    const data = this.ejecutar(nombre, args);
    const gancho = this.despues.get(nombre);
    if (gancho) {
      this.despues.delete(nombre);
      gancho();
    }
    return { data, error: null };
  });

  from = vi.fn((tabla: string) => {
    this.llamadas.push(`from:${tabla}`);
    const filtros: Record<string, unknown> = {};
    const consulta = {
      select: () => consulta,
      eq: (columna: string, valor: unknown) => {
        filtros[columna] = valor;
        return consulta;
      },
      maybeSingle: async () => {
        const error = this.errores.get(`from:${tabla}`);
        if (error) return { data: null, error };
        const fila = this.diagnosticos.find((d) => Object.entries(filtros).every(([columna, valor]) => d[columna] === valor));
        return { data: fila ? { id: fila.id as string } : null, error: null };
      },
    };
    return consulta;
  });

  cliente(): ClienteDelDiagnostico {
    return { rpc: this.rpc, from: this.from } as unknown as ClienteDelDiagnostico;
  }

  activar(idEvaluacion: string, nombre = "Parcial 1", candidatas: PreguntaCandidata[] = CANDIDATAS): void {
    this.bancos.set(idEvaluacion, foto(idEvaluacion, nombre, candidatas));
  }

  /** Dos horas desde la última respuesta: a las 2 horas exactas ya venció. */
  private vigente(idSesion: unknown): Fila | null {
    const fila = this.enCurso.get(idSesion as string);
    if (!fila) return null;
    const vence = new Date(fila.actualizado_en).getTime() + HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO * 3_600_000;
    return vence > this.ahora.getTime() ? fila : null;
  }

  /**
   * Un diagnóstico terminado antes, de la sesión y la Evaluación dadas, con las preguntas de `claves`. Cada uno que se siembra es
   * más reciente que el anterior, y todos más antiguos que lo que termine la prueba.
   */
  yaVio(idSesion: string, idEvaluacion: string, claves: string[], id: string = crypto.randomUUID()): void {
    this.terminados += 1;
    this.diagnosticos.push({
      id,
      id_sesion_anonima: idSesion,
      id_evaluacion: idEvaluacion,
      id_materia: ID_MATERIA,
      fecha_realizacion: new Date(Date.UTC(2026, 9, 1, 0, this.terminados)).toISOString(),
      respuestas: claves.map((clave) => ({ clave })),
    });
  }

  /** Borra los diagnósticos terminados: una base sin historial. */
  sinHistorial(): void {
    this.diagnosticos.length = 0;
  }

  /** Lo que haría `iniciar_diagnostico` desde otra pestaña. */
  sembrar(idSesion: string, idEvaluacion: string, semilla: number): Fila {
    const banco = this.bancos.get(idEvaluacion) as { contexto: unknown; candidatas: unknown };
    const fila: Fila = {
      id: crypto.randomUUID(),
      id_sesion: idSesion,
      id_evaluacion: idEvaluacion,
      id_materia: ID_MATERIA,
      semilla,
      vistas_antes: [],
      repetido: false,
      candidatas: copia(banco.candidatas),
      contexto: copia(banco.contexto),
      pasos: [],
      paso: 0,
      iniciado_en: this.ahora.toISOString(),
      actualizado_en: this.ahora.toISOString(),
    };
    this.enCurso.set(idSesion, fila);
    return fila;
  }

  private ejecutar(nombre: string, args: Args): unknown {
    const sesion = args.p_id_sesion as string;
    switch (nombre) {
      case "diagnostico_en_curso_de": {
        const fila = this.vigente(sesion);
        return fila ? [copia(fila)] : [];
      }
      case "banco_de_la_evaluacion":
        return copia(this.bancos.get(args.p_id_evaluacion as string) ?? null);
      case "vistas_de_la_sesion": {
        // Lo que calcula la función de SQL: de los diagnósticos terminados de la sesión pedida, en la materia de la Evaluación
        // pedida. Una Evaluación que no existe no da nada.
        if (!this.bancos.has(args.p_id_evaluacion as string)) return [{ claves: [], id_ultimo: null }];
        const propios = this.diagnosticos.filter((d) => d.id_sesion_anonima === sesion && d.id_materia === ID_MATERIA);
        const claves = new Set<string>();
        for (const diagnostico of propios) {
          for (const respuesta of diagnostico.respuestas as { clave?: unknown }[]) {
            if (typeof respuesta.clave === "string") claves.add(respuesta.clave);
          }
        }
        // El último: primero el de la Evaluación pedida, luego el más reciente y, a igual fecha, el de id mayor.
        const ultimo = [...propios].sort(
          (a, b) =>
            Number(b.id_evaluacion === args.p_id_evaluacion) - Number(a.id_evaluacion === args.p_id_evaluacion) ||
            String(b.fecha_realizacion).localeCompare(String(a.fecha_realizacion)) ||
            String(b.id).localeCompare(String(a.id)),
        )[0];
        return [{ claves: [...claves].sort(), id_ultimo: (ultimo?.id as string | undefined) ?? null }];
      }
      case "iniciar_diagnostico": {
        if (this.equipo.has(sesion)) return [{ resultado: "cuenta_del_equipo", id: null }];
        const actual = this.vigente(sesion);
        if (!actual) this.enCurso.delete(sesion);
        if (actual && actual.id_evaluacion === args.p_id_evaluacion && versionDe(actual.contexto) === versionDe(args.p_contexto)) {
          return [{ resultado: "ya_en_curso", id: actual.id }];
        }
        if (!this.bancos.has(args.p_id_evaluacion as string)) return [{ resultado: "evaluacion_no_disponible", id: null }];
        const fila: Fila = {
          id: crypto.randomUUID(),
          id_sesion: sesion,
          id_evaluacion: args.p_id_evaluacion as string,
          id_materia: ID_MATERIA,
          semilla: args.p_semilla as number,
          vistas_antes: args.p_vistas_antes as string[],
          repetido: args.p_repetido as boolean,
          candidatas: args.p_candidatas,
          contexto: args.p_contexto,
          pasos: [],
          paso: 0,
          iniciado_en: this.ahora.toISOString(),
          actualizado_en: this.ahora.toISOString(),
        };
        this.enCurso.set(sesion, fila);
        return [{ resultado: "creado", id: fila.id }];
      }
      case "responder_diagnostico": {
        const fila = this.vigente(sesion);
        const objeto = typeof args.p_copia === "object" && args.p_copia !== null && !Array.isArray(args.p_copia);
        if (!fila || fila.id !== args.p_id || fila.paso !== args.p_paso || !objeto) return false;
        fila.pasos = [...fila.pasos, args.p_copia];
        fila.paso += 1;
        fila.actualizado_en = this.ahora.toISOString();
        return true;
      }
      case "terminar_diagnostico": {
        const fila = this.vigente(sesion);
        if (!fila || fila.id !== args.p_id || fila.paso !== args.p_paso) return [{ resultado: "no_aplicada", id: null }];
        const respuestas = [...fila.pasos, args.p_copia];
        this.diagnosticos.push({
          id: fila.id,
          id_sesion_anonima: sesion,
          id_evaluacion: fila.id_evaluacion,
          id_materia: fila.id_materia,
          fecha_realizacion: this.ahora.toISOString(),
          respuestas,
          respondidas: respuestas.length,
          semilla: fila.semilla,
          repetido: fila.repetido,
          puntaje: args.p_puntaje,
          aciertos: args.p_aciertos,
          resultado_por_habilidad: args.p_resultado,
          falta_material: args.p_falta_material,
        });
        this.enCurso.delete(sesion);
        return [{ resultado: "terminado", id: fila.id }];
      }
      default:
        throw new Error(`La base falsa no conoce ${nombre}.`);
    }
  }
}

let base: BaseFalsa;

beforeEach(() => {
  base = new BaseFalsa();
  base.activar(EV_A);
  randomInt.mockClear();
});

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Ayudas de las pruebas
// ---------------------------------------------------------------------------

const dependencias = (semilla: number | undefined = SEMILLA) => ({ cliente: base.cliente(), semilla });

function iniciar(pedido: { idEvaluacion?: unknown; volverATomar?: boolean } = {}, sesion = SESION, semilla?: number) {
  return iniciarDiagnostico(sesion, { idEvaluacion: EV_A, ...pedido }, dependencias(semilla));
}

function responder(pedido: { idDiagnostico: unknown; paso: unknown; letra: unknown }, sesion = SESION) {
  return responderDiagnostico(sesion, pedido, dependencias());
}

function enCurso(respuesta: { estado: string }): EnCurso {
  expect(respuesta.estado).toBe("en_curso");
  return respuesta as EnCurso;
}

function sinLlamadas(): void {
  base.llamadas.length = 0;
  base.rpc.mockClear();
  base.from.mockClear();
}

/** La candidata del banco de prueba que se está mostrando. */
const candidataMostrada = (pregunta: EnCurso["pregunta"]) => CANDIDATAS.find((c) => c.enunciado === pregunta.enunciado) as PreguntaCandidata;

/** La letra que ve la persona para la opción del banco `indice` (0 es la correcta). */
function letraDeLaOpcion(pregunta: EnCurso["pregunta"], indice: number): Letra {
  const texto = candidataMostrada(pregunta).opciones[indice].texto;
  return LETRAS[pregunta.opciones.findIndex((o) => o.texto === texto)];
}

type Eleccion = (pregunta: EnCurso["pregunta"], paso: number) => Letra;
const laCorrecta: Eleccion = (pregunta) => letraDeLaOpcion(pregunta, 0);
const laPrimeraTrampa: Eleccion = (pregunta) => letraDeLaOpcion(pregunta, 1);

/** Recorre un diagnóstico completo por las operaciones del servidor y devuelve todo lo que recibió el navegador. */
async function jugar(eleccion: Eleccion, sesion = SESION, semilla = SEMILLA) {
  const recibido: unknown[] = [];
  let actual: { estado: string } = await iniciarDiagnostico(sesion, { idEvaluacion: EV_A }, dependencias(semilla));
  recibido.push(actual);
  for (let vueltas = 0; actual.estado === "en_curso"; vueltas++) {
    expect(vueltas).toBeLessThan(25);
    const pendiente = actual as EnCurso;
    actual = await responderDiagnostico(
      sesion,
      { idDiagnostico: pendiente.idDiagnostico, paso: pendiente.paso, letra: eleccion(pendiente.pregunta, pendiente.paso) },
      dependencias(semilla),
    );
    recibido.push(actual);
  }
  return { recibido, final: actual };
}

/** Lo que daría el motor puro con la misma foto, la misma semilla y las mismas elecciones: lo que el servidor debe mostrar. */
function conElMotor(eleccion: Eleccion, semilla = SEMILLA, vistasAntes: string[] = []) {
  const lectura = leerFotoDelBanco(foto());
  if (!lectura.ok) throw new Error("la foto de prueba debe leerse");
  const entrada: EntradaMotor = {
    habilidades: lectura.foto.contexto.habilidades,
    misconcepciones: lectura.foto.contexto.misconcepciones,
    candidatas: lectura.foto.candidatas,
    vistasAntes,
    semilla,
  };
  const pasos: CopiaDePaso[] = [];
  const mostradas: EnCurso["pregunta"][] = [];
  for (;;) {
    const siguiente = siguientePregunta(entrada, pasos);
    if ("terminado" in siguiente) break;
    const elegida = entrada.candidatas.find((c) => c.clave === siguiente.clave) as PreguntaCandidata;
    const pregunta = paraNavegador(elegida, siguiente.orden);
    mostradas.push(pregunta);
    pasos.push({ ...elegida, orden: [...siguiente.orden], letraElegida: eleccion(pregunta, pasos.length), fecha: "2026-10-05T12:00:00.000Z" });
  }
  return { entrada, pasos, mostradas, resultado: calificar(entrada, pasos) };
}

/** Responde, con la elección dada, hasta que falte una sola pregunta. */
async function hastaElUltimoPaso(actual: EnCurso, eleccion: Eleccion = laCorrecta): Promise<EnCurso> {
  const total = conElMotor(eleccion).pasos.length;
  for (let vueltas = 0; actual.paso < total - 1; vueltas++) {
    // Si una respuesta no avanza el paso, que la prueba falle y no se quede dando vueltas.
    expect(vueltas).toBeLessThan(total);
    actual = enCurso(await responder({ idDiagnostico: actual.idDiagnostico, paso: actual.paso, letra: eleccion(actual.pregunta, actual.paso) }));
  }
  return actual;
}

// ---------------------------------------------------------------------------
// iniciarDiagnostico
// ---------------------------------------------------------------------------

describe("iniciarDiagnostico: crear", () => {
  it("crea el diagnóstico en curso con la foto del banco y devuelve la primera pregunta", async () => {
    const respuesta = enCurso(await iniciar());

    expect(base.enCurso.size).toBe(1);
    const fila = base.enCurso.get(SESION.idUsuario) as Fila;
    expect(fila).toMatchObject({ id_evaluacion: EV_A, semilla: SEMILLA, vistas_antes: [], repetido: false, paso: 0, pasos: [] });
    expect((fila.candidatas as { clave: string }[]).map((c) => c.clave)).toEqual(TODAS_LAS_CLAVES);
    expect(respuesta).toMatchObject({
      estado: "en_curso",
      idDiagnostico: fila.id,
      evaluacion: { id: EV_A, nombre: "Parcial 1" },
      materia: { codigo: "MAT-1", nombre: "Matemáticas" },
      paso: 0,
      maximo: 4,
    });
    expect(respuesta.pregunta.opciones.map((o) => o.letra)).toEqual(["A", "B", "C", "D"]);
    expect(clavesNoPermitidas(respuesta)).toEqual([]);
  });

  it("la primera pregunta es la que da el motor con esa foto y esa semilla", async () => {
    const esperado = conElMotor(laCorrecta);
    expect(enCurso(await iniciar()).pregunta).toEqual(esperado.mostradas[0]);
  });

  it("guarda las vistas antes de la sesión y no repetido, aunque llegue volverATomar y queden preguntas libres (D-49 a)", async () => {
    base.yaVio(SESION.idUsuario, EV_A, ["CLV-1"], ULTIMO);
    await iniciar({ volverATomar: true });
    const fila = base.enCurso.get(SESION.idUsuario) as Fila;
    expect(fila.vistas_antes).toEqual(["CLV-1"]);
    expect(fila.repetido).toBe(false);
  });

  it("la semilla sale de crypto.randomInt(0, 2 ** 32)", async () => {
    randomInt.mockReturnValueOnce(2_718_281_828);
    await iniciarDiagnostico(SESION, { idEvaluacion: EV_A }, { cliente: base.cliente() });
    expect(randomInt).toHaveBeenCalledTimes(1);
    expect(randomInt).toHaveBeenCalledWith(0, 2 ** 32);
    expect(base.enCurso.get(SESION.idUsuario)?.semilla).toBe(2_718_281_828);
  });

  it("con una semilla en las dependencias no llama a crypto", async () => {
    await iniciar({}, SESION, 5);
    expect(randomInt).not.toHaveBeenCalled();
    expect(base.enCurso.get(SESION.idUsuario)?.semilla).toBe(5);
  });

  it("la semilla real cae en el rango de 32 bits sin signo", async () => {
    for (let i = 0; i < 5; i++) {
      base.enCurso.clear();
      await iniciarDiagnostico(SESION, { idEvaluacion: EV_A }, { cliente: base.cliente() });
      const semilla = base.enCurso.get(SESION.idUsuario)?.semilla as number;
      expect(Number.isInteger(semilla)).toBe(true);
      expect(semilla).toBeGreaterThanOrEqual(0);
      expect(semilla).toBeLessThan(2 ** 32);
    }
  });

  it("acepta el id de la Evaluación en mayúsculas y lo manda a la base en minúsculas", async () => {
    enCurso(await iniciar({ idEvaluacion: EV_A.toUpperCase() }));
    expect(base.argumentos.banco_de_la_evaluacion[0].p_id_evaluacion).toBe(EV_A);
  });

  it("con la letra de cada posición, la correcta se reparte entre las cuatro y ninguna pasa del 40 % (100 semillas)", async () => {
    const cuentas = [0, 0, 0, 0];
    for (let semilla = 1; semilla <= 100; semilla++) {
      base.enCurso.clear();
      const respuesta = enCurso(await iniciar({}, SESION, semilla));
      cuentas[LETRAS.indexOf(letraDeLaOpcion(respuesta.pregunta, 0))] += 1;
    }
    expect(cuentas.reduce((suma, n) => suma + n, 0)).toBe(100);
    for (const n of cuentas) {
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(40);
    }
  });
});

describe("iniciarDiagnostico: lo que no se puede tomar", () => {
  it("una Evaluación inactiva o que no existe es no_disponible, sin crear nada ni tocar la pendiente de otra Evaluación", async () => {
    const pendiente = enCurso(await iniciar());
    const antes = copia(base.enCurso.get(SESION.idUsuario));
    const respuesta = await iniciar({ idEvaluacion: EV_INACTIVA });
    expect(respuesta).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(base.argumentos.iniciar_diagnostico).toHaveLength(1);
    expect(base.enCurso.get(SESION.idUsuario)).toEqual(antes);
    expect(base.enCurso.get(SESION.idUsuario)?.id).toBe(pendiente.idDiagnostico);
  });

  it("sin una Evaluación inactiva a la vista y sin pendiente tampoco crea nada", async () => {
    expect(await iniciar({ idEvaluacion: EV_INACTIVA })).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(base.enCurso.size).toBe(0);
    expect(base.llamadas).not.toContain("iniciar_diagnostico");
  });

  it.each([undefined, null, "", "no-es-un-uuid", 7, ` ${EV_A}`, `${EV_A}x`, {}, [EV_A]])(
    "un idEvaluacion que no es un UUID (%j) es no_disponible y no llama a nada",
    async (idEvaluacion) => {
      expect(await iniciar({ idEvaluacion })).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
      expect(base.llamadas).toEqual([]);
    },
  );

  it.each(["admin", "monitor"] as const)("una cuenta de %s es no_disponible/cuenta_del_equipo y no hace ninguna llamada", async (rol) => {
    expect(await iniciar({}, { idUsuario: SESION.idUsuario, rol } as never)).toEqual({ estado: "no_disponible", motivo: "cuenta_del_equipo" });
    expect(base.llamadas).toEqual([]);
  });

  it("si la base dice cuenta_del_equipo (el rol no lo mostraba), es no_disponible/cuenta_del_equipo y no crea nada", async () => {
    base.equipo.add(SESION.idUsuario);
    expect(await iniciar()).toEqual({ estado: "no_disponible", motivo: "cuenta_del_equipo" });
    expect(base.enCurso.size).toBe(0);
  });

  it("si la Evaluación se desactiva entre la foto y iniciar_diagnostico, es no_disponible y no crea nada", async () => {
    base.despues.set("banco_de_la_evaluacion", () => base.bancos.delete(EV_A));
    expect(await iniciar()).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(base.llamadas).toContain("iniciar_diagnostico");
    expect(base.enCurso.size).toBe(0);
  });

  it("una Evaluación sin preguntas revisadas es no_disponible, también con volverATomar: no es «ya viste todas»", async () => {
    base.activar(EV_A, "Parcial 1", []);
    for (const volverATomar of [false, true]) {
      expect(await iniciar({ volverATomar })).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    }
    expect(base.llamadas).not.toContain("iniciar_diagnostico");
    expect(base.enCurso.size).toBe(0);
  });

  it("una foto que no sirve es no_disponible, se registra sin el contenido de la pregunta y no crea nada", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    const mala = foto() as { candidatas: { opciones: unknown[] }[] };
    mala.candidatas[1].opciones.pop();
    base.bancos.set(EV_A, mala);

    expect(await iniciar()).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(base.llamadas).not.toContain("iniciar_diagnostico");
    expect(registro).toHaveBeenCalledTimes(1);
    const mensaje = String(registro.mock.calls[0][0]);
    expect(mensaje).toContain("CLV-2");
    expect(mensaje).not.toContain("Enunciado");
    expect(mensaje).not.toContain(SOLUCION_SECRETA);
  });

  it("una foto de otra versión del formato es no_disponible", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const otra = foto() as { contexto: { version: number } };
    otra.contexto.version = 2;
    base.bancos.set(EV_A, otra);
    expect(await iniciar()).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(base.enCurso.size).toBe(0);
  });
});

describe("iniciarDiagnostico: recargar y cambiar de Evaluación (D-49)", () => {
  it("con una pendiente de la misma Evaluación devuelve la misma pregunta sin llamar al banco ni a iniciar_diagnostico", async () => {
    const primera = enCurso(await iniciar());
    const antes = copia(base.enCurso.get(SESION.idUsuario));
    sinLlamadas();

    const otra = await iniciar({}, SESION, 12_345);
    expect(otra).toEqual(primera);
    expect(base.llamadas).toEqual(["diagnostico_en_curso_de"]);
    // Ni la semilla ni las 2 horas cambian.
    expect(base.enCurso.get(SESION.idUsuario)).toEqual(antes);
  });

  it("gana la pendiente aunque la Evaluación ya esté inactiva", async () => {
    const primera = enCurso(await iniciar());
    base.bancos.delete(EV_A);
    sinLlamadas();
    expect(await iniciar()).toEqual(primera);
    expect(base.llamadas).toEqual(["diagnostico_en_curso_de"]);
  });

  it("volverATomar con la misma Evaluación pendiente devuelve la pendiente y no lee el banco", async () => {
    const primera = enCurso(await iniciar());
    sinLlamadas();
    expect(await iniciar({ volverATomar: true })).toEqual(primera);
    expect(base.llamadas).not.toContain("banco_de_la_evaluacion");
    expect(base.llamadas).not.toContain("iniciar_diagnostico");
  });

  it("otra Evaluación descarta la anterior y empieza una nueva: una fila por sesión", async () => {
    base.activar(EV_B, "Parcial 2");
    const primera = enCurso(await iniciar());
    const segunda = enCurso(await iniciar({ idEvaluacion: EV_B }));
    expect(segunda.idDiagnostico).not.toBe(primera.idDiagnostico);
    expect(segunda.evaluacion).toEqual({ id: EV_B, nombre: "Parcial 2" });
    expect(base.enCurso.size).toBe(1);
    expect(base.enCurso.get(SESION.idUsuario)?.id).toBe(segunda.idDiagnostico);
  });

  it("un diagnóstico vencido (2 horas sin responder) empieza otro, con otra semilla y otro id", async () => {
    const primera = enCurso(await iniciar({}, SESION, 111));
    base.ahora = new Date(base.ahora.getTime() + HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO * 3_600_000);
    const segunda = enCurso(await iniciar({}, SESION, 222));
    expect(segunda.idDiagnostico).not.toBe(primera.idDiagnostico);
    expect(base.enCurso.get(SESION.idUsuario)?.semilla).toBe(222);
    expect(base.enCurso.size).toBe(1);
  });

  it("una pendiente de otra versión del formato se reemplaza", async () => {
    const primera = enCurso(await iniciar());
    (base.enCurso.get(SESION.idUsuario)?.contexto as { version: number }).version = 99;
    const segunda = enCurso(await iniciar());
    expect(segunda.idDiagnostico).not.toBe(primera.idDiagnostico);
    expect(versionDe(base.enCurso.get(SESION.idUsuario)?.contexto)).toBe(1);
  });

  it("si otra pestaña ganó la carrera (ya_en_curso), muestra la fila que quedó y no la suya", async () => {
    let ganadora: Fila | undefined;
    base.despues.set("vistas_de_la_sesion", () => {
      ganadora = base.sembrar(SESION.idUsuario, EV_A, 999);
    });
    const respuesta = enCurso(await iniciar({}, SESION, 111));
    expect(ganadora).toBeDefined();
    expect(respuesta.idDiagnostico).toBe(ganadora?.id);
    expect(base.enCurso.size).toBe(1);
    expect(base.enCurso.get(SESION.idUsuario)?.semilla).toBe(999);
    expect(respuesta.pregunta).toEqual(conElMotor(laCorrecta, 999).mostradas[0]);
  });

  it("si la fila desaparece entre la base y la lectura, vuelve a empezar una sola vez", async () => {
    base.despues.set("iniciar_diagnostico", () => base.enCurso.clear());
    const respuesta = enCurso(await iniciar());
    expect(base.argumentos.iniciar_diagnostico).toHaveLength(2);
    expect(respuesta.idDiagnostico).toBe(base.enCurso.get(SESION.idUsuario)?.id);
  });

  it("si al releer hay otra fila (otra pestaña empezó otra Evaluación), no la muestra: vuelve a empezar una vez", async () => {
    base.activar(EV_B, "Parcial 2");
    base.despues.set("iniciar_diagnostico", () => {
      base.sembrar(SESION.idUsuario, EV_B, 5);
    });
    const respuesta = enCurso(await iniciar());
    expect(base.argumentos.iniciar_diagnostico).toHaveLength(2);
    expect(respuesta.evaluacion.id).toBe(EV_A);
    expect(respuesta.idDiagnostico).toBe(base.enCurso.get(SESION.idUsuario)?.id);
  });

  it("si la fila vuelve a desaparecer, lanza un error genérico y no inventa un estado", async () => {
    const borrar = () => {
      base.enCurso.clear();
      base.despues.set("iniciar_diagnostico", borrar);
    };
    base.despues.set("iniciar_diagnostico", borrar);
    await expect(iniciar()).rejects.toThrow("desapareció dos veces seguidas");
    expect(base.argumentos.iniciar_diagnostico).toHaveLength(2);
  });
});

describe("iniciarDiagnostico: sin preguntas nuevas y volver a tomarlo (D-51)", () => {
  beforeEach(() => {
    base.yaVio(SESION.idUsuario, EV_A, TODAS_LAS_CLAVES, ULTIMO);
  });

  it("si ya vio todas, responde sin_preguntas con el último diagnóstico y no crea nada", async () => {
    expect(await iniciar()).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: ULTIMO });
    expect(base.llamadas).not.toContain("iniciar_diagnostico");
    expect(base.enCurso.size).toBe(0);
  });

  it("sin ningún diagnóstico terminado, idUltimoDiagnostico es nulo", async () => {
    // Las candidatas miden una habilidad que no es de la Evaluación: el motor no tiene pregunta aunque no se haya visto nada.
    base.sinHistorial();
    base.activar(EV_A, "Parcial 1", CANDIDATAS.map((c) => ({ ...c, habilidades: ["h9"] })));
    expect(await iniciar()).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: null });
  });

  it("no descarta la pendiente de otra Evaluación", async () => {
    base.activar(EV_B, "Parcial 2");
    // Sin historial, la otra Evaluación sí tiene preguntas y queda pendiente; después la persona «ya vio todas» las de esta.
    base.sinHistorial();
    const pendiente = enCurso(await iniciar({ idEvaluacion: EV_B }));
    base.yaVio(SESION.idUsuario, EV_A, TODAS_LAS_CLAVES, ULTIMO);
    expect(await iniciar()).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: ULTIMO });
    expect(base.enCurso.get(SESION.idUsuario)?.id).toBe(pendiente.idDiagnostico);
  });

  it("con volverATomar crea un diagnóstico sin excluir las vistas, marcado repetido", async () => {
    const respuesta = enCurso(await iniciar({ volverATomar: true }));
    const fila = base.enCurso.get(SESION.idUsuario) as Fila;
    expect(fila.vistas_antes).toEqual([]);
    expect(fila.repetido).toBe(true);
    expect(respuesta.maximo).toBe(4);
    expect(respuesta.idDiagnostico).toBe(fila.id);
  });

  it("con la misma semilla, el repetido arranca por la misma pregunta que el primer diagnóstico", async () => {
    const repetido = enCurso(await iniciar({ volverATomar: true }, SESION, 77));
    expect(repetido.pregunta).toEqual(conElMotor(laCorrecta, 77, []).mostradas[0]);
  });

  it("volverATomar solo vale si no hay libres: con una libre se ignora y el diagnóstico no queda marcado", async () => {
    base.sinHistorial();
    base.yaVio(SESION.idUsuario, EV_A, TODAS_LAS_CLAVES.slice(0, -1), ULTIMO);
    const respuesta = enCurso(await iniciar({ volverATomar: true }));
    const fila = base.enCurso.get(SESION.idUsuario) as Fila;
    expect(fila.repetido).toBe(false);
    expect(fila.vistas_antes).toEqual(TODAS_LAS_CLAVES.slice(0, -1));
    expect(respuesta.maximo).toBe(1);
    expect(respuesta.pregunta.enunciado).toBe(CANDIDATAS[4].enunciado);
  });

  it("solo un true de verdad cuenta como volverATomar", async () => {
    for (const volverATomar of ["true", 1, "si", {}] as unknown as boolean[]) {
      expect(await iniciar({ volverATomar })).toMatchObject({ estado: "sin_preguntas" });
    }
    expect(base.enCurso.size).toBe(0);
  });

  it("si ni sin las vistas el motor tiene una pregunta, volverATomar es no_disponible", async () => {
    // Las candidatas miden una habilidad que no es de la Evaluación: el motor nunca las elige.
    const ajenas = CANDIDATAS.map((c) => ({ ...c, habilidades: ["h9"] }));
    base.activar(EV_A, "Parcial 1", ajenas);
    expect(await iniciar()).toMatchObject({ estado: "sin_preguntas" });
    expect(await iniciar({ volverATomar: true })).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(base.enCurso.size).toBe(0);
  });
});

describe("iniciarDiagnostico: las vistas antes salen de la sesión y la Evaluación pedidas (D-49 a)", () => {
  const ANTIGUO = "d0000000-0000-4000-8000-0000000000a1";
  const RECIENTE = "d0000000-0000-4000-8000-0000000000a2";

  it("pide vistas_de_la_sesion con la sesión de quien llama y la Evaluación que pidió, en ese orden", async () => {
    base.activar(EV_B, "Parcial 2");
    await iniciar({}, OTRA_SESION);
    await iniciar({ idEvaluacion: EV_B });
    expect(base.argumentos.vistas_de_la_sesion).toEqual([
      { p_id_sesion: OTRA_SESION.idUsuario, p_id_evaluacion: EV_A },
      { p_id_sesion: SESION.idUsuario, p_id_evaluacion: EV_B },
    ]);
  });

  it("cuenta lo que la sesión vio en cualquier Evaluación de la materia, sin repetir, y nada de lo que vieron otras", async () => {
    base.activar(EV_B, "Parcial 2");
    base.yaVio(SESION.idUsuario, EV_B, ["CLV-3", "CLV-1"]);
    base.yaVio(SESION.idUsuario, EV_A, ["CLV-1", "CLV-4"]);
    base.yaVio(OTRA_SESION.idUsuario, EV_A, ["CLV-2", "CLV-5"]);

    enCurso(await iniciar());
    expect(base.enCurso.get(SESION.idUsuario)?.vistas_antes).toEqual(["CLV-1", "CLV-3", "CLV-4"]);
    enCurso(await iniciar({}, OTRA_SESION));
    expect(base.enCurso.get(OTRA_SESION.idUsuario)?.vistas_antes).toEqual(["CLV-2", "CLV-5"]);
  });

  it("una Evaluación que la base no tiene no da vistas", async () => {
    base.yaVio(SESION.idUsuario, EV_A, TODAS_LAS_CLAVES, ULTIMO);
    expect(await iniciar({ idEvaluacion: EV_INACTIVA })).toEqual({ estado: "no_disponible", motivo: "evaluacion" });
    expect(base.llamadas).not.toContain("vistas_de_la_sesion");
  });

  it("el último diagnóstico es el de la Evaluación pedida, aunque haya uno más reciente de otra Evaluación de la materia", async () => {
    base.activar(EV_B, "Parcial 2");
    base.yaVio(SESION.idUsuario, EV_A, TODAS_LAS_CLAVES, ANTIGUO);
    base.yaVio(SESION.idUsuario, EV_B, TODAS_LAS_CLAVES, RECIENTE);
    expect(await iniciar()).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: ANTIGUO });
    expect(await iniciar({ idEvaluacion: EV_B })).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: RECIENTE });
  });

  it("sin un diagnóstico de esa Evaluación, el último es el más reciente de la materia", async () => {
    base.activar(EV_B, "Parcial 2");
    base.yaVio(SESION.idUsuario, EV_B, TODAS_LAS_CLAVES, ANTIGUO);
    base.yaVio(SESION.idUsuario, EV_B, TODAS_LAS_CLAVES, RECIENTE);
    expect(await iniciar()).toEqual({ estado: "sin_preguntas", idUltimoDiagnostico: RECIENTE });
  });

  it("un diagnóstico que se termina cuenta en las vistas del siguiente inicio de esa sesión, y de ninguna otra", async () => {
    const { final } = await jugar(laCorrecta);
    const terminado = final as Terminado;
    const respondidas = (base.diagnosticos.at(-1)?.respuestas as { clave: string }[]).map((r) => r.clave).sort();
    expect(respondidas.length).toBeGreaterThan(0);

    // Falta una sola pregunta de las cinco: la que no salió.
    const respuesta = enCurso(await iniciar());
    expect(base.enCurso.get(SESION.idUsuario)?.vistas_antes).toEqual(respondidas);
    expect(respuesta.maximo).toBe(TODAS_LAS_CLAVES.length - respondidas.length);
    // Otra sesión empieza de cero.
    enCurso(await iniciar({}, OTRA_SESION));
    expect(base.enCurso.get(OTRA_SESION.idUsuario)?.vistas_antes).toEqual([]);
    expect(base.diagnosticos.at(-1)?.id).toBe(terminado.idDiagnostico);
  });
});

// ---------------------------------------------------------------------------
// diagnosticoEnCurso
// ---------------------------------------------------------------------------

describe("diagnosticoEnCurso", () => {
  it("sin diagnóstico responde ninguno", async () => {
    expect(await diagnosticoEnCurso(SESION, dependencias())).toEqual({ estado: "ninguno" });
  });

  it("con uno vigente da la misma pregunta que iniciar, con la Evaluación y la materia, sin escribir nada", async () => {
    const primera = enCurso(await iniciar());
    const antes = copia(base.enCurso.get(SESION.idUsuario));
    sinLlamadas();

    const leida = await diagnosticoEnCurso(SESION, dependencias());
    expect(leida).toEqual(primera);
    expect(base.llamadas).toEqual(["diagnostico_en_curso_de"]);
    expect(base.enCurso.get(SESION.idUsuario)).toEqual(antes);
  });

  it("después de responder da la pregunta del paso siguiente", async () => {
    const primera = enCurso(await iniciar());
    const segunda = enCurso(await responder({ idDiagnostico: primera.idDiagnostico, paso: 0, letra: "A" }));
    expect(await diagnosticoEnCurso(SESION, dependencias())).toEqual(segunda);
  });

  it("un diagnóstico vencido es ninguno y no se borra: borrar es de iniciar y de la purga", async () => {
    await iniciar();
    base.ahora = new Date(base.ahora.getTime() + HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO * 3_600_000);
    expect(await diagnosticoEnCurso(SESION, dependencias())).toEqual({ estado: "ninguno" });
    expect(base.enCurso.size).toBe(1);
  });

  it("a 1 h 59 min 59 s sigue vigente", async () => {
    await iniciar();
    base.ahora = new Date(base.ahora.getTime() + HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO * 3_600_000 - 1000);
    expect(await diagnosticoEnCurso(SESION, dependencias())).toMatchObject({ estado: "en_curso" });
  });

  it("una fila de otra versión del formato es ninguno", async () => {
    await iniciar();
    (base.enCurso.get(SESION.idUsuario)?.contexto as { version: number }).version = 99;
    expect(await diagnosticoEnCurso(SESION, dependencias())).toEqual({ estado: "ninguno" });
  });

  it("no muestra el diagnóstico de otra sesión", async () => {
    await iniciar();
    expect(await diagnosticoEnCurso(OTRA_SESION, dependencias())).toEqual({ estado: "ninguno" });
  });

  it.each(["admin", "monitor"] as const)("una cuenta de %s recibe ninguno sin llamadas", async (rol) => {
    await iniciar();
    sinLlamadas();
    expect(await diagnosticoEnCurso({ idUsuario: SESION.idUsuario, rol } as never, dependencias())).toEqual({ estado: "ninguno" });
    expect(base.llamadas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// responderDiagnostico
// ---------------------------------------------------------------------------

describe("responderDiagnostico: aplicar una vez", () => {
  it("aplica la respuesta, guarda la copia del paso y devuelve la siguiente pregunta", async () => {
    const primera = enCurso(await iniciar());
    sinLlamadas();

    const segunda = enCurso(await responder({ idDiagnostico: primera.idDiagnostico, paso: 0, letra: "B" }));
    expect(segunda).toMatchObject({ idDiagnostico: primera.idDiagnostico, paso: 1, maximo: 4 });
    expect(segunda.pregunta.enunciado).not.toBe(primera.pregunta.enunciado);
    // Una lectura, una escritura y nada más: la siguiente pregunta sale de lo que ya se leyó.
    expect(base.llamadas).toEqual(["diagnostico_en_curso_de", "responder_diagnostico"]);

    const fila = base.enCurso.get(SESION.idUsuario) as Fila;
    expect(fila.paso).toBe(1);
    expect(fila.pasos).toHaveLength(1);
    const guardada = fila.pasos[0] as CopiaDePaso;
    // La copia trae la pregunta como estaba, el orden de las opciones y lo que eligió la persona.
    expect(guardada.enunciado).toBe(primera.pregunta.enunciado);
    expect(guardada.opciones).toHaveLength(4);
    expect(guardada.opciones.filter((o) => o.correcta)).toHaveLength(1);
    expect([...guardada.orden].sort()).toEqual(["A", "B", "C", "D"]);
    expect(guardada.letraElegida).toBe("B");
    expect(Number.isNaN(new Date(guardada.fecha).getTime())).toBe(false);
    // La pregunta guardada es la candidata del banco, con la solución si la tiene.
    expect(guardada).toMatchObject({ ...candidataMostrada(primera.pregunta) });
  });

  it("la segunda pregunta es la del motor con lo respondido", async () => {
    const esperado = conElMotor(laPrimeraTrampa);
    const primera = enCurso(await iniciar());
    const segunda = enCurso(await responder({ idDiagnostico: primera.idDiagnostico, paso: 0, letra: laPrimeraTrampa(primera.pregunta, 0) }));
    expect(segunda.pregunta).toEqual(esperado.mostradas[1]);
  });

  it("una respuesta repetida o con un paso viejo no aplica nada y devuelve el estado actual", async () => {
    const primera = enCurso(await iniciar());
    const segunda = enCurso(await responder({ idDiagnostico: primera.idDiagnostico, paso: 0, letra: "A" }));
    const copias = copia(base.enCurso.get(SESION.idUsuario)?.pasos);
    sinLlamadas();

    const repetida = await responder({ idDiagnostico: primera.idDiagnostico, paso: 0, letra: "C" });
    expect(repetida).toEqual(segunda);
    expect(base.enCurso.get(SESION.idUsuario)?.pasos).toEqual(copias);
    expect(base.enCurso.get(SESION.idUsuario)?.paso).toBe(1);
    expect(base.llamadas).not.toContain("responder_diagnostico");
    // Con el id de la pendiente no hace falta buscar un diagnóstico terminado.
    expect(base.llamadas).not.toContain("from:diagnostico");
  });

  it("un paso adelantado no aplica nada y devuelve la pregunta pendiente", async () => {
    const primera = enCurso(await iniciar());
    expect(await responder({ idDiagnostico: primera.idDiagnostico, paso: 3, letra: "A" })).toEqual(primera);
    expect(base.enCurso.get(SESION.idUsuario)?.paso).toBe(0);
  });

  it("dos pestañas que responden el mismo paso: se aplica una y las dos reciben la misma pregunta", async () => {
    const primera = enCurso(await iniciar());
    const segunda = enCurso(await responder({ idDiagnostico: primera.idDiagnostico, paso: 0, letra: laCorrecta(primera.pregunta, 0) }));
    // Una acierta y la otra elige una trampa. En el paso 1 lo que sigue depende de la respuesta (en el 0 la ronda 1 pasa a la otra
    // habilidad pase lo que pase), así que las dos deben ver la pregunta de la que se aplicó.
    const [una, otra] = await Promise.all([
      responder({ idDiagnostico: segunda.idDiagnostico, paso: 1, letra: laCorrecta(segunda.pregunta, 1) }),
      responder({ idDiagnostico: segunda.idDiagnostico, paso: 1, letra: laPrimeraTrampa(segunda.pregunta, 1) }),
    ]);
    const siAcierta = conElMotor(laCorrecta).mostradas[2];
    const siFalla = conElMotor((pregunta, paso) => (paso === 1 ? laPrimeraTrampa(pregunta, paso) : laCorrecta(pregunta, paso))).mostradas[2];
    // La prueba solo vale si las dos respuestas llevan a preguntas distintas.
    expect(siFalla).not.toEqual(siAcierta);

    expect(otra).toEqual(una);
    expect(enCurso(una).paso).toBe(2);
    expect(enCurso(una).pregunta).toEqual(siAcierta);
    const pasos = base.enCurso.get(SESION.idUsuario)?.pasos as CopiaDePaso[];
    expect(pasos).toHaveLength(2);
    expect(pasos[1].letraElegida).toBe(laCorrecta(segunda.pregunta, 1));
    expect(base.argumentos.responder_diagnostico).toHaveLength(3);
  });

  it.each([
    ["una letra en minúscula", { letra: "a" }],
    ["una letra fuera de A a D", { letra: "E" }],
    ["una letra que no es un texto", { letra: 1 }],
    ["sin letra", { letra: undefined }],
    ["un paso con decimales", { paso: 0.5 }],
    ["un paso negativo", { paso: -1 }],
    ["un paso como texto", { paso: "0" }],
    ["un paso que no es un número", { paso: Number.NaN }],
    ["sin paso", { paso: undefined }],
  ])("%s no aplica nada ni lanza: devuelve la pregunta pendiente", async (_caso, cambio) => {
    const primera = enCurso(await iniciar());
    const respuesta = await responder({ idDiagnostico: primera.idDiagnostico, paso: 0, letra: "A", ...cambio });
    expect(respuesta).toEqual(primera);
    expect(base.enCurso.get(SESION.idUsuario)?.paso).toBe(0);
    expect(base.llamadas).not.toContain("responder_diagnostico");
  });

  it("un id que no es un UUID no aplica nada ni lanza: devuelve el diagnóstico de ahora", async () => {
    const primera = enCurso(await iniciar());
    for (const idDiagnostico of [undefined, null, "", "abc", 3, {}, `${primera.idDiagnostico}x`]) {
      expect(await responder({ idDiagnostico, paso: 0, letra: "A" })).toEqual(primera);
    }
    expect(base.enCurso.get(SESION.idUsuario)?.paso).toBe(0);
    // Con un id inválido tampoco se busca ningún diagnóstico terminado.
    expect(base.llamadas).not.toContain("from:diagnostico");
  });

  it("acepta el id del diagnóstico en mayúsculas", async () => {
    const primera = enCurso(await iniciar());
    const respuesta = enCurso(await responder({ idDiagnostico: primera.idDiagnostico.toUpperCase(), paso: 0, letra: "A" }));
    expect(respuesta.paso).toBe(1);
    expect(respuesta.idDiagnostico).toBe(primera.idDiagnostico);
  });
});

describe("responderDiagnostico: el estado actual cuando no se aplica", () => {
  it("(c) una pestaña vieja, después de que otra empezó otra Evaluación, no se califica contra la pregunta nueva", async () => {
    base.activar(EV_B, "Parcial 2");
    const vieja = enCurso(await iniciar());
    const nueva = enCurso(await iniciar({ idEvaluacion: EV_B }));
    expect(nueva.paso).toBe(0);

    // Mismo paso (0), otro id: no aplica nada y la pestaña vieja ve el diagnóstico de ahora.
    const respuesta = enCurso(await responder({ idDiagnostico: vieja.idDiagnostico, paso: 0, letra: "A" }));
    expect(respuesta).toEqual(nueva);
    expect(respuesta.idDiagnostico).not.toBe(vieja.idDiagnostico);
    expect(base.enCurso.get(SESION.idUsuario)?.pasos).toEqual([]);
    expect(base.llamadas).not.toContain("responder_diagnostico");
  });

  it("(c) un id válido que no existe devuelve el diagnóstico de ahora", async () => {
    const primera = enCurso(await iniciar());
    expect(await responder({ idDiagnostico: "d0000000-0000-4000-8000-00000000dead", paso: 0, letra: "A" })).toEqual(primera);
  });

  it("(d) sin diagnóstico en curso ni terminado, ninguno", async () => {
    expect(await responder({ idDiagnostico: "d0000000-0000-4000-8000-00000000dead", paso: 0, letra: "A" })).toEqual({ estado: "ninguno" });
  });

  it("(d) un diagnóstico vencido no aplica la respuesta: ninguno", async () => {
    const primera = enCurso(await iniciar());
    base.ahora = new Date(base.ahora.getTime() + HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO * 3_600_000);
    expect(await responder({ idDiagnostico: primera.idDiagnostico, paso: 0, letra: "A" })).toEqual({ estado: "ninguno" });
    expect(base.enCurso.get(SESION.idUsuario)?.paso).toBe(0);
  });

  it("(d) el id de otra sesión no aplica nada y no revela nada: ninguno", async () => {
    const mia = enCurso(await iniciar());
    const respuesta = await responder({ idDiagnostico: mia.idDiagnostico, paso: 0, letra: "A" }, OTRA_SESION);
    expect(respuesta).toEqual({ estado: "ninguno" });
    expect(base.enCurso.get(SESION.idUsuario)?.paso).toBe(0);
  });

  it("una fila de otra versión del formato se trata como inexistente: ninguno, sin aplicar", async () => {
    const primera = enCurso(await iniciar());
    (base.enCurso.get(SESION.idUsuario)?.contexto as { version: number }).version = 99;
    expect(await responder({ idDiagnostico: primera.idDiagnostico, paso: 0, letra: "A" })).toEqual({ estado: "ninguno" });
    expect(base.enCurso.get(SESION.idUsuario)?.paso).toBe(0);
  });

  it.each(["admin", "monitor"] as const)("una cuenta de %s recibe ninguno sin ninguna llamada", async (rol) => {
    const primera = enCurso(await iniciar());
    sinLlamadas();
    const respuesta = await responderDiagnostico(
      { idUsuario: SESION.idUsuario, rol } as never,
      { idDiagnostico: primera.idDiagnostico, paso: 0, letra: "A" },
      dependencias(),
    );
    expect(respuesta).toEqual({ estado: "ninguno" });
    expect(base.llamadas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Un diagnóstico completo
// ---------------------------------------------------------------------------

describe("responderDiagnostico: terminar", () => {
  it("el último paso inserta el diagnóstico completo, borra el en curso y responde terminado con el mismo id", async () => {
    const { recibido, final } = await jugar(laPrimeraTrampa);
    const terminado = final as Terminado;
    expect(terminado.estado).toBe("terminado");
    const id = (recibido[0] as EnCurso).idDiagnostico;
    expect(terminado.idDiagnostico).toBe(id);

    expect(base.enCurso.size).toBe(0);
    expect(base.diagnosticos).toHaveLength(1);
    const guardado = base.diagnosticos[0];
    const esperado = conElMotor(laPrimeraTrampa);
    expect(guardado).toMatchObject({ id, id_sesion_anonima: SESION.idUsuario, id_evaluacion: EV_A, semilla: SEMILLA, repetido: false });
    expect(guardado.respondidas).toBe(esperado.pasos.length);
    expect((guardado.respuestas as CopiaDePaso[]).map((c) => c.clave)).toEqual(esperado.pasos.map((p) => p.clave));
    expect((guardado.respuestas as CopiaDePaso[]).map((c) => c.letraElegida)).toEqual(esperado.pasos.map((p) => p.letraElegida));
    expect(guardado.puntaje).toBe(esperado.resultado.puntaje);
    expect(guardado.aciertos).toBe(0);
  });

  it("paridad con el motor: el servidor muestra las mismas preguntas, en el mismo orden de opciones, que el motor puro", async () => {
    for (let semilla = 1; semilla <= 12; semilla++) {
      base = new BaseFalsa();
      base.activar(EV_A);
      // Una letra que no depende de cuál es la correcta: el motor decide qué pasa con lo que se elija.
      const eleccion: Eleccion = (_pregunta, paso) => LETRAS[(semilla + paso) % 4];
      const { recibido, final } = await jugar(eleccion, SESION, semilla);
      const esperado = conElMotor(eleccion, semilla);
      const mostradas = recibido.filter((r) => (r as EnCurso).estado === "en_curso").map((r) => (r as EnCurso).pregunta);
      expect(mostradas).toEqual(esperado.mostradas);
      expect((final as Terminado).estado).toBe("terminado");
      const guardado = base.diagnosticos[0];
      expect(guardado.puntaje).toBe(esperado.resultado.puntaje);
      const habilidades = (guardado.resultado_por_habilidad as { habilidades: { habilidad: string; nivel: string; respuestas: number; aciertos: number }[] }).habilidades;
      expect(habilidades.map((h) => [h.habilidad, h.nivel, h.respuestas, h.aciertos])).toEqual(
        esperado.resultado.habilidades.map((h) => [h.habilidad, h.nivel, h.respuestas, h.aciertos]),
      );
    }
  });

  it("guarda el resultado completo con nombres legibles y sin la marca de falta de material, que va aparte", async () => {
    // Las preguntas de h2 ya se vieron: h2 queda sin medir y marcada sin_preguntas_sin_ver.
    base.yaVio(SESION.idUsuario, EV_A, ["CLV-4", "CLV-5"], ULTIMO);
    const { final } = await jugar(laPrimeraTrampa);
    expect((final as Terminado).estado).toBe("terminado");

    const argumentos = base.argumentos.terminar_diagnostico[0] as {
      p_resultado: { habilidades: { habilidad: string; nivel: string }[]; errores: { descripcionHabilidad: string; texto: string; detalles: string[] }[]; prerrequisitos: unknown[] };
      p_falta_material: unknown;
      p_aciertos: number;
      p_puntaje: number;
    };
    expect(argumentos.p_falta_material).toEqual([{ habilidad: "h2", motivos: ["sin_preguntas_sin_ver"] }]);
    const texto = JSON.stringify(argumentos.p_resultado);
    expect(texto).not.toContain("faltaMaterial");
    expect(texto).not.toContain("sin_preguntas_sin_ver");
    expect(argumentos.p_resultado.habilidades.map((h) => [h.habilidad, h.nivel])).toEqual([
      ["h1", "no_lo_domina"],
      ["h2", "sin_medir"],
    ]);
    // Cada error trae el título, la descripción de su habilidad y el texto de error de la opción elegida (D-49 d).
    expect(argumentos.p_resultado.errores.length).toBeGreaterThan(0);
    for (const error of argumentos.p_resultado.errores) {
      expect(error.descripcionHabilidad).toBe("Primera habilidad");
      expect(error.texto).toMatch(/^Error h1\./);
    }
    expect(argumentos.p_resultado.errores.flatMap((e) => e.detalles)).toContain(ERROR_SECRETO);
    // Los directos de la habilidad débil, con el nombre de la otra materia.
    expect(argumentos.p_resultado.prerrequisitos).toEqual([{ materia: "Otra materia", habilidad: "base", descripcion: "Una base" }]);
    expect(argumentos.p_aciertos).toBe(0);
    expect(base.diagnosticos.at(-1)?.falta_material).toEqual(argumentos.p_falta_material);
  });

  it("terminar_diagnostico recibe el paso que se mostró, la última copia, los aciertos y el puntaje del motor", async () => {
    const { recibido } = await jugar(laCorrecta);
    const argumentos = base.argumentos.terminar_diagnostico[0] as { p_id: string; p_paso: number; p_copia: CopiaDePaso; p_aciertos: number; p_puntaje: number };
    const esperado = conElMotor(laCorrecta);
    const preguntas = recibido.filter((r) => (r as EnCurso).estado === "en_curso") as EnCurso[];
    expect(argumentos.p_id).toBe(preguntas[0].idDiagnostico);
    expect(argumentos.p_paso).toBe(esperado.pasos.length - 1);
    expect(argumentos.p_copia.clave).toBe(esperado.pasos[esperado.pasos.length - 1].clave);
    expect(argumentos.p_aciertos).toBe(esperado.pasos.length);
    expect(argumentos.p_puntaje).toBe(100);
  });

  it("los aciertos que guarda cuentan una pregunta de varias habilidades una vez", async () => {
    const multiples = [
      { ...candidata("CLV-M1", "Enunciado múltiple uno", 2, "h1"), habilidades: ["h1", "h2"] },
      { ...candidata("CLV-M2", "Enunciado múltiple dos", 3, "h1"), habilidades: ["h1", "h2"] },
    ];
    base.activar(EV_A, "Parcial 1", multiples);
    let actual = enCurso(await iniciar());
    let ultimo: unknown;
    for (let vueltas = 0; actual.estado === "en_curso"; vueltas++) {
      expect(vueltas).toBeLessThan(5);
      const candidataVista = multiples.find((c) => c.enunciado === actual.pregunta.enunciado) as PreguntaCandidata;
      const texto = candidataVista.opciones[0].texto;
      ultimo = await responder({ idDiagnostico: actual.idDiagnostico, paso: actual.paso, letra: LETRAS[actual.pregunta.opciones.findIndex((o) => o.texto === texto)] });
      if ((ultimo as { estado: string }).estado !== "en_curso") break;
      actual = ultimo as EnCurso;
    }
    expect((ultimo as { estado: string }).estado).toBe("terminado");
    const guardado = base.argumentos.terminar_diagnostico[0] as { p_aciertos: number; p_resultado: { habilidades: { aciertos: number }[] } };
    // Dos preguntas acertadas: cada habilidad suma 2, pero las preguntas acertadas son 2 y no 4.
    expect(guardado.p_resultado.habilidades.map((h) => h.aciertos)).toEqual([2, 2]);
    expect(guardado.p_aciertos).toBe(2);
    expect(base.diagnosticos[0].puntaje).toBe(100);
  });

  it("doble clic en la última respuesta: una sola fila y las dos pestañas reciben terminado con el mismo id", async () => {
    const ultimo = await hastaElUltimoPaso(enCurso(await iniciar()));
    const pedido = { idDiagnostico: ultimo.idDiagnostico, paso: ultimo.paso, letra: laCorrecta(ultimo.pregunta, ultimo.paso) };
    const [una, otra] = await Promise.all([responder(pedido), responder(pedido)]);
    expect(una).toEqual({ estado: "terminado", idDiagnostico: ultimo.idDiagnostico });
    expect(otra).toEqual(una);
    expect(base.diagnosticos).toHaveLength(1);
    expect(base.enCurso.size).toBe(0);
    expect(base.argumentos.terminar_diagnostico).toHaveLength(2);
    // Una respuesta atrasada después de terminar sigue diciendo terminado, sin crear otro diagnóstico.
    expect(await responder(pedido)).toEqual(una);
    expect(base.diagnosticos).toHaveLength(1);
  });

  it("(b) una respuesta con el id de un diagnóstico terminado de la sesión devuelve terminado, y de otra sesión no", async () => {
    const { recibido } = await jugar(laCorrecta);
    const id = (recibido[0] as EnCurso).idDiagnostico;
    expect(await responder({ idDiagnostico: id, paso: 0, letra: "A" })).toEqual({ estado: "terminado", idDiagnostico: id });
    expect(await responder({ idDiagnostico: id, paso: 0, letra: "A" }, OTRA_SESION)).toEqual({ estado: "ninguno" });
    expect(base.diagnosticos).toHaveLength(1);
  });

  it("(b) antes que (c): la pestaña que llega tarde ve terminado aunque la persona ya haya empezado otro diagnóstico", async () => {
    const { recibido } = await jugar(laCorrecta);
    const terminado = (recibido[0] as EnCurso).idDiagnostico;
    base.activar(EV_B, "Parcial 2");
    const nuevo = enCurso(await iniciar({ idEvaluacion: EV_B }));
    expect(nuevo.idDiagnostico).not.toBe(terminado);
    expect(await responder({ idDiagnostico: terminado, paso: 3, letra: "A" })).toEqual({ estado: "terminado", idDiagnostico: terminado });
    expect(base.enCurso.get(SESION.idUsuario)?.id).toBe(nuevo.idDiagnostico);
  });

  it("(a) gana sobre (b) y (c): con el id pedido en curso, es su pregunta aunque haya un terminado con otro id", async () => {
    await jugar(laCorrecta);
    base.activar(EV_B, "Parcial 2");
    const nueva = enCurso(await iniciar({ idEvaluacion: EV_B }));
    expect(await responder({ idDiagnostico: nueva.idDiagnostico, paso: 9, letra: "A" })).toEqual(nueva);
  });

  it("la última respuesta de una pestaña vieja no termina nada si otra empezó otra Evaluación: ve la de ahora", async () => {
    base.activar(EV_B, "Parcial 2");
    const ultimo = await hastaElUltimoPaso(enCurso(await iniciar()));
    // Otra pestaña empieza la Evaluación B justo después de que esta leyó su diagnóstico.
    base.despues.set("diagnostico_en_curso_de", () => {
      base.sembrar(SESION.idUsuario, EV_B, 5);
    });
    const respuesta = enCurso(await responder({ idDiagnostico: ultimo.idDiagnostico, paso: ultimo.paso, letra: laCorrecta(ultimo.pregunta, ultimo.paso) }));
    expect(base.argumentos.terminar_diagnostico).toHaveLength(1);
    expect(base.diagnosticos).toHaveLength(0);
    expect(respuesta.evaluacion.id).toBe(EV_B);
    expect(respuesta.idDiagnostico).not.toBe(ultimo.idDiagnostico);
    expect(respuesta.paso).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lo que recibe el navegador
// ---------------------------------------------------------------------------

describe("lo que recibe el navegador", () => {
  const SECRETOS = [
    String(SEMILLA),
    SOLUCION_SECRETA,
    ERROR_SECRETO,
    "CLV-",
    "h1.a",
    "h1.b",
    "h1.c",
    "h2.a",
    "h2.b",
    "h2.c",
    "token_recuperacion",
    "faltaMaterial",
    "sin_preguntas_sin_ver",
  ];

  it("en todo un diagnóstico, cada respuesta solo trae claves permitidas y nada de lo secreto", async () => {
    for (const eleccion of [laPrimeraTrampa, laCorrecta]) {
      base = new BaseFalsa();
      base.yaVio(SESION.idUsuario, EV_A, ["CLV-4"], ULTIMO);
      base.activar(EV_A);
      const { recibido } = await jugar(eleccion);
      expect(recibido.length).toBeGreaterThan(2);
      for (const respuesta of recibido) {
        expect(clavesNoPermitidas(respuesta)).toEqual([]);
        const texto = JSON.stringify(respuesta);
        for (const secreto of SECRETOS) expect(texto).not.toContain(secreto);
      }
    }
  });

  it("también lo que reciben las demás rutas: sin_preguntas, ninguno, no_disponible y terminado", async () => {
    const respuestas: unknown[] = [];
    respuestas.push(await iniciar({ idEvaluacion: EV_INACTIVA }));
    respuestas.push(await diagnosticoEnCurso(SESION, dependencias()));
    respuestas.push(await iniciar({}, { idUsuario: SESION.idUsuario, rol: "admin" } as never));
    base.yaVio(SESION.idUsuario, EV_A, TODAS_LAS_CLAVES, ULTIMO);
    respuestas.push(await iniciar());
    const { final } = await jugar(laCorrecta, OTRA_SESION);
    respuestas.push(final);
    for (const respuesta of respuestas) {
      expect(clavesNoPermitidas(respuesta)).toEqual([]);
      const texto = JSON.stringify(respuesta);
      for (const secreto of SECRETOS) expect(texto).not.toContain(secreto);
    }
  });

  it("la semilla no sale en ninguna respuesta aunque se vea la pregunta: ni el id del diagnóstico se deriva de ella", async () => {
    const respuesta = enCurso(await iniciar());
    expect(respuesta.idDiagnostico).not.toContain(String(SEMILLA));
    expect(Object.keys(respuesta).sort()).toEqual(["estado", "evaluacion", "idDiagnostico", "materia", "maximo", "paso", "pregunta"]);
    expect(Object.keys(respuesta.pregunta).sort()).toEqual(["enunciado", "opciones"]);
    for (const opcion of respuesta.pregunta.opciones) expect(Object.keys(opcion).sort()).toEqual(["letra", "texto"]);
  });
});

// ---------------------------------------------------------------------------
// Errores de la base y del motor
// ---------------------------------------------------------------------------

describe("errores de la base y del motor", () => {
  // Un check o una llave que falla en diagnostico_en_curso o diagnostico trae en `details` la fila completa.
  const FALLA: ErrorDePostgrest = {
    code: "23514",
    message: `new row for relation "diagnostico" violates check constraint con ${SOLUCION_SECRETA}`,
    details: `Failing row contains (${SEMILLA}, ${SOLUCION_SECRETA}, ${ERROR_SECRETO}, ${"t".repeat(64)})`,
    hint: SOLUCION_SECRETA,
  };

  const filtraciones = [SOLUCION_SECRETA, ERROR_SECRETO, String(SEMILLA), "t".repeat(64), "Failing row", "violates"];

  function sinFiltraciones(texto: string): void {
    for (const secreto of filtraciones) expect(texto).not.toContain(secreto);
  }

  async function capturar(promesa: Promise<unknown>): Promise<Error> {
    try {
      await promesa;
    } catch (error) {
      return error as Error;
    }
    throw new Error("debía lanzar");
  }

  it.each([
    ["diagnostico_en_curso_de", () => iniciar()],
    ["banco_de_la_evaluacion", () => iniciar()],
    ["vistas_de_la_sesion", () => iniciar()],
    ["iniciar_diagnostico", () => iniciar()],
  ])("un error de %s lanza con el nombre y el código, sin nada de lo que trae la fila", async (funcion, operacion) => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    base.errores.set(funcion, FALLA);
    const error = await capturar(operacion());
    expect(error.message).toContain(funcion);
    expect(error.message).toContain("23514");
    sinFiltraciones(`${error.message} ${error.stack ?? ""} ${String(error.cause ?? "")} ${JSON.stringify(error)}`);
    sinFiltraciones(JSON.stringify(registro.mock.calls));
    expect(Object.keys(error)).toEqual([]);
  });

  it.each(["responder_diagnostico", "terminar_diagnostico", "from:diagnostico", "diagnostico_en_curso_de"])(
    "un error de %s al responder lanza sin lo que trae la fila",
    async (funcion) => {
      const registro = vi.spyOn(console, "error").mockImplementation(() => {});
      const primera = enCurso(await iniciar());
      const pedido = funcion === "terminar_diagnostico" ? await hastaElUltimoPaso(primera) : primera;
      // `from:diagnostico` solo se consulta si el id pedido no es el de la pendiente: se manda el de un diagnóstico que no existe.
      const idDiagnostico = funcion === "from:diagnostico" ? "d0000000-0000-4000-8000-00000000dead" : pedido.idDiagnostico;
      base.errores.set(funcion, FALLA);
      const error = await capturar(responder({ idDiagnostico, paso: pedido.paso, letra: "A" }));
      expect(error.message).toContain("23514");
      sinFiltraciones(`${error.message} ${error.stack ?? ""} ${JSON.stringify(error)}`);
      sinFiltraciones(JSON.stringify(registro.mock.calls));
    },
  );

  it("un error sin código (la red) lanza igual, sin inventar un estado", async () => {
    base.errores.set("diagnostico_en_curso_de", { code: "", message: "TypeError: fetch failed", details: "", hint: "" });
    await expect(diagnosticoEnCurso(SESION, dependencias())).rejects.toThrow("sin código");
  });

  it("un error del motor lanza un mensaje genérico y se registra sin el valor que llegó", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    // Una semilla fuera de rango: el motor la rechaza con RangeError y pone el valor en el mensaje.
    const error = await capturar(iniciar({}, SESION, 1_500_000_000_000));
    expect(error.message).toBe("El motor del diagnóstico rechazó los datos de este diagnóstico.");
    expect(registro).toHaveBeenCalledTimes(1);
    expect(String(registro.mock.calls[0][0])).not.toContain("1500000000000");
    expect(base.enCurso.size).toBe(0);
  });

  it("una fila en curso que no sirve lanza con el id de la fila, sin su contenido", async () => {
    await iniciar();
    const fila = base.enCurso.get(SESION.idUsuario) as Fila;
    (fila.candidatas as { opciones: unknown[] }[])[0].opciones.pop();
    const error = await capturar(diagnosticoEnCurso(SESION, dependencias()));
    expect(error.message).toContain(fila.id);
    expect(error.message).not.toContain("Enunciado");
    expect(error.message).not.toContain(SOLUCION_SECRETA);
  });

  it("un resultado desconocido de la base lanza y no inventa un estado", async () => {
    const original = base.rpc.getMockImplementation() as (n: string, a: Args) => Promise<{ data: unknown; error: ErrorDePostgrest | null }>;
    base.rpc.mockImplementation(async (nombre, args) => {
      if (nombre === "iniciar_diagnostico") return { data: [{ resultado: "algo_nuevo", id: null }], error: null };
      return original(nombre, args);
    });
    await expect(iniciar()).rejects.toThrow("resultado que el servidor no conoce");
  });
});
