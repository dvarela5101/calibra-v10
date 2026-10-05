"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cargarAsignacionDeReporte, resolverReporte, type AsignacionDeReporte } from "@/lib/admin/reportes";
import {
  CAMBIOS_DEL_REPORTE,
  leerResolucion,
  MENSAJE_DE_FALLO,
  MENSAJES_DE_RESOLUCION,
  observacionesValidas,
  type ResultadoDeResolucion,
} from "@/lib/admin/reportes-reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-030: el admin asignado acepta o rechaza un reporte de inasistencia (RN-62, RN-63; sin vuelta atrás). Escribe con la
 * sesión del admin: quién puede resolver, si el reporte sigue en revisión y qué cambia con cada decisión lo decide
 * `public.resolver_reporte_inasistencia`. Antes de mirar el texto de las observaciones la acción comprueba quién puede
 * resolver (nota de D-39): a quien no puede le responde lo mismo que la base (`no_asignado`), sin decirle nada del
 * texto. Tras resolver vuelve a la página del reporte, que dice qué pasó (`?resuelto=`); lo que cambió mientras el admin
 * miraba (otro lo resolvió, se lo reasignaron) también vuelve a pintarla (`?error=`). `valores` devuelve lo escrito para
 * no vaciar las observaciones tras un error. La acción no manda correos: los anota la base (el aviso al monitor y el
 * pedido de llave) y salen por los procesos programados. Las observaciones nunca van al log.
 */
export type EstadoResolucion = { error: string | null; valores: { observaciones: string } };

type Cliente = NonNullable<Awaited<ReturnType<typeof crearClienteServidor>>>;

const rutaDelReporte = (idReporte: string) => `/admin/reportes/${idReporte}`;

const esCambio = (resultado: ResultadoDeResolucion): resultado is (typeof CAMBIOS_DEL_REPORTE)[number] =>
  (CAMBIOS_DEL_REPORTE as readonly string[]).includes(resultado);

export async function resolver(_anterior: EstadoResolucion, datos: FormData): Promise<EstadoResolucion> {
  const id = String(datos.get("id_reporte") ?? "").trim().toLowerCase();
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  const sesion = await exigirRol("admin", esUuid(id) ? rutaDelReporte(id) : "/admin");
  const observaciones = datos.get("observaciones");
  const valores = { observaciones: typeof observaciones === "string" ? observaciones : "" };
  const lectura = leerResolucion(datos);
  if (!lectura.ok) return { error: lectura.error, valores };
  const { idReporte } = lectura.datos;
  const ruta = rutaDelReporte(idReporte);

  let supabase: Cliente;
  let asignacion: AsignacionDeReporte | null;
  try {
    const cliente = await crearClienteServidor();
    if (!cliente) throw new Error("Faltan las variables de Supabase.");
    supabase = cliente;
    asignacion = await cargarAsignacionDeReporte(supabase, idReporte);
  } catch (error) {
    console.error("[reportes] no se pudo leer la asignación del reporte:", error instanceof Error ? error.message : error);
    return { error: MENSAJE_DE_FALLO, valores };
  }
  if (!asignacion) return { error: MENSAJES_DE_RESOLUCION.no_encontrado, valores };
  // Solo el asignado resuelve (RN-63), y solo un reporte en revisión: lo demás se anticipa sin mirar el texto. Si no
  // coincide con lo que ve la base, ella responde lo mismo y se llega al mismo lugar.
  if (asignacion.idAdmin !== sesion.idUsuario) {
    revalidatePath("/admin");
    redirect(`${ruta}?${new URLSearchParams({ error: "no_asignado" })}`);
  }
  if (asignacion.estado !== "en_revision") {
    revalidatePath("/admin");
    redirect(`${ruta}?${new URLSearchParams({ error: "ya_decidido" })}`);
  }
  if (!observacionesValidas(lectura.datos.observaciones)) return { error: MENSAJES_DE_RESOLUCION.observaciones_invalidas, valores };

  let resultado: ResultadoDeResolucion;
  try {
    resultado = await resolverReporte(supabase, lectura.datos);
  } catch (error) {
    // Solo el mensaje: ni las observaciones ni la fila.
    console.error("[reportes] no se pudo resolver el reporte:", error instanceof Error ? error.message : error);
    return { error: MENSAJE_DE_FALLO, valores };
  }

  if (resultado === "aceptado" || resultado === "rechazado") {
    // Los correos (al monitor y el pedido de llave al pagador) los anota la base en la misma transacción; la acción no
    // manda nada.
    revalidatePath("/admin");
    revalidatePath(ruta);
    redirect(`${ruta}?${new URLSearchParams({ resuelto: resultado })}`);
  }
  if (esCambio(resultado)) {
    revalidatePath("/admin");
    redirect(`${ruta}?${new URLSearchParams({ error: resultado })}`);
  }
  return { error: MENSAJES_DE_RESOLUCION[resultado], valores };
}
