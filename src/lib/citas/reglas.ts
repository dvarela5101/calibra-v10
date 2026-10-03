/**
 * La cita confirmada y su enlace de gestión (HU-019, P-04, D-19 a D-25). Aquí va lo puro: la forma del enlace
 * del correo, la lectura de las filas de la base, qué ve el Lead según el estado de la cita y los datos del correo
 * de confirmación. Cuándo se anota la confirmación y qué cita ve cada puerta (token o sesión) lo decide la base
 * (un trigger anota la confirmación al pasar la monitoría a `confirmada`, ver la migración
 * `*_confirmacion_cita.sql`).
 *
 * Los plazos no se calculan aquí: llegan de la base (`cancelable_hasta`, `reporte_hasta`) y solo se comparan con el
 * motor de plazos (`dentroDePlazo`, `plazoAlcanzado`), que decide el borde inclusivo (P-40). Nada de esto muestra
 * cifras de comisión ni el contacto del monitor (P-37).
 */
import type { DatosPorPlantilla } from "@/lib/correo/plantillas";
import { formatearFechaHora } from "@/lib/fechas";
import { dentroDePlazo, plazoAlcanzado } from "@/lib/plazos/motor";
import { describirTiempoRestante } from "@/lib/plazos/restante";
import { TEXTO_PAGO_EN_REVISION_AL_CANCELAR } from "@/lib/reembolsos/reglas";

/** La lista de las citas del navegador y la base del enlace del correo. */
export const RUTA_DE_CITAS = "/cita";

const FORMATO_TOKEN = /^[0-9a-f]{64}$/;

/**
 * Ruta del enlace del correo, para `urlDelSitio`. El token no vence mientras exista la cita (D-20) y sirve para
 * ver la cita y, con sus HUs, cancelarla (HU-024) y reportar la inasistencia (HU-029).
 */
export function rutaDeCita(token: string): string {
  return `${RUTA_DE_CITAS}?token=${token}`;
}

/** Una cita de la sesión del Lead (la misma que ve con el enlace). */
export function rutaDeMiCita(idMonitoria: string): string {
  return `${RUTA_DE_CITAS}/${encodeURIComponent(idMonitoria)}`;
}

/** ¿Tiene forma de token (64 hexadecimales en minúscula)? Lo que no la tiene ni se consulta en la base. */
export function tieneFormaDeTokenDeCita(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_TOKEN.test(valor);
}

// ---------------------------------------------------------------------------
// La cita, como la devuelve la base
// ---------------------------------------------------------------------------

export const ESTADOS_DE_CITA = ["pendiente_pago", "confirmada", "realizada", "cancelada"] as const;
export type EstadoDeCita = (typeof ESTADOS_DE_CITA)[number];

export const MOTIVOS_DE_CANCELACION = ["reserva_expirada", "pago_rechazado", "estudiante", "monitor_no_asistio", "diferencia_no_cubierta"] as const;
export type MotivoDeCancelacion = (typeof MOTIVOS_DE_CANCELACION)[number];

/** El pago agregado de la cita, con la misma prioridad que la agenda del monitor (D-11). */
export const ESTADOS_DE_PAGO_DE_CITA = ["rechazado", "en_revision", "aprobado", "sin_pagar"] as const;
export type EstadoDePagoDeCita = (typeof ESTADOS_DE_PAGO_DE_CITA)[number];

export const ESTADOS_DE_REEMBOLSO_DE_CITA = ["esperando_llave", "pendiente", "reembolsado"] as const;
export type EstadoDeReembolsoDeCita = (typeof ESTADOS_DE_REEMBOLSO_DE_CITA)[number];

export const ESTADOS_DE_REPORTE_DE_CITA = ["en_revision", "aceptado", "rechazado"] as const;
export type EstadoDeReporteDeCita = (typeof ESTADOS_DE_REPORTE_DE_CITA)[number];

/**
 * La cita para la página: lo mismo para quien llega con el enlace y para quien vuelve con su navegador. Sin el
 * id del Lead, sin el contacto del monitor ni cifras de comisión. `lugar` y `enlace` solo vienen mientras la cita
 * está `confirmada` (D-21): de una cita terminada o cancelada no se muestran.
 */
