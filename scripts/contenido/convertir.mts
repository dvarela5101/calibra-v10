// Convertidor del banco de preguntas (HU-005): valida contenido/ e imprime conteos y cobertura.
//
//   node scripts/contenido/convertir.mts [--dry-run] [--borradores] [--banco <ruta>] [--nube]
//
// Siempre valida e imprime el reporte; con errores sale con 1 y nunca carga.
// --dry-run no abre ninguna conexión: es lo que corre el CI (npm run contenido:validar).
// --borradores cuenta (y cargará) también las preguntas en borrador; las retiradas nunca.
// --banco cambia la carpeta del banco (por defecto, contenido/ en la raíz del repo).
//
// Sin --dry-run carga en la base LOCAL (cargar.mts, SUPABASE_DB_URL) y compara lo que quedó en la base con
// los conteos del dry-run: si difieren, sale con 1.
// --nube (HU-103) es la única forma de cargar fuera de la base local: el proyecto nuevo de v10 el día del corte
// (HU-057, D-72 a). Pide SUPABASE_DB_URL y el certificado del proyecto en SUPABASE_DB_CA, solo carga revisadas
// y nunca acepta el proyecto del prototipo (decidirConexion).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { contar, formatearReporte, leerBanco, TABLAS } from "./banco.mts";
import { cargarBanco } from "./cargar.mts";
import type { ResultadoCarga } from "./cargar.mts";
import type { Conteos } from "./modelo.mts";

const USO = "Uso: node scripts/contenido/convertir.mts [--dry-run] [--borradores] [--banco <ruta>] [--nube]";
const BANCO_POR_DEFECTO = join(import.meta.dirname, "..", "..", "contenido");
const URL_BD_LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** El proyecto Supabase del prototipo: nunca se le escribe (CLAUDE.md, D-72 a). */
export const REF_DEL_PROTOTIPO = "uotlhaitdkfroavqkvee";

export interface Argumentos {
  dryRun: boolean;
  borradores: boolean;
  banco: string;
  nube: boolean;
}

export type Conexion =
  | { permitida: true; url: string; destino: string; nube: boolean }
  | { permitida: false; motivo: string };

const esLocal = (url: string) => /@(127\.0\.0\.1|localhost):/.test(url);

/** El host y el puerto de una URL de Postgres, sin usuario ni contraseña. */
function destinoDe(url: string): string {
  try {
    const { hostname, port } = new URL(url);
    return port ? `${hostname}:${port}` : hostname;
  } catch {
    return "(URL ilegible)";
  }
}

/**
 * A qué base se puede cargar (HU-103). Sin --nube, solo a la local, como siempre. Con --nube, a cualquier otra
 * base menos el proyecto del prototipo, sin borradores. La URL del resultado viene sin `sslmode` ni `sslrootcert`:
 * si los trajera, pg los usaría en lugar del TLS de `opcionesTls`. Ningún motivo incluye la contraseña.
 */
export function decidirConexion(urlDeEntorno: string | undefined, opciones: { nube: boolean; borradores: boolean }): Conexion {
  const url = urlDeEntorno?.trim() || undefined;
  if (url && url.toLowerCase().includes(REF_DEL_PROTOTIPO)) {
    return { permitida: false, motivo: `SUPABASE_DB_URL apunta al proyecto del prototipo (${REF_DEL_PROTOTIPO}), que nunca se toca (D-72 a).` };
  }
  if (!opciones.nube) {
    const local = url ?? URL_BD_LOCAL;
    if (!esLocal(local)) {
      return { permitida: false, motivo: "SUPABASE_DB_URL no apunta a la base local (127.0.0.1 o localhost): sin --nube la carga solo corre contra la base local." };
    }
    return { permitida: true, url: local, destino: destinoDe(local), nube: false };
  }
  if (!url) return { permitida: false, motivo: "--nube necesita SUPABASE_DB_URL con la cadena de conexión del proyecto nuevo." };
  if (esLocal(url)) return { permitida: false, motivo: "--nube es para la base de la nube, y SUPABASE_DB_URL es la local: quita --nube." };
  if (opciones.borradores) return { permitida: false, motivo: "--nube no acepta --borradores: a la nube solo llegan preguntas revisadas." };
  let limpia: URL;
  try {
    limpia = new URL(url);
  } catch {
    return { permitida: false, motivo: "SUPABASE_DB_URL no es una URL de Postgres válida." };
  }
  if (limpia.protocol !== "postgresql:" && limpia.protocol !== "postgres:") {
    return { permitida: false, motivo: "SUPABASE_DB_URL no es una URL de Postgres (postgresql://…)." };
  }
  for (const parametro of ["sslmode", "sslrootcert", "sslcert", "sslkey", "ssl"]) limpia.searchParams.delete(parametro);
  return { permitida: true, url: limpia.toString(), destino: destinoDe(url), nube: true };
}

/** El TLS de la conexión a la nube: verifica el servidor con el certificado del proyecto (`SUPABASE_DB_CA`). */
export function opcionesTls(ca: string | undefined): { ssl: { ca: string; rejectUnauthorized: true } } | string {
  if (!ca?.trim()) return "--nube necesita SUPABASE_DB_CA con la ruta del certificado del proyecto (panel de Supabase, Database, SSL Configuration).";
  if (!existsSync(ca) || !statSync(ca).isFile()) return `No encuentro el certificado de SUPABASE_DB_CA: ${ca}`;
  return { ssl: { ca: readFileSync(ca, "utf8"), rejectUnauthorized: true } };
}

