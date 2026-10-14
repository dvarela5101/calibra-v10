import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analizarBanco, contar, leerBanco } from "../scripts/contenido/banco.mts";
import { cargarBanco, type ResultadoCarga } from "../scripts/contenido/cargar.mts";
import type { ArchivoBanco, Banco, Conteos } from "../scripts/contenido/modelo.mts";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures, type Cliente } from "./utilidades";

// HU-005 contra el Supabase LOCAL: el cargador (scripts/contenido/cargar.mts) deja en la base el banco de
// ejemplo (pruebas/banco-ejemplo, materias ZZPR-0001 y ZZPR-0002) con los conteos del --dry-run, sin duplicar
// nada al repetirse, y las tablas del banco quedan fuera del alcance de anon y authenticated.
//
// Lo que importa del ejemplo (detalle en pruebas/contenido.test.ts): en materia-a, P1-P5 y P8 están revisadas,
// P6 retirada, y P7 y P9 son borradores; materia-b tiene solo P1, revisada. Solo parcial-1 cumple la cobertura;
// parcial-2 es acumulativa y hereda el tema de parcial-1.
//
// Cada prueba parte sin las materias ZZPR: se borran antes de cada una y al final.
//
// HU-055 (D-62 a): la carga reconoce la materia por su carpeta y conserva lo que un admin corrigió en la app (nombre y código de
// la materia, nombre y semana de la evaluación). Al final del archivo, las pruebas de esa regla: el admin corrige por la Data API
// con una sesión real, y la carga se mide con las marcas puestas, con la adopción de una materia creada en la app, con un código
// que otra materia ya tiene y con un admin que guarda mientras la carga lee.

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const EJEMPLO = join(__dirname, "..", "pruebas", "banco-ejemplo");
const SOLO_REVISADAS = { borradores: false };
const CON_BORRADORES = { borradores: true };

let bd: pg.Client;

/**
 * Las materias del ejemplo: por su código (`ZZPR-`) y también por su carpeta, porque un admin pudo cambiar el código (y entonces ya
 * no empieza por `ZZPR-`) y la carga reconoce la materia por la carpeta. El código se compara sin mayúsculas ni espacios: una
 * fila de confianza puede traerlos.
 */
const DEL_EJEMPLO =
  "select id from public.materia where lower(btrim(codigo)) like 'zzpr-%' or carpeta in ('materia-a', 'materia-b')";

/** Las evaluaciones primero: su llave a materia no cae en cascada. La materia se lleva el resto del banco. */
async function borrarEjemplo() {
  await bd.query(`delete from public.evaluacion where id_materia in (${DEL_EJEMPLO})`);
  await bd.query(`delete from public.materia where id in (${DEL_EJEMPLO})`);
}

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
});

afterAll(async () => {
  if (!bd) return;
  try {
    await borrarEjemplo();
  } finally {
    await bd.end();
  }
});

beforeEach(async () => {
  await borrarEjemplo();
});

// ---------------------------------------------------------------------------
// El banco de ejemplo, tal cual o con cambios en memoria (los archivos no se tocan)
// ---------------------------------------------------------------------------
function ejemplo(): Banco {
  const resultado = leerBanco(EJEMPLO);
  expect(resultado.errores).toEqual([]);
  return resultado.banco;
}

