"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirRol } from "@/lib/auth/sesion";
import { diaDelNegocio } from "@/lib/fechas";
import { leerCierre, leerFranja, mensajeDeErrorDeFranja, type DatosDeFranja } from "@/lib/franjas/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * Acciones del monitor sobre sus franjas (HU-015). Escriben con la sesión del monitor: las políticas y
 * el trigger `privado.validar_franja_del_monitor` aplican P-30 y P-31 aunque alguien se salte la app.
 * `valores` devuelve lo escrito para no vaciar el formulario tras un error.
 */
export type EstadoFranja = { error: string | null; exito: string | null; valores: Record<string, string> };

const CAMPOS = ["dia", "hora", "duracion_min", "precio", "modalidad", "lugar", "enlace", "cerrada_desde"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_ENCONTRADA = "No encontramos esa franja entre las tuyas.";
const valoresDe = (datos: FormData) => Object.fromEntries(CAMPOS.map((c) => [c, String(datos.get(c) ?? "")]));

const columnas = (d: DatosDeFranja) => ({
  dia: d.dia,
  hora: d.hora,
  presencial: d.presencial,
  precio: d.precio,
  duracion_min: d.duracionMin,
  lugar: d.lugar,
  enlace: d.enlace,
});

export async function abrirFranja(_anterior: EstadoFranja, datos: FormData): Promise<EstadoFranja> {
  const sesion = await exigirRol("monitor", "/monitor/franjas");
  const valores = valoresDe(datos);
  const lectura = leerFranja(datos);
  if (!lectura.ok) return { error: lectura.error, exito: null, valores };

  const supabase = await crearClienteServidor();
  const { error } = await supabase!.from("franja").insert({ id_monitor: sesion.idUsuario, ...columnas(lectura.datos) });
  if (error) return { error: mensajeDeErrorDeFranja(error), exito: null, valores };

  revalidatePath("/monitor/franjas");
  return { error: null, exito: "Abriste la franja. Ya aparece en tu lista.", valores: {} };
}

export async function editarFranja(_anterior: EstadoFranja, datos: FormData): Promise<EstadoFranja> {
  const sesion = await exigirRol("monitor", "/monitor/franjas");
  const valores = valoresDe(datos);
  const id = String(datos.get("id") ?? "");
  if (!UUID.test(id)) return { error: NO_ENCONTRADA, exito: null, valores };
  const lectura = leerFranja(datos);
  if (!lectura.ok) return { error: lectura.error, exito: null, valores };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase!
    .from("franja")
    .update(columnas(lectura.datos))
    .eq("id", id)
    .eq("id_monitor", sesion.idUsuario)
    .select("id");
  if (error) return { error: mensajeDeErrorDeFranja(error), exito: null, valores };
  if (!data?.length) return { error: NO_ENCONTRADA, exito: null, valores };

  revalidatePath("/monitor/franjas");
  revalidatePath(`/monitor/franjas/${id}`);
  return { error: null, exito: "Guardamos los cambios. Las monitorías ya agendadas conservan su precio.", valores };
}

export async function cerrarFranja(_anterior: EstadoFranja, datos: FormData): Promise<EstadoFranja> {
  const sesion = await exigirRol("monitor", "/monitor/franjas");
  const valores = valoresDe(datos);
  const id = String(datos.get("id") ?? "");
  if (!UUID.test(id)) return { error: NO_ENCONTRADA, exito: null, valores };
  const lectura = leerCierre(datos, diaDelNegocio(new Date()));
  if (!lectura.ok) return { error: lectura.error, exito: null, valores };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase!
    .from("franja")
    .update({ cerrada_desde: lectura.datos.cerradaDesde })
    .eq("id", id)
    .eq("id_monitor", sesion.idUsuario)
    .select("id");
  if (error) return { error: mensajeDeErrorDeFranja(error), exito: null, valores };
  if (!data?.length) return { error: NO_ENCONTRADA, exito: null, valores };

  revalidatePath("/monitor/franjas");
  redirect("/monitor/franjas?cerrada=1");
}
