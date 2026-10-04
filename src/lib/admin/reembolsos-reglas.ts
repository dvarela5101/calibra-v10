import { esFechaDeCalendario, esUuid } from "@/lib/agendar/reglas";
import { avisoDeReenviar } from "@/lib/reembolsos/reglas";

/**
 * Gestionar un reembolso (HU-026): el admin asignado transfiere por fuera de la app a la llave de quien pagó y registra
 * la referencia y la fecha; si todavía espera la llave, cualquier admin activo reenvía el enlace. Aquí va lo puro: qué
 * responde la base al registrar, qué se le dice al admin con cada resultado, la lectura del formulario y los avisos de
 * la página. Si se puede registrar lo decide `public.ejecutar_reembolso` con su propia hora y bajo candado; lo de aquí
 * solo lo anticipa en la pantalla. Ningún texto lleva cifras de comisión: el reembolso es el pago completo (RN-60).
 */

/** El estado que muestra la página (`public.estado_de_reembolso`): `cerrado` es uno que esperaba la llave y venció. */
export const ESTADOS_DE_LA_VISTA = ["esperando_llave", "cerrado", "pendiente", "reembolsado"] as const;
export type EstadoDeLaVista = (typeof ESTADOS_DE_LA_VISTA)[number];

export function esEstadoDeLaVista(valor: unknown): valor is EstadoDeLaVista {
  return typeof valor === "string" && (ESTADOS_DE_LA_VISTA as readonly string[]).includes(valor);
}

/** Lo que responde `public.ejecutar_reembolso`, en el orden en que la base lo mira (ver su migración). */
export const RESULTADOS_DE_REGISTRO = [
  "reembolsado",
  "ya_reembolsado",
  "sin_llave",
  "no_asignado",
  "fecha_invalida",
  "referencia_invalida",
  "no_encontrado",
  "sin_permiso",
  "sin_sesion",
] as const;
export type ResultadoDeRegistro = (typeof RESULTADOS_DE_REGISTRO)[number];

export function esResultadoDeRegistro(valor: unknown): valor is ResultadoDeRegistro {
  return typeof valor === "string" && (RESULTADOS_DE_REGISTRO as readonly string[]).includes(valor);
}

/** Qué se le dice al admin cuando la transferencia no se registró. */
export const MENSAJES_DE_REGISTRO: Record<Exclude<ResultadoDeRegistro, "reembolsado">, string> = {
  ya_reembolsado: "Este reembolso ya estaba registrado, así que no se registró otra vez. No lo transfieras de nuevo.",
  sin_llave: "Quien pagó todavía no nos ha enviado su llave: no hay a dónde transferir.",
  no_asignado: "Este reembolso lo tiene asignado otro admin: solo esa persona registra la transferencia.",
  fecha_invalida: "La fecha de la transferencia no puede ser posterior a hoy ni anterior al día en que se creó el reembolso.",
  referencia_invalida: "Escribe la referencia de la transferencia, de hasta 100 caracteres.",
  no_encontrado: "No encontramos este reembolso.",
  sin_permiso: "Solo un admin activo registra reembolsos.",
  sin_sesion: "Tu sesión terminó. Vuelve a entrar e intenta de nuevo.",
};

export const MENSAJE_DE_FALLO = "No pudimos registrar la transferencia. Intenta de nuevo; si sigue igual, avisa al equipo.";

/** Largo máximo de la referencia: el mismo `check` de `reembolso.referencia_transferencia` (`reembolso_referencia_con_texto`). */
export const LARGO_MAXIMO_REFERENCIA = 100;

/** Los errores de la fecha en el formulario: la base los resume en `fecha_invalida`. */
export const ERRORES_DE_FECHA = {
  falta: "Escribe la fecha de la transferencia.",
  futura: "La fecha de la transferencia no puede ser posterior a hoy.",
  antesDeCrearse: "La fecha de la transferencia no puede ser anterior al día en que se creó el reembolso.",
} as const;

export type PedidoDeRegistro = {
  idReembolso: string;
  /** Recortada y de 1 a 100 caracteres. */
  referencia: string;
  /** Día de la transferencia, `AAAA-MM-DD`. */
  fecha: string;
};

