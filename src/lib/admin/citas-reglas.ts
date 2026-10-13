import { esUuid } from "@/lib/agendar/reglas";
import { ESTADOS_DE_PAGO_DE_CITA, type EstadoDePagoDeCita } from "@/lib/citas/reglas";
import { formatearDia } from "@/lib/fechas";
import { horaCorta } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import { dentroDePlazo, plazoAlcanzado } from "@/lib/plazos/motor";
import type { Database } from "@/lib/supabase/tipos";

/**
 * Autorizar una cancelación fuera de plazo (HU-052, D-60): una individual confirmada a la que ya se le pasó el plazo de
 * 12 h (RN-60) y todavía no empieza la puede cancelar un admin activo, en un caso extremo, con un motivo de una lista
 * cerrada y una nota. Aquí va lo puro: las categorías, qué responde la base, qué se le dice al admin con cada resultado,
 * la lectura del formulario, qué muestra la página de una cita, lo que se lee antes de confirmar y los avisos de la
 * página. Si la cita se puede cancelar, qué cambia y qué se guarda lo decide `public.autorizar_cancelacion_fuera_de_plazo`
 * bajo candado; lo de aquí solo lo anticipa en la pantalla. Ningún texto lleva cifras de comisión (CLAUDE.md): lo que se
 * devuelve es lo que quien pagó pagó (RN-60).
 */

export type EstadoDePago = Database["public"]["Enums"]["estado_pago"];
export type EstadoDeMonitoria = Database["public"]["Enums"]["estado_monitoria"];
export type MotivoDeCancelacion = Database["public"]["Enums"]["motivo_cancelacion"];
export type EstadoDeReembolso = Database["public"]["Enums"]["estado_reembolso"];

