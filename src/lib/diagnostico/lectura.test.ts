import { describe, expect, it, vi } from "vitest";
import { FILA_DE_EJEMPLO, GUARDADO_DE_EJEMPLO } from "../../../pruebas/diagnostico-sembrado";
import { leerMiDiagnostico, type ClienteDeLectura } from "./lectura";
import { ErrorDeResultadoGuardado, proyectarResultado } from "./mostrar";

// HU-009: la lectura del resultado con el cliente de la sesión de quien visita. Quién es el dueño lo decide la base
// (`public.mi_diagnostico`, pgTAP); aquí se fija lo que la aplicación hace con lo que responde.

const ID = FILA_DE_EJEMPLO.id_diagnostico;

function clienteQueResponde(respuesta: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(respuesta);
  return { cliente: { rpc } as unknown as ClienteDeLectura, rpc };
}

describe("leerMiDiagnostico", () => {
  it("llama a mi_diagnostico con el id, y solo con el id: el dueño sale de la sesión en la base", async () => {
    const { cliente, rpc } = clienteQueResponde({ data: [FILA_DE_EJEMPLO], error: null });
    await leerMiDiagnostico(cliente, ID);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("mi_diagnostico", { p_id: ID });
  });

  it("devuelve la proyección de la fila", async () => {
    const { cliente } = clienteQueResponde({ data: [FILA_DE_EJEMPLO], error: null });
    expect(await leerMiDiagnostico(cliente, ID)).toEqual(proyectarResultado(FILA_DE_EJEMPLO));
  });

  it("sin filas (no existe, no es suyo o es del equipo) devuelve null", async () => {
    expect(await leerMiDiagnostico(clienteQueResponde({ data: [], error: null }).cliente, ID)).toBeNull();
    expect(await leerMiDiagnostico(clienteQueResponde({ data: null, error: null }).cliente, ID)).toBeNull();
  });

  it("un error de la base lanza con solo el código: nada de message, details ni hint", async () => {
    const { cliente } = clienteQueResponde({
      data: null,
      error: { code: "42501", message: "MENSAJE-SECRETO", details: "DETALLE-SECRETO", hint: "PISTA-SECRETA" },
    });
    const error = await leerMiDiagnostico(cliente, ID).then(
      () => null,
      (fallo: unknown) => fallo as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("42501");
    for (const secreto of ["MENSAJE-SECRETO", "DETALLE-SECRETO", "PISTA-SECRETA"]) expect(error?.message).not.toContain(secreto);
  });

  it("un error sin código lo dice", async () => {
    const { cliente } = clienteQueResponde({ data: null, error: { message: "x" } });
    await expect(leerMiDiagnostico(cliente, ID)).rejects.toThrow("sin código");
  });

  it("un resultado guardado que no cuadra lanza ErrorDeResultadoGuardado, y no llega a la pantalla", async () => {
    const corrupta = { ...FILA_DE_EJEMPLO, aciertos: 99 };
    await expect(leerMiDiagnostico(clienteQueResponde({ data: [corrupta], error: null }).cliente, ID)).rejects.toThrow(ErrorDeResultadoGuardado);
    const sinListas = { ...FILA_DE_EJEMPLO, resultado: { ...GUARDADO_DE_EJEMPLO, errores: null } };
    await expect(leerMiDiagnostico(clienteQueResponde({ data: [sinListas], error: null }).cliente, ID)).rejects.toThrow(ErrorDeResultadoGuardado);
  });
});
