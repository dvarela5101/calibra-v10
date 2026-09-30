import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import {
  BUCKET_COMPROBANTES,
  BYTES_PARA_RECONOCER,
  HUERFANO_TRAS_HORAS,
  MENSAJE_CONTENIDO,
  esRutaDeComprobante,
  tipoDeRuta,
  tipoPorContenido,
  type TipoDeComprobante,
} from "./reglas";

type Cliente = SupabaseClient<Database>;

export type MotivoDeRevision = "ruta_invalida" | "no_existe" | "vencido" | "contenido_no_coincide" | "fallo";

export type ResultadoRevision =
  | { ok: true; tipo: TipoDeComprobante }
  | { ok: false; motivo: MotivoDeRevision; mensaje: string };

const MENSAJE_FALLO = "No se pudo revisar el comprobante. Inténtalo de nuevo.";
const MENSAJE_NO_EXISTE = "No encontramos el comprobante. Vuelve a subirlo.";
const MENSAJE_VENCIDO = `Este comprobante se subió hace más de ${HUERFANO_TRAS_HORAS} horas y ya no se puede usar. Vuelve a subirlo.`;

function esNoEncontrado(error: unknown): boolean {
  const { statusCode, status, message } = (error ?? {}) as { statusCode?: string | number; status?: number; message?: string };
  return String(statusCode) === "404" || status === 404 || /not found/i.test(message ?? "");
}

/**
 * Revisa en el servidor el contenido de un comprobante que ya está en el bucket (HU-059, criterio 1).
 * El Storage solo mira el tipo que declara quien sube; aquí se leen los primeros bytes y se exige que
 * coincidan con ese tipo y con la extensión de la ruta.
 *
 * - Si coinciden, anota la ruta en `comprobante_revisado` con `anotar_comprobante_revisado()`. Solo
 *   entonces un pago puede apuntarle: `pago.comprobante` es una llave foránea a esa tabla. La base no
 *   anota un comprobante de más de 24 horas (ya es de la limpieza de huérfanos): responde `vencido`.
 * - Si no coinciden, lo descarta: quita la fila de revisado y borra el archivo con la API de Storage,
 *   salvo que un pago ya lo use. Si el borrado falla, el archivo queda sin revisar (ningún pago puede
 *   usarlo) y la limpieza de huérfanos lo borra después.
 *
 * Necesita el cliente de la llave secreta (`crearClienteAdmin()`): la tabla de revisados solo la toca
 * `service_role`. Quien cree el pago (HU-018) la llama antes de insertarlo y comprueba antes con
 * `rutaEsDelUsuario()` que la ruta sea del pagador.
 */
export async function revisarComprobante(cliente: Cliente, ruta: string): Promise<ResultadoRevision> {
  const tipoEsperado = tipoDeRuta(ruta);
  if (!esRutaDeComprobante(ruta) || !tipoEsperado) {
    return { ok: false, motivo: "ruta_invalida", mensaje: "La ruta del comprobante no es válida." };
  }

  const bucket = cliente.storage.from(BUCKET_COMPROBANTES);
  const descarga = await bucket.download(ruta);
  if (descarga.error || !descarga.data) {
    return esNoEncontrado(descarga.error)
      ? { ok: false, motivo: "no_existe", mensaje: MENSAJE_NO_EXISTE }
      : { ok: false, motivo: "fallo", mensaje: MENSAJE_FALLO };
  }

  // El tipo que guardó el Storage al subir (el que declaró quien subió), sin parámetros.
  const declarado = descarga.data.type.split(";")[0].trim().toLowerCase();
  const inicio = new Uint8Array(await descarga.data.slice(0, BYTES_PARA_RECONOCER).arrayBuffer());
  const real = tipoPorContenido(inicio);

  if (real !== null && real === declarado && real === tipoEsperado) {
    const { data, error } = await cliente.rpc("anotar_comprobante_revisado", { p_ruta: ruta, p_tipo: real });
    if (error) return { ok: false, motivo: "fallo", mensaje: MENSAJE_FALLO };
    if (data === "anotado") return { ok: true, tipo: real };
    if (data === "vencido") return { ok: false, motivo: "vencido", mensaje: MENSAJE_VENCIDO };
    if (data === "no_existe") return { ok: false, motivo: "no_existe", mensaje: MENSAJE_NO_EXISTE };
    return { ok: false, motivo: "fallo", mensaje: MENSAJE_FALLO };
  }

  // Descartar. Primero la fila de revisado: si un pago ya la usa, la llave foránea lo impide (23503) y el
  // archivo se conserva, porque es la evidencia de ese pago. Solo pasa si el contenido cambió después de
  // revisarlo, el caso que cierra HU-067.
  const sinRevision = await cliente.from("comprobante_revisado").delete().eq("ruta", ruta);
  if (sinRevision.error?.code === "23503") return { ok: false, motivo: "contenido_no_coincide", mensaje: MENSAJE_CONTENIDO };
  if (sinRevision.error) return { ok: false, motivo: "fallo", mensaje: MENSAJE_FALLO };

  const borrado = await bucket.remove([ruta]);
  if (borrado.error) {
    console.error("[comprobantes] no se pudo borrar un comprobante descartado; lo borrará la limpieza:", ruta);
  }
  return { ok: false, motivo: "contenido_no_coincide", mensaje: MENSAJE_CONTENIDO };
}
