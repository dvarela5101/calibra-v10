import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { esResultadoDeFranja, type FranjaParaAdmin, type PedidoDeFranja, type ResultadoDeFranja } from "./franjas-reglas";

type Cliente = SupabaseClient<Database>;

/**
 * Las franjas abiertas con su monitor y si están marcadas de oferta (HU-119). Con la sesión del admin: la base solo devuelve
 * filas a un admin activo. Nada de la llave secreta.
 */
export async function cargarFranjasParaAdmin(cliente: Cliente): Promise<FranjaParaAdmin[]> {
  const { data, error } = await cliente.rpc("franjas_para_admin");
  if (error) throw new Error(`No se pudieron leer las franjas: ${error.code ?? ""} ${error.message}`.trim());
  return (data ?? []).map((f) => ({
    idFranja: f.id_franja,
    nombreMonitor: f.nombre_monitor,
    dia: f.dia,
    hora: f.hora,
    duracionMin: f.duracion_min,
    presencial: f.presencial,
    precio: f.precio,
    dePrueba: f.de_prueba,
  }));
}

/** Marca o quita la marca de oferta de una franja. Quién, cuándo y si se puede lo decide `public.marcar_franja_de_prueba`. */
export async function marcarFranja(cliente: Cliente, pedido: PedidoDeFranja): Promise<ResultadoDeFranja> {
  const { data, error } = await cliente.rpc("marcar_franja_de_prueba", { p_id_franja: pedido.idFranja, p_de_prueba: pedido.dePrueba });
  if (error) throw new Error(`No se pudo cambiar la marca de la franja: ${error.code ?? ""} ${error.message}`.trim());
  if (!esResultadoDeFranja(data)) throw new Error(`Respuesta inesperada al marcar la franja: ${JSON.stringify(data ?? null)}`);
  return data;
}
