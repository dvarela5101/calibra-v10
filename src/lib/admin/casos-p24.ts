import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { esResultadoDelCierre, type PedidoDeCierre, type ResultadoDelCierre } from "./casos-p24-reglas";

/**
 * Cerrar un caso P-24 (HU-078) con la sesión del admin. Nada de la llave secreta: `public.cerrar_caso_p24` toma la
 * identidad de la sesión (`auth.uid()`, que tiene que ser un admin activo) y la hora de la base, bloquea la monitoría
 * y el pago, y vuelve a mirar que el pago siga siendo un caso abierto.
 */

type Cliente = SupabaseClient<Database>;

/** Cierra el caso como cobrado o asumido, con la nota si la hay (sin vuelta atrás, D-38). */
export async function cerrarCasoP24(cliente: Cliente, pedido: PedidoDeCierre): Promise<ResultadoDelCierre> {
  const { data, error } = await cliente.rpc("cerrar_caso_p24", {
    p_id_pago: pedido.idPago,
    p_cierre: pedido.cierre,
    ...(pedido.nota ? { p_nota: pedido.nota } : {}),
  });
  // Solo el código y el mensaje: el detalle de PostgREST podría traer la fila, con el contacto del pagador.
  if (error) throw new Error(`No se pudo cerrar el caso: ${error.code ?? ""} ${error.message}`.trim());
  if (!esResultadoDelCierre(data)) throw new Error(`Respuesta inesperada al cerrar el caso: ${JSON.stringify(data ?? null)}`);
  return data;
}
