import { esUuid } from "@/lib/agendar/reglas";
import { esCorreo } from "@/lib/correo/contacto";
import type { Reconstruccion } from "@/lib/correo/plantillas";
// Solo el tipo: se borra al compilar, así que este módulo puro no arrastra el servidor de correo a ningún lado.
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import { formatearDia, formatearFechaHora } from "@/lib/fechas";
import { dentroDePlazo, plazoAlcanzado } from "@/lib/plazos/motor";
import type { Database } from "@/lib/supabase/tipos";
import type { EstadoDelCaso } from "./casos-p24-reglas";

/**
 * Revisar un pago (HU-020): el admin asignado lo aprueba o lo rechaza contra su comprobante y, pasada su hora,
 * cualquier admin activo (HU-077, D-38). Aquí va lo puro: quién puede revisar, qué responde la base, qué se le dice
 * al admin con cada resultado, qué pasa con la monitoría si lo rechaza y los datos del correo al pagador. Quién puede
 * revisar, el borde de P-24 y los cambios los decide `public.revisar_pago` con su propia hora; lo de aquí solo lo
 * anticipa en la pantalla.
 */

type EstadoMonitoria = Database["public"]["Enums"]["estado_monitoria"];
type MotivoCancelacion = Database["public"]["Enums"]["motivo_cancelacion"];
export type EstadoDePago = Database["public"]["Enums"]["estado_pago"];

/** Lo que responde `public.revisar_pago` (ver su migración). */
export const RESULTADOS_DE_REVISION = [
  "aprobado",
  "rechazado",
  "observaciones_requeridas",
  "observaciones_invalidas",
  "ya_revisado",
  "no_asignado",
  "no_individual",
  "no_encontrado",
  "decision_invalida",
  "sin_permiso",
  "sin_sesion",
] as const;
export type ResultadoDeRevision = (typeof RESULTADOS_DE_REVISION)[number];

export function esResultadoDeRevision(valor: unknown): valor is ResultadoDeRevision {
  return typeof valor === "string" && (RESULTADOS_DE_REVISION as readonly string[]).includes(valor);
}

export type Decision = "aprobar" | "rechazar";

export function esDecision(valor: unknown): valor is Decision {
  return valor === "aprobar" || valor === "rechazar";
}

/** Qué se le dice al admin cuando la revisión no se guardó. */
export const MENSAJES_DE_REVISION: Record<Exclude<ResultadoDeRevision, "aprobado" | "rechazado">, string> = {
  observaciones_requeridas:
    "La sesión de esta monitoría ya empezó, así que no se cancela. Para rechazar el pago escribe en observaciones qué se hará con ese cobro: cobrarlo por fuera o asumirlo.",
  observaciones_invalidas: "Las observaciones pueden tener hasta 500 caracteres.",
  ya_revisado: "Este pago ya se revisó, y una revisión no se puede cambiar.",
  // HU-077: la base responde no_asignado cuando el pago es de otro admin y su hora no ha pasado, también si se lo
  // reasignaron con una hora nueva mientras se revisaba.
  no_asignado: "Este pago está asignado a otro admin y su hora para revisarlo no ha pasado, así que todavía no puedes revisarlo.",
  no_individual: "Los pagos de las monitorías grupales todavía no se revisan aquí.",
  no_encontrado: "No encontramos este pago.",
  decision_invalida: "Elige si apruebas o rechazas el pago.",
  sin_permiso: "Solo un admin activo revisa pagos.",
  sin_sesion: "Tu sesión terminó. Vuelve a entrar e intenta de nuevo.",
};

export const MENSAJE_DE_FALLO = "No pudimos guardar la revisión. Intenta de nuevo; si sigue igual, avisa al equipo.";

export const MENSAJE_DEL_COMPROBANTE = "No pudimos abrir el comprobante. Intenta de nuevo; si sigue igual, avisa al equipo.";

/** Largo máximo de las observaciones: el mismo `check` de `pago.observaciones`. */
export const LARGO_MAXIMO_OBSERVACIONES = 500;

export type PedidoDeRevision = { idPago: string; decision: Decision; observaciones: string | null };

export type LecturaDeRevision = { ok: true; datos: PedidoDeRevision } | { ok: false; error: string };

