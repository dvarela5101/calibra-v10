import "server-only";
import { reconstruirPagoRechazado, reconstruirPagoRechazadoSinReembolso } from "@/lib/admin/pagos";
import {
  reconstruirAvisoCancelada,
  reconstruirAvisoConfirmada,
  reconstruirAvisoInasistenciaAceptada,
  reconstruirAvisoPagoRechazado,
} from "@/lib/avisos/servidor";
import { reconstruirCancelacionCita } from "@/lib/citas/cancelar";
import { reconstruirConfirmacionCita } from "@/lib/citas/servidor";
import { reconstruirVerificacion } from "@/lib/leads/servidor";
import { reconstruirInvitacion } from "@/lib/monitores/servidor";
import { reconstruirPedidoDeLlave, reconstruirRecordatorioDeLlave } from "@/lib/reembolsos/pedidos";
import { reconstruirInvitacionResena } from "@/lib/resenas/servidor";
import type { Reconstructores } from "./reintentos";

/**
 * Cómo reconstruir cada correo para reintentarlo (HU-065). Cada HU que empiece a disparar una
 * plantilla escribe aquí su reconstructor; `pruebas/reconstructores.test.ts` falla si una plantilla que
 * alguien dispara no lo tiene.
 */
export const RECONSTRUCTORES: Reconstructores = {
  invitacion_monitor: (entidad) => reconstruirInvitacion(entidad),
  verificacion_lead: (entidad) => reconstruirVerificacion(entidad),
  aviso_monitor_confirmada: (entidad) => reconstruirAvisoConfirmada(entidad),
  aviso_monitor_cancelada: (entidad) => reconstruirAvisoCancelada(entidad),
  resena_individual: (entidad) => reconstruirInvitacionResena(entidad),
  confirmacion_cita: (entidad) => reconstruirConfirmacionCita(entidad),
  cancelacion_cita: (entidad) => reconstruirCancelacionCita(entidad),
  pago_rechazado_individual: (entidad) => reconstruirPagoRechazado(entidad),
  solicitud_llave_reembolso: (entidad) => reconstruirPedidoDeLlave(entidad),
  recordatorio_llave_reembolso: (entidad) => reconstruirRecordatorioDeLlave(entidad),
  aviso_monitor_pago_rechazado: (entidad) => reconstruirAvisoPagoRechazado(entidad),
  pago_rechazado_sin_reembolso: (entidad) => reconstruirPagoRechazadoSinReembolso(entidad),
  aviso_monitor_inasistencia_aceptada: (entidad) => reconstruirAvisoInasistenciaAceptada(entidad),
  // Todavía ninguna HU dispara estas plantillas.
  recuperacion_diagnostico: null,
  pago_rechazado_grupal: null,
  escalamiento_pago: null,
};
