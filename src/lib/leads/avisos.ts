import { HORAS_DE_VIGENCIA } from "./verificacion";

/**
 * Lo que se le dice a quien escribió un correo que ya es de otro Lead, según lo que pasó con el enlace de
 * verificación (P-23, HU-068). El final cambia según lo que la persona estaba haciendo: agendando (HU-068) o
 * creando su cuenta (HU-032, `/cuenta/crear`). Nunca dice si ese correo tiene cuenta (RN-12).
 */
export type SeguirHaciendo = "agendando" | "creando tu cuenta";

/** Qué pasó con el enlace de verificación: salió, se frenó (ya van muchos en una hora) o no salió. */
export type EnvioDeVerificacion = "enviado" | "frenado" | "fallido";

export function avisoDeVerificacion(envio: EnvioDeVerificacion, seguir: SeguirHaciendo): string {
  switch (envio) {
    case "enviado":
      return `Ese correo ya está en Calibra. Si es tuyo, te llega un enlace para confirmarlo: ábrelo en este navegador y sigues ${seguir} aquí. El enlace vence en ${HORAS_DE_VIGENCIA} horas. Si no te llega en unos minutos, revisa la carpeta de spam.`;
    case "frenado":
      return "Ese correo ya está en Calibra y ya le mandamos varios enlaces para confirmarlo en la última hora. Busca el más reciente en ese correo (también en spam) o vuelve a intentarlo en una hora.";
    case "fallido":
      return "Ese correo ya está en Calibra, pero no pudimos mandarte el enlace para confirmarlo. Intenta de nuevo en unos minutos.";
  }
}

/**
 * Lo que ve un Estudiante que intenta cambiar su correo, en la ayuda bajo el campo y como error si lo manda por fuera de
 * la pantalla (D-55 b: el correo de la cuenta queda fijo; soporte lo cambia).
 */
export const CORREO_FIJO = "Tu correo es el de tu cuenta y no se puede cambiar aquí. Si necesitas cambiarlo, escribe a soporte.";
