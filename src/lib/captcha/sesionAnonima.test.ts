import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESPERA_DEL_SCRIPT_MS, ESPERA_DEL_TOKEN_MS } from "./config";
import { crearAlmacenDeSesion, type DependenciasDeSesion } from "./sesionAnonima";
import type { ParametrosTurnstile, TokenObtenido, TurnstileGlobal } from "./turnstile";

const llave = "1x00000000000000000000BB";

type Credenciales = { options?: { captchaToken?: string } };

function crearClienteFalso(opciones: { conSesion?: boolean; errorDeAlta?: string } = {}) {
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: opciones.conSesion ? { access_token: "x" } : null } })),
    signInAnonymously: vi.fn<(credenciales?: Credenciales) => Promise<{ error: { message: string } | null }>>(async () => ({
      error: opciones.errorDeAlta ? { message: opciones.errorDeAlta } : null,
    })),
  };
  return { auth };
}

type ContenedorFalso = HTMLElement & {
  classList: { toggle: ReturnType<typeof vi.fn> };
  remove: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
};

function crearContenedorFalso() {
  return {
    classList: { toggle: vi.fn() },
    remove: vi.fn(),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
  } as unknown as ContenedorFalso;
}

/** Un almacén con dependencias falsas. `pedirToken` por defecto entrega "token-1" sin pasar por Cloudflare. */
function crearAlmacen(dependencias: Partial<DependenciasDeSesion> & { cliente?: ReturnType<typeof crearClienteFalso>; sinCliente?: boolean } = {}) {
  const { cliente = crearClienteFalso(), sinCliente = false, ...resto } = dependencias;
  const limpiar = vi.fn();
  const contenedor = crearContenedorFalso();
  const pedirToken = vi.fn<DependenciasDeSesion["pedirToken"]>(async () => ({ token: "token-1", limpiar }));
  const crearContenedor = vi.fn(() => contenedor);
  const almacen = crearAlmacenDeSesion({
    crearCliente: () => (sinCliente ? null : cliente),
    llaveDeSitio: () => llave,
    pedirToken,
    crearContenedor,
    ...resto,
  });
  return { almacen, cliente, limpiar, contenedor, pedirToken, crearContenedor };
}

