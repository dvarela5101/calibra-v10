import "server-only";
import { reconstruirAvisoCancelada, reconstruirAvisoConfirmada } from "@/lib/avisos/servidor";
import { reconstruirVerificacion } from "@/lib/leads/servidor";
import { reconstruirInvitacion } from "@/lib/monitores/servidor";
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
  // Todavía ninguna HU dispara estas plantillas.
  recuperacion_diagnostico: null,
  solicitud_llave_reembolso: null,
  pago_rechazado_individual: null,
  pago_rechazado_grupal: null,
  escalamiento_pago: null,
};
