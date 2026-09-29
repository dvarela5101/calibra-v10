import { formatearDia } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";
import { armarHtml, armarTexto, type Contenido } from "./html";

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
  "pago_rechazado_individual",
  "pago_rechazado_grupal",
  "escalamiento_pago",
] as const;

export type Plantilla = (typeof PLANTILLAS)[number];

export type DatosPorPlantilla = {
  /** Diagnóstico completado: enlace con token para recuperar los resultados (RN-12). Al Lead. */
  recuperacion_diagnostico: { nombre: string; materia: string; enlace: string };
  /** Monitoría individual realizada: enlace a la reseña, sin límite de tiempo (RN-72). Al Lead. */
  resena_individual: { nombre: string; monitor: string; enlace: string };
  /** Reembolso creado: se pide la llave para devolver el dinero (RN-61). Al pagador. */
  solicitud_llave_reembolso: { nombre: string; monto: number; motivo: string; enlace: string };
  /** Pago rechazado en una individual: la cita se cancela y no hay reembolso (RN-43). Al pagador. */
  pago_rechazado_individual: { nombre: string; monto: number; fechaSesion: string; contactoSoporte?: string };
  /** Pago rechazado en una grupal: se anula solo ese cupo y puede volver a intentar (RN-43). Al pagador. */
  pago_rechazado_grupal: { nombre: string; monto: number; fechaSesion: string; enlace: string };
  /** Pago sin revisar tras el plazo: pasa al siguiente admin (RN-42). Al admin. */
  escalamiento_pago: { nombreAdmin: string; nombrePagador: string; monto: number; enlace: string };
};

export type CorreoRenderizado = { asunto: string; html: string; texto: string };

/** Un texto que viene de fuera: no vacío y en una sola línea (va también al asunto). */
function linea(valor: string, campo: string): string {
  const limpio = valor.replace(/\s+/g, " ").trim();
  if (!limpio) throw new RangeError(`${campo} no puede estar vacío.`);
  return limpio;
}

/** Cierra una oración con punto, salvo que el texto ya termine en punto, exclamación, interrogación o puntos suspensivos. */
const cerrar = (texto: string) => (/[.!?…]$/.test(texto) ? texto : `${texto}.`);

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
      return {
        asunto: `Necesitamos tu llave para devolverte ${monto}`,
        contenido: {
          titulo: `Te vamos a devolver ${monto}`,
          parrafos: [
            `Hola, ${cerrar(linea(d.nombre, "nombre"))}`,
            `Vamos a devolverte ${monto} de tu pago en Calibra. Motivo: ${cerrar(linea(d.motivo, "motivo"))}`,
            "Para hacer la transferencia necesitamos tu llave, por ejemplo tu celular o tu correo registrado en el banco.",
          ],
          boton: { texto: "Enviar mi llave", enlace: d.enlace },
          pie: "Solo te pedimos la llave. Calibra nunca te pide claves del banco ni datos de tu tarjeta.",
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
  }
}

/** Asunto, HTML y texto plano de una plantilla. Lanza `RangeError` si un dato es inválido. */
export function renderizar<P extends Plantilla>(plantilla: P, datos: DatosPorPlantilla[P]): CorreoRenderizado {
  const { asunto, contenido } = contenidoDe(plantilla, datos);
  return { asunto, html: armarHtml(contenido), texto: armarTexto(contenido) };
}
