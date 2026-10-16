import type { SupabaseClient } from "@supabase/supabase-js";
import { formatearPesos } from "@/lib/moneda";
import type { Database } from "@/lib/supabase/tipos";
import { cargarParametrosComision, type ParametrosComision } from "./parametros";

/**
 * HU-096 (D-71 b): la regla general de la comisión, la que lee el monitor invitado en el registro. Solo dice el
 * porcentaje y el tope: ningún monto de una monitoría ni de un desembolso, ningún ejemplo, y no promete plazo ni
 * ganancia. Es una sola plantilla: si asesoría la cambia (pregunta 4), se cambia aquí y en su prueba.
 *
 * Las cifras no están escritas en la app: llegan de `public.parametros_comision()` (RN-81), la misma fuente con la que
 * el servidor calcula el desembolso (N-2). Esto no calcula ninguna comisión.
 */
export function textoDeLaReglaDeComision({ comisionPorcentaje, comisionTope }: ParametrosComision): string {
  return (
    `Por cada monitoría, Calibra descuenta una comisión del ${comisionPorcentaje} % del total pagado, ` +
    `con un máximo de ${formatearPesos(comisionTope)}. Se descuenta de lo que te transferimos.`
  );
}

/**
 * Lee los parámetros de la comisión y arma la línea del registro. Necesita el cliente de la llave secreta
 * (`crearClienteAdmin()`, solo servidor); con otra sesión la base responde 42501 y esto lanza.
 */
export async function describirReglaDeComision(cliente: SupabaseClient<Database>): Promise<string> {
  return textoDeLaReglaDeComision(await cargarParametrosComision(cliente));
}
