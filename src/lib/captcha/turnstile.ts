import { ESPERA_DEL_SCRIPT_MS, ESPERA_DEL_TOKEN_MS, URL_SCRIPT } from "./config";

/*
 * Cargador y envoltorio mínimo de Cloudflare Turnstile, sin librerías (HU-058). Solo para el navegador:
 * toca `window` y `document` cuando se llama (no al importarlo), así que se importa desde componentes
 * de cliente o desde módulos que ellos usan.
 *
 * CSP: hoy el proyecto no manda cabecera Content-Security-Policy (next.config.ts y src/proxy.ts no la
 * ponen). Si algún día se agrega, `script-src` y `frame-src` necesitan https://challenges.cloudflare.com
 * (Cloudflare recomienda `nonce` con `strict-dynamic`). Referencia:
 * https://developers.cloudflare.com/turnstile/reference/content-security-policy/
 */

/** Parámetros de `turnstile.render` que usamos (nombres de Cloudflare, no los traducimos). */
export interface ParametrosTurnstile {
  sitekey: string;
  action?: string;
  appearance?: "always" | "execute" | "interaction-only";
  language?: string;
  retry?: "auto" | "never";
  callback?: (token: string) => void;
  "error-callback"?: (codigo: string) => boolean | void;
  "timeout-callback"?: () => void;
  "expired-callback"?: () => void;
  "unsupported-callback"?: () => void;
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
}

/** Lo mínimo de `window.turnstile` que usamos; no hay `@types` oficiales. */
export interface TurnstileGlobal {
  /** Devuelve el id del widget, o `undefined` si no pudo dibujarlo. */
  render(contenedor: HTMLElement | string, parametros: ParametrosTurnstile): string | undefined;
  /** Descarta el token y pide uno nuevo (un token es de un solo uso). */
  reset(widgetId?: string): void;
  /** Destruye el widget: desaparecen el iframe y su tráfico. */
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

/** Widget ya dibujado. Ambos métodos son seguros de llamar más de una vez. */
export interface WidgetTurnstile {
  /** Pide un token nuevo: llámalo después de cada envío, porque el anterior ya se gastó. */
  reiniciar(): void;
  /** Destruye el widget. */
  quitar(): void;
}

/** Opciones de `renderizarWidget`. Los tres callbacks de abajo no se llaman si el widget ya se quitó. */
export interface OpcionesWidget {
  /** Llave de sitio (`llaveDeSitioTurnstile()`). */
  llave: string;
  /** Etiqueta para la analítica de Cloudflare, de hasta 32 caracteres. Auth no la valida. */
  accion: string;
  /** Por defecto `"interaction-only"` (modo Managed: solo se ve si Cloudflare pide interacción). */
  apariencia?: ParametrosTurnstile["appearance"];
  /** Por defecto `"es"`. */
  idioma?: string;
  /**
   * Cada token que llega: el primero y los renovados. El widget renueva solo el token cada ~300 s
   * (`refresh-expired: "auto"`) y vuelve a llamar aquí.
   */
  alToken: (token: string) => void;
  /** Fallo del widget (error, tiempo del reto agotado o navegador no soportado). `motivo` es texto para el registro. */
  alError: (motivo: string) => void;
  /** El token venció y el widget no lo renovó solo: el que guardaste ya no sirve. */
  alExpirar?: () => void;
  /**
   * `true` cuando el widget pasa a pedir interacción (se ve la casilla); `false` cuando termina. En
   * `pedirToken` siempre se cierra con `false` antes de resolver o rechazar, aunque Cloudflare no llame
   * a `after-interactive-callback`.
   */
  alInteractivo?: (activo: boolean) => void;
}

/** Opciones de `pedirToken`: las de `renderizarWidget` menos los callbacks, que `pedirToken` resuelve con la promesa. */
export type OpcionesPedirToken = Omit<OpcionesWidget, "alToken" | "alError" | "alExpirar"> & {
  /** Plazo total en ms para recibir el token. Por defecto `ESPERA_DEL_TOKEN_MS`. */
  esperaMs?: number;
};

/** Token obtenido y la forma de destruir el widget que lo dio. */
export interface TokenObtenido {
  token: string;
  /** Destruye el widget (`turnstile.remove`). Llámalo apenas uses el token. */
  limpiar: () => void;
}

// Una sola carga del script aunque varios pidan Turnstile a la vez; se libera al terminar (con éxito o sin él).
let cargaEnCurso: Promise<TurnstileGlobal> | null = null;

/**
 * Inserta el script de Turnstile y resuelve con `window.turnstile` cuando está listo. Rechaza si el
 * script falla (`error`) o no carga en `ESPERA_DEL_SCRIPT_MS`; en ese caso quita el `<script>` y libera
 * la promesa para que un reintento vuelva a intentarlo desde cero.
 */
export function cargarTurnstile(): Promise<TurnstileGlobal> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Turnstile solo se carga en el navegador."));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  cargaEnCurso ??= new Promise<TurnstileGlobal>((resolver, rechazar) => {
    const script = document.createElement("script");
    script.src = URL_SCRIPT;
    script.async = true;
    script.defer = true;
    // Cada intento se cierra una sola vez: un `load` o `error` tardío de un <script> ya descartado
    // no debe tocar la promesa de un intento posterior.
    let cerrado = false;
    const plazo = setTimeout(() => fallar("El script de Turnstile no cargó a tiempo."), ESPERA_DEL_SCRIPT_MS);
    function fallar(motivo: string) {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(plazo);
      script.remove();
      cargaEnCurso = null;
      rechazar(new Error(motivo));
    }
    script.addEventListener("load", () => {
      if (cerrado) return;
      if (!window.turnstile) return fallar("El script de Turnstile cargó sin exponer window.turnstile.");
      cerrado = true;
      clearTimeout(plazo);
      cargaEnCurso = null;
      resolver(window.turnstile);
    });
    script.addEventListener("error", () => fallar("No se pudo descargar el script de Turnstile."));
    document.head.append(script);
  });
  return cargaEnCurso;
}

