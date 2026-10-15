import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Client } from "pg";
import { analizarBanco } from "../scripts/contenido/banco.mts";
import { cargarBanco } from "../scripts/contenido/cargar.mts";
import type { ArchivoBanco, Banco } from "../scripts/contenido/modelo.mts";

/**
 * El banco de ejemplo (`pruebas/banco-ejemplo`) cargado en el Supabase LOCAL para la e2e del diagnóstico (HU-009), uno por
 * proyecto de Playwright.
 *
 * Playwright corre los proyectos `movil` y `escritorio` a la vez contra la misma base, y `fullyParallel` corre hasta las pruebas
 * de un mismo archivo en paralelo. Por eso este banco NO usa `cargarBancoDePrueba` de `integracion/banco-de-prueba.ts`: ese borra
 * todas las materias `ZZDG-%` (las de HU-081) y el ejemplo trae el mismo nombre de materia con cualquier código, y una prueba
 * elige su materia por nombre en un selector que muestra las de todos. Aquí cada proyecto tiene:
 *
 * - códigos propios (`ZZDM-0001` y `ZZDM-0002` para `movil`; `ZZDE-0001` y `ZZDE-0002` para `escritorio`), distintos del
 *   `ZZDG-` de HU-081, del `ZZPR-` de `integracion/banco.test.ts` y de los de las demás e2e;
 * - nombres propios («Materia de prueba A (móvil)»);
 * - un borrado por código exacto, nunca por `like`: uno amplio borraría el banco del otro proyecto, que está en uso.
 *
 * Los cambios se hacen en memoria; los archivos del ejemplo no se tocan. Con un proyecto nuevo de Playwright (HU-048 quiere uno
 * de 1440 px) `proyectoDelBanco` falla en claro hasta que se le da su letra: no se inventa un código al azar, para que un resto
 * de una corrida cortada se pueda borrar por nombre.
 *
 * Es un `.ts` y no un `.tsx`: una spec no puede importar un `.tsx` (Playwright lo compila con su propio JSX).
 */

const EJEMPLO = join(__dirname, "..", "pruebas", "banco-ejemplo");

/** Por proyecto de Playwright: la letra de los códigos y cómo se dice en el nombre de la materia. */
const PROYECTOS: Record<string, { letra: string; sufijo: string }> = {
  movil: { letra: "M", sufijo: "móvil" },
  escritorio: { letra: "E", sufijo: "escritorio" },
};

/**
 * La fórmula más ancha del banco real (HU-083 E.6: mide 254 a 266 px y una opción a 390 px tiene unos 270 útiles). Reemplaza el
 * texto de la opción D de P5 del ejemplo, así que sale en cualquier diagnóstico que muestre esa pregunta.
 */
export const FORMULA_MAS_ANCHA = String.raw`\lim_{x\to-\infty} \left(\sqrt{x^2 + 8x} + x\right) = -4`;
const OPCION_ORIGINAL = String.raw`D) $\sqrt{2x}$`;

export type ProyectoDelBanco = {
  proyecto: string;
  codigoA: string;
  codigoB: string;
  nombreA: string;
  nombreB: string;
};

export function proyectoDelBanco(proyecto: string): ProyectoDelBanco {
  const datos = PROYECTOS[proyecto];
  if (!datos) {
    throw new Error(
      `El proyecto de Playwright «${proyecto}» no tiene banco propio: agrégale su letra en PROYECTOS de e2e/banco-del-proyecto.ts (códigos ZZD<letra>-0001 y -0002).`,
    );
  }
  return {
    proyecto,
    codigoA: `ZZD${datos.letra}-0001`,
    codigoB: `ZZD${datos.letra}-0002`,
    nombreA: `Materia de prueba A (${datos.sufijo})`,
    nombreB: `Materia de prueba B (${datos.sufijo})`,
  };
}

function archivosDe(carpeta: string): ArchivoBanco[] {
  const archivos: ArchivoBanco[] = [];
  const recorrer = (actual: string) => {
    for (const nombre of readdirSync(actual)) {
      const ruta = join(actual, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else archivos.push({ ruta: relative(carpeta, ruta).replaceAll("\\", "/"), texto: readFileSync(ruta, "utf8") });
    }
  };
  recorrer(carpeta);
  return archivos;
}

/** El banco de ejemplo con los códigos, los nombres y la fórmula ancha de ese proyecto. Falla en claro si un cambio no encuentra su texto. */
export function bancoEnMemoria(proyecto: string): Banco {
  const datos = proyectoDelBanco(proyecto);
  const cambios: [string, string][] = [
    ["ZZPR-0001", datos.codigoA],
    ["ZZPR-0002", datos.codigoB],
    ["Materia de prueba A", datos.nombreA],
    ["Materia de prueba B", datos.nombreB],
    [OPCION_ORIGINAL, `D) $${FORMULA_MAS_ANCHA}$`],
  ];
  const archivos = archivosDe(EJEMPLO);
  // Un cambio que no encuentra su texto no hace nada y la prueba que lo pidió probaría otra cosa: falla.
  for (const [de] of cambios) {
    if (!archivos.some((archivo) => archivo.texto.includes(de))) throw new Error(`El cambio al banco de prueba no encontró su texto: ${de}`);
  }
  const resultado = analizarBanco(
    archivos.map((archivo) => ({ ...archivo, texto: cambios.reduce((texto, [de, a]) => texto.replaceAll(de, a), archivo.texto) })),
  );
  if (resultado.errores.length > 0) {
    throw new Error(`El banco de prueba no es válido:\n${resultado.errores.map((e) => `${e.archivo}:${e.linea}  ${e.mensaje}`).join("\n")}`);
  }
  return resultado.banco;
}

/** Una conexión `pg` a la base LOCAL. Falla si `SUPABASE_DB_URL` no apunta a esta máquina. */
export async function abrirConexion(): Promise<Client> {
  const url = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!/@(127\.0\.0\.1|localhost):/.test(url)) throw new Error(`SUPABASE_DB_URL no es local (${url}).`);
  const bd = new Client({ connectionString: url });
  await bd.connect();
  return bd;
}

