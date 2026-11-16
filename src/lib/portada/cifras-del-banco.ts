import "server-only";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { configuracionSupabase } from "@/lib/supabase/config";
import { cifrasParaLaPortada, type CifrasDelBanco } from "./cifras";

/**
 * HU-134: las cifras del banco que cita la portada, de `cifras_del_banco()` (materias con Evaluación activa, preguntas revisadas
 * que el diagnóstico puede servir y errores típicos en ellas). La función devuelve solo esos tres números y está abierta al
 * visitante; se llama con la llave secreta, como los plazos de la portada, porque quien llega por primera vez aún no tiene sesión.
 *
 * Nunca lanza: sin Supabase configurado, con un fallo o con alguna cifra en cero devuelve `null` (el motivo, si hubo, queda en
 * el registro del servidor) y la portada dice la frase sin números. No se cachea: es un conteo barato y la página ya es
 * dinámica en cada petición.
 */
export async function cifrasDelBancoParaLaPortada(): Promise<CifrasDelBanco | null> {
  if (!configuracionSupabase() || !process.env.SUPABASE_SECRET_KEY) return null;
  try {
    const { data, error } = await crearClienteAdmin().rpc("cifras_del_banco");
    if (error) throw new Error(error.code || "sin código");
    const fila = data?.[0];
    return cifrasParaLaPortada(fila ? { materias: fila.materias, preguntas: fila.preguntas, errores: fila.errores } : null);
  } catch (fallo) {
    console.error("[portada] no se pudieron leer las cifras del banco:", fallo instanceof Error ? fallo.message : fallo);
    return null;
  }
}
