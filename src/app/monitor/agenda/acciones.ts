"use server";

import { redirect } from "next/navigation";
import { esUuid } from "@/lib/agendar/reglas";
import type { ResultadoDeFinalizar } from "@/lib/agenda/reglas";
import { finalizarMonitoria } from "@/lib/agenda/servidor";
import { obtenerSesion } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/monitor/agenda";

/**
 * HU-023: el monitor marca como realizada una monitoría que ya empezó (D-13). La base decide con su sesión y su
 * hora; aquí solo se vuelve a la agenda con lo que pasó (`?finalizada=1` o `?no_finalizada=<motivo>`).
 */
export async function finalizar(datos: FormData): Promise<void> {
  const sesion = await obtenerSesion();
  if (!sesion || sesion.rol !== "monitor") redirect(`/ingresar?${new URLSearchParams({ siguiente: RUTA })}`);

  const id = String(datos.get("monitoria") ?? "");
  let resultado: ResultadoDeFinalizar;
  if (!esUuid(id)) {
    resultado = "no_encontrada";
  } else {
    try {
      const supabase = await crearClienteServidor();
      if (!supabase) throw new Error("Faltan las variables de Supabase.");
      resultado = await finalizarMonitoria(supabase, id);
    } catch (error) {
      console.error("[agenda] no se pudo finalizar:", error instanceof Error ? error.message : error);
      redirect(`${RUTA}?no_finalizada=error`);
    }
  }

  if (resultado === "finalizada" || resultado === "ya_finalizada") redirect(`${RUTA}?finalizada=1`);
  redirect(`${RUTA}?${new URLSearchParams({ no_finalizada: resultado })}`);
}
