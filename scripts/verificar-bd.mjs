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

// Una migración posterior que cambia el tipo de salida de una función tiene que borrarla antes con
// `drop function` (Postgres no deja `create or replace` con otras columnas). Desde entonces la migración
// vieja que la creó ya no se puede reaplicar sobre la base final: chocaría con la función nueva. Esta
// lista dice, por archivo, qué se borra antes de reaplicarla, para volver al estado en que esa migración
// tenía sentido. La migración vieja no se toca (una migración que ya está en `main` no se edita) y la
// última de la cadena deja la base en su estado final. `db reset` ya prueba la cadena completa en orden.
const PREAMBULOS = new Map([
  [
    "20260929054533_plazos_y_comision.sql",
    // HU-063 quitó la comisión de parametros_negocio(): pasó de 13 a 11 columnas.
    "drop function if exists public.parametros_negocio();",
  ],
  [
    "20261001040929_agendar_monitoria.sql",
    // HU-081 renombró diagnostico.resultado_por_tema a resultado_por_habilidad: el grant por columnas de este archivo todavía
    // nombra la columna antigua. Se le devuelve el nombre antiguo antes de reaplicarlo; la migración de HU-081, que es posterior,
    // la renombra otra vez (es idempotente) y deja el grant final.
    "alter table public.diagnostico rename column resultado_por_habilidad to resultado_por_tema;",
  ],
  [
    "20261002064121_confirmacion_cita.sql",
    // HU-029 sumó observaciones_reporte a la salida de la cita (D-37): 20 columnas pasaron a 21 (22 en privado.datos_de_cita).
    [
      "drop function if exists public.cita_por_token(text);",
      "drop function if exists public.mi_cita(uuid);",
      "drop function if exists public.mis_citas();",
      "drop function if exists privado.mi_cita(uuid);",
      "drop function if exists privado.mis_citas();",
      "drop function if exists privado.datos_de_cita(uuid);",
    ].join(" "),
  ],
]);

const cliente = new pg.Client({ connectionString: URL_BD });
await cliente.connect();

let fallas = 0;
for (const archivo of readdirSync(CARPETA).filter((a) => a.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(CARPETA, archivo), "utf8");
  try {
    await cliente.query("begin");
    const preambulo = PREAMBULOS.get(archivo);
    if (preambulo) await cliente.query(preambulo);
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