let advertencia: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  advertencia = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("almacén de la sesión anónima", () => {
  it("nace pendiente", () => {
    expect(crearAlmacen().almacen.leerEstado()).toBe("pendiente");
  });

  it("sin cliente de Supabase queda lista sin hacer nada, como hoy", async () => {
    const { almacen, pedirToken, crearContenedor } = crearAlmacen({ sinCliente: true });
    await expect(almacen.asegurarSesion()).resolves.toBe("lista");
    expect(almacen.leerEstado()).toBe("lista");
    expect(pedirToken).not.toHaveBeenCalled();
    expect(crearContenedor).not.toHaveBeenCalled();
  });

  it("con sesión queda lista sin cargar Turnstile ni crear contenedor", async () => {
    const { almacen, cliente, pedirToken, crearContenedor } = crearAlmacen({ cliente: crearClienteFalso({ conSesion: true }) });
    await expect(almacen.asegurarSesion()).resolves.toBe("lista");
    expect(pedirToken).not.toHaveBeenCalled();
    expect(crearContenedor).not.toHaveBeenCalled();
    expect(cliente.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("sin llave de sitio pide la sesión sin token, como antes de HU-058", async () => {
    const { almacen, cliente, pedirToken } = crearAlmacen({ llaveDeSitio: () => null });
    await expect(almacen.asegurarSesion()).resolves.toBe("lista");
    expect(cliente.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(cliente.auth.signInAnonymously).toHaveBeenCalledWith();
    expect(pedirToken).not.toHaveBeenCalled();
  });

  it("sin llave de sitio pero con Auth exigiendo CAPTCHA cae a sin_verificacion", async () => {
    const { almacen } = crearAlmacen({ llaveDeSitio: () => null, cliente: crearClienteFalso({ errorDeAlta: "captcha verification process failed" }) });
    await expect(almacen.asegurarSesion()).resolves.toBe("sin_verificacion");
    expect(almacen.leerEstado()).toBe("sin_verificacion");
    expect(advertencia).toHaveBeenCalledWith("No se pudo crear la sesión anónima:", "captcha verification process failed");
  });

  it("con llave: contenedor propio, token invisible, alta con el token y limpieza", async () => {
    const orden: string[] = [];
    const { almacen, cliente, limpiar, contenedor, pedirToken, crearContenedor } = crearAlmacen();
    limpiar.mockImplementation(() => orden.push("limpiar"));
    contenedor.remove.mockImplementation(() => orden.push("quitar contenedor"));
    cliente.auth.signInAnonymously.mockImplementation(async () => {
      orden.push("alta");
      return { error: null };
    });

    await expect(almacen.asegurarSesion()).resolves.toBe("lista");

    expect(crearContenedor).toHaveBeenCalledTimes(1);
    expect(pedirToken).toHaveBeenCalledWith(
      contenedor,
      expect.objectContaining({ llave, accion: "sesion_anonima", apariencia: "interaction-only", idioma: "es" }),
    );
    expect(cliente.auth.signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: "token-1" } });
    expect(orden).toEqual(["alta", "limpiar", "quitar contenedor"]);
    expect(almacen.leerEstado()).toBe("lista");
  });

  it("muestra el contenedor, con su rol y su etiqueta, solo mientras Cloudflare pide interacción", async () => {
    const { almacen, contenedor, pedirToken } = crearAlmacen();
    pedirToken.mockImplementation(async (_contenedor, opciones) => {
      expect(contenedor.setAttribute).not.toHaveBeenCalled();
      opciones.alInteractivo?.(true);
      expect(contenedor.setAttribute.mock.calls).toEqual([
        ["role", "group"],
        ["aria-label", "Verificación de seguridad"],
      ]);
      expect(contenedor.removeAttribute).not.toHaveBeenCalled();
      opciones.alInteractivo?.(false);
      return { token: "t", limpiar: vi.fn() };
    });
    await almacen.asegurarSesion();
    expect(contenedor.classList.toggle.mock.calls.map(([, activo]) => activo)).toEqual([true, false]);
    expect(contenedor.removeAttribute.mock.calls).toEqual([["role"], ["aria-label"]]);
  });

  it("si no llega el token queda sin_verificacion, quita el contenedor y no pide la sesión", async () => {
    const { almacen, cliente, contenedor, pedirToken } = crearAlmacen();
    pedirToken.mockRejectedValue(new Error("El token de Turnstile no llegó a tiempo."));
    await expect(almacen.asegurarSesion()).resolves.toBe("sin_verificacion");
    expect(cliente.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(contenedor.remove).toHaveBeenCalledTimes(1);
    expect(advertencia).toHaveBeenCalledWith("No se pudo crear la sesión anónima:", "El token de Turnstile no llegó a tiempo.");
  });

  it("si Auth rechaza el token queda sin_verificacion, pero igual limpia el widget y el contenedor", async () => {
    const { almacen, limpiar, contenedor } = crearAlmacen({ cliente: crearClienteFalso({ errorDeAlta: "captcha_failed" }) });
    await expect(almacen.asegurarSesion()).resolves.toBe("sin_verificacion");
    expect(limpiar).toHaveBeenCalledTimes(1);
    expect(contenedor.remove).toHaveBeenCalledTimes(1);
  });

  it("si getSession lanza, queda sin_verificacion y no rechaza", async () => {
    const cliente = crearClienteFalso();
    cliente.auth.getSession.mockRejectedValue(new Error("sin red"));
    const { almacen } = crearAlmacen({ cliente });
    await expect(almacen.asegurarSesion()).resolves.toBe("sin_verificacion");
  });

  it("una sola alta aunque se llame dos veces (modo estricto de React)", async () => {
    const { almacen, cliente, pedirToken, crearContenedor } = crearAlmacen();
    const [a, b] = [almacen.asegurarSesion(), almacen.asegurarSesion()];
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(cliente.auth.getSession).toHaveBeenCalledTimes(1);
    expect(crearContenedor).toHaveBeenCalledTimes(1);
    expect(pedirToken).toHaveBeenCalledTimes(1);
    expect(cliente.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("avisa a los suscritos de cada cambio y no después de cancelar", async () => {
    const { almacen } = crearAlmacen();
    const estados: string[] = [];
    const cancelar = almacen.suscribir(() => estados.push(almacen.leerEstado()));
    await almacen.asegurarSesion();
    expect(estados).toEqual(["lista"]);

    cancelar();
    await almacen.asegurarSesion(); // el cliente falso sigue sin sesión: pasa por pendiente y vuelve a lista
    expect(estados).toEqual(["lista"]);
  });

  describe("tras un fallo", () => {
    it("no reintenta por su cuenta: reintentar() es manual y esperarSesion() responde sin volver a intentar", async () => {
      vi.useFakeTimers();
      try {
        const { almacen, pedirToken } = crearAlmacen();
        pedirToken.mockRejectedValueOnce(new Error("sin Cloudflare"));
        await expect(almacen.asegurarSesion()).resolves.toBe("sin_verificacion");
        await vi.advanceTimersByTimeAsync(10 * ESPERA_DEL_TOKEN_MS);
        expect(vi.getTimerCount()).toBe(0);
        await expect(almacen.esperarSesion()).resolves.toBe("sin_verificacion");
        expect(pedirToken).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reintentar() vuelve a pendiente, pide otro token y deja la sesión lista", async () => {
      const { almacen, cliente, pedirToken } = crearAlmacen();
      const estados: string[] = [];
      almacen.suscribir(() => estados.push(almacen.leerEstado()));
      pedirToken.mockRejectedValueOnce(new Error("sin Cloudflare"));
      await almacen.asegurarSesion();
      expect(almacen.leerEstado()).toBe("sin_verificacion");

      const reintento = almacen.reintentar();
      expect(reintento).toBe(almacen.esperarSesion());
      await expect(reintento).resolves.toBe("lista");
      expect(pedirToken).toHaveBeenCalledTimes(2);
      expect(cliente.auth.signInAnonymously).toHaveBeenCalledTimes(1);
      expect(estados).toEqual(["sin_verificacion", "pendiente", "lista"]);
    });

    it("reintentar() pasa a pendiente en el acto, antes de esperar nada", async () => {
      const { almacen, pedirToken } = crearAlmacen();
      pedirToken.mockRejectedValueOnce(new Error("sin Cloudflare"));
      await almacen.asegurarSesion();
      expect(almacen.leerEstado()).toBe("sin_verificacion");

      const estados: string[] = [];
      almacen.suscribir(() => estados.push(almacen.leerEstado()));
      const reintento = almacen.reintentar();
      // Sin `await`: un consumidor de useSyncExternalStore ya dejó de ver el fallo.
      expect(almacen.leerEstado()).toBe("pendiente");
      expect(estados).toEqual(["pendiente"]);
      await expect(reintento).resolves.toBe("lista");
    });

    it("reintentar() con una solicitud en curso se une a ella: no notifica de nuevo ni abre otra", async () => {
      const { almacen, pedirToken } = crearAlmacen();
      let entregar!: (valor: TokenObtenido) => void;
      pedirToken.mockReturnValue(new Promise<TokenObtenido>((resolver) => (entregar = resolver)));
      const primera = almacen.asegurarSesion();
      const estados: string[] = [];
      almacen.suscribir(() => estados.push(almacen.leerEstado()));
      expect(almacen.reintentar()).toBe(primera);
      expect(estados).toEqual([]);
      entregar({ token: "t", limpiar: vi.fn() });
      await primera;
      expect(pedirToken).toHaveBeenCalledTimes(1);
    });

    it("un segundo intento que también falla vuelve a sin_verificacion", async () => {
      const { almacen, pedirToken } = crearAlmacen();
      pedirToken.mockRejectedValue(new Error("sin Cloudflare"));
      await almacen.asegurarSesion();
      await expect(almacen.reintentar()).resolves.toBe("sin_verificacion");
      expect(pedirToken).toHaveBeenCalledTimes(2);
    });
  });

  describe("esperarSesion", () => {
    it("espera la solicitud en curso y entrega su resultado", async () => {
      const { almacen, pedirToken } = crearAlmacen();
      let entregar!: (valor: TokenObtenido) => void;
      pedirToken.mockReturnValue(new Promise<TokenObtenido>((resolver) => (entregar = resolver)));
      void almacen.asegurarSesion();
      const espera = almacen.esperarSesion();
      expect(almacen.leerEstado()).toBe("pendiente");
      entregar({ token: "t", limpiar: vi.fn() });
      await expect(espera).resolves.toBe("lista");
    });

    it("si nadie había pedido la sesión, la pide (envío antes de que corra el efecto)", async () => {
      const { almacen, cliente } = crearAlmacen();
      await expect(almacen.esperarSesion()).resolves.toBe("lista");
      expect(cliente.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    });

    it("si ya está lista responde de inmediato", async () => {
      const { almacen, pedirToken } = crearAlmacen();
      await almacen.asegurarSesion();
      pedirToken.mockClear();
      await expect(almacen.esperarSesion()).resolves.toBe("lista");
      expect(pedirToken).not.toHaveBeenCalled();
    });
  });

  it("volver a montar con la sesión perdida vuelve a pendiente y crea otra", async () => {
    const cliente = crearClienteFalso();
    const { almacen, pedirToken } = crearAlmacen({ cliente });
    await almacen.asegurarSesion();
    expect(almacen.leerEstado()).toBe("lista");
    // El visitante cerró sesión: getSession ya no trae sesión (el clienteFalso nunca la tuvo) y se pide otra.
    const estados: string[] = [];
    almacen.suscribir(() => estados.push(almacen.leerEstado()));
    await almacen.asegurarSesion();
    expect(pedirToken).toHaveBeenCalledTimes(2);
    expect(estados).toEqual(["pendiente", "lista"]);
  });
});

// Con el módulo real de Turnstile, un window y un document mínimos, y tiempos falsos: lo que ve el visitante
// cuando Cloudflare no responde (criterio 4 de HU-058).
describe("con Turnstile real y Cloudflare sin responder", () => {
  class ScriptFalso {
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

  function instalarNavegador() {
    const scripts: ScriptFalso[] = [];
    const contenedores: { className: string; atributos: Record<string, string>; quitado: boolean; classList: { toggle: ReturnType<typeof vi.fn> } }[] = [];
    const ventana: { turnstile?: TurnstileGlobal } = {};
    const widgets: { parametros: ParametrosTurnstile }[] = [];
    const turnstile = {
      render: vi.fn((_c: unknown, parametros: ParametrosTurnstile) => {
        widgets.push({ parametros });
        return "widget-1";
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    } satisfies TurnstileGlobal;
    const cuerpo = { append: vi.fn() };
    vi.stubGlobal("window", ventana);
    vi.stubGlobal("document", {
      createElement: (etiqueta: string) => {
        if (etiqueta === "script") return new ScriptFalso();
        const contenedor = {
          className: "",
          atributos: {} as Record<string, string>,
          quitado: false,
          classList: { toggle: vi.fn() },
          setAttribute(nombre: string, valor: string) {
            this.atributos[nombre] = valor;
          },
          removeAttribute(nombre: string) {
            delete this.atributos[nombre];
          },
          remove() {
            this.quitado = true;
          },
        };
        contenedores.push(contenedor);
        return contenedor;
      },
      head: { append: (script: ScriptFalso) => scripts.push(script) },
      body: cuerpo,
    });
    return { scripts, contenedores, ventana, turnstile, widgets, cuerpo };
  }

  let navegador: ReturnType<typeof instalarNavegador>;
  let cliente: ReturnType<typeof crearClienteFalso>;
  let almacen: ReturnType<typeof crearAlmacenDeSesion>;
  const vaciar = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    navegador = instalarNavegador();
    cliente = crearClienteFalso();
    almacen = crearAlmacenDeSesion({ crearCliente: () => cliente, llaveDeSitio: () => llave });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("flujo feliz: contenedor en document.body, token con los parámetros del plan, alta y limpieza", async () => {
    navegador.ventana.turnstile = navegador.turnstile;
    const resultado = almacen.asegurarSesion();
    await vaciar();

    expect(navegador.cuerpo.append).toHaveBeenCalledTimes(1);
    const contenedor = navegador.contenedores[0];
    expect(navegador.cuerpo.append).toHaveBeenCalledWith(contenedor);
    expect(contenedor.className).toBeTruthy();
    // Oculto no es una región: sin rol ni etiqueta hasta que Cloudflare pida interacción.
    expect(contenedor.atributos).toEqual({});
    expect(navegador.widgets[0].parametros).toMatchObject({
      sitekey: llave,
      action: "sesion_anonima",
      appearance: "interaction-only",
      language: "es",
    });

    navegador.widgets[0].parametros.callback?.("XXXX.DUMMY.TOKEN.XXXX");
    await expect(resultado).resolves.toBe("lista");
    expect(cliente.auth.signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: "XXXX.DUMMY.TOKEN.XXXX" } });
    expect(navegador.turnstile.remove).toHaveBeenCalledWith("widget-1");
    expect(contenedor.quitado).toBe(true);
  });

  it("el script falla: sin_verificacion, sin tocar Auth, y el reintento vuelve a cargar el script", async () => {
    const resultado = almacen.asegurarSesion();
    await vaciar();
    navegador.scripts[0].disparar("error");
    await expect(resultado).resolves.toBe("sin_verificacion");
    expect(cliente.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(navegador.contenedores[0].quitado).toBe(true);
    expect(navegador.scripts[0].quitado).toBe(true);

    const reintento = almacen.reintentar();
    await vaciar();
    expect(navegador.scripts).toHaveLength(2);
    navegador.ventana.turnstile = navegador.turnstile;
    navegador.scripts[1].disparar("load");
    await vaciar();
    navegador.widgets[0].parametros.callback?.("XXXX.DUMMY.TOKEN.XXXX");
    await expect(reintento).resolves.toBe("lista");
  });

  it("el script no carga a tiempo (10 s): sin_verificacion", async () => {
    const resultado = almacen.asegurarSesion();
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_SCRIPT_MS);
    await expect(resultado).resolves.toBe("sin_verificacion");
    expect(almacen.leerEstado()).toBe("sin_verificacion");
    expect(cliente.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("el token no llega a tiempo (20 s): sin_verificacion y el widget desaparece", async () => {
    navegador.ventana.turnstile = navegador.turnstile;
    const resultado = almacen.asegurarSesion();
    await vaciar();
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_TOKEN_MS);
    await expect(resultado).resolves.toBe("sin_verificacion");
    expect(navegador.turnstile.remove).toHaveBeenCalledWith("widget-1");
    expect(navegador.contenedores[0].quitado).toBe(true);
    expect(cliente.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("si Cloudflare pide interacción, el plazo se suspende y el contenedor se muestra mientras tanto", async () => {
    navegador.ventana.turnstile = navegador.turnstile;
    const resultado = almacen.asegurarSesion();
    await vaciar();
    const { parametros } = navegador.widgets[0];

    await vi.advanceTimersByTimeAsync(ESPERA_DEL_TOKEN_MS - 1_000);
    parametros["before-interactive-callback"]?.();
    expect(navegador.contenedores[0].classList.toggle.mock.calls.at(-1)?.[1]).toBe(true);
    expect(navegador.contenedores[0].atributos).toEqual({ role: "group", "aria-label": "Verificación de seguridad" });
    await vi.advanceTimersByTimeAsync(5 * ESPERA_DEL_TOKEN_MS);
    expect(almacen.leerEstado()).toBe("pendiente");

    parametros["after-interactive-callback"]?.();
    expect(navegador.contenedores[0].classList.toggle.mock.calls.at(-1)?.[1]).toBe(false);
    expect(navegador.contenedores[0].atributos).toEqual({});
    parametros.callback?.("XXXX.DUMMY.TOKEN.XXXX");
    await expect(resultado).resolves.toBe("lista");
    expect(cliente.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });
});
