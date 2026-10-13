// Carga del banco de preguntas (HU-005) en la base, con upsert por la clave de cada fila en su materia.
//
// El markdown manda (decisión del 30-sep-2026), salvo lo que un admin corrigió en la app (D-62 a, HU-055): la carga
// deja la base como dice el banco, pero nunca borra una materia, un tema, una habilidad, una misconcepción ni una
// pregunta. Lo que ya no está en el banco se reporta como aviso; una pregunta queda retirada y una evaluación
// inactiva. Solo se reemplazan filas que cuelgan de algo del banco: prerrequisitos, opciones, habilidades de una
// pregunta y temas de una evaluación.
//
// Lo que un admin cambió en la app (el nombre o el código de una materia, el nombre o la semana de una evaluación) lo
// marca la base con `editada_en_app`: la carga conserva esos valores, avisa de la diferencia con los dos valores y baja
// la marca cuando el markdown ya dice lo mismo. La materia se reconoce por su carpeta de contenido/ y no por el código,
// para que corregir un código desde la app no cree otra materia. Todo lo demás (temas, habilidades, preguntas, qué
// evaluaciones están activas, si son acumulativas y sus temas) sigue saliendo siempre del banco.
//
// Todo va en una sola transacción: si algo falla, la base queda como estaba. La conexión la abre y la cierra
// quien llama (convertir.mts o la prueba de integración), que también se asegura de que la base sea la local.
// Espera un banco sin errores de validación (leerBanco): no vuelve a revisar las reglas.
import type pg from "pg";
import { seCarga } from "./banco.mts";
import type { Banco, Conteos, Materia, OpcionesCarga } from "./modelo.mts";

export interface ResultadoCarga {
  /** Filas en la base de las materias del banco, contadas después de cargar (comparables con contar()). */
  conteos: Conteos;
  /** Lo que está en la base y ya no en el banco: no se borra, se reporta. */
  avisos: string[];
}

/** Ids en la base de una materia del banco y de lo suyo, por clave. */
interface MateriaCargada {
  materia: Materia;
  id: string;
  temas: Map<string, string>;
  habilidades: Map<string, string>;
  misconcepciones: Map<string, string>;
}

/** Una opción tal como se guarda, para comparar la del banco con la de la base. */
interface FilaOpcion {
  letra: string;
  texto: string;
  correcta: boolean;
  id_misconcepcion: string | null;
  error: string | null;
}

/** Una materia tal como está en la base. */
interface FilaMateria {
  id: string;
  codigo: string;
  nombre: string;
  /** La carpeta de contenido/ de la que vino; nula si se creó en la app. */
  carpeta: string | null;
  /** Un admin cambió el nombre o el código desde la app. */
  editada_en_app: boolean;
}

/** Un valor que en la base y en el markdown es distinto. */
export interface Diferencia {
  campo: "nombre" | "codigo" | "semana";
  enBase: string | number;
  delBanco: string | number;
}

export interface DecisionMateria {
  /** Lo que la carga escribe en la fila: solo lo que difiere, y nada si la marca está puesta. */
  cambios: { nombre?: string; codigo?: string };
  /** Con la marca puesta, lo que la base conserva y es distinto de materia.md. Sin la marca, vacío (se aplica). */
  diferencias: Diferencia[];
  /** La marca está puesta y materia.md ya dice lo mismo que la base: vuelve a seguir al banco. */
  bajarMarca: boolean;
}

/**
 * Qué hace la carga con una materia que ya está en la base (D-62 a). Sin la marca, el markdown manda: el nombre y el
 * código de materia.md se aplican si difieren. Con la marca, un admin los cambió en la app: no se aplica nada, se
 * reportan las diferencias y, si no hay ninguna, la marca baja. Compara los valores tal cual están: un código guardado
 * en minúsculas o con espacios no es el de materia.md.
 */
export function decidirMateria(
  fila: Pick<FilaMateria, "nombre" | "codigo" | "editada_en_app">,
  delBanco: Pick<Materia, "nombre" | "codigo">,
): DecisionMateria {
  const diferencias: Diferencia[] = [];
  if (fila.nombre !== delBanco.nombre) diferencias.push({ campo: "nombre", enBase: fila.nombre, delBanco: delBanco.nombre });
  if (fila.codigo !== delBanco.codigo) diferencias.push({ campo: "codigo", enBase: fila.codigo, delBanco: delBanco.codigo });
  if (fila.editada_en_app) return { cambios: {}, diferencias, bajarMarca: diferencias.length === 0 };

  const cambios: DecisionMateria["cambios"] = {};
  if (fila.nombre !== delBanco.nombre) cambios.nombre = delBanco.nombre;
  if (fila.codigo !== delBanco.codigo) cambios.codigo = delBanco.codigo;
  return { cambios, diferencias: [], bajarMarca: false };
}

