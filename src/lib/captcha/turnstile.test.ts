import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESPERA_DEL_SCRIPT_MS, ESPERA_DEL_TOKEN_MS, URL_SCRIPT } from "./config";
import { cargarTurnstile, pedirToken, renderizarWidget, type ParametrosTurnstile, type TurnstileGlobal } from "./turnstile";

// Entorno de navegador mínimo y un window.turnstile falso: sin jsdom y sin red.
class ScriptFalso {
  src = "";
  async = false;
  defer = false;
  quitado = false;
  private oyentes = new Map<string, () => void>();
  addEventListener(tipo: string, oyente: () => void) {
    this.oyentes.set(tipo, oyente);
  }
  remove() {
    this.quitado = true;
  }
  disparar(tipo: "load" | "error") {
    this.oyentes.get(tipo)?.();
  }
}

interface LlamadaDeRender {
  contenedor: HTMLElement;
  parametros: ParametrosTurnstile;
}

function crearTurnstileFalso(idsDeWidget: (string | undefined)[] = ["widget-1"]) {
  const llamadas: LlamadaDeRender[] = [];
  const turnstile = {
    render: vi.fn((contenedor: HTMLElement | string, parametros: ParametrosTurnstile) => {
      llamadas.push({ contenedor: contenedor as HTMLElement, parametros });
      return idsDeWidget[llamadas.length - 1] ?? idsDeWidget[idsDeWidget.length - 1];
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  } satisfies TurnstileGlobal;
  return { turnstile, llamadas, parametros: () => llamadas[llamadas.length - 1].parametros };
}

function instalarEntorno() {
  const scripts: ScriptFalso[] = [];
  const ventana: { turnstile?: TurnstileGlobal } = {};
  vi.stubGlobal("window", ventana);
  vi.stubGlobal("document", {
    createElement: () => new ScriptFalso(),
    head: { append: (script: ScriptFalso) => scripts.push(script) },
  });
  return { scripts, ventana };
}

const contenedor = {} as HTMLElement;
const llave = "1x00000000000000000000BB";
const opcionesBase = { llave, accion: "sesion_anonima" };
/** Deja correr las promesas pendientes sin adelantar el reloj. */
const vaciar = () => vi.advanceTimersByTimeAsync(0);

let entorno: ReturnType<typeof instalarEntorno>;

beforeEach(() => {
  vi.useFakeTimers();
  entorno = instalarEntorno();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("cargarTurnstile", () => {
  it("inserta el script una sola vez aunque lo pidan dos y resuelve en load con window.turnstile", async () => {
    const { turnstile } = crearTurnstileFalso();
    const a = cargarTurnstile();
    const b = cargarTurnstile();
    expect(entorno.scripts).toHaveLength(1);
    expect(entorno.scripts[0].src).toBe(URL_SCRIPT);
    expect(entorno.scripts[0].async).toBe(true);
    expect(entorno.scripts[0].defer).toBe(true);
    entorno.ventana.turnstile = turnstile;
    entorno.scripts[0].disparar("load");
    await expect(a).resolves.toBe(turnstile);
    await expect(b).resolves.toBe(turnstile);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("si window.turnstile ya existe no inserta nada", async () => {
    const { turnstile } = crearTurnstileFalso();
    entorno.ventana.turnstile = turnstile;
    await expect(cargarTurnstile()).resolves.toBe(turnstile);
    expect(entorno.scripts).toHaveLength(0);
  });

  it("rechaza si el script falla, lo quita y un reintento vuelve a insertarlo", async () => {
    const primero = expect(cargarTurnstile()).rejects.toThrow(/descargar/);
    entorno.scripts[0].disparar("error");
    await primero;
    expect(entorno.scripts[0].quitado).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    const { turnstile } = crearTurnstileFalso();
    const reintento = cargarTurnstile();
    expect(entorno.scripts).toHaveLength(2);
    entorno.ventana.turnstile = turnstile;
    entorno.scripts[1].disparar("load");
    await expect(reintento).resolves.toBe(turnstile);
    expect(entorno.scripts[1].quitado).toBe(false);
  });

  it("rechaza si el script no carga a tiempo (10 s), lo quita y un reintento vuelve a insertarlo", async () => {
    const primero = expect(cargarTurnstile()).rejects.toThrow(/a tiempo/);
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_SCRIPT_MS - 1);
    expect(entorno.scripts[0].quitado).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await primero;
    expect(entorno.scripts[0].quitado).toBe(true);

    const { turnstile } = crearTurnstileFalso();
    const reintento = cargarTurnstile();
    expect(entorno.scripts).toHaveLength(2);
    entorno.ventana.turnstile = turnstile;
    entorno.scripts[1].disparar("load");
    await expect(reintento).resolves.toBe(turnstile);
  });

  it("rechaza si el script carga sin exponer window.turnstile", async () => {
    const resultado = expect(cargarTurnstile()).rejects.toThrow(/sin exponer/);
    entorno.scripts[0].disparar("load");
    await resultado;
    expect(entorno.scripts[0].quitado).toBe(true);
  });

  it("un error o un load tardío de un script ya descartado no toca el intento siguiente", async () => {
    // Primer intento: se descarta por plazo.
    const primero = expect(cargarTurnstile()).rejects.toThrow(/a tiempo/);
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_SCRIPT_MS);
    await primero;

    // Segundo intento en vuelo.
    const { turnstile } = crearTurnstileFalso();
    const segundo = cargarTurnstile();
    expect(entorno.scripts).toHaveLength(2);

    // El primer script, ya quitado, avisa tarde (error y luego load sin window.turnstile).
    entorno.scripts[0].disparar("error");
    entorno.scripts[0].disparar("load");
    await vaciar();

    // El segundo intento sigue vivo y sigue siendo el único: otro llamado se une a él, sin tercer script.
    expect(cargarTurnstile()).toBe(segundo);
    expect(entorno.scripts).toHaveLength(2);
    expect(entorno.scripts[1].quitado).toBe(false);
    entorno.ventana.turnstile = turnstile;
    entorno.scripts[1].disparar("load");
    await expect(segundo).resolves.toBe(turnstile);
  });

  it("un error tardío y repetido del primer script no adelanta el fallo del segundo intento", async () => {
    const primero = expect(cargarTurnstile()).rejects.toThrow(/descargar/);
    entorno.scripts[0].disparar("error");
    await primero;

    const segundo = expect(cargarTurnstile()).rejects.toThrow(/a tiempo/);
    entorno.scripts[0].disparar("error");
    expect(entorno.scripts[1].quitado).toBe(false);
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_SCRIPT_MS);
    await segundo;
    expect(entorno.scripts[1].quitado).toBe(true);
  });

  it("fuera del navegador rechaza sin tocar nada", async () => {
    vi.unstubAllGlobals();
    await expect(cargarTurnstile()).rejects.toThrow(/navegador/);
  });
});

describe("pedirToken", () => {
  /** Llama a pedirToken con Turnstile ya cargado y deja el widget dibujado. */
  async function pedirConTurnstileListo(opciones: Partial<Parameters<typeof pedirToken>[1]> = {}) {
    const falso = crearTurnstileFalso();
    entorno.ventana.turnstile = falso.turnstile;
    const promesa = pedirToken(contenedor, { ...opcionesBase, ...opciones });
    // Los rechazos que las pruebas esperan se registran con `rejects` antes de avanzar el reloj.
    promesa.catch(() => {});
    await vaciar();
    return { ...falso, promesa };
  }

  it("dibuja el widget con los parámetros del plan y resuelve con el token; limpiar lo quita una sola vez", async () => {
    const { turnstile, parametros, llamadas, promesa } = await pedirConTurnstileListo();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].contenedor).toBe(contenedor);
    expect(parametros()).toMatchObject({
      sitekey: llave,
      action: "sesion_anonima",
      appearance: "interaction-only",
      language: "es",
      retry: "auto",
    });
    parametros().callback?.("token-1");
    const { token, limpiar } = await promesa;
    expect(token).toBe("token-1");
    expect(vi.getTimerCount()).toBe(0);
    expect(turnstile.remove).not.toHaveBeenCalled();
    limpiar();
    limpiar();
    expect(turnstile.remove).toHaveBeenCalledTimes(1);
    expect(turnstile.remove).toHaveBeenCalledWith("widget-1");
  });

  it("respeta apariencia e idioma si se piden otros", async () => {
    const { parametros } = await pedirConTurnstileListo({ apariencia: "always", idioma: "en" });
    expect(parametros()).toMatchObject({ appearance: "always", language: "en" });
  });

  it("carga el script si hace falta y dibuja cuando llega", async () => {
    const falso = crearTurnstileFalso();
    const promesa = pedirToken(contenedor, opcionesBase);
    await vaciar();
    expect(entorno.scripts).toHaveLength(1);
    expect(falso.turnstile.render).not.toHaveBeenCalled();
    entorno.ventana.turnstile = falso.turnstile;
    entorno.scripts[0].disparar("load");
    await vaciar();
    expect(falso.turnstile.render).toHaveBeenCalledTimes(1);
    falso.parametros().callback?.("t");
    await expect(promesa).resolves.toMatchObject({ token: "t" });
  });

  it("rechaza y quita el widget si el script falla", async () => {
    const promesa = pedirToken(contenedor, opcionesBase);
    const rechazo = expect(promesa).rejects.toThrow(/descargar/);
    entorno.scripts[0].disparar("error");
    await rechazo;
  });

  it("rechaza y destruye el widget con error-callback, timeout-callback y unsupported-callback", async () => {
    for (const [callback, mensaje] of [
      ["error-callback", /Turnstile falló \(110200\)/],
      ["timeout-callback", /se agotó/],
      ["unsupported-callback", /no es compatible/],
    ] as const) {
      const { turnstile, parametros, promesa } = await pedirConTurnstileListo();
      const rechazo = expect(promesa).rejects.toThrow(mensaje);
      const devuelto = (parametros()[callback] as (codigo: string) => unknown)("110200");
      if (callback === "error-callback") expect(devuelto).toBe(true);
      await rechazo;
      expect(turnstile.remove).toHaveBeenCalledWith("widget-1");
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("rechaza si el widget no se pudo dibujar", async () => {
    const falso = crearTurnstileFalso([undefined]);
    entorno.ventana.turnstile = falso.turnstile;
    const rechazo = expect(pedirToken(contenedor, opcionesBase)).rejects.toThrow(/no pudo dibujar/);
    await vaciar();
    await rechazo;
    expect(falso.turnstile.remove).not.toHaveBeenCalled();
  });

  it("si el token no llega en 20 s rechaza y quita el widget", async () => {
    const { turnstile, promesa } = await pedirConTurnstileListo();
    const rechazo = expect(promesa).rejects.toThrow(/no llegó a tiempo/);
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_TOKEN_MS - 1);
    expect(turnstile.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rechazo;
    expect(turnstile.remove).toHaveBeenCalledWith("widget-1");
  });

  it("el plazo corre desde que se dibuja el widget, no desde que se pide", async () => {
    const falso = crearTurnstileFalso();
    const promesa = pedirToken(contenedor, opcionesBase);
    promesa.catch(() => {});
    await vi.advanceTimersByTimeAsync(5_000);
    entorno.ventana.turnstile = falso.turnstile;
    entorno.scripts[0].disparar("load");
    await vaciar();
    const rechazo = expect(promesa).rejects.toThrow(/no llegó a tiempo/);
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_TOKEN_MS - 1);
    expect(falso.turnstile.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rechazo;
  });

  it("el modo interactivo suspende el plazo y lo retoma con lo que quedaba", async () => {
    const alInteractivo = vi.fn();
    const { turnstile, parametros, promesa } = await pedirConTurnstileListo({ alInteractivo });
    const rechazo = expect(promesa).rejects.toThrow(/no llegó a tiempo/);

    await vi.advanceTimersByTimeAsync(12_000); // quedan 8 s
    parametros()["before-interactive-callback"]?.();
    expect(alInteractivo).toHaveBeenLastCalledWith(true);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(120_000); // la persona tarda dos minutos: no hay fallo
    expect(turnstile.remove).not.toHaveBeenCalled();

    parametros()["after-interactive-callback"]?.();
    expect(alInteractivo).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(turnstile.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rechazo;
    expect(turnstile.remove).toHaveBeenCalledWith("widget-1");
  });

  it("resolver mientras el reto está a la vista cierra el modo interactivo y no deja temporizadores", async () => {
    const alInteractivo = vi.fn();
    const { parametros, promesa } = await pedirConTurnstileListo({ alInteractivo });
    parametros()["before-interactive-callback"]?.();
    parametros().callback?.("token-interactivo");
    await expect(promesa).resolves.toMatchObject({ token: "token-interactivo" });
    expect(alInteractivo.mock.calls).toEqual([[true], [false]]);
    expect(vi.getTimerCount()).toBe(0);
    // El after-interactive que Cloudflare mande después ya no repite el aviso.
    parametros()["after-interactive-callback"]?.();
    expect(alInteractivo.mock.calls).toEqual([[true], [false]]);
  });

  it("si Cloudflare cierra el reto antes de entregar el token, el aviso de cierre llega una sola vez", async () => {
    const alInteractivo = vi.fn();
    const { parametros, promesa } = await pedirConTurnstileListo({ alInteractivo });
    parametros()["before-interactive-callback"]?.();
    parametros()["after-interactive-callback"]?.();
    parametros().callback?.("t");
    await promesa;
    expect(alInteractivo.mock.calls).toEqual([[true], [false]]);
  });

  it("un fallo en modo interactivo avisa que el reto terminó", async () => {
    const alInteractivo = vi.fn();
    const { parametros, promesa } = await pedirConTurnstileListo({ alInteractivo });
    const rechazo = expect(promesa).rejects.toThrow();
    parametros()["before-interactive-callback"]?.();
    parametros()["timeout-callback"]?.();
    await rechazo;
    expect(alInteractivo.mock.calls).toEqual([[true], [false]]);
  });

  it("un callback tardío después de rechazar no hace nada", async () => {
    const { parametros, promesa } = await pedirConTurnstileListo();
    const rechazo = expect(promesa).rejects.toThrow();
    parametros()["error-callback"]?.("300030");
    await rechazo;
    expect(() => parametros().callback?.("tarde")).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tras un fallo, un nuevo pedirToken vuelve a intentar desde cero", async () => {
    const primero = pedirToken(contenedor, opcionesBase);
    const rechazo = expect(primero).rejects.toThrow(/descargar/);
    entorno.scripts[0].disparar("error");
    await rechazo;

    const falso = crearTurnstileFalso();
    const segundo = pedirToken(contenedor, opcionesBase);
    await vaciar();
    expect(entorno.scripts).toHaveLength(2);
    entorno.ventana.turnstile = falso.turnstile;
    entorno.scripts[1].disparar("load");
    await vaciar();
    falso.parametros().callback?.("token-del-reintento");
    await expect(segundo).resolves.toMatchObject({ token: "token-del-reintento" });
  });
});

describe("renderizarWidget", () => {
  it("entrega cada token (también los renovados), los fallos y el vencimiento", async () => {
    const falso = crearTurnstileFalso();
    entorno.ventana.turnstile = falso.turnstile;
    const alToken = vi.fn();
    const alError = vi.fn();
    const alExpirar = vi.fn();
    const alInteractivo = vi.fn();
    const widget = await renderizarWidget(contenedor, { llave, accion: "ingreso", alToken, alError, alExpirar, alInteractivo });
    expect(falso.parametros()).toMatchObject({ action: "ingreso", appearance: "interaction-only", language: "es", retry: "auto" });

    falso.parametros().callback?.("uno");
    falso.parametros().callback?.("renovado");
    expect(alToken.mock.calls).toEqual([["uno"], ["renovado"]]);
    falso.parametros()["expired-callback"]?.();
    expect(alExpirar).toHaveBeenCalledTimes(1);
    falso.parametros()["error-callback"]?.("300030");
    expect(alError).toHaveBeenCalledWith("Turnstile falló (300030).");
    falso.parametros()["before-interactive-callback"]?.();
    falso.parametros()["after-interactive-callback"]?.();
    expect(alInteractivo.mock.calls).toEqual([[true], [false]]);
    // Sin plazo propio: pasar el tiempo no produce fallos.
    await vi.advanceTimersByTimeAsync(10 * ESPERA_DEL_TOKEN_MS);
    expect(alError).toHaveBeenCalledTimes(1);
    expect(widget).toBeDefined();
  });

  it("reiniciar pide otro token y quitar destruye el widget una sola vez y silencia los callbacks", async () => {
    const falso = crearTurnstileFalso(["w-formulario"]);
    entorno.ventana.turnstile = falso.turnstile;
    const alToken = vi.fn();
    const widget = await renderizarWidget(contenedor, { llave, accion: "registro_monitor", alToken, alError: vi.fn() });

    widget.reiniciar();
    expect(falso.turnstile.reset).toHaveBeenCalledWith("w-formulario");
    widget.quitar();
    widget.quitar();
    expect(falso.turnstile.remove).toHaveBeenCalledTimes(1);
    expect(falso.turnstile.remove).toHaveBeenCalledWith("w-formulario");

    widget.reiniciar();
    expect(falso.turnstile.reset).toHaveBeenCalledTimes(1);
    falso.parametros().callback?.("tarde");
    expect(alToken).not.toHaveBeenCalled();
  });

  it("rechaza si el script no carga", async () => {
    const resultado = expect(
      renderizarWidget(contenedor, { llave, accion: "ingreso", alToken: vi.fn(), alError: vi.fn() }),
    ).rejects.toThrow(/descargar/);
    entorno.scripts[0].disparar("error");
    await resultado;
  });
});
