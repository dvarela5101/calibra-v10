import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "./sitemap";

// HU-135: el sitemap lista solo las cinco páginas públicas estables, con la dirección pública del sitio.

afterEach(() => vi.unstubAllEnvs());

describe("sitemap", () => {
  it("lista solo las páginas públicas", () => {
    vi.stubEnv("SITIO_URL", "https://calibra.example");
    expect(sitemap().map((x) => x.url)).toEqual([
      "https://calibra.example/",
      "https://calibra.example/diagnostico",
      "https://calibra.example/monitores",
      "https://calibra.example/quiero-ser-monitor",
      "https://calibra.example/privacidad",
    ]);
  });

  it("ignora una barra final en SITIO_URL", () => {
    vi.stubEnv("SITIO_URL", "https://calibra.example/");
    expect(sitemap()[1].url).toBe("https://calibra.example/diagnostico");
  });

  it("en producción sin SITIO_URL queda vacío en vez de apuntar a localhost", () => {
    vi.stubEnv("SITIO_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(sitemap()).toEqual([]);
  });
});