/**
 * El formulario de la revisión. Las observaciones se recortan y, vacías, cuentan como ninguna. Su largo no se mira
 * aquí sino con `observacionesValidas`, después de saber que la sesión puede revisar (nota de D-39, HU-077). Si hacen
 * falta (P-24) lo dice la base.
 */
export function leerRevision(datos: FormData): LecturaDeRevision {
  const texto = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor.trim() : "";
  };
  const idPago = texto("id_pago").toLowerCase();
  if (!esUuid(idPago)) return { ok: false, error: MENSAJES_DE_REVISION.no_encontrado };
  const decision = texto("decision");
  if (!esDecision(decision)) return { ok: false, error: MENSAJES_DE_REVISION.decision_invalida };
  return { ok: true, datos: { idPago, decision, observaciones: texto("observaciones") || null } };
}

/**
 * Las observaciones caben en `pago.observaciones`. Se cuentan por caracteres, como `char_length` en la base, no por
 * unidades de JavaScript.
 */
export function observacionesValidas(observaciones: string | null): boolean {
  return observaciones === null || [...observaciones].length <= LARGO_MAXIMO_OBSERVACIONES;
}

/**
 * Quién es la sesión frente a un pago en revisión (D-38, HU-077):
 * - `asignado`: el admin asignado. Revisa aunque se le haya pasado la hora (supuesto 5).
 * - `hora_vencida`: otro admin, y la hora del asignado ya pasó. Puede aprobarlo o rechazarlo.
 * - `en_hora`: otro admin, y la hora del asignado no ha pasado. No puede revisarlo.
 * P-40 (supuesto 1): en `revisionHasta` exacto el pago todavía es solo del asignado. Que la sesión sea un admin
 * activo lo exige quien llama (`exigirRol`); la base lo vuelve a decidir todo con su propia hora.
 */
export type QuienRevisa = "asignado" | "hora_vencida" | "en_hora";

export function quienRevisa(pago: { idAdmin: string; revisionHasta: Date }, idSesion: string, ahora: Date): QuienRevisa {
  if (pago.idAdmin === idSesion) return "asignado";
  return dentroDePlazo(pago.revisionHasta, ahora) ? "en_hora" : "hora_vencida";
}

export function puedeRevisar(pago: { idAdmin: string; revisionHasta: Date }, idSesion: string, ahora: Date): boolean {
  return quienRevisa(pago, idSesion, ahora) !== "en_hora";
}

/**
 * Lo que lee otro admin sobre el pago en revisión (criterios 1 y 2): hasta cuándo es del asignado, o que su hora ya
 * pasó y lo puede revisar él. `null` para el asignado, que no necesita aviso.
 */
export function avisoDeQuienRevisa(quien: QuienRevisa, pago: { nombreAdmin: string; revisionHasta: Date }): string | null {
  const limite = formatearFechaHora(pago.revisionHasta);
  switch (quien) {
    case "asignado":
      return null;
    case "en_hora":
      return `${conPunto(`Este pago está asignado a ${pago.nombreAdmin} hasta el ${limite}`)} Si para entonces no lo ha revisado, podrás aprobarlo o rechazarlo tú.`;
    case "hora_vencida":
      return `${conPunto(`Este pago está asignado a ${pago.nombreAdmin}, pero se le pasó la hora el ${limite}`)} Puedes aprobarlo o rechazarlo tú.`;
  }
}

/** La frase con su punto final. Si ya termina en la abreviatura de la hora (`a. m.`), ese punto sirve de cierre. */
function conPunto(frase: string): string {
  return frase.endsWith(".") ? frase : `${frase}.`;
}

/**
 * Qué pasa con la monitoría si se rechaza su pago:
 * - `cancela_la_cita`: aún no empieza (o sigue por pagar, que con un pago no debería existir). Se cancela por
 *   `pago_rechazado` y la fecha queda libre (RN-43, criterio 3).
 * - `ya_empezo` y `ya_realizada`: P-24 (supuesto 2). No se cancela y el admin anota el caso en observaciones.
 * - `ya_cancelada`: el estudiante (u otro motivo) ya la canceló. Solo cambia el pago (docs/reparto.md, 2-oct).
 */
export type CasoDeRechazo = "cancela_la_cita" | "ya_empezo" | "ya_realizada" | "ya_cancelada";

/**
 * La misma regla de `privado.revisar_pago`: una confirmada ya empezó desde su inicio, con el borde incluido (P-40,
 * como `finalizar_monitoria`). La base lo vuelve a decidir con su hora al rechazar.
 */
