"use server";

import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/auth/sesion";
import { RUTA_CONTRASENA, TEXTOS, tieneFormaDeTokenDeAuth } from "@/lib/cuentas/reglas";
import { activarCuenta, confirmarCorreoDeCuenta, type ResultadoDeActivar, type ResultadoDeConfirmar } from "@/lib/cuentas/servidor";
import { resumenDeError } from "@/lib/leads/reglas";
import { identidadDelProveedor } from "@/lib/pagos/configuracion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * Qué más ofrece la pantalla después de un error: pedir otro enlace (el de este ya no sirve) o ir a «Terminar de crear mi
 * cuenta» (el correo quedó confirmado y falta crear el Estudiante, que se repite sin otro enlace).
 */
export type EstadoConfirmarCuenta = { error: string | null; siguientePaso: "pedir_otro" | "terminar" | null };

const conError = (error: string, siguientePaso: EstadoConfirmarCuenta["siguientePaso"] = null): EstadoConfirmarCuenta => ({ error, siguientePaso });

/**
 * HU-032, criterio 4 (P-23 como patrón): confirma el correo con un botón (POST) y no al abrir el enlace, para que un
 * revisor de enlaces del correo no lo gaste solo. En este orden:
 * 1. la guarda: un monitor, un admin o un Estudiante con sesión abierta no cambia nada (`verifyOtp` le reemplazaría la
 *    cookie sin aviso);
 * 2. `verifyOtp` con el tipo fijo `email_change` y el `token_hash` del formulario;
 * 3. `activarCuenta`: cierra las demás sesiones y crea el Estudiante.
 * Un enlace usado, vencido o inventado dice «ya no sirve»; si el correo quedó confirmado y no se pudo crear el Estudiante,
 * «Terminar de crear mi cuenta» lo repite sin otro enlace.
 */
export async function confirmar(_anterior: EstadoConfirmarCuenta, datos: FormData): Promise<EstadoConfirmarCuenta> {
  const sesion = await obtenerSesion();
  if (sesion && (sesion.rol === "monitor" || sesion.rol === "admin" || sesion.rol === "estudiante")) {
    return conError(TEXTOS.cuentaAbierta);
  }

  const tokenHash = datos.get("token_hash");
  if (!tieneFormaDeTokenDeAuth(tokenHash)) return conError(TEXTOS.enlaceNoSirveAlConfirmar, "pedir_otro");

  const supabase = await crearClienteServidor();
  if (!supabase) return conError("Este servicio no está disponible en este momento.");

  let confirmacion: ResultadoDeConfirmar;
  try {
    confirmacion = await confirmarCorreoDeCuenta(supabase, tokenHash);
  } catch (error) {
    console.error("[cuentas] no se pudo confirmar el correo:", resumenDeError(error));
    return conError(TEXTOS.noPudimosConfirmar);
  }
  if (!confirmacion.ok) {
    return confirmacion.motivo === "no_sirve" ? conError(TEXTOS.enlaceNoSirveAlConfirmar, "pedir_otro") : conError(TEXTOS.noPudimosConfirmar);
  }

  let activada: ResultadoDeActivar;
  try {
    activada = await activarCuenta(confirmacion.idUsuario, confirmacion.tokenDeAcceso);
  } catch (error) {
    console.error("[cuentas] no se pudo activar la cuenta:", resumenDeError(error));
    activada = { ok: false, motivo: "fallo" };
  }
  if (activada.ok) redirect(RUTA_CONTRASENA);

  // Repetir el paso daría lo mismo: se manda a soporte y no a «Terminar».
  if (activada.motivo === "soporte") return conError(TEXTOS.soporte(identidadDelProveedor().correo));
  return conError(TEXTOS.confirmadoSinTerminar, "terminar");
}
