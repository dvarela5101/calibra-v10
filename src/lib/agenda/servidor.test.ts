import { describe, expect, it, vi } from "vitest";
import { filaDeEjemplo, filaSinDiagnostico } from "../../../pruebas/vista-del-monitor-ejemplo";
import { ErrorDeVistaDelMonitor } from "@/lib/diagnostico/vista-del-monitor";
import { cargarDiagnosticoDeLaCita } from "./servidor";

// HU-022: la lectura del diagnóstico de una cita con la sesión del monitor. Sin base: el cliente es un `rpc` inventado. Qué citas se
// ven y de quién son lo decide la función de la base (pgTAP e integración).

const ID = "5a5a5a5a-0000-4000-8000-000000000022";

/** Un cliente cuyo `rpc` responde lo que se le diga. */
function clienteQueResponde(respuesta: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(respuesta);
  return { rpc, cliente: { rpc } as unknown as Parameters<typeof cargarDiagnosticoDeLaCita>[0] };
}

describe("cargarDiagnosticoDeLaCita", () => {
  it("llama a la función pública con el id de la cita y nada más, y devuelve la vista", async () => {
    const { rpc, cliente } = clienteQueResponde({ data: [filaDeEjemplo()], error: null });
    const vista = await cargarDiagnosticoDeLaCita(cliente, ID);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("diagnostico_de_mi_monitoria", { p_id_monitoria: ID });
    expect(vista?.cita.nombreEstudiante).toBe("Camila Rojas");
    expect(vista?.diagnostico?.respondidas).toBe(8);
  });

  it("una cita visible sin diagnóstico es una vista con `diagnostico` nulo, no un null", async () => {
    const { cliente } = clienteQueResponde({ data: [filaSinDiagnostico()], error: null });
    const vista = await cargarDiagnosticoDeLaCita(cliente, ID);
    expect(vista).not.toBeNull();
    expect(vista?.diagnostico).toBeNull();
  });

  it("sin filas (no existe, no es suya, es grupal o su estado no se ve) es null, igual en todos los casos", async () => {
    for (const data of [[], null]) {
      const { cliente } = clienteQueResponde({ data, error: null });
      expect(await cargarDiagnosticoDeLaCita(cliente, ID)).toBeNull();
    }
  });

  it("un fallo de la base lanza con el código y el mensaje, y nunca con `details` (M51)", async () => {
    const { cliente } = clienteQueResponde({
      data: null,
      error: { code: "42501", message: "permission denied for function", details: "detalle-secreto-del-servidor", hint: "pista-secreta" },
    });
    const error = await cargarDiagnosticoDeLaCita(cliente, ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("42501");
    expect((error as Error).message).toContain("permission denied for function");
    expect((error as Error).message).not.toContain("detalle-secreto-del-servidor");
    expect((error as Error).message).not.toContain("pista-secreta");
  });

  it("un error sin código lo dice", async () => {
    const { cliente } = clienteQueResponde({ data: null, error: { code: "", message: "fallo de red", details: "", hint: "" } });
    await expect(cargarDiagnosticoDeLaCita(cliente, ID)).rejects.toThrow("sin código");
  });

  it("una respuesta que no cuadra lanza ErrorDeVistaDelMonitor, no la devuelve ni la esconde como null", async () => {
    const { cliente } = clienteQueResponde({ data: [filaDeEjemplo({ aciertos: 99 })], error: null });
    await expect(cargarDiagnosticoDeLaCita(cliente, ID)).rejects.toBeInstanceOf(ErrorDeVistaDelMonitor);
  });
});
