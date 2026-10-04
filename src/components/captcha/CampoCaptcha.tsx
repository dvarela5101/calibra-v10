"use client";

import { CAMPO_TOKEN_CAPTCHA } from "@/lib/captcha/campo";
import estilos from "./captcha.module.css";
import type { TokenCaptcha } from "./useTokenCaptcha";

/**
 * HU-058 (D-30): el contenedor del widget invisible de Turnstile y el campo oculto `captcha_token` que lleva el
 * token a la acción del servidor. Va dentro del `<form>`, cerca del botón de envío: con el modo Managed solo se
 * ve si Cloudflare pide interacción. Sin llave de sitio no pinta nada.
 */
export function CampoCaptcha({ captcha: { activo, contenedorRef, campoRef } }: { captcha: TokenCaptcha }) {
  if (!activo) return null;
  return (
    <>
      <div ref={contenedorRef} className={estilos.campo} />
      {/* Sin `value` ni `defaultValue`: en un campo oculto React volvería a escribir el atributo en cada render y borraría el token. */}
      <input type="hidden" name={CAMPO_TOKEN_CAPTCHA} ref={campoRef} />
    </>
  );
}
