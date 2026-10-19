import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conReintentoDeCaptcha } from "../integracion/utilidades";

// HU-104: el ayudante de las pruebas de integración que repite un pedido a Auth solo cuando Cloudflare no pudo
// verificar el token de prueba (`captcha_failed`). Corre sin Supabase: los pedidos son funciones simuladas.

type Respuesta = { error: { code?: string } | null };

const fallaCaptcha: Respuesta = { error: { code: "captcha_failed" } };
const exito: Respuesta = { error: null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("conReintentoDeCaptcha", () => {
  it("si el primer intento sale bien, no repite ni avisa", async () => {
    const pedir = vi.fn(async () => exito);

    await expect(conReintentoDeCaptcha(pedir)).resolves.toBe(exito);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("si Cloudflare falla una vez, repite, avisa en la consola y devuelve el éxito", async () => {
    const pedir = vi.fn<() => Promise<Respuesta>>().mockResolvedValueOnce(fallaCaptcha).mockResolvedValueOnce(exito);

    const respuesta = conReintentoDeCaptcha(pedir);
    await vi.runAllTimersAsync();

    await expect(respuesta).resolves.toBe(exito);
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("si Cloudflare sigue fallando, se detiene a los 3 intentos y devuelve el último captcha_failed", async () => {
    const pedir = vi.fn(async () => fallaCaptcha);

    const respuesta = conReintentoDeCaptcha(pedir);
    await vi.runAllTimersAsync();

    await expect(respuesta).resolves.toBe(fallaCaptcha);
    expect(pedir).toHaveBeenCalledTimes(3);
  });

  it("cualquier otro error vuelve sin repetir (un usuario baneado no es un fallo de red)", async () => {
    const baneado: Respuesta = { error: { code: "user_banned" } };
    const pedir = vi.fn(async () => baneado);

    await expect(conReintentoDeCaptcha(pedir)).resolves.toBe(baneado);
    expect(pedir).toHaveBeenCalledTimes(1);
  });
});
