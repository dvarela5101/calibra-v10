/**
 * Lo puro de los reembolsos. HU-024 arrancó el enlace de la llave (D-26, D-27): la ruta de la página donde la persona
 * da su llave y los textos fijos con que se explica el reembolso al cancelar. El token vive en `solicitud_llave` y es
 * uno por reembolso, lo cree quien lo cree (HU-024, P-07, HU-030).
 *
 * HU-025 (P-10, P-22) agrega la página de la llave (validar la llave, los estados que muestra y sus textos), los
 * correos que la piden (cuándo siguen valiendo y con qué datos) y lo que se le dice al admin al reabrir un caso cerrado.
 * Si se puede entregar, hasta cuándo y si el caso está cerrado lo decide la base con su hora (`public.entregar_llave`,
 * `public.datos_de_llave`, borde inclusivo de P-40): aquí no se recalcula. La llave nunca sale de la base hacia la
 * página ni hacia los correos (criterio 3). Aquí no hay cifras de comisión: el reembolso es siempre el valor completo
 * del pago.
 *
 * HU-026 agrega lo que se le dice al admin al reenviar el enlace desde la página del reembolso.
 */
import type { MotivoDeCancelacion } from "@/lib/citas/reglas";
import type { DatosPorPlantilla } from "@/lib/correo/plantillas";
import { formatearFechaHora } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";

/** La página de la llave (HU-025) y la base del enlace del correo. */
export const RUTA_DE_LLAVE = "/reembolso";

const FORMATO_TOKEN = /^[0-9a-f]{64}$/;

/** Ruta del enlace del correo que pide la llave, para `urlDelSitio`. */
export function rutaDeLlave(token: string): string {
  return `${RUTA_DE_LLAVE}?token=${token}`;
}

/** ¿Tiene forma de token de llave (64 hexadecimales en minúscula)? Lo que no la tiene ni se consulta en la base. */
export function tieneFormaDeTokenDeLlave(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_TOKEN.test(valor);
}

/** El motivo del reembolso que crea una cancelación a tiempo del estudiante (D-26). Se guarda en `reembolso.motivo`. */
export const MOTIVO_CANCELACION_A_TIEMPO = "Cancelaste la monitoría dentro del plazo.";

/**
 * La base del motivo del reembolso cuando se acepta un reporte de inasistencia (D-37, HU-030): el texto de
 * `privado.motivo_de_inasistencia`, al que se le suma, si las hay, un espacio y las observaciones del admin. Se guarda
 * en `reembolso.motivo`. Una prueba de integración compara esta constante con la que escribe la base.
 */
export const MOTIVO_INASISTENCIA_ACEPTADA = "El monitor no asistió a la monitoría.";

/**
 * Qué se le dice a quien cancela con un pago todavía en revisión (D-27, P-07): el reembolso depende de que el admin
 * lo apruebe. Lo usan el correo de cancelación y la página de la cita.
 */
export const TEXTO_PAGO_EN_REVISION_AL_CANCELAR =
  "Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.";

// ---------------------------------------------------------------------------
// La llave (supuesto 3 de HU-025)
// ---------------------------------------------------------------------------

/** El largo máximo de la llave, como la del monitor (`reembolso_llave_con_texto` en la base). */
export const LARGO_MAXIMO_LLAVE = 200;

/** La llave como la guarda la base: los espacios seguidos cuentan como uno y no hay espacios en los bordes. */
export function normalizarLlave(valor: unknown): string {
  return typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";
}

/**
 * `null` si la llave (ya normalizada) sirve; si no, qué decirle a la persona. Es texto libre: el celular, el correo o el
 * alias registrado en el banco. Cuenta caracteres como la base (`char_length`), no unidades de JavaScript. La base la
 * vuelve a revisar al guardarla.
 */
export function validarLlaveDeReembolso(llave: string): string | null {
  if (!llave) return "Escribe tu llave para que podamos devolverte el dinero.";
  if (Array.from(llave).length > LARGO_MAXIMO_LLAVE) return `La llave es demasiado larga: puede tener hasta ${LARGO_MAXIMO_LLAVE} caracteres.`;
  return null;
}

/**
 * Lo que responde `public.entregar_llave`. Nunca trae la llave. Con la llave ya guardada, `ya_entregada` dice que la que
 * llegó es la misma (un doble clic, otra pestaña, un reintento) y `ya_entregada_otra`, que es distinta y no se cambió
 * (supuesto 3).
 */
