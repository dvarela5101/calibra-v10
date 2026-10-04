import { esFechaDeCalendario, esUuid } from "@/lib/agendar/reglas";
import type { Database } from "@/lib/supabase/tipos";

/**
 * Ejecutar un desembolso (HU-028): el admin le transfiere al monitor el neto de una monitoría realizada y registra la
 * referencia y la fecha de la transferencia. Aquí va lo puro: qué responde la base, qué se le dice al admin con cada
 * resultado y con cada motivo que impide ejecutarlo, la lectura del formulario y los avisos de la página. Si se puede
 * ejecutar lo decide `public.ejecutar_desembolso` con su propia hora y bajo candado; lo de aquí solo lo anticipa en la
 * pantalla. Ningún texto lleva el bruto ni la comisión (CLAUDE.md, P-32): al admin solo se le da el neto.
 */

export type EstadoDeDesembolso = Database["public"]["Enums"]["estado_desembolso"];

/**
 * Por qué no se puede ejecutar ahora, según `public.estado_para_ejecutar` (ver su migración), en el orden en que la
 * base los mira. Un motivo nulo quiere decir que sí se puede.
 */
export const MOTIVOS_PARA_NO_EJECUTAR = [
  "no_encontrado",
  "desembolsado",
  "anulado",
  "no_realizada",
  "antes_de_plazo",
  "con_reporte",
  "pagos_en_revision",
  "caso_abierto",
  "sin_pagos_aprobados",
] as const;
export type MotivoParaNoEjecutar = (typeof MOTIVOS_PARA_NO_EJECUTAR)[number];

export function esMotivoParaNoEjecutar(valor: unknown): valor is MotivoParaNoEjecutar {
  return typeof valor === "string" && (MOTIVOS_PARA_NO_EJECUTAR as readonly string[]).includes(valor);
}

/** Lo que responde `public.ejecutar_desembolso` (ver su migración). */
export const RESULTADOS_DE_EJECUCION = [
  "desembolsado",
  "monto_cambio",
  "ya_desembolsado",
  "anulado",
  "no_realizada",
  "antes_de_plazo",
  "con_reporte",
  "pagos_en_revision",
  "caso_abierto",
  "sin_pagos_aprobados",
  "fecha_invalida",
  "referencia_invalida",
  "no_encontrado",
  "sin_permiso",
  "sin_sesion",
] as const;
export type ResultadoDeEjecucion = (typeof RESULTADOS_DE_EJECUCION)[number];

export function esResultadoDeEjecucion(valor: unknown): valor is ResultadoDeEjecucion {
  return typeof valor === "string" && (RESULTADOS_DE_EJECUCION as readonly string[]).includes(valor);
}

/**
 * Qué se le dice al admin cuando no se puede ejecutar (criterios 2 y 3). La página lo muestra en lugar del formulario,
 * y la acción lo repite si la base lo responde al ejecutar.
 */
export const MENSAJES_DE_MOTIVO: Record<MotivoParaNoEjecutar, string> = {
  no_encontrado: "No encontramos este desembolso.",
  desembolsado: "Este desembolso ya está registrado como transferido. No lo transfieras otra vez.",
  anulado: "Este desembolso está anulado: la monitoría se canceló después de realizada, así que no se le transfiere al monitor.",
  no_realizada: "La monitoría ya no está realizada, así que este desembolso no se puede ejecutar.",
  antes_de_plazo: "Todavía no se puede transferir: la ventana para reportar inasistencia no ha terminado.",
  con_reporte: "La monitoría tiene un reporte de inasistencia en revisión o aceptado, así que no se transfiere mientras no se resuelva.",
  pagos_en_revision:
    "Espera la revisión de un pago de esta monitoría: hasta que se apruebe o se rechace no se transfiere, para que el desembolso cuente lo que de verdad llegó.",
  // HU-078 (D-39 (c)): un pago rechazado en P-24 cuyo caso nadie ha cerrado. Cuando se cierre, su monto cuenta.
  caso_abierto: "Espera a que se cierre el caso del pago rechazado en «Pagos por cobrar o asumir».",
  sin_pagos_aprobados: "La monitoría no tiene pagos aprobados, así que no hay nada que transferir. El desembolso sigue pendiente.",
};

/** Qué se le dice al admin cuando la transferencia no se registró. */
export const MENSAJES_DE_EJECUCION: Record<Exclude<ResultadoDeEjecucion, "desembolsado">, string> = {
  monto_cambio: "El monto a transferir cambió desde que abriste esta página. Míralo de nuevo antes de registrar la transferencia.",
  ya_desembolsado: "Este desembolso ya estaba registrado, así que no se registró de nuevo. No lo transfieras otra vez.",
  anulado: MENSAJES_DE_MOTIVO.anulado,
  no_realizada: MENSAJES_DE_MOTIVO.no_realizada,
  antes_de_plazo: MENSAJES_DE_MOTIVO.antes_de_plazo,
  con_reporte: MENSAJES_DE_MOTIVO.con_reporte,
  pagos_en_revision: MENSAJES_DE_MOTIVO.pagos_en_revision,
  caso_abierto: MENSAJES_DE_MOTIVO.caso_abierto,
  sin_pagos_aprobados: MENSAJES_DE_MOTIVO.sin_pagos_aprobados,
  fecha_invalida: "La fecha de la transferencia no puede ser posterior a hoy ni anterior al día de la sesión.",
  referencia_invalida: "Escribe la referencia de la transferencia, de hasta 100 caracteres.",
  no_encontrado: MENSAJES_DE_MOTIVO.no_encontrado,
  sin_permiso: "Solo un admin activo registra desembolsos.",
  sin_sesion: "Tu sesión terminó. Vuelve a entrar e intenta de nuevo.",
};

