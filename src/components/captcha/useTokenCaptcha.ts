"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type RefCallback, type RefObject } from "react";
import { llaveDeSitioTurnstile } from "@/lib/captcha/config";
import { crearEsperaDeToken } from "@/lib/captcha/esperaDeToken";
import { crearGuardiaDeToken } from "@/lib/captcha/guardiaDeToken";
import { renderizarWidget, type WidgetTurnstile } from "@/lib/captcha/turnstile";

/** Lo que devuelve `useTokenCaptcha`; `CampoCaptcha` lo recibe tal cual. */
export interface TokenCaptcha {
  /** `false` sin llave de sitio: no se dibuja nada y el envío sigue como antes de HU-058. */
  activo: boolean;
  /** Ref del contenedor del widget (callback ref: el widget nace y muere con el contenedor). */
  contenedorRef: RefCallback<HTMLDivElement>;
  /** Ref del `<input type="hidden" name="captcha_token">`. */
  campoRef: RefObject<HTMLInputElement | null>;
  /** `onSubmit` del formulario. Devuelve `true` si frenó el envío para esperar el token. */
  alEnviar: (evento: FormEvent<HTMLFormElement>) => boolean;
  /** `true` mientras se espera el token: el botón de envío dice "Verificando…" y queda deshabilitado. */
  verificando: boolean;
}

/**
 * HU-058 (D-30): el CAPTCHA invisible de los formularios de cuentas (`/ingresar`, `/restablecer`,
 * `/monitores/registro`), donde Supabase Auth exige el token. El widget se dibuja al montar `CampoCaptcha`
 * (`accion` es la etiqueta de Cloudflare: `ingreso`, `restablecer` o `registro_monitor`) y deja el token, y sus
 * renovaciones cada ~300 s, en el campo oculto, por referencia y sin `setState`.
 *
 * Al enviar: con token, sigue; sin token, se frena el envío, se espera hasta 20 s y se reenvía (sin token si no
 * llegó: Auth responde `captcha_failed`). El token es de un solo uso, así que cuando la acción termina
 * (`enviando` pasa de `true` a `false`, con éxito o con error) se descarta y se pide uno nuevo.
 *
 * @param accion Etiqueta del widget, de hasta 32 caracteres.
 * @param enviando `isPending` de `useActionState` del formulario.
 */
export function useTokenCaptcha(accion: string, enviando: boolean): TokenCaptcha {
  const llave = llaveDeSitioTurnstile();
  const [espera] = useState(() => crearEsperaDeToken());
  const [verificando, setVerificando] = useState(false);
  const [guardia] = useState(() => crearGuardiaDeToken(espera, setVerificando));
  const campoRef = useRef<HTMLInputElement>(null);
  const widgetRef = useRef<WidgetTurnstile | null>(null);
  const turno = useRef<Promise<void>>(Promise.resolve());

  const contenedorRef = useCallback(
    (contenedor: HTMLDivElement | null) => {
      if (!contenedor || !llave) return;
      let cancelado = false;
      let widget: WidgetTurnstile | null = null;
      const ponerEnElCampo = (valor: string) => {
        if (campoRef.current) campoRef.current.value = valor;
      };

      // Un dibujo a la vez: el modo estricto de React monta, desmonta y vuelve a montar el contenedor, y Cloudflare
      // rechaza un segundo `render` en un contenedor que aún tiene el primero. El segundo espera a que el primero
      // termine (y, como ya se canceló, se quite).
      turno.current = turno.current.then(async () => {
        if (cancelado) return;
        try {
          const nuevo = await renderizarWidget(contenedor, {
            llave,
            accion,
            alToken: (token) => {
              if (cancelado) return;
              ponerEnElCampo(token);
              espera.poner(token);
            },
            alError: (motivo) => {
              if (cancelado) return;
              console.warn("El CAPTCHA no pudo verificar el navegador:", motivo);
              ponerEnElCampo("");
              espera.fallar();
            },
            alExpirar: () => {
              if (cancelado) return;
              ponerEnElCampo("");
              espera.vaciar();
            },
            alInteractivo: (activo) => {
              if (!cancelado) espera.interactivo(activo);
            },
          });
          // La promesa no se puede cancelar: si el contenedor ya no está, el widget que llegó se quita.
          if (cancelado) return nuevo.quitar();
          widget = nuevo;
          widgetRef.current = nuevo;
        } catch (error) {
          if (cancelado) return;
          console.warn("No se pudo cargar el CAPTCHA:", error instanceof Error ? error.message : error);
          espera.fallar();
        }
      });

      return () => {
        cancelado = true;
        widget?.quitar();
        if (widgetRef.current === widget) widgetRef.current = null;
        ponerEnElCampo("");
        espera.vaciar();
      };
    },
    [llave, accion, espera],
  );

  // El token se gasta en cada envío, salga bien o mal: al terminar la acción se descarta y se pide otro.
  const estabaEnviando = useRef(false);
  useEffect(() => {
    if (estabaEnviando.current && !enviando) {
      if (campoRef.current) campoRef.current.value = "";
      espera.vaciar();
      widgetRef.current?.reiniciar();
    }
    estabaEnviando.current = enviando;
  }, [enviando, espera]);

  return {
    activo: Boolean(llave),
    contenedorRef,
    campoRef,
    alEnviar: (evento) => (llave ? guardia.alEnviar(evento) : false),
    verificando,
  };
}
