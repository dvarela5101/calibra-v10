"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { autorizarCancelacion, marcarGratis } from "@/lib/admin/citas";
import {
  CAMBIOS_DE_LA_CITA,
  leerAutorizacion,
  MENSAJE_DE_FALLO,
  MENSAJES_DE_AUTORIZACION,
  type ResultadoDeAutorizacion,
} from "@/lib/admin/citas-reglas";
import {
  CAMBIOS_DE_LA_MARCA,
  leerMarca,
  MENSAJE_DE_FALLO_DE_MARCA,
  MENSAJES_DE_MARCA,
  type ResultadoDeMarca,
} from "@/lib/admin/gratis-reglas";
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

/**
 * HU-116: un admin activo marca una monitoría por pagar como de prueba (queda confirmada y gratis, D-84) o le quita la marca
 * (vuelve a por pagar). Escribe con la sesión del admin: si se puede, qué cambia y el registro lo decide
 * `public.marcar_monitoria_gratis` bajo candado, con la identidad (`auth.uid()`) y la hora de la base. Tras el cambio vuelve a
 * la ficha, que dice qué pasó (`?gratis=`); lo que cambió mientras el admin miraba (llegó un comprobante, venció la reserva, otro
 * admin ya la marcó) también vuelve a pintarla (`?gratis_error=`). La acción no manda correos: la confirmación al estudiante y el
 * aviso al monitor los anota la base al confirmarse la cita.
 */
export type EstadoMarca = { error: string | null };

const esCambioDeMarca = (resultado: ResultadoDeMarca): resultado is (typeof CAMBIOS_DE_LA_MARCA)[number] =>
  (CAMBIOS_DE_LA_MARCA as readonly string[]).includes(resultado);

export async function cambiarMarcaGratis(_anterior: EstadoMarca, datos: FormData): Promise<EstadoMarca> {
  const id = String(datos.get("id_monitoria") ?? "").trim().toLowerCase();
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  await exigirRol("admin", esUuid(id) ? rutaDeLaCita(id) : "/admin");
  const lectura = leerMarca(datos);
  if (!lectura.ok) return { error: lectura.error };
  const ruta = rutaDeLaCita(lectura.datos.idMonitoria);

  let resultado: ResultadoDeMarca;
  try {
    const supabase: Cliente | null = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    resultado = await marcarGratis(supabase, lectura.datos);
  } catch (error) {
    console.error("[citas] no se pudo cambiar la marca de prueba:", error instanceof Error ? error.message : error);
    return { error: MENSAJE_DE_FALLO_DE_MARCA };
  }

  if (resultado === "marcada" || resultado === "desmarcada" || esCambioDeMarca(resultado)) {
    // La cita cambia de estado: la lista de citas sin plazo y la bandeja pueden cambiar. Antes del redirect, que lanza.
    revalidatePath("/admin");
    revalidatePath("/admin/citas");
    revalidatePath(ruta);
    redirect(`${ruta}?${new URLSearchParams(resultado === "marcada" || resultado === "desmarcada" ? { gratis: resultado } : { gratis_error: resultado })}`);
  }
  return { error: MENSAJES_DE_MARCA[resultado] };
}
