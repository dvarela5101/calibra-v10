import { afterEach, describe, expect, it, vi } from "vitest";
import robots, { RUTAS_EXCLUIDAS } from "./robots";

// HU-135: lo que `/robots.txt` deja rastrear y lo que no, y que apunte al sitemap con la dirección pública.

afterEach(() => vi.unstubAllEnvs());

describe("robots", () => {
  it("permite todo lo público y excluye lo privado", () => {
    vi.stubEnv("SITIO_URL", "https://calibra.example");
    const { rules } = robots();
    expect(rules).toEqual({ userAgent: "*", allow: "/", disallow: RUTAS_EXCLUIDAS });
    for (const ruta of [
      "/admin", "/monitor", "/api", "/cita", "/reembolso", "/cuenta", "/auth", "/resultados", "/diagnostico/resultado",
      "/agendar/reserva", "/contacto/verificar", "/resena", "/admins/registro", "/monitores/registro",
    ]) {
      expect(RUTAS_EXCLUIDAS).toContain(ruta);
    }
  });

  it("no excluye ninguna página del sitemap", () => {
    for (const ruta of ["/", "/diagnostico", "/monitores", "/quiero-ser-monitor", "/privacidad"]) {
      expect(RUTAS_EXCLUIDAS.some((x) => ruta === x || ruta.startsWith(`${x}/`))).toBe(false);
    }
  });

  it("apunta al sitemap con la dirección de SITIO_URL", () => {
    vi.stubEnv("SITIO_URL", "https://calibra.example");
    expect(robots().sitemap).toBe("https://calibra.example/sitemap.xml");
  });

  it("en producción sin SITIO_URL omite el sitemap en vez de inventar una dirección", () => {
    vi.stubEnv("SITIO_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(robots().sitemap).toBeUndefined();
  });
});
