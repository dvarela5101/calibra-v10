/**
 * Configuración regional del negocio.
 *
 * Toda fecha que ve una persona o que decide un plazo se interpreta en la zona
 * del negocio, sin importar la zona del servidor (Vercel corre en UTC) ni la del
 * navegador. Los plazos y la comisión viven en su propio módulo (HU-003).
 */
export const ZONA_HORARIA_NEGOCIO = "America/Bogota";

/** Idioma del documento (`<html lang>`). */
export const IDIOMA = "es";

/** Locale para formatear fechas, horas y montos. */
export const LOCALE = "es-CO";
