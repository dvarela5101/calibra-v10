import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILA_DE_EJEMPLO } from "../../../pruebas/diagnostico-sembrado";
import type { Rol } from "@/lib/auth/roles";
import { ErrorDeResultadoGuardado, proyectarResultado } from "./mostrar";

// HU-011: la lectura tolerante de la portada, sin Next ni base. La sesión, el cliente y la lectura son inventados. Aquí se fija
// cuándo se llega a leer (solo con sesión y sin ser del equipo), con qué cliente (el de la sesión) y que ningún fallo sale de la
// función: el peor caso es el inicio normal, con una línea en el registro. Quién es el dueño lo decide la base (pgTAP).

const falsos = vi.hoisted(() => ({
  sesion: null as { idUsuario: string; rol: Rol | null } | null,
  obtenerSesion: vi.fn(),
  cliente: {} as object | null,
  crearCliente: vi.fn(),
  leer: vi.fn(),
}));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: (...args: unknown[]) => falsos.obtenerSesion(...args) }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: (...args: unknown[]) => falsos.crearCliente(...args) }));
vi.mock("./lectura", () => ({ leerMiUltimoDiagnostico: (...args: unknown[]) => falsos.leer(...args) }));
// Como en Next: `unstable_rethrow` vuelve a lanzar las señales internas (redirect, notFound, la de `cookies()`), que traen `digest`,
// y no hace nada con un error común.
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (typeof error === "object" && error !== null && "digest" in error) throw error;
  },
}));

import { TOPE_DE_LECTURA_MS, ultimoDiagnosticoDeLaSesion } from "./ultimo";

const RESULTADO = proyectarResultado(FILA_DE_EJEMPLO);
const PERSONA = { idUsuario: "5e000000-0000-4000-8000-000000000001", rol: "anonimo" as const };

let registro: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  falsos.sesion = PERSONA;
  falsos.cliente = { rpc: vi.fn() };
  falsos.obtenerSesion.mockReset().mockImplementation(async () => falsos.sesion);
  falsos.crearCliente.mockReset().mockImplementation(async () => falsos.cliente);
  falsos.leer.mockReset().mockResolvedValue(RESULTADO);
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  registro.mockRestore();
});

describe("ultimoDiagnosticoDeLaSesion: cuándo lee", () => {
  it("sin sesión devuelve null y no crea cliente ni lee", async () => {
    falsos.sesion = null;
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    expect(falsos.crearCliente).not.toHaveBeenCalled();
    expect(falsos.leer).not.toHaveBeenCalled();
    expect(registro).not.toHaveBeenCalled();
  });

  it.each(["monitor", "admin"] as const)("con la cuenta de %s devuelve null sin llegar a la base, aunque la política le deje leer filas", async (rol) => {
    falsos.sesion = { idUsuario: PERSONA.idUsuario, rol };
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    expect(falsos.crearCliente).not.toHaveBeenCalled();
    expect(falsos.leer).not.toHaveBeenCalled();
    expect(registro).not.toHaveBeenCalled();
  });

  it.each([["anonimo"], ["estudiante"], [null]] as const)("con el rol %s lee una vez con el cliente de la sesión y devuelve lo que lee", async (rol) => {
    falsos.sesion = { idUsuario: PERSONA.idUsuario, rol };
    expect(await ultimoDiagnosticoDeLaSesion()).toBe(RESULTADO);
    expect(falsos.crearCliente).toHaveBeenCalledOnce();
    expect(falsos.leer).toHaveBeenCalledOnce();
    const [cliente, senal] = falsos.leer.mock.calls[0];
    expect(cliente).toBe(falsos.cliente);
    // La señal con la que el tope corta la llamada a la base: sigue sin abortar cuando la lectura termina a tiempo.
    expect(senal).toBeInstanceOf(AbortSignal);
    expect((senal as AbortSignal).aborted).toBe(false);
    expect(registro).not.toHaveBeenCalled();
  });

  it("sin cliente de Supabase (faltan las variables) devuelve null sin leer y sin ruido", async () => {
    falsos.cliente = null;
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    expect(falsos.leer).not.toHaveBeenCalled();
    expect(registro).not.toHaveBeenCalled();
  });

  it("si no tiene diagnósticos terminados, la lectura da null y la función también, sin registro", async () => {
    falsos.leer.mockResolvedValue(null);
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    expect(falsos.leer).toHaveBeenCalledOnce();
    expect(registro).not.toHaveBeenCalled();
  });
});

