import { CONTRASENA_MINIMA } from "@/lib/auth/convertir";
import { normalizarCorreo } from "@/lib/monitores/invitacion";

/**
 * Invitar a un admin al equipo (HU-072): lo puro. Leer los formularios de invitar y de registrarse, los textos que
 * se le dicen al admin y la ruta del enlace. `generarToken`, `hashDeToken`, `tieneFormaDeToken` y `normalizarCorreo`
 * son los de la invitación de monitor (`@/lib/monitores/invitacion`) y se importan de ahí, no se copian.
 */

export const RUTA_REGISTRO_DE_ADMIN = "/admins/registro";

/** Ruta del enlace de registro, para `urlDelSitio`. El token viaja solo aquí y en el correo. */
export function rutaDeRegistroDeAdmin(token: string): string {
  return `${RUTA_REGISTRO_DE_ADMIN}?token=${token}`;
}

/** Lo que dice la casilla de aviso del formulario de invitar (criterio 2). El texto lo valida asesoría. */
export const AVISO_DE_DATOS =
  "Entiendo que esta persona podrá ver datos personales de estudiantes, de quienes pagan y de monitores, incluidas las llaves de pago de unos y otros.";

/** Lo que el formulario de invitar puede tener mal. */
export type ErrorDeInvitar = "correo_invalido" | "correos_distintos" | "sin_aviso" | "correos_distintos_y_sin_aviso";

/**
 * El formulario de invitar: el correo escrito dos veces y la casilla marcada. Los dos correos se comparan ya
 * normalizados (minúsculas y sin espacios), como los guarda la invitación. Un correo que no es un correo (HU-070)
 * gana sobre lo demás: no tiene sentido decir que falta la casilla de un correo que no se puede usar.
 */
export function leerInvitacion(datos: FormData): { ok: true; correo: string } | { ok: false; error: ErrorDeInvitar } {
  const correo = normalizarCorreo(datos.get("correo"));
  if (!correo) return { ok: false, error: "correo_invalido" };
  const coinciden = normalizarCorreo(datos.get("correo_repetido")) === correo;
  const conAviso = datos.get("entiendo") === "si";
  if (!coinciden && !conAviso) return { ok: false, error: "correos_distintos_y_sin_aviso" };
  if (!coinciden) return { ok: false, error: "correos_distintos" };
  if (!conAviso) return { ok: false, error: "sin_aviso" };
  return { ok: true, correo };
}

/**
 * Por qué `crear_invitacion_admin` no creó la invitación. `sin_permiso` va con su propia clave en la dirección
 * (`sin_permiso_invitar`): `/admin/equipo` ya tiene un `sin_permiso` de «Subir» y «Bajar» con otro texto.
 */
export type MotivoDeRechazoAlInvitar = "es_admin" | "es_admin_desactivado" | "es_monitor" | "sin_permiso";

export type ClaveDeErrorDeInvitar = ErrorDeInvitar | Exclude<MotivoDeRechazoAlInvitar, "sin_permiso"> | "sin_permiso_invitar" | "fallo_invitar";

/** La clave de la dirección con la que se avisa de un rechazo. */
export function claveDeRechazoAlInvitar(motivo: MotivoDeRechazoAlInvitar): ClaveDeErrorDeInvitar {
  return motivo === "sin_permiso" ? "sin_permiso_invitar" : motivo;
}

/** Qué se le dice al admin cuando no se creó la invitación. Ninguno lleva el correo: no viaja en la dirección. */
export const MENSAJES_DE_INVITAR: Record<ClaveDeErrorDeInvitar, string> = {
  correo_invalido: "Escribe un correo válido.",
  correos_distintos: "Los dos correos no coinciden. Escríbelos de nuevo.",
  sin_aviso: "Marca la casilla para confirmar que la persona podrá ver esos datos personales.",
  correos_distintos_y_sin_aviso: "Los dos correos no coinciden y falta marcar la casilla. Escribe los correos de nuevo y marca la casilla.",
  es_admin: "Ese correo ya es de un admin del equipo.",
  es_admin_desactivado: "Ese correo es de un admin desactivado. Se reactiva desde su tarjeta, con «Reactivar».",
  es_monitor: "Ese correo ya tiene una cuenta de monitor.",
  sin_permiso_invitar: "Solo un admin activo puede invitar.",
  fallo_invitar: "No pudimos crear la invitación. Intenta de nuevo; si sigue igual, avisa al equipo.",
};

