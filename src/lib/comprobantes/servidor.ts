import "server-only";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { limpiarComprobantesHuerfanos, type ResumenDeLimpieza } from "./limpieza";
import { revisarComprobante, type ResultadoRevision } from "./revision";

/**
 * La puerta del servidor a los comprobantes (HU-059): conecta la revisión y la limpieza con el cliente
 * de la llave secreta. Solo de servidor.
 */

/** Revisa el contenido de un comprobante antes de que un pago lo use (ver `revisarComprobante`). */
export function revisarComprobanteDesdeServidor(ruta: string): Promise<ResultadoRevision> {
  return revisarComprobante(crearClienteAdmin(), ruta);
}

/** Borra los comprobantes huérfanos de más de 24 horas (ver `limpiarComprobantesHuerfanos`). */
export function limpiarComprobantesDesdeServidor(): Promise<ResumenDeLimpieza> {
  return limpiarComprobantesHuerfanos({ cliente: crearClienteAdmin() });
}