/**
 * Lo que la base conserva de una evaluación que un admin corrigió, según la fila que devolvió el upsert. Vacío si la
 * fila no tiene la marca (el banco la escribió) o si, con la marca, la base y el markdown ya dicen lo mismo.
 */
export function diferenciasDeEvaluacion(
  fila: { nombre: string; semana: number; editada_en_app: boolean },
  delBanco: { nombre: string; semana: number },
): Diferencia[] {
  if (!fila.editada_en_app) return [];
  const diferencias: Diferencia[] = [];
  if (fila.nombre !== delBanco.nombre) diferencias.push({ campo: "nombre", enBase: fila.nombre, delBanco: delBanco.nombre });
  if (fila.semana !== delBanco.semana) diferencias.push({ campo: "semana", enBase: fila.semana, delBanco: delBanco.semana });
  return diferencias;
}

const valorDelAviso = (valor: string | number) => (typeof valor === "number" ? String(valor) : `"${valor}"`);

/** El aviso de una fila cuyos valores la base conservó. `etiqueta` es la carpeta, o carpeta/clave para una evaluación. */
export function avisoDeConservada(etiqueta: string, diferencias: Diferencia[]): string {
  const detalle = diferencias.map((d) => `${d.campo}: base ${valorDelAviso(d.enBase)}, materia.md ${valorDelAviso(d.delBanco)}`).join("; ");
  return `${etiqueta}: la base conserva lo que un admin cambió en la app (${detalle}). Para que vuelva a seguir al banco, iguala materia.md con la base.`;
}

/** Carga el banco en una sola transacción y devuelve los conteos de la base y los avisos. */
export async function cargarBanco(cliente: pg.ClientBase, banco: Banco, opciones: OpcionesCarga): Promise<ResultadoCarga> {
  await cliente.query("begin");
  try {
    const resultado = await cargar(cliente, banco, opciones);
    await cliente.query("commit");
    return resultado;
  } catch (error) {
    // Si el rollback también falla, la conexión ya está rota: lo que importa es el error original.
    await cliente.query("rollback").catch(() => {});
    throw error;
  }
}

async function cargar(bd: pg.ClientBase, banco: Banco, opciones: OpcionesCarga): Promise<ResultadoCarga> {
  const avisos: string[] = [];

  // 1-4. Materias, temas, habilidades y misconcepciones.
  const cargadas: MateriaCargada[] = [];
  for (const materia of banco.materias) cargadas.push(await cargarMateria(bd, materia, avisos));

  // 5. Prerrequisitos: cruzan materias, así que van cuando ya existen las habilidades de todas.
  const habilidades = new Map<string, string>();
  for (const c of cargadas) for (const [clave, id] of c.habilidades) habilidades.set(`${c.materia.carpeta}/${clave}`, id);
  for (const c of cargadas) await cargarPrerrequisitos(bd, c, habilidades);

  // 6-10. Preguntas, evaluaciones y lo que sobra en la base.
  for (const c of cargadas) {
    await cargarPreguntas(bd, c, opciones, avisos);
    await cargarEvaluaciones(bd, c, avisos);
    await avisarSobrantes(bd, c, avisos);
  }

  return { conteos: await contarEnBase(bd, cargadas.map((c) => c.id), opciones), avisos };
}

/** El id que devuelve un insert ... returning id. */
async function idDe(bd: pg.ClientBase, sql: string, valores: unknown[]): Promise<string> {
  const { rows } = await bd.query<{ id: string }>(sql, valores);
  return rows[0].id;
}

/** El id de una clave que el banco validado garantiza; si falta, el banco no pasó por leerBanco. */
function exigir(ids: Map<string, string>, clave: string, que: string): string {
  const id = ids.get(clave);
  if (!id) throw new Error(`${que} "${clave}" no está en el banco cargado: ¿se validó el banco antes de cargarlo?`);
  return id;
}

