import type { NextConfig } from "next";
import { REGLA_DE_CABECERAS } from "./src/config/cabeceras";

const nextConfig: NextConfig = {
  // Entorno y versión del despliegue para el monitoreo del navegador (HU-138). Vercel pone VERCEL_ENV y VERCEL_GIT_COMMIT_SHA al
  // compilar; aquí se copian a variables públicas porque el navegador no ve las del servidor. Sin Vercel quedan vacías.
  env: {
    NEXT_PUBLIC_SENTRY_ENTORNO: process.env.VERCEL_ENV ?? "",
    NEXT_PUBLIC_SENTRY_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
  // Cabeceras de seguridad en toda respuesta (HU-132).
  async headers() {
    return [REGLA_DE_CABECERAS];
  },
};

export default nextConfig;
