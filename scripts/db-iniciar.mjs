// `supabase start` con la llave secreta de PRUEBA de Turnstile si no hay otra (HU-058).
// La llave es la que Cloudflare publica para pruebas ("siempre valida"), no un secreto:
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
import { execSync } from "node:child_process";

const SECRETO_DE_PRUEBA = "1x0000000000000000000000000000000AA";
process.env.TURNSTILE_SECRET_KEY ||= SECRETO_DE_PRUEBA;

try {
  execSync(`npx supabase start ${process.argv.slice(2).join(" ")}`, { stdio: "inherit" });
} catch (error) {
  process.exit(error.status ?? 1);
}
