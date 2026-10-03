import { formatearDia, formatearFechaHora } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";
import { TEXTO_PAGO_EN_REVISION_AL_CANCELAR } from "@/lib/reembolsos/reglas";
import { armarHtml, armarTexto, enlaceSeguro, type Contenido } from "./html";

/**
 * Las plantillas de correo de la sección 8 de `calibra_reglas_negocio.md`: las que salen por correo.
 * Cada una es una función pura de sus datos a `{ asunto, html, texto }`. No leen el reloj ni el
 * entorno: el mismo dato da siempre el mismo correo, y eso importa porque el proveedor rechaza
 * (409) una Idempotency-Key repetida con otro contenido.
 *
 * Los enlaces (con token, a la bandeja) los arma quien dispara el evento y los pasa ya completos.
 * Los avisos por teléfono (WhatsApp o SMS) no existen: P-22 los deja para más adelante.
 */

export const PLANTILLAS = [
  "recuperacion_diagnostico",
  "resena_individual",
  "solicitud_llave_reembolso",
  "recordatorio_llave_reembolso",
  "pago_rechazado_individual",
  "pago_rechazado_grupal",
  "escalamiento_pago",
  "invitacion_monitor",
  "verificacion_lead",
  "aviso_monitor_confirmada",
  "aviso_monitor_cancelada",
  "confirmacion_cita",
  "cancelacion_cita",
] as const;

export type Plantilla = (typeof PLANTILLAS)[number];

/** Cómo llamar a cada correo en la bandeja del admin (HU-065). */
export const NOMBRE_DE_PLANTILLA: Record<Plantilla, string> = {
  recuperacion_diagnostico: "Resultados del diagnóstico",
  resena_individual: "Reseña de la monitoría",
  solicitud_llave_reembolso: "Pedido de llave para reembolso",
  recordatorio_llave_reembolso: "Recordatorio de llave para reembolso",
  pago_rechazado_individual: "Pago rechazado (individual)",
  pago_rechazado_grupal: "Pago rechazado (grupal)",
  escalamiento_pago: "Pago escalado a otro admin",
  invitacion_monitor: "Invitación de monitor",
  verificacion_lead: "Confirmación de correo para agendar",
  aviso_monitor_confirmada: "Aviso al monitor: monitoría confirmada",
  aviso_monitor_cancelada: "Aviso al monitor: el estudiante canceló",
  confirmacion_cita: "Confirmación de la cita",
  cancelacion_cita: "Cancelación de la cita",
};

export function esPlantilla(valor: string): valor is Plantilla {
  return (PLANTILLAS as readonly string[]).includes(valor);
}

