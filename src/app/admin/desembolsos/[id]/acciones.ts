"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutarDesembolso } from "@/lib/admin/desembolsos";
import {
  CAMBIOS_DEL_DESEMBOLSO,
  leerEjecucion,
  MENSAJE_DE_FALLO,
  MENSAJES_DE_EJECUCION,
  type ResultadoDeEjecucion,
} from "@/lib/admin/desembolsos-reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { diaDelNegocio } from "@/lib/fechas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-028: un admin registra la transferencia de un desembolso ejecutable (criterio 4, sin vuelta atrás). Escribe con
 * la sesión del admin: si se puede ejecutar, quién lo ejecuta y los montos los decide `public.ejecutar_desembolso`.
 * Tras registrarla vuelve a la página del desembolso, que dice qué pasó (`?ejecutado=`); lo que cambió mientras el
 * admin miraba (otro lo registró, entró un reporte o un pago en revisión) también vuelve a pintarla (`?error=`). Si
 * cambió el monto, el formulario se queda con lo escrito y la página con el monto nuevo. `valores` devuelve lo
 * escrito para no vaciar el formulario tras un error.
 */
export type EstadoEjecucion = { error: string | null; valores: { referencia: string; fecha: string } };

const rutaDelDesembolso = (idDesembolso: string) => `/admin/desembolsos/${idDesembolso}`;

export async function ejecutar(_anterior: EstadoEjecucion, datos: FormData): Promise<EstadoEjecucion> {
  const id = String(datos.get("id_desembolso") ?? "").trim().toLowerCase();
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  await exigirRol("admin", esUuid(id) ? rutaDelDesembolso(id) : "/admin");
  const escrito = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor : "";
  };
  const valores = { referencia: escrito("referencia"), fecha: escrito("fecha") };
  const lectura = leerEjecucion(datos, diaDelNegocio(new Date()));
  if (!lectura.ok) return { error: lectura.error, valores };
  const ruta = rutaDelDesembolso(lectura.datos.idDesembolso);

  let resultado: ResultadoDeEjecucion;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    resultado = await ejecutarDesembolso(supabase, lectura.datos);
  } catch (error) {
    console.error("[desembolsos] no se pudo ejecutar el desembolso:", error instanceof Error ? error.message : error);
    return { error: MENSAJE_DE_FALLO, valores };
  }

  if (resultado === "desembolsado") {
    revalidatePath("/admin");
    revalidatePath(ruta);
    redirect(`${ruta}?${new URLSearchParams({ ejecutado: resultado })}`);
  }
  if ((CAMBIOS_DEL_DESEMBOLSO as readonly string[]).includes(resultado)) {
    revalidatePath("/admin");
    redirect(`${ruta}?${new URLSearchParams({ error: resultado })}`);
  }
  // Se aprobó un pago mientras el admin miraba (P-29): la página se vuelve a pintar con el monto nuevo, y el
  // formulario conserva lo escrito.
  if (resultado === "monto_cambio") revalidatePath(ruta);
  return { error: MENSAJES_DE_EJECUCION[resultado], valores };
}
