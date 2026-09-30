import { limpiarComprobantesDesdeServidor } from "@/lib/comprobantes/servidor";
import { autorizaProceso } from "@/lib/procesos/autorizacion";

/**
 * HU-059: la llama pg_cron (con pg_net) cada hora para borrar los comprobantes que llevan más de 24
 * horas sin que ningún pago los use. Solo con el secreto del proceso programado; a cualquier otro le
 * responde 401 sin decir más.
 */

// Hasta 10 lotes de 100 borrados con la API de Storage.
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!autorizaProceso(request.headers.get("authorization"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    const resumen = await limpiarComprobantesDesdeServidor();
    return Response.json(resumen);
  } catch (error) {
    console.error("[procesos] falló la limpieza de comprobantes:", error instanceof Error ? error.message : error);
    return Response.json({ error: "No se pudo limpiar." }, { status: 500 });
  }
}
