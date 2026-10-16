"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revisarPago, type Revision } from "@/lib/admin/pagos";
import { leerRevision, MENSAJE_DE_FALLO, MENSAJES_DE_REVISION, observacionesValidas } from "@/lib/admin/pagos-reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-020: cualquier admin activo aprueba o rechaza un pago en revisión desde que llega, sea cual sea su responsable
 * (§5.2, sin vuelta atrás; D-56, HU-034). Escribe con la sesión del admin: si el pago sigue en revisión y qué pasa con la
 * cita lo decide `public.revisar_pago`. Tras revisar vuelve a la página del pago, que dice qué pasó (`?revisado=`); lo
 * que cambió mientras el admin miraba (otro lo revisó) también vuelve a pintarla (`?error=`). `valores` devuelve lo
 * escrito para no vaciar las observaciones tras un error. Desde HU-076 la acción no envía correos: los avisa la base.
 */
export type EstadoRevision = { error: string | null; valores: { observaciones: string } };

const rutaDelPago = (idPago: string) => `/admin/pagos/${idPago}`;

export async function revisar(_anterior: EstadoRevision, datos: FormData): Promise<EstadoRevision> {
  const id = String(datos.get("id_pago") ?? "").trim().toLowerCase();
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  await exigirRol("admin", esUuid(id) ? rutaDelPago(id) : "/admin");
  const observaciones = datos.get("observaciones");
  const valores = { observaciones: typeof observaciones === "string" ? observaciones : "" };
  const lectura = leerRevision(datos);
  if (!lectura.ok) return { error: lectura.error, valores };
  const { idPago } = lectura.datos;
  const ruta = rutaDelPago(idPago);

  if (!observacionesValidas(lectura.datos.observaciones)) return { error: MENSAJES_DE_REVISION.observaciones_invalidas, valores };

  let revision: Revision;
  try {
    const cliente = await crearClienteServidor();
    if (!cliente) throw new Error("Faltan las variables de Supabase.");
    revision = await revisarPago(cliente, lectura.datos);
  } catch (error) {
    console.error("[pagos] no se pudo revisar el pago:", error instanceof Error ? error.message : error);
    return { error: MENSAJE_DE_FALLO, valores };
  }

  const { resultado } = revision;
  if (resultado === "aprobado" || resultado === "rechazado") {
    // HU-076: los correos del rechazo (al pagador y al monitor) los anota la base en la misma transacción y salen por
    // los procesos programados; la acción ya no manda nada.
    revalidatePath("/admin");
    revalidatePath(ruta);
    redirect(`${ruta}?${new URLSearchParams({ revisado: resultado })}`);
  }
  if (resultado === "ya_revisado" || resultado === "no_individual") {
    revalidatePath("/admin");
    redirect(`${ruta}?${new URLSearchParams({ error: resultado })}`);
  }
  // La sesión pudo empezar mientras el admin miraba (P-24): la página se vuelve a pintar con las observaciones
  // obligatorias, y el formulario conserva lo escrito.
  revalidatePath(ruta);
  return { error: MENSAJES_DE_REVISION[resultado], valores };
}
