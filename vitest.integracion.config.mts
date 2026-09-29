import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Las llaves del Supabase LOCAL viven en .env.local (las genera `npm run db:env`).
// Si el archivo no existe, las pruebas fallan con un mensaje claro en vez de cargar nada.
const rutaEnv = fileURLToPath(new URL("./.env.local", import.meta.url));
if (existsSync(rutaEnv)) process.loadEnvFile(rutaEnv);

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" lanza fuera de React Server Components; en Node lo dejamos vacío.
      "server-only": fileURLToPath(new URL("./integracion/server-only-vacio.ts", import.meta.url)),
    },
  },
  test: {
    include: ["integracion/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Las pruebas comparten una sola base local: nada de archivos en paralelo.
    fileParallelism: false,
  },
});
