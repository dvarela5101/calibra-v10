import "server-only";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { enviarCorreo, type EntradaDeEnvio, type ResultadoEnvio } from "./enviar";
import type { Plantilla } from "./plantillas";
import { elegirProveedor } from "./proveedor";
import { crearRegistroDeEnvios } from "./registro";

/**
 * La puerta al correo para el resto del servidor (acciones, procesos programados, handlers). Conecta
 * `enviarCorreo` con el registro de la base (llave secreta) y con el proveedor que diga el entorno.
 * Es solo de servidor: la llave del proveedor nunca llega al navegador.
 *
 * Variables de entorno (ver `.env.example`): `SMTP_*` y `CORREO_REMITENTE` en producción (Gmail, D-1),
 * o `RESEND_API_KEY` cuando haya dominio,
 * `MAILPIT_URL` en local, y `SITIO_URL` para armar los enlaces de los correos.
 */
export async function enviarCorreoDesdeServidor<P extends Plantilla>(entrada: EntradaDeEnvio<P>): Promise<ResultadoEnvio> {
  let registro;
  try {
    registro = crearRegistroDeEnvios(crearClienteAdmin());
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return { ok: false, motivo: "fallo_del_registro", error: `No hay conexión al registro de correos: ${mensaje}`, intentos: 0 };
  }
  return enviarCorreo({ registro, proveedor: elegirProveedor(process.env) }, entrada);
}

export { urlDelSitio } from "./contacto";
export type { EntradaDeEnvio, ResultadoEnvio } from "./enviar";