export function casoDeRechazo(estado: EstadoMonitoria, inicio: Date, ahora: Date): CasoDeRechazo {
  if (estado === "realizada") return "ya_realizada";
  if (estado === "cancelada") return "ya_cancelada";
  if (estado === "confirmada" && plazoAlcanzado(inicio, ahora)) return "ya_empezo";
  return "cancela_la_cita";
}

/** P-24 (supuesto 3): el rechazo de una monitoría que ya empezó o se realizó exige observaciones. */
export function pideObservaciones(caso: CasoDeRechazo): boolean {
  return caso === "ya_empezo" || caso === "ya_realizada";
}

const SIN_REEMBOLSO = "Un pago rechazado no se reembolsa";

/** HU-078 (D-39): en P-24 el rechazo deja un caso abierto, que cuenta en el desembolso cuando alguien lo cierra. */
const QUEDA_POR_COBRAR =
  "el caso queda en «Pagos por cobrar o asumir»: el pago cuenta en el desembolso del monitor solo cuando alguien lo cierre como cobrado o asumido";

/**
 * Lo que se lee antes de "Sí, rechazar el pago" (supuesto 7): qué pasa con la cita y su fecha, que no hay reembolso
 * (RN-43) y si se le escribe al pagador (supuesto 4). Solo se le escribe cuando el rechazo cancela la cita, y solo
 * si su contacto es un correo (P-22).
 */
export function consecuenciasDelRechazo(
  caso: CasoDeRechazo,
  pago: { fechaSesion: string; nombrePagador: string; contacto: string },
): string {
  switch (caso) {
    case "cancela_la_cita": {
      const aviso = esCorreo(pago.contacto)
        ? `Le avisamos a ${pago.nombrePagador} por correo, a ${pago.contacto}.`
        : `El contacto de ${pago.nombrePagador} no es un correo: tendrás que avisarle tú, al ${pago.contacto}.`;
      return `Se cancela la monitoría del ${formatearDia(pago.fechaSesion)} y esa fecha queda libre para otra persona. ${SIN_REEMBOLSO}. ${aviso}`;
    }
    case "ya_empezo":
      return `La sesión ya empezó, así que la monitoría no se cancela y ${QUEDA_POR_COBRAR}. ${SIN_REEMBOLSO} y al pagador no le escribimos.`;
    case "ya_realizada":
      return `La monitoría ya se realizó, así que no se cancela y ${QUEDA_POR_COBRAR}. ${SIN_REEMBOLSO} y al pagador no le escribimos.`;
    case "ya_cancelada":
      return `La monitoría ya estaba cancelada: solo cambia el pago. ${SIN_REEMBOLSO} y al pagador no le escribimos.`;
  }
}

/** La ayuda del campo de observaciones: obligatorias en P-24, opcionales en los demás casos. */
export function ayudaDeObservaciones(caso: CasoDeRechazo): string {
  return pideObservaciones(caso)
    ? `Obligatorias: escribe qué se hará con ese cobro, si cobrarlo por fuera o asumirlo. Hasta ${LARGO_MAXIMO_OBSERVACIONES} caracteres.`
    : `Opcionales: lo que quieras dejar anotado sobre el rechazo. Hasta ${LARGO_MAXIMO_OBSERVACIONES} caracteres.`;
}

/** Lo que hace falta del pago para el correo de rechazo. */
export type PagoParaElCorreo = {
  estado: EstadoDePago;
  contacto: string;
  nombrePagador: string;
  monto: number;
  monitoria: { estado: EstadoMonitoria; motivoCancelacion: MotivoCancelacion | null; fecha: string } | null;
};

/**
 * El correo al pagador cuando el rechazo canceló su cita (criterio 3, supuesto 4): plantilla
 * `pago_rechazado_individual`, a `pago.contacto` (RN-44), con el correo de Calibra como contacto de soporte. Es
 * `null` si ya no aplica: el pago no está rechazado o su monitoría no se canceló por `pago_rechazado` (P-24 y la cita
 * que el estudiante ya canceló no se avisan). Lo usan el primer envío y el reintento (HU-065): los mismos datos dan
 * el mismo correo.
 */
