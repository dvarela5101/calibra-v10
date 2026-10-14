import "server-only";
import { cookies } from "next/headers";
import { obtenerSesion } from "@/lib/auth/sesion";
import { COOKIE_ORIGEN, leerOrigen } from "@/lib/leads/origen";
import { leerContacto, resumenDeError, type EstadoContacto } from "@/lib/leads/reglas";
import { registrarContacto, type EnvioDeVerificacion, type ResultadoContacto } from "@/lib/leads/servidor";
import { HORAS_DE_VIGENCIA } from "@/lib/leads/verificacion";
import { leerConsentimiento } from "@/lib/privacidad/consentimiento";

/**
 * Lo que comparten las acciones que dejan el contacto del visitante: al agendar (HU-068) y al ver el resultado del
 * diagnóstico (HU-010, D-3). Cada acción decide a dónde sigue quien ya quedó como Lead; aquí solo se dice a dónde lleva
 * el enlace de verificación cuando el correo ya es de otro Lead (P-23).
 */
export type { EstadoContacto };

const CAMPOS = ["nombre", "correo", "numero_telefono"] as const;

/** Qué se le dice a quien escribió un correo que ya es de otro Lead, según lo que pasó con el enlace (P-23). */
const AVISO_DE_VERIFICACION: Record<EnvioDeVerificacion, string> = {
  enviado: `Ese correo ya está en Calibra. Si es tuyo, te llega un enlace para confirmarlo: ábrelo en este navegador y sigues agendando aquí. El enlace vence en ${HORAS_DE_VIGENCIA} horas. Si no te llega en unos minutos, revisa la carpeta de spam.`,
  frenado:
    "Ese correo ya está en Calibra y ya le mandamos varios enlaces para confirmarlo en la última hora. Busca el más reciente en ese correo (también en spam) o vuelve a intentarlo en una hora.",
  fallido: "Ese correo ya está en Calibra, pero no pudimos mandarte el enlace para confirmarlo. Intenta de nuevo en unos minutos.",
};
const valoresDe = (datos: FormData) => Object.fromEntries(CAMPOS.map((c) => [c, String(datos.get(c) ?? "")]));

/**
 * Lee el formulario y deja a la sesión como Lead con `registrarContacto`. `{ listo: true }` si ya quedó como Lead (nuevo o
 * actualizado); si no, el estado que muestra el formulario. `siguienteDeVerificacion` es la ruta a la que lleva el enlace de
 * P-23 al confirmarlo.
 */
export async function procesarContacto(
  datos: FormData,
  { siguienteDeVerificacion }: { siguienteDeVerificacion: string },
): Promise<EstadoContacto | { listo: true }> {
  const valores = valoresDe(datos);
  const fallo = (error: string): EstadoContacto => ({ error, aviso: null, valores });

  // La sesión anónima nace en el navegador al abrir la página (RN-10); sin ella no hay a quién ligar el Lead.
  const sesion = await obtenerSesion();
  if (!sesion) return fallo("No pudimos verificar tu navegador. Recarga la página e intenta de nuevo.");
  if (sesion.rol === "monitor" || sesion.rol === "admin") {
    return fallo("Estás con tu cuenta del equipo de Calibra. Para agendar como estudiante, sal de tu cuenta o usa otra ventana.");
  }

  const contacto = leerContacto(datos);
  if (!contacto.ok) return fallo(contacto.error);
  const consentimiento = leerConsentimiento(datos);
  if (!consentimiento.ok) return fallo(consentimiento.error);

  const origen = leerOrigen((await cookies()).get(COOKIE_ORIGEN)?.value);

  let resultado: ResultadoContacto;
  try {
    resultado = await registrarContacto({
      idSesion: sesion.idUsuario,
      contacto: contacto.datos,
      consentimiento: consentimiento.consentimiento,
      origen,
      siguiente: siguienteDeVerificacion,
    });
  } catch (error) {
    console.error("[leads] no se pudo guardar el contacto:", resumenDeError(error));
    return fallo("No pudimos guardar tus datos. Intenta de nuevo.");
  }

  if (resultado.resultado === "error") return fallo(resultado.error);
  if (resultado.resultado === "verificar") return { error: null, aviso: AVISO_DE_VERIFICACION[resultado.envio], valores };
  return { listo: true };
}
