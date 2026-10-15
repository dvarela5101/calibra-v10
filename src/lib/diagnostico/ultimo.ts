import "server-only";
import { unstable_rethrow } from "next/navigation";
import { tienePanel } from "@/lib/auth/roles";
import { obtenerSesion } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { leerMiUltimoDiagnostico } from "./lectura";
import type { ResultadoParaMostrar } from "./mostrar";

/**
 * Lo más que la portada espera por la lectura entera (la sesión, el rol y el último diagnóstico). Antes `/` salía de caché
 * aunque Supabase fallara; ahora cada visita con sesión hace tres llamadas, y un servicio que acepta la conexión y no responde
 * dejaría a la persona esperando hasta el límite de la plataforma, sin ver ni el inicio de siempre. Pasado el tope se cae a ese
 * inicio, como con cualquier otro fallo.
 */
export const TOPE_DE_LECTURA_MS = 3000;

/** La lectura sin tope: sesión, rol y último diagnóstico. La señal corta la llamada a la base cuando el tope vence. */
async function leer(senal: AbortSignal): Promise<ResultadoParaMostrar | null> {
  const sesion = await obtenerSesion();
  if (!sesion || tienePanel(sesion.rol)) return null;
  const cliente = await crearClienteServidor();
  if (!cliente) return null;
  return await leerMiUltimoDiagnostico(cliente, senal);
}

/**
 * El último diagnóstico de la sesión de quien abre la portada (HU-011, D-53 d y e), o `null` si la portada debe ser el inicio
 * normal. Es la lectura tolerante de la portada: ningún fallo (sesión, cliente, base, resultado guardado que no cuadra) ni una
 * espera de más de `TOPE_DE_LECTURA_MS` tumba la página ni muestra un error, cae al inicio normal y deja una línea en el
 * registro del servidor (como `/cita`).
 *
 * Va con el cliente DE LA SESIÓN (`crearClienteServidor()`), nunca con la llave secreta: `public.mi_ultimo_diagnostico()` saca
 * al dueño del JWT en la base. La guarda de aquí es una capa más, no la única: sin sesión, o con una cuenta del equipo (admin o
 * monitor, que no son dueños de ningún diagnóstico aunque la política de la tabla les deje leer filas), ni se llama a la base.
 * `anonimo`, `estudiante` y un rol que no se pudo leer pasan: decide la función SQL.
 */
export async function ultimoDiagnosticoDeLaSesion(): Promise<ResultadoParaMostrar | null> {
  const cortar = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    const vencido = new Promise<never>((_, rechazar) => {
      temporizador = setTimeout(() => {
        cortar.abort();
        rechazar(new Error(`La lectura pasó de ${TOPE_DE_LECTURA_MS} ms.`));
      }, TOPE_DE_LECTURA_MS);
    });
    // Si el tope gana, la lectura que sigue en el aire ya no importa: `race` la deja atendida y su rechazo tardío no se pierde.
    return await Promise.race([leer(cortar.signal), vencido]);
  } catch (error) {
    // `cookies()` (en `obtenerSesion`) corta el prerenderizado lanzando un error de Next, y `redirect()` o `notFound()` también:
    // no son fallos de lectura y no se atrapan.
    unstable_rethrow(error);
    // Solo el mensaje (sin contenido: lo garantizan `lectura.ts` y `mostrar.ts`), nunca el objeto de error.
    console.error("[diagnostico] no se pudo leer el último diagnóstico de la sesión:", error instanceof Error ? error.message : "error desconocido");
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}