function archivosDelEjemplo(): ArchivoBanco[] {
  const archivos: ArchivoBanco[] = [];
  const recorrer = (carpeta: string) => {
    for (const nombre of readdirSync(carpeta)) {
      const ruta = join(carpeta, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else archivos.push({ ruta: relative(EJEMPLO, ruta).replaceAll("\\", "/"), texto: readFileSync(ruta, "utf8") });
    }
  };
  recorrer(EJEMPLO);
  return archivos;
}

/** El ejemplo con un cambio en el texto de materia-a/derivadas.md. Falla si el banco cambiado no es válido. */
function ejemploConDerivadas(cambiar: (texto: string) => string): Banco {
  const archivos = archivosDelEjemplo().map((a) => (a.ruta === "materia-a/derivadas.md" ? { ...a, texto: cambiar(a.texto) } : a));
  const resultado = analizarBanco(archivos);
  expect(resultado.errores).toEqual([]);
  return resultado.banco;
}

function reemplazar(texto: string, de: string, a: string): string {
  if (!texto.includes(de)) throw new Error(`no encontré "${de}" en el ejemplo`);
  return texto.replace(de, a);
}

// ---------------------------------------------------------------------------
// Lo que hay en la base, leído sin pasar por el cargador
// ---------------------------------------------------------------------------
/** Todas las filas del ejemplo en cada tabla, sin filtrar por estado. */
async function filasDelEjemplo(): Promise<Conteos> {
  const { rows } = await bd.query<Conteos>(`
    with m as (select id from public.materia where codigo like 'ZZPR-%')
    select
      (select count(*) from m)::int as materias,
      (select count(*) from public.tema where id_materia in (select id from m))::int as temas,
      (select count(*) from public.habilidad where id_materia in (select id from m))::int as habilidades,
      (select count(*) from public.habilidad_prerrequisito
        where id_habilidad in (select id from public.habilidad where id_materia in (select id from m)))::int as prerrequisitos,
      (select count(*) from public.misconcepcion where id_materia in (select id from m))::int as misconcepciones,
      (select count(*) from public.pregunta where id_materia in (select id from m))::int as preguntas,
      (select count(*) from public.opcion where id_materia in (select id from m))::int as opciones,
      (select count(*) from public.pregunta_habilidad where id_materia in (select id from m))::int as "preguntaHabilidad",
      (select count(*) from public.evaluacion where id_materia in (select id from m))::int as evaluaciones,
      (select count(*) from public.evaluacion_tema where id_materia in (select id from m))::int as "evaluacionTema"`);
  return rows[0];
}

type FilaPregunta = { id: string; estado: string; revisor: string | null; enunciado: string };

/** Las preguntas del ejemplo en la base, por "codigo/clave" ("ZZPR-0001/P1"). */
async function preguntasEnBase(): Promise<Map<string, FilaPregunta>> {
  const { rows } = await bd.query<FilaPregunta & { clave: string }>(`
    select m.codigo || '/' || p.clave as clave, p.id, p.estado::text as estado, p.revisor, p.enunciado
      from public.pregunta p join public.materia m on m.id = p.id_materia
     where m.codigo like 'ZZPR-%'
     order by 1`);
  return new Map(rows.map(({ clave, ...fila }) => [clave, fila]));
}

type FilaOpcion = { id: string; correcta: boolean; misconcepcion: string | null; error: string | null };

/** Las opciones del ejemplo en la base, por "codigo/clave/letra" ("ZZPR-0001/P1/A"). */
async function opcionesEnBase(): Promise<Map<string, FilaOpcion>> {
  const { rows } = await bd.query<FilaOpcion & { clave: string }>(`
    select m.codigo || '/' || p.clave || '/' || o.letra as clave, o.id, o.correcta, mc.clave as misconcepcion, o.error
      from public.opcion o
      join public.pregunta p on p.id = o.id_pregunta
      join public.materia m on m.id = p.id_materia
      left join public.misconcepcion mc on mc.id = o.id_misconcepcion
     where m.codigo like 'ZZPR-%'
     order by 1`);
  return new Map(rows.map(({ clave, ...fila }) => [clave, fila]));
}

const idsDe = (filas: Map<string, { id: string }>, prefijo: string) =>
  [...filas].filter(([clave]) => clave.startsWith(prefijo)).map(([clave, { id }]) => `${clave}=${id}`);

// ---------------------------------------------------------------------------
describe("criterio 5: la carga deja los conteos del --dry-run y no duplica nada", () => {
  it("sin --borradores deja los conteos del dry-run y solo las preguntas revisadas", async () => {
    const banco = ejemplo();
    const { conteos, avisos } = await cargarBanco(bd, banco, SOLO_REVISADAS);

    expect(conteos).toEqual(contar(banco, SOLO_REVISADAS));
    // Contadas aparte, todas las filas: los borradores (P7, P9) y la retirada (P6) ni siquiera existen.
    expect(await filasDelEjemplo()).toEqual(contar(banco, SOLO_REVISADAS));
    expect(conteos).toMatchObject({ materias: 2, preguntas: 7, opciones: 28, prerrequisitos: 3, evaluacionTema: 4 });
    const preguntas = await preguntasEnBase();
    expect([...preguntas.keys()]).toEqual([
      "ZZPR-0001/P1",
      "ZZPR-0001/P2",
      "ZZPR-0001/P3",
      "ZZPR-0001/P4",
      "ZZPR-0001/P5",
      "ZZPR-0001/P8",
      "ZZPR-0002/P1",
    ]);
    expect(new Set([...preguntas.values()].map((p) => p.estado))).toEqual(new Set(["revisada"]));
    expect(avisos).toEqual([]);
  });

  it("guarda la opción correcta, la misconcepción de cada incorrecta y su texto de error propio", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const opciones = await opcionesEnBase();
    expect(opciones.get("ZZPR-0001/P1/A")).toMatchObject({ correcta: true, misconcepcion: null, error: null });
    expect(opciones.get("ZZPR-0001/P1/B")).toMatchObject({ correcta: false, misconcepcion: "no-resta-uno", error: null });
    expect(opciones.get("ZZPR-0001/P1/C")).toMatchObject({ correcta: false, misconcepcion: "suma-uno", error: "integras en vez de derivar" });
  });

  it("si algo falla a mitad de la carga, la base queda como estaba (una sola transacción)", async () => {
    const banco = ejemplo();
    // Un banco que no pasó por el validador: la última opción usa una misconcepción que no existe, así que
    // la carga falla después de escribir materias, temas, habilidades y casi todas las preguntas.
    const ultima = banco.materias[1].temas[0].preguntas[0].opciones[3];
    ultima.misconcepcion = "no-existe";

    await expect(cargarBanco(bd, banco, SOLO_REVISADAS)).rejects.toThrow('la misconcepción "no-existe" no está en el banco cargado');
    expect(await filasDelEjemplo()).toMatchObject({ materias: 0, temas: 0, preguntas: 0, opciones: 0, evaluaciones: 0 });
  });

  it("correrla dos veces no duplica nada y conserva los ids de preguntas y opciones", async () => {
    const banco = ejemplo();
    const primera = await cargarBanco(bd, banco, SOLO_REVISADAS);
    const filas = await filasDelEjemplo();
    const preguntas = await preguntasEnBase();
    const opciones = await opcionesEnBase();

    const segunda = await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);

    expect(segunda.conteos).toEqual(primera.conteos);
    expect(await filasDelEjemplo()).toEqual(filas);
    expect(await preguntasEnBase()).toEqual(preguntas);
    expect(await opcionesEnBase()).toEqual(opciones);
  });

  it("con --borradores entran los borradores; sin la opción vuelven a su estado del markdown y las revisadas no cambian", async () => {
    const banco = ejemplo();
    await cargarBanco(bd, banco, SOLO_REVISADAS);
    const revisadas = idsDe(await preguntasEnBase(), "ZZPR-");

    const con = await cargarBanco(bd, banco, CON_BORRADORES);
    expect(con.conteos).toEqual(contar(banco, CON_BORRADORES));
    expect(await filasDelEjemplo()).toEqual(contar(banco, CON_BORRADORES));
    let preguntas = await preguntasEnBase();
    expect(preguntas.get("ZZPR-0001/P7")?.estado).toBe("borrador");
    expect(preguntas.get("ZZPR-0001/P9")?.estado).toBe("borrador");
    expect(preguntas.has("ZZPR-0001/P6")).toBe(false); // retirada en el markdown: nunca se carga

    // Alguien la marca revisada y la edita en la base. Sin --borradores, la carga solo le devuelve el estado
    // del markdown: su contenido se actualiza cuando vuelva a cargarse.
    await bd.query(
      "update public.pregunta set estado = 'revisada', revisor = 'Alguien', enunciado = 'Editada en la base' where id = $1",
      [preguntas.get("ZZPR-0001/P9")?.id],
    );
    const sin = await cargarBanco(bd, banco, SOLO_REVISADAS);

    expect(sin.conteos).toEqual(contar(banco, SOLO_REVISADAS));
    preguntas = await preguntasEnBase();
    expect(preguntas.get("ZZPR-0001/P9")).toMatchObject({ estado: "borrador", enunciado: "Editada en la base" });
    expect(preguntas.get("ZZPR-0001/P7")?.estado).toBe("borrador");
    // Los borradores siguen en la base (no se borra nada); las revisadas son las mismas, con los mismos ids.
    expect((await filasDelEjemplo()).preguntas).toBe(9);
    expect(idsDe(new Map([...preguntas].filter(([, p]) => p.estado === "revisada")), "ZZPR-")).toEqual(revisadas);
  });
});

