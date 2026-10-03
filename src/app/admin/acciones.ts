"use server";

import { redirect } from "next/navigation";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import type { DesenlaceDeReabrir } from "@/lib/reembolsos/reglas";
import { reabrirReembolso } from "@/lib/reembolsos/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/admin";

/**
 * HU-025 (criterio 5, supuesto 4): un admin reabre desde la bandeja un reembolso que se cerró sin llave. Vuelven a
 * correr los 7 días y sale de nuevo el mismo enlace. Con la sesión del admin: si el caso está cerrado y si quien lo pide
 * es un admin activo lo decide `public.reabrir_reembolso` con su hora. Vuelve a la bandeja con lo que pasó
 * (`?reembolso=`), como el equipo de admins: funciona sin JavaScript.
 */
export async function reabrir(datos: FormData): Promise<void> {
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  await exigirRol("admin", RUTA);
  const id = String(datos.get("reembolso") ?? "").trim().toLowerCase();

  let desenlace: DesenlaceDeReabrir;
  if (!esUuid(id)) {
    desenlace = "no_encontrado";
  } else {
    try {
      const supabase = await crearClienteServidor();
      if (!supabase) throw new Error("Faltan las variables de Supabase.");
      desenlace = await reabrirReembolso(supabase, id);
    } catch (error) {
      console.error("[reembolsos] no se pudo reabrir el caso:", error instanceof Error ? error.message : error);
      desenlace = "fallo";
    }
  }
  redirect(`${RUTA}?${new URLSearchParams({ reembolso: desenlace })}`);
}
