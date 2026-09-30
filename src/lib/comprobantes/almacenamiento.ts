import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import {
  BUCKET_COMPROBANTES,
  BYTES_PARA_RECONOCER,
  MENSAJE_TIPO,
  VIGENCIA_ENLACE_COMPROBANTE_SEG,
  mensajeDeCuota,
  rutaDeComprobante,
  validarComprobante,
} from "./reglas";

type Cliente = SupabaseClient<Database>;

export type ResultadoSubida = { ok: true; ruta: string } | { ok: false; mensaje: string };
export type ResultadoEnlace = { ok: true; url: string } | { ok: false; mensaje: string };

const MENSAJE_GENERICO = "No se pudo subir el comprobante. Inténtalo de nuevo.";

/** Traduce el error del Storage a un mensaje para la persona. */
export function mensajeDeSubida(error: { message: string; statusCode?: string | number }): string {
  const codigo = String(error.statusCode ?? "");
  const texto = error.message.toLowerCase();
  if (codigo === "413" || texto.includes("maximum allowed size") || texto.includes("too large")) {
    return "El comprobante es demasiado pesado. Comprime la imagen o toma otra captura.";
  }
  if (codigo === "415" || texto.includes("mime type")) return MENSAJE_TIPO;
  // El trigger de la cuota (HU-059) rechaza con check_violation; el Storage lo devuelve como error de base.
  if (texto.includes("23514")) return mensajeDeCuota();
  if (texto.includes("row-level security") || codigo === "403" || codigo === "401") {
    return "No tienes permiso para subir este comprobante. Recarga la página e inténtalo de nuevo.";
  }
  return MENSAJE_GENERICO;
}

export type UsoDeCuota = { usados: number; maximo: number; libreDesde: Date | null };

/**
 * Cuántos comprobantes subió la sesión de `cliente` en la ventana de la cuota (HU-059). Devuelve null si
 * no se pudo saber: la subida sigue, porque la base hace cumplir la cuota de todas formas.
 */
export async function consultarCuota(cliente: Cliente): Promise<UsoDeCuota | null> {
  const { data, error } = await cliente.rpc("mi_cuota_de_comprobantes").maybeSingle();
  if (error || !data) return null;
  return { usados: data.usados, maximo: data.maximo, libreDesde: data.libre_desde ? new Date(data.libre_desde) : null };
}

/**
 * Sube un comprobante a la carpeta de `idUsuario` (el pagador, con la sesión de `cliente`) en el
 * bucket privado. Valida antes tipo, tamaño y contenido, y que la sesión no haya usado su cuota; el
 * Storage y la base vuelven a hacer cumplir todo eso por su cuenta. No sobrescribe: cada subida es un
 * archivo nuevo. Devuelve la ruta que después se guarda en `pago.comprobante`, una vez que el servidor
 * revise el contenido (`revisarComprobante`).
 */
export async function subirComprobante(cliente: Cliente, idUsuario: string, archivo: File): Promise<ResultadoSubida> {
  let inicio: Uint8Array;
  try {
    inicio = new Uint8Array(await archivo.slice(0, BYTES_PARA_RECONOCER).arrayBuffer());
  } catch {
    return { ok: false, mensaje: "No se pudo leer el archivo. Vuelve a elegirlo." };
  }

  const validacion = validarComprobante(archivo, inicio);
  if (!validacion.ok) return validacion;

  const cuota = await consultarCuota(cliente);
  if (cuota && cuota.usados >= cuota.maximo) return { ok: false, mensaje: mensajeDeCuota(cuota.maximo, cuota.libreDesde) };

  const ruta = rutaDeComprobante(idUsuario, validacion.extension);
  const { error } = await cliente.storage.from(BUCKET_COMPROBANTES).upload(ruta, archivo, {
    contentType: validacion.tipo,
    upsert: false,
  });
  if (error) return { ok: false, mensaje: mensajeDeSubida(error as { message: string; statusCode?: string }) };
  return { ok: true, ruta };
}

/**
 * Enlace firmado de corta vida a un comprobante. Solo lo consigue quien pueda leer el archivo
 * (su dueño o un admin); para los demás falla aunque conozcan la ruta.
 */
export async function crearEnlaceDeComprobante(
  cliente: Cliente,
  ruta: string,
  vigenciaSeg: number = VIGENCIA_ENLACE_COMPROBANTE_SEG,
): Promise<ResultadoEnlace> {
  const { data, error } = await cliente.storage.from(BUCKET_COMPROBANTES).createSignedUrl(ruta, vigenciaSeg);
  if (error || !data?.signedUrl) return { ok: false, mensaje: "No se pudo abrir el comprobante." };
  return { ok: true, url: data.signedUrl };
}

/**
 * Lo que hace un admin al abrir un pago: lee la ruta de `pago.comprobante` (solo los admins
 * leen pagos) y pide el enlace firmado. Ni el enlace ni la ruta se guardan: se pide uno nuevo
 * cada vez que se abre el pago.
 */
export async function enlaceDeComprobanteDePago(
  cliente: Cliente,
  idPago: string,
  vigenciaSeg: number = VIGENCIA_ENLACE_COMPROBANTE_SEG,
): Promise<ResultadoEnlace> {
  const { data, error } = await cliente.from("pago").select("comprobante").eq("id", idPago).maybeSingle();
  if (error || !data) return { ok: false, mensaje: "No se encontró el pago." };
  return crearEnlaceDeComprobante(cliente, data.comprobante, vigenciaSeg);
}