/** Lee los argumentos de la línea de comandos. Devuelve un texto si hay uno que no entiende. */
export function leerArgumentos(argv: string[]): Argumentos | string {
  const argumentos: Argumentos = { dryRun: false, borradores: false, banco: BANCO_POR_DEFECTO, nube: false };
  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i];
    if (argumento === "--dry-run") argumentos.dryRun = true;
    else if (argumento === "--borradores") argumentos.borradores = true;
    else if (argumento === "--nube") argumentos.nube = true;
    else if (argumento === "--banco") {
      const ruta = argv[i + 1];
      if (!ruta || ruta.startsWith("--")) return "Falta la ruta después de --banco.";
      argumentos.banco = resolve(ruta);
      i += 1;
    } else return `No entiendo el argumento "${argumento}".`;
  }
  return argumentos;
}

/** Corre el convertidor y devuelve el código de salida. */
export async function principal(argv: string[]): Promise<number> {
  const argumentos = leerArgumentos(argv);
  if (typeof argumentos === "string") {
    console.error(`${argumentos}\n${USO}`);
    return 1;
  }
  if (!existsSync(argumentos.banco) || !statSync(argumentos.banco).isDirectory()) {
    console.error(`No encuentro la carpeta del banco: ${argumentos.banco}`);
    return 1;
  }

  const resultado = leerBanco(argumentos.banco);
  const opciones = { borradores: argumentos.borradores };
  console.log(formatearReporte(resultado, opciones));
  if (resultado.errores.length > 0) return 1;
  if (argumentos.dryRun) return 0;

  // La barrera: sin --nube solo la base local (como scripts/verificar-bd.mjs); con --nube, el proyecto nuevo y
  // nunca el del prototipo. No se imprime la URL: trae la contraseña.
  const conexion = decidirConexion(process.env.SUPABASE_DB_URL, argumentos);
  if (!conexion.permitida) {
    console.error(`✗ ${conexion.motivo}`);
    return 1;
  }
  let tls = {};
  if (conexion.nube) {
    const opciones = opcionesTls(process.env.SUPABASE_DB_CA);
    if (typeof opciones === "string") {
      console.error(`✗ ${opciones}`);
      return 1;
    }
    tls = opciones;
    console.log(`\nCarga en la nube: ${conexion.destino}, con TLS verificado.`);
  }

  const cliente = new pg.Client({ connectionString: conexion.url, ...tls });
  try {
    await cliente.connect();
  } catch (error) {
    const ayuda = conexion.nube ? "revisa SUPABASE_DB_URL y el certificado" : "¿está corriendo? (npm run db:iniciar)";
    console.error(`✗ no pude conectarme a ${conexion.nube ? conexion.destino : "la base local"} (${mensajeDe(error)}): ${ayuda}`);
    return 1;
  }
  let carga: ResultadoCarga;
  try {
    carga = await cargarBanco(cliente, resultado.banco, opciones);
  } catch (error) {
    console.error(`✗ la carga falló y la base quedó como estaba: ${mensajeDe(error)}`);
    return 1;
  } finally {
    await cliente.end();
  }

  if (carga.avisos.length > 0) {
    console.log(`\nAvisos de la carga (${carga.avisos.length}):`);
    for (const aviso of carga.avisos) console.log(`  ${aviso}`);
  }
  const esperados = contar(resultado.banco, opciones);
  console.log("");
  console.log(compararConteos(esperados, carga.conteos));
  const difieren = (Object.keys(TABLAS) as (keyof Conteos)[]).some((c) => esperados[c] !== carga.conteos[c]);
  console.log("");
  if (difieren) {
    console.error("✗ La base no quedó con los conteos del dry-run: revisa los avisos (filas que sobran en la base).");
    return 1;
  }
  console.log("✓ Banco cargado: la base tiene los conteos del dry-run.");
  return 0;
}

const mensajeDe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Los conteos del dry-run junto a los de la base, marcando las tablas que no coinciden. */
function compararConteos(esperados: Conteos, enBase: Conteos): string {
  const claves = Object.keys(TABLAS) as (keyof Conteos)[];
  const ancho = Math.max(...claves.map((c) => TABLAS[c].length));
  const filas = ["Filas de las materias del banco:", `  ${"".padEnd(ancho)}  dry-run   base`];
  for (const c of claves) {
    const marca = esperados[c] === enBase[c] ? "" : "  ✗ difiere";
    filas.push(`  ${TABLAS[c].padEnd(ancho)}  ${String(esperados[c]).padStart(7)}  ${String(enBase[c]).padStart(5)}${marca}`);
  }
  return filas.join("\n");
}

// Solo cuando se corre como programa, no cuando lo importa una prueba. Se compara la ruta en vez de usar
// import.meta.main, que en Node 23.6 a 24.1 no existe: ahí el script saldría con 0 sin validar nada.
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = await principal(process.argv.slice(2));
}