describe("ultimoDiagnosticoDeLaSesion: ningún fallo sale de la función", () => {
  /** Un solo `console.error`, con el prefijo y una cadena como segundo argumento: nunca el objeto de error. */
  function esperarUnRegistro(mensaje: string | RegExp) {
    expect(registro).toHaveBeenCalledOnce();
    const [prefijo, detalle] = registro.mock.calls[0];
    expect(registro.mock.calls[0]).toHaveLength(2);
    expect(prefijo).toBe("[diagnostico] no se pudo leer el último diagnóstico de la sesión:");
    expect(typeof detalle).toBe("string");
    if (typeof mensaje === "string") expect(detalle).toBe(mensaje);
    else expect(detalle).toMatch(mensaje);
  }

  it("la lectura lanza: null y un registro con solo el mensaje", async () => {
    falsos.leer.mockRejectedValue(new Error("Falló «mi_ultimo_diagnostico» (código 57014)."));
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    esperarUnRegistro("Falló «mi_ultimo_diagnostico» (código 57014).");
  });

  it("el resultado guardado no cuadra (ErrorDeResultadoGuardado): null y un registro", async () => {
    falsos.leer.mockRejectedValue(new ErrorDeResultadoGuardado());
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    esperarUnRegistro("El resultado guardado del diagnóstico no tiene la forma esperada.");
  });

  it("obtenerSesion lanza (un fallo de Auth no tumba la portada): null, sin leer, y un registro", async () => {
    falsos.obtenerSesion.mockRejectedValue(new Error("Auth caído"));
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    expect(falsos.leer).not.toHaveBeenCalled();
    esperarUnRegistro("Auth caído");
  });

  it("crear el cliente lanza: null y un registro", async () => {
    falsos.crearCliente.mockRejectedValue(new Error("sin cookies"));
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    esperarUnRegistro("sin cookies");
  });

  it("si lo que se lanza no es un Error, el registro no lleva el valor: nunca el objeto", async () => {
    falsos.leer.mockRejectedValue({ fila: "CONTENIDO-SECRETO" });
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    esperarUnRegistro("error desconocido");
    expect(JSON.stringify(registro.mock.calls)).not.toContain("CONTENIDO-SECRETO");
  });
});

describe("ultimoDiagnosticoDeLaSesion: las señales de Next no son fallos de lectura (M35)", () => {
  it("un redirect que sale de obtenerSesion o de la lectura sale por la función: no se devuelve null ni se registra", async () => {
    const redireccion = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/ingresar;307;" });
    falsos.obtenerSesion.mockRejectedValue(redireccion);
    await expect(ultimoDiagnosticoDeLaSesion()).rejects.toBe(redireccion);
    expect(registro).not.toHaveBeenCalled();

    falsos.obtenerSesion.mockImplementation(async () => falsos.sesion);
    falsos.leer.mockRejectedValue(redireccion);
    await expect(ultimoDiagnosticoDeLaSesion()).rejects.toBe(redireccion);
    expect(registro).not.toHaveBeenCalled();
  });

  it("la señal de «esta ruta es dinámica» de cookies() sigue su camino", async () => {
    const dinamica = Object.assign(new Error("Dynamic server usage"), { digest: "DYNAMIC_SERVER_USAGE" });
    falsos.crearCliente.mockRejectedValue(dinamica);
    await expect(ultimoDiagnosticoDeLaSesion()).rejects.toBe(dinamica);
    expect(registro).not.toHaveBeenCalled();
  });

  it("un Error común sigue dando null y un registro", async () => {
    falsos.leer.mockRejectedValue(new Error("x"));
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    expect(registro).toHaveBeenCalledOnce();
  });
});