/**
 * 1. La materia se reconoce por su carpeta y nunca se borra: tiene certificados, solicitudes y evaluaciones.
 *
 * Primero por la carpeta, con la fila tomada (`for update`): un admin que edita la materia a la vez espera a que
 * termine la carga, o la carga espera a que él termine y lee la marca ya puesta; sin el candado, la carga leería la
 * marca vieja y pisaría lo que él acaba de guardar. Si no hay, adopta la que se creó sin carpeta (en la app, o en una
 * base cargada antes de HU-055) con ese código. Si tampoco, inserta; pero antes comprueba que nadie más tenga el
 * código, y si lo tiene falla con la transacción entera revertida. Con una fila ya existente, decidirMateria dice
 * qué se aplica y qué se conserva, y el código nuevo de materia.md pasa por la misma comprobación.
 */
async function reconocerMateria(bd: pg.ClientBase, materia: Materia, avisos: string[]): Promise<string> {
  const columnas = "id, codigo, nombre, carpeta, editada_en_app";
  let { rows: [fila] } = await bd.query<FilaMateria>(`select ${columnas} from public.materia where carpeta = $1 for update`, [materia.carpeta]);
  if (!fila) {
    ({ rows: [fila] } = await bd.query<FilaMateria>(
      `select ${columnas} from public.materia where carpeta is null and lower(btrim(codigo)) = lower(btrim($1)) for update`,
      [materia.codigo],
    ));
    if (fila) await bd.query("update public.materia set carpeta = $2 where id = $1", [fila.id, materia.carpeta]);
  }

  if (!fila) {
    await exigirCodigoLibre(bd, materia, null);
    return idDe(bd, "insert into public.materia (carpeta, codigo, nombre) values ($1, $2, $3) returning id", [materia.carpeta, materia.codigo, materia.nombre]);
  }

  const decision = decidirMateria(fila, materia);
  if (decision.cambios.codigo !== undefined) await exigirCodigoLibre(bd, materia, fila.id);
  if (decision.cambios.nombre !== undefined || decision.cambios.codigo !== undefined) {
    await bd.query("update public.materia set nombre = $2, codigo = $3 where id = $1", [
      fila.id,
      decision.cambios.nombre ?? fila.nombre,
      decision.cambios.codigo ?? fila.codigo,
    ]);
  }
  if (decision.bajarMarca) await bd.query("update public.materia set editada_en_app = false where id = $1", [fila.id]);
  if (decision.diferencias.length > 0) avisos.push(avisoDeConservada(materia.carpeta, decision.diferencias));
  return fila.id;
}

/** Falla si el código de la materia del banco lo tiene otra materia (aunque difiera en mayúsculas o espacios). */
async function exigirCodigoLibre(bd: pg.ClientBase, materia: Materia, idPropio: string | null): Promise<void> {
  const { rows } = await bd.query<{ nombre: string; carpeta: string | null }>(
    "select nombre, carpeta from public.materia where lower(btrim(codigo)) = lower(btrim($1)) and id is distinct from $2::uuid",
    [materia.codigo, idPropio],
  );
  if (rows.length === 0) return;
  const otra = rows[0];
  throw new Error(
    `contenido/${materia.carpeta} (${materia.nombre}) quiere el código ${materia.codigo}, pero ya lo tiene la materia "${otra.nombre}" ` +
      `(${otra.carpeta ? `carpeta ${otra.carpeta}` : "creada en la app"}). La carga no cambió nada.`,
  );
}

// 2-4. Temas, habilidades y misconcepciones, por (id_materia, clave).
async function cargarMateria(bd: pg.ClientBase, materia: Materia, avisos: string[]): Promise<MateriaCargada> {
  const id = await reconocerMateria(bd, materia, avisos);
  const c: MateriaCargada = { materia, id, temas: new Map(), habilidades: new Map(), misconcepciones: new Map() };

  for (const tema of materia.temas) {
    const idTema = await idDe(
      bd,
      `insert into public.tema (id_materia, clave, nombre, orden) values ($1, $2, $3, $4)
       on conflict (id_materia, clave) do update set nombre = excluded.nombre, orden = excluded.orden
       returning id`,
      [id, tema.clave, tema.nombre, tema.orden],
    );
    c.temas.set(tema.clave, idTema);
    for (const habilidad of tema.habilidades) {
      const idHabilidad = await idDe(
        bd,
        `insert into public.habilidad (id_materia, id_tema, clave, descripcion) values ($1, $2, $3, $4)
         on conflict (id_materia, clave) do update set id_tema = excluded.id_tema, descripcion = excluded.descripcion
         returning id`,
        [id, idTema, habilidad.clave, habilidad.descripcion],
      );
      c.habilidades.set(habilidad.clave, idHabilidad);
    }
  }
  // Después de todas las habilidades: una misconcepción puede ser de una habilidad de otro tema.
  for (const tema of materia.temas) {
    for (const misconcepcion of tema.misconcepciones) {
      const idMisconcepcion = await idDe(
        bd,
        `insert into public.misconcepcion (id_materia, id_habilidad, clave, descripcion) values ($1, $2, $3, $4)
         on conflict (id_materia, clave) do update set id_habilidad = excluded.id_habilidad, descripcion = excluded.descripcion
         returning id`,
        [id, exigir(c.habilidades, misconcepcion.habilidad, "la habilidad"), misconcepcion.clave, misconcepcion.descripcion],
      );
      c.misconcepciones.set(misconcepcion.clave, idMisconcepcion);
    }
  }
  return c;
}

