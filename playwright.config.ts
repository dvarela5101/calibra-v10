import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Llaves del Supabase local (scripts/env-local.mjs) para las pruebas que crean cuentas.
// No pisa variables que ya vengan del entorno.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PUERTO = 3000;
const enCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/preparacion.ts",
  fullyParallel: true,
  forbidOnly: enCI,
  retries: enCI ? 1 : 0,
  reporter: enCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    locale: "es-CO",
    timezoneId: "America/Bogota",
    trace: "retain-on-failure",
  },
  // channel "chromium" usa el headless nuevo (Chromium completo). En Windows abre
  // páginas en ~5 s contra ~20 s del headless shell, que agotaba el timeout.
  projects: [
    // El prototipo se diseñó y probó a 390x844; se mantiene como caso principal.
    {
      name: "movil",
      use: { ...devices["Desktop Chrome"], channel: "chromium", viewport: { width: 390, height: 844 } },
    },
    {
      name: "escritorio",
      use: { ...devices["Desktop Chrome"], channel: "chromium", viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // En CI se prueba el build de producción (el pipeline corre `npm run build` antes).
    command: enCI ? "npm run start" : "npm run dev",
    url: `http://localhost:${PUERTO}`,
    reuseExistingServer: !enCI,
    timeout: 120_000,
  },
});
