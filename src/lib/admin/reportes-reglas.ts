import { esUuid } from "@/lib/agendar/reglas";
import { formatearDia, formatearFechaHora } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";
import { dentroDePlazo } from "@/lib/plazos/motor";
import type { Database } from "@/lib/supabase/tipos";
import type { CierreDeCaso, EstadoDelCaso } from "./casos-p24-reglas";

/**
 * Resolver un reporte de inasistencia (HU-030): el admin asignado lo acepta o lo rechaza, con observaciones opcionales
 * (RN-62, RN-63, D-37). Aquí va lo puro: qué responde la base, qué se le dice al admin con cada resultado, la lectura del
 * formulario, quién puede resolver, lo que se lee antes de cada confirmación y los avisos de la página. Quién puede
 * resolver, si el reporte sigue en revisión y qué cambia con cada decisión lo decide `public.resolver_reporte_inasistencia`
 * bajo candado; lo de aquí solo lo anticipa en la pantalla. Ningún texto lleva cifras de comisión (CLAUDE.md): el
 * reembolso es el pago completo (RN-60) y del desembolso nunca se habla en pesos.
 */

export type EstadoDeReporte = Database["public"]["Enums"]["estado_reporte"];
export type EstadoDePago = Database["public"]["Enums"]["estado_pago"];
export type EstadoDeReembolso = Database["public"]["Enums"]["estado_reembolso"];
export type EstadoDeDesembolso = Database["public"]["Enums"]["estado_desembolso"];

/**
 * Lo que responde `public.resolver_reporte_inasistencia`, en el orden en que la base los mira (ver su migración): quién
 * puede, antes que el texto.
 */
export const RESULTADOS_DE_RESOLUCION = [
  "aceptado",
  "rechazado",
  "sin_sesion",
  "sin_permiso",
  "decision_invalida",
  "no_encontrado",
  "no_asignado",
  "observaciones_invalidas",
  "ya_decidido",
  "no_individual",
  "no_aceptable",
] as const;
export type ResultadoDeResolucion = (typeof RESULTADOS_DE_RESOLUCION)[number];

export function esResultadoDeResolucion(valor: unknown): valor is ResultadoDeResolucion {
  return typeof valor === "string" && (RESULTADOS_DE_RESOLUCION as readonly string[]).includes(valor);
}

export type Decision = "aceptar" | "rechazar";

export function esDecision(valor: unknown): valor is Decision {
  return valor === "aceptar" || valor === "rechazar";
}

/** Qué se le dice al admin cuando la decisión no se guardó. */
export const MENSAJES_DE_RESOLUCION: Record<Exclude<ResultadoDeResolucion, "aceptado" | "rechazado">, string> = {
  ya_decidido: "Este reporte ya se resolvió, y una decisión no se puede cambiar.",
  no_asignado: "Este reporte está asignado a otro admin: solo esa persona lo resuelve.",
  no_individual: "Los reportes de las monitorías grupales todavía no se resuelven aquí.",
  no_aceptable: "La monitoría ya no está confirmada ni realizada, así que no se puede aceptar el reporte. Puedes rechazarlo.",
  observaciones_invalidas: "Las observaciones pueden tener hasta 500 caracteres.",
  decision_invalida: "Elige si aceptas o rechazas el reporte.",
  no_encontrado: "No encontramos este reporte.",
  sin_permiso: "Solo un admin activo resuelve reportes.",
  sin_sesion: "Tu sesión terminó. Vuelve a entrar e intenta de nuevo.",
};

export const MENSAJE_DE_FALLO = "No pudimos guardar la decisión. Intenta de nuevo; si sigue igual, avisa al equipo.";

/**
 * Largo máximo de las observaciones: el mismo `check` de `reporte_inasistencia.observaciones`
 * (`reporte_observaciones_con_texto`, HU-029). Es propio: el de `pago.observaciones` es otro `check`.
 */
export const LARGO_MAXIMO_OBSERVACIONES = 500;

/** Lo que cambió mientras el admin miraba: la acción vuelve a la página con `?error=` y la página se pinta como quedó. */
export const CAMBIOS_DEL_REPORTE = ["no_asignado", "ya_decidido", "no_individual", "no_aceptable"] as const satisfies readonly ResultadoDeResolucion[];

/** La ayuda del campo de observaciones de cada decisión: quién las lee (supuesto 2). */
export const AYUDA_AL_ACEPTAR = `Opcionales. Hasta ${LARGO_MAXIMO_OBSERVACIONES} caracteres. Quien pagó lee este comentario junto con la solicitud de su llave, en el correo y en la página donde la envía: escríbelo pensando en esa persona.`;
export const AYUDA_AL_RECHAZAR = `Opcionales. Hasta ${LARGO_MAXIMO_OBSERVACIONES} caracteres. Quien reportó lo lee en la página de su cita: escríbelo pensando en esa persona.`;

export type PedidoDeResolucion = { idReporte: string; decision: Decision; observaciones: string | null };

export type LecturaDeResolucion = { ok: true; datos: PedidoDeResolucion } | { ok: false; error: string };

