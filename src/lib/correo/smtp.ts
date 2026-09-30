import { createHash } from "node:crypto";
import { createTransport } from "nodemailer";
import { limpiarError, type Proveedor } from "./proveedor";

/**
 * Transporte SMTP (HU-066, decisión D-1): sin dominio propio, los correos salen por el SMTP de Gmail
 * desde calibra.monitorias@gmail.com, con una contraseña de aplicación de Google. Las respuestas
 * llegan a ese mismo buzón porque es el remitente.
 *
 * SMTP no tiene Idempotency-Key: la idempotencia la pone el registro de envíos (HU-006), que no
 * vuelve a mandar un correo ya `enviado`. El Message-ID sale de la clave, así un reintento del mismo
 * correo lleva el mismo identificador.
 */

// Por fase (conexión, saludo, respuesta). Quien invita espera el envío: se prefiere fallar pronto y reintentar.
const TIMEOUT_MS = 10_000;

const HOSTS_LOCALES = new Set(["127.0.0.1", "localhost", "::1"]);

/** Lo mínimo de nodemailer que se usa: permite probar sin red. */
export type TransporteSmtp = { sendMail(mensaje: MensajeSmtp): Promise<{ messageId?: string }> };

export type MensajeSmtp = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
};

export type ConfiguracionSmtp = {
  servidor: string;
  puerto: number;
  usuario: string;
  contrasena: string;
};

/** Error de nodemailer: `code` para fallos de conexión o de protocolo, `responseCode` para la respuesta SMTP. */
type ErrorSmtp = { code?: unknown; responseCode?: unknown; message?: unknown };

const ERRORES_DE_RED = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "ECONNREFUSED", "EPIPE"]);

/**
 * Qué fallos vale la pena reintentar: los de red y las respuestas 4xx de SMTP, que son temporales por
 * definición (RFC 5321). No se reintentan la autenticación (535, EAUTH) ni los 5xx, entre ellos el
 * límite diario de Gmail (550 5.4.5): fallarían igual al instante.
 */
export function esReintentableEnSmtp(error: ErrorSmtp): boolean {
  const respuesta = typeof error.responseCode === "number" ? error.responseCode : null;
  if (respuesta !== null) return respuesta >= 400 && respuesta < 500;
  return typeof error.code === "string" && ERRORES_DE_RED.has(error.code);
}

/** Message-ID estable por correo, derivado de la clave de idempotencia (que no se expone tal cual). */
export function messageIdDe(claveIdempotencia: string, usuario: string): string {
  const dominio = usuario.includes("@") ? usuario.slice(usuario.lastIndexOf("@") + 1) : "calibra.local";
  const huella = createHash("sha256").update(claveIdempotencia).digest("hex").slice(0, 32);
  return `<${huella}@${dominio}>`;
}

export function crearTransporteNodemailer({ servidor, puerto, usuario, contrasena }: ConfiguracionSmtp): TransporteSmtp {
  return createTransport({
    host: servidor,
    port: puerto,
    // 465 es TLS desde el primer byte. En otro puerto se exige STARTTLS para no mandar la contraseña en
    // claro, salvo contra esta misma máquina (el servidor falso de las pruebas).
    secure: puerto === 465,
    requireTLS: puerto !== 465 && !HOSTS_LOCALES.has(servidor),
    auth: { user: usuario, pass: contrasena },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
}

export function crearProveedorSmtp({
  configuracion,
  remitente,
  transporte = crearTransporteNodemailer(configuracion),
}: {
  configuracion: ConfiguracionSmtp;
  remitente: string;
  transporte?: TransporteSmtp;
}): Proveedor {
  const secretos = [configuracion.contrasena];
  return {
    nombre: "smtp",
    async enviar(correo) {
      try {
        const info = await transporte.sendMail({
          from: remitente,
          to: correo.para,
          subject: correo.asunto,
          html: correo.html,
          text: correo.texto,
          messageId: messageIdDe(correo.claveIdempotencia, configuracion.usuario),
        });
        return { ok: true, idProveedor: typeof info.messageId === "string" ? info.messageId : null };
      } catch (causa) {
        const error = (typeof causa === "object" && causa !== null ? causa : { message: String(causa) }) as ErrorSmtp;
        const codigo = [error.responseCode, error.code].filter((parte) => parte !== undefined).join(" ");
        const mensaje = typeof error.message === "string" ? error.message : String(causa);
        return {
          ok: false,
          reintentable: esReintentableEnSmtp(error),
          error: limpiarError(`SMTP ${codigo || "sin código"}: ${mensaje}`, secretos),
        };
      }
    },
  };
}

/**
 * Configuración SMTP del entorno: `SMTP_SERVIDOR`, `SMTP_PUERTO` (465 si falta), `SMTP_USUARIO` y
 * `SMTP_CONTRASENA`. `null` si falta el servidor, el usuario o la contraseña; un error si el puerto no
 * es un número de puerto.
 */
export function leerConfiguracionSmtp(
  entorno: Record<string, string | undefined>,
): { ok: true; configuracion: ConfiguracionSmtp } | { ok: false; error: string } | null {
  const servidor = entorno.SMTP_SERVIDOR?.trim();
  const usuario = entorno.SMTP_USUARIO?.trim();
  // Google muestra la contraseña de aplicación en grupos de 4 con espacios: se aceptan y se quitan.
  const contrasena = entorno.SMTP_CONTRASENA?.replace(/\s+/g, "");
  if (!servidor || !usuario || !contrasena) return null;
  const textoPuerto = entorno.SMTP_PUERTO?.trim() || "465";
  const puerto = Number(textoPuerto);
  if (!/^\d+$/.test(textoPuerto) || puerto < 1 || puerto > 65_535) {
    return { ok: false, error: `SMTP_PUERTO debe ser un número de puerto (llegó "${textoPuerto}").` };
  }
  return { ok: true, configuracion: { servidor, puerto, usuario, contrasena } };
}
