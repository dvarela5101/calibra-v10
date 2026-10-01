import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { esUuid } from "@/lib/agendar/reglas";
import { cargarReserva, type Reserva } from "@/lib/agendar/servidor";
import { obtenerSesion } from "@/lib/auth/sesion";
import { rutaDeMonitores } from "@/lib/disponibilidad/reglas";
import { formatearHora } from "@/lib/fechas";
import { dentroDePlazo } from "@/lib/plazos/motor";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import estilos from "../../agendar.module.css";
import { ResumenDeCita } from "../../ResumenDeCita";

export const metadata: Metadata = { title: "Tu reserva · Calibra" };

const EYEBROW = "Tu reserva";

/**
 * HU-017: la reserva recién apartada, solo para la sesión del Lead que la hizo (y su monitor o un admin,
 * por las políticas de `monitoria`). Dice hasta cuándo queda apartada (RN-34) y si ya no se podrá cancelar
 * (RN-37). El pago por Llave y el comprobante llegan aquí mismo con HU-018; la confirmación, con HU-019.
 */
export default async function ReservaApartada({ params }: PageProps<"/agendar/reserva/[id]">) {
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const sesion = await obtenerSesion();
  const supabase = await crearClienteServidor();
  if (!sesion || !supabase) notFound();

  let reserva: Reserva | null;
  try {
    reserva = await cargarReserva(supabase, id);
  } catch (error) {
    console.error("[agendar] no se pudo cargar la reserva:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar tu reserva">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, inténtalo más tarde.
        </p>
      </Pantalla>
    );
  }
  if (!reserva) notFound();

  const ahora = new Date();
  const { titulo, estado } = encabezado(reserva, ahora);
  return (
    <Pantalla eyebrow={EYEBROW} titulo={titulo}>
      {estado}
      <ResumenDeCita
        cita={{
          nombreMateria: reserva.nombreMateria,
          nombreMonitor: reserva.nombreMonitor,
          fecha: reserva.fecha,
          hora: reserva.hora,
          duracionMin: reserva.duracionMin,
          presencial: reserva.presencial,
          valor: reserva.valorTotal,
        }}
      />
      {reserva.estado !== "cancelada" && reserva.estado !== "realizada" && !dentroDePlazo(reserva.cancelableHasta, ahora) && (
        <p className={estilos.nota}>Faltan menos de 12 horas: esta monitoría no se puede cancelar.</p>
      )}
      <div className={estilos.acciones}>
        <Link href={rutaDeMonitores(reserva.codigoMateria)} className={formulario.enlace}>
          Ver monitores de {reserva.nombreMateria}
        </Link>
      </div>
    </Pantalla>
  );
}

/** Qué se dice arriba según el estado de la monitoría y si la reserva sigue vigente (RN-34). */
function encabezado(reserva: Reserva, ahora: Date): { titulo: string; estado: ReactNode } {
  const estado = (texto: string) => (
    <p role="status" className={formulario.ayuda}>
      {texto}
    </p>
  );
  switch (reserva.estado) {
    case "pendiente_pago":
      return dentroDePlazo(reserva.reservaHasta, ahora)
        ? {
            titulo: "Apartamos tu fecha",
            estado: estado(
              `La fecha queda a tu nombre hasta las ${formatearHora(reserva.reservaHasta)}. Si para entonces no llega el comprobante de pago, la reserva vence.`,
            ),
          }
        : { titulo: "Tu reserva venció", estado: estado("Pasó el tiempo para adjuntar el comprobante de pago. Puedes elegir otra fecha.") };
    case "confirmada":
      return { titulo: "Tu monitoría está confirmada", estado: null };
    case "realizada":
      return { titulo: "Tu monitoría ya se realizó", estado: null };
    case "cancelada":
      return { titulo: "Esta reserva se canceló", estado: null };
  }
}