describe("criterio 6: evaluaciones con sus temas; solo la que cumple la cobertura queda activa", () => {
  it("parcial-1 queda activa, las demás no, y la acumulativa incluye los temas de la anterior", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const { rows } = await bd.query(`
      select m.codigo || '/' || e.clave as clave, e.nombre, e.semana, e.acumulativo, e.activa,
             array(select t.clave from public.evaluacion_tema et join public.tema t on t.id = et.id_tema
                    where et.id_evaluacion = e.id order by t.orden) as temas
        from public.evaluacion e join public.materia m on m.id = e.id_materia
       where m.codigo like 'ZZPR-%'
       order by 1`);
    expect(rows).toEqual([
      { clave: "ZZPR-0001/parcial-1", nombre: "Parcial 1", semana: 6, acumulativo: false, activa: true, temas: ["derivadas"] },
      { clave: "ZZPR-0001/parcial-2", nombre: "Parcial 2", semana: 12, acumulativo: true, activa: false, temas: ["derivadas", "integrales"] },
      { clave: "ZZPR-0002/examen-final", nombre: "Examen final", semana: 16, acumulativo: false, activa: false, temas: ["diferencias"] },
    ]);
  });

  it("una evaluación de la materia que no está en el banco queda inactiva, con aviso", async () => {
    const banco = ejemplo();
    await cargarBanco(bd, banco, SOLO_REVISADAS);
    const { rows } = await bd.query<{ id: string }>(
      `insert into public.evaluacion (id_materia, semana, nombre, activa)
       select id, 3, 'Quiz suelto', true from public.materia where codigo = 'ZZPR-0001'
       returning id`,
    );

    const { conteos, avisos } = await cargarBanco(bd, banco, SOLO_REVISADAS);

    const { rows: [quiz] } = await bd.query("select activa from public.evaluacion where id = $1", [rows[0].id]);
    expect(quiz.activa).toBe(false);
    expect(avisos).toEqual(['materia-a: la evaluación "Quiz suelto" (sin clave) está en la base pero no en el banco; queda inactiva']);
    // Sin clave no es del banco: no cuenta, así que la carga sigue cuadrando con el dry-run.
    expect(conteos).toEqual(contar(banco, SOLO_REVISADAS));
  });
});

describe("el markdown manda: lo que sale del banco no se borra", () => {
  it("una pregunta que desaparece del banco queda retirada, con su id y sus opciones", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const antes = await preguntasEnBase();
    const opcionesAntes = idsDe(await opcionesEnBase(), "ZZPR-0001/P2/");

    // Sin el bloque de P2 (hasta el encabezado de P3).
    const sinP2 = ejemploConDerivadas((texto) => texto.slice(0, texto.indexOf("### P2 ")) + texto.slice(texto.indexOf("### P3 ")));
    expect(sinP2.materias[0].temas[0].preguntas.map((p) => p.clave)).not.toContain("P2");
    const { conteos, avisos } = await cargarBanco(bd, sinP2, SOLO_REVISADAS);

    const despues = await preguntasEnBase();
    expect(despues.get("ZZPR-0001/P2")).toMatchObject({ id: antes.get("ZZPR-0001/P2")?.id, estado: "retirada" });
    expect(idsDe(await opcionesEnBase(), "ZZPR-0001/P2/")).toEqual(opcionesAntes);
    expect(avisos).toEqual(['materia-a: la pregunta "P2" está en la base pero no en el banco; queda retirada (no reutilices su clave)']);
    expect(conteos).toEqual(contar(sinP2, SOLO_REVISADAS));
    expect(conteos.preguntas).toBe(6);
  });

  it("si cambian las opciones de una pregunta se reemplazan (aun cambiando la correcta) y las demás conservan sus ids", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const antes = await opcionesEnBase();

    // La correcta pasa de A a B: actualizarlas una por una dejaría, por un momento, dos correctas.
    const cambiado = ejemploConDerivadas((texto) =>
      reemplazar(reemplazar(texto, "- A) $3x^{2}$ · CORRECTA", "- A) $3x^{2}$ · [no-resta-uno] te quedas con el exponente de la respuesta"), "- B) $3x^{3}$ · [no-resta-uno]", "- B) $3x^{3}$ · CORRECTA"),
    );
    const { conteos } = await cargarBanco(bd, cambiado, SOLO_REVISADAS);

    const despues = await opcionesEnBase();
    expect(despues.get("ZZPR-0001/P1/A")).toMatchObject({ correcta: false, misconcepcion: "no-resta-uno", error: "te quedas con el exponente de la respuesta" });
    expect(despues.get("ZZPR-0001/P1/B")).toMatchObject({ correcta: true, misconcepcion: null, error: null });
    for (const letra of ["A", "B", "C", "D"]) expect(despues.get(`ZZPR-0001/P1/${letra}`)?.id).not.toBe(antes.get(`ZZPR-0001/P1/${letra}`)?.id);
    expect(idsDe(despues, "ZZPR-0001/P2/")).toEqual(idsDe(antes, "ZZPR-0001/P2/"));
    expect(conteos).toEqual(contar(cambiado, SOLO_REVISADAS));
  });
});

describe("criterio 7: anon y authenticated no leen el banco por la Data API", () => {
  it("no leen opcion, pregunta ni misconcepcion, pero sí materia y evaluacion (con activa)", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const { rows: [materia] } = await bd.query<{ id: string }>("select id from public.materia where codigo = 'ZZPR-0001'");
    const fx = new Fixtures();
    try {
      const actores: [string, Cliente][] = [
        ["anon", crearCliente()],
        ["authenticated (sesión anónima)", (await fx.crearAnonimo()).cliente],
        ["authenticated (cuenta)", await fx.iniciarSesion(await fx.crearUsuario())],
      ];
      for (const [actor, cliente] of actores) {
        const lecturas = [
          ["opcion", await cliente.from("opcion").select("id, correcta, id_misconcepcion, error")],
          ["pregunta", await cliente.from("pregunta").select("id, enunciado, solucion")],
          ["misconcepcion", await cliente.from("misconcepcion").select("id, descripcion")],
        ] as const;
        for (const [tabla, { data, error }] of lecturas) {
          expect(error?.code, `${actor} no debía poder leer ${tabla}`).toBe("42501");
          expect(data).toBeNull();
        }

        const materias = await cliente.from("materia").select("codigo").eq("id", materia.id);
        expect(materias.error).toBeNull();
        expect(materias.data).toEqual([{ codigo: "ZZPR-0001" }]);
        const evaluaciones = await cliente.from("evaluacion").select("clave, activa").eq("id_materia", materia.id).order("clave");
        expect(evaluaciones.error).toBeNull();
        expect(evaluaciones.data).toEqual([
          { clave: "parcial-1", activa: true },
          { clave: "parcial-2", activa: false },
        ]);
      }
    } finally {
      await fx.limpiar();
    }
  });
});

