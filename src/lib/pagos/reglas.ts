import { esCorreo } from "@/lib/correo/contacto";
import { normalizarCorreo } from "@/lib/leads/reglas";

/**
 * Pagar por Llave una monitoría individual (HU-018). Aquí va lo puro: qué responde la base al registrar el
 * pago, qué se le dice a la persona con cada resultado y la lectura del pagador. Si el pago se puede crear
 * (la reserva es de la sesión, sigue vigente, el comprobante es suyo y está revisado) lo decide
 * `public.registrar_pago`, que también pone el monto (`valor_total`, P-36) y asigna el admin.
 */

/** Lo que responde `public.registrar_pago` (ver su migración). */
export const RESULTADOS_REGISTRO_PAGO = [
  "registrado",
  "sin_sesion",
  "no_es_tuya",
  "no_individual",
  "ya_pagada",
  "cancelada",
  "vencida",
  "datos_invalidos",
  "comprobante_ajeno",
  "comprobante_sin_revisar",
  "comprobante_no_existe",
  "comprobante_usado",
  "sin_admin",
] as const;
export type ResultadoRegistroPago = (typeof RESULTADOS_REGISTRO_PAGO)[number];

export function esResultadoRegistroPago(valor: unknown): valor is ResultadoRegistroPago {
  return typeof valor === "string" && (RESULTADOS_REGISTRO_PAGO as readonly string[]).includes(valor);
}

const VUELVE_A_SUBIRLO = "Vuelve a subirlo.";

const MENSAJES: Record<Exclude<ResultadoRegistroPago, "sin_admin">, string> = {
  registrado: "Recibimos tu comprobante. Tu monitoría quedó confirmada y el pago queda en revisión.",
  sin_sesion: "No encontramos tu sesión. Recarga la página e intenta de nuevo.",
  // No distingue "no existe" de "es de otra persona": no revela qué reservas existen.
  no_es_tuya: "No encontramos esta reserva en tu sesión. Solo quien la apartó puede pagarla.",
  no_individual: "El pago de las monitorías grupales todavía no se hace en esta página.",
  ya_pagada: "Esta monitoría ya tiene su comprobante. No hace falta enviar otro.",
  cancelada: "Esta monitoría está cancelada y ya no se puede pagar. Puedes elegir otra fecha.",
  vencida: "Tu reserva expiró: ya no puedes adjuntar el comprobante. Puedes elegir otra fecha.",
  datos_invalidos: "Revisa tu nombre y tu correo e intenta de nuevo.",
  comprobante_ajeno: `No pudimos usar ese comprobante. ${VUELVE_A_SUBIRLO}`,
  comprobante_sin_revisar: `No pudimos revisar el comprobante. ${VUELVE_A_SUBIRLO}`,
  comprobante_no_existe: `No encontramos el comprobante. ${VUELVE_A_SUBIRLO}`,
  comprobante_usado: "Ese comprobante ya está en otro pago. Sube el de la transferencia de esta monitoría.",
};

/**
 * Qué se le dice a la persona con cada resultado. Con `sin_admin` (nadie del equipo puede revisar el pago
 * ahora) se le ofrece el correo de Calibra si se conoce; el comprobante sigue subido y puede reintentar.
 */
export function mensajeDeRegistroPago(resultado: ResultadoRegistroPago, correoDeContacto: string | null = null): string {
  if (resultado !== "sin_admin") return MENSAJES[resultado];
  const base = "No pudimos recibir tu comprobante en este momento. Intenta de nuevo en unos minutos";
  return correoDeContacto ? `${base} o escríbenos a ${correoDeContacto}.` : `${base}.`;
}

export const LARGO_MAXIMO_NOMBRE_PAGADOR = 120;

const MENSAJE_CORREO = "Escribe un correo válido, por ejemplo ana@uniandes.edu.co.";

/** Texto de una sola línea, sin espacios de sobra. */
const linea = (valor: unknown) => (typeof valor === "string" ? valor : "").replace(/\s+/g, " ").trim();

export type LecturaDePagador = { ok: true; nombre: string; correo: string } | { ok: false; mensaje: string };

/**
 * El nombre y el contacto de quien paga (RN-44). En HU-018 el pagador es el Lead: el formulario los trae
 * prellenados y la persona los puede corregir. El contacto es un correo (P-22), normalizado como el del
 * Lead (HU-068).
 */
export function validarPagador(valores: { nombre: unknown; correo: unknown }): LecturaDePagador {
  const nombre = linea(valores.nombre);
  if (!nombre) return { ok: false, mensaje: "Escribe tu nombre." };
  if (nombre.length > LARGO_MAXIMO_NOMBRE_PAGADOR) return { ok: false, mensaje: "Tu nombre es demasiado largo." };

  // La regla de correo de todo Calibra (HU-070, `esCorreo`), la misma que exige `registrar_pago` con
  // `privado.es_correo_seguro()`: si aquí se aceptara algo más, la base respondería `datos_invalidos`.
  const correo = normalizarCorreo(typeof valores.correo === "string" ? valores.correo : "");
  if (!correo || !esCorreo(correo)) return { ok: false, mensaje: MENSAJE_CORREO };

  return { ok: true, nombre, correo };
}
