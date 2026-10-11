"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { autorizarCancelacion } from "@/lib/admin/citas";
import {
  CAMBIOS_DE_LA_CITA,
  leerAutorizacion,
  MENSAJE_DE_FALLO,
  MENSAJES_DE_AUTORIZACION,
  type ResultadoDeAutorizacion,
} from "@/lib/admin/citas-reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-052: un admin activo autoriza la cancelación de una individual confirmada fuera del plazo (RN-60, D-60; sin vuelta
 * atrás). Escribe con la sesión del admin: si la cita se puede cancelar, qué cambia y qué se guarda lo decide
 * `public.autorizar_cancelacion_fuera_de_plazo` bajo candado, con la identidad (`auth.uid()`) y la hora de la base. Cualquier
 * admin activo autoriza, así que la acción no compara la sesión con nadie. Tras autorizar vuelve a la página de la cita, que
 * dice qué pasó (`?autorizada=1`); lo que cambió mientras el admin miraba (otro la canceló, ya empezó la sesión) también vuelve
 * a pintarla (`?error=`). `valores` devuelve lo escrito para no perderlo tras un error. La acción no manda correos: los anota
 * la base (la cancelación y el pedido de llave al Lead, el aviso al monitor) y salen por los procesos programados. La nota
 * nunca va al log.
 */
export type EstadoAutorizacion = { error: string | null; valores: { categoria: string; nota: string } };

type Cliente = NonNullable<Awaited<ReturnType<typeof crearClienteServidor>>>;

const rutaDeLaCita = (idMonitoria: string) => `/admin/citas/${idMonitoria}`;

const esCambio = (resultado: ResultadoDeAutorizacion): resultado is (typeof CAMBIOS_DE_LA_CITA)[number] =>
  (CAMBIOS_DE_LA_CITA as readonly string[]).includes(resultado);

export async function autorizar(_anterior: EstadoAutorizacion, datos: FormData): Promise<EstadoAutorizacion> {
  const id = String(datos.get("id_monitoria") ?? "").trim().toLowerCase();
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  await exigirRol("admin", esUuid(id) ? rutaDeLaCita(id) : "/admin");
  const escrito = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor : "";
  };
  const valores = { categoria: escrito("categoria"), nota: escrito("nota") };
  const lectura = leerAutorizacion(datos);
  if (!lectura.ok) return { error: lectura.error, valores };
  const ruta = rutaDeLaCita(lectura.datos.idMonitoria);

  let resultado: ResultadoDeAutorizacion;
  try {
    const supabase: Cliente | null = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    resultado = await autorizarCancelacion(supabase, lectura.datos);
  } catch (error) {
    // Solo el mensaje: ni la nota ni la fila.
    console.error("[citas] no se pudo autorizar la cancelación:", error instanceof Error ? error.message : error);
    return { error: MENSAJE_DE_FALLO, valores };
  }

  if (resultado === "autorizada" || esCambio(resultado)) {
    // La cita sale de la lista y, con reembolsos nuevos, la bandeja de quien los recibe cambia. Antes del redirect, que
    // lanza y corta lo que siga.
    revalidatePath("/admin");
    revalidatePath("/admin/citas");
    revalidatePath(ruta);
    redirect(`${ruta}?${new URLSearchParams(resultado === "autorizada" ? { autorizada: "1" } : { error: resultado })}`);
  }
  return { error: MENSAJES_DE_AUTORIZACION[resultado], valores };
}