export type LecturaDeRegistro = { ok: true; datos: PedidoDeRegistro } | { ok: false; error: string };

/**
 * El formulario del registro (supuestos 2 y 3). `hoy` es el día del negocio (Bogotá), `AAAA-MM-DD`. La referencia se
 * recorta y se cuenta por caracteres, como `char_length` en la base, no por unidades de JavaScript. La fecha es un día
 * que existe, no posterior a hoy ni anterior al día en que se creó el reembolso; ese día llega en un campo oculto solo
 * para anticiparlo, porque la base lo vuelve a mirar con la fecha de creación guardada.
 */
export function leerRegistro(datos: FormData, hoy: string): LecturaDeRegistro {
  const texto = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor.trim() : "";
  };
  const idReembolso = texto("id_reembolso").toLowerCase();
  if (!esUuid(idReembolso)) return { ok: false, error: MENSAJES_DE_REGISTRO.no_encontrado };

  const referencia = texto("referencia");
  if (!referencia || [...referencia].length > LARGO_MAXIMO_REFERENCIA) return { ok: false, error: MENSAJES_DE_REGISTRO.referencia_invalida };

  const fecha = texto("fecha");
  if (!esFechaDeCalendario(fecha)) return { ok: false, error: ERRORES_DE_FECHA.falta };
  if (fecha > hoy) return { ok: false, error: ERRORES_DE_FECHA.futura };
  const fechaMinima = texto("fecha_minima");
  if (esFechaDeCalendario(fechaMinima) && fecha < fechaMinima) return { ok: false, error: ERRORES_DE_FECHA.antesDeCrearse };

  return { ok: true, datos: { idReembolso, referencia, fecha } };
}

/** Lo que se lee antes de "Sí, registrar la transferencia": qué queda registrado y que no se deshace. */
export function consecuenciasDeRegistrar(monto: string, llave: string): string {
  return `Registra la transferencia de ${monto} a ${llave}. No se puede deshacer.`;
}

/**
 * Lo que cambió mientras el admin miraba: la acción vuelve a la página con `?error=` y la página se pinta como quedó.
 * `ya_reembolsado` dice que no lo transfiera otra vez; los demás, que revise cómo quedó.
 */
export const CAMBIOS_DEL_REEMBOLSO = ["ya_reembolsado", "sin_llave", "no_asignado"] as const satisfies readonly ResultadoDeRegistro[];

export const MENSAJE_DE_CAMBIO = "No registramos la transferencia: el reembolso cambió mientras lo mirabas. Revisa cómo quedó antes de transferir.";

export type AvisoDeLaPagina = { exito: boolean; texto: string };

/**
 * Lo que se dice arriba de la página después de una acción: registrar vuelve con `?registrado=` o `?error=`, y reenviar
 * con `?reenvio=`. El éxito del registro solo se dice si el reembolso de verdad quedó reembolsado por el admin de la
 * sesión: un enlace viejo, escrito a mano o el de otro admin no anuncia una transferencia que no registró.
 */
export function avisosDeLaPagina(
  consulta: Record<string, string | string[] | undefined>,
  reembolso: { estado: EstadoDeLaVista; idAdmin: string | null },
  idSesion: string,
): AvisoDeLaPagina[] {
  const valor = (clave: string) => (typeof consulta[clave] === "string" ? (consulta[clave] as string) : null);
  const avisos: AvisoDeLaPagina[] = [];

  if (valor("registrado") === "reembolsado" && reembolso.estado === "reembolsado" && reembolso.idAdmin === idSesion) {
    avisos.push({
      exito: true,
      texto: "Registraste la transferencia. El reembolso sale de tu bandeja y quien pagó ve en su enlace que ya le devolvimos el dinero.",
    });
  }

  const error = valor("error");
  if (error === "ya_reembolsado") avisos.push({ exito: false, texto: MENSAJES_DE_REGISTRO.ya_reembolsado });
  else if ((CAMBIOS_DEL_REEMBOLSO as readonly string[]).includes(error ?? "")) avisos.push({ exito: false, texto: MENSAJE_DE_CAMBIO });

  const reenvio = avisoDeReenviar(consulta);
  if (reenvio) avisos.push(reenvio);
  return avisos;
}