/**
 * Borra el banco de ese proyecto por sus dos códigos exactos, en este orden: lo que cuelga de sus materias (citas y
 * certificados que una prueba cortada haya dejado), los diagnósticos terminados (`diagnostico_evaluacion_fk` no cae en cascada:
 * con uno terminado el `delete from evaluacion` falla con 23503), las Evaluaciones (el diagnóstico en curso se va en cascada con
 * ellas) y las materias (con ellas, el resto del banco).
 */
export async function borrarBancoDelProyecto(bd: Client, proyecto: string): Promise<void> {
  const { codigoA, codigoB } = proyectoDelBanco(proyecto);
  const codigos = [codigoA, codigoB];
  const materias = "select id from public.materia where codigo = any($1::text[])";
  await bd.query(`delete from public.monitoria where id_materia in (${materias})`, [codigos]);
  await bd.query(`delete from public.certificado where id_materia in (${materias})`, [codigos]);
  await bd.query(`delete from public.diagnostico where id_materia in (${materias})`, [codigos]);
  await bd.query(`delete from public.evaluacion where id_materia in (${materias})`, [codigos]);
  await bd.query("delete from public.materia where codigo = any($1::text[])", [codigos]);
}

/** Lo que hay de ese proyecto en las tablas del diagnóstico: la prueba lo comprueba al terminar, no queda nada. */
export async function contarFilasDelProyecto(bd: Client, proyecto: string): Promise<{ diagnosticos: number; enCurso: number }> {
  const { codigoA, codigoB } = proyectoDelBanco(proyecto);
  const materias = "select id from public.materia where codigo = any($1::text[])";
  const { rows } = await bd.query<{ diagnosticos: number; en_curso: number }>(
    `select (select count(*)::int from public.diagnostico where id_materia in (${materias})) as diagnosticos,
            (select count(*)::int from public.diagnostico_en_curso where id_materia in (${materias})) as en_curso`,
    [[codigoA, codigoB]],
  );
  return { diagnosticos: rows[0].diagnosticos, enCurso: rows[0].en_curso };
}

/** El banco ya cargado: los ids que usan las pruebas y la conexión que lo cargó. */
export type BancoCargado = ProyectoDelBanco & {
  banco: Banco;
  bd: Client;
  idMateriaA: string;
  idMateriaB: string;
  /** Activa por cobertura (D-13): la única Evaluación que ofrece el selector de estas materias. */
  idParcial1: string;
  /** Se activa a mano en la prueba que la necesita y se deja apagada en un `finally`. */
  idParcial2: string;
  idExamenFinal: string;
};

async function idDeEvaluacion(bd: Client, codigoMateria: string, clave: string): Promise<string> {
  const { rows } = await bd.query<{ id: string }>(
    "select e.id from public.evaluacion e join public.materia m on m.id = e.id_materia where m.codigo = $1 and e.clave = $2",
    [codigoMateria, clave],
  );
  if (rows.length !== 1) throw new Error(`No encontré la Evaluación ${codigoMateria}/${clave} en la base.`);
  return rows[0].id;
}

async function idDeMateria(bd: Client, codigo: string): Promise<string> {
  const { rows } = await bd.query<{ id: string }>("select id from public.materia where codigo = $1", [codigo]);
  if (rows.length !== 1) throw new Error(`No encontré la materia ${codigo} en la base.`);
  return rows[0].id;
}

/**
 * Deja el banco de ese proyecto cargado: primero borra lo que haya de una corrida cortada y luego carga el ejemplo sin
 * borradores con el cargador real. Solo `parcial-1` de la materia A queda activa; `parcial-2` y `examen-final` (materia B) no.
 */
export async function cargarBancoDelProyecto(proyecto: string): Promise<BancoCargado> {
  const datos = proyectoDelBanco(proyecto);
  const banco = bancoEnMemoria(proyecto);
  const bd = await abrirConexion();
  try {
    await borrarBancoDelProyecto(bd, proyecto);
    await cargarBanco(bd, banco, { borradores: false });
    return {
      ...datos,
      banco,
      bd,
      idMateriaA: await idDeMateria(bd, datos.codigoA),
      idMateriaB: await idDeMateria(bd, datos.codigoB),
      idParcial1: await idDeEvaluacion(bd, datos.codigoA, "parcial-1"),
      idParcial2: await idDeEvaluacion(bd, datos.codigoA, "parcial-2"),
      idExamenFinal: await idDeEvaluacion(bd, datos.codigoB, "examen-final"),
    };
  } catch (error) {
    await bd.end().catch(() => {});
    throw error;
  }
}
