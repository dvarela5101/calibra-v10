import { procesarAvisosDePagoNuevo } from "@/lib/admin/avisos-pago-nuevo";
import { autorizaProceso } from "@/lib/procesos/autorizacion";

/**
 * HU-034: la llama la base con pg_net cuando anota los avisos de un pago nuevo (uno por admin activo), y pg_cron cada
 * 5 minutos (`calibra-avisar-pagos-nuevos`) si quedan avisos sin procesar. Solo con el secreto del proceso programado; a
 * cualquier otro le responde 401 sin decir más.
 */

// Cada correo tarda a lo sumo unas decenas de segundos (tres intentos con timeouts de 10 s).
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!autorizaProceso(request.headers.get("authorization"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    const resumen = await procesarAvisosDePagoNuevo();
    return Response.json(resumen);
  } catch (error) {
    console.error("[procesos] falló el aviso de pagos nuevos:", error instanceof Error ? error.message : error);
    return Response.json({ error: "No se pudo avisar." }, { status: 500 });
  }
}
