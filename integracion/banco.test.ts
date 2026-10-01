import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analizarBanco, contar, leerBanco } from "../scripts/contenido/banco.mts";
import { cargarBanco } from "../scripts/contenido/cargar.mts";
import type { ArchivoBanco, Banco, Conteos } from "../scripts/contenido/modelo.mts";
import { crearCliente, exigirSupabaseLocal, Fixtures, type Cliente } from "./utilidades";

// HU-005 contra el Supabase LOCAL: el cargador (scripts/contenido/cargar.mts) deja en la base el banco de
// ejemplo (pruebas/banco-ejemplo, materias ZZPR-0001 y ZZPR-0002) con los conteos del --dry-run, sin duplicar
// nada al repetirse, y las tablas del banco quedan fuera del alcance de anon y authenticated.
//
// Lo que importa del ejemplo (detalle en pruebas/contenido.test.ts): en materia-a, P1-P5 y P8 están revisadas,
// P6 retirada, y P7 y P9 son borradores; materia-b tiene solo P1, revisada. Solo parcial-1 cumple la cobertura;
// parcial-2 es acumulativa y hereda el tema de parcial-1.
//
// Cada prueba parte sin las materias ZZPR: se borran antes de cada una y al final.

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const EJEMPLO = join(__dirname, "..", "pruebas", "banco-ejemplo");
const SOLO_REVISADAS = { borradores: false };
const CON_BORRADORES = { borradores: true };

let bd: pg.Client;

/** Las evaluaciones primero: su llave a materia no cae en cascada. La materia se lleva el resto del banco. */
async function borrarEjemplo() {
  await bd.query("delete from public.evaluacion where id_materia in (select id from public.materia where codigo like 'ZZPR-%')");
  await bd.query("delete from public.materia where codigo like 'ZZPR-%'");
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
