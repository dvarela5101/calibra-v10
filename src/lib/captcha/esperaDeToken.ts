import { ESPERA_DEL_TOKEN_MS } from "./config";

/*
 * El token de Turnstile de un formulario de cuentas y la espera de quien envía antes de que llegue (HU-058, D-30).
 * Sin DOM ni React: lo usa `useTokenCaptcha`, y así se prueba con tiempos falsos.
 */

/** Lo que `useTokenCaptcha` necesita del token en curso. */
export interface EsperaDeToken {
  /** El token vigente, o `""` si no hay (todavía no llegó, se gastó o venció). */
  leer(): string;
  /** `true` si el widget falló y no se espera que dé token: enviar ya no tiene por qué esperar. */
  hayFallo(): boolean;
  /** Llegó un token (el primero o uno renovado): lo guarda, borra el fallo y despierta a quien esperaba. */
  poner(token: string): void;
  /** El token se gastó o venció: ya no sirve y `leer` devuelve `""`. No toca el fallo ni despierta a nadie. */
  vaciar(): void;
  /** El widget falló: sin token, y despierta a quien esperaba para que no se quede los 20 s. */
  fallar(): void;
  /** El widget pide (o dejó de pedir) interacción: mientras la persona resuelve la casilla no corre el plazo. */
  interactivo(activo: boolean): void;
  /**
   * Resuelve con el token en cuanto lo haya, o con `""` si el widget falla o se agotan `esperaMs`. Nunca
   * rechaza. Varias llamadas a la vez comparten la misma espera.
   */
  esperar(): Promise<string>;
}

interface EsperaEnCurso {
  promesa: Promise<string>;
  terminar: (token: string) => void;
  /** Ms que le quedan al plazo; baja mientras el widget está en modo interactivo. */
  restante: number;
  armadoEn: number;
  temporizador: ReturnType<typeof setTimeout> | undefined;
}

export function crearEsperaDeToken(esperaMs: number = ESPERA_DEL_TOKEN_MS): EsperaDeToken {
  let token = "";
  let fallo = false;
  let enModoInteractivo = false;
  let espera: EsperaEnCurso | null = null;

  function terminar(valor: string) {
    if (!espera) return;
    clearTimeout(espera.temporizador);
    const terminada = espera;
    espera = null;
    terminada.terminar(valor);
  }

  function armar() {
    if (!espera || espera.temporizador !== undefined) return;
    espera.armadoEn = Date.now();
    espera.temporizador = setTimeout(() => terminar(""), espera.restante);
  }

  function suspender() {
    if (!espera || espera.temporizador === undefined) return;
    clearTimeout(espera.temporizador);
    espera.temporizador = undefined;
    espera.restante = Math.max(0, espera.restante - (Date.now() - espera.armadoEn));
  }

  return {
    leer: () => token,
    hayFallo: () => fallo,
    poner(nuevo) {
      token = nuevo;
      fallo = false;
      enModoInteractivo = false;
      terminar(nuevo);
    },
    vaciar() {
      token = "";
    },
    fallar() {
      token = "";
      fallo = true;
      enModoInteractivo = false;
      terminar("");
    },
    interactivo(activo) {
      enModoInteractivo = activo;
      if (activo) suspender();
      else armar();
    },
    esperar() {
      if (token) return Promise.resolve(token);
      if (fallo) return Promise.resolve("");
      if (espera) return espera.promesa;
      let resolver!: (valor: string) => void;
      const promesa = new Promise<string>((resolve) => {
        resolver = resolve;
      });
      espera = { promesa, terminar: resolver, restante: esperaMs, armadoEn: 0, temporizador: undefined };
      if (!enModoInteractivo) armar();
      return promesa;
    },
  };
}
