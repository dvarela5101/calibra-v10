import { procesarCancelacionesDeCita } from "@/lib/citas/cancelar";
import { autorizaProceso } from "@/lib/procesos/autorizacion";

/**
 * HU-024: la llama la base con pg_net cuando anota la cancelación de una cita (al cancelarla el Lead, D-27), y
 * pg_cron cada 5 minutos si quedan cancelaciones sin procesar. Solo con el secreto del proceso programado; a
 * cualquier otro le responde 401 sin decir más.
 */

// Cada correo tarda a lo sumo unas decenas de segundos (tres intentos con timeouts de 10 s).
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!autorizaProceso(request.headers.get("authorization"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    const resumen = await procesarCancelacionesDeCita();
    return Response.json(resumen);
  } catch (error) {
    console.error("[procesos] falló el aviso de cancelaciones de citas:", error instanceof Error ? error.message : error);
    return Response.json({ error: "No se pudo avisar." }, { status: 500 });
  }
}