export const RESULTADOS_DE_ENTREGAR = ["entregada", "ya_entregada", "ya_entregada_otra", "cerrado", "llave_invalida", "no_existe"] as const;
export type ResultadoDeEntregar = (typeof RESULTADOS_DE_ENTREGAR)[number];

export function esResultadoDeEntregar(valor: unknown): valor is ResultadoDeEntregar {
  return typeof valor === "string" && (RESULTADOS_DE_ENTREGAR as readonly string[]).includes(valor);
}

/**
 * Con estos resultados la página ya cuenta qué pasó (la llave recibida o el caso cerrado): la acción vuelve a ella en
 * vez de mostrar un error. `ya_entregada_otra` no vuelve: la página diría «Recibimos tu llave» y la persona creería que
 * corrigió la que tenemos.
 */
export const RESULTADOS_QUE_VUELVEN_A_LA_PAGINA = ["entregada", "ya_entregada", "cerrado"] as const satisfies readonly ResultadoDeEntregar[];

export function vuelveALaPagina(resultado: ResultadoDeEntregar): resultado is (typeof RESULTADOS_QUE_VUELVEN_A_LA_PAGINA)[number] {
  return (RESULTADOS_QUE_VUELVEN_A_LA_PAGINA as readonly string[]).includes(resultado);
}

/** Los resultados que se quedan en el formulario, con un mensaje. */
export type ResultadoQueSeExplica = Exclude<ResultadoDeEntregar, (typeof RESULTADOS_QUE_VUELVEN_A_LA_PAGINA)[number]>;

export const MENSAJE_ENLACE_QUE_NO_SIRVE = "Este enlace no sirve. Abre de nuevo el enlace del correo que te mandamos.";

/** Qué se le dice con los resultados que se quedan en el formulario y no dependen del correo de soporte. */
export const MENSAJES_DE_ENTREGAR: Record<Exclude<ResultadoQueSeExplica, "ya_entregada_otra">, string> = {
  llave_invalida: `Revisa tu llave: no puede quedar vacía y puede tener hasta ${LARGO_MAXIMO_LLAVE} caracteres.`,
  // No distingue un token inventado de uno que ya no existe.
  no_existe: MENSAJE_ENLACE_QUE_NO_SIRVE,
};

/**
 * Qué se le dice a quien manda una llave distinta de la que ya tenemos (supuesto 3): que no la cambiamos y, si hay
 * correo de soporte, a dónde escribir para corregirla. Nunca muestra la llave guardada. Sin correo no promete un canal
 * que no existe.
 */
export function textoDeLlaveYaEntregadaOtra(contactoSoporte: string | null = null): string {
  const soporte = contactoSoporte?.trim();
  const base = "Ya teníamos una llave para este reembolso y no la cambiamos.";
  return soporte ? `${base} Si quieres corregirla, escríbenos a ${soporte}.` : base;
}

/** El mensaje del formulario para un resultado que no vuelve a la página. */
export function mensajeDeEntregar(resultado: ResultadoQueSeExplica, contactoSoporte: string | null = null): string {
  return resultado === "ya_entregada_otra" ? textoDeLlaveYaEntregadaOtra(contactoSoporte) : MENSAJES_DE_ENTREGAR[resultado];
}

export const MENSAJE_FALLO_AL_ENTREGAR = "No pudimos guardar tu llave. Intenta de nuevo.";

// ---------------------------------------------------------------------------
// La página de la llave
// ---------------------------------------------------------------------------

/**
 * El estado que muestra la página (`public.datos_de_llave`): esperando la llave (el formulario), pendiente (ya la
 * recibimos), reembolsado o cerrado (pasó el plazo sin llave, aunque el cierre todavía no haya corrido).
 */
export const ESTADOS_DE_LA_LLAVE = ["esperando_llave", "pendiente", "reembolsado", "cerrado"] as const;
export type EstadoDeLaLlave = (typeof ESTADOS_DE_LA_LLAVE)[number];

/** Lo que la página sabe de un reembolso por su token. Nunca la llave ni el contacto. */
export type LlaveDeReembolso = {
  estado: EstadoDeLaLlave;
  monto: number;
  motivo: string;
  /** El fin del plazo para entregar la llave en el ciclo actual (P-10). Si el caso se cerró, cuándo terminó. */
  venceEn: Date;
};

