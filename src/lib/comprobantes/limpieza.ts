import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { BUCKET_COMPROBANTES } from "./reglas";

type Cliente = SupabaseClient<Database>;

export type ResumenDeLimpieza = {
  /** Rutas que la base entregó como huérfanas. */
  tomados: number;
  /** Archivos que el Storage confirmó borrados. */
  borrados: number;
  /** Tomados que no se pudieron borrar: siguen huérfanos y la próxima pasada los vuelve a tomar. */
  fallidos: number;
};

export type OpcionesDeLimpieza = {
  cliente: Cliente;
  /** Cuántas rutas toma por vuelta. */
  lote?: number;
  /** Vueltas como máximo en una misma corrida, para que un proceso programado no se alargue. */
  maxLotes?: number;
};

/**
 * Borra los comprobantes que llevan más de 24 horas sin que ningún pago los use (HU-059, criterio 2,
 * decisión N-4). La base elige cuáles con su propio reloj (`tomar_comprobantes_huerfanos()`, que en la
 * misma sentencia les quita la fila de revisado para que ningún pago nuevo les apunte) y el archivo se
 * borra con la API de Storage: por SQL lo bloquea `storage.protect_delete`. Un comprobante que un pago
 * usa nunca aparece.
 *
 * Necesita el cliente de la llave secreta. La corre cada hora el proceso programado
 * (`/api/procesos/limpiar-comprobantes`).
 */
export async function limpiarComprobantesHuerfanos(opciones: OpcionesDeLimpieza): Promise<ResumenDeLimpieza> {
  const { cliente, lote = 100, maxLotes = 10 } = opciones;
  const resumen: ResumenDeLimpieza = { tomados: 0, borrados: 0, fallidos: 0 };

  for (let vuelta = 0; vuelta < maxLotes; vuelta++) {
    const { data, error } = await cliente.rpc("tomar_comprobantes_huerfanos", { p_limite: lote });
    if (error) throw new Error(`No se pudieron tomar los comprobantes huérfanos: ${error.message}`);
    const rutas = (data ?? []).map((fila) => fila.ruta);
    if (rutas.length === 0) break;
    resumen.tomados += rutas.length;

    const borrado = await cliente.storage.from(BUCKET_COMPROBANTES).remove(rutas);
    const borrados = borrado.error ? 0 : (borrado.data ?? []).length;
    resumen.borrados += borrados;
    resumen.fallidos += rutas.length - borrados;

    // Si el Storage no borró nada, otra vuelta tomaría las mismas rutas: se deja para la próxima corrida.
    if (borrados === 0 || rutas.length < lote) break;
  }
  return resumen;
}
