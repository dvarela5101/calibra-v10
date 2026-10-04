import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESPERA_DEL_TOKEN_MS } from "./config";
import { crearEsperaDeToken } from "./esperaDeToken";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Espera una promesa que ya debería estar resuelta, sin adelantar el reloj. */
async function resultado<T>(promesa: Promise<T>): Promise<T | "pendiente"> {
  return Promise.race([promesa, Promise.resolve("pendiente" as const)]);
}

describe("crearEsperaDeToken", () => {
  it("el plazo por defecto es el de config (20 s)", async () => {
    const espera = crearEsperaDeToken();
    const promesa = espera.esperar();
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_TOKEN_MS - 1);
    expect(await resultado(promesa)).toBe("pendiente");
    await vi.advanceTimersByTimeAsync(1);
    expect(await promesa).toBe("");
  });

  it("con token ya guardado responde de inmediato", async () => {
    const espera = crearEsperaDeToken(1000);
    espera.poner("abc");
    expect(espera.leer()).toBe("abc");
    expect(await espera.esperar()).toBe("abc");
  });

  it("espera a que llegue el token y entrega ese", async () => {
    const espera = crearEsperaDeToken(1000);
    const promesa = espera.esperar();
    expect(await resultado(promesa)).toBe("pendiente");
    espera.poner("nuevo");
    expect(await promesa).toBe("nuevo");
  });

  it("si el token no llega en el plazo responde vacío, sin marcar fallo", async () => {
    const espera = crearEsperaDeToken(1000);
    const promesa = espera.esperar();
    await vi.advanceTimersByTimeAsync(999);
    expect(await resultado(promesa)).toBe("pendiente");
    await vi.advanceTimersByTimeAsync(1);
    expect(await promesa).toBe("");
    expect(espera.hayFallo()).toBe(false);
    // Otro envío vuelve a esperar con plazo completo.
    const otra = espera.esperar();
    await vi.advanceTimersByTimeAsync(999);
    expect(await resultado(otra)).toBe("pendiente");
  });

  it("un token que llega a tiempo no deja un temporizador vivo", async () => {
    const espera = crearEsperaDeToken(1000);
    const promesa = espera.esperar();
    espera.poner("t");
    await promesa;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("varias esperas a la vez comparten la misma promesa", async () => {
    const espera = crearEsperaDeToken(1000);
    const a = espera.esperar();
    const b = espera.esperar();
    expect(a).toBe(b);
    espera.poner("t");
    expect(await Promise.all([a, b])).toEqual(["t", "t"]);
  });

  describe("fallo del widget", () => {
    it("despierta a quien esperaba con vacío, sin dejarlo los 20 s", async () => {
      const espera = crearEsperaDeToken(1000);
      const promesa = espera.esperar();
      espera.fallar();
      expect(await promesa).toBe("");
      expect(espera.hayFallo()).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("con fallo, esperar responde vacío de inmediato", async () => {
      const espera = crearEsperaDeToken(1000);
      espera.fallar();
      expect(await espera.esperar()).toBe("");
    });

    it("un token nuevo borra el fallo", async () => {
      const espera = crearEsperaDeToken(1000);
      espera.fallar();
      espera.poner("t");
      expect(espera.hayFallo()).toBe(false);
      expect(await espera.esperar()).toBe("t");
    });

    it("fallar descarta el token que hubiera", () => {
      const espera = crearEsperaDeToken(1000);
      espera.poner("t");
      espera.fallar();
      expect(espera.leer()).toBe("");
    });
  });

  describe("token gastado o vencido", () => {
    it("vaciar quita el token y no marca fallo: el siguiente envío espera el nuevo", async () => {
      const espera = crearEsperaDeToken(1000);
      espera.poner("viejo");
      espera.vaciar();
      expect(espera.leer()).toBe("");
      expect(espera.hayFallo()).toBe(false);
      const promesa = espera.esperar();
      expect(await resultado(promesa)).toBe("pendiente");
      espera.poner("nuevo");
      expect(await promesa).toBe("nuevo");
    });
  });

  describe("modo interactivo", () => {
    it("el plazo no corre mientras la persona resuelve la casilla", async () => {
      const espera = crearEsperaDeToken(1000);
      const promesa = espera.esperar();
      espera.interactivo(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await resultado(promesa)).toBe("pendiente");
      espera.poner("t");
      expect(await promesa).toBe("t");
    });

    it("retoma con lo que quedaba, no con el plazo entero", async () => {
      const espera = crearEsperaDeToken(1000);
      const promesa = espera.esperar();
      await vi.advanceTimersByTimeAsync(400);
      espera.interactivo(true);
      await vi.advanceTimersByTimeAsync(30_000);
      espera.interactivo(false);
      await vi.advanceTimersByTimeAsync(599);
      expect(await resultado(promesa)).toBe("pendiente");
      await vi.advanceTimersByTimeAsync(1);
      expect(await promesa).toBe("");
    });

    it("una espera que empieza con el widget ya interactivo no arma el plazo", async () => {
      const espera = crearEsperaDeToken(1000);
      espera.interactivo(true);
      const promesa = espera.esperar();
      await vi.advanceTimersByTimeAsync(5000);
      expect(await resultado(promesa)).toBe("pendiente");
      espera.interactivo(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await promesa).toBe("");
    });

    it("dejar de pedir interacción sin haberla pedido no reinicia el plazo", async () => {
      const espera = crearEsperaDeToken(1000);
      const promesa = espera.esperar();
      await vi.advanceTimersByTimeAsync(600);
      espera.interactivo(false);
      await vi.advanceTimersByTimeAsync(400);
      expect(await promesa).toBe("");
    });
  });
});