/** Los motivos de D-60 (a): el mismo `check` de `cancelacion_excepcional.categoria`. */
export const CATEGORIAS = ["fuerza_mayor", "falla_de_calibra", "otro"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export function esCategoria(valor: unknown): valor is Categoria {
  return typeof valor === "string" && (CATEGORIAS as readonly string[]).includes(valor);
}

/** Cada motivo en palabras, para la opción del formulario (D-60 a, tal como los fija la HU). */
export const TEXTOS_DE_CATEGORIA: Record<Categoria, string> = {
  fuerza_mayor: "Fuerza mayor de quien agendó (urgencia de salud, accidente o calamidad familiar)",
  falla_de_calibra: "Una falla de Calibra impidió cancelar a tiempo",
  otro: "Otro (la nota es obligatoria)",
};

/** La versión corta de cada motivo, para el registro de una cancelación ya autorizada. */
export const TEXTOS_DEL_REGISTRO: Record<Categoria, string> = {
  fuerza_mayor: "Fuerza mayor de quien agendó",
  falla_de_calibra: "Una falla de Calibra impidió cancelar a tiempo",
  otro: "Otro",
};

/**
 * Lo que responde `public.autorizar_cancelacion_fuera_de_plazo`, en el orden en que la base los mira: quién puede, antes
 * que el texto. Ninguno escribe nada salvo `autorizada`.
 */
export const RESULTADOS_DE_AUTORIZACION = [
  "autorizada",
  "sin_sesion",
  "sin_permiso",
  "categoria_invalida",
  "nota_invalida",
  "no_existe",
  "no_individual",
  "ya_cancelada",
  "no_cancelable",
  "dentro_de_plazo",
  "ya_empezo",
] as const;
export type ResultadoDeAutorizacion = (typeof RESULTADOS_DE_AUTORIZACION)[number];

export function esResultadoDeAutorizacion(valor: unknown): valor is ResultadoDeAutorizacion {
  return typeof valor === "string" && (RESULTADOS_DE_AUTORIZACION as readonly string[]).includes(valor);
}

/**
 * Largo máximo de la nota, en caracteres: el mismo `check` de `cancelacion_excepcional.nota`
 * (`cancelacion_excepcional_nota_con_texto`).
 */
export const LARGO_MAXIMO_NOTA = 500;

/** Qué se le dice al admin cuando la cancelación no se autorizó. */
export const MENSAJES_DE_AUTORIZACION: Record<Exclude<ResultadoDeAutorizacion, "autorizada">, string> = {
  dentro_de_plazo: "Todavía hay plazo para cancelar: quien agendó la puede cancelar desde su cita, con reembolso. No hace falta autorizar nada.",
  ya_empezo:
    "La sesión ya empezó, así que no se puede cancelar con esta autorización. Si el monitor no llegó, quien agendó puede reportar la inasistencia desde su cita.",
  no_cancelable: "Esta monitoría no está confirmada (está por pagar, realizada o cancelada por otro motivo), así que no se puede cancelar aquí.",
  ya_cancelada: "Esta monitoría ya estaba cancelada (la canceló quien agendó o la autorizó otro admin). No se cambió nada.",
  no_individual: "Las monitorías grupales no se cancelan fuera de plazo desde aquí.",
  no_existe: "No encontramos esta monitoría.",
  categoria_invalida: "Escoge el motivo de la lista.",
  nota_invalida: `La nota puede tener hasta ${LARGO_MAXIMO_NOTA} caracteres y, con “Otro”, es obligatoria.`,
  sin_permiso: "Solo un admin activo autoriza cancelaciones.",
  sin_sesion: "Tu sesión terminó. Vuelve a entrar e intenta de nuevo.",
};

/**
 * Los dos errores de la nota que la página dice por separado. La base responde un solo `nota_invalida`, que junta las dos
 * reglas en un mensaje.
 */
export const MENSAJES_DEL_FORMULARIO = {
  nota_larga: `La nota puede tener hasta ${LARGO_MAXIMO_NOTA} caracteres.`,
  nota_obligatoria: "Con “Otro” la nota es obligatoria: cuenta qué pasó.",
} as const;

export const MENSAJE_DE_FALLO = "No pudimos autorizar la cancelación. Intenta de nuevo; si sigue igual, avisa al equipo.";

/** La etiqueta y la ayuda de la nota: la frase de la ayuda es la de la HU, intacta. */
export const ETIQUETA_DE_LA_NOTA = `Nota (hasta ${LARGO_MAXIMO_NOTA} caracteres)`;
export const AYUDA_DE_LA_NOTA = "Escribe solo lo necesario para recordar el caso. No incluyas diagnósticos ni datos de salud.";

/** Lo que se lee encima del formulario: la app no verifica quién escribió al correo de Calibra. */
export const ADVERTENCIA_DE_QUIEN_ESCRIBIO = "Antes de autorizar, comprueba que quien te escribió usó el mismo correo o teléfono que ves aquí.";

export type PedidoDeAutorizacion = { idMonitoria: string; categoria: Categoria; nota: string | null };

export type LecturaDeAutorizacion = { ok: true; datos: PedidoDeAutorizacion } | { ok: false; error: string };

/**
 * El formulario de la autorización. La nota se recorta y, vacía, cuenta como ninguna; se cuenta por caracteres, como
 * `char_length` en la base, no por unidades de JavaScript.
 *
 * El navegador envía cada salto de línea de un `<textarea>` como CRLF (dos caracteres), aunque el `maxlength` del campo
 * cuenta cada uno como uno. Se vuelven a un solo `\n` antes de recortar y de contar: así lo que el campo deja escribir
 * (500) es lo que la acción y el `check` de la base aceptan, y lo que se guarda no lleva `\r`.
 */
export function leerAutorizacion(datos: FormData): LecturaDeAutorizacion {
  const texto = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor.replace(/\r\n?/g, "\n").trim() : "";
  };
  const idMonitoria = texto("id_monitoria").toLowerCase();
  if (!esUuid(idMonitoria)) return { ok: false, error: MENSAJES_DE_AUTORIZACION.no_existe };
  const categoria = texto("categoria");
  if (!esCategoria(categoria)) return { ok: false, error: MENSAJES_DE_AUTORIZACION.categoria_invalida };
  const nota = texto("nota") || null;
  if (nota !== null && [...nota].length > LARGO_MAXIMO_NOTA) return { ok: false, error: MENSAJES_DEL_FORMULARIO.nota_larga };
  if (categoria === "otro" && nota === null) return { ok: false, error: MENSAJES_DEL_FORMULARIO.nota_obligatoria };
  return { ok: true, datos: { idMonitoria, categoria, nota } };
}

/** Los contactos que haya, en una línea: el correo y el teléfono. */
export const contactoDe = ({ correo, telefono }: { correo: string | null; telefono: string | null }) =>
  [correo, telefono].filter((dato): dato is string => Boolean(dato)).join(" · ") || "Sin datos de contacto";