export type Cita = {
  idMonitoria: string;
  estado: EstadoDeCita;
  motivoCancelacion: MotivoDeCancelacion | null;
  nombreMonitor: string;
  nombreMateria: string;
  codigoMateria: string;
  /** Día de calendario, `AAAA-MM-DD`. */
  fecha: string;
  /** Hora de inicio en la zona del negocio, `HH:MM:SS`. */
  hora: string;
  duracionMin: number;
  presencial: boolean;
  valorTotal: number;
  /** Lugar de la presencial (D-5). */
  lugar: string | null;
  /** Enlace de la videollamada de la virtual (D-5). Es https. */
  enlace: string | null;
  inicio: Date;
  finProgramado: Date;
  /** Hasta cuándo se puede cancelar (RN-60): 12 h antes del inicio en una individual. */
  cancelableHasta: Date;
  /** Hasta cuándo se puede reportar la inasistencia (RN-62): 24 h después del fin. */
  reporteHasta: Date;
  estadoPago: EstadoDePagoDeCita;
  estadoReembolso: EstadoDeReembolsoDeCita | null;
  estadoReporte: EstadoDeReporteDeCita | null;
};

/** Una fila de `public.cita_por_token`, `public.mi_cita` o `public.mis_citas` (con o sin otras columnas). */
export type FilaDeCita = {
  id_monitoria: string;
  estado: string;
  motivo_cancelacion: string | null;
  nombre_monitor: string;
  nombre_materia: string;
  codigo_materia: string;
  fecha: string;
  hora: string;
  duracion_min: number;
  presencial: boolean;
  valor_total: number;
  lugar: string | null;
  enlace: string | null;
  inicio: string;
  fin_programado: string;
  cancelable_hasta: string;
  reporte_hasta: string;
  estado_pago: string;
  estado_reembolso: string | null;
  estado_reporte: string | null;
};

function uno<T extends string>(valores: readonly T[], valor: string, campo: string): T {
  const encontrado = valores.find((v) => v === valor);
  if (!encontrado) throw new Error(`${campo} desconocido en la cita: ${valor}`);
  return encontrado;
}

function opcional<T extends string>(valores: readonly T[], valor: string | null, campo: string): T | null {
  return valor == null ? null : uno(valores, valor, campo);
}

function instante(valor: string, campo: string): Date {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error(`${campo} no es un instante válido en la cita: ${valor}`);
  return fecha;
}

/** Lee una fila de la base como `Cita`. Lanza si trae un estado desconocido o una fecha inválida. */
export function citaDeFila(fila: FilaDeCita): Cita {
  return {
    idMonitoria: fila.id_monitoria,
    estado: uno(ESTADOS_DE_CITA, fila.estado, "estado"),
    motivoCancelacion: opcional(MOTIVOS_DE_CANCELACION, fila.motivo_cancelacion, "motivo_cancelacion"),
    nombreMonitor: fila.nombre_monitor,
    nombreMateria: fila.nombre_materia,
    codigoMateria: fila.codigo_materia,
    fecha: fila.fecha,
    hora: fila.hora,
    duracionMin: fila.duracion_min,
    presencial: fila.presencial,
    valorTotal: fila.valor_total,
    lugar: fila.lugar,
    enlace: fila.enlace,
    inicio: instante(fila.inicio, "inicio"),
    finProgramado: instante(fila.fin_programado, "fin_programado"),
    cancelableHasta: instante(fila.cancelable_hasta, "cancelable_hasta"),
    reporteHasta: instante(fila.reporte_hasta, "reporte_hasta"),
    estadoPago: uno(ESTADOS_DE_PAGO_DE_CITA, fila.estado_pago, "estado_pago"),
    estadoReembolso: opcional(ESTADOS_DE_REEMBOLSO_DE_CITA, fila.estado_reembolso, "estado_reembolso"),
    estadoReporte: opcional(ESTADOS_DE_REPORTE_DE_CITA, fila.estado_reporte, "estado_reporte"),
  };
}

// ---------------------------------------------------------------------------
// Qué ve el Lead
// ---------------------------------------------------------------------------

/** Dónde está una cita confirmada respecto de su hora: antes del inicio, en curso (inicio y fin incluidos) o terminada. */
export type MomentoDeCita = "antes" | "en_curso" | "terminada";

export function momentoDeCita(cita: Pick<Cita, "inicio" | "finProgramado">, ahora: Date): MomentoDeCita {
  if (!plazoAlcanzado(cita.inicio, ahora)) return "antes";
  return dentroDePlazo(cita.finProgramado, ahora) ? "en_curso" : "terminada";
}

