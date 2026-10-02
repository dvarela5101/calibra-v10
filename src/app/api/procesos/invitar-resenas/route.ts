import { autorizaProceso } from "@/lib/procesos/autorizacion";
import { procesarInvitacionesResena } from "@/lib/resenas/servidor";

/**
 * HU-035: la llama la base con pg_net cuando anota una invitación de reseña (al pasar una individual a
 * `realizada`), y pg_cron cada 5 minutos si quedan invitaciones sin procesar. Solo con el secreto del proceso
 * programado; a cualquier otro le responde 401 sin decir más.
 */

// Cada correo tarda a lo sumo unas decenas de segundos (tres intentos con timeouts de 10 s).
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!autorizaProceso(request.headers.get("authorization"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    const resumen = await procesarInvitacionesResena();
    return Response.json(resumen);
  } catch (error) {
    console.error("[procesos] falló la invitación a reseñar:", error instanceof Error ? error.message : error);
    return Response.json({ error: "No se pudo invitar." }, { status: 500 });
  }
}