export function correoDeRechazo(pago: PagoParaElCorreo, contactoSoporte: string | null): Reconstruccion<"pago_rechazado_individual"> | null {
  const m = pago.monitoria;
  if (pago.estado !== "rechazado" || !m || m.estado !== "cancelada" || m.motivoCancelacion !== "pago_rechazado") return null;
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

/**
 * Cómo quedó el aviso al pagador, para decírselo al admin. `por_reintentar`: quedó `fallido` o en curso en
 * `correo_envio` y lo reintenta HU-065. `fallo`: no quedó registro, así que nadie lo va a reintentar.
 */
export type AvisoAlPagador = "enviado" | "por_reintentar" | "no_es_correo" | "fallo";

const AVISOS: readonly AvisoAlPagador[] = ["enviado", "por_reintentar", "no_es_correo", "fallo"];

export function esAvisoAlPagador(valor: unknown): valor is AvisoAlPagador {
  return AVISOS.includes(valor as AvisoAlPagador);
}

export function avisoDelEnvio(envio: ResultadoEnvio): AvisoAlPagador {
  if (envio.ok) return "enviado";
  if (envio.motivo === "contacto_no_es_correo") return "no_es_correo";
  if (envio.motivo === "fallo_del_registro") return "fallo";
  return "por_reintentar";
}

export type AvisoDeLaPagina = { exito: boolean; texto: string };

const ERRORES_DE_LA_PAGINA = ["ya_revisado", "no_asignado", "no_individual"] as const;

/**
 * Lo que se dice arriba de la revisión después de una acción: la acción vuelve a la página con `?revisado=`,
 * `?correo=` o `?error=`. El éxito solo se dice si el pago de verdad quedó así: un enlace viejo o escrito a mano no
 * anuncia una revisión que no pasó. `caso` es el de `estadoDelCaso` (HU-078): un rechazo en P-24 no cancela la
 * monitoría (`revisar_pago` responde lo mismo que cuando el estudiante ya la había cancelado), así que se mira el caso
 * como quedó y no el resultado.
 */
export function avisosDeLaPagina(
  consulta: Record<string, string | string[] | undefined>,
  pago: { estado: EstadoDePago; contacto: string; caso: EstadoDelCaso | null },
): AvisoDeLaPagina[] {
  const valor = (clave: string) => (typeof consulta[clave] === "string" ? (consulta[clave] as string) : null);
  const avisos: AvisoDeLaPagina[] = [];
  const revisado = valor("revisado");
  const correo = valor("correo");

  if (revisado === "aprobado" && pago.estado === "aprobado") {
    avisos.push({ exito: true, texto: "Aprobaste el pago. Ya no aparece en tu bandeja." });
  } else if (revisado === "rechazado" && pago.estado === "rechazado" && pago.caso === "abierto") {
    // HU-078, criterio 5: el pago sigue en la bandeja, en otra sección, hasta que alguien cierre el caso.
    avisos.push({
      exito: true,
      texto: "Rechazaste el pago. El caso quedó en «Pagos por cobrar o asumir» de la bandeja hasta que alguien lo cierre como cobrado o asumido.",
    });
  } else if (revisado === "rechazado" && pago.estado === "rechazado") {
    const enviado = correo === "enviado" ? " Le avisamos al pagador por correo." : "";
    avisos.push({ exito: true, texto: `Rechazaste el pago. Ya no aparece en tu bandeja.${enviado}` });
    if (correo === "por_reintentar") {
      avisos.push({
        exito: false,
        texto: `El correo a ${pago.contacto} no salió todavía. Calibra lo reintenta solo; si no sale, lo verás en tu bandeja en "Correos que no salieron".`,
      });
    } else if (correo === "no_es_correo") {
      avisos.push({ exito: false, texto: `El contacto del pagador no es un correo: avísale tú, al ${pago.contacto}.` });
    } else if (correo === "fallo") {
      avisos.push({ exito: false, texto: `No pudimos avisarle al pagador. Escríbele tú a ${pago.contacto}.` });
    }
  }

  const error = valor("error");
  if (error === "comprobante") avisos.push({ exito: false, texto: MENSAJE_DEL_COMPROBANTE });
  else if ((ERRORES_DE_LA_PAGINA as readonly string[]).includes(error ?? "")) {
    avisos.push({ exito: false, texto: MENSAJES_DE_REVISION[error as (typeof ERRORES_DE_LA_PAGINA)[number]] });
  }
  return avisos;
}
