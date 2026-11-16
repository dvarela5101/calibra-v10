import type { MetadataRoute } from "next";
import { urlAbsoluta } from "@/lib/sitio";

/**
 * HU-135: lo público se indexa; lo privado (paneles, citas, reembolsos, cuentas, resultados, reservas, enlaces con token e
 * invitaciones) no. `noindex` en cada página es la garantía; esto solo evita que el buscador las rastree.
 */
export const RUTAS_EXCLUIDAS = [
  "/admin",
  "/monitor",
  "/api",
  "/cita",
  "/reembolso",
  "/cuenta",
  "/auth",
  "/resultados",
  "/diagnostico/resultado",
  "/agendar/reserva",
  "/contacto/verificar",
  "/resena",
  "/admins/registro",
  "/monitores/registro",
];

export default function robots(): MetadataRoute.Robots {
  const sitemap = urlAbsoluta("/sitemap.xml");
  return {
    rules: { userAgent: "*", allow: "/", disallow: RUTAS_EXCLUIDAS },
    ...(sitemap ? { sitemap } : {}),
  };
}
