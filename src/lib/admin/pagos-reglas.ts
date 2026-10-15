import { esUuid } from "@/lib/agendar/reglas";
import { esCorreo } from "@/lib/correo/contacto";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { formatearDia } from "@/lib/fechas";
import { plazoAlcanzado } from "@/lib/plazos/motor";
import type { Database } from "@/lib/supabase/tipos";
import type { EstadoDelCaso } from "./casos-p24-reglas";

/**
 * Revisar un pago (HU-020): cualquier admin activo lo aprueba o lo rechaza contra su comprobante desde que llega
 * (bandeja común, D-56, HU-034), sea cual sea su responsable según el orden de revisión. Aquí va lo puro: qué
 * responde la base, qué se le dice al admin con cada resultado, qué pasa con la monitoría si lo rechaza, a quién se le
 * avisa y los datos del correo al pagador. Quién puede revisar (un admin activo), el borde de P-24 y los cambios los
 * decide `public.revisar_pago` con su propia hora; lo de aquí solo lo anticipa en la pantalla.
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
 * aquí sino con `observacionesValidas`. Si hacen falta (P-24) lo dice la base.
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
 * HU-034 (D-56): lo que lee un admin que no es el responsable del pago en revisión. Cualquier admin activo lo puede
 * aprobar o rechazar; el responsable es el que le toca según el orden de revisión. `null` para el responsable, que no
 * necesita aviso.
 */
