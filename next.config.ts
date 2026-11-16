import type { NextConfig } from "next";
import { REGLA_DE_CABECERAS } from "./src/config/cabeceras";

const nextConfig: NextConfig = {
  // Cabeceras de seguridad en toda respuesta (HU-132).
  async headers() {
    return [REGLA_DE_CABECERAS];
  },
};

export default nextConfig;
