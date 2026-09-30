"use client";

import { useEffect } from "react";
import { COOKIE_ORIGEN, leerOrigen } from "@/lib/leads/origen";

/** Cuánto recuerda el navegador la campaña con la que llegó el visitante. */
const DIAS_QUE_SE_RECUERDA = 30;

/**
 * RN-01 (HU-068): el Lead guarda su origen. Si el visitante llega por un enlace de campaña
 * (`?utm_campaign=...`), se guarda en una cookie para cuando deje su contacto, aunque sea en otra página.
 * Queda la última campaña con la que llegó.
 */
export function OrigenDeCampana() {
  useEffect(() => {
    const campana = leerOrigen(new URLSearchParams(window.location.search).get("utm_campaign"));
    if (!campana) return;
    document.cookie = `${COOKIE_ORIGEN}=${campana}; Max-Age=${DIAS_QUE_SE_RECUERDA * 24 * 60 * 60}; Path=/; SameSite=Lax`;
  }, []);
  return null;
}