/** Dibuja el widget con un `window.turnstile` ya cargado. Síncrono: así `pedirToken` conoce el id antes de que llegue ningún callback. */
function dibujar(turnstile: TurnstileGlobal, contenedor: HTMLElement, opciones: OpcionesWidget): WidgetTurnstile {
  let activo = true;
  // Un callback que llega después de quitar el widget no debe tocar a quien ya no escucha.
  const siSigue =
    <A extends unknown[], R>(funcion: (...argumentos: A) => R) =>
    (...argumentos: A) =>
      activo ? funcion(...argumentos) : undefined;
  const widgetId = turnstile.render(contenedor, {
    sitekey: opciones.llave,
    action: opciones.accion,
    appearance: opciones.apariencia ?? "interaction-only",
    language: opciones.idioma ?? "es",
    // Con "auto" un error pasajero se reintenta dentro del widget antes de rendirse.
    retry: "auto",
    callback: siSigue(opciones.alToken),
    "error-callback": siSigue((codigo: string) => {
      opciones.alError(`Turnstile falló (${codigo}).`);
      // Devolver true le dice a Cloudflare que el error ya se atendió y evita su aviso en la consola.
      return true;
    }),
    "timeout-callback": siSigue(() => opciones.alError("El reto de Turnstile se agotó.")),
    "unsupported-callback": siSigue(() => opciones.alError("Este navegador no es compatible con Turnstile.")),
    "expired-callback": siSigue(() => opciones.alExpirar?.()),
    "before-interactive-callback": siSigue(() => opciones.alInteractivo?.(true)),
    "after-interactive-callback": siSigue(() => opciones.alInteractivo?.(false)),
  });
  if (widgetId === undefined) {
    activo = false;
    throw new Error("Turnstile no pudo dibujar el widget.");
  }
  return {
    reiniciar() {
      if (!activo) return;
      try {
        turnstile.reset(widgetId);
      } catch (error) {
        console.warn("No se pudo reiniciar Turnstile:", error);
      }
    },
    quitar() {
      if (!activo) return;
      activo = false;
      try {
        turnstile.remove(widgetId);
      } catch (error) {
        console.warn("No se pudo quitar Turnstile:", error);
      }
    },
  };
}

/**
 * Nivel bajo, para los formularios de cuentas: carga el script si hace falta y dibuja el widget en un
 * contenedor del formulario. Devuelve `{ reiniciar, quitar }` y entrega cada token (también los
 * renovados) y cada fallo por callback, sin plazo propio: quien la usa decide cuánto esperar.
 * Rechaza solo si el script no carga o el widget no se dibuja.
 *
 * En un efecto de React: si el componente se desmonta antes de que resuelva, llama `quitar()` en cuanto
 * llegue el widget (la promesa no se puede cancelar).
 */
export async function renderizarWidget(contenedor: HTMLElement, opciones: OpcionesWidget): Promise<WidgetTurnstile> {
  const turnstile = await cargarTurnstile();
  return dibujar(turnstile, contenedor, opciones);
}

/**
 * Nivel alto, para la sesión anónima: carga el script, dibuja el widget y resuelve con el primer token.
 * Rechaza si falla el script, si el widget da error, o si pasan `esperaMs` (20 s) sin token. El plazo se
 * suspende entre `before-interactive-callback` y `after-interactive-callback`, para no declarar fallo
 * mientras la persona resuelve la casilla. Al rechazar, el widget ya quedó destruido; al resolver, quien
 * recibe `{ token, limpiar }` debe llamar `limpiar()` apenas gaste el token.
 */
export function pedirToken(contenedor: HTMLElement, opciones: OpcionesPedirToken): Promise<TokenObtenido> {
  const { esperaMs = ESPERA_DEL_TOKEN_MS, alInteractivo, ...opcionesWidget } = opciones;
  return new Promise<TokenObtenido>((resolver, rechazar) => {
    let widget: WidgetTurnstile | null = null;
    let terminado = false;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let restante = esperaMs;
    let armadoEn = 0;
    let interactivo = false;

    const armar = () => {
      clearTimeout(temporizador);
      armadoEn = Date.now();
      temporizador = setTimeout(() => fallar(new Error("El token de Turnstile no llegó a tiempo.")), restante);
    };
    const suspender = () => {
      if (temporizador === undefined) return;
      clearTimeout(temporizador);
      temporizador = undefined;
      restante = Math.max(0, restante - (Date.now() - armadoEn));
    };
    const fallar = (error: Error) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      widget?.quitar();
      if (interactivo) alInteractivo?.(false);
      rechazar(error);
    };

    cargarTurnstile()
      .then((turnstile) => {
        widget = dibujar(turnstile, contenedor, {
          ...opcionesWidget,
          alToken: (token) => {
            if (terminado) return;
            terminado = true;
            clearTimeout(temporizador);
            // Si Cloudflare entregó el token sin cerrar el reto, se cierra aquí: nadie más lo hará.
            if (interactivo) alInteractivo?.(false);
            resolver({ token, limpiar: () => widget?.quitar() });
          },
          alError: (motivo) => fallar(new Error(motivo)),
          alInteractivo: (activo) => {
            if (terminado) return;
            interactivo = activo;
            alInteractivo?.(activo);
            if (activo) suspender();
            else armar();
          },
        });
        if (!interactivo && !terminado) armar();
      })
      .catch((error: unknown) => fallar(error instanceof Error ? error : new Error(String(error))));
  });
}