describe("ultimoDiagnosticoDeLaSesion: una lectura que no responde pasa del tope (TOPE_DE_LECTURA_MS)", () => {
  // Auth o PostgREST aceptan la conexión y no contestan: no es un fallo rápido que el `catch` ya cubría, es una espera. Con relojes
  // inventados, para no esperar 3 s de verdad y para fijar el borde: a un milisegundo del tope todavía espera.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Una promesa que no se resuelve nunca. */
  const sinRespuesta = () => new Promise<never>(() => undefined);

  /** Corre la función hasta un milisegundo antes del tope (sigue esperando, sin registro) y después hasta que vence. */
  async function correrHastaElTope() {
    const llamada = ultimoDiagnosticoDeLaSesion();
    let terminada = false;
    void llamada.then(
      () => (terminada = true),
      () => (terminada = true),
    );
    await vi.advanceTimersByTimeAsync(TOPE_DE_LECTURA_MS - 1);
    expect(terminada, "a un milisegundo del tope todavía espera").toBe(false);
    expect(registro).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    return llamada;
  }

  /** Un solo registro, con el mismo prefijo de los demás fallos y el tope en el mensaje. */
  function esperarElRegistroDelTope() {
    expect(registro).toHaveBeenCalledExactlyOnceWith(
      "[diagnostico] no se pudo leer el último diagnóstico de la sesión:",
      `La lectura pasó de ${TOPE_DE_LECTURA_MS} ms.`,
    );
  }

  it("el tope es de 2 a 3 segundos: la persona no espera más que eso para ver el inicio", () => {
    expect(TOPE_DE_LECTURA_MS).toBeGreaterThanOrEqual(2000);
    expect(TOPE_DE_LECTURA_MS).toBeLessThanOrEqual(3000);
  });

  it("la base no responde: al vencer el tope devuelve null, deja una línea y corta la llamada con la señal", async () => {
    falsos.leer.mockReturnValue(sinRespuesta());
    expect(await correrHastaElTope()).toBeNull();
    esperarElRegistroDelTope();
    const senal = falsos.leer.mock.calls[0][1] as AbortSignal;
    expect(senal.aborted, "la llamada que sigue en el aire se corta").toBe(true);
  });

  it("Auth no responde (la sesión): null, sin llegar a leer, y una línea", async () => {
    falsos.obtenerSesion.mockReturnValue(sinRespuesta());
    expect(await correrHastaElTope()).toBeNull();
    expect(falsos.leer).not.toHaveBeenCalled();
    esperarElRegistroDelTope();
  });

  it("crear el cliente no responde: null y una línea", async () => {
    falsos.crearCliente.mockReturnValue(sinRespuesta());
    expect(await correrHastaElTope()).toBeNull();
    expect(falsos.leer).not.toHaveBeenCalled();
    esperarElRegistroDelTope();
  });

  it("una lectura que contesta a un milisegundo del tope todavía cuenta", async () => {
    falsos.leer.mockImplementation(() => new Promise((resolver) => setTimeout(() => resolver(RESULTADO), TOPE_DE_LECTURA_MS - 1)));
    const llamada = ultimoDiagnosticoDeLaSesion();
    await vi.advanceTimersByTimeAsync(TOPE_DE_LECTURA_MS - 1);
    expect(await llamada).toBe(RESULTADO);
    expect(registro).not.toHaveBeenCalled();
    expect((falsos.leer.mock.calls[0][1] as AbortSignal).aborted).toBe(false);
  });

  it("si la lectura contesta o falla antes, no queda ningún temporizador vivo", async () => {
    expect(await ultimoDiagnosticoDeLaSesion()).toBe(RESULTADO);
    expect(vi.getTimerCount(), "después de leer a tiempo").toBe(0);

    falsos.leer.mockRejectedValue(new Error("Falló «mi_ultimo_diagnostico» (código 57014)."));
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    expect(vi.getTimerCount(), "después de un fallo rápido").toBe(0);

    falsos.sesion = null;
    expect(await ultimoDiagnosticoDeLaSesion()).toBeNull();
    expect(vi.getTimerCount(), "sin sesión").toBe(0);
  });

  it("lo que la lectura devuelva o lance después del tope no cambia nada ni deja un rechazo sin atender", async () => {
    let fallar: (razon: unknown) => void = () => undefined;
    falsos.leer.mockReturnValue(new Promise((_, rechazar) => (fallar = rechazar)));
    expect(await correrHastaElTope()).toBeNull();
    // La llamada cortada responde tarde con un error (PostgREST contesta con el AbortError): Vitest falla la corrida si queda sin atender.
    fallar(new Error("Falló «mi_ultimo_diagnostico» (código sin código)."));
    await vi.advanceTimersByTimeAsync(0);
    esperarElRegistroDelTope();
  });
});

describe("la portada no usa la llave secreta (M23)", () => {
  // La lectura es la de la persona: la base saca al dueño del JWT. Con la llave secreta (que se salta RLS) la aplicación tendría que
  // decidir de quién es el diagnóstico, y la función SQL ni siquiera le da `execute` a `service_role` (lo prueba pgTAP).
  const RAIZ = join(__dirname, "../../..");
  const ARCHIVOS = ["src/lib/diagnostico/ultimo.ts", "src/lib/diagnostico/lectura.ts", "src/app/(publico)/page.tsx"];

  it.each(ARCHIVOS)("%s no importa @/lib/supabase/admin ni llama crearClienteAdmin", (archivo) => {
    const fuente = readFileSync(join(RAIZ, archivo), "utf8");
    expect(fuente).not.toMatch(/supabase\/admin/);
    expect(fuente).not.toContain("crearClienteAdmin");
    expect(fuente).not.toContain("SUPABASE_SECRET_KEY");
  });
});
