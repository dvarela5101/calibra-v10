import { afterEach, describe, expect, it, vi } from "vitest";

// HU-076: la ruta solo se abre con el secreto del proceso programado. Sin base: el procesador es un doble.

const procesar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/avisos-rechazo", () => ({ procesarAvisosDeRechazoDePago: procesar }));

import { POST, maxDuration } from "./route";

const SECRETO = "s".repeat(40);
const pedir = (autorizacion?: string) =>
  POST(new Request("https://calibra.test/api/procesos/avisar-rechazos", { method: "POST", headers: autorizacion ? { authorization: autorizacion } : {} }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  procesar.mockReset();
});

describe("POST /api/procesos/avisar-rechazos (HU-076)", () => {
  it("sin el secreto responde 401 sin decir más y sin procesar nada", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    for (const respuesta of [await pedir(), await pedir("Bearer otro"), await pedir(SECRETO), await pedir(`Bearer ${SECRETO}x`)]) {
      expect(respuesta.status).toBe(401);
      expect(await respuesta.json()).toEqual({ error: "No autorizado." });
    }
    expect(procesar).not.toHaveBeenCalled();
  });

  it("si el servidor no tiene CRON_SECRETO nadie pasa", async () => {
    vi.stubEnv("CRON_SECRETO", "");
    expect((await pedir(`Bearer ${SECRETO}`)).status).toBe(401);
    expect(procesar).not.toHaveBeenCalled();
  });

  it("con el secreto corre el procesador y devuelve su resumen", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    const resumen = { revisadas: 1, enviadas: 1, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 };
    procesar.mockResolvedValue(resumen);
    const respuesta = await pedir(`Bearer ${SECRETO}`);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual(resumen);
    expect(procesar).toHaveBeenCalledOnce();
  });

  it("si el procesador falla responde 500 genérico, sin repetir el error", async () => {
    vi.stubEnv("CRON_SECRETO", SECRETO);
    vi.spyOn(console, "error").mockImplementation(() => {});
    procesar.mockRejectedValue(new Error("detalle interno con ana@calibra.test"));
    const respuesta = await pedir(`Bearer ${SECRETO}`);
    expect(respuesta.status).toBe(500);
    expect(await respuesta.json()).toEqual({ error: "No se pudo avisar." });
  });

  it("tiene el mismo límite de 60 s que las demás rutas de avisos", () => {
    expect(maxDuration).toBe(60);
  });
});
