import { createHash, randomBytes } from "node:crypto";
import { CONTRASENA_MINIMA } from "@/lib/auth/convertir";
import { esCorreo } from "@/lib/correo/contacto";

/**
 * Invitación de monitor (HU-013, P-20). El token son 256 bits aleatorios en hex y viaja solo en el
 * correo; la base guarda su SHA-256 (`invitacion_monitor.token_hash`). Vence a los 7 días: el
 * vencimiento lo pone la base (`vence_en`), aquí solo se muestra.
 */
export const DIAS_DE_VIGENCIA = 7;

export const RUTA_REGISTRO = "/monitores/registro";

const FORMATO_TOKEN = /^[0-9a-f]{64}$/;

export function generarToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashDeToken(token) };
}

export function hashDeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** ¿Tiene forma de token? Lo que no la tiene ni se consulta en la base. */
export function tieneFormaDeToken(valor: unknown): valor is string {
  return typeof valor === "string" && FORMATO_TOKEN.test(valor);
}

/** Ruta del enlace de registro, para `urlDelSitio`. */
export function rutaDeRegistro(token: string): string {
  return `${RUTA_REGISTRO}?token=${token}`;
}

/** Correo en minúsculas y sin espacios, como lo guarda la invitación. `null` si no es un correo. */
export function normalizarCorreo(valor: unknown): string | null {
  const correo = String(valor ?? "").trim().toLowerCase();
  return esCorreo(correo) ? correo : null;
}

export type DatosDeRegistro = { nombre: string; numeroTelefono: string; llave: string; contrasena: string };

const LARGO_MAXIMO = 200;

/** Texto de una sola línea, sin espacios de sobra. */
const linea = (valor: FormDataEntryValue | null) => String(valor ?? "").replace(/\s+/g, " ").trim();

/**
 * Campos del formulario de registro. El correo no se pide: es el de la invitación.
 * El teléfono se guarda como texto, con indicativo si lo trae.
 */
export function leerRegistro(formulario: FormData): { ok: true; datos: DatosDeRegistro } | { ok: false; error: string } {
  const nombre = linea(formulario.get("nombre"));
  const numeroTelefono = linea(formulario.get("numero_telefono"));
  const llave = linea(formulario.get("llave"));
  const contrasena = String(formulario.get("contrasena") ?? "");
  const confirmacion = String(formulario.get("confirmacion") ?? "");

  if (!nombre) return { ok: false, error: "Escribe tu nombre." };
  if (!/^\+?[\d ()-]{7,20}$/.test(numeroTelefono) || numeroTelefono.replace(/\D/g, "").length < 7) {
    return { ok: false, error: "Escribe un teléfono válido, por ejemplo 300 123 4567." };
  }
  const errorDeLlave = validarLlave(llave);
  if (errorDeLlave) return { ok: false, error: errorDeLlave };
  if (contrasena.length < CONTRASENA_MINIMA) {
    return { ok: false, error: `La contraseña debe tener al menos ${CONTRASENA_MINIMA} caracteres.` };
  }
  if (contrasena !== confirmacion) return { ok: false, error: "Las dos contraseñas no coinciden." };
  if (nombre.length > LARGO_MAXIMO) return { ok: false, error: "El nombre es demasiado largo." };

  return { ok: true, datos: { nombre, numeroTelefono, llave, contrasena } };
}

/** La llave (RN-80) es un texto libre: celular, correo o alias del banco. `null` si sirve. */
export function validarLlave(llave: string): string | null {
  if (!llave) return "Escribe tu llave para recibir tus pagos.";
  if (llave.length > LARGO_MAXIMO) return "La llave es demasiado larga.";
  return null;
}