/** Lee una fila de `public.datos_de_llave`. Lanza si trae un estado que no conoce o una fecha inválida. */
export function llaveDeFila(fila: { estado: string; monto: number; motivo: string; vence_en: string }): LlaveDeReembolso {
  const estado = ESTADOS_DE_LA_LLAVE.find((e) => e === fila.estado);
  if (!estado) throw new Error(`Estado de la llave desconocido: ${fila.estado}`);
  const venceEn = new Date(fila.vence_en);
  if (Number.isNaN(venceEn.getTime())) throw new Error(`vence_en no es un instante válido: ${fila.vence_en}`);
  return { estado, monto: fila.monto, motivo: fila.motivo, venceEn };
}

/** Lo que dice la página en cada estado: el título, el texto de debajo y, si hace falta, una nota aparte. */
export type VistaDeLaLlave = { titulo: string; texto: string; nota: string | null };

/**
 * Los textos de la página para cada estado. `contactoSoporte` es el correo de Calibra: con él se ofrece escribir para
 * corregir una llave mal escrita (no se cambia desde el enlace, supuesto 3) o para pedir que se reabra un caso cerrado
 * (supuesto 4); sin él, no se promete un canal que no existe.
 */
export function vistaDeLaLlave(llave: LlaveDeReembolso, contactoSoporte: string | null = null): VistaDeLaLlave {
  const monto = formatearPesos(llave.monto);
  const soporte = contactoSoporte?.trim() || null;
  switch (llave.estado) {
    case "esperando_llave":
      return {
        titulo: "Envíanos tu llave",
        texto: `Para devolverte ${monto} necesitamos tu llave: tu celular, tu correo o el alias que tengas registrado en tu banco.`,
        nota: soporte
          ? `Revísala antes de enviarla: desde este enlace no se puede cambiar después. Si te equivocas, escríbenos a ${soporte}.`
          : "Revísala antes de enviarla: desde este enlace no se puede cambiar después.",
      };
    case "pendiente":
      return {
        titulo: "Recibimos tu llave",
        texto: `Te vamos a transferir ${monto}. No tienes que hacer nada más.`,
        nota: soporte ? `Si te equivocaste al escribirla, escríbenos a ${soporte}.` : null,
      };
    case "reembolsado":
      return {
        titulo: "Ya te devolvimos el dinero",
        texto: `Transferimos ${monto} a la llave que nos diste.`,
        nota: null,
      };
    case "cerrado":
      return {
        titulo: "Este caso se cerró",
        texto: `El plazo para enviarnos tu llave terminó el ${formatearFechaHora(llave.venceEn)}, así que cerramos el caso.`,
        nota: soporte
          ? `Si todavía necesitas el reembolso, escríbenos a ${soporte}: un admin puede reabrirlo.`
          : "Si todavía necesitas el reembolso, un admin puede reabrirlo.",
      };
  }
}

/** El aviso que acompaña el formulario: Calibra solo pide la llave (el mismo pie de los correos). */
export const TEXTO_SOLO_LA_LLAVE = "Solo te pedimos la llave. Calibra nunca te pide claves del banco ni datos de tu tarjeta.";

// ---------------------------------------------------------------------------
// Los correos que piden la llave (`public.pedido_llave`)
// ---------------------------------------------------------------------------

/** Por qué se anotó el correo: el pedido al crearse el reembolso, el recordatorio, la reapertura o el reenvío. */
export const TIPOS_DE_PEDIDO = ["pedido", "recordatorio", "reapertura", "reenvio"] as const;
export type TipoDePedido = (typeof TIPOS_DE_PEDIDO)[number];

export const ESTADOS_DE_REEMBOLSO = ["esperando_llave", "pendiente", "reembolsado"] as const;
export type EstadoDeReembolso = (typeof ESTADOS_DE_REEMBOLSO)[number];

/**
 * Lo que devuelve `public.datos_de_pedido_llave`, con los instantes en ISO. `plazoDesde` es la foto del ciclo al anotar
 * el correo y `venceEn` su fin; `plazoLlaveDesde` es el ciclo actual del reembolso (cambia al reabrirlo). Nunca la llave.
 */
export type PedidoDeLlave = {
  tipo: TipoDePedido;
  plazoDesde: string;
  venceEn: string;
  plazoLlaveDesde: string;
  estado: EstadoDeReembolso;
  cerradoEn: string | null;
  /** El correo de cancelación (HU-024) ya pidió esta llave (D-27). */
  enCorreoDeCancelacion: boolean;
  /** `pago.contacto`, el destinatario. */
  contacto: string;
  nombrePagador: string;
  monto: number;
  motivo: string;
  /** El token de la página de la llave. Va solo dentro del enlace. */
  token: string;
  /** El de la monitoría del pago: `monitor_no_asistio` es un reporte de inasistencia aceptado (D-37). */
  motivoCancelacion: MotivoDeCancelacion | null;
};

