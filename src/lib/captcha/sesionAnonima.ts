import estilos from "@/components/captcha/captcha.module.css";
import { crearClienteNavegador } from "@/lib/supabase/navegador";
import { llaveDeSitioTurnstile } from "./config";
import { pedirToken } from "./turnstile";

/*
 * Almacén externo de la sesión anónima (RN-10, HU-058). Vive fuera de React para que el modo estricto
 * y los remontajes de Next no dupliquen el alta ni destruyan el widget a medias; los componentes lo leen
 * con `useSyncExternalStore(suscribir, leerEstado, ...)`.
 */

/**
 * `pendiente`: todavía no hay sesión (nace en este momento, o no se pidió aún).
 * `lista`: hay sesión, o no hace falta crearla (sin variables de Supabase).
 * `sin_verificacion`: no se pudo crear (Cloudflare caído, bloqueador, Auth rechazó el token...).
 */
export type EstadoSesion = "pendiente" | "lista" | "sin_verificacion";

/** Estados en los que ya no hay nada en curso. */
export type EstadoFinal = Exclude<EstadoSesion, "pendiente">;

/** Lo que se usa del cliente de Supabase: `crearClienteNavegador()` lo cumple. */
interface ClienteDeSesion {
  auth: {
    getSession(): Promise<{ data: { session: unknown } }>;
    signInAnonymously(credenciales?: { options?: { captchaToken?: string } }): Promise<{ error: { message: string } | null }>;
  };
}

/** Dependencias del almacén; en pruebas se reemplazan. */
export interface DependenciasDeSesion {
  crearCliente: () => ClienteDeSesion | null;
  llaveDeSitio: () => string | null;
  pedirToken: typeof pedirToken;
  /** Crea el contenedor del widget en `document.body`, fuera del árbol de React. */
  crearContenedor: () => HTMLElement;
}

/** Contenedor fijo abajo y centrado (ver captcha.module.css). Solo se ve si Cloudflare pide interacción. */
function crearContenedorEnDocumento(): HTMLElement {
  const contenedor = document.createElement("div");
  contenedor.className = estilos.contenedor;
  document.body.append(contenedor);
  return contenedor;
}

/**
 * Muestra u oculta el contenedor. El rol y la etiqueta van solo mientras se ve: oculto no es una región
 * que un lector de pantalla deba anunciar.
 */
function mostrarContenedor(contenedor: HTMLElement, visible: boolean) {
  contenedor.classList.toggle(estilos.visible, visible);
  if (visible) {
    contenedor.setAttribute("role", "group");
    contenedor.setAttribute("aria-label", "Verificación de seguridad");
  } else {
    contenedor.removeAttribute("role");
    contenedor.removeAttribute("aria-label");
  }
}

const dependenciasPorDefecto: DependenciasDeSesion = {
  crearCliente: crearClienteNavegador,
  llaveDeSitio: llaveDeSitioTurnstile,
  pedirToken,
  crearContenedor: crearContenedorEnDocumento,
};

