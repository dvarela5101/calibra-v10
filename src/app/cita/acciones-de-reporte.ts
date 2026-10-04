"use server";

import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/auth/sesion";
import { reportarInasistenciaDeMiCita, reportarInasistenciaPorToken } from "@/lib/citas/reportar";
import { mensajeDeReportar, type ResultadoDeReportar } from "@/lib/citas/reportar-reglas";
import { rutaDeCita, rutaDeMiCita } from "@/lib/citas/reglas";
import { resumenDeError } from "@/lib/leads/reglas";
import { identidadDelProveedor } from "@/lib/pagos/configuracion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-029: el Lead reporta que el monitor no llegó, con el enlace del correo (campo `token`) o con la sesión del
 * navegador (campo `id`). Va en un archivo aparte de `acciones.ts` (cancelar, HU-024). Esta acción se puede llamar
 * con un POST directo, así que no se fía del botón: si la cita se puede reportar (individual, confirmada o realizada,
 * ya empezada, dentro de las 24 h siguientes al fin, sin reporte previo, de este Lead) lo decide la base en una sola
 * transacción, con su propia hora. Aquí solo se elige la puerta y se traduce el resultado.
 */
export type EstadoReportar = { error: string | null };

const MENSAJE_FALLO = "No pudimos enviar tu reporte. Intenta de nuevo.";

const campo = (datos: FormData, nombre: string) => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor.trim() : "";
};

/** La puerta que corresponde al campo que llegó: el token del correo o el id de la cita de la sesión. */
async function reportarPorLaPuerta(token: string, id: string): Promise<ResultadoDeReportar> {
  // Una sola puerta por llamada: sin ninguna o con las dos no hay una cita de la que responder.
  if (Boolean(token) === Boolean(id)) return "no_existe";
  if (token) return reportarInasistenciaPorToken(token);

  // Con la sesión del Lead, no con la llave secreta: la base compara la cita con quien hace la petición.
  const sesion = await obtenerSesion();
  const supabase = await crearClienteServidor();
  if (!sesion || !supabase) return "no_existe";
  return reportarInasistenciaDeMiCita(supabase, id);
}

export async function reportarInasistencia(_anterior: EstadoReportar, datos: FormData): Promise<EstadoReportar> {
  const token = campo(datos, "token");
  const id = campo(datos, "id");

  let resultado: ResultadoDeReportar;
  try {
    resultado = await reportarPorLaPuerta(token, id);
  } catch (error) {
    // Solo el mensaje: el token nunca va al registro. También cae aquí una respuesta de la base que no se conoce.
    console.error("[citas] no se pudo reportar la inasistencia:", resumenDeError(error));
    return { error: MENSAJE_FALLO };
  }

  if (resultado === "sin_admin") {
    // Sin ningún admin activo el reporte no se crea: el equipo tiene que enterarse.
    console.error("[citas] no hay ningún admin activo para asignar el reporte de inasistencia");
  }

  // `redirect` lanza: va fuera del `try`. Reportada (ahora o antes) la página ya muestra el estado del reporte;
  // `replace` para no dejar la misma dirección dos veces en el historial.
  if (resultado === "reportada" || resultado === "ya_reportada") {
    redirect(token ? rutaDeCita(token) : rutaDeMiCita(id), "replace");
  }
  return { error: mensajeDeReportar(resultado, identidadDelProveedor().correo) ?? MENSAJE_FALLO };
}