export type DatosPorPlantilla = {
  /** Diagnóstico completado: enlace con token para recuperar los resultados (RN-12). Al Lead. */
  recuperacion_diagnostico: { nombre: string; materia: string; enlace: string };
  /** Monitoría individual realizada: enlace a la reseña, sin límite de tiempo (RN-72). Al Lead. */
  resena_individual: { nombre: string; monitor: string; enlace: string };
  /**
   * Se pide la llave para devolver el dinero de un reembolso (RN-61, P-10, HU-025): al crearse, al reabrirlo un admin
   * o cuando un admin reenvía el enlace. Al pagador. `venceEn` es un instante ISO, el fin del plazo para entregarla:
   * una foto del ciclo del pedido, así que el reintento dice lo mismo aunque el caso se reabra después.
   * `reporteAceptado`: el reembolso viene de un reporte de inasistencia aceptado, y el correo lo dice (D-37).
   * `contactoSoporte`, si se conoce, para pedir que se reabra un caso que se cerró.
   */
  solicitud_llave_reembolso: {
    nombre: string;
    monto: number;
    motivo: string;
    enlace: string;
    venceEn: string;
    reporteAceptado: boolean;
    contactoSoporte?: string;
  };
  /** Pasó parte del plazo y la llave no llega: el recordatorio (P-10, HU-025). Al pagador. Los datos son los del pedido. */
  recordatorio_llave_reembolso: { nombre: string; monto: number; motivo: string; enlace: string; venceEn: string; contactoSoporte?: string };
  /** Pago rechazado en una individual: la cita se cancela y no hay reembolso (RN-43). Al pagador. */
  pago_rechazado_individual: { nombre: string; monto: number; fechaSesion: string; contactoSoporte?: string };
  /** Pago rechazado en una grupal: se anula solo ese cupo y puede volver a intentar (RN-43). Al pagador. */
  pago_rechazado_grupal: { nombre: string; monto: number; fechaSesion: string; enlace: string };
  /** Pago sin revisar tras el plazo: pasa al siguiente admin (RN-42). Al admin. */
  escalamiento_pago: { nombreAdmin: string; nombrePagador: string; monto: number; enlace: string };
  /** Invitación a crear la cuenta de monitor tras la evaluación presencial (P-20, HU-013). Al aspirante. */
  invitacion_monitor: { enlace: string; venceEn: string };
  /**
   * Alguien quiso agendar con un correo que ya es de un Lead (P-23, HU-068): enlace para confirmar que
   * es suyo. Al Lead dueño del correo, con su nombre.
   */
  verificacion_lead: { nombre: string; enlace: string; venceEn: string };
  /**
   * Una monitoría individual del monitor quedó confirmada (D-16, HU-051). Al monitor. Del estudiante, solo el
   * nombre (P-37). `inicio` es un instante ISO; `enlace`, su agenda.
   */
  aviso_monitor_confirmada: {
    nombreMonitor: string;
    nombreEstudiante: string;
    materia: string;
    inicio: string;
    duracionMin: number;
    presencial: boolean;
    enlace: string;
  };
  /** El estudiante canceló una monitoría confirmada (D-16, HU-051). Al monitor. */
  aviso_monitor_cancelada: { nombreMonitor: string; nombreEstudiante: string; materia: string; inicio: string; enlace: string };
  /**
   * Una monitoría individual quedó confirmada (P-04, D-19, HU-019). Al Lead, con el enlace con token para ver y
   * gestionar la cita. Nunca lleva comisión ni el contacto del monitor (P-37). `inicio` y `cancelableHasta` son
   * instantes ISO; `cancelableHasta` es `null` si el plazo ya había pasado al confirmar la cita (RN-37), un dato fijo
   * y no la hora del envío, para que un reintento dé el mismo cuerpo. `lugar` va solo en una presencial y
   * `enlaceSesion` (https) solo en una virtual (D-5, D-21).
   */
  confirmacion_cita: {
    nombre: string;
    nombreMonitor: string;
    materia: string;
    inicio: string;
    duracionMin: number;
    presencial: boolean;
    valorTotal: number;
    lugar: string | null;
    enlaceSesion: string | null;
    cancelableHasta: string | null;
    enlace: string;
  };
  /**
   * El Lead canceló su monitoría individual confirmada a tiempo (D-27, HU-024). Al mismo destinatario que la
   * confirmación. `inicio` es un instante ISO. `reembolsos` son solo los que este correo pide (los de pagos hechos
   * por el mismo correo): cada uno con su monto y el enlace completo a la página de la llave (HU-025). Sin ellos y
   * con `conPagoEnRevision`, explica que la llave se pide si el admin aprueba el pago. `reembolsoAOtroContacto`:
   * otro pago lo hizo alguien con otro correo y a esa persona se le pide la llave aparte. `enlaceCita` (el enlace de
   * gestión) va solo si no hay reembolsos que pedir. Todo es un dato fijo anotado al cancelar: ni el reloj ni el
   * estado de los pagos de después cambian el cuerpo, así que un reintento da el mismo correo.
   */
  cancelacion_cita: {
    nombre: string;
    materia: string;
    inicio: string;
    reembolsos: { monto: number; enlace: string }[];
    conPagoEnRevision: boolean;
    reembolsoAOtroContacto: boolean;
    enlaceCita: string | null;
  };
};

export type CorreoRenderizado = { asunto: string; html: string; texto: string };

/**
 * Lo que necesita el proceso de reintentos para volver a mandar un correo (HU-065): el registro no
 * guarda el cuerpo, así que cada plantilla sabe reconstruir sus datos a partir de la entidad.
 */
export type Reconstruccion<P extends Plantilla> = { destinatario: string; datos: DatosPorPlantilla[P] };

/** Un texto que viene de fuera: no vacío y en una sola línea (va también al asunto). */
function linea(valor: string, campo: string): string {
  const limpio = valor.replace(/\s+/g, " ").trim();
  if (!limpio) throw new RangeError(`${campo} no puede estar vacío.`);
  return limpio;
}

