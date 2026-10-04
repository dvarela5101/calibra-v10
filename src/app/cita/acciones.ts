"use server";

import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/auth/sesion";
import { cancelarCitaPorToken, cancelarMiCita } from "@/lib/citas/cancelar";
import { mensajeDeCancelar, type ResultadoDeCancelar } from "@/lib/citas/cancelar-reglas";
import { rutaDeCita, rutaDeMiCita } from "@/lib/citas/reglas";
import { resumenDeError } from "@/lib/leads/reglas";
import { identidadDelProveedor } from "@/lib/pagos/configuracion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-024: el Lead cancela su monitoría individual, con el enlace del correo (campo `token`) o con la sesión del
 * navegador (campo `id`). Esta acción se puede llamar con un POST directo, así que no se fía del botón: si la
 * cita cabe o no (confirmada, individual, dentro del plazo, de este Lead) y qué reembolsos se crean lo decide la
 * base en una sola transacción, con su propia hora. Aquí solo se elige la puerta y se traduce el resultado.
 */
export type EstadoCancelar = { error: string | null };

const MENSAJE_FALLO = "No pudimos cancelar tu monitoría. Intenta de nuevo.";

const campo = (datos: FormData, nombre: string) => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor.trim() : "";
};

/** La puerta que corresponde al campo que llegó: el token del correo o el id de la cita de la sesión. */
async function cancelarPorLaPuerta(token: string, id: string): Promise<ResultadoDeCancelar> {
  // Una sola puerta por llamada: sin ninguna o con las dos no hay una cita de la que responder.
  if (Boolean(token) === Boolean(id)) return "no_existe";
  if (token) return cancelarCitaPorToken(token);

  // Con la sesión del Lead, no con la llave secreta: la base compara la cita con quien hace la petición.
  const sesion = await obtenerSesion();
  const supabase = await crearClienteServidor();
  if (!sesion || !supabase) return "no_existe";
  return cancelarMiCita(supabase, id);
}

export async function cancelarCita(_anterior: EstadoCancelar, datos: FormData): Promise<EstadoCancelar> {
  const token = campo(datos, "token");
  const id = campo(datos, "id");

  let resultado: ResultadoDeCancelar;
  try {
    resultado = await cancelarPorLaPuerta(token, id);
  } catch (error) {
    // Solo el mensaje: el token nunca va al registro. También cae aquí una respuesta de la base que no se conoce.
    console.error("[citas] no se pudo cancelar la cita:", resumenDeError(error));
    return { error: MENSAJE_FALLO };
  }

  // `redirect` lanza: va fuera del `try`. Cancelada (ahora o antes) la página ya cuenta qué pasó con la cita y el
  // reembolso; `replace` para no dejar la misma dirección dos veces en el historial.
  if (resultado === "cancelada" || resultado === "ya_cancelada") {
    redirect(token ? rutaDeCita(token) : rutaDeMiCita(id), "replace");
  }
  return { error: mensajeDeCancelar(resultado, identidadDelProveedor().correo) ?? MENSAJE_FALLO };
}
