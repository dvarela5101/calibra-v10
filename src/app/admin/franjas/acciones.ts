"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { marcarFranja } from "@/lib/admin/franjas";
import { leerFranja } from "@/lib/admin/franjas-reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const RUTA = "/admin/franjas";

/**
 * HU-119: un admin activo marca una franja de oferta o le quita la marca, con su sesión. La acción se protege por sí sola (se
 * puede llamar sin pasar por la página); lo demás lo decide `public.marcar_franja_de_prueba` bajo candado. Vuelve a la lista,
 * que dice qué pasó (`?franja=` o `?franja_error=`).
 */
export async function cambiarMarcaDeFranja(datos: FormData): Promise<void> {
  await exigirRol("admin", RUTA);
  const lectura = leerFranja(datos);
  if (!lectura.ok) redirect(`${RUTA}?${new URLSearchParams({ franja_error: "pedido_invalido" })}`);

  let resultado: Awaited<ReturnType<typeof marcarFranja>>;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    resultado = await marcarFranja(supabase, lectura.datos);
  } catch (error) {
    console.error("[franjas] no se pudo cambiar la marca de oferta:", error instanceof Error ? error.message : error);
    redirect(`${RUTA}?${new URLSearchParams({ franja_error: "fallo" })}`);
  }

  revalidatePath(RUTA);
  // El listado del estudiante cambia con la marca.
  revalidatePath("/monitores");
  redirect(`${RUTA}?${new URLSearchParams(resultado === "marcada" || resultado === "desmarcada" ? { franja: resultado } : { franja_error: resultado })}`);
}
