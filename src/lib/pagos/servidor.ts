import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { esResultadoRegistroPago, type ResultadoRegistroPago } from "./reglas";

/**
 * Registrar el pago con la sesión de quien paga (HU-018). Nada de la llave secreta: `public.registrar_pago`
 * toma la identidad de la sesión (`auth.uid()`, que tiene que ser la del Lead de la monitoría) y la hora de
 * la base, pone el monto y el admin, y confirma la monitoría (RN-38). Quien llama ya comprobó que la ruta es
 * de la carpeta del usuario y ya revisó el comprobante (`revisarComprobanteDesdeServidor`).
 */

type Cliente = SupabaseClient<Database>;

export type RegistroDePago = { resultado: ResultadoRegistroPago; idPago: string | null };

export type DatosDelPago = { idMonitoria: string; ruta: string; nombre: string; correo: string };

export async function registrarPago(cliente: Cliente, datos: DatosDelPago): Promise<RegistroDePago> {
  const { data, error } = await cliente.rpc("registrar_pago", {
    p_id_monitoria: datos.idMonitoria,
    p_comprobante: datos.ruta,
    p_nombre: datos.nombre,
    p_contacto: datos.correo,
  });
  // Solo el código y el mensaje: el detalle de PostgREST podría traer la fila, con el nombre o el correo.
  if (error) throw new Error(`No se pudo registrar el pago: ${error.code ?? ""} ${error.message}`.trim());
  const fila = data?.[0];
  if (!fila || !esResultadoRegistroPago(fila.resultado)) {
    throw new Error(`Respuesta inesperada al registrar el pago: ${JSON.stringify(fila?.resultado ?? null)}`);
  }
  // El tipo generado dice string, pero la función devuelve null en todo resultado distinto de "registrado".
  return { resultado: fila.resultado, idPago: fila.id_pago ?? null };
}
