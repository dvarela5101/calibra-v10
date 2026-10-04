import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { esUuid } from "@/lib/agendar/reglas";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import {
  esResultadoDeEntregar,
  esResultadoDeReabrir,
  llaveDeFila,
  tieneFormaDeTokenDeLlave,
  type LlaveDeReembolso,
  type ResultadoDeEntregar,
  type ResultadoDeReabrir,
} from "./reglas";

type Cliente = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// La página de la llave: el token del correo es la credencial (criterios 1 a 3 de HU-025)
// ---------------------------------------------------------------------------

/**
 * Lo que muestra la página del enlace: el estado para la vista, el monto, el motivo y hasta cuándo se puede entregar.
 * `null` si el token no tiene forma de token o no es de ningún reembolso: la página responde igual a los dos. Con la
 * llave secreta, porque el token es la credencial y la base no lo expone (`public.datos_de_llave` es solo de
 * `service_role`). Nunca trae la llave ni el contacto (criterio 3).
 */
export async function leerLlavePorToken(token: string): Promise<LlaveDeReembolso | null> {
  if (!tieneFormaDeTokenDeLlave(token)) return null;
  const { data, error } = await crearClienteAdmin().rpc("datos_de_llave", { p_token: token });
  // El mensaje del error no lleva el token: una falla de la base no deja una credencial en el log.
  if (error) throw new Error(`No se pudo leer el reembolso: ${error.message}`);
  const fila = data?.[0];
  return fila ? llaveDeFila(fila) : null;
}

/**
 * Guarda la llave del reembolso al que pertenece el token (criterio 2): la base la normaliza, la revisa, la guarda y
 * pasa el reembolso a `pendiente` en el mismo UPDATE, con su hora (el plazo de P-10 con el borde de P-40). Un valor sin
 * forma de token es `no_existe` sin consultar. Ni la llave ni el token van a ningún mensaje de error.
 */
export async function entregarLlavePorToken(token: string, llave: string): Promise<ResultadoDeEntregar> {
  if (!tieneFormaDeTokenDeLlave(token)) return "no_existe";
  const { data, error } = await crearClienteAdmin().rpc("entregar_llave", { p_token: token, p_llave: llave });
  if (error) throw new Error(`No se pudo guardar la llave: ${error.message}`);
  if (!esResultadoDeEntregar(data)) throw new Error(`Respuesta inesperada al guardar la llave: ${JSON.stringify(data ?? null)}`);
  return data;
}

// ---------------------------------------------------------------------------
// El admin reabre un caso cerrado (criterio 5, supuesto 4)
// ---------------------------------------------------------------------------

/**
 * Reabre un reembolso que se cerró sin llave: vuelven a correr los 7 días y la base anota el correo con el mismo enlace.
 * Con la sesión del admin, sin la llave secreta: la base exige un admin activo y usa su propia hora. Un id que no es un
 * uuid es `no_encontrado` sin consultar.
 */
export async function reabrirReembolso(cliente: Cliente, idReembolso: string): Promise<ResultadoDeReabrir> {
  if (!esUuid(idReembolso)) return "no_encontrado";
  const { data, error } = await cliente.rpc("reabrir_reembolso", { p_id_reembolso: idReembolso });
  if (error) throw new Error(`No se pudo reabrir el reembolso: ${error.message}`);
  if (!esResultadoDeReabrir(data)) throw new Error(`Respuesta inesperada al reabrir el reembolso: ${JSON.stringify(data ?? null)}`);
  return data;
}
