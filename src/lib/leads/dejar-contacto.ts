import "server-only";
import { cookies } from "next/headers";
import { obtenerSesion } from "@/lib/auth/sesion";
import { mandarEnlaceDelUltimoDiagnostico, programarEnlace } from "@/lib/diagnostico/recuperacion";
import { avisoDeVerificacion, CORREO_FIJO } from "@/lib/leads/avisos";
import { COOKIE_ORIGEN, leerOrigen } from "@/lib/leads/origen";
import { leerContacto, resumenDeError, type EstadoContacto } from "@/lib/leads/reglas";
import { leadDeLaSesion, registrarContacto, type LeadDeSesion, type ResultadoContacto } from "@/lib/leads/servidor";
import { leerConsentimiento } from "@/lib/privacidad/consentimiento";

/**
 * Lo que comparten las acciones que dejan el contacto del visitante: al agendar (HU-068) y al ver el resultado del
 * diagnóstico (HU-010, D-3). Cada acción decide a dónde sigue quien ya quedó como Lead; aquí solo se dice a dónde lleva
 * el enlace de verificación cuando el correo ya es de otro Lead (P-23).
 */
export type { EstadoContacto };

const CAMPOS = ["nombre", "correo", "numero_telefono"] as const;

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

  // D-55 b (HU-032): el correo de un Estudiante es el de su cuenta y no se cambia. La pantalla lo muestra sin poder
  // editarlo; si llega otro por fuera de ella, se dice y no se toca nada. El Lead sale de la base, nunca del formulario.
  if (sesion.rol === "estudiante") {
    let lead: LeadDeSesion | null;
    try {
      lead = await leadDeLaSesion(sesion.idUsuario);
    } catch (error) {
      console.error("[leads] no se pudo leer el contacto del Estudiante:", resumenDeError(error));
      return fallo("No pudimos guardar tus datos. Intenta de nuevo.");
    }
    if (lead && contacto.datos.correo !== lead.correo) return fallo(CORREO_FIJO);
  }

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
  if (resultado.resultado === "verificar") return { error: null, aviso: avisoDeVerificacion(resultado.envio, "agendando"), valores };
  // HU-031 (P-33, P-34): el Lead se acaba de crear con los diagnósticos que la sesión ya tenía; le llega el enlace del más
  // reciente, sin esperar al proveedor. Al actualizar un Lead o al confirmar uno ajeno (P-23) no sale nada.
  const { idLeadNuevo } = resultado;
  if (idLeadNuevo) programarEnlace(() => mandarEnlaceDelUltimoDiagnostico(idLeadNuevo));
  return { listo: true };
}