/** Crea un almacén independiente. El de la aplicación es el de abajo; las pruebas crean el suyo. */
export function crearAlmacenDeSesion(dependencias: Partial<DependenciasDeSesion> = {}) {
  const deps = { ...dependenciasPorDefecto, ...dependencias };
  const oyentes = new Set<() => void>();
  let estado: EstadoSesion = "pendiente";
  // Una sola solicitud aunque el efecto corra dos veces (modo estricto de React): el segundo llamado se une al primero.
  let solicitud: Promise<EstadoFinal> | null = null;

  function fijar<E extends EstadoSesion>(nuevo: E): E {
    if (nuevo !== estado) {
      estado = nuevo;
      oyentes.forEach((oyente) => oyente());
    }
    return nuevo;
  }

  function fallo(motivo: string): EstadoFinal {
    console.warn("No se pudo crear la sesión anónima:", motivo);
    return fijar("sin_verificacion");
  }

  /** Los seis pasos de HU-058 §2.2. Nunca rechaza. */
  async function ejecutar(): Promise<EstadoFinal> {
    try {
      const supabase = deps.crearCliente();
      // 1. Sin variables de Supabase la página funciona sin sesión, como siempre.
      if (!supabase) return fijar("lista");
      // 2. El visitante que vuelve ya tiene sesión: nunca carga Turnstile.
      const { data } = await supabase.auth.getSession();
      if (data.session) return fijar("lista");
      // La sesión pudo borrarse (cerrar sesión) o fallar un intento anterior: se vuelve a esperar una nueva.
      fijar("pendiente");
      // 3. Sin llave de sitio, como antes de HU-058: sin token. Si Auth sí lo exige, falla y cae a sin_verificacion.
      const llave = deps.llaveDeSitio();
      if (!llave) {
        const { error } = await supabase.auth.signInAnonymously();
        return error ? fallo(error.message) : fijar("lista");
      }
      // 4. Con llave: widget en un contenedor propio, token y alta con el token.
      const contenedor = deps.crearContenedor();
      try {
        const { token, limpiar } = await deps.pedirToken(contenedor, {
          llave,
          accion: "sesion_anonima",
          apariencia: "interaction-only",
          idioma: "es",
          alInteractivo: (activo) => mostrarContenedor(contenedor, activo),
        });
        try {
          const { error } = await supabase.auth.signInAnonymously({ options: { captchaToken: token } });
          return error ? fallo(error.message) : fijar("lista");
        } finally {
          // El token es de un solo uso: ya se gastó, el widget no tiene más que hacer.
          limpiar();
        }
      } finally {
        contenedor.remove();
      }
    } catch (error) {
      // 5. Cualquier fallo (script, token o Auth): sin reintento automático, el token es de un solo uso.
      return fallo(error instanceof Error ? error.message : String(error));
    }
  }

  function arrancar(): Promise<EstadoFinal> {
    solicitud ??= ejecutar().finally(() => {
      solicitud = null;
    });
    return solicitud;
  }

  return {
    /** Para `useSyncExternalStore`. Devuelve la función que cancela la suscripción. */
    suscribir(oyente: () => void): () => void {
      oyentes.add(oyente);
      return () => {
        oyentes.delete(oyente);
      };
    },
    /** Para `useSyncExternalStore`. */
    leerEstado(): EstadoSesion {
      return estado;
    },
    /**
     * Lo llama `SesionAnonima` al montarse: comprueba que haya sesión y, si no, la crea. Si ya hay una
     * solicitud en curso se une a ella (una sola alta). Nunca rechaza.
     */
    asegurarSesion(): Promise<EstadoFinal> {
      return arrancar();
    },
    /**
     * Reintento manual tras `sin_verificacion` (botón "Reintentar la verificación"). Pasa a `pendiente`
     * en el acto, antes de cualquier espera, para que quien lee el almacén deje de ver el fallo en cuanto
     * se pulsa el botón. Nunca rechaza.
     */
    reintentar(): Promise<EstadoFinal> {
      if (!solicitud) fijar("pendiente");
      return arrancar();
    },
    /**
     * Espera a que la sesión esté o falle. Si hay una solicitud en curso, la espera; si ya terminó,
     * responde de inmediato con el resultado (sin reintentar); si nadie la había pedido, la pide.
     * Nunca rechaza.
     */
    esperarSesion(): Promise<EstadoFinal> {
      if (solicitud) return solicitud;
      if (estado === "pendiente") return arrancar();
      return Promise.resolve(estado);
    },
  };
}

const almacen = crearAlmacenDeSesion();

/** Para `useSyncExternalStore`. */
export const suscribir = almacen.suscribir;
/** Para `useSyncExternalStore`. Al renderizar en el servidor siempre es `"pendiente"`: el almacén nace así. */
export const leerEstado = almacen.leerEstado;
/** Comprueba que el visitante tenga sesión y, si no, la crea con Turnstile. Una sola alta aunque se llame dos veces. */
export const asegurarSesion = almacen.asegurarSesion;
/** Reintento manual tras `sin_verificacion`. */
export const reintentar = almacen.reintentar;
/** Espera a que la sesión esté lista o falle; no reintenta por su cuenta. */
export const esperarSesion = almacen.esperarSesion;