/**
 * El formulario de la decisión. Las observaciones se recortan y, vacías, cuentan como ninguna. Su largo no se mira aquí
 * sino con `observacionesValidas`, después de saber que la sesión puede resolver (nota de D-39, HU-077).
 *
 * El navegador envía cada salto de línea de un `<textarea>` como CRLF (dos caracteres), aunque el `maxlength` del campo
 * cuenta cada uno como uno. Se vuelven a un solo `\n` antes de recortar y de contar: así lo que el campo deja escribir
 * (500) es lo que la acción y el `check` de la base aceptan, y lo que se guarda no lleva `\r`.
 */
export function leerResolucion(datos: FormData): LecturaDeResolucion {
  const texto = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor.replace(/\r\n?/g, "\n").trim() : "";
  };
  const idReporte = texto("id_reporte").toLowerCase();
  if (!esUuid(idReporte)) return { ok: false, error: MENSAJES_DE_RESOLUCION.no_encontrado };
  const decision = texto("decision");
  if (!esDecision(decision)) return { ok: false, error: MENSAJES_DE_RESOLUCION.decision_invalida };
  return { ok: true, datos: { idReporte, decision, observaciones: texto("observaciones") || null } };
}

/**
 * Las observaciones caben en `reporte_inasistencia.observaciones`. Se cuentan por caracteres, como `char_length` en la
 * base, no por unidades de JavaScript.
 */
export function observacionesValidas(observaciones: string | null): boolean {
  return observaciones === null || [...observaciones].length <= LARGO_MAXIMO_OBSERVACIONES;
}

/**
 * Solo el admin asignado resuelve, y solo mientras el reporte está en revisión (RN-62, RN-63: los reportes no tienen
 * escalamiento; supuesto 1). Que la sesión sea un admin activo lo exige `exigirRol`; la base lo vuelve a decidir.
 */
export function puedeResolver(reporte: { estado: EstadoDeReporte; idAdmin: string }, idSesion: string): boolean {
  return reporte.estado === "en_revision" && reporte.idAdmin === idSesion;
}

export const TEXTOS_DEL_ESTADO: Record<EstadoDeReporte, string> = {
  en_revision: "En revisión",
  aceptado: "Aceptado",
  rechazado: "Rechazado",
};

export const TEXTOS_DEL_ESTADO_DE_PAGO: Record<EstadoDePago, string> = {
  aprobado: "Aprobado",
  en_revision: "En revisión",
  rechazado: "Rechazado",
};

export const TEXTOS_DEL_REEMBOLSO: Record<EstadoDeReembolso, string> = {
  esperando_llave: "Reembolso: esperando la llave",
  pendiente: "Reembolso: listo para transferir",
  reembolsado: "Reembolso: reembolsado",
};

/** El pago de un reporte tal como lo necesitan las consecuencias y los avisos: nunca bruto, comisión ni neto. */
export type PagoDelReporte = {
  nombrePagador: string;
  monto: number;
  estado: EstadoDePago;
  /** HU-078: `abierto` o `cerrado` si es un caso P-24 (`estadoDelCaso`); `null` si no lo es. */
  caso: EstadoDelCaso | null;
  /** Cómo se cerró su caso P-24, si se cerró. */
  cierre: CierreDeCaso | null;
};

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/**
 * Lo que se lee antes de «Sí, aceptar el reporte» (D-37): qué pasa con la monitoría, el desembolso, los pagos y los
 * correos, armado desde el estado real. Solo lo que aplica, en este orden. Un pago `rechazado` nunca se reembolsa (RN-43):
 * si su caso P-24 estaba abierto deja de estarlo (HU-078), y si se cerró como cobrado no se devuelve desde aquí (pregunta 8).
 */
export function consecuenciasDeAceptar(vista: {
  fechaSesion: string;
  desembolso: EstadoDeDesembolso | null;
  pagos: PagoDelReporte[];
}): string {
  const frases: string[] = [];
  const dia = formatearDia(vista.fechaSesion);
  frases.push(
    vista.desembolso === "desembolsado"
      ? `La monitoría del ${dia} pasa a cancelada porque el monitor no asistió. Su desembolso ya se había transferido al monitor y no se anula.`
      : `La monitoría del ${dia} pasa a cancelada porque el monitor no asistió, y no se le desembolsa.`,
  );

  const aprobados = vista.pagos.filter((p) => p.estado === "aprobado");
  const enRevision = vista.pagos.filter((p) => p.estado === "en_revision");
  if (aprobados.length === 1) {
    frases.push(`Creamos un reembolso de ${formatearPesos(aprobados[0].monto)} y le pedimos la llave a quien pagó, por correo.`);
  } else if (aprobados.length > 1) {
    const suma = aprobados.reduce((total, p) => total + p.monto, 0);
    frases.push(`Creamos ${aprobados.length} reembolsos por ${formatearPesos(suma)} en total y le pedimos la llave a cada pagador, por correo.`);
  }
  if (enRevision.length > 0) {
    frases.push(
      `${enRevision.length} ${plural(enRevision.length, "pago sigue", "pagos siguen")} en revisión: ${plural(enRevision.length, "recibe", "cada uno recibe")} su reembolso cuando se apruebe, y si se rechaza no hay reembolso.`,
    );
  }
  for (const pago of vista.pagos) {
    if (pago.estado !== "rechazado") continue;
    if (pago.caso === "abierto") {
      frases.push(`El pago rechazado de ${pago.nombrePagador} deja de estar por cobrar o asumir: la monitoría se cancela y no se le cobra.`);
    } else if (pago.cierre === "cobrado") {
      frases.push(
        `El pago rechazado de ${pago.nombrePagador} se cerró como cobrado por fuera y no se reembolsa desde aquí: si hay que devolverlo, se resuelve por fuera.`,
      );
    }
  }
  if (aprobados.length === 0 && enRevision.length === 0) frases.push("No hay pagos aprobados que reembolsar.");

  frases.push("Le avisamos al monitor por correo, sin los datos de contacto de quien reportó.");
  frases.push("Esta decisión no se puede deshacer.");
  return frases.join(" ");
}

