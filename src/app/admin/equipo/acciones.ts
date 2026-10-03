"use server";

import { redirect } from "next/navigation";
import { esUuid } from "@/lib/agendar/reglas";
import { desactivarAdmin, moverAdmin } from "@/lib/admin/equipo";
import { esDireccion, type ResultadoDeMover } from "@/lib/admin/equipo-reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/admin/equipo";

/** HU-054 (RN-07): sube o baja a un admin un puesto en el orden de revisión. Vuelve a la lista con lo que pasó. */
export async function mover(datos: FormData): Promise<void> {
  await exigirRol("admin", RUTA);
  const id = String(datos.get("admin") ?? "");
  const direccion = datos.get("direccion");
  let resultado: ResultadoDeMover;
  if (!esUuid(id) || !esDireccion(direccion)) {
    resultado = "no_encontrado";
  } else {
    try {
      const supabase = await crearClienteServidor();
      if (!supabase) throw new Error("Faltan las variables de Supabase.");
      resultado = await moverAdmin(supabase, id, direccion);
    } catch (error) {
      console.error("[equipo] no se pudo mover al admin:", error instanceof Error ? error.message : error);
      redirect(`${RUTA}?error=fallo`);
    }
  }
  if (resultado === "movido") redirect(`${RUTA}?movido=1`);
  redirect(`${RUTA}?${new URLSearchParams({ error: resultado })}`);
}

/**
 * HU-054 (RN-23, P-44): desactiva a otro admin. Sus pagos en revisión (HU-074) y sus reembolsos y reportes abiertos
 * pasan al siguiente admin activo y su cuenta queda bloqueada; sus certificados y revisiones se conservan.
 */
export async function desactivar(datos: FormData): Promise<void> {
  const sesion = await exigirRol("admin", RUTA);
  const id = String(datos.get("admin") ?? "");
  if (!esUuid(id)) redirect(`${RUTA}?error=no_encontrado`);

  let destino: string;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    const resultado = await desactivarAdmin(supabase, sesion.idUsuario, id);
    destino = resultado.ok
      ? `${RUTA}?${new URLSearchParams({ desactivado: resultado.nombre, ...(resultado.recibe ? { recibe: resultado.recibe } : {}) })}`
      : `${RUTA}?${new URLSearchParams({ error: resultado.motivo })}`;
  } catch (error) {
    console.error("[equipo] no se pudo desactivar al admin:", error instanceof Error ? error.message : error);
    destino = `${RUTA}?error=fallo`;
  }
  redirect(destino);
}
