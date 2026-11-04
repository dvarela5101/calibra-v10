import type { SupabaseClient } from "@supabase/supabase-js";
import type { GananciaDeMuestra } from "@/lib/portada/agenda-de-muestra";
import type { Database } from "@/lib/supabase/tipos";
import { calcularMontoNeto } from "./motor";
import { cargarParametrosComision, type ParametrosComision } from "./parametros";

/** Las semanas del ejemplo de la landing de monitores (HU-121). */
const SEMANAS_DEL_EJEMPLO = 4;

/**
 * HU-121 (D-87): lo que recibe el monitor en el ejemplo fijo de `/quiero-ser-monitor`. Devuelve solo netos: la landing no ve el
 * porcentaje, el tope ni lo que se queda Calibra. La cuenta es la del motor (N-2), con los parámetros de la base (RN-81), así que
 * al cambiar un parámetro cambia el ejemplo sin tocar la landing.
 */
export function calcularEjemploDeGanancia(monitorias: readonly { clave: string; precio: number }[], p: ParametrosComision): GananciaDeMuestra {
  const porMonitoria = Object.fromEntries(monitorias.map(({ clave, precio }) => [clave, calcularMontoNeto(precio, p)]));
  const porSemana = Object.values(porMonitoria).reduce((suma, neto) => suma + neto, 0);
  return { porMonitoria, porSemana, porCuatroSemanas: porSemana * SEMANAS_DEL_EJEMPLO };
}

/**
 * Lee los parámetros y arma el ejemplo. Necesita el cliente de la llave secreta (`crearClienteAdmin()`, solo servidor); con otra
 * sesión la base responde 42501 y esto lanza. Solo la página de `/quiero-ser-monitor` lo usa (`pruebas/comision-solo-en-desembolsos.test.ts`, regla H).
 */
export async function cargarEjemploDeGanancia(
  cliente: SupabaseClient<Database>,
  monitorias: readonly { clave: string; precio: number }[],
): Promise<GananciaDeMuestra> {
  return calcularEjemploDeGanancia(monitorias, await cargarParametrosComision(cliente));
}
