import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cuerpoDe, TOPE_DEL_CUERPO_MS } from "./cuerpo-de-respuesta";

// HU-011: el vigilante de respuestas de la e2e de la portada no puede quedarse esperando el cuerpo de una petición que una recarga
// cortó. Falló una vez en `movil`: tres cuerpos de prefetch no llegaron ni fallaron y la prueba esperó sus tres minutos.

describe("cuerpoDe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("un cuerpo que nunca llega (la petición la cortó una recarga) se descarta al vencer el tope", async () => {
    const respuesta = { text: () => new Promise<string>(() => undefined) };
    const cuerpo = cuerpoDe(respuesta);
    let listo = false;
    void cuerpo.then(() => (listo = true));
    await vi.advanceTimersByTimeAsync(TOPE_DEL_CUERPO_MS - 1);
    expect(listo, "a un milisegundo del tope todavía espera").toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await cuerpo).toBe("");
  });

  it("un cuerpo que llega a tiempo es el que llegó, y no deja ningún temporizador vivo", async () => {
    expect(await cuerpoDe({ text: async () => "<h1>Tu último diagnóstico</h1>" })).toBe("<h1>Tu último diagnóstico</h1>");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uno que llega justo antes del tope todavía cuenta", async () => {
    const cuerpo = cuerpoDe({ text: () => new Promise((resolver) => setTimeout(() => resolver("a tiempo"), TOPE_DEL_CUERPO_MS - 1)) });
    await vi.advanceTimersByTimeAsync(TOPE_DEL_CUERPO_MS - 1);
    expect(await cuerpo).toBe("a tiempo");
  });

  it("uno que llega después del tope ya se descartó", async () => {
    const cuerpo = cuerpoDe({ text: () => new Promise((resolver) => setTimeout(() => resolver("tarde"), TOPE_DEL_CUERPO_MS + 1)) });
    await vi.advanceTimersByTimeAsync(TOPE_DEL_CUERPO_MS + 1);
    expect(await cuerpo).toBe("");
  });

  it("un cuerpo que falla («No resource with given identifier») se descarta sin lanzar, y tampoco deja temporizador", async () => {
    const respuesta = { text: () => Promise.reject(new Error("Protocol error (Network.getResponseBody): No resource with given identifier found")) };
    expect(await cuerpoDe(respuesta)).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("el tope es corto frente al timeout de la prueba, pero largo para un cuerpo sano", () => {
    expect(TOPE_DEL_CUERPO_MS).toBeGreaterThanOrEqual(3_000);
    expect(TOPE_DEL_CUERPO_MS).toBeLessThanOrEqual(10_000);
  });
});
