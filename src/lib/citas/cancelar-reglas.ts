/**
 * Cancelar la monitoría individual (HU-024, D-26 a D-29, RN-60, RN-61). Aquí va lo puro: los resultados que
 * devuelve la base, qué se le dice a la persona con cada uno y los datos del correo de cancelación. Si cabe o no
 * cancelar, y qué reembolsos se crean, lo decide la base en una sola transacción (`privado.cancelar_cita`, que
 * usa la hora de la base y el borde inclusivo de P-40): nada de eso se recalcula aquí.
 *
 * Nada de esto muestra cifras de comisión (el reembolso es el valor completo del pago) ni el contacto del
 * monitor (P-37).
 */
import type { DatosPorPlantilla } from "@/lib/correo/plantillas";
import { rutaDeLlave } from "@/lib/reembolsos/reglas";
import { rutaDeCita, type EstadoDeCita, type MotivoDeCancelacion } from "./reglas";

/** Lo que responden `public.cancelar_cita_por_token` y `public.cancelar_mi_cita`. */
export const RESULTADOS_DE_CANCELAR = ["cancelada", "ya_cancelada", "fuera_de_plazo", "no_cancelable", "no_individual", "no_existe"] as const;
export type ResultadoDeCancelar = (typeof RESULTADOS_DE_CANCELAR)[number];

export function esResultadoDeCancelar(valor: unknown): valor is ResultadoDeCancelar {
  return typeof valor === "string" && (RESULTADOS_DE_CANCELAR as readonly string[]).includes(valor);
}

/**
 * El texto de la cita a la que ya se le pasó el plazo para cancelar (criterio 3): los casos de fuerza mayor los
 * resuelve un admin. Con el correo de soporte, lo ofrece; sin él, no promete un canal que no existe. Lo usan la
 * página de la cita (donde ya no se ofrece cancelar) y la respuesta de la base `fuera_de_plazo`.
 */
export function textoDeFueraDePlazo(correoDeContacto: string | null = null): string {
  const base = "Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin";
  const correo = correoDeContacto?.trim();
  return correo ? `${base}: escríbenos a ${correo}.` : `${base}.`;
}

const MENSAJES: Record<Exclude<ResultadoDeCancelar, "cancelada" | "ya_cancelada" | "fuera_de_plazo">, string> = {
  no_cancelable: "Esta monitoría ya no se puede cancelar.",
  no_individual: "Las monitorías grupales todavía no se cancelan desde esta página.",
  // No distingue "no existe" de "es de otra persona": no revela qué citas existen.
  no_existe: "No encontramos esta monitoría. Solo quien la agendó puede cancelarla.",
};

/**
 * Qué se le dice a la persona con cada resultado. `cancelada` y `ya_cancelada` no llevan mensaje (`null`): la
 * página ya muestra la cita cancelada. Con `fuera_de_plazo` se le ofrece el correo de Calibra si se conoce.
 */
export function mensajeDeCancelar(resultado: ResultadoDeCancelar, correoDeContacto: string | null = null): string | null {
  switch (resultado) {
    case "cancelada":
    case "ya_cancelada":
      return null;
    case "fuera_de_plazo":
      return textoDeFueraDePlazo(correoDeContacto);
    default:
      return MENSAJES[resultado];
  }
}

// ---------------------------------------------------------------------------
// El correo de cancelación
// ---------------------------------------------------------------------------

/**
 * Lo que devuelve `public.datos_de_cancelacion_cita`. Los instantes van como texto ISO. `correoDestino` y los dos
 * avisos de reembolso son una foto tomada al cancelar: el correo y su reintento dicen lo mismo aunque después
 * cambien el Lead o los pagos. Del Lead, el nombre y el correo para escribirle; del valor, solo lo que se devuelve.
 */
export type DatosDeCancelacionCita = {
  /** Cuándo se anotó la cancelación. */
  creadaEn: string;
  /** El correo del Lead; si no tiene, el contacto del primer pago (D-19). `null` si no hay a quién escribirle. */
  correoDestino: string | null;
  /** Había al menos un pago en revisión al cancelar (P-07). */
  conPagoEnRevision: boolean;
  /** Algún reembolso creado se le pide a un contacto distinto de `correoDestino`: ese pedido lo manda HU-025. */
  reembolsoAOtroContacto: boolean;
  estado: EstadoDeCita;
  motivo: MotivoDeCancelacion | null;
  grupal: boolean;
  nombreLead: string;
  nombreMateria: string;
  inicio: string;
  /** El token del enlace de gestión (D-20), para «Ver mi cita». `null` si no hay. */
  tokenCita: string | null;
};

/** Un reembolso que este correo pide (`public.llaves_de_cancelacion`): el monto y el token de su página de llave. */
export type LlaveDeCancelacion = { idReembolso: string; monto: number; token: string };

/** ¿La cita sigue cancelada por el estudiante y es individual? Lo que hace válida una cancelación, con o sin a quién escribirle. */
export function cancelacionDeEstudiante(d: Pick<DatosDeCancelacionCita, "estado" | "motivo" | "grupal">): boolean {
  return d.estado === "cancelada" && d.motivo === "estudiante" && !d.grupal;
}

/**
 * ¿Todavía se manda el correo de cancelación? Solo si la cita sigue cancelada por el estudiante (nunca vuelve a otro
 * estado), es individual y hay a quién escribirle (D-19). No depende de la hora: avisar de una cancelación sirve
 * igual al reintentarlo más tarde, aunque la sesión ya haya pasado.
 */
export function cancelacionVigente<D extends Pick<DatosDeCancelacionCita, "estado" | "motivo" | "grupal" | "correoDestino">>(
  d: D,
): d is D & { correoDestino: string } {
  return cancelacionDeEstudiante(d) && Boolean(d.correoDestino?.trim());
}

/**
 * Los datos de la plantilla `cancelacion_cita`. No lee el reloj: todo sale de los datos anotados al cancelar, así que
 * un reintento da el mismo cuerpo y el proveedor no responde 409. `url` arma el enlace completo de una ruta del
 * sitio (`urlDelSitio`): el de la página de la llave de cada reembolso y el de gestión de la cita.
 */
export function datosDeCancelacion(
  d: DatosDeCancelacionCita,
  llaves: readonly LlaveDeCancelacion[],
  url: (ruta: string) => string,
): DatosPorPlantilla["cancelacion_cita"] {
  const tokenCita = d.tokenCita?.trim();
  return {
    nombre: d.nombreLead,
    materia: d.nombreMateria,
    inicio: d.inicio,
    reembolsos: llaves.map((llave) => ({ monto: llave.monto, enlace: url(rutaDeLlave(llave.token)) })),
    conPagoEnRevision: d.conPagoEnRevision,
    reembolsoAOtroContacto: d.reembolsoAOtroContacto,
    enlaceCita: tokenCita ? url(rutaDeCita(tokenCita)) : null,
  };
}
