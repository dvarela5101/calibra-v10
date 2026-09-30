import { esCorreo } from "@/lib/correo/contacto";

/**
 * Contacto del visitante que va a agendar (HU-068, D-3). Lectura del formulario: P-21 (el nombre en el
 * mismo formulario), P-22 (correo obligatorio, teléfono opcional con indicativo). La autorización de
 * datos la lee `leerConsentimiento` (HU-008).
 */

export type DatosDeContacto = { nombre: string; correo: string; numeroTelefono: string | null };

export type Lectura<T> = { ok: true; datos: T } | { ok: false; error: string };

const LARGO_MAXIMO_NOMBRE = 120;

/**
 * Indicativo que se asume cuando el teléfono no trae uno: Calibra atiende a estudiantes de Colombia.
 * Con "+" delante, se respeta el que venga.
 */
export const INDICATIVO_POR_DEFECTO = "+57";

/** Texto de una sola línea, sin espacios de sobra. */
const linea = (valor: FormDataEntryValue | null | undefined) => String(valor ?? "").replace(/\s+/g, " ").trim();

/** Correo en minúsculas y sin espacios, como lo guarda el Lead (P-23). `null` si no es un correo. */
export function normalizarCorreo(valor: unknown): string | null {
  const correo = String(valor ?? "").trim().toLowerCase();
  return esCorreo(correo) ? correo : null;
}

/**
 * Teléfono como texto con indicativo (P-22): `+` y solo dígitos, por ejemplo `+573001234567`. Sin "+",
 * se antepone `INDICATIVO_POR_DEFECTO`. Vacío es `null` (es opcional); `undefined` si no es un teléfono.
 */
export function normalizarTelefono(valor: unknown): string | null | undefined {
  const texto = linea(String(valor ?? ""));
  if (!texto) return null;
  if (!/^\+?[\d ().-]+$/.test(texto)) return undefined;
  const digitos = texto.replace(/\D/g, "");
  const telefono = texto.startsWith("+") ? `+${digitos}` : `${INDICATIVO_POR_DEFECTO}${digitos}`;
  // E.164: hasta 15 cifras con el indicativo; menos de 8 no es un número completo.
  const cifras = telefono.length - 1;
  return cifras >= 8 && cifras <= 15 ? telefono : undefined;
}

export function leerContacto(formulario: FormData): Lectura<DatosDeContacto> {
  const nombre = linea(formulario.get("nombre"));
  if (!nombre) return { ok: false, error: "Escribe tu nombre." };
  if (nombre.length > LARGO_MAXIMO_NOMBRE) return { ok: false, error: "Tu nombre es demasiado largo." };

  const correo = normalizarCorreo(formulario.get("correo"));
  if (!correo) return { ok: false, error: "Escribe un correo válido, por ejemplo ana@uniandes.edu.co." };

  const numeroTelefono = normalizarTelefono(formulario.get("numero_telefono"));
  if (numeroTelefono === undefined) {
    return { ok: false, error: "Escribe el teléfono con su indicativo, por ejemplo +57 300 123 4567, o déjalo vacío." };
  }

  return { ok: true, datos: { nombre, correo, numeroTelefono } };
}

const SITIO = "https://calibra.invalid";

/**
 * Ruta del propio sitio a la que se vuelve después de dejar el contacto (por ejemplo, la fecha que
 * estaba agendando). Cualquier cosa que no sea una ruta interna (otro sitio, `//otro`, `/\otro`, un
 * enlace `javascript:`) da `/`.
 */
export function rutaSiguiente(valor: unknown): string {
  const texto = typeof valor === "string" ? valor : "";
  if (!texto.startsWith("/") || texto.length > 500 || /[\s\\\u0000-\u001f\u007f]/.test(texto) || texto.startsWith("//")) return "/";
  try {
    const url = new URL(texto, SITIO);
    if (url.origin !== SITIO) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
