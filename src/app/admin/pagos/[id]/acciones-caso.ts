"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cerrarCasoP24 } from "@/lib/admin/casos-p24";
import { CAMBIOS_DEL_CASO, leerCierre, MENSAJE_DE_FALLO, MENSAJES_DEL_CIERRE, type ResultadoDelCierre } from "@/lib/admin/casos-p24-reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-078: un admin activo cierra un caso P-24 como cobrado o asumido, con una nota opcional (criterio 2, sin vuelta
 * atrás). En su propio archivo y no en `acciones.ts`, que es de la revisión (HU-020, HU-076, HU-077). Escribe con la
 * sesión del admin: si el pago sigue siendo un caso abierto, quién lo cierra y cuándo lo decide `public.cerrar_caso_p24`
 * bajo candado. Tras cerrarlo vuelve a la página del pago, que dice qué pasó (`?caso=cerrado`); lo que cambió mientras
 * el admin miraba (otro lo cerró, la monitoría se canceló) también vuelve a pintarla (`?caso=`). `valores` devuelve lo
 * escrito para no perderlo tras un error.
 */
export type EstadoCierre = { error: string | null; valores: { cierre: string; nota: string } };

const rutaDelPago = (idPago: string) => `/admin/pagos/${idPago}`;

export async function cerrarCaso(_anterior: EstadoCierre, datos: FormData): Promise<EstadoCierre> {
  const id = String(datos.get("id_pago") ?? "").trim().toLowerCase();
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  await exigirRol("admin", esUuid(id) ? rutaDelPago(id) : "/admin");
  const escrito = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor : "";
  };
  const valores = { cierre: escrito("cierre"), nota: escrito("nota") };
  const lectura = leerCierre(datos);
  if (!lectura.ok) return { error: lectura.error, valores };
  const ruta = rutaDelPago(lectura.datos.idPago);

  let resultado: ResultadoDelCierre;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    resultado = await cerrarCasoP24(supabase, lectura.datos);
  } catch (error) {
    console.error("[casos] no se pudo cerrar el caso:", error instanceof Error ? error.message : error);
    return { error: MENSAJE_DE_FALLO, valores };
  }

  if (resultado === "cerrado" || (CAMBIOS_DEL_CASO as readonly string[]).includes(resultado)) {
    // El caso sale de la bandeja (o ya había salido) y el desembolso de su monitoría puede cambiar.
    revalidatePath("/admin");
    revalidatePath(ruta);
    redirect(`${ruta}?${new URLSearchParams({ caso: resultado })}`);
  }
  return { error: MENSAJES_DEL_CIERRE[resultado], valores };
}