/** El motivo de una cancelación, en palabras para quien agendó. */
export function textoDelMotivo(motivo: MotivoDeCancelacion | null): string {
  switch (motivo) {
    case "estudiante":
      return "La cancelaste tú.";
    case "pago_rechazado":
      return "No pudimos verificar tu pago, así que la monitoría se canceló y no hay reembolso.";
    case "monitor_no_asistio":
      return "El monitor no asistió y se aceptó tu reporte.";
    case "diferencia_no_cubierta":
      return "No se cubrió a tiempo la diferencia del pago.";
    case "reserva_expirada":
      return "La reserva venció porque el comprobante de pago no llegó a tiempo.";
    case null:
      return "La monitoría se canceló.";
  }
}

/** Qué pasa con el reembolso, si lo hay (RN-61). El enlace para dar la llave llega por correo con HU-025. */
export function textoDelReembolso(estado: EstadoDeReembolsoDeCita | null): string | null {
  switch (estado) {
    case "esperando_llave":
      return "Vamos a devolverte el dinero. Te escribimos al correo del pago para pedirte la llave.";
    case "pendiente":
      return "Recibimos tu llave. Estamos haciendo la devolución del dinero.";
    case "reembolsado":
      return "Ya te devolvimos el dinero.";
    case null:
      return null;
  }
}

/** Qué se dice del pago de una cita confirmada. Con el comprobante recibido la cita queda confirmada sin esperar al admin (RN-38). */
function textoDelPago(estado: EstadoDePagoDeCita): string | null {
  switch (estado) {
    case "en_revision":
      return "Recibimos tu comprobante. Un admin lo revisa y, si hay algún problema, te avisamos por correo.";
    case "aprobado":
      return "Tu pago está aprobado.";
    case "rechazado":
      return "No pudimos verificar tu pago.";
    case "sin_pagar":
      return null;
  }
}

/** Qué se dice de la cita que el estudiante canceló con el pago rechazado: no hubo reembolso (RN-43). */
export const TEXTO_PAGO_NO_APROBADO_AL_CANCELAR = "Tu pago no se aprobó, así que no hay reembolso.";

/** La nota del paso de confirmación al cancelar con el pago aprobado (D-26): el reembolso es por el valor completo. */
export const TEXTO_DEVOLUCION_AL_CANCELAR = "Te devolvemos el valor completo: te pedimos la llave por correo.";

/**
 * Qué se le avisa del dinero antes de cancelar, en el paso de confirmación (HU-024, D-27). Con el pago aprobado, que
 * se devuelve completo; con el pago en revisión, que el reembolso depende de que el admin lo apruebe (P-07). Sin
 * pago aprobado ni en revisión no hay nada que devolver: `null`.
 */
export function textoDelDineroAlCancelar(estado: EstadoDePagoDeCita): string | null {
  switch (estado) {
    case "aprobado":
      return TEXTO_DEVOLUCION_AL_CANCELAR;
    case "en_revision":
      return TEXTO_PAGO_EN_REVISION_AL_CANCELAR;
    case "rechazado":
    case "sin_pagar":
      return null;
  }
}

/**
 * Qué se dice del pago de una cita que el estudiante canceló y no tiene reembolso (todavía): con el pago en revisión,
 * que si se aprueba se le pide la llave (D-27, P-07); con el pago rechazado, que no hay reembolso. Con el pago
 * aprobado ya hay reembolso y lo dice `textoDelReembolso`.
 */
function textoDelPagoDeLaCancelada(estado: EstadoDePagoDeCita): string | null {
  switch (estado) {
    case "en_revision":
      return TEXTO_PAGO_EN_REVISION_AL_CANCELAR;
    case "rechazado":
      return TEXTO_PAGO_NO_APROBADO_AL_CANCELAR;
    case "aprobado":
    case "sin_pagar":
      return null;
  }
}

/**
 * Lo que la página le dice al Lead de una cita (§2.5 del plan). Los textos ya vienen armados; la página solo los
 * ordena. Las acciones (cancelar, reportar) las ofrecen HU-024 y HU-029: aquí solo se dice si caben.
 */