export type PlantillaDePedido = "solicitud_llave_reembolso" | "recordatorio_llave_reembolso";

/** El recordatorio tiene su plantilla; el pedido, la reapertura y el reenvío piden la llave con la misma. */
export function plantillaDelPedido(tipo: TipoDePedido): PlantillaDePedido {
  return tipo === "recordatorio" ? "recordatorio_llave_reembolso" : "solicitud_llave_reembolso";
}

const mismoInstante = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();

/**
 * ¿Todavía se manda este correo? Solo si el reembolso sigue esperando la llave, no se cerró, el correo es del ciclo
 * actual (un pedido anotado antes de reabrir ya no vale: salió el de la reapertura) y el plazo de ese ciclo no venció
 * (con el instante exacto todavía vale, P-40). Un pedido cuya llave ya pidió el correo de cancelación no sale
 * (supuesto 2); el recordatorio, la reapertura y el reenvío sí. No mira el destinatario: eso lo revisa quien lo manda.
 */
export function pedidoVigente(p: PedidoDeLlave, ahora: Date): boolean {
  if (p.estado !== "esperando_llave" || p.cerradoEn !== null) return false;
  if (p.tipo === "pedido" && p.enCorreoDeCancelacion) return false;
  if (!mismoInstante(p.plazoDesde, p.plazoLlaveDesde)) return false;
  return ahora.getTime() <= new Date(p.venceEn).getTime();
}

const conSoporte = (contactoSoporte: string | null) => {
  const soporte = contactoSoporte?.trim();
  return soporte ? { contactoSoporte: soporte } : {};
};

/**
 * Los datos de la plantilla `solicitud_llave_reembolso`. No lee el reloj: todo sale del pedido anotado, así que un
 * reintento da el mismo cuerpo. `url` arma el enlace completo (`urlDelSitio`).
 */
export function datosDelPedido(
  p: PedidoDeLlave,
  url: (ruta: string) => string,
  contactoSoporte: string | null,
): DatosPorPlantilla["solicitud_llave_reembolso"] {
  return {
    nombre: p.nombrePagador,
    monto: p.monto,
    motivo: p.motivo,
    enlace: url(rutaDeLlave(p.token)),
    venceEn: p.venceEn,
    reporteAceptado: p.motivoCancelacion === "monitor_no_asistio",
    ...conSoporte(contactoSoporte),
  };
}

/** Los datos de la plantilla `recordatorio_llave_reembolso`, con las mismas reglas que `datosDelPedido`. */
export function datosDelRecordatorio(
  p: PedidoDeLlave,
  url: (ruta: string) => string,
  contactoSoporte: string | null,
): DatosPorPlantilla["recordatorio_llave_reembolso"] {
  return {
    nombre: p.nombrePagador,
    monto: p.monto,
    motivo: p.motivo,
    enlace: url(rutaDeLlave(p.token)),
    venceEn: p.venceEn,
    ...conSoporte(contactoSoporte),
  };
}

// ---------------------------------------------------------------------------
// Reabrir un caso cerrado desde la bandeja (supuesto 4)
// ---------------------------------------------------------------------------

/** Lo que responde `public.reabrir_reembolso`. */
export const RESULTADOS_DE_REABRIR = ["reabierto", "no_cerrado", "no_encontrado", "sin_permiso", "sin_sesion"] as const;
export type ResultadoDeReabrir = (typeof RESULTADOS_DE_REABRIR)[number];

export function esResultadoDeReabrir(valor: unknown): valor is ResultadoDeReabrir {
  return typeof valor === "string" && (RESULTADOS_DE_REABRIR as readonly string[]).includes(valor);
}

/** Lo que la acción de reabrir le deja a la bandeja en `?reembolso=`: un resultado de la base o una falla. */
export type DesenlaceDeReabrir = ResultadoDeReabrir | "fallo";

export type AvisoDeReabrir = { exito: boolean; texto: string };

const AVISOS_DE_REABRIR: Record<DesenlaceDeReabrir, AvisoDeReabrir> = {
  reabierto: {
    exito: true,
    texto: "Reabriste el caso: quien pagó tiene otra vez el plazo completo y le mandamos de nuevo el enlace para enviar su llave.",
  },
  no_cerrado: { exito: false, texto: "Ese caso ya no estaba cerrado: sigue esperando la llave o ya la recibimos." },
  no_encontrado: { exito: false, texto: "No encontramos ese reembolso." },
  sin_permiso: { exito: false, texto: "Solo un admin activo puede reabrir un caso." },
  sin_sesion: { exito: false, texto: "Solo un admin activo puede reabrir un caso." },
  fallo: { exito: false, texto: "No pudimos reabrir el caso. Intenta de nuevo; si sigue igual, avisa al equipo." },
};