/**
 * Lo que se lee antes de «Sí, rechazar el reporte»: la monitoría no cambia, el desembolso que esperaba el reporte vuelve a
 * poder ejecutarse (RN-83) y el Lead lo ve en su cita sin que le llegue un correo. `ahora` decide si la ventana de reporte
 * ya terminó: el desembolso es ejecutable después de `desembolsableDesde`, no desde él (N-6).
 */
export function consecuenciasDeRechazar(
  vista: { desembolso: EstadoDeDesembolso | null; desembolsableDesde: Date },
  ahora: Date,
): string {
  const frases = ["La monitoría sigue como estaba y no se crea ningún reembolso. El reporte no se puede volver a hacer."];
  if (vista.desembolso === "pendiente") {
    frases.push(
      dentroDePlazo(vista.desembolsableDesde, ahora)
        ? `El desembolso de esta monitoría deja de esperar este reporte: se puede ejecutar cuando termine la ventana de reporte (después del ${formatearFechaHora(vista.desembolsableDesde)}), si nada más lo bloquea.`
        : "El desembolso de esta monitoría deja de esperar este reporte: ya se puede ejecutar si nada más lo bloquea.",
    );
  }
  frases.push("Quien reportó verá tu decisión y tus observaciones en la página de su cita; no le mandamos correo.");
  frases.push("Esta decisión no se puede deshacer.");
  return frases.join(" ");
}

export type AvisoDeLaPagina = { exito: boolean; texto: string };

/**
 * Lo que se dice arriba de la página después de una acción: la acción vuelve con `?resuelto=` o `?error=`. El éxito solo
 * se dice si el reporte de verdad quedó así: un enlace viejo o escrito a mano no anuncia una decisión que no pasó. Lo
 * que se agrega sale de la base como quedó (`reporte.desembolso`, los reembolsos y los pagos en revisión), no del resultado.
 */
export function avisosDeLaPagina(
  consulta: Record<string, string | string[] | undefined>,
  reporte: {
    estado: EstadoDeReporte;
    desembolso: EstadoDeDesembolso | null;
    pagos: { estado: EstadoDePago; tieneReembolso: boolean }[];
  },
): AvisoDeLaPagina[] {
  const valor = (clave: string) => (typeof consulta[clave] === "string" ? (consulta[clave] as string) : null);
  const avisos: AvisoDeLaPagina[] = [];
  const resuelto = valor("resuelto");

  if (resuelto === "aceptado" && reporte.estado === "aceptado") {
    let texto = "Aceptaste el reporte.";
    if (reporte.desembolso === "anulado") texto += " La monitoría quedó cancelada y su desembolso, anulado.";
    else if (reporte.desembolso === "desembolsado") texto += " La monitoría quedó cancelada. Su desembolso ya se había transferido y no se anuló.";
    else texto += " La monitoría quedó cancelada y no se le desembolsa al monitor.";
    const reembolsos = reporte.pagos.filter((p) => p.tieneReembolso).length;
    if (reembolsos > 0) {
      texto += ` Creamos ${reembolsos} ${plural(reembolsos, "reembolso", "reembolsos")} y le pedimos la llave a quien pagó.`;
    }
    if (reporte.pagos.some((p) => p.estado === "en_revision")) texto += " Los pagos en revisión recibirán el suyo cuando se aprueben.";
    texto += " Le avisamos al monitor por correo.";
    avisos.push({ exito: true, texto });
  } else if (resuelto === "rechazado" && reporte.estado === "rechazado") {
    avisos.push({
      exito: true,
      texto: "Rechazaste el reporte. La monitoría sigue como estaba. Quien reportó verá tu decisión en la página de su cita.",
    });
  }

  const error = valor("error");
  if ((CAMBIOS_DEL_REPORTE as readonly string[]).includes(error ?? "")) {
    avisos.push({ exito: false, texto: MENSAJES_DE_RESOLUCION[error as (typeof CAMBIOS_DEL_REPORTE)[number]] });
  }
  return avisos;
}
