// Convertidor del banco de preguntas (HU-005): valida contenido/ e imprime conteos y cobertura.
//
//   node scripts/contenido/convertir.mts [--dry-run] [--borradores] [--banco <ruta>]
//
// Siempre valida e imprime el reporte; con errores sale con 1 y nunca carga.
// --dry-run no abre ninguna conexión: es lo que corre el CI (npm run contenido:validar).
// --borradores cuenta (y cargará) también las preguntas en borrador; las retiradas nunca.
// --banco cambia la carpeta del banco (por defecto, contenido/ en la raíz del repo).
//
// Sin --dry-run carga en la base LOCAL (cargar.mts, SUPABASE_DB_URL) y compara lo que quedó en la base con
// los conteos del dry-run: si difieren, sale con 1. Nunca apunta al proyecto real.
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { contar, formatearReporte, leerBanco, TABLAS } from "./banco.mts";
import { cargarBanco } from "./cargar.mts";
import type { ResultadoCarga } from "./cargar.mts";
import type { Conteos } from "./modelo.mts";

const USO = "Uso: node scripts/contenido/convertir.mts [--dry-run] [--borradores] [--banco <ruta>]";
const BANCO_POR_DEFECTO = join(import.meta.dirname, "..", "..", "contenido");
const URL_BD_LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export interface Argumentos {
  dryRun: boolean;
  borradores: boolean;
  banco: string;
}

/** Lee los argumentos de la línea de comandos. Devuelve un texto si hay uno que no entiende. */
export function leerArgumentos(argv: string[]): Argumentos | string {
  const argumentos: Argumentos = { dryRun: false, borradores: false, banco: BANCO_POR_DEFECTO };
  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i];
    if (argumento === "--dry-run") argumentos.dryRun = true;
    else if (argumento === "--borradores") argumentos.borradores = true;
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

  // La misma barrera de scripts/verificar-bd.mjs: el proyecto real sostiene el prototipo hasta el corte
  // (HU-057) y nadie le escribe. No se imprime la URL: podría traer una contraseña.
  const urlBd = process.env.SUPABASE_DB_URL ?? URL_BD_LOCAL;
  if (!/@(127\.0\.0\.1|localhost):/.test(urlBd)) {
    console.error("✗ SUPABASE_DB_URL no apunta a la base local (127.0.0.1 o localhost): la carga solo corre contra la base local.");
    return 1;
  }

  const cliente = new pg.Client({ connectionString: urlBd });
  try {
    await cliente.connect();
  } catch (error) {
    console.error(`✗ no pude conectarme a la base local (${mensajeDe(error)}): ¿está corriendo? (npm run db:iniciar)`);
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
    console.log(`\nAvisos de la carga (${carga.avisos.length}, lo que está en la base y no en el banco):`);
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
