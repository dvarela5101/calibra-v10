"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/auth/sesion";
import { validarLlave } from "@/lib/monitores/invitacion";
import { leerPerfil, RUTA_PERFIL, type ErroresDelPerfil } from "@/lib/monitores/perfil";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-049: el monitor guarda su perfil con su propia sesión. El grant por columna y la política solo le dejan tocar
 * carrera, semestre y presentación de su fila, y los CHECK repiten las reglas aunque alguien se salte la app. Es un
 * solo `update`: o se guardan los tres campos o ninguno. `valores` devuelve lo escrito para no vaciar el formulario.
 */
export type EstadoPerfil = {
  errores: ErroresDelPerfil;
  error: string | null;
  exito: string | null;
  valores: Record<"carrera" | "semestre" | "presentacion", string> | null;
};

const valoresDe = (datos: FormData) => ({
  carrera: String(datos.get("carrera") ?? ""),
  semestre: String(datos.get("semestre") ?? ""),
  presentacion: String(datos.get("presentacion") ?? ""),
});

export async function guardarPerfil(_anterior: EstadoPerfil, datos: FormData): Promise<EstadoPerfil> {
  const sesion = await exigirRol("monitor", RUTA_PERFIL);
  const valores = valoresDe(datos);
  const lectura = leerPerfil(datos);
  if (!lectura.ok) return { errores: lectura.errores, error: null, exito: null, valores };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase!
    .from("perfil_monitor")
    .update(lectura.datos)
    .eq("id_monitor", sesion.idUsuario)
    .select("id_monitor");
  if (error || !data?.length) {
    // Nunca lo que escribió el monitor: solo el código del error.
    console.error("[monitor] no se pudo guardar el perfil:", error?.code ?? "sin fila");
    return { errores: {}, error: "No pudimos guardar tu perfil. Intenta de nuevo.", exito: null, valores };
  }
  revalidatePath(RUTA_PERFIL);
  return { errores: {}, error: null, exito: "Guardamos tu perfil", valores: null };
}

export type EstadoLlave = { error: string | null; exito: string | null };

/**
 * RN-80: el monitor cambia su llave con su propia sesión (la política solo le deja tocar esa columna
 * de su fila). Los desembolsos ya creados guardan su copia y no cambian. HU-123 (D-89 c): vive en el perfil.
 */
export async function cambiarLlave(_anterior: EstadoLlave, datos: FormData): Promise<EstadoLlave> {
  const sesion = await exigirRol("monitor", RUTA_PERFIL);
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
  revalidatePath(RUTA_PERFIL);
  return { error: null, exito: "Guardamos tu llave. Los pagos que ya estaban en camino van a la llave anterior." };
}