/** 5. Los prerrequisitos de cada habilidad del banco quedan iguales a los del banco. */
async function cargarPrerrequisitos(bd: pg.ClientBase, c: MateriaCargada, todas: Map<string, string>) {
  for (const tema of c.materia.temas) {
    for (const habilidad of tema.habilidades) {
      const id = exigir(c.habilidades, habilidad.clave, "la habilidad");
      const destinos = habilidad.prerrequisitos.map((ref) => {
        const nodo = `${ref.materia ?? c.materia.carpeta}/${ref.clave}`;
        return exigir(todas, nodo, "el prerrequisito");
      });
      await bd.query(
        "delete from public.habilidad_prerrequisito where id_habilidad = $1 and not (id_prerrequisito = any($2::uuid[]))",
        [id, destinos],
      );
      for (const destino of destinos) {
        await bd.query(
          "insert into public.habilidad_prerrequisito (id_habilidad, id_prerrequisito) values ($1, $2) on conflict do nothing",
          [id, destino],
        );
      }
    }
  }
}

const mismasOpciones = (enBase: FilaOpcion[], delBanco: FilaOpcion[]) =>
  enBase.length === delBanco.length &&
  enBase.every((o, i) => {
    const b = delBanco[i];
    return o.letra === b.letra && o.texto === b.texto && o.correcta === b.correcta && o.id_misconcepcion === b.id_misconcepcion && o.error === b.error;
  });

