import type { Reconstruccion } from "@/lib/correo/plantillas";
import type { PagoParaElCorreo } from "./pagos-reglas";

/**
 * Los avisos al pagador por el rechazo de su pago (HU-076, D-39 d y e). Aquí va lo puro: qué casos anota la base y los
 * datos del correo de la cita que ya estaba cancelada. La base decide el caso al rechazar (trigger
 * `pago_anota_aviso_rechazo`) y lo deja en `aviso_rechazo_pago`; el procesador (`avisos-rechazo.ts`) lo manda.
 */

/**
 * Qué correo corresponde, como quedó al rechazar:
 *  - `cita_cancelada`: el rechazo canceló la cita (o la había cancelado el rechazo de otro pago de la misma cita).
 *    Sale `pago_rechazado_individual`.
 *  - `cita_ya_cancelada`: el estudiante ya la había cancelado. Sale `pago_rechazado_sin_reembolso`.
 */
export const CASOS_DE_AVISO_DE_RECHAZO = ["cita_cancelada", "cita_ya_cancelada"] as const;
export type CasoDeAvisoDeRechazo = (typeof CASOS_DE_AVISO_DE_RECHAZO)[number];

export function esCasoDeAvisoDeRechazo(valor: unknown): valor is CasoDeAvisoDeRechazo {
  return typeof valor === "string" && (CASOS_DE_AVISO_DE_RECHAZO as readonly string[]).includes(valor);
}

/**
 * El correo al pagador cuando su pago se rechazó con la cita ya cancelada por el estudiante (criterio 5, D-39 d):
 * plantilla `pago_rechazado_sin_reembolso`, a `pago.contacto` (RN-44), con el correo de Calibra como contacto de
 * soporte. Es `null` si ya no aplica: el pago no está rechazado o su monitoría no está cancelada por `estudiante`.
 * Lo usan el primer envío y el reintento (HU-065): los mismos datos dan el mismo correo.
 */
export function correoDeRechazoSinReembolso(
  pago: PagoParaElCorreo,
  contactoSoporte: string | null,
): Reconstruccion<"pago_rechazado_sin_reembolso"> | null {
  const m = pago.monitoria;
  if (pago.estado !== "rechazado" || !m || m.estado !== "cancelada" || m.motivoCancelacion !== "estudiante") return null;
  return {
    destinatario: pago.contacto,
    datos: {
      nombre: pago.nombrePagador,
      monto: pago.monto,
      fechaSesion: m.fecha,
      ...(contactoSoporte ? { contactoSoporte } : {}),
    },
  };
}
