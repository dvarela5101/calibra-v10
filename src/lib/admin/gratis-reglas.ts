import { esUuid } from "@/lib/agendar/reglas";
import { dentroDePlazo, plazoAlcanzado } from "@/lib/plazos/motor";
import type { EstadoDeMonitoria } from "./citas-reglas";

/**
 * Monitoría de prueba gratis (HU-116, D-84): un admin marca una individual por pagar como gratis desde su ficha y queda
 * confirmada sin pago; mientras no empiece, le puede quitar la marca y vuelve a por pagar con su precio normal. Aquí va lo
 * puro: qué responde la base, qué se le dice al admin, qué ofrece la ficha, la lectura del formulario y los avisos. Si se
 * puede marcar, qué cambia y qué se guarda lo decide `public.marcar_monitoria_gratis` bajo candado; lo de aquí solo lo
 * anticipa en la pantalla. «Prueba» es una palabra del admin: el estudiante solo ve «Gratis» (D-84 c). Sin cifras de comisión.
 */

/** Lo que responde `public.marcar_monitoria_gratis`, en el orden en que la base los mira. Solo los dos primeros escriben. */
export const RESULTADOS_DE_MARCA = [
  "marcada",
  "desmarcada",
  "sin_sesion",
  "sin_permiso",
  "pedido_invalido",
  "no_existe",
  "no_individual",
  "ya_marcada",
  "no_por_pagar",
  "reserva_vencida",
  "con_pagos",
  "no_marcada",
  "no_confirmada",
  "ya_empezo",
] as const;
export type ResultadoDeMarca = (typeof RESULTADOS_DE_MARCA)[number];

export function esResultadoDeMarca(valor: unknown): valor is ResultadoDeMarca {
  return typeof valor === "string" && (RESULTADOS_DE_MARCA as readonly string[]).includes(valor);
}

/** Qué se le dice al admin cuando no se marcó ni se desmarcó nada. */
export const MENSAJES_DE_MARCA: Record<Exclude<ResultadoDeMarca, "marcada" | "desmarcada">, string> = {
  ya_marcada: "Esta monitoría ya estaba marcada como de prueba. No se cambió nada.",
  no_por_pagar: "Solo se marca una monitoría que está por pagar. Esta ya está confirmada, realizada o cancelada.",
  reserva_vencida: "La reserva ya venció sin comprobante, así que la fecha se libera. Quien agendó puede volver a apartarla.",
  con_pagos: "Esta monitoría ya tiene un pago, así que no se puede marcar como de prueba.",
  no_marcada: "Esta monitoría no está marcada como de prueba. No se cambió nada.",
  no_confirmada: "La monitoría ya no está confirmada (se realizó o se canceló), así que no se le puede quitar la marca.",
  ya_empezo: "La sesión ya empezó, así que la marca de prueba ya no se cambia.",
  no_individual: "Las monitorías grupales no se marcan como de prueba.",
  no_existe: "No encontramos esta monitoría.",
  pedido_invalido: "No entendimos el pedido. Recarga la página e intenta de nuevo.",
  sin_permiso: "Solo un admin activo marca monitorías de prueba.",
  sin_sesion: "Tu sesión terminó. Vuelve a entrar e intenta de nuevo.",
};

export const MENSAJE_DE_FALLO_DE_MARCA = "No pudimos cambiar la marca de prueba. Intenta de nuevo; si sigue igual, avisa al equipo.";

/** Lo que cambió mientras el admin miraba: la acción vuelve a la página con `?gratis_error=` y la página se pinta como quedó. */
export const CAMBIOS_DE_LA_MARCA = [
  "ya_marcada",
  "no_por_pagar",
  "reserva_vencida",
  "con_pagos",
  "no_marcada",
  "no_confirmada",
  "ya_empezo",
  "no_individual",
] as const satisfies readonly ResultadoDeMarca[];

/** La última marca o desmarca registrada de una monitoría: quién y cuándo. La leen solo los admins. */
export type MarcaRegistrada = { gratis: boolean; hechaEn: Date; idAdmin: string; nombreAdmin: string };

export type AccionDeGratis = "marcar" | "desmarcar";

/**
 * Qué ofrece la ficha, con las mismas reglas que `privado.marcar_monitoria_gratis`: marcar una individual por pagar, con la
 * reserva vigente y sin pagos; desmarcar una gratis que sigue confirmada. Ninguna de las dos desde el instante exacto del
 * inicio (RN-64). Los bordes los deciden `dentroDePlazo` y `plazoAlcanzado` del motor (P-40). Solo pinta: la base vuelve a
 * decidir al enviar.
 */