export function esClaveDeErrorDeInvitar(valor: unknown): valor is ClaveDeErrorDeInvitar {
  return typeof valor === "string" && Object.hasOwn(MENSAJES_DE_INVITAR, valor);
}

/** Lo que `cancelar_invitacion_admin` responde. */
export const RESULTADOS_DE_CANCELAR = ["cancelada", "no_abierta", "no_encontrada", "sin_permiso"] as const;
export type ResultadoDeCancelar = (typeof RESULTADOS_DE_CANCELAR)[number];

export function esResultadoDeCancelar(valor: unknown): valor is ResultadoDeCancelar {
  return typeof valor === "string" && (RESULTADOS_DE_CANCELAR as readonly string[]).includes(valor);
}

/** Cuando cancelar no cambió nada. Una usada, una ya cancelada, una vencida y una que no existe se leen igual. */
export const MENSAJES_DE_CANCELAR: Record<"no_abierta" | "no_encontrada" | "sin_permiso_cancelar", string> = {
  no_abierta: "Esa invitación ya no está abierta.",
  no_encontrada: "Esa invitación ya no está abierta.",
  sin_permiso_cancelar: "Solo un admin activo puede cancelar invitaciones.",
};

/** La clave de la dirección con la que se avisa de una cancelación que no cambió nada. */
export function claveDeRechazoAlCancelar(resultado: Exclude<ResultadoDeCancelar, "cancelada">): keyof typeof MENSAJES_DE_CANCELAR {
  return resultado === "sin_permiso" ? "sin_permiso_cancelar" : resultado;
}

/** Una invitación abierta tal como la ve un admin en la lista (sin el hash del token, que nunca sale de la base). */
export type InvitacionAbierta = {
  id: string;
  correo: string;
  /** El nombre del admin que invitó. */
  invitadaPor: string;
  /** Si ese admin sigue activo. Si ya no, la lista lo dice: la invitación sigue sirviendo hasta que alguien la cancele. */
  invitoActivo: boolean;
  creadaEn: Date;
  venceEn: Date;
};

export type DatosDeRegistroDeAdmin = { nombre: string; contrasena: string };

const LARGO_MAXIMO_DEL_NOMBRE = 120;

/** Texto de una sola línea, sin espacios de sobra (el nombre va a los correos de invitación que este admin mande). */
const linea = (valor: FormDataEntryValue | null) => String(valor ?? "").replace(/\s+/g, " ").trim();

/** Los campos del formulario de registro. El correo no se pide: es el de la invitación. */
export function leerRegistroDeAdmin(formulario: FormData): { ok: true; datos: DatosDeRegistroDeAdmin } | { ok: false; error: string } {
  const nombre = linea(formulario.get("nombre"));
  const contrasena = String(formulario.get("contrasena") ?? "");
  const confirmacion = String(formulario.get("confirmacion") ?? "");

  if (!nombre) return { ok: false, error: "Escribe tu nombre." };
  if (contrasena.length < CONTRASENA_MINIMA) {
    return { ok: false, error: `La contraseña debe tener al menos ${CONTRASENA_MINIMA} caracteres.` };
  }
  if (contrasena !== confirmacion) return { ok: false, error: "Las dos contraseñas no coinciden." };
  if (nombre.length > LARGO_MAXIMO_DEL_NOMBRE) return { ok: false, error: "El nombre es demasiado largo." };

  return { ok: true, datos: { nombre, contrasena } };
}
