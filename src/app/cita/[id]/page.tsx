import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { esUuid, rutaDeReserva } from "@/lib/agendar/reglas";
import { obtenerSesion } from "@/lib/auth/sesion";
import type { Cita } from "@/lib/citas/reglas";
import { leerMiCita } from "@/lib/citas/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { DetalleDeCita, NoPudimosCargar } from "../DetalleDeCita";

export const metadata: Metadata = {
  title: "Tu cita · Calibra",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * HU-019 (criterio 4): una cita del navegador con el que se agendó, sin el enlace del correo. La base solo la
 * entrega si es del Lead de la sesión: una ajena, una que no existe y una sin sesión se ven igual (404).
 */
export default async function MiCita({ params }: PageProps<"/cita/[id]">) {
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const sesion = await obtenerSesion();
  const supabase = await crearClienteServidor();
  if (!sesion || !supabase) notFound();

  let cita: Cita | null;
  try {
    cita = await leerMiCita(supabase, id);
  } catch (error) {
    console.error("[citas] no se pudo leer la cita:", error instanceof Error ? error.message : error);
    return <NoPudimosCargar titulo="No pudimos cargar tu cita" />;
  }
  if (!cita) notFound();

  // Sin pagar o con la reserva vencida todavía no hay cita que gestionar: la reserva ya lo explica (y es donde se paga).
  if (cita.estado === "pendiente_pago" || cita.motivoCancelacion === "reserva_expirada") redirect(rutaDeReserva(cita.idMonitoria));

  return <DetalleDeCita cita={cita} ahora={new Date()} conLista />;
}