export function accionDeGratis(
  cita: { estado: EstadoDeMonitoria; grupal: boolean; gratis: boolean; inicio: Date; reservaHasta: Date; pagos: readonly unknown[] },
  ahora: Date,
): AccionDeGratis | null {
  if (cita.grupal || plazoAlcanzado(cita.inicio, ahora)) return null;
  if (cita.gratis) return cita.estado === "confirmada" ? "desmarcar" : null;
  if (cita.estado === "pendiente_pago" && cita.pagos.length === 0 && dentroDePlazo(cita.reservaHasta, ahora)) return "marcar";
  return null;
}

/** Lo que se lee antes de confirmar: qué pasa con la monitoría, quien agendó, el monitor y los correos. */
export const CONSECUENCIAS_DE_GRATIS: Record<AccionDeGratis, string> = {
  marcar:
    "La monitoría queda confirmada sin pago ni comprobante, con su precio normal. Quien agendó la ve con el precio tachado y «Gratis», y recibe el correo de confirmación. El monitor recibe el aviso de siempre y no cobra esta sesión.",
  desmarcar:
    "La monitoría vuelve a quedar por pagar, con su precio normal. Quien agendó tiene 10 minutos desde ahora para adjuntar el comprobante en su reserva; si no, la reserva vence y la fecha queda libre. No se manda ningún correo.",
};

/** El botón que abre la confirmación y el que envía, por acción. */
export const TEXTOS_DEL_BOTON: Record<AccionDeGratis, { abrir: string; enviar: string; enviando: string }> = {
  marcar: { abrir: "Marcar como monitoría de prueba", enviar: "Sí, marcarla gratis", enviando: "Marcando…" },
  desmarcar: { abrir: "Quitar la marca de prueba", enviar: "Sí, quitar la marca", enviando: "Quitando…" },
};

export type PedidoDeMarca = { idMonitoria: string; gratis: boolean };

export type LecturaDeMarca = { ok: true; datos: PedidoDeMarca } | { ok: false; error: string };

/** El formulario: el id de la monitoría y `gratis` en `1` (marcar) o `0` (desmarcar). Cualquier otro valor no se envía. */
export function leerMarca(datos: FormData): LecturaDeMarca {
  const texto = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor.trim() : "";
  };
  const idMonitoria = texto("id_monitoria").toLowerCase();
  if (!esUuid(idMonitoria)) return { ok: false, error: MENSAJES_DE_MARCA.no_existe };
  const gratis = texto("gratis");
  if (gratis !== "1" && gratis !== "0") return { ok: false, error: MENSAJES_DE_MARCA.pedido_invalido };
  return { ok: true, datos: { idMonitoria, gratis: gratis === "1" } };
}

export type AvisoDeMarca = { exito: boolean; texto: string };

/**
 * Lo que se dice arriba de la ficha después de marcar o desmarcar: la acción vuelve con `?gratis=marcada|desmarcada` o
 * `?gratis_error=`. El éxito solo se dice si la última marca registrada es de verdad del admin de la sesión y dice lo mismo:
 * un enlace viejo o escrito a mano no anuncia un cambio que no hizo.
 */
export function avisosDeMarca(
  consulta: Record<string, string | string[] | undefined>,
  cita: { gratis: boolean; ultimaMarca: MarcaRegistrada | null },
  idSesion: string,
): AvisoDeMarca[] {
  const valor = (clave: string) => (typeof consulta[clave] === "string" ? (consulta[clave] as string) : null);
  const avisos: AvisoDeMarca[] = [];
  const hecho = valor("gratis");
  const propia = cita.ultimaMarca !== null && cita.ultimaMarca.idAdmin === idSesion && cita.ultimaMarca.gratis === cita.gratis;
  if (hecho === "marcada" && cita.gratis && propia) {
    avisos.push({ exito: true, texto: "Marcaste la monitoría como de prueba. Quedó confirmada sin pago y quien agendó recibe el correo de confirmación." });
  } else if (hecho === "desmarcada" && !cita.gratis && propia) {
    avisos.push({ exito: true, texto: "Quitaste la marca de prueba. La monitoría quedó por pagar con su precio normal." });
  }
  const error = valor("gratis_error");
  if ((CAMBIOS_DE_LA_MARCA as readonly string[]).includes(error ?? "")) {
    avisos.push({ exito: false, texto: MENSAJES_DE_MARCA[error as (typeof CAMBIOS_DE_LA_MARCA)[number]] });
  }
  return avisos;
}