/** Un instante ISO válido, o `RangeError`. */
function instante(valor: string, campo: string): Date {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new RangeError(`${campo} debe ser un instante válido.`);
  return fecha;
}

/** Cierra una oración con punto, salvo que el texto ya termine en punto, exclamación, interrogación o puntos suspensivos. */
const cerrar = (texto: string) => (/[.!?…]$/.test(texto) ? texto : `${texto}.`);

/**
 * Hasta cuándo se puede enviar la llave de un reembolso y qué pasa si no llega (P-10). La fecha es la del dato, no la
 * del envío. Con el contacto de soporte dice cómo pedir que se reabra el caso; sin él, no promete un canal.
 */
function plazoDeLaLlave(venceEn: string, contactoSoporte: string | undefined): string {
  const hasta = formatearFechaHora(instante(venceEn, "venceEn"));
  const soporte = contactoSoporte?.trim();
  const cierre = soporte ? `cerramos el caso; para reabrirlo, escríbenos a ${linea(soporte, "contactoSoporte")}.` : "cerramos el caso.";
  return `Tienes hasta el ${hasta} para enviarla. Si no nos llega a tiempo, ${cierre}`;
}

function contenidoDe<P extends Plantilla>(plantilla: P, datos: DatosPorPlantilla[P]): { asunto: string; contenido: Contenido } {
  // Los tipos garantizan la forma de `datos` para cada plantilla; el switch la estrecha.
  switch (plantilla as Plantilla) {
    case "recuperacion_diagnostico": {
      const d = datos as DatosPorPlantilla["recuperacion_diagnostico"];
      const materia = linea(d.materia, "materia");
      return {
        asunto: `Tus resultados del diagnóstico de ${materia}`,
        contenido: {
          titulo: "Tus resultados están listos",
          parrafos: [
            `Hola, ${cerrar(linea(d.nombre, "nombre"))}`,
            `Terminaste el diagnóstico de ${cerrar(materia)} Con este enlace puedes ver tus resultados otra vez, desde este dispositivo o desde otro.`,
          ],
          boton: { texto: "Ver mis resultados", enlace: d.enlace },
          pie: "Este enlace es solo tuyo. No lo compartas. Si no hiciste este diagnóstico, ignora este correo.",
        },
      };
    }
    case "resena_individual": {
      const d = datos as DatosPorPlantilla["resena_individual"];
      const monitor = linea(d.monitor, "monitor");
      return {
        asunto: `¿Cómo te fue con ${monitor}?`,
        contenido: {
          titulo: "Cuéntanos cómo te fue",
          parrafos: [
            `Hola, ${cerrar(linea(d.nombre, "nombre"))}`,
            `Tu monitoría con ${monitor} ya terminó. Puedes calificarla en el enlace de abajo.`,
          ],
          boton: { texto: "Calificar la monitoría", enlace: d.enlace },
          pie: "El enlace no vence: puedes usarlo cuando quieras.",
        },
      };
    }
    case "solicitud_llave_reembolso": {
      const d = datos as DatosPorPlantilla["solicitud_llave_reembolso"];
      const monto = formatearPesos(d.monto);
      const parrafos = [`Hola, ${cerrar(linea(d.nombre, "nombre"))}`];
      // D-37: quien pagó se entera por este correo de que se aceptó el reporte de inasistencia.
      if (d.reporteAceptado) {
        parrafos.push("Revisamos el reporte de que el monitor no asistió a la monitoría y lo aceptamos: la monitoría quedó cancelada.");
      }
      parrafos.push(
        `Vamos a devolverte ${monto} de tu pago en Calibra. Motivo: ${cerrar(linea(d.motivo, "motivo"))}`,
        "Para hacer la transferencia necesitamos tu llave, por ejemplo tu celular o tu correo registrado en el banco.",
        plazoDeLaLlave(d.venceEn, d.contactoSoporte),
      );
      return {
        asunto: `Necesitamos tu llave para devolverte ${monto}`,
        contenido: {
          titulo: `Te vamos a devolver ${monto}`,
          parrafos,
          boton: { texto: "Enviar mi llave", enlace: d.enlace },
          pie: "Solo te pedimos la llave. Calibra nunca te pide claves del banco ni datos de tu tarjeta.",
        },
      };
    }
    case "recordatorio_llave_reembolso": {
      const d = datos as DatosPorPlantilla["recordatorio_llave_reembolso"];
      const monto = formatearPesos(d.monto);
      return {
        asunto: `Todavía necesitamos tu llave para devolverte ${monto}`,
        contenido: {
          titulo: "Todavía no tenemos tu llave",
          parrafos: [
            `Hola, ${cerrar(linea(d.nombre, "nombre"))}`,
            `Te pedimos tu llave para devolverte ${monto} de tu pago en Calibra y todavía no nos llega. Motivo: ${cerrar(linea(d.motivo, "motivo"))}`,
            "Tu llave puede ser tu celular o tu correo registrado en el banco.",
            plazoDeLaLlave(d.venceEn, d.contactoSoporte),
          ],
          boton: { texto: "Enviar mi llave", enlace: d.enlace },
          pie: "Si ya nos la enviaste, ignora este correo. Calibra nunca te pide claves del banco ni datos de tu tarjeta.",
        },
      };
    }
    case "pago_rechazado_individual": {
      const d = datos as DatosPorPlantilla["pago_rechazado_individual"];
      const parrafos = [
        `Hola, ${cerrar(linea(d.nombre, "nombre"))}`,
        `No pudimos verificar tu pago de ${formatearPesos(d.monto)}, así que la monitoría del ${formatearDia(d.fechaSesion)} quedó cancelada.`,
        "Como el pago no se aprobó, no hay reembolso.",
      ];
      // Un contacto vacío o en blanco es un contacto no informado: no se promete un canal que no existe.
      const soporte = d.contactoSoporte?.trim();
      if (soporte) parrafos.push(`Si crees que fue un error, escríbenos a ${linea(soporte, "contactoSoporte")}.`);
      return {
        asunto: "No pudimos verificar tu pago y la monitoría se canceló",
        contenido: {
          titulo: "Tu monitoría se canceló",
          parrafos,
          pie: "Puedes agendar otra monitoría cuando quieras.",
        },
      };
    }
    case "pago_rechazado_grupal": {
      const d = datos as DatosPorPlantilla["pago_rechazado_grupal"];
      return {
        asunto: "No pudimos verificar tu pago de la sesión grupal",
        contenido: {
          titulo: "Tu cupo quedó anulado",
          parrafos: [
            `Hola, ${cerrar(linea(d.nombre, "nombre"))}`,
            `No pudimos verificar tu pago de ${formatearPesos(d.monto)} y tu cupo en la sesión grupal del ${formatearDia(d.fechaSesion)} quedó anulado. Los demás cupos siguen como estaban.`,
            "Puedes volver a intentarlo con el enlace del grupo mientras el plazo de pago siga abierto.",
          ],
          boton: { texto: "Volver a pagar", enlace: d.enlace },
        },
      };
    }
    case "escalamiento_pago": {
      const d = datos as DatosPorPlantilla["escalamiento_pago"];
      const pagador = linea(d.nombrePagador, "nombrePagador");
      return {
        asunto: `Pago pendiente de revisión: ${pagador}`,
        contenido: {
          titulo: "Un pago te espera",
          parrafos: [
            `Hola, ${cerrar(linea(d.nombreAdmin, "nombreAdmin"))}`,
            `El pago de ${formatearPesos(d.monto)} de ${pagador} no se revisó a tiempo y ahora te toca a ti. Si tampoco se revisa a tiempo, pasa al siguiente admin.`,
          ],
          boton: { texto: "Abrir mi bandeja", enlace: d.enlace },
          pie: "Lo encuentras en la sección de pagos por revisar.",
        },
      };
    }
    case "invitacion_monitor": {
      const d = datos as DatosPorPlantilla["invitacion_monitor"];
      const vence = new Date(d.venceEn);
      if (Number.isNaN(vence.getTime())) throw new RangeError("venceEn debe ser un instante válido.");
      return {
        asunto: "Crea tu cuenta de monitor en Calibra",
        contenido: {
          titulo: "Ya puedes crear tu cuenta de monitor",
          parrafos: [
            "Hola.",
            "Después de tu evaluación presencial, el equipo de Calibra te invita a crear tu cuenta de monitor. Con ella vas a abrir tus franjas y recibir tus pagos.",
            `El enlace sirve una sola vez y vence el ${formatearFechaHora(vence)}.`,
          ],
          boton: { texto: "Crear mi cuenta", enlace: d.enlace },
          pie: "Este enlace es solo tuyo. No lo compartas. Si no esperabas esta invitación, ignora este correo.",
        },
      };
    }
    case "verificacion_lead": {
      const d = datos as DatosPorPlantilla["verificacion_lead"];
      const vence = new Date(d.venceEn);
      if (Number.isNaN(vence.getTime())) throw new RangeError("venceEn debe ser un instante válido.");
      return {
        asunto: "Confirma tu correo para agendar en Calibra",
        contenido: {
          titulo: "Confirma que este correo es tuyo",
          parrafos: [
            `Hola, ${linea(d.nombre, "nombre")}.`,
            "Alguien escribió este correo en Calibra para agendar una monitoría. Si fuiste tú, confírmalo con el botón: el navegador donde lo abras queda con tus datos y puedes seguir agendando ahí.",
            `El enlace sirve una sola vez y vence el ${formatearFechaHora(vence)}.`,
          ],
          boton: { texto: "Confirmar mi correo", enlace: d.enlace },
          pie: "Si no fuiste tú, ignora este correo: sin confirmarlo, nadie ve tus datos ni tus citas.",
        },
      };
    }
    case "aviso_monitor_confirmada": {
      const d = datos as DatosPorPlantilla["aviso_monitor_confirmada"];
      const materia = linea(d.materia, "materia");
      if (!Number.isInteger(d.duracionMin) || d.duracionMin <= 0) throw new RangeError("duracionMin debe ser un entero positivo.");
      const cuando = formatearFechaHora(instante(d.inicio, "inicio"));
      return {
        asunto: `Tienes una monitoría confirmada de ${materia}`,
        contenido: {
          titulo: "Tienes una monitoría confirmada",
          parrafos: [
            `Hola, ${cerrar(linea(d.nombreMonitor, "nombreMonitor"))}`,
            `${linea(d.nombreEstudiante, "nombreEstudiante")} tiene una monitoría contigo y ya quedó confirmada.`,
            `Cuándo: ${cerrar(cuando)}`,
            `Duración: ${d.duracionMin} minutos.`,
            `Materia: ${cerrar(materia)}`,
            `Modalidad: ${d.presencial ? "presencial" : "virtual"}.`,
          ],
          boton: { texto: "Ver mi agenda", enlace: d.enlace },
          pie: "Si no puedes darla, escríbenos cuanto antes.",
        },
      };
    }
    case "aviso_monitor_cancelada": {
      const d = datos as DatosPorPlantilla["aviso_monitor_cancelada"];
      const materia = linea(d.materia, "materia");
      const cuando = formatearFechaHora(instante(d.inicio, "inicio"));
      return {
        asunto: `Se canceló tu monitoría de ${materia}`,
        contenido: {
          titulo: "El estudiante canceló la monitoría",
          parrafos: [
            `Hola, ${cerrar(linea(d.nombreMonitor, "nombreMonitor"))}`,
            `${linea(d.nombreEstudiante, "nombreEstudiante")} canceló la monitoría de ${materia} del ${cerrar(cuando)}`,
            "No tienes que hacer nada: ya no aparece entre tus próximas monitorías.",
          ],
          boton: { texto: "Ver mi agenda", enlace: d.enlace },
        },
      };
    }
    case "confirmacion_cita": {
      const d = datos as DatosPorPlantilla["confirmacion_cita"];
      const materia = linea(d.materia, "materia");
      if (!Number.isInteger(d.duracionMin) || d.duracionMin <= 0) throw new RangeError("duracionMin debe ser un entero positivo.");
      if (!Number.isInteger(d.valorTotal) || d.valorTotal < 0) throw new RangeError("valorTotal debe ser un entero de pesos, cero o más.");
      const cuando = formatearFechaHora(instante(d.inicio, "inicio"));
      const parrafos = [
        `Hola, ${cerrar(linea(d.nombre, "nombre"))}`,
        `Tu monitoría con ${linea(d.nombreMonitor, "nombreMonitor")} quedó confirmada.`,
        `Cuándo: ${cerrar(cuando)}`,
        `Duración: ${d.duracionMin} minutos.`,
        `Materia: ${cerrar(materia)}`,
        `Modalidad: ${d.presencial ? "presencial" : "virtual"}.`,
      ];
      // D-5 y D-21: el lugar de la presencial o el enlace de la virtual llegan con la cita confirmada.
      if (d.presencial && d.lugar != null) parrafos.push(`Lugar: ${cerrar(linea(d.lugar, "lugar"))}`);
      if (!d.presencial && d.enlaceSesion != null) parrafos.push(`Enlace de la videollamada: ${enlaceSeguro(d.enlaceSesion)}`);
      parrafos.push(`Valor: ${cerrar(formatearPesos(d.valorTotal))}`);
      parrafos.push(
        d.cancelableHasta == null
          ? "No podrás cancelarla: cuando la agendaste ya había pasado el plazo para hacerlo."
          : `Puedes cancelarla hasta el ${cerrar(formatearFechaHora(instante(d.cancelableHasta, "cancelableHasta")))}`,
      );
      // D-22: el pago puede estar todavía en revisión (RN-38), así que el correo no promete que está aprobado.
      parrafos.push("Recibimos tu comprobante. Un admin lo revisa y, si hay algún problema, te avisamos a este correo.");
      // D-23: no se avisa si el monitor cambia el lugar o el enlace; la página siempre muestra el dato actual.
      parrafos.push("Si el lugar o el enlace cambian, la página de tu monitoría siempre muestra el dato actual.");
      return {
        asunto: `Tu monitoría de ${materia} está confirmada`,
        contenido: {
          titulo: "Tu monitoría está confirmada",
          parrafos,
          boton: { texto: "Ver o gestionar mi cita", enlace: d.enlace },
          pie: "Este enlace es solo tuyo. No lo compartas.",
        },
      };
    }
    case "cancelacion_cita": {
      const d = datos as DatosPorPlantilla["cancelacion_cita"];
      const materia = linea(d.materia, "materia");
      const cuando = formatearFechaHora(instante(d.inicio, "inicio"));
      for (const r of d.reembolsos) {
        if (!Number.isInteger(r.monto) || r.monto < 0) throw new RangeError("El monto de cada reembolso debe ser un entero de pesos, cero o más.");
      }
      const enlaces = d.reembolsos.map((r) => enlaceSeguro(r.enlace));
      const parrafos = [
        `Hola, ${cerrar(linea(d.nombre, "nombre"))}`,
        `Cancelaste tu monitoría de ${materia} del ${cerrar(cuando)} La fecha quedó libre.`,
      ];
      // D-27: pide la llave de los reembolsos que ya se crearon con un pago de este mismo correo (RN-60, RN-61).
      if (d.reembolsos.length > 0) {
        const suma = d.reembolsos.reduce((total, r) => total + r.monto, 0);
        parrafos.push(
          `Vamos a devolverte ${formatearPesos(suma)}. Para hacer la transferencia necesitamos tu llave, por ejemplo tu celular o tu correo registrado en el banco.`,
        );
        // El botón lleva el primero; si hubo más pagos, cada uno tiene su propia llave y su propio enlace.
        d.reembolsos.slice(1).forEach((r, i) => parrafos.push(`La llave del otro pago de ${formatearPesos(r.monto)}: ${enlaces[i + 1]}`));
      }
      if (d.reembolsoAOtroContacto) {
        parrafos.push("Le escribimos a quien pagó, a su correo, para pedirle la llave y devolverle el dinero.");
      }
      // P-07: con el pago todavía en revisión no hay reembolso que pedir; la llave se pide solo si el admin lo aprueba.
      if (d.conPagoEnRevision) parrafos.push(TEXTO_PAGO_EN_REVISION_AL_CANCELAR);
      const boton =
        d.reembolsos.length > 0
          ? { texto: "Enviar mi llave", enlace: enlaces[0] }
          : d.enlaceCita != null
            ? { texto: "Ver mi cita", enlace: d.enlaceCita }
            : undefined;
      return {
        asunto: `Cancelaste tu monitoría de ${materia}`,
        contenido: {
          titulo: "Tu monitoría quedó cancelada",
          parrafos,
          boton,
          pie:
            d.reembolsos.length > 0
              ? "Solo te pedimos la llave. Calibra nunca te pide claves del banco ni datos de tu tarjeta."
              : "Puedes agendar otra monitoría cuando quieras.",
        },
      };
    }
  }
}

/** Asunto, HTML y texto plano de una plantilla. Lanza `RangeError` si un dato es inválido. */
export function renderizar<P extends Plantilla>(plantilla: P, datos: DatosPorPlantilla[P]): CorreoRenderizado {
  const { asunto, contenido } = contenidoDe(plantilla, datos);
  return { asunto, html: armarHtml(contenido), texto: armarTexto(contenido) };
}
