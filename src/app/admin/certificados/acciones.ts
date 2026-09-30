"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/auth/sesion";
import { leerCertificacion, mensajeDeErrorDeCertificado } from "@/lib/certificados/reglas";
import { diaDelNegocio } from "@/lib/fechas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-014: el admin certifica a un monitor en una materia después de su evaluación presencial (P-19).
 * Escribe con la sesión del admin: la política "admin certifica" exige que sea un admin activo y que el
 * certificado quede a su nombre. `valores` devuelve lo elegido para no vaciar el formulario tras un error;
 * tras certificar se conservan el monitor y la fecha, para certificarlo en otra materia sin volver a elegirlos.
 */
export type EstadoCertificacion = { error: string | null; exito: string | null; valores: Record<string, string> };

const CAMPOS = ["id_monitor", "id_materia", "fecha_evaluacion"] as const;
const valoresDe = (datos: FormData) => Object.fromEntries(CAMPOS.map((c) => [c, String(datos.get(c) ?? "")]));

export async function certificar(_anterior: EstadoCertificacion, datos: FormData): Promise<EstadoCertificacion> {
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  const sesion = await exigirRol("admin", "/admin/certificados");
  const valores = valoresDe(datos);
  const lectura = leerCertificacion(datos, diaDelNegocio(new Date()));
  if (!lectura.ok) return { error: lectura.error, exito: null, valores };

  let certificado;
  try {
    const supabase = await crearClienteServidor();
    certificado = await supabase!
      .from("certificado")
      .insert({
        id_monitor: lectura.datos.idMonitor,
        id_materia: lectura.datos.idMateria,
        id_admin: sesion.idUsuario,
        fecha_evaluacion: lectura.datos.fechaEvaluacion,
      })
      .select("monitor(nombre), materia(nombre)")
      .single();
  } catch (error) {
    console.error("[admin] no se pudo certificar al monitor:", error);
    return { error: mensajeDeErrorDeCertificado(null), exito: null, valores };
  }
  const { data, error } = certificado;
  if (error) {
    const mensaje = mensajeDeErrorDeCertificado(error);
    // Lo que no tiene un aviso propio no lo puede corregir el admin: queda en el registro para diagnosticarlo.
    if (mensaje === mensajeDeErrorDeCertificado(null)) console.error("[admin] no se pudo certificar al monitor:", error.code ?? error.message);
    return { error: mensaje, exito: null, valores };
  }

  revalidatePath("/admin/certificados");
  const monitor = data.monitor?.nombre ?? "El monitor";
  const materia = data.materia?.nombre ?? "la materia";
  return {
    error: null,
    exito: `${monitor} quedó certificado en ${materia}. Ya puede abrir sus franjas.`,
    valores: { id_monitor: valores.id_monitor, fecha_evaluacion: valores.fecha_evaluacion },
  };
}