/** El aviso de la bandeja tras reabrir (`?reembolso=`). Un valor que no conoce, o repetido, no muestra nada. */
export function avisoDeReabrir(consulta: Record<string, string | string[] | undefined>): AvisoDeReabrir | null {
  const valor = consulta.reembolso;
  if (typeof valor !== "string" || !Object.hasOwn(AVISOS_DE_REABRIR, valor)) return null;
  return AVISOS_DE_REABRIR[valor as DesenlaceDeReabrir];
}

// ---------------------------------------------------------------------------
// Reenviar el enlace desde la página del reembolso (HU-026, criterio 3)
// ---------------------------------------------------------------------------

/** Lo que responde `public.reenviar_pedido_llave`, en el orden de su migración. Un doble clic deja un solo reenvío. */
export const RESULTADOS_DE_REENVIAR = ["reenviado", "cerrado", "ya_entregada", "no_encontrado", "sin_permiso", "sin_sesion"] as const;
export type ResultadoDeReenviar = (typeof RESULTADOS_DE_REENVIAR)[number];

export function esResultadoDeReenviar(valor: unknown): valor is ResultadoDeReenviar {
  return typeof valor === "string" && (RESULTADOS_DE_REENVIAR as readonly string[]).includes(valor);
}

/** Lo que la acción de reenviar le deja a la página del reembolso en `?reenvio=`: un resultado de la base o una falla. */
export type DesenlaceDeReenviar = ResultadoDeReenviar | "fallo";

export type AvisoDeReenviar = { exito: boolean; texto: string };

const AVISOS_DE_REENVIAR: Record<DesenlaceDeReenviar, AvisoDeReenviar> = {
  reenviado: { exito: true, texto: "Le mandamos otra vez el enlace a quien pagó. Le llega en unos minutos y el plazo no cambia." },
  // Reabrir sigue en la bandeja (P-10, fuera de alcance de HU-026): la página solo remite allá.
  cerrado: {
    exito: false,
    texto:
      "No lo reenviamos: el plazo para enviar la llave ya terminó. Para darle el plazo completo otra vez, reabre el caso desde “Cerrados sin llave”, en tu bandeja.",
  },
  ya_entregada: { exito: false, texto: "No hace falta: quien pagó ya nos envió su llave." },
  no_encontrado: { exito: false, texto: "No encontramos este reembolso." },
  sin_permiso: { exito: false, texto: "Solo un admin activo puede reenviar el enlace." },
  sin_sesion: { exito: false, texto: "Solo un admin activo puede reenviar el enlace." },
  fallo: { exito: false, texto: "No pudimos reenviar el enlace. Intenta de nuevo; si sigue igual, avisa al equipo." },
};

/** El aviso de la página del reembolso tras reenviar (`?reenvio=`). Un valor que no conoce, o repetido, no muestra nada. */
export function avisoDeReenviar(consulta: Record<string, string | string[] | undefined>): AvisoDeReenviar | null {
  const valor = consulta.reenvio;
  if (typeof valor !== "string" || !Object.hasOwn(AVISOS_DE_REENVIAR, valor)) return null;
  return AVISOS_DE_REENVIAR[valor as DesenlaceDeReenviar];
}

/**
 * Lo que la página del reembolso no puede decir: si no existe responde 404, y a quien ya no es un admin activo no lo deja
 * entrar. Con estos desenlaces la acción vuelve a la bandeja (`/admin?reenvio=`), como reabrir.
 */
export const REENVIOS_PARA_LA_BANDEJA = ["no_encontrado", "sin_permiso", "sin_sesion"] as const satisfies readonly ResultadoDeReenviar[];

/** El aviso de la bandeja tras reenviar (`?reenvio=`): solo los de `REENVIOS_PARA_LA_BANDEJA`; los demás van en la página. */
export function avisoDeReenviarEnLaBandeja(consulta: Record<string, string | string[] | undefined>): AvisoDeReenviar | null {
  const valor = consulta.reenvio;
  if (typeof valor !== "string" || !(REENVIOS_PARA_LA_BANDEJA as readonly string[]).includes(valor)) return null;
  return AVISOS_DE_REENVIAR[valor as DesenlaceDeReenviar];
}
