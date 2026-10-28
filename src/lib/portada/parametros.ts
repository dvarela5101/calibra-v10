import "server-only";
import { cargarParametros, type ParametrosNegocio } from "@/lib/plazos/parametros";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { configuracionSupabase } from "@/lib/supabase/config";

/**
 * HU-108: los plazos que cita la landing (RN-35, RN-60, RN-62), de `parametros_negocio()`. Con la llave secreta porque quien
 * llega por primera vez todavía no tiene la sesión anónima (nace en el navegador después de cargar) y sin sesión la base no
 * deja leerlos. Son plazos públicos del negocio y esto no lee nada de nadie: la lectura del último diagnóstico sigue siendo la
 * de la persona (M23, `src/lib/diagnostico/ultimo.test.ts`), por eso esto vive aparte de la página.
 *
 * Sin Supabase configurado (el inicio funciona sin variables de entorno) devuelve `null` sin error; con un fallo, `null` y el
 * motivo en el registro del servidor. La landing sale igual y sus textos no dicen cifras.
 */
export async function parametrosParaLaPortada(): Promise<ParametrosNegocio | null> {
  if (!configuracionSupabase() || !process.env.SUPABASE_SECRET_KEY) return null;
  try {
    return await cargarParametros(crearClienteAdmin());
  } catch (fallo) {
    console.error("[portada] no se pudieron leer los plazos:", fallo instanceof Error ? fallo.message : fallo);
    return null;
  }
}