// 6. Las que se cargan: contenido, opciones y habilidades como en el banco.
// 7. Las del banco que no se cargan (borrador sin --borradores, retirada): solo su estado, si ya existen.
// 8. Las de la base que ya no están en el banco: retiradas. Nunca se borran: su clave no se reutiliza.
async function cargarPreguntas(bd: pg.ClientBase, c: MateriaCargada, opciones: OpcionesCarga, avisos: string[]) {
  // Lo que ya hay, de una vez por materia, para no tocar las opciones que no cambiaron (sus ids quedan).
  const opcionesEnBase = new Map<string, FilaOpcion[]>();
  const { rows: filas } = await bd.query<FilaOpcion & { id_pregunta: string }>(
    "select id_pregunta, letra, texto, correcta, id_misconcepcion, error from public.opcion where id_materia = $1 order by id_pregunta, letra",
    [c.id],
  );
  for (const { id_pregunta, ...opcion } of filas) opcionesEnBase.set(id_pregunta, [...(opcionesEnBase.get(id_pregunta) ?? []), opcion]);
  const medidasEnBase = new Set<string>();
  const { rows: medidas } = await bd.query<{ id_pregunta: string; id_habilidad: string }>(
    "select id_pregunta, id_habilidad from public.pregunta_habilidad where id_materia = $1",
    [c.id],
  );
  for (const m of medidas) medidasEnBase.add(`${m.id_pregunta}/${m.id_habilidad}`);

  for (const tema of c.materia.temas) {
    for (const pregunta of tema.preguntas) {
      if (!seCarga(pregunta, opciones)) {
        await bd.query("update public.pregunta set estado = $3 where id_materia = $1 and clave = $2", [c.id, pregunta.clave, pregunta.estado]);
        continue;
      }
      const id = await idDe(
        bd,
        `insert into public.pregunta (id_materia, id_tema, clave, enunciado, dificultad, estado, origen, revisor, solucion)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id_materia, clave) do update set
           id_tema = excluded.id_tema, enunciado = excluded.enunciado, dificultad = excluded.dificultad,
           estado = excluded.estado, origen = excluded.origen, revisor = excluded.revisor, solucion = excluded.solucion
         returning id`,
        [c.id, exigir(c.temas, tema.clave, "el tema"), pregunta.clave, pregunta.enunciado, pregunta.dificultad, pregunta.estado, pregunta.origen, pregunta.revisor, pregunta.solucion],
      );

      const delBanco: FilaOpcion[] = pregunta.opciones.map((o) => ({
        letra: o.letra,
        texto: o.texto,
        correcta: o.correcta,
        id_misconcepcion: o.misconcepcion === null ? null : exigir(c.misconcepciones, o.misconcepcion, "la misconcepción"),
        error: o.error,
      }));
      // Si algo cambió, se reemplazan las cuatro: cambiarlas una por una podría dejar, por un momento, dos
      // correctas (o ninguna) y chocar con opcion_una_correcta_key.
      if (!mismasOpciones(opcionesEnBase.get(id) ?? [], delBanco)) {
        await bd.query("delete from public.opcion where id_pregunta = $1", [id]);
        for (const o of delBanco) {
          await bd.query(
            `insert into public.opcion (id_pregunta, id_materia, letra, texto, correcta, id_misconcepcion, error)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [id, c.id, o.letra, o.texto, o.correcta, o.id_misconcepcion, o.error],
          );
        }
      }

      const suyas = pregunta.habilidades.map((clave) => exigir(c.habilidades, clave, "la habilidad"));
      await bd.query("delete from public.pregunta_habilidad where id_pregunta = $1 and not (id_habilidad = any($2::uuid[]))", [id, suyas]);
      for (const idHabilidad of suyas) {
        if (medidasEnBase.has(`${id}/${idHabilidad}`)) continue;
        await bd.query("insert into public.pregunta_habilidad (id_pregunta, id_habilidad, id_materia) values ($1, $2, $3)", [id, idHabilidad, c.id]);
      }
    }
  }

  const claves = c.materia.temas.flatMap((t) => t.preguntas.map((p) => p.clave));
  const { rows: retiradas } = await bd.query<{ clave: string }>(
    "update public.pregunta set estado = 'retirada' where id_materia = $1 and not (clave = any($2::text[])) returning clave",
    [c.id, claves],
  );
  for (const { clave } of retiradas.sort((a, b) => a.clave.localeCompare(b.clave))) {
    avisos.push(`${c.materia.carpeta}: la pregunta "${clave}" está en la base pero no en el banco; queda retirada (no reutilices su clave)`);
  }
}

// 9. Evaluaciones por (id_materia, clave), con sus temas ya expandidos. Las de la materia que no están en el
// banco (otra clave, o sin clave) quedan inactivas: el banco decide cuáles se pueden usar.
//
// Una sola sentencia y sin lectura previa: el candado de la fila que toma el upsert es lo que hace esperar a la carga si un
// admin la está editando, y la expresión se evalúa contra la fila ya confirmada. El nombre y la semana los conserva la
// marca de la evaluación misma (la de la materia no cuenta); acumulativo y activa salen siempre del banco. La marca baja
// cuando el banco ya dice lo mismo que la base. Lo que devuelve el upsert dice si se conservó algo, para avisarlo.
async function cargarEvaluaciones(bd: pg.ClientBase, c: MateriaCargada, avisos: string[]) {
  for (const evaluacion of c.materia.evaluaciones) {
    const { rows: [fila] } = await bd.query<{ id: string; nombre: string; semana: number; editada_en_app: boolean }>(
      `insert into public.evaluacion (id_materia, clave, nombre, semana, acumulativo, activa) values ($1, $2, $3, $4, $5, $6)
       on conflict (id_materia, clave) do update set
         nombre = case when evaluacion.editada_en_app then evaluacion.nombre else excluded.nombre end,
         semana = case when evaluacion.editada_en_app then evaluacion.semana else excluded.semana end,
         acumulativo = excluded.acumulativo,
         activa = excluded.activa,
         editada_en_app = evaluacion.editada_en_app and not (evaluacion.nombre = excluded.nombre and evaluacion.semana = excluded.semana)
       returning id, nombre, semana, editada_en_app`,
      [c.id, evaluacion.clave, evaluacion.nombre, evaluacion.semana, evaluacion.acumulativa, evaluacion.activa],
    );
    const id = fila.id;
    const diferencias = diferenciasDeEvaluacion(fila, evaluacion);
    if (diferencias.length > 0) avisos.push(avisoDeConservada(`${c.materia.carpeta}/${evaluacion.clave}`, diferencias));
    const temas = evaluacion.temas.map((clave) => exigir(c.temas, clave, "el tema"));
    await bd.query("delete from public.evaluacion_tema where id_evaluacion = $1 and not (id_tema = any($2::uuid[]))", [id, temas]);
    for (const idTema of temas) {
      await bd.query(
        "insert into public.evaluacion_tema (id_evaluacion, id_tema, id_materia) values ($1, $2, $3) on conflict do nothing",
        [id, idTema, c.id],
      );
    }
  }

  const { rows: sobrantes } = await bd.query<{ clave: string | null; nombre: string }>(
    `update public.evaluacion set activa = false
     where id_materia = $1 and (clave is null or not (clave = any($2::text[])))
     returning clave, nombre`,
    [c.id, c.materia.evaluaciones.map((e) => e.clave)],
  );
  for (const { clave, nombre } of sobrantes.sort((a, b) => (a.clave ?? a.nombre).localeCompare(b.clave ?? b.nombre))) {
    const cual = clave === null ? `"${nombre}" (sin clave)` : `"${clave}"`;
    avisos.push(`${c.materia.carpeta}: la evaluación ${cual} está en la base pero no en el banco; queda inactiva`);
  }
}

/** 10. Temas, habilidades y misconcepciones que están en la base y ya no en el banco: solo se avisan. */
async function avisarSobrantes(bd: pg.ClientBase, c: MateriaCargada, avisos: string[]) {
  const consultas: [string, string, Map<string, string>][] = [
    ["el tema", "select clave from public.tema where id_materia = $1 and not (clave = any($2::text[])) order by clave", c.temas],
    ["la habilidad", "select clave from public.habilidad where id_materia = $1 and not (clave = any($2::text[])) order by clave", c.habilidades],
    ["la misconcepción", "select clave from public.misconcepcion where id_materia = $1 and not (clave = any($2::text[])) order by clave", c.misconcepciones],
  ];
  for (const [que, sql, delBanco] of consultas) {
    const { rows } = await bd.query<{ clave: string }>(sql, [c.id, [...delBanco.keys()]]);
    for (const { clave } of rows) {
      avisos.push(`${c.materia.carpeta}: ${que} "${clave}" está en la base pero no en el banco; no se borra`);
    }
  }
}

/**
 * Filas en la base de las materias cargadas, con el mismo criterio de contar(): preguntas en los estados que
 * se cargan (y sus opciones y habilidades) y evaluaciones con clave (las del banco).
 */
async function contarEnBase(bd: pg.ClientBase, materias: string[], opciones: OpcionesCarga): Promise<Conteos> {
  const estados = opciones.borradores ? ["revisada", "borrador"] : ["revisada"];
  const { rows } = await bd.query<Conteos>(
    `select
       (select count(*) from public.materia where id = any($1::uuid[]))::int as materias,
       (select count(*) from public.tema where id_materia = any($1::uuid[]))::int as temas,
       (select count(*) from public.habilidad where id_materia = any($1::uuid[]))::int as habilidades,
       (select count(*) from public.habilidad_prerrequisito hp
          join public.habilidad h on h.id = hp.id_habilidad
         where h.id_materia = any($1::uuid[]))::int as prerrequisitos,
       (select count(*) from public.misconcepcion where id_materia = any($1::uuid[]))::int as misconcepciones,
       (select count(*) from public.pregunta
         where id_materia = any($1::uuid[]) and estado = any($2::public.estado_pregunta[]))::int as preguntas,
       (select count(*) from public.opcion o
          join public.pregunta p on p.id = o.id_pregunta
         where p.id_materia = any($1::uuid[]) and p.estado = any($2::public.estado_pregunta[]))::int as opciones,
       (select count(*) from public.pregunta_habilidad ph
          join public.pregunta p on p.id = ph.id_pregunta
         where p.id_materia = any($1::uuid[]) and p.estado = any($2::public.estado_pregunta[]))::int as "preguntaHabilidad",
       (select count(*) from public.evaluacion
         where id_materia = any($1::uuid[]) and clave is not null)::int as evaluaciones,
       (select count(*) from public.evaluacion_tema et
          join public.evaluacion e on e.id = et.id_evaluacion
         where e.id_materia = any($1::uuid[]) and e.clave is not null)::int as "evaluacionTema"`,
    [materias, estados],
  );
  return rows[0];
}