export function avisoDelResponsable(pago: { idAdmin: string; nombreAdmin: string }, idSesion: string): string | null {
  if (pago.idAdmin === idSesion) return null;
  return `Este pago le toca a ${pago.nombreAdmin} según el orden de revisión. Puedes aprobarlo o rechazarlo tú.`;
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

/** La monitoría como está ahora, lo único que decide a quién avisa el rechazo. */
export type MonitoriaParaElAviso = { estado: EstadoMonitoria; motivoCancelacion: MotivoCancelacion | null };

/** Qué correo le toca al pagador: el de HU-020 (la cita se canceló por el rechazo) o el de «no hay reembolso» (HU-076). */
export type CorreoAlPagador = "cita_cancelada" | "cita_ya_cancelada";

/**
 * HU-076: a quién le avisa el rechazo. Es la misma regla de `privado.anotar_aviso_rechazo_pago` y de
 * `privado.anotar_aviso_monitor`, solo para decirlo en pantalla; la base decide con la monitoría como queda al rechazar:
 * - `cancela_la_cita`: el rechazo la cancela. El pagador recibe el aviso de HU-020 y, si estaba confirmada, el monitor
 *   también (una por pagar, que con un pago no debería existir, no se le avisa al monitor: D-16).
 * - `ya_cancelada` por `pago_rechazado` (otro pago de la misma cita ya la canceló): el pagador recibe el mismo aviso
 *   de HU-020, que sigue siendo cierto; el monitor ya lo supo.
 * - `ya_cancelada` por `estudiante`: el pagador recibe el aviso corto de que no hay reembolso (D-39 d); el monitor ya lo
 *   supo por la cancelación del estudiante.
 * - Todo lo demás (P-24, otros motivos de cancelación): nadie.
 */
export function quienSeEntera(caso: CasoDeRechazo, m: MonitoriaParaElAviso): { pagador: CorreoAlPagador | null; monitor: boolean } {
  switch (caso) {
    case "cancela_la_cita":
      return { pagador: "cita_cancelada", monitor: m.estado === "confirmada" };
    case "ya_cancelada":
      if (m.motivoCancelacion === "pago_rechazado") return { pagador: "cita_cancelada", monitor: false };
      if (m.motivoCancelacion === "estudiante") return { pagador: "cita_ya_cancelada", monitor: false };
      return { pagador: null, monitor: false };
    case "ya_empezo":
    case "ya_realizada":
      return { pagador: null, monitor: false };
  }
}

/** Lo que se le dice al admin cuando el correo al pagador no puede salir: el contacto no es un correo (P-22). */
const avisarleTu = (nombre: string, contacto: string) => `El contacto de ${nombre} no es un correo: tendrás que avisarle tú, al ${contacto}.`;

/**
 * Lo que se lee antes de "Sí, rechazar el pago" (supuesto 7): qué pasa con la cita y su fecha, que no hay reembolso
 * (RN-43) y a quién se le avisa (HU-076, `quienSeEntera`). A quien no tiene un correo como contacto se le avisa el
 * admin (P-22).
 */
export function consecuenciasDelRechazo(
  caso: CasoDeRechazo,
  pago: { fechaSesion: string; nombrePagador: string; contacto: string; monitoria: MonitoriaParaElAviso },
): string {
  const { pagador, monitor } = quienSeEntera(caso, pago.monitoria);
  const aviso = (cola = "") =>
    esCorreo(pago.contacto)
      ? `Le avisaremos a ${pago.nombrePagador} por correo, a ${pago.contacto}${cola}.`
      : avisarleTu(pago.nombrePagador, pago.contacto);
  switch (caso) {
    case "cancela_la_cita":
      return (
        `Se cancela la monitoría del ${formatearDia(pago.fechaSesion)} y esa fecha queda libre para otra persona. ` +
        `${SIN_REEMBOLSO}. ${aviso()}${monitor ? " También le avisaremos al monitor." : ""}`
      );
    case "ya_empezo":
      return `La sesión ya empezó, así que la monitoría no se cancela y ${QUEDA_POR_COBRAR}. ${SIN_REEMBOLSO} y al pagador no le escribimos.`;
    case "ya_realizada":
      return `La monitoría ya se realizó, así que no se cancela y ${QUEDA_POR_COBRAR}. ${SIN_REEMBOLSO} y al pagador no le escribimos.`;
    case "ya_cancelada":
      // Cancelada por otro motivo (monitor que no asistió, diferencia no cubierta): el texto de antes de HU-076.
      if (!pagador) return `La monitoría ya estaba cancelada: solo cambia el pago. ${SIN_REEMBOLSO} y al pagador no le escribimos.`;
      return `La monitoría ya estaba cancelada: solo cambia el pago. ${SIN_REEMBOLSO}. ${aviso(pagador === "cita_ya_cancelada" ? ", que no hay reembolso" : "")}`;
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

export type AvisoDeLaPagina = { exito: boolean; texto: string };

const ERRORES_DE_LA_PAGINA = ["ya_revisado", "no_individual"] as const;

/**
 * Lo que se dice arriba de la revisión después de una acción: la acción vuelve a la página con `?revisado=` o
 * `?error=`. El éxito solo se dice si el pago de verdad quedó así: un enlace viejo o escrito a mano no anuncia una
 * revisión que no pasó. `caso` es el de `estadoDelCaso` (HU-078): un rechazo en P-24 no cancela la monitoría
 * (`revisar_pago` responde lo mismo que cuando el estudiante ya la había cancelado), así que se mira el caso como
 * quedó y no el resultado. HU-076: el correo al pagador ya no sale en la acción sino por la bandeja de salida, así que
 * la página dice que saldrá en unos minutos, según `quienSeEntera` con la monitoría como quedó.
 */
export function avisosDeLaPagina(
  consulta: Record<string, string | string[] | undefined>,
  pago: { estado: EstadoDePago; contacto: string; caso: EstadoDelCaso | null; monitoria: MonitoriaParaElAviso },
): AvisoDeLaPagina[] {
  const valor = (clave: string) => (typeof consulta[clave] === "string" ? (consulta[clave] as string) : null);
  const avisos: AvisoDeLaPagina[] = [];
  const revisado = valor("revisado");

  if (revisado === "aprobado" && pago.estado === "aprobado") {
    avisos.push({ exito: true, texto: "Aprobaste el pago. Ya no aparece en tu bandeja." });
  } else if (revisado === "rechazado" && pago.estado === "rechazado" && pago.caso === "abierto") {
    // HU-078, criterio 5: el pago sigue en la bandeja, en otra sección, hasta que alguien cierre el caso.
    avisos.push({
      exito: true,
      texto: "Rechazaste el pago. El caso quedó en «Pagos por cobrar o asumir» de la bandeja hasta que alguien lo cierre como cobrado o asumido.",
    });
  } else if (revisado === "rechazado" && pago.estado === "rechazado") {
    // Con el pago ya rechazado, la monitoría está como quedó: se mira como `ya_cancelada` (si el rechazo la canceló,
    // o si ya lo estaba) y no como la que iba a cancelarse.
    const lePertenece = quienSeEntera("ya_cancelada", pago.monitoria).pagador !== null;
    const conCorreo = lePertenece && esCorreo(pago.contacto);
    avisos.push({ exito: true, texto: `Rechazaste el pago. Ya no aparece en tu bandeja.${conCorreo ? " Le avisaremos al pagador por correo en unos minutos." : ""}` });
    if (lePertenece && !conCorreo) {
      avisos.push({ exito: false, texto: `El contacto del pagador no es un correo: avísale tú, al ${pago.contacto}.` });
    }
  }

  const error = valor("error");
  if (error === "comprobante") avisos.push({ exito: false, texto: MENSAJE_DEL_COMPROBANTE });
  else if ((ERRORES_DE_LA_PAGINA as readonly string[]).includes(error ?? "")) {
    avisos.push({ exito: false, texto: MENSAJES_DE_REVISION[error as (typeof ERRORES_DE_LA_PAGINA)[number]] });
  }
  return avisos;
}
