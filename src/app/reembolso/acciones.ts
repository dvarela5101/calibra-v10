"use server";

import { redirect } from "next/navigation";
import { resumenDeError } from "@/lib/leads/reglas";
import {
  MENSAJE_ENLACE_QUE_NO_SIRVE,
  MENSAJE_FALLO_AL_ENTREGAR,
  MENSAJES_DE_ENTREGAR,
  normalizarLlave,
  rutaDeLlave,
  tieneFormaDeTokenDeLlave,
  validarLlaveDeReembolso,
  vuelveALaPagina,
  type ResultadoDeEntregar,
} from "@/lib/reembolsos/reglas";
import { entregarLlavePorToken } from "@/lib/reembolsos/servidor";

/**
 * HU-025 (criterio 2): quien pagó entrega la llave de su reembolso con el enlace del correo. El token es la única
 * credencial y esta acción se puede llamar con un POST directo, así que no se fía del formulario: si el reembolso
 * todavía espera la llave, si el plazo de P-10 sigue abierto y si la llave sirve lo decide la base con su hora, en el
 * mismo UPDATE que la guarda. Aquí se normaliza y se revisa la llave para responder rápido, y se traduce el resultado.
 * `valor` devuelve lo escrito para no vaciar el campo tras un error.
 */
export type EstadoEntregar = { error: string | null; valor: string };

export async function entregarLlave(_anterior: EstadoEntregar, datos: FormData): Promise<EstadoEntregar> {
  const campoToken = datos.get("token");
  const token = typeof campoToken === "string" ? campoToken.trim() : "";
  const llave = normalizarLlave(datos.get("llave"));
  if (!tieneFormaDeTokenDeLlave(token)) return { error: MENSAJE_ENLACE_QUE_NO_SIRVE, valor: llave };

  const invalida = validarLlaveDeReembolso(llave);
  if (invalida) return { error: invalida, valor: llave };

  let resultado: ResultadoDeEntregar;
  try {
    resultado = await entregarLlavePorToken(token, llave);
  } catch (error) {
    // Solo el mensaje: ni el token ni la llave van al registro. También cae aquí una respuesta de la base que no se conoce.
    console.error("[reembolsos] no se pudo guardar la llave:", resumenDeError(error));
    return { error: MENSAJE_FALLO_AL_ENTREGAR, valor: llave };
  }

  // `redirect` lanza: va fuera del `try`. Con la llave guardada (ahora o antes) o el caso cerrado, la página ya cuenta
  // qué pasó. Volver a ella saca la llave del estado del navegador, y `replace` no deja la misma dirección dos veces en
  // el historial.
  if (vuelveALaPagina(resultado)) redirect(rutaDeLlave(token), "replace");
  return { error: MENSAJES_DE_ENTREGAR[resultado], valor: llave };
}
