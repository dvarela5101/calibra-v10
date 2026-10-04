import { afterEach, describe, expect, it, vi } from "vitest";

// HU-080: leerResenaPorToken y registrarResena aceptan `con_reporte`. El cliente admin es falso: no hay base ni red.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: () => ({ rpc }) }));

import { leerResenaPorToken, registrarResena } from "./servidor";

const TOKEN = "c".repeat(64);

afterEach(() => rpc.mockReset());

describe("con_reporte (HU-080)", () => {
  it("leerResenaPorToken devuelve el estado con_reporte", async () => {
    rpc.mockResolvedValue({
      data: [{ estado: "con_reporte", nombre_monitor: "Camilo", nombre_materia: "Cálculo", inicio: "2026-10-05T15:00:00Z" }],
      error: null,
    });
    expect(await leerResenaPorToken(TOKEN)).toMatchObject({ estado: "con_reporte", nombreMonitor: "Camilo" });
  });

  it("leerResenaPorToken sigue rechazando un estado desconocido", async () => {
    rpc.mockResolvedValue({ data: [{ estado: "otro", nombre_monitor: "", nombre_materia: "", inicio: "2026-10-05T15:00:00Z" }], error: null });
    await expect(leerResenaPorToken(TOKEN)).rejects.toThrow("Estado de reseña desconocido");
  });

  it("registrarResena devuelve con_reporte", async () => {
    rpc.mockResolvedValue({ data: "con_reporte", error: null });
    expect(await registrarResena(TOKEN, 5, null)).toBe("con_reporte");
  });
});
