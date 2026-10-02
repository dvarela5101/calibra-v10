import { notFound, redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { enlaceDeComprobanteDePago } from "@/lib/comprobantes/almacenamiento";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-020, criterio 6: "Ver comprobante" en la revisión de un pago. El enlace firmado de 60 s (HU-007) se pide con la
 * sesión del admin en el momento del clic, y se redirige a él (307). Al pintar la página no se firma nada: si el
 * admin tardara más de un minuto en abrirlo, ya habría vencido. Sin sesión de admin, `exigirRol` lleva a ingresar y
 * después vuelve al pago. Si no se pudo firmar, vuelve al pago con el aviso.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<"/admin/pagos/[id]/comprobante">) {
  const { id } = await params;
  const pagina = `/admin/pagos/${id}`;
  await exigirRol("admin", pagina);
  if (!esUuid(id)) notFound();

  const supabase = await crearClienteServidor();
  if (!supabase) notFound();
  // Con la sesión, no con la llave secreta: el Storage solo firma para el dueño del archivo o un admin activo.
  const enlace = await enlaceDeComprobanteDePago(supabase, id);
  if (!enlace.ok) redirect(`${pagina}?error=comprobante`);
  redirect(enlace.url);
}