// ---------------------------------------------------------------------------
// HU-055 (D-62 a): la carga conserva lo que un admin corrigió en la app
// ---------------------------------------------------------------------------
// El admin corrige por la Data API con una sesión real (políticas, permisos por columna y triggers, como desde la pantalla), y la
// carga reconoce la materia por su carpeta. Las marcas `editada_en_app` las pone la base; la carga no las pone nunca.

const CIERRE = "Para que vuelva a seguir al banco, iguala materia.md con la base.";
const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

/** El ejemplo con cambios de texto en sus archivos, por la ruta del banco ("materia-a/materia.md"). Falla si el banco cambiado no es válido. */
function ejemploCambiado(cambios: Record<string, (texto: string) => string>): Banco {
  const archivos = archivosDelEjemplo();
  for (const ruta of Object.keys(cambios)) {
    if (!archivos.some((a) => a.ruta === ruta)) throw new Error(`el ejemplo no tiene ${ruta}`);
  }
  const resultado = analizarBanco(archivos.map((a) => (cambios[a.ruta] ? { ...a, texto: cambios[a.ruta](a.texto) } : a)));
  expect(resultado.errores).toEqual([]);
  return resultado.banco;
}

/** El ejemplo con la carpeta de materia-b renombrada a materia-c. */
function ejemploConCarpetaRenombrada(): Banco {
  const archivos = archivosDelEjemplo().map((a) => (a.ruta.startsWith("materia-b/") ? { ...a, ruta: a.ruta.replace("materia-b/", "materia-c/") } : a));
  const resultado = analizarBanco(archivos);
  expect(resultado.errores).toEqual([]);
  return resultado.banco;
}

type FilaMateria = { id: string; codigo: string; nombre: string; carpeta: string | null; editada_en_app: boolean };

/** La materia del banco con esa carpeta, tal como está en la base. */
async function materiaDeCarpeta(carpeta: string): Promise<FilaMateria> {
  const { rows } = await bd.query<FilaMateria>(
    "select id, codigo, nombre, carpeta, editada_en_app from public.materia where carpeta = $1",
    [carpeta],
  );
  if (rows.length !== 1) throw new Error(`Se esperaba una materia con la carpeta ${carpeta} y hay ${rows.length}`);
  return rows[0];
}

/** Todas las materias del ejemplo, tengan el código que tengan (un admin pudo cambiarlo), en un orden fijo. */
async function materiasDelEjemplo(): Promise<FilaMateria[]> {
  const { rows } = await bd.query<FilaMateria>(
    `select id, codigo, nombre, carpeta, editada_en_app from public.materia where id in (${DEL_EJEMPLO}) order by nombre, id`,
  );
  return rows;
}

type FilaEvaluacion = {
  id: string;
  clave: string;
  nombre: string;
  semana: number;
  acumulativo: boolean;
  activa: boolean;
  editada_en_app: boolean;
  temas: string[];
};

/** Las evaluaciones de la materia con esa carpeta, por clave, con las claves de sus temas en el orden de la materia. */
async function evaluacionesDe(carpeta: string): Promise<Map<string, FilaEvaluacion>> {
  const { rows } = await bd.query<FilaEvaluacion>(
    `select e.id, e.clave, e.nombre, e.semana, e.acumulativo, e.activa, e.editada_en_app,
            array(select t.clave from public.evaluacion_tema et join public.tema t on t.id = et.id_tema
                   where et.id_evaluacion = e.id order by t.orden) as temas
       from public.evaluacion e join public.materia m on m.id = e.id_materia
      where m.carpeta = $1
      order by e.clave`,
    [carpeta],
  );
  return new Map(rows.map((fila) => [fila.clave, fila]));
}

async function evaluacionDe(carpeta: string, clave: string): Promise<FilaEvaluacion> {
  const fila = (await evaluacionesDe(carpeta)).get(clave);
  if (!fila) throw new Error(`No encontré la evaluación ${carpeta}/${clave} en la base`);
  return fila;
}