/** Lo que dicen las reglas de una cita sobre su pago: el nombre de quien pagó, el monto y el estado. Nada más. */
export type PagoDeLaCita = { nombrePagador: string; monto: number; estado: EstadoDePago };

/** La autorización ya registrada de una cancelación: quién, cuándo, el motivo y la nota. La leen solo los admins. */
export type AutorizacionRegistrada = {
  categoria: Categoria;
  nota: string | null;
  autorizadaEn: Date;
  idAdmin: string;
  nombreAdmin: string;
};

/**
 * El pago de una cita con la misma prioridad que la agenda del monitor (D-11): rechazado si algún comprobante lo fue, si
 * no en revisión, si no aprobado; sin comprobantes, sin pagar.
 */
export function estadoDePagoDeLaCita(pagos: { estado: EstadoDePago }[]): EstadoDePagoDeCita {
  return ESTADOS_DE_PAGO_DE_CITA.find((estado) => pagos.some((pago) => pago.estado === estado)) ?? "sin_pagar";
}

/** Lo que se devolvería: la suma de lo que pagaron los pagos aprobados (RN-60), y cuántos son. */
export function aDevolver(pagos: { monto: number; estado: EstadoDePago }[]): { cuantos: number; suma: number } {
  const aprobados = pagos.filter((pago) => pago.estado === "aprobado");
  return { cuantos: aprobados.length, suma: aprobados.reduce((total, pago) => total + pago.monto, 0) };
}

/**
 * El aviso de P-07: un pago en revisión que se apruebe después de cancelar recibe su reembolso, y uno que se rechace no.
 * Se lee en el detalle y también antes de confirmar. Nada si ninguno está en revisión.
 */
export function textoDePagosEnRevision(cuantos: number): string | null {
  if (cuantos <= 0) return null;
  if (cuantos === 1) return "Un pago sigue en revisión: si se aprueba, recibe su reembolso; si se rechaza, no hay reembolso.";
  return `${cuantos} pagos siguen en revisión: cada uno recibe su reembolso si se aprueba; si se rechaza, no hay reembolso.`;
}

/** Los resultados con los que la cita no se puede autorizar y la página no muestra el formulario. */
export type MotivoParaNoAutorizar = Extract<
  ResultadoDeAutorizacion,
  "no_individual" | "ya_cancelada" | "no_cancelable" | "dentro_de_plazo" | "ya_empezo"
>;

/** Qué muestra la página de una cita: la autorización ya hecha, el formulario, o por qué no se puede autorizar. */
export type VistaDeLaCita = "autorizada" | "autorizar" | { motivo: MotivoParaNoAutorizar };

/**
 * Qué muestra la página según el estado de la cita, en el orden en que el núcleo de la base lo decide
 * (`privado.cancelar_cita_con_permiso` con admin). Solo pinta: la base vuelve a decidir al enviar. Los dos bordes los
 * deciden `dentroDePlazo` y `plazoAlcanzado` del motor, no un `<` ni un `>` escrito aquí (P-40): con exactamente 12 h
 * todavía hay plazo y la cita se cancela sola; en el instante exacto del inicio ya no se autoriza (RN-64).
 */
export function vistaDeLaCita(
  cita: {
    estado: EstadoDeMonitoria;
    motivoCancelacion: MotivoDeCancelacion | null;
    grupal: boolean;
    inicio: Date;
    cancelableHasta: Date;
    autorizacion: AutorizacionRegistrada | null;
  },
  ahora: Date,
): VistaDeLaCita {
  if (cita.autorizacion) return "autorizada";
  if (cita.grupal) return { motivo: "no_individual" };
  if (cita.estado === "cancelada" && cita.motivoCancelacion === "estudiante") return { motivo: "ya_cancelada" };
  if (cita.estado !== "confirmada") return { motivo: "no_cancelable" };
  if (dentroDePlazo(cita.cancelableHasta, ahora)) return { motivo: "dentro_de_plazo" };
  if (plazoAlcanzado(cita.inicio, ahora)) return { motivo: "ya_empezo" };
  return "autorizar";
}

