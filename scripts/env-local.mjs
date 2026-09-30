// Escribe .env.local con las llaves del Supabase LOCAL (las que imprime `supabase status`).
// .env.local está en .gitignore. Nunca usa llaves del proyecto real.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const salida = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const estado = JSON.parse(salida.slice(salida.indexOf("{")));

const faltan = ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY"].filter((clave) => !estado[clave]);
if (faltan.length > 0) {
  console.error(`supabase status no trae ${faltan.join(", ")}. ¿Está corriendo? (npm run db:iniciar)`);
  process.exit(1);
}

const contenido = [
  "# Generado por scripts/env-local.mjs desde `supabase status`. Solo para el Supabase local.",
  `NEXT_PUBLIC_SUPABASE_URL=${estado.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${estado.PUBLISHABLE_KEY}`,
  `SUPABASE_SECRET_KEY=${estado.SECRET_KEY}`,
  `MAILPIT_URL=${estado.MAILPIT_URL ?? "http://127.0.0.1:54324"}`,
  // El build de producción (`npm run start`, el que prueba CI) exige SITIO_URL para los enlaces de los correos.
  "SITIO_URL=http://localhost:3000",
  "",
].join("\n");

writeFileSync(join(import.meta.dirname, "..", ".env.local"), contenido);
console.log("✓ .env.local apunta al Supabase local");
