"use server";

import { redirect } from "next/navigation";
import { esUuid } from "@/lib/agendar/reglas";
import { desactivarAdmin, moverAdmin, reactivarAdmin } from "@/lib/admin/equipo";
import { esDireccion, type ResultadoDeMover } from "@/lib/admin/equipo-reglas";
import { cancelarInvitacionAbierta, invitarAdmin } from "@/lib/admin/invitaciones";
import { claveDeRechazoAlCancelar, claveDeRechazoAlInvitar, leerInvitacion } from "@/lib/admin/invitaciones-reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/admin/equipo";

/**
 * Qué se deja en el registro del servidor cuando algo falla: el código y el mensaje, nunca `details` ni `hint`.
 * PostgREST pone ahí el valor de la llave repetida, que en una invitación es el correo de un tercero.
 */
function descripcionDelError(error: unknown): string {
  if (!(error instanceof Error)) return "error desconocido";
  const codigo = (error as { code?: unknown }).code;
  return typeof codigo === "string" ? `${codigo} ${error.message}` : error.message;
}

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

/**
 * HU-072 (criterios 1 a 4): un admin activo invita a una persona por correo. El formulario se valida aquí, antes de
 * tocar la base, y vuelve con una clave de error que no lleva el correo (no viaja en la dirección). Quien invita sale
 * de la sesión, nunca del formulario. Sin JavaScript también funciona: es un `<form action>` que termina en un redirect.
 */
export async function invitar(datos: FormData): Promise<void> {
  const sesion = await exigirRol("admin", RUTA);
  const lectura = leerInvitacion(datos);
  if (!lectura.ok) redirect(`${RUTA}?${new URLSearchParams({ error: lectura.error })}`);

  let destino: string;
  try {
    const resultado = await invitarAdmin(sesion.idUsuario, lectura.correo);
    if (!resultado.ok) destino = `${RUTA}?${new URLSearchParams({ error: claveDeRechazoAlInvitar(resultado.motivo) })}`;
    else destino = `${RUTA}?invitada=${resultado.correoEnviado ? "1" : "sin_correo"}`;
  } catch (error) {
    console.error("[equipo] no se pudo invitar al admin:", descripcionDelError(error));
    destino = `${RUTA}?error=fallo_invitar`;
  }
  redirect(destino);
}

/**
 * HU-072 (criterio 12): cancela una invitación abierta con la sesión del admin, nunca con la llave secreta: la base
 * comprueba que sea un admin activo. Cancelar una que ya no está abierta no cambia nada y lo dice.
 */
export async function cancelarInvitacion(datos: FormData): Promise<void> {
  await exigirRol("admin", RUTA);
  const id = String(datos.get("invitacion") ?? "");
  if (!esUuid(id)) redirect(`${RUTA}?error=no_encontrada`);

  let destino: string;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    const resultado = await cancelarInvitacionAbierta(supabase, id);
    destino =
      resultado === "cancelada"
        ? `${RUTA}?cancelada=1`
        : `${RUTA}?${new URLSearchParams({ error: claveDeRechazoAlCancelar(resultado) })}`;
  } catch (error) {
    console.error("[equipo] no se pudo cancelar la invitación:", descripcionDelError(error));
    destino = `${RUTA}?error=fallo`;
  }
  redirect(destino);
}

/**
 * HU-072 (criterio 13, D-64 a): reactiva a un admin desactivado. Carga el equipo con la sesión y solo entonces toca
 * Auth: quien no es un admin activo ve el equipo vacío y no reactiva nada. Conserva su lugar en el orden. Vuelve con
 * `?reactivado=<id>`.
 */
export async function reactivar(datos: FormData): Promise<void> {
  await exigirRol("admin", RUTA);
  const id = String(datos.get("admin") ?? "");
  if (!esUuid(id)) redirect(`${RUTA}?error=no_encontrado`);

  let destino: string;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    const resultado = await reactivarAdmin(supabase, id);
    // El id y no el nombre: la página saca el nombre del equipo que carga con la sesión, y un texto escrito a mano en la
    // dirección no llega a un aviso de éxito.
    destino = resultado.ok
      ? `${RUTA}?${new URLSearchParams({ reactivado: id })}`
      : `${RUTA}?${new URLSearchParams({ error: resultado.motivo })}`;
  } catch (error) {
    console.error("[equipo] no se pudo reactivar al admin:", descripcionDelError(error));
    destino = `${RUTA}?error=fallo`;
  }
  redirect(destino);
}
