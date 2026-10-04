import type { EstadoFinal, EstadoSesion } from "./sesionAnonima";

/*
 * Criterio 4 de HU-058 (D-32): el visitante solo se entera de que no se pudo verificar su navegador cuando
 * intenta algo que necesita sesión. La guardia intercepta el envío, espera la sesión y lo reenvía, o avisa.
 * Sin React ni DOM real: la usa `useExigirSesionAnonima` y se prueba con un formulario falso.
 */

/** Lo que la guardia usa del almacén de la sesión anónima (`src/lib/captcha/sesionAnonima.ts`). */
export interface AlmacenDeSesion {
  leerEstado(): EstadoSesion;
  esperarSesion(): Promise<EstadoFinal>;
  reintentar(): Promise<EstadoFinal>;
}

/** Lo que la guardia usa del evento `submit` y del formulario. */
export interface EventoDeEnvio {
  preventDefault(): void;
  currentTarget: { isConnected: boolean; requestSubmit(): void };
}

/** Cómo se entera el componente de lo que pasa; en React son `useState`. */
export interface SalidaDeLaGuardia {
  /** `true` mientras se espera la verificación (el botón de envío dice "Verificando…" y queda deshabilitado). */
  alVerificar(activa: boolean): void;
  /** `true` cuando no se pudo verificar y hay que mostrar el aviso con su botón; `false` para quitarlo. */
  alAvisar(visible: boolean): void;
}

export interface GuardiaDeEnvio {
  /**
   * `onSubmit` del formulario. Devuelve `true` si frenó el envío (sin sesión lista: lo reenviará solo cuando la
   * haya, o avisará) y `false` si el envío sigue su curso normal.
   */
  alEnviar(evento: EventoDeEnvio): boolean;
  /** Botón "Reintentar la verificación": vuelve a pedir la sesión y, si nace, reenvía el formulario. */
  reintentar(): void;
}

export function crearGuardiaDeEnvio(almacen: AlmacenDeSesion, salida: SalidaDeLaGuardia): GuardiaDeEnvio {
  // El formulario que se frenó: el botón de reintentar lo reenvía.
  let formulario: EventoDeEnvio["currentTarget"] | null = null;
  let esperando = false;

  async function esperarYReenviar(resultado: Promise<EstadoFinal>) {
    esperando = true;
    salida.alAvisar(false);
    salida.alVerificar(true);
    const estado = await resultado;
    esperando = false;
    salida.alVerificar(false);
    if (estado === "lista") {
      // Si el formulario ya no está en la página (se remontó mientras se esperaba), no hay nada que reenviar.
      if (formulario?.isConnected) formulario.requestSubmit();
    } else {
      salida.alAvisar(true);
    }
  }

  return {
    alEnviar(evento) {
      if (almacen.leerEstado() === "lista") return false;
      // React no ejecuta la acción de un formulario cuyo submit quedó prevenido.
      evento.preventDefault();
      // Un segundo envío mientras se espera no hace nada: ya se reenviará el primero.
      if (esperando) return true;
      // Se toma antes del await: después del primer `await` el evento ya no tiene `currentTarget`.
      formulario = evento.currentTarget;
      void esperarYReenviar(almacen.esperarSesion());
      return true;
    },
    reintentar() {
      if (esperando) return;
      void esperarYReenviar(almacen.reintentar());
    },
  };
}
