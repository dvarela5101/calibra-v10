import { procesarConfirmacionesDeCita } from "@/lib/citas/servidor";
import { autorizaProceso } from "@/lib/procesos/autorizacion";

/**
 * HU-019: la llama la base con pg_net cuando anota una confirmación de cita (al pasar una individual a
 * `confirmada`, P-04), y pg_cron cada 5 minutos si quedan confirmaciones sin procesar. Solo con el secreto del
 * proceso programado; a cualquier otro le responde 401 sin decir más.
 */

// Cada correo tarda a lo sumo unas decenas de segundos (tres intentos con timeouts de 10 s).
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!autorizaProceso(request.headers.get("authorization"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    const resumen = await procesarConfirmacionesDeCita();
    return Response.json(resumen);
  } catch (error) {
    console.error("[procesos] falló la confirmación de citas:", error instanceof Error ? error.message : error);
    return Response.json({ error: "No se pudo confirmar." }, { status: 500 });
  }
}
