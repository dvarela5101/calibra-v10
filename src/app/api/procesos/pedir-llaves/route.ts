import { autorizaProceso } from "@/lib/procesos/autorizacion";
import { procesarPedidosDeLlave } from "@/lib/reembolsos/pedidos";

/**
 * HU-025: la llama la base con pg_net cuando anota un correo que pide la llave de un reembolso (al crearse el
 * reembolso, a los 3 días, al reabrirlo o al reenviarlo), y pg_cron cada 5 minutos si quedan pedidos sin procesar
 * (`calibra-pedir-llaves`). Solo con el secreto del proceso programado; a cualquier otro le responde 401 sin decir más.
 */

// Cada correo tarda a lo sumo unas decenas de segundos (tres intentos con timeouts de 10 s).
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!autorizaProceso(request.headers.get("authorization"))) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  try {
    const resumen = await procesarPedidosDeLlave();
    return Response.json(resumen);
  } catch (error) {
    console.error("[procesos] falló el pedido de llaves de reembolso:", error instanceof Error ? error.message : error);
    return Response.json({ error: "No se pudieron pedir las llaves." }, { status: 500 });
  }
}
