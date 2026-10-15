"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/auth/sesion";
import { avisoDeVerificacion, CORREO_FIJO } from "@/lib/leads/avisos";
import { COOKIE_ORIGEN, leerOrigen } from "@/lib/leads/origen";
import { leerContacto, resumenDeError, rutaSiguiente } from "@/lib/leads/reglas";
import { leadDeLaSesion, registrarContacto, type LeadDeSesion, type ResultadoContacto } from "@/lib/leads/servidor";
import { leerConsentimiento } from "@/lib/privacidad/consentimiento";

/**
 * HU-068 (D-3): el visitante deja su contacto al agendar y queda como Lead. `valores` devuelve lo escrito
 * para no vaciar el formulario; `aviso` es el mensaje de "revisa tu correo" cuando hay que confirmarlo (P-23).
 */
export type EstadoContacto = { error: string | null; aviso: string | null; valores: Record<string, string> };

const CAMPOS = ["nombre", "correo", "numero_telefono"] as const;

const valoresDe = (datos: FormData) => Object.fromEntries(CAMPOS.map((c) => [c, String(datos.get(c) ?? "")]));

export async function dejarContacto(_anterior: EstadoContacto, datos: FormData): Promise<EstadoContacto> {
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

  const siguiente = rutaSiguiente(datos.get("siguiente"));
  const origen = leerOrigen((await cookies()).get(COOKIE_ORIGEN)?.value);

  let resultado: ResultadoContacto;
  try {
    resultado = await registrarContacto({
      idSesion: sesion.idUsuario,
      contacto: contacto.datos,
      consentimiento: consentimiento.consentimiento,
      origen,
      siguiente,
    });
  } catch (error) {
    console.error("[leads] no se pudo guardar el contacto:", resumenDeError(error));
    return fallo("No pudimos guardar tus datos. Intenta de nuevo.");
  }

  if (resultado.resultado === "error") return fallo(resultado.error);
  if (resultado.resultado === "verificar") return { error: null, aviso: avisoDeVerificacion(resultado.envio, "agendando"), valores };
  redirect(siguiente);
}