export const MENSAJE_DE_FALLO = "No pudimos registrar la transferencia. Intenta de nuevo; si sigue igual, avisa al equipo.";

/** Largo máximo de la referencia: el mismo `check` de `desembolso.referencia_transferencia`. */
export const LARGO_MAXIMO_REFERENCIA = 100;

/** Los errores de la fecha en el formulario: la base los resume en `fecha_invalida`. */
export const ERRORES_DE_FECHA = {
  falta: "Escribe la fecha de la transferencia.",
  futura: "La fecha de la transferencia no puede ser posterior a hoy.",
  antesDeLaSesion: "La fecha de la transferencia no puede ser anterior al día de la sesión.",
} as const;

export const MENSAJE_SIN_MONTO = "Recarga la página para ver el monto a transferir y vuelve a intentarlo.";

export type PedidoDeEjecucion = {
  idDesembolso: string;
  /** Recortada y de 1 a 100 caracteres. */
  referencia: string;
  /** Día de la transferencia, `AAAA-MM-DD`. */
  fecha: string;
  /** El neto que vio el admin: si al ejecutar es otro, la base responde `monto_cambio`. */
  netoEsperado: number;
};

export type LecturaDeEjecucion = { ok: true; datos: PedidoDeEjecucion } | { ok: false; error: string };

/**
 * El formulario de la ejecución (supuesto 3). `hoy` es el día del negocio (Bogotá), `AAAA-MM-DD`. La referencia se
 * recorta y se cuenta por caracteres, como `char_length` en la base, no por unidades de JavaScript. La fecha es un día
 * que existe, no posterior a hoy ni anterior a la sesión; el día de la sesión llega en un campo oculto solo para
 * anticiparlo, porque la base lo vuelve a mirar con la fecha guardada. El neto esperado es el que mostró la página.
 */
export function leerEjecucion(datos: FormData, hoy: string): LecturaDeEjecucion {
  const texto = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor.trim() : "";
  };
  const idDesembolso = texto("id_desembolso").toLowerCase();
  if (!esUuid(idDesembolso)) return { ok: false, error: MENSAJES_DE_EJECUCION.no_encontrado };

  const referencia = texto("referencia");
  if (!referencia || [...referencia].length > LARGO_MAXIMO_REFERENCIA) return { ok: false, error: MENSAJES_DE_EJECUCION.referencia_invalida };

  const fecha = texto("fecha");
  if (!esFechaDeCalendario(fecha)) return { ok: false, error: ERRORES_DE_FECHA.falta };
  if (fecha > hoy) return { ok: false, error: ERRORES_DE_FECHA.futura };
  const fechaSesion = texto("fecha_sesion");
  if (esFechaDeCalendario(fechaSesion) && fecha < fechaSesion) return { ok: false, error: ERRORES_DE_FECHA.antesDeLaSesion };

  const neto = texto("neto_esperado");
  if (!/^\d{1,9}$/.test(neto)) return { ok: false, error: MENSAJE_SIN_MONTO };

  return { ok: true, datos: { idDesembolso, referencia, fecha, netoEsperado: Number(neto) } };
}

/** Lo que se lee antes de "Sí, registrar la transferencia": qué queda registrado y que no se deshace. */
export function consecuenciasDeEjecutar(neto: string, llave: string): string {
  return `Registra la transferencia de ${neto} a ${llave}. No se puede deshacer.`;
}

export type AvisoDeLaPagina = { exito: boolean; texto: string };

/**
 * Lo que cambió mientras el admin miraba: la acción vuelve a la página con `?error=` y la página se pinta como quedó,
 * con su motivo en palabras. `monto_cambio` no está: ese vuelve al formulario, con lo escrito y el monto nuevo.
 */
export const CAMBIOS_DEL_DESEMBOLSO = [
  "ya_desembolsado",
  "anulado",
  "no_realizada",
  "antes_de_plazo",
  "con_reporte",
  "pagos_en_revision",
  "caso_abierto",
  "sin_pagos_aprobados",
] as const satisfies readonly ResultadoDeEjecucion[];

export const MENSAJE_DE_CAMBIO = "No registramos la transferencia: el desembolso cambió mientras lo mirabas. Revisa cómo quedó antes de transferir.";

/**
 * Lo que se dice arriba de la página después de una acción: la acción vuelve con `?ejecutado=` o `?error=`. El éxito
 * solo se dice si el desembolso de verdad quedó desembolsado por el admin de la sesión: un enlace viejo, escrito a
 * mano o el de otro admin no anuncia una transferencia que no registró.
 */
export function avisosDeLaPagina(
  consulta: Record<string, string | string[] | undefined>,
  desembolso: { estado: EstadoDeDesembolso; idAdmin: string | null },
  idSesion: string,
): AvisoDeLaPagina[] {
  const valor = (clave: string) => (typeof consulta[clave] === "string" ? (consulta[clave] as string) : null);
  const avisos: AvisoDeLaPagina[] = [];

  if (valor("ejecutado") === "desembolsado" && desembolso.estado === "desembolsado" && desembolso.idAdmin === idSesion) {
    avisos.push({ exito: true, texto: "Registraste la transferencia. El desembolso ya no aparece en la bandeja." });
  }

  const error = valor("error");
  if (error === "ya_desembolsado") avisos.push({ exito: false, texto: MENSAJES_DE_EJECUCION.ya_desembolsado });
  else if ((CAMBIOS_DEL_DESEMBOLSO as readonly string[]).includes(error ?? "")) avisos.push({ exito: false, texto: MENSAJE_DE_CAMBIO });
  return avisos;
}
