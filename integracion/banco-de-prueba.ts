import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { analizarBanco } from "../scripts/contenido/banco.mts";
import { cargarBanco } from "../scripts/contenido/cargar.mts";
import type { ArchivoBanco, Banco, OpcionesCarga } from "../scripts/contenido/modelo.mts";

/**
 * Los bancos de prueba del servidor del diagnóstico (HU-081), cargados en el Supabase LOCAL con el cargador real
 * (`analizarBanco` y `cargarBanco`, los de `integracion/banco.test.ts`).
 *
 * - El ejemplo de `pruebas/banco-ejemplo` (materias `ZZDG-0001` y `ZZDG-0002`): lo que importa de él, en `pruebas/contenido.test.ts`.
 *   Aquí se usa la Evaluación `parcial-1` de `materia-a` (activa por D-13: habilidades `potencia` y `cadena`, candidatas P1 a P5; P6
 *   está retirada y P7 es un borrador) y, cuando una prueba lo necesita, se activa a mano `parcial-2` (acumulativa) o `examen-final`
 *   de `materia-b` (que trae de prerrequisito `materia-a/potencia`).
 * - Física II tal como está en `contenido/fisica-2` (`ZZDG-0003`): el banco real, con su Evaluación activa por cobertura.
 *
 * Los códigos se cambian en memoria (los archivos no se tocan) y llevan un prefijo propio, distinto del `ZZPR` de `banco.test.ts`:
 * así un borrado de aquí no pisa el de esa suite. `fileParallelism: false` evita que corran a la vez.
 */

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const EJEMPLO = join(RAIZ, "pruebas", "banco-ejemplo");
const FISICA_II = join(RAIZ, "contenido", "fisica-2");

/** Las materias de estos bancos, por el código que les da la base. */
export const CODIGO_A = "ZZDG-0001";
export const CODIGO_B = "ZZDG-0002";
export const CODIGO_FISICA_II = "ZZDG-0003";

const SOLO_REVISADAS: OpcionesCarga = { borradores: false };
const CON_BORRADORES: OpcionesCarga = { borradores: true };

function archivosDe(carpeta: string, prefijo: string): ArchivoBanco[] {
  const archivos: ArchivoBanco[] = [];
  const recorrer = (actual: string) => {
    for (const nombre of readdirSync(actual)) {
      const ruta = join(actual, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else archivos.push({ ruta: `${prefijo}${relative(carpeta, ruta).replaceAll("\\", "/")}`, texto: readFileSync(ruta, "utf8") });
    }
  };
  recorrer(carpeta);
  return archivos;
}

function analizar(archivos: ArchivoBanco[], cambios: [string, string][]): Banco {
  // Un cambio que no encuentra su texto no hace nada y la prueba que lo pidió probaría otra cosa: falla.
  for (const [de] of cambios) {
    if (!archivos.some((archivo) => archivo.texto.includes(de))) throw new Error(`El cambio al banco de prueba no encontró su texto: ${de}`);
  }
  const cambiados = archivos.map((archivo) => ({
    ...archivo,
    texto: cambios.reduce((texto, [de, a]) => texto.replaceAll(de, a), archivo.texto),
  }));
  const resultado = analizarBanco(cambiados);
  if (resultado.errores.length > 0) {
    throw new Error(`El banco de prueba no es válido:\n${resultado.errores.map((e) => `${e.archivo}:${e.linea}  ${e.mensaje}`).join("\n")}`);
  }
  return resultado.banco;
}

/**
 * El banco de ejemplo (materia-a y materia-b) con los códigos `ZZDG-0001` y `ZZDG-0002`. `cambios` son reemplazos de texto en
 * memoria, para las pruebas que necesitan un banco con otra forma (los archivos del ejemplo no se tocan).
 */
export function bancoDeEjemplo(cambios: [string, string][] = []): Banco {
  return analizar(archivosDe(EJEMPLO, ""), [
    ["ZZPR-0001", CODIGO_A],
    ["ZZPR-0002", CODIGO_B],
    ...cambios,
  ]);
}

/** Física II del contenido real, con el código `ZZDG-0003`. Su carpeta es `fisica-2`. */
export function bancoDeFisicaII(): Banco {
  return analizar(archivosDe(FISICA_II, "fisica-2/"), [["FISI-1019", CODIGO_FISICA_II]]);
}

/**
 * Borra los bancos de prueba. Primero los diagnósticos de esas materias (`diagnostico_evaluacion_fk` no tiene cascada: con uno
 * terminado el `delete from evaluacion` falla con 23503) y las evaluaciones (su llave a materia tampoco cae en cascada). El
 * diagnóstico en curso se va en cascada con la Evaluación, y el resto del banco con la materia.
 */
export async function borrarBancoDePrueba(bd: pg.ClientBase): Promise<void> {
  const materias = "select id from public.materia where codigo like 'ZZDG-%'";
  await bd.query(`delete from public.diagnostico where id_materia in (${materias})`);
  await bd.query(`delete from public.evaluacion where id_materia in (${materias})`);
  await bd.query("delete from public.materia where codigo like 'ZZDG-%'");
}

/** Deja la base con el banco de ejemplo (y, si se pide, Física II) y nada más de los bancos de prueba. */
export async function cargarBancoDePrueba(
  bd: pg.Client,
  opciones: { borradores?: boolean; fisicaII?: boolean; cambiosAlEjemplo?: [string, string][] } = {},
): Promise<{ ejemplo: Banco; fisicaII: Banco | null }> {
  await borrarBancoDePrueba(bd);
  const ejemplo = bancoDeEjemplo(opciones.cambiosAlEjemplo);
  await cargarBanco(bd, ejemplo, opciones.borradores ? CON_BORRADORES : SOLO_REVISADAS);
  const fisicaII = opciones.fisicaII ? bancoDeFisicaII() : null;
  if (fisicaII) await cargarBanco(bd, fisicaII, SOLO_REVISADAS);
  return { ejemplo, fisicaII };
}

/** El id de una Evaluación de un banco de prueba, por el código de su materia y su clave. */
export async function idDeEvaluacion(bd: pg.ClientBase, codigoMateria: string, clave: string): Promise<string> {
  const { rows } = await bd.query<{ id: string }>(
    "select e.id from public.evaluacion e join public.materia m on m.id = e.id_materia where m.codigo = $1 and e.clave = $2",
    [codigoMateria, clave],
  );
  if (rows.length !== 1) throw new Error(`No encontré la Evaluación ${codigoMateria}/${clave} en la base.`);
  return rows[0].id;
}

/** El id de una materia de un banco de prueba. */
export async function idDeMateria(bd: pg.ClientBase, codigo: string): Promise<string> {
  const { rows } = await bd.query<{ id: string }>("select id from public.materia where codigo = $1", [codigo]);
  if (rows.length !== 1) throw new Error(`No encontré la materia ${codigo} en la base.`);
  return rows[0].id;
}

/** Activa a mano una Evaluación que el cargador dejó inactiva por cobertura (el ejemplo solo cubre `parcial-1`). */
export async function activarEvaluacion(bd: pg.ClientBase, codigoMateria: string, clave: string): Promise<string> {
  const id = await idDeEvaluacion(bd, codigoMateria, clave);
  await bd.query("update public.evaluacion set activa = true where id = $1", [id]);
  return id;
}
