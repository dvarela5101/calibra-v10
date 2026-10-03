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

// HU-018: un QR de prueba que dice que lo es, como URL data: (nada en public/ que se confunda con el QR del
// banco). encodeURIComponent no deja # ni $, que el lector de .env cortaría o expandiría.
const QR_DE_PRUEBA = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">' +
    '<rect x="4" y="4" width="232" height="232" fill="white" stroke="black" stroke-width="8"/>' +
    '<text x="120" y="128" font-family="sans-serif" font-size="24" text-anchor="middle">QR de prueba</text></svg>',
)}`;

const contenido = [
  "# Generado por scripts/env-local.mjs desde `supabase status`. Solo para el Supabase local.",
  `NEXT_PUBLIC_SUPABASE_URL=${estado.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${estado.PUBLISHABLE_KEY}`,
  `SUPABASE_SECRET_KEY=${estado.SECRET_KEY}`,
  `MAILPIT_URL=${estado.MAILPIT_URL ?? "http://127.0.0.1:54324"}`,
  // El build de producción (`npm run start`, el que prueba CI) exige SITIO_URL para los enlaces de los correos.
  "SITIO_URL=http://localhost:3000",
  // Pago por Llave (HU-018): valores de prueba para el build, la integración y la e2e. Los reales van en
  // Vercel en el corte (docs/pendientes-dvarela.md §C).
  "LLAVE_PLATAFORMA=3001234567",
  "LLAVE_PLATAFORMA_TITULAR=Calibra (prueba)",
  `LLAVE_PLATAFORMA_QR_URL=${QR_DE_PRUEBA}`,
  "PROVEEDOR_NOMBRE=Calibra (prueba)",
  "PROVEEDOR_DOCUMENTO=000000000",
  // CAPTCHA (HU-058): llave del sitio de PRUEBA de Cloudflare (widget invisible, siempre valida). Es pública
  // por diseño. La secreta no va aquí: no la lee la app, solo Auth, y la pone `npm run db:iniciar`.
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000BB",
  "",
].join("\n");

writeFileSync(join(import.meta.dirname, "..", ".env.local"), contenido);
console.log("✓ .env.local apunta al Supabase local");
