import { afterEach, describe, expect, it, vi } from "vitest";

// HU-080: si el reporte llega con el formulario abierto, calificar devuelve `con_reporte` tal cual.
const { registrarResena } = vi.hoisted(() => ({ registrarResena: vi.fn() }));
vi.mock("@/lib/resenas/servidor", () => ({ registrarResena }));

import { calificar, type EstadoResena } from "./acciones";
import { MENSAJE_CON_REPORTE } from "./FormularioResena";

const TOKEN = "d".repeat(64);
const anterior: EstadoResena = { resultado: "pendiente", error: null, valores: { calificacion: "", comentario: "" } };

afterEach(() => registrarResena.mockReset());

describe("calificar (HU-080)", () => {
  it("devuelve con_reporte y conserva lo escrito", async () => {
    registrarResena.mockResolvedValue("con_reporte");
    const datos = new FormData();
    datos.set("token", TOKEN);
    datos.set("calificacion", "4");
    datos.set("comentario", "Bien");
    const estado = await calificar(anterior, datos);
    expect(estado).toEqual({ resultado: "con_reporte", error: null, valores: { calificacion: "4", comentario: "Bien" } });
    expect(registrarResena).toHaveBeenCalledWith(TOKEN, 4, "Bien");
  });

  it("el mensaje es el texto acordado", () => {
    expect(MENSAJE_CON_REPORTE).toBe(
      "Reportaste que el monitor no asistió. Mientras el reporte esté en revisión, o si lo aceptamos, esta monitoría no se puede calificar.",
    );
  });
});
