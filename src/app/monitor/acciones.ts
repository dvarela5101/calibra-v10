"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/auth/sesion";
import { validarLlave } from "@/lib/monitores/invitacion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export type EstadoLlave = { error: string | null; exito: string | null };

/**
 * RN-80: el monitor cambia su llave con su propia sesión (la política solo le deja tocar esa columna
 * de su fila). Los desembolsos ya creados guardan su copia y no cambian.
 */
export async function cambiarLlave(_anterior: EstadoLlave, datos: FormData): Promise<EstadoLlave> {
  const sesion = await exigirRol("monitor", "/monitor");
  const llave = String(datos.get("llave") ?? "").replace(/\s+/g, " ").trim();
  const error = validarLlave(llave);
  if (error) return { error, exito: null };

  const supabase = await crearClienteServidor();
  const { data, error: errorBase } = await supabase!
    .from("monitor_privado")
    .update({ llave })
    .eq("id_monitor", sesion.idUsuario)
    .select("id_monitor");
  if (errorBase || !data?.length) {
    console.error("[monitor] no se pudo cambiar la llave:", errorBase?.code ?? "sin fila");
    return { error: "No pudimos guardar tu llave. Intenta de nuevo.", exito: null };
  }
  revalidatePath("/monitor");
  return { error: null, exito: "Guardamos tu llave. Los pagos que ya estaban en camino van a la llave anterior." };
}
