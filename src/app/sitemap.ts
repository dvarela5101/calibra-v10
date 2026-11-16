import type { MetadataRoute } from "next";
import { urlAbsoluta } from "@/lib/sitio";

/** HU-135: solo las páginas públicas y estables. Nada con token, sesión o datos de una persona. */
export const RUTAS_PUBLICAS = ["/", "/diagnostico", "/monitores", "/quiero-ser-monitor", "/privacidad"];

export default function sitemap(): MetadataRoute.Sitemap {
  return RUTAS_PUBLICAS.flatMap((ruta) => {
    const url = urlAbsoluta(ruta);
    return url ? [{ url }] : [];
  });
}
