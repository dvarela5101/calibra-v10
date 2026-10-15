"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CONTRASENA_MINIMA, ponerContrasena } from "@/lib/auth/convertir";
import { mensajeDeError } from "@/lib/auth/mensajes";
import { obtenerSesion } from "@/lib/auth/sesion";
import { COOKIE_SIGUIENTE, RUTA_CREAR_CUENTA, rutaDeRegreso, TEXTOS } from "@/lib/cuentas/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import type { EstadoNuevaContrasena } from "../../restablecer/nueva/acciones";

/**
 * HU-032, criterio 6: el último paso de crear la cuenta. Solo la ve y la usa quien ya es Estudiante: una sesión anónima,
 * sin sesión, sin rol o del equipo vuelve a `/cuenta/crear`. Como `/restablecer/nueva`, cambia la contraseña sin pedir
 * la actual (`secure_password_change = false`), y por eso no se abre a quien no acaba de confirmar su correo.
 */

/** Deja la cuenta lista: borra la cookie de regreso y manda a la ruta que pidió, o a «Mis citas». */
async function irAlRegreso(): Promise<never> {
  const almacen = await cookies();
  const guardada = almacen.get(COOKIE_SIGUIENTE)?.value;
  almacen.delete(COOKIE_SIGUIENTE);
  redirect(rutaDeRegreso(guardada));
}

/** Guarda la contraseña. A diferencia de `guardarContrasena` (recuperar), no cierra la sesión: la persona ya está dentro. */
export async function guardarContrasenaDeCuenta(_anterior: EstadoNuevaContrasena, datos: FormData): Promise<EstadoNuevaContrasena> {
  const sesion = await obtenerSesion();
  if (sesion?.rol !== "estudiante") redirect(RUTA_CREAR_CUENTA);

  const contrasena = String(datos.get("contrasena") ?? "");
  const confirmacion = String(datos.get("confirmacion") ?? "");
  if (contrasena.length < CONTRASENA_MINIMA) return { error: TEXTOS.contrasenaCorta };
  if (contrasena !== confirmacion) return { error: TEXTOS.contrasenasDistintas };

  const supabase = await crearClienteServidor();
  if (!supabase) return { error: "Este servicio no está disponible en este momento." };

  const resultado = await ponerContrasena(supabase, contrasena);
  if (!resultado.ok) return { error: mensajeDeError(resultado.codigo) };

  return await irAlRegreso();
}

/** «Elegir después»: sigue siendo Estudiante y fija la contraseña con «¿Olvidaste tu contraseña?» cuando quiera. */
export async function elegirDespues(): Promise<void> {
  const sesion = await obtenerSesion();
  if (sesion?.rol !== "estudiante") redirect(RUTA_CREAR_CUENTA);

  await irAlRegreso();
}
