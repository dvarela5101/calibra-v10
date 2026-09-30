import { autorizaProceso, reintentarCorreosDesdeServidor } from "@/lib/correo/procesos";

/**
 * HU-065: la llama pg_cron (con pg_net) cada 10 minutos para reintentar los correos que fallaron.
 * Solo con el secreto del proceso programado; a cualquier otro le responde 401 sin decir más.
 */

// Cada correo tarda a lo sumo unas decenas de segundos (tres intentos con timeouts de 10 s).
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!autorizaProceso(request.headers.get("authorization"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    const resumen = await reintentarCorreosDesdeServidor();
    return Response.json(resumen);
  } catch (error) {
    console.error("[procesos] falló el reintento de correos:", error instanceof Error ? error.message : error);
    return Response.json({ error: "No se pudo reintentar." }, { status: 500 });
  }
}
