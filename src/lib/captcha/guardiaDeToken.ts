import type { EsperaDeToken } from "./esperaDeToken";
import type { EventoDeEnvio } from "./guardiaDeEnvio";

/*
 * HU-058 (D-30): el envío de un formulario de cuentas (ingreso, restablecer, registro de monitor) lleva el token
 * de Turnstile en un campo oculto. Si el token todavía no llegó, se frena el envío, se espera y se reenvía.
 * Sin React ni DOM real: la usa `useTokenCaptcha` y se prueba con un formulario falso.
 */

export interface GuardiaDeToken {
  /**
   * `onSubmit` del formulario. Devuelve `true` si frenó el envío (lo reenviará solo cuando llegue el token,
   * o sin token si no llega) y `false` si el envío sigue su curso.
   */
  alEnviar(evento: EventoDeEnvio): boolean;
}

/**
 * @param espera El token en curso y la espera (hasta 20 s) de quien envía antes de que llegue.
 * @param alVerificar `true` mientras se espera el token (el botón de envío dice "Verificando…").
 */
export function crearGuardiaDeToken(espera: EsperaDeToken, alVerificar: (activa: boolean) => void): GuardiaDeToken {
  let esperando = false;
  // Con el plazo agotado el envío sale sin token: Auth responde `captcha_failed` y el formulario lo traduce.
  let dejarPasar = false;

  return {
    alEnviar(evento) {
      if (dejarPasar) return false;
      // Con token en el campo sigue; con el widget caído tampoco hay nada que esperar.
      if (espera.leer() || espera.hayFallo()) return false;
      evento.preventDefault();
      if (esperando) return true;
      // Se toma antes del await: después el evento ya no tiene `currentTarget`.
      const formulario = evento.currentTarget;
      esperando = true;
      alVerificar(true);
      void espera.esperar().then((token) => {
        esperando = false;
        alVerificar(false);
        // Si el formulario ya no está en la página (se remontó mientras se esperaba), no hay nada que reenviar.
        if (!formulario.isConnected) return;
        // `requestSubmit()` dispara `submit` de forma síncrona: la bandera solo vale para ese reenvío.
        dejarPasar = !token;
        try {
          formulario.requestSubmit();
        } finally {
          dejarPasar = false;
        }
      });
      return true;
    },
  };
}
