"use server";

import { redirect } from "next/navigation";
import { MENSAJES, leerPedidoDeAgendar, rutaDeContactoParaAgendar, rutaDeReserva } from "@/lib/agendar/reglas";
import { agendarMonitoria, type Agendamiento } from "@/lib/agendar/servidor";
import { obtenerSesion } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-017: aparta la fecha para el Lead de la sesión. Quien decide si se puede es la base
 * (`public.agendar_monitoria`), con la sesión de quien agenda y su propia hora: aquí solo se traduce la
 * respuesta. `avisoSinCancelacion` muestra la casilla de RN-37 aunque la página no la tuviera (la hora
 * pudo cruzar las 12 h mientras la persona decidía, D-10). `reservaPendiente` enlaza a la que ya tiene (D-8).
 */
export type EstadoAgendar = { error: string | null; avisoSinCancelacion: boolean; reservaPendiente: string | null };

const fallo = (error: string, extra: Partial<EstadoAgendar> = {}): EstadoAgendar => ({
  error,
  avisoSinCancelacion: false,
  reservaPendiente: null,
  ...extra,
});

export async function agendar(_anterior: EstadoAgendar, datos: FormData): Promise<EstadoAgendar> {
  const pedido = leerPedidoDeAgendar({ franja: datos.get("franja"), fecha: datos.get("fecha"), materia: datos.get("materia") });
  if (!pedido) return fallo(MENSAJES.no_disponible);

  const sesion = await obtenerSesion();
  if (!sesion) return fallo(MENSAJES.sin_sesion);
  if (sesion.rol === "monitor" || sesion.rol === "admin") {
    return fallo("Estás con tu cuenta del equipo de Calibra. Para agendar como estudiante, sal de tu cuenta o usa otra ventana.");
  }
  const supabase = await crearClienteServidor();
  if (!supabase) return fallo("No pudimos apartar la fecha. Intenta de nuevo en unos minutos.");

  let agendamiento: Agendamiento;
  try {
    agendamiento = await agendarMonitoria(supabase, pedido, datos.get("acepta_sin_cancelacion") === "si");
  } catch (error) {
    console.error("[agendar] no se pudo apartar la fecha:", error instanceof Error ? error.message : error);
    return fallo("No pudimos apartar la fecha. Intenta de nuevo.");
  }

  const { resultado, idMonitoria } = agendamiento;
  switch (resultado) {
    case "agendada":
    case "ya_agendada":
      if (!idMonitoria) return fallo("No pudimos apartar la fecha. Intenta de nuevo.");
      redirect(rutaDeReserva(idMonitoria));
    case "no_es_lead":
      redirect(rutaDeContactoParaAgendar(pedido));
    case "reserva_pendiente":
      return fallo(MENSAJES.reserva_pendiente, { reservaPendiente: idMonitoria ? rutaDeReserva(idMonitoria) : null });
    case "confirmar_sin_cancelacion":
      return fallo(MENSAJES.confirmar_sin_cancelacion, { avisoSinCancelacion: true });
    default:
      return fallo(MENSAJES[resultado]);
  }
}
