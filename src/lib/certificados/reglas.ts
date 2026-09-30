/**
 * Certificados de monitor por materia (HU-014, RN-21, P-19). Lectura del formulario del admin y
 * mensajes para la persona. La base vuelve a exigir todo (política "admin certifica", restricción única
 * y fecha de evaluación no posterior a la emisión) aunque alguien se salte la app.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DatosDeCertificacion = { idMonitor: string; idMateria: string; fechaEvaluacion: string };

export type Lectura<T> = { ok: true; datos: T } | { ok: false; error: string };

/** ¿Es `AAAA-MM-DD` un día que existe? */
function esFecha(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const instante = new Date(`${fecha}T12:00:00Z`);
  return !Number.isNaN(instante.getTime()) && instante.toISOString().slice(0, 10) === fecha;
}

/** Lee el formulario de certificar. `hoy` es el día del negocio (Bogotá), `AAAA-MM-DD`. */
export function leerCertificacion(formulario: FormData, hoy: string): Lectura<DatosDeCertificacion> {
  const idMonitor = String(formulario.get("id_monitor") ?? "").trim();
  if (!UUID.test(idMonitor)) return { ok: false, error: "Elige el monitor que vas a certificar." };

  const idMateria = String(formulario.get("id_materia") ?? "").trim();
  if (!UUID.test(idMateria)) return { ok: false, error: "Elige la materia." };

  const fechaEvaluacion = String(formulario.get("fecha_evaluacion") ?? "").trim();
  if (!esFecha(fechaEvaluacion)) return { ok: false, error: "Escribe la fecha de la evaluación presencial." };
  if (fechaEvaluacion > hoy) return { ok: false, error: "La fecha de la evaluación no puede ser posterior a hoy." };

  return { ok: true, datos: { idMonitor, idMateria, fechaEvaluacion } };
}

/** Mensaje para la persona a partir de un error de la base al certificar. */
export function mensajeDeErrorDeCertificado(error: { code?: string } | null): string {
  switch (error?.code) {
    case "23505":
      return "Ese monitor ya está certificado en esa materia.";
    case "23514":
      return "La fecha de la evaluación no puede ser posterior a hoy.";
    case "23503":
      return "No encontramos ese monitor o esa materia. Recarga la página.";
    case "42501":
      return "Tu cuenta no puede certificar monitores.";
    default:
      return "No pudimos crear el certificado. Intenta de nuevo.";
  }
}