describe("HU-055 (D-62 a): la carga conserva lo que un admin corrigió en la app y avisa", () => {
  let fx: Fixtures;

  beforeEach(() => {
    fx = new Fixtures();
  });

  afterEach(async () => {
    await fx.limpiar();
  });

  /** Un admin con sesión real: lo que cambia por aquí pasa por la Data API, las políticas y los triggers. */
  const conAdmin = async () => fx.iniciarSesion(await fx.crearAdmin());

  async function corregirMateria(admin: Cliente, codigo: string, cambios: { nombre?: string; codigo?: string }) {
    const filas = exito(await admin.from("materia").update(cambios).eq("codigo", codigo).select("id"), `el admin corrige la materia ${codigo}`);
    expect(filas, "el admin debía corregir una sola materia").toHaveLength(1);
  }

  async function corregirEvaluacion(admin: Cliente, carpeta: string, clave: string, cambios: { nombre?: string; semana?: number }) {
    const { id } = await materiaDeCarpeta(carpeta);
    const filas = exito(
      await admin.from("evaluacion").update(cambios).eq("id_materia", id).eq("clave", clave).select("id"),
      `el admin corrige la evaluación ${carpeta}/${clave}`,
    );
    expect(filas, "el admin debía corregir una sola evaluación").toHaveLength(1);
  }

  it("a. renombrar la materia: la carga conserva el nombre, avisa, sigue cargando lo demás, y la marca de la materia no protege a sus evaluaciones", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const antes = await materiaDeCarpeta("materia-a");
    await corregirMateria(await conAdmin(), "ZZPR-0001", { nombre: "Nombre del admin" });
    expect(await materiaDeCarpeta("materia-a")).toEqual({ ...antes, nombre: "Nombre del admin", editada_en_app: true });
    // El banco manda en lo que la app no toca: una evaluación apagada a mano vuelve a quedar activa por cobertura.
    await bd.query("update public.evaluacion set activa = false where id_materia = $1 and clave = 'parcial-1'", [antes.id]);

    // materia.md cambia el nombre de la materia, y el nombre y la semana de una evaluación que nadie editó; derivadas.md, el
    // título de un tema y agrega una pregunta.
    const banco = ejemploCambiado({
      "materia-a/materia.md": (texto) =>
        reemplazar(
          reemplazar(texto, "nombre: Materia de prueba A", "nombre: Nombre del markdown"),
          "### parcial-2 · Parcial 2 · semana 12",
          "### parcial-2 · Parcial dos · semana 13",
        ),
      "materia-a/derivadas.md": (texto) =>
        reemplazar(
          reemplazar(texto, "# Derivadas", "# Derivadas, con otro título"),
          "### P2 ",
          [
            "### P10 · dificultad 1 · kc: potencia · revisada · origen: humano · revisó: Ana",
            "Si f(x) = 7x², entonces f'(x) es:",
            "",
            "- A) 14x · CORRECTA",
            "- B) 14x² · [no-resta-uno]",
            "- C) 7x³/3 · [suma-uno]",
            "- D) 7x · [no-baja]",
            "",
            "### P2 ",
          ].join("\n"),
        ),
    });
    const { conteos, avisos } = await cargarBanco(bd, banco, SOLO_REVISADAS);

    expect(avisos).toEqual([`materia-a: la base conserva lo que un admin cambió en la app (nombre: base "Nombre del admin", materia.md "Nombre del markdown"). ${CIERRE}`]);
    expect(await materiaDeCarpeta("materia-a")).toEqual({ ...antes, nombre: "Nombre del admin", editada_en_app: true });
    // Lo demás sigue al banco: el tema, la pregunta nueva, la evaluación apagada y los datos de la evaluación sin editar.
    const { rows: [tema] } = await bd.query("select nombre from public.tema where id_materia = $1 and clave = 'derivadas'", [antes.id]);
    expect(tema.nombre).toBe("Derivadas, con otro título");
    expect((await preguntasEnBase()).has("ZZPR-0001/P10")).toBe(true);
    expect(await evaluacionDe("materia-a", "parcial-1")).toMatchObject({ activa: true, editada_en_app: false });
    expect(await evaluacionDe("materia-a", "parcial-2")).toMatchObject({ nombre: "Parcial dos", semana: 13, editada_en_app: false });
    expect(conteos).toEqual(contar(banco, SOLO_REVISADAS));
  });

  it("b. cambiar el código: la carga encuentra la materia por su carpeta (mismo id, sin otra fila) y avisa del código", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const antes = await materiaDeCarpeta("materia-a");
    // Un código que ya no empieza por ZZPR-: la limpieza de la prueba tiene que encontrarlo por la carpeta.
    await corregirMateria(await conAdmin(), "ZZPR-0001", { codigo: "ZZPX-0011" });

    const banco = ejemploCambiado({
      "materia-a/materia.md": (texto) => reemplazar(texto, "### parcial-2 · Parcial 2 · semana 12", "### parcial-2 · Parcial dos · semana 13"),
    });
    const { conteos, avisos } = await cargarBanco(bd, banco, SOLO_REVISADAS);

    expect(avisos).toEqual([`materia-a: la base conserva lo que un admin cambió en la app (codigo: base "ZZPX-0011", materia.md "ZZPR-0001"). ${CIERRE}`]);
    expect((await materiasDelEjemplo()).map((m) => m.carpeta).sort()).toEqual(["materia-a", "materia-b"]);
    expect(await materiaDeCarpeta("materia-a")).toEqual({ ...antes, codigo: "ZZPX-0011", editada_en_app: true });
    const { rows: [otra] } = await bd.query("select count(*)::int as n from public.materia where codigo = 'ZZPR-0001'");
    expect(otra.n).toBe(0);
    // La marca es de la materia: la evaluación que nadie editó sigue al markdown.
    expect(await evaluacionDe("materia-a", "parcial-2")).toMatchObject({ nombre: "Parcial dos", semana: 13, editada_en_app: false });
    expect(conteos).toEqual(contar(banco, SOLO_REVISADAS));
  });

  it("c. una materia creada en la app con el código de una carpeta se adopta: mismo id, carpeta puesta, temas cargados y aviso del nombre", async () => {
    const admin = await conAdmin();
    const { id } = exito(await admin.from("materia").insert({ nombre: "Creada en la app", codigo: "ZZPR-0001" }).select("id").single(), "el admin crea la materia");
    const { rows: [creada] } = await bd.query("select carpeta, editada_en_app from public.materia where id = $1", [id]);
    expect(creada).toEqual({ carpeta: null, editada_en_app: true });

    const { conteos, avisos } = await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);

    expect(avisos).toEqual([`materia-a: la base conserva lo que un admin cambió en la app (nombre: base "Creada en la app", materia.md "Materia de prueba A"). ${CIERRE}`]);
    expect(await materiaDeCarpeta("materia-a")).toEqual({ id, codigo: "ZZPR-0001", nombre: "Creada en la app", carpeta: "materia-a", editada_en_app: true });
    expect((await materiasDelEjemplo()).map((m) => m.carpeta).sort()).toEqual(["materia-a", "materia-b"]);
    expect((await filasDelEjemplo()).temas).toBe(3);
    expect(conteos).toEqual(contar(ejemplo(), SOLO_REVISADAS));
  });

  it("c. la materia creada en la app con el mismo nombre se adopta sin aviso y la marca baja", async () => {
    const admin = await conAdmin();
    const { id } = exito(await admin.from("materia").insert({ nombre: "Materia de prueba A", codigo: "ZZPR-0001" }).select("id").single(), "el admin crea la materia");

    const { avisos } = await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);

    expect(avisos).toEqual([]);
    expect(await materiaDeCarpeta("materia-a")).toEqual({ id, codigo: "ZZPR-0001", nombre: "Materia de prueba A", carpeta: "materia-a", editada_en_app: false });
  });

  it("c. una fila de confianza con el código en minúsculas y con espacios también se adopta, y el banco le corrige el código y el nombre", async () => {
    const { rows: [fila] } = await bd.query<{ id: string }>("insert into public.materia (nombre, codigo) values ('Fixture de confianza', ' zzpr-0001 ') returning id");

    const { avisos } = await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);

    expect(avisos).toEqual([]);
    expect(await materiaDeCarpeta("materia-a")).toEqual({ id: fila.id, codigo: "ZZPR-0001", nombre: "Materia de prueba A", carpeta: "materia-a", editada_en_app: false });
    expect(await materiasDelEjemplo()).toHaveLength(2);
  });

  it("d. sin edición, materia.md con otro nombre, otro código y otra semana se aplica, y las marcas siguen en falso", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const antes = await materiaDeCarpeta("materia-a");

    const banco = ejemploCambiado({
      "materia-a/materia.md": (texto) =>
        reemplazar(
          reemplazar(
            reemplazar(texto, "codigo: ZZPR-0001", "codigo: ZZPR-0011"),
            "nombre: Materia de prueba A",
            "nombre: Otro nombre en el markdown",
          ),
          "### parcial-1 · Parcial 1 · semana 6",
          "### parcial-1 · Parcial uno · semana 7",
        ),
    });
    const { conteos, avisos } = await cargarBanco(bd, banco, SOLO_REVISADAS);

    expect(avisos).toEqual([]);
    expect(await materiaDeCarpeta("materia-a")).toEqual({ id: antes.id, codigo: "ZZPR-0011", nombre: "Otro nombre en el markdown", carpeta: "materia-a", editada_en_app: false });
    expect(await evaluacionDe("materia-a", "parcial-1")).toMatchObject({ nombre: "Parcial uno", semana: 7, editada_en_app: false });
    expect((await materiasDelEjemplo()).map((m) => m.carpeta).sort()).toEqual(["materia-a", "materia-b"]);
    expect(conteos).toEqual(contar(banco, SOLO_REVISADAS));
  });

  it("e1. otra materia con carpeta propia tiene el código que pide materia-b: la carga falla nombrando las dos y no cambia nada", async () => {
    // La otra materia está en la base antes de la carga; materia-a, que se procesa primero, se escribiría en la misma transacción.
    await bd.query("insert into public.materia (codigo, nombre, carpeta) values ('ZZPR-0002', 'Otra materia', 'zzpr-otra')");
    const antes = await materiasDelEjemplo();

    await expect(cargarBanco(bd, ejemplo(), SOLO_REVISADAS)).rejects.toThrow(
      'contenido/materia-b (Materia de prueba B) quiere el código ZZPR-0002, pero ya lo tiene la materia "Otra materia" (carpeta zzpr-otra). La carga no cambió nada.',
    );

    expect(await materiasDelEjemplo()).toEqual(antes);
    expect(await filasDelEjemplo()).toMatchObject({ materias: 1, temas: 0, preguntas: 0, evaluaciones: 0 });
  });

  it("e2. materia.md le cambia el código a una materia ya cargada por el de otra materia creada en la app: falla nombrando las dos y revierte también lo anterior", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    await bd.query("insert into public.materia (codigo, nombre) values ('ZZPR-0012', 'Materia de la app')");
    const antes = await materiasDelEjemplo();
    const evaluacionesAntes = await evaluacionesDe("materia-a");

    // materia-a se procesa primero: su cambio de nombre y de semana se escribe antes de que materia-b falle.
    const banco = ejemploCambiado({
      "materia-a/materia.md": (texto) =>
        reemplazar(
          reemplazar(texto, "nombre: Materia de prueba A", "nombre: Nombre que no debe quedar"),
          "### parcial-1 · Parcial 1 · semana 6",
          "### parcial-1 · Parcial uno · semana 7",
        ),
      "materia-b/materia.md": (texto) => reemplazar(texto, "codigo: ZZPR-0002", "codigo: ZZPR-0012"),
    });
    await expect(cargarBanco(bd, banco, SOLO_REVISADAS)).rejects.toThrow(
      'contenido/materia-b (Materia de prueba B) quiere el código ZZPR-0012, pero ya lo tiene la materia "Materia de la app" (creada en la app). La carga no cambió nada.',
    );

    expect(await materiasDelEjemplo()).toEqual(antes);
    expect(await evaluacionesDe("materia-a")).toEqual(evaluacionesAntes);
  });

  it("e1. lo mismo cuando la otra materia guarda el código en minúsculas y con espacios: la comprobación no distingue mayúsculas ni espacios y el mensaje es el de la carga, no el del índice", async () => {
    await bd.query("insert into public.materia (codigo, nombre, carpeta) values (' zzpr-0002 ', 'Otra materia', 'zzpr-otra')");
    const antes = await materiasDelEjemplo();

    await expect(cargarBanco(bd, ejemplo(), SOLO_REVISADAS)).rejects.toThrow(
      'contenido/materia-b (Materia de prueba B) quiere el código ZZPR-0002, pero ya lo tiene la materia "Otra materia" (carpeta zzpr-otra). La carga no cambió nada.',
    );

    expect(await materiasDelEjemplo()).toEqual(antes);
    expect(await filasDelEjemplo()).toMatchObject({ materias: 0, temas: 0, preguntas: 0, evaluaciones: 0 });
  });

  it("e2. lo mismo cuando la materia creada en la app guarda el código en minúsculas y con espacios", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    await bd.query("insert into public.materia (codigo, nombre) values (' zzpr-0012 ', 'Materia de la app')");
    const antes = await materiasDelEjemplo();

    const banco = ejemploCambiado({ "materia-b/materia.md": (texto) => reemplazar(texto, "codigo: ZZPR-0002", "codigo: ZZPR-0012") });
    await expect(cargarBanco(bd, banco, SOLO_REVISADAS)).rejects.toThrow(
      'contenido/materia-b (Materia de prueba B) quiere el código ZZPR-0012, pero ya lo tiene la materia "Materia de la app" (creada en la app). La carga no cambió nada.',
    );

    expect(await materiasDelEjemplo()).toEqual(antes);
  });

  it("f. la marca baja cuando materia.md alcanza lo editado, sin aviso, y el cambio posterior de materia.md se aplica", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    await corregirMateria(await conAdmin(), "ZZPR-0001", { nombre: "Nombre del admin" });

    const alcanzado = ejemploCambiado({ "materia-a/materia.md": (texto) => reemplazar(texto, "nombre: Materia de prueba A", "nombre: Nombre del admin") });
    const primera = await cargarBanco(bd, alcanzado, SOLO_REVISADAS);
    expect(primera.avisos).toEqual([]);
    expect(await materiaDeCarpeta("materia-a")).toMatchObject({ nombre: "Nombre del admin", editada_en_app: false });

    const siguiente = ejemploCambiado({ "materia-a/materia.md": (texto) => reemplazar(texto, "nombre: Materia de prueba A", "nombre: Tercer nombre") });
    const segunda = await cargarBanco(bd, siguiente, SOLO_REVISADAS);
    expect(segunda.avisos).toEqual([]);
    expect(await materiaDeCarpeta("materia-a")).toMatchObject({ nombre: "Tercer nombre", editada_en_app: false });
  });

  it("f. lo mismo en una evaluación: la marca baja cuando materia.md alcanza lo editado y el cambio posterior se aplica", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    await corregirEvaluacion(await conAdmin(), "materia-a", "parcial-1", { nombre: "Primer parcial", semana: 9 });
    expect(await evaluacionDe("materia-a", "parcial-1")).toMatchObject({ nombre: "Primer parcial", semana: 9, editada_en_app: true });

    const alcanzado = ejemploCambiado({
      "materia-a/materia.md": (texto) => reemplazar(texto, "### parcial-1 · Parcial 1 · semana 6", "### parcial-1 · Primer parcial · semana 9"),
    });
    const primera = await cargarBanco(bd, alcanzado, SOLO_REVISADAS);
    expect(primera.avisos).toEqual([]);
    expect(await evaluacionDe("materia-a", "parcial-1")).toMatchObject({ nombre: "Primer parcial", semana: 9, editada_en_app: false });

    const siguiente = ejemploCambiado({
      "materia-a/materia.md": (texto) => reemplazar(texto, "### parcial-1 · Parcial 1 · semana 6", "### parcial-1 · Parcial uno · semana 8"),
    });
    const segunda = await cargarBanco(bd, siguiente, SOLO_REVISADAS);
    expect(segunda.avisos).toEqual([]);
    expect(await evaluacionDe("materia-a", "parcial-1")).toMatchObject({ nombre: "Parcial uno", semana: 8, editada_en_app: false });
  });

  it("g. evaluación editada: nombre y semana se conservan con aviso; acumulativo, activa y sus temas siguen al banco; otra evaluación sin editar se actualiza", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const antes = await evaluacionDe("materia-a", "parcial-2");
    expect(antes).toMatchObject({ acumulativo: true, activa: false, temas: ["derivadas", "integrales"] });
    await corregirEvaluacion(await conAdmin(), "materia-a", "parcial-2", { nombre: "Segundo parcial", semana: 13 });
    // La encendemos a mano: el banco dice que no cumple la cobertura.
    await bd.query("update public.evaluacion set activa = true where id = $1", [antes.id]);

    // parcial-2 deja de ser acumulativa (sus temas bajan a integrales) y parcial-1, que nadie editó, cambia de nombre y de semana.
    const banco = ejemploCambiado({
      "materia-a/materia.md": (texto) =>
        reemplazar(
          reemplazar(texto, "### parcial-1 · Parcial 1 · semana 6", "### parcial-1 · Parcial uno · semana 7"),
          "### parcial-2 · Parcial 2 · semana 12 · acumulativa",
          "### parcial-2 · Parcial 2 · semana 12",
        ),
    });
    const { avisos } = await cargarBanco(bd, banco, SOLO_REVISADAS);

    expect(avisos).toEqual([
      `materia-a/parcial-2: la base conserva lo que un admin cambió en la app (nombre: base "Segundo parcial", materia.md "Parcial 2"; semana: base 13, materia.md 12). ${CIERRE}`,
    ]);
    expect(await evaluacionDe("materia-a", "parcial-2")).toEqual({
      ...antes,
      nombre: "Segundo parcial",
      semana: 13,
      acumulativo: false,
      activa: false,
      temas: ["integrales"],
      editada_en_app: true,
    });
    expect(await evaluacionDe("materia-a", "parcial-1")).toMatchObject({ nombre: "Parcial uno", semana: 7, editada_en_app: false });
  });

  it("h. la carga no marca nada, ni al insertar ni al actualizar, y una carga limpia no avisa", async () => {
    const marcadas = async () => {
      const { rows: [fila] } = await bd.query<{ materias: number; evaluaciones: number }>(
        `select (select count(*) from public.materia where id in (${DEL_EJEMPLO}) and editada_en_app)::int as materias,
                (select count(*) from public.evaluacion where id_materia in (${DEL_EJEMPLO}) and editada_en_app)::int as evaluaciones`,
      );
      return fila;
    };

    expect((await cargarBanco(bd, ejemplo(), SOLO_REVISADAS)).avisos).toEqual([]);
    expect(await marcadas()).toEqual({ materias: 0, evaluaciones: 0 });

    // Actualiza materias y evaluaciones con valores distintos: la carga escribe, y no marca.
    const otros = ejemploCambiado({
      "materia-a/materia.md": (texto) =>
        reemplazar(reemplazar(texto, "nombre: Materia de prueba A", "nombre: Nombre B"), "### parcial-1 · Parcial 1 · semana 6", "### parcial-1 · Parcial uno · semana 7"),
      "materia-b/materia.md": (texto) => reemplazar(texto, "### examen-final · Examen final · semana 16", "### examen-final · Final · semana 15"),
    });
    expect((await cargarBanco(bd, otros, SOLO_REVISADAS)).avisos).toEqual([]);
    expect(await materiaDeCarpeta("materia-a")).toMatchObject({ nombre: "Nombre B" });
    expect(await evaluacionDe("materia-b", "examen-final")).toMatchObject({ nombre: "Final", semana: 15 });
    expect(await marcadas()).toEqual({ materias: 0, evaluaciones: 0 });

    expect((await cargarBanco(bd, ejemplo(), SOLO_REVISADAS)).avisos).toEqual([]);
    expect(await marcadas()).toEqual({ materias: 0, evaluaciones: 0 });
  });

  it("i. renombrar la carpeta de una materia ya cargada falla nombrando las dos y no cambia nada", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const antes = await materiasDelEjemplo();

    await expect(cargarBanco(bd, ejemploConCarpetaRenombrada(), SOLO_REVISADAS)).rejects.toThrow(
      'contenido/materia-c (Materia de prueba B) quiere el código ZZPR-0002, pero ya lo tiene la materia "Materia de prueba B" (carpeta materia-b). La carga no cambió nada.',
    );

    expect(await materiasDelEjemplo()).toEqual(antes);
  });

  it("j. con las marcas puestas, dos cargas seguidas dan los mismos avisos y dejan las mismas filas", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const admin = await conAdmin();
    await corregirMateria(admin, "ZZPR-0001", { nombre: "Nombre del admin" });
    await corregirEvaluacion(admin, "materia-a", "parcial-1", { nombre: "Primer parcial" });

    const esperados = [
      `materia-a: la base conserva lo que un admin cambió en la app (nombre: base "Nombre del admin", materia.md "Materia de prueba A"). ${CIERRE}`,
      `materia-a/parcial-1: la base conserva lo que un admin cambió en la app (nombre: base "Primer parcial", materia.md "Parcial 1"). ${CIERRE}`,
    ];
    const primera = await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const materias = await materiasDelEjemplo();
    const evaluaciones = await evaluacionesDe("materia-a");
    const segunda = await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);

    expect(primera.avisos).toEqual(esperados);
    expect(segunda.avisos).toEqual(esperados);
    expect(segunda.conteos).toEqual(primera.conteos);
    expect(await materiasDelEjemplo()).toEqual(materias);
    expect(await evaluacionesDe("materia-a")).toEqual(evaluaciones);
  });

  // Carrera: el admin guarda mientras la carga lee. La conexión A es el admin (rol authenticated y sus claims dentro de una
  // transacción) y no confirma; la B es la carga, que tiene que quedar esperando y, al confirmar A, ver la marca ya puesta.
  async function cargaMientrasUnAdminEdita(editarComoAdmin: (admin: pg.Client) => Promise<void>, banco: Banco): Promise<ResultadoCarga> {
    const A = new pg.Client({ connectionString: URL_BD });
    const B = new pg.Client({ connectionString: URL_BD });
    await Promise.all([A.connect(), B.connect()]);
    let carga: Promise<ResultadoCarga> | undefined;
    try {
      const admin = await fx.crearAdmin();
      await A.query("begin");
      await A.query("set local role authenticated");
      await A.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
      await editarComoAdmin(A);

      let terminada = false;
      carga = cargarBanco(B, banco, SOLO_REVISADAS).finally(() => {
        terminada = true;
      });
      await pausa(400);
      expect(terminada, "la carga debía quedar esperando a que el admin confirmara").toBe(false);
      await A.query("commit");
      return await carga;
    } finally {
      // Si algo falló antes del commit, suelta los candados para que la carga termine.
      await A.query("rollback").catch(() => {});
      await carga?.catch(() => {});
      await Promise.all([A.end(), B.end()]);
    }
  }

  it("carrera: un admin guarda el nombre de la materia mientras la carga lee; la carga espera y su nombre sobrevive", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const banco = ejemploCambiado({ "materia-a/materia.md": (texto) => reemplazar(texto, "nombre: Materia de prueba A", "nombre: Nombre del markdown") });

    const { avisos } = await cargaMientrasUnAdminEdita(async (admin) => {
      const { rowCount } = await admin.query("update public.materia set nombre = 'Nombre del admin en carrera' where carpeta = 'materia-a'");
      expect(rowCount).toBe(1);
    }, banco);

    expect(await materiaDeCarpeta("materia-a")).toMatchObject({ nombre: "Nombre del admin en carrera", editada_en_app: true });
    expect(avisos).toEqual([`materia-a: la base conserva lo que un admin cambió en la app (nombre: base "Nombre del admin en carrera", materia.md "Nombre del markdown"). ${CIERRE}`]);
  });

  it("carrera: un admin guarda el nombre de una evaluación mientras la carga lee; la carga espera y su nombre sobrevive", async () => {
    await cargarBanco(bd, ejemplo(), SOLO_REVISADAS);
    const banco = ejemploCambiado({
      "materia-a/materia.md": (texto) => reemplazar(texto, "### parcial-1 · Parcial 1 · semana 6", "### parcial-1 · Parcial uno · semana 6"),
    });

    const { avisos } = await cargaMientrasUnAdminEdita(async (admin) => {
      const { rowCount } = await admin.query(
        "update public.evaluacion set nombre = 'Nombre del admin en carrera' where clave = 'parcial-1' and id_materia = (select id from public.materia where carpeta = 'materia-a')",
      );
      expect(rowCount).toBe(1);
    }, banco);

    expect(await evaluacionDe("materia-a", "parcial-1")).toMatchObject({ nombre: "Nombre del admin en carrera", editada_en_app: true });
    expect(avisos).toEqual([`materia-a/parcial-1: la base conserva lo que un admin cambió en la app (nombre: base "Nombre del admin en carrera", materia.md "Parcial uno"). ${CIERRE}`]);
  });

  it("carrera: un admin renombra una materia creada en la app mientras la carga la adopta; la carga espera y el nombre del admin sobrevive con su marca", async () => {
    // Creada en la app con el nombre de materia.md: si la carga leyera la fila sin esperar al admin vería el nombre viejo, con la
    // marca puesta, y como ya coincide con materia.md bajaría la marca: el nombre del admin quedaría sin protección en la carga siguiente.
    const { id } = exito(
      await (await conAdmin()).from("materia").insert({ nombre: "Materia de prueba A", codigo: "ZZPR-0001" }).select("id").single(),
      "el admin crea la materia",
    );

    const { avisos } = await cargaMientrasUnAdminEdita(async (admin) => {
      const { rowCount } = await admin.query("update public.materia set nombre = 'Nombre del admin en carrera' where id = $1", [id]);
      expect(rowCount).toBe(1);
    }, ejemplo());

    expect(await materiaDeCarpeta("materia-a")).toEqual({ id, codigo: "ZZPR-0001", nombre: "Nombre del admin en carrera", carpeta: "materia-a", editada_en_app: true });
    expect(avisos).toEqual([`materia-a: la base conserva lo que un admin cambió en la app (nombre: base "Nombre del admin en carrera", materia.md "Materia de prueba A"). ${CIERRE}`]);
  });
});
