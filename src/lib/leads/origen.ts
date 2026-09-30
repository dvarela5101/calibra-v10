/**
 * Origen del Lead (RN-01, HU-068): la campaña con la que llegó el visitante (`?utm_campaign=...`). La
 * guarda en una cookie `OrigenDeCampana` y la lee el servidor al crear el Lead. Sin dependencias: lo usa
 * también el navegador.
 */

/** Nombre de la cookie donde queda la campaña. */
export const COOKIE_ORIGEN = "calibra_origen";

/**
 * La campaña, si tiene forma de una: solo letras sin tildes, números, punto, guion y guion bajo, hasta
 * 100. Lo demás no se guarda.
 */
export function leerOrigen(valor: unknown): string | null {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return /^[A-Za-z0-9._-]{1,100}$/.test(texto) ? texto : null;
}