/** Lo que cambió mientras el admin miraba: la acción vuelve a la página con `?error=` y la página se pinta como quedó. */
export const CAMBIOS_DE_LA_CITA = [
  "ya_cancelada",
  "no_cancelable",
  "dentro_de_plazo",
  "ya_empezo",
  "no_individual",
] as const satisfies readonly ResultadoDeAutorizacion[];

/**
 * Lo que se lee antes de «Sí, cancelar la monitoría»: qué pasa con la monitoría, el dinero, los pagos en revisión y los
 * correos, armado desde el estado real. Solo lo que aplica, en este orden. No se dice el motivo ni la nota en ningún
 * correo, y el monitor no cobra esta sesión (D-60 c).
 */
export function consecuenciasDeAutorizar(cita: { nombreMateria: string; fecha: string; hora: string; pagos: PagoDeLaCita[] }): string {
  const frases: string[] = [];
  frases.push(`La monitoría de ${cita.nombreMateria} del ${formatearDia(cita.fecha)} a las ${horaCorta(cita.hora)} se cancela. Esto no se puede deshacer.`);

  const { cuantos, suma } = aDevolver(cita.pagos);
  if (cuantos === 1) {
    frases.push(`Se devuelven ${formatearPesos(suma)} a quien pagó y se le pide la llave por correo.`);
  } else if (cuantos > 1) {
    frases.push(`Se crean ${cuantos} reembolsos por ${formatearPesos(suma)} en total y se le pide la llave a cada pagador, por correo.`);
  } else {
    frases.push("No hay pagos aprobados que devolver.");
  }

  const enRevision = textoDePagosEnRevision(cita.pagos.filter((pago) => pago.estado === "en_revision").length);
  if (enRevision) frases.push(enRevision);

  frases.push("Quien agendó y el monitor reciben un correo. Ninguno dice el motivo ni la nota.");
  frases.push("El monitor no cobra esta sesión.");
  return frases.join(" ");
}

export type AvisoDeLaPagina = { exito: boolean; texto: string };

/**
 * Lo que se dice arriba de la página después de una acción: la acción vuelve con `?autorizada=1` o `?error=`. El éxito
 * solo se dice si la cancelación de verdad la autorizó el admin de la sesión: un enlace viejo, escrito a mano o la
 * autorización de otro admin no anuncia una que no hizo. Los conteos salen de los pagos y reembolsos que la sesión del
 * admin lee. El correo se dice en futuro (reciben): `cancelacion_cita` y `aviso_monitor` no se leen con esa sesión y los
 * manda un proceso aparte, así que la página no puede comprobar que ya salió.
 */
export function avisosDeLaPagina(
  consulta: Record<string, string | string[] | undefined>,
  cita: { autorizacion: { idAdmin: string } | null; pagos: { estado: EstadoDePago; tieneReembolso: boolean }[] },
  idSesion: string,
): AvisoDeLaPagina[] {
  const valor = (clave: string) => (typeof consulta[clave] === "string" ? (consulta[clave] as string) : null);
  const avisos: AvisoDeLaPagina[] = [];

  if (valor("autorizada") === "1" && cita.autorizacion && cita.autorizacion.idAdmin === idSesion) {
    let texto = "Autorizaste la cancelación. La monitoría quedó cancelada.";
    const reembolsos = cita.pagos.filter((pago) => pago.tieneReembolso).length;
    if (reembolsos === 1) texto += " Creamos 1 reembolso y le pedimos la llave a quien pagó.";
    else if (reembolsos > 1) texto += ` Creamos ${reembolsos} reembolsos y le pedimos la llave a cada pagador.`;
    const enRevision = cita.pagos.filter((pago) => pago.estado === "en_revision").length;
    if (enRevision === 1) texto += " El pago en revisión recibirá su reembolso cuando se apruebe.";
    else if (enRevision > 1) texto += ` Los ${enRevision} pagos en revisión recibirán el suyo cuando se aprueben.`;
    texto += " Quien agendó y el monitor reciben un correo.";
    avisos.push({ exito: true, texto });
  }

  const error = valor("error");
  if ((CAMBIOS_DE_LA_CITA as readonly string[]).includes(error ?? "")) {
    avisos.push({ exito: false, texto: MENSAJES_DE_AUTORIZACION[error as (typeof CAMBIOS_DE_LA_CITA)[number]] });
  }
  return avisos;
}
