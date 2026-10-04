"use client";

import { useEffect } from "react";
import { asegurarSesion } from "@/lib/captcha/sesionAnonima";

/**
 * RN-10: todo visitante de las páginas públicas tiene una identidad anónima que
 * sobrevive a recargar y a cerrar el navegador (cookie persistente de Supabase).
 * Se crea desde el navegador para que el límite por IP cuente la IP de cada visitante.
 * Con CAPTCHA (HU-058) el alta lleva un token de Cloudflare Turnstile; la lógica vive en
 * `src/lib/captcha/sesionAnonima.ts`, que sostiene una sola solicitud aunque el efecto corra dos veces.
 */
export function SesionAnonima() {
  useEffect(() => {
    void asegurarSesion();
  }, []);
  return null;
}
