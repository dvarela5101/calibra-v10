"use server";

import { refresh } from "next/cache";
import { esUuid } from "@/lib/agendar/reglas";
import { obtenerSesion } from "@/lib/auth/sesion";
import { rutaEsDelUsuario } from "@/lib/comprobantes/reglas";
import type { ResultadoRevision } from "@/lib/comprobantes/revision";
import { revisarComprobanteDesdeServidor } from "@/lib/comprobantes/servidor";
import { resumenDeError } from "@/lib/leads/reglas";
import { identidadDelProveedor } from "@/lib/pagos/configuracion";
import { mensajeDeRegistroPago, validarPagador } from "@/lib/pagos/reglas";
import { registrarPago, type RegistroDePago } from "@/lib/pagos/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-018: el Lead paga por Llave y adjunta el comprobante. El archivo nunca pasa por aquí (las acciones
 * aceptan hasta 1 MB y un comprobante puede pesar 10): el navegador lo sube al Storage, en la carpeta de su
 * sesión, y manda solo la `ruta`. Esta acción se puede llamar con un POST directo, así que vuelve a
 * comprobar todo: la sesión, que la ruta sea de su carpeta (criterio 7) y el contenido del archivo. Si la
 * reserva es suya, sigue vigente y el comprobante existe lo decide la base (`public.registrar_pago`).
 * `valores` devuelve lo escrito para no vaciar el formulario.
 */
export type EstadoPago = { error: string | null; valores?: { nombre: string; correo: string } };

const MENSAJE_FALLO = "No pudimos recibir tu comprobante. Intenta de nuevo.";

const campo = (datos: FormData, nombre: string) => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : "";
};

export async function pagar(_anterior: EstadoPago, datos: FormData): Promise<EstadoPago> {
  const valores = { nombre: campo(datos, "nombre"), correo: campo(datos, "correo") };
  const fallo = (error: string): EstadoPago => ({ error, valores });

  const sesion = await obtenerSesion();
  if (!sesion) return fallo(mensajeDeRegistroPago("sin_sesion"));

  const idMonitoria = campo(datos, "idMonitoria").trim().toLowerCase();
  if (!esUuid(idMonitoria)) return fallo(mensajeDeRegistroPago("no_es_tuya"));

  const pagador = validarPagador(valores);
  if (!pagador.ok) return fallo(pagador.mensaje);

  // Antes de revisar con la llave secreta: que nadie apunte su pago al comprobante de otra persona.
  const ruta = campo(datos, "ruta");
  if (!rutaEsDelUsuario(sesion.idUsuario, ruta)) return fallo(mensajeDeRegistroPago("comprobante_ajeno"));

  let revision: ResultadoRevision;
  try {
    revision = await revisarComprobanteDesdeServidor(ruta);
  } catch (error) {
    console.error("[pagos] no se pudo revisar el comprobante:", resumenDeError(error));
    return fallo(MENSAJE_FALLO);
  }
  if (!revision.ok) return fallo(revision.mensaje);

  // El cliente de la sesión, no el de la llave secreta: la base paga a nombre de `auth.uid()`.
  const supabase = await crearClienteServidor();
  if (!supabase) return fallo(MENSAJE_FALLO);

  let registro: RegistroDePago;
  try {
    registro = await registrarPago(supabase, { idMonitoria, ruta, nombre: pagador.nombre, correo: pagador.correo });
  } catch (error) {
    console.error("[pagos] no se pudo registrar el pago:", resumenDeError(error));
    return fallo(MENSAJE_FALLO);
  }

  if (registro.resultado === "registrado") {
    // La monitoría quedó confirmada: la página se vuelve a pintar en la misma respuesta. `refresh` y no
    // `revalidatePath`, porque la página no tiene nada en caché (lee la sesión en cada petición).
    refresh();
    return { error: null };
  }
  if (registro.resultado === "sin_admin") {
    // HU-054 supone que siempre hay un admin activo: si no, el equipo tiene que enterarse.
    console.error("[pagos] no hay ningún admin activo para asignar el pago");
  }
  return fallo(mensajeDeRegistroPago(registro.resultado, identidadDelProveedor().correo));
}