export type VistaDeCita = {
  /** El estado de la monitoría: la página elige su diseño con esto. */
  tipo: EstadoDeCita;
  /** Solo en una `confirmada`: antes del inicio, en curso o terminada. En las demás, `null`. */
  momento: MomentoDeCita | null;
  titulo: string;
  /** Una frase de dónde está la cita (por ejemplo, que el monitor la marcará como realizada), o `null`. */
  textoDelEstado: string | null;
  /** Hasta cuándo se puede cancelar, o que el plazo terminó. Solo en una confirmada antes del inicio. */
  textoDelPlazo: string | null;
  /**
   * Qué hay del pago (D-22). En una confirmada, mientras no haya terminado; en una cancelada por el estudiante sin
   * reembolso, por qué no lo hay todavía (pago en revisión) o no lo habrá (pago rechazado).
   */
  textoDelPago: string | null;
  /** Qué hay del reembolso, si lo hay. */
  textoDelReembolso: string | null;
  /** El motivo de la cancelación, solo en una cancelada. */
  textoDelMotivo: string | null;
  /** Hay plazo para cancelar y la cita sigue confirmada: la página pone el botón (HU-024). */
  puedeCancelar: boolean;
  /** Confirmada, antes del inicio y sin plazo para cancelar: se explica que los casos de fuerza mayor los resuelve un admin (criterio 3). */
  mostrarCasosExtremos: boolean;
  /** Ya empezó, no pasó el plazo de reporte, no hay reporte y está confirmada o realizada. HU-029 pone el botón. */
  puedeReportar: boolean;
  /** ¿Se muestran el lugar o el enlace de la videollamada (D-21)? Solo en una confirmada que no ha terminado y con el pago no rechazado. */
  mostrarLugarYEnlace: boolean;
};

/** Fecha y hora en la zona del negocio. Termina en "a. m." o "p. m.", así que la frase que la cierra no repite el punto. */
const cuando = (instante: Date) => formatearFechaHora(instante);

/** Cierra una frase con punto, salvo que ya termine en punto, exclamación o interrogación. */
const cerrar = (texto: string) => (/[.!?…]$/.test(texto) ? texto : `${texto}.`);

/**
 * Qué ve el Lead de su cita ahora. Pura: `ahora` es del llamador. Los plazos se comparan con el motor, con borde
 * inclusivo (P-40): con el plazo de cancelación exacto todavía se puede cancelar.
 */
export function vistaDeCita(cita: Cita, ahora: Date): VistaDeCita {
  const reembolso = textoDelReembolso(cita.estadoReembolso);
  const sinReporte = cita.estadoReporte === null;
  const yaEmpezo = plazoAlcanzado(cita.inicio, ahora);
  const alcanzaElReporte = yaEmpezo && dentroDePlazo(cita.reporteHasta, ahora) && sinReporte;

  switch (cita.estado) {
    case "confirmada": {
      const momento = momentoDeCita(cita, ahora);
      const puedeCancelar = momento === "antes" && dentroDePlazo(cita.cancelableHasta, ahora);
      let textoDelPlazo: string | null = null;
      if (momento === "antes") {
        textoDelPlazo = puedeCancelar
          ? `${cerrar(`Puedes cancelarla hasta el ${cuando(cita.cancelableHasta)}`)} ${cerrar(describirTiempoRestante(cita.cancelableHasta, ahora).texto)}`
          : cerrar(`El plazo para cancelarla terminó el ${cuando(cita.cancelableHasta)}`);
      }
      const titulos: Record<MomentoDeCita, string> = {
        antes: "Tu monitoría está confirmada",
        en_curso: "Tu monitoría ya empezó",
        terminada: "Tu monitoría ya terminó",
      };
      return {
        tipo: "confirmada",
        momento,
        titulo: titulos[momento],
        textoDelEstado: momento === "terminada" ? "El monitor la marcará como realizada." : null,
        textoDelPlazo,
        textoDelPago: momento === "terminada" ? null : textoDelPago(cita.estadoPago),
        textoDelReembolso: reembolso,
        textoDelMotivo: null,
        puedeCancelar,
        mostrarCasosExtremos: momento === "antes" && !puedeCancelar,
        puedeReportar: alcanzaElReporte,
        mostrarLugarYEnlace: momento !== "terminada" && cita.estadoPago !== "rechazado",
      };
    }
    case "realizada":
      return {
        tipo: "realizada",
        momento: null,
        titulo: "Tu monitoría se realizó",
        textoDelEstado: null,
        textoDelPlazo: null,
        textoDelPago: null,
        textoDelReembolso: reembolso,
        textoDelMotivo: null,
        puedeCancelar: false,
        mostrarCasosExtremos: false,
        puedeReportar: alcanzaElReporte,
        mostrarLugarYEnlace: false,
      };
    case "cancelada":
      return {
        tipo: "cancelada",
        momento: null,
        titulo: "Esta monitoría se canceló",
        textoDelEstado: null,
        textoDelPlazo: null,
        textoDelPago: cita.motivoCancelacion === "estudiante" && cita.estadoReembolso === null ? textoDelPagoDeLaCancelada(cita.estadoPago) : null,
        textoDelReembolso: reembolso,
        textoDelMotivo: textoDelMotivo(cita.motivoCancelacion),
        puedeCancelar: false,
        mostrarCasosExtremos: false,
        puedeReportar: false,
        mostrarLugarYEnlace: false,
      };
    case "pendiente_pago":
      // La página manda estas al apartado de la reserva (donde se paga); esta vista es solo el respaldo.
      return {
        tipo: "pendiente_pago",
        momento: null,
        titulo: "Tu reserva espera el comprobante de pago",
        textoDelEstado: "La monitoría se confirma cuando adjuntes el comprobante.",
        textoDelPlazo: null,
        textoDelPago: null,
        textoDelReembolso: null,
        textoDelMotivo: null,
        puedeCancelar: false,
        mostrarCasosExtremos: false,
        puedeReportar: false,
        mostrarLugarYEnlace: false,
      };
  }
}

