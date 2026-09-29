"use client";

import { useEffect } from "react";
import { crearClienteNavegador } from "@/lib/supabase/navegador";

// Una sola solicitud aunque el efecto corra dos veces (modo estricto de React).
let solicitud: Promise<void> | null = null;

async function asegurarSesion() {
  const supabase = crearClienteNavegador();
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) console.warn("No se pudo crear la sesión anónima:", error.message);
}

/**
 * RN-10: todo visitante de las páginas públicas tiene una identidad anónima que
 * sobrevive a recargar y a cerrar el navegador (cookie persistente de Supabase).
 * Se crea desde el navegador para que el límite por IP cuente la IP de cada visitante.
 */
export function SesionAnonima() {
  useEffect(() => {
    solicitud ??= asegurarSesion().finally(() => {
      solicitud = null;
    });
  }, []);
  return null;
}
