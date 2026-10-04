"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import formulario from "@/components/formulario.module.css";
import { crearGuardiaDeEnvio, type GuardiaDeEnvio } from "@/lib/captcha/guardiaDeEnvio";
import { esperarSesion, leerEstado, reintentar as reintentarSesion, suscribir } from "@/lib/captcha/sesionAnonima";
import { AVISO_SIN_VERIFICACION, TEXTO_REINTENTAR_VERIFICACION } from "@/lib/captcha/textos";

/** Lo que devuelve `useExigirSesionAnonima`. */
export interface ExigirSesionAnonima {
  /** `onSubmit` del formulario. Devuelve `true` si frenó el envío (ver `GuardiaDeEnvio.alEnviar`). */
  alEnviar: GuardiaDeEnvio["alEnviar"];
  /** El aviso de "no pudimos verificar tu navegador" con su botón de reintentar, o `null` si no hay nada que avisar. */
  aviso: ReactNode;
  /** `true` mientras se espera la verificación: el botón de envío dice "Verificando…" y queda deshabilitado. */
  verificando: boolean;
  /** Lo mismo que hace el botón del aviso, por si un formulario quiere su propio botón. */
  reintentar: () => void;
}

/**
 * HU-058 (criterio 4, D-32): para los formularios que necesitan la sesión anónima. Navegar lo público no muestra
 * nada aunque Cloudflare esté caído; el visitante solo se entera al enviar. Si la sesión no está lista, el envío se
 * frena, se espera a que nazca y se reenvía solo (`requestSubmit`, que conserva lo escrito y el archivo elegido);
 * si no nace, aparece `aviso` con su botón.
 *
 * Uso: `onSubmit={alEnviar}` en el `<form>`, `{aviso}` junto a los errores, y en el botón de envío
 * `disabled={verificando || ...}` con el texto "Verificando…" mientras `verificando`.
 */
export function useExigirSesionAnonima(): ExigirSesionAnonima {
  // El estado del almacén (fuera de React) solo sirve para quitar el aviso si la sesión nace por otro lado.
  const estado = useSyncExternalStore(suscribir, leerEstado, () => "pendiente" as const);
  const [verificando, setVerificando] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [guardia] = useState(() =>
    crearGuardiaDeEnvio({ leerEstado, esperarSesion, reintentar: reintentarSesion }, { alVerificar: setVerificando, alAvisar: setFallo }),
  );

  const hayAviso = fallo && !verificando && estado !== "lista";
  const aviso = hayAviso ? (
    <>
      <p role="alert" className={formulario.error}>
        {AVISO_SIN_VERIFICACION}
      </p>
      <button type="button" className={formulario.botonSecundario} onClick={() => guardia.reintentar()}>
        {TEXTO_REINTENTAR_VERIFICACION}
      </button>
    </>
  ) : null;

  return { alEnviar: guardia.alEnviar, aviso, verificando, reintentar: guardia.reintentar };
}