// ---------------------------------------------------------------------------
// El correo de confirmación
// ---------------------------------------------------------------------------

/**
 * Lo que devuelve `public.datos_de_confirmacion_cita`. Los instantes van como texto ISO. Del Lead, el nombre y el
 * correo para escribirle; del monitor, solo el nombre (P-37); del valor, solo el total que paga el Lead.
 */
export type DatosDeConfirmacionCita = {
  /** El token del enlace de gestión (D-20). */
  token: string;
  /** Cuándo se anotó la confirmación: el dato fijo con que se decide si ya no se podía cancelar. */
  creadaEn: string;
  estado: EstadoDeCita;
  grupal: boolean;
  /** El correo del Lead; si no tiene, el contacto del primer pago (D-19). */
  correoDestino: string | null;
  nombreLead: string;
  nombreMonitor: string;
  nombreMateria: string;
  inicio: string;
  duracionMin: number;
  presencial: boolean;
  lugar: string | null;
  /** El enlace de la videollamada (no el de gestión). */
  enlace: string | null;
  valorTotal: number;
  cancelableHasta: string;
};

/**
 * ¿Todavía se manda la confirmación? Se pregunta al procesarla y al reintentarla (HU-065), porque entre que se
 * anotó y que sale el correo la cita pudo cambiar: si el admin ya rechazó el pago quedó `cancelada`, y si la
 * sesión ya empezó el correo llegaría tarde. Nunca para una grupal.
 */
export function confirmacionVigente(d: Pick<DatosDeConfirmacionCita, "estado" | "grupal" | "inicio">, ahora: Date): boolean {
  return d.estado === "confirmada" && !d.grupal && !plazoAlcanzado(new Date(d.inicio), ahora);
}

/** Un texto opcional de la base: recortado, y vacío es `null`. */
function textoOpcional(valor: string | null): string | null {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
}

/**
 * Los datos de la plantilla `confirmacion_cita`. No lee el reloj: `cancelableHasta` es `null` si el plazo ya había
 * pasado cuando se confirmó la cita (RN-37), un dato fijo, así que un reintento da el mismo cuerpo y el proveedor
 * no responde 409. El lugar solo va en una presencial y el enlace de la videollamada solo en una virtual (D-5, D-21).
 */
export function datosDeConfirmacion(d: DatosDeConfirmacionCita, enlaceDeGestion: string): DatosPorPlantilla["confirmacion_cita"] {
  const yaNoSePodiaCancelar = new Date(d.cancelableHasta).getTime() < new Date(d.creadaEn).getTime();
  return {
    nombre: d.nombreLead,
    nombreMonitor: d.nombreMonitor,
    materia: d.nombreMateria,
    inicio: d.inicio,
    duracionMin: d.duracionMin,
    presencial: d.presencial,
    valorTotal: d.valorTotal,
    lugar: d.presencial ? textoOpcional(d.lugar) : null,
    enlaceSesion: d.presencial ? null : textoOpcional(d.enlace),
    cancelableHasta: yaNoSePodiaCancelar ? null : d.cancelableHasta,
    enlace: enlaceDeGestion,
  };
}
