import { describe, expect, it, vi } from "vitest";
import { FILA_DE_EJEMPLO, GUARDADO_DE_EJEMPLO } from "../../../pruebas/diagnostico-sembrado";
import { leerMiDiagnostico, leerMiUltimoDiagnostico, type ClienteDeLectura } from "./lectura";
import { CLAVES_DEL_RESULTADO, ErrorDeResultadoGuardado, proyectarResultado } from "./mostrar";

// HU-009: la lectura del resultado con el cliente de la sesión de quien visita. Quién es el dueño lo decide la base
// (`public.mi_diagnostico`, pgTAP); aquí se fija lo que la aplicación hace con lo que responde.
// HU-011: la del último diagnóstico de la sesión (`public.mi_ultimo_diagnostico`), con el mismo mapeo y el mismo error.

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

/** Todas las claves de un objeto y de lo que lleva dentro (también dentro de las listas). */
function clavesDe(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(clavesDe);
  if (typeof valor !== "object" || valor === null) return [];
  return Object.entries(valor).flatMap(([clave, dentro]) => [clave, ...clavesDe(dentro)]);
}

describe("leerMiUltimoDiagnostico (HU-011)", () => {
  it("llama a mi_ultimo_diagnostico sin argumentos: el dueño sale de la sesión en la base, no de lo que pase la aplicación", async () => {
    const { cliente, rpc } = clienteQueResponde({ data: [FILA_DE_EJEMPLO], error: null });
    await leerMiUltimoDiagnostico(cliente);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]).toEqual(["mi_ultimo_diagnostico"]);
    expect(rpc.mock.calls[0]).toHaveLength(1);
  });

  it("devuelve la proyección de la fila, la misma que para mi_diagnostico", async () => {
    const { cliente } = clienteQueResponde({ data: [FILA_DE_EJEMPLO], error: null });
    expect(await leerMiUltimoDiagnostico(cliente)).toEqual(proyectarResultado(FILA_DE_EJEMPLO));
  });

  it("devuelve solo claves de CLAVES_DEL_RESULTADO: ni la fila cruda ni las claves internas", async () => {
    const { cliente } = clienteQueResponde({ data: [FILA_DE_EJEMPLO], error: null });
    const resultado = await leerMiUltimoDiagnostico(cliente);
    const claves = clavesDe(resultado);
    expect(claves.length).toBeGreaterThan(10);
    expect(claves.filter((clave) => !CLAVES_DEL_RESULTADO.includes(clave))).toEqual([]);
    expect(JSON.stringify(resultado)).not.toContain("secreta");
  });

  it("si la base devolviera columnas de más (repetido, semilla, token, falta de material), no salen", async () => {
    const deMas = {
      ...FILA_DE_EJEMPLO,
      repetido: true,
      semilla: 3141592653,
      token_recuperacion: "TOKEN-SECRETO",
      falta_material: [{ habilidad: "FALTA-SECRETA", motivos: ["tope_una_respuesta"] }],
      respuestas: [{ clave: "CLAVE-SECRETA" }],
    };
    const { cliente } = clienteQueResponde({ data: [deMas], error: null });
    const salida = JSON.stringify(await leerMiUltimoDiagnostico(cliente));
    for (const sentinela of ["repetido", "3141592653", "TOKEN-SECRETO", "FALTA-SECRETA", "CLAVE-SECRETA", "falta_material", "semilla"]) {
      expect(salida).not.toContain(sentinela);
    }
  });

  it("sin filas (no tiene diagnósticos terminados, o es del equipo) devuelve null", async () => {
    expect(await leerMiUltimoDiagnostico(clienteQueResponde({ data: [], error: null }).cliente)).toBeNull();
    expect(await leerMiUltimoDiagnostico(clienteQueResponde({ data: null, error: null }).cliente)).toBeNull();
  });

  it("un error de la base lanza con solo el código: nada de message, details ni hint, y no se traga como null", async () => {
    const { cliente } = clienteQueResponde({
      data: null,
      error: { code: "42501", message: "MENSAJE-SECRETO", details: "DETALLE-SECRETO", hint: "PISTA-SECRETA" },
    });
    const error = await leerMiUltimoDiagnostico(cliente).then(
      () => null,
      (fallo: unknown) => fallo as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("42501");
    expect(error?.message).toContain("mi_ultimo_diagnostico");
    for (const secreto of ["MENSAJE-SECRETO", "DETALLE-SECRETO", "PISTA-SECRETA"]) expect(error?.message).not.toContain(secreto);
  });

  it("un error sin código lo dice", async () => {
    const { cliente } = clienteQueResponde({ data: null, error: { message: "x" } });
    await expect(leerMiUltimoDiagnostico(cliente)).rejects.toThrow("sin código");
  });

  describe("con una señal para cortar la llamada (el tope de la portada)", () => {
    /** Como el constructor de consultas de PostgREST: `abortSignal` devuelve el mismo y se espera con `await`. */
    function clienteConConstructor(respuesta: { data: unknown; error: unknown }) {
      const consulta = {
        abortSignal: vi.fn((): unknown => consulta),
        then: (cumplir: (valor: unknown) => unknown, rechazar: (razon: unknown) => unknown) => Promise.resolve(respuesta).then(cumplir, rechazar),
      };
      const rpc = vi.fn(() => consulta);
      return { cliente: { rpc } as unknown as ClienteDeLectura, rpc, consulta };
    }

    it("la pasa a abortSignal, una sola vez, y devuelve lo mismo que sin ella", async () => {
      const { cliente, rpc, consulta } = clienteConConstructor({ data: [FILA_DE_EJEMPLO], error: null });
      const senal = new AbortController().signal;
      expect(await leerMiUltimoDiagnostico(cliente, senal)).toEqual(proyectarResultado(FILA_DE_EJEMPLO));
      expect(consulta.abortSignal).toHaveBeenCalledExactlyOnceWith(senal);
      // Sigue sin argumentos: la señal no es un parámetro de la función de la base.
      expect(rpc.mock.calls).toEqual([["mi_ultimo_diagnostico"]]);
    });

    it("sin señal no toca abortSignal", async () => {
      const { cliente, consulta } = clienteConConstructor({ data: [FILA_DE_EJEMPLO], error: null });
      await leerMiUltimoDiagnostico(cliente);
      expect(consulta.abortSignal).not.toHaveBeenCalled();
    });

    it("si la llamada se corta, PostgREST responde con un error sin código y la lectura lanza sin su mensaje", async () => {
      const cortada = { message: "AbortError: The user aborted a request.", details: "", hint: "The request was aborted locally", code: "" };
      const { cliente } = clienteConConstructor({ data: null, error: cortada });
      const error = await leerMiUltimoDiagnostico(cliente, AbortSignal.abort()).then(
        () => null,
        (fallo: unknown) => fallo as Error,
      );
      expect(error?.message).toContain("sin código");
      expect(error?.message).not.toContain("AbortError");
    });
  });

  it("un resultado guardado que no cuadra lanza ErrorDeResultadoGuardado, y no llega a la pantalla", async () => {
    const corrupta = { ...FILA_DE_EJEMPLO, aciertos: 99 };
    await expect(leerMiUltimoDiagnostico(clienteQueResponde({ data: [corrupta], error: null }).cliente)).rejects.toThrow(ErrorDeResultadoGuardado);
    const sinListas = { ...FILA_DE_EJEMPLO, resultado: { ...GUARDADO_DE_EJEMPLO, errores: null } };
    await expect(leerMiUltimoDiagnostico(clienteQueResponde({ data: [sinListas], error: null }).cliente)).rejects.toThrow(ErrorDeResultadoGuardado);
  });
});
