import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPERA_DEL_SCRIPT_MS, ESPERA_DEL_TOKEN_MS, URL_SCRIPT, llaveDeSitioTurnstile } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("llaveDeSitioTurnstile", () => {
  it("devuelve la llave configurada", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000BB");
    expect(llaveDeSitioTurnstile()).toBe("1x00000000000000000000BB");
  });

  it("recorta los espacios alrededor", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "  1x00000000000000000000BB \n");
    expect(llaveDeSitioTurnstile()).toBe("1x00000000000000000000BB");
  });

  it("en blanco o solo con espacios es null", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(llaveDeSitioTurnstile()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "   ");
    expect(llaveDeSitioTurnstile()).toBeNull();
  });

  it("ausente es null", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);
    expect(llaveDeSitioTurnstile()).toBeNull();
  });
});

describe("constantes", () => {
  it("el script va en modo explícito y los plazos son los del plan", () => {
    expect(URL_SCRIPT).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    expect(ESPERA_DEL_SCRIPT_MS).toBe(10_000);
    expect(ESPERA_DEL_TOKEN_MS).toBe(20_000);
  });
});
