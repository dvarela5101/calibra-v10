// Verifica la base local de Supabase (HU-002):
//   1. Vuelve a aplicar cada migración sobre la base que ya la tiene: deben ser idempotentes.
//   2. Corre las pruebas pgTAP de supabase/tests (restricciones y políticas).
//
// Requiere la base local corriendo con las migraciones aplicadas (npm run db:reiniciar).
// Nunca apunta al proyecto real: la URL por defecto es la de `supabase db start`.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CARPETA = join(import.meta.dirname, "..", "supabase", "migrations");

if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) {
  console.error(`SUPABASE_DB_URL no es local (${URL_BD}). Este script solo corre contra la base local.`);
  process.exit(1);
}

const cliente = new pg.Client({ connectionString: URL_BD });
await cliente.connect();

let fallas = 0;
for (const archivo of readdirSync(CARPETA).filter((a) => a.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(CARPETA, archivo), "utf8");
  try {
    await cliente.query("begin");
    await cliente.query(sql);
    await cliente.query("commit");
    console.log(`✓ reaplicada ${archivo}`);
  } catch (error) {
    await cliente.query("rollback");
    fallas++;
    console.error(`✗ ${archivo} falla al reaplicarse: ${error.message}`);
  }
}
await cliente.end();

if (fallas > 0) process.exit(1);

const pruebas = spawnSync("npx", ["supabase", "test", "db"], { stdio: "inherit", shell: true });
process.exit(pruebas.status ?? 1);
