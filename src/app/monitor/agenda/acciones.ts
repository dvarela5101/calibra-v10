"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid } from "@/lib/agendar/reglas";
import type { ResultadoDeFinalizar } from "@/lib/agenda/reglas";
import { finalizarMonitoria, ponerLugar } from "@/lib/agenda/servidor";
import { exigirRol, obtenerSesion } from "@/lib/auth/sesion";
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

export type EstadoLugar = { error: string | null; exito: string | null };

/**
 * HU-107 (D-76): el monitor pone o cambia el lugar o el enlace de una monitoría suya. La base decide con su sesión y su hora si
 * se puede y si el dato sirve; `presencial` solo elige el texto de la confirmación.
 */
export async function guardarLugar(_anterior: EstadoLugar, datos: FormData): Promise<EstadoLugar> {
  await exigirRol("monitor", RUTA);
  const id = String(datos.get("monitoria") ?? "");
  if (!esUuid(id)) return { error: "No encontramos esa monitoría en tu agenda.", exito: null };

  let resultado;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    resultado = await ponerLugar(supabase, id, String(datos.get("valor") ?? ""));
  } catch (error) {
    console.error("[agenda] no se pudo guardar el lugar:", error instanceof Error ? error.message : error);
    return { error: "No pudimos guardarlo. Intenta de nuevo.", exito: null };
  }
  if (!resultado.ok) return { error: resultado.error, exito: null };

  revalidatePath(RUTA);
  return { error: null, exito: datos.get("presencial") === "si" ? "Guardamos el lugar." : "Guardamos el enlace." };
}
