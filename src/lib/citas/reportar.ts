import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import { esResultadoDeReportar, type ResultadoDeReportar } from "./reportar-reglas";
import { tieneFormaDeTokenDeCita } from "./reglas";
import { UUID } from "./servidor";

type Cliente = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Las dos puertas del reporte: el token del correo y la sesión del Lead (HU-029, criterios 1 y 3)
// ---------------------------------------------------------------------------

/** El resultado de la base, o un error si responde algo que no conoce (la página no puede decidir con eso). */
function resultadoDe(data: unknown): ResultadoDeReportar {
  if (!esResultadoDeReportar(data)) throw new Error(`Respuesta inesperada al reportar la inasistencia: ${JSON.stringify(data ?? null)}`);
  return data;
}

/**
 * Reporta que el monitor no asistió a la cita a la que pertenece el token del correo de confirmación (HU-019,
 * D-20). Con la llave secreta: el token es la credencial y la base no lo expone; solo `service_role` puede llamar a
 * `public.reportar_inasistencia_por_token`. Un valor sin forma de token es `no_existe` sin consultar la base. La hora
 * y todo lo demás lo decide la base.
 */
export async function reportarInasistenciaPorToken(token: string): Promise<ResultadoDeReportar> {
  if (!tieneFormaDeTokenDeCita(token)) return "no_existe";
  const { data, error } = await crearClienteAdmin().rpc("reportar_inasistencia_por_token", { p_token: token });
  // El mensaje del error no lleva el token: una falla de la base no deja una credencial en el log.
  if (error) throw new Error(`No se pudo reportar la inasistencia: ${error.message}`);
  return resultadoDe(data);
}

/**
 * Reporta la inasistencia en una cita del Lead de la sesión (el mismo navegador con el que agendó, sin el enlace).
 * Con la sesión de quien mira, sin la llave secreta: la base exige que la cita sea de su Lead y, si no, responde
 * `no_existe`. Un id que no es un uuid es `no_existe` sin consultar.
 */
export async function reportarInasistenciaDeMiCita(cliente: Cliente, idMonitoria: string): Promise<ResultadoDeReportar> {
  if (!UUID.test(idMonitoria)) return "no_existe";
  const { data, error } = await cliente.rpc("reportar_inasistencia_de_mi_cita", { p_id_monitoria: idMonitoria });
  if (error) throw new Error(`No se pudo reportar la inasistencia: ${error.message}`);
  return resultadoDe(data);
}
