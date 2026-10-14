/**
 * Perfil del monitor (HU-049, D-58 a y b): carrera, semestre y presentación, los tres opcionales. Las mismas reglas
 * están en los CHECK de `perfil_monitor` (migración `perfil_monitor`); aquí dan el mensaje junto a cada campo.
 * Los largos se cuentan en caracteres Unicode, como `char_length` en Postgres.
 */

export const LARGO_CARRERA = 80;
export const LARGO_PRESENTACION = 500;
export const SEMESTRE_MINIMO = 1;
export const SEMESTRE_MAXIMO = 12;

export const RUTA_PERFIL = "/monitor/perfil";

export type CampoDelPerfil = "carrera" | "semestre" | "presentacion";

export type DatosDelPerfil = { carrera: string | null; semestre: number | null; presentacion: string | null };

export type ErroresDelPerfil = Partial<Record<CampoDelPerfil, string>>;

export const MENSAJE_CONTACTO =
  "No escribas teléfonos, correos ni enlaces: los estudiantes agendan contigo por Calibra. Si era un periodo, escríbelo con letras, por ejemplo de 2022 a 2023.";

export const MENSAJES = {
  carrera: `La carrera puede tener hasta ${LARGO_CARRERA} caracteres.`,
  semestre: `El semestre es un número entero del ${SEMESTRE_MINIMO} al ${SEMESTRE_MAXIMO}.`,
  presentacion: `La presentación puede tener hasta ${LARGO_PRESENTACION} caracteres.`,
} as const;

const largo = (texto: string) => [...texto].length;

/**
 * D-58 b: un teléfono (7 o más dígitos seguidos, aunque lleven espacios, puntos o guiones), una arroba o un enlace.
 * «2022-2023» cuenta como teléfono: el monitor lo escribe «de 2022 a 2023». La misma regla en SQL:
 * `!~ '[0-9]([ .-]*[0-9]){6,}'`, `strpos(..., '@') = 0` y `!~* '(://|www\.)'`.
 */
export function tieneContacto(texto: string): boolean {
  return /[0-9](?:[ .-]*[0-9]){6,}/.test(texto) || texto.includes("@") || /:\/\/|www\./i.test(texto);
}

// Caracteres de control; el salto de línea se trata aparte.
const CONTROL = /\p{Cc}/gu;

/** Carrera en una línea: espacios colapsados, sin caracteres de control. Vacía, `null`. */
export function normalizarCarrera(valor: unknown): string | null {
  const texto = String(valor ?? "")
    .replace(/\s+/g, " ")
    .replace(CONTROL, "")
    .trim();
  return texto || null;
}

/**
 * Presentación: CRLF a LF, cada línea recortada (sus espacios internos colapsados), las vacías fuera y sin caracteres
 * de control. Una línea es un párrafo. Vacía, `null`.
 */
export function normalizarPresentacion(valor: unknown): string | null {
  const lineas = String(valor ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((linea) => linea.replace(/\s+/g, " ").replace(CONTROL, "").trim())
    .filter(Boolean);
  return lineas.length ? lineas.join("\n") : null;
}

/** Los párrafos de una presentación guardada, uno por línea. */
export function parrafos(presentacion: string | null): string[] {
  return (presentacion ?? "").split("\n").filter((linea) => linea.trim() !== "");
}

/**
 * Los tres campos del formulario, normalizados y validados. Con errores no se guarda nada: el formulario los muestra
 * junto a cada campo y conserva lo escrito.
 */
export function leerPerfil(
  formulario: FormData,
): { ok: true; datos: DatosDelPerfil } | { ok: false; errores: ErroresDelPerfil } {
  const carrera = normalizarCarrera(formulario.get("carrera"));
  const presentacion = normalizarPresentacion(formulario.get("presentacion"));
  const semestreEscrito = String(formulario.get("semestre") ?? "").trim();
  const errores: ErroresDelPerfil = {};

  if (carrera && largo(carrera) > LARGO_CARRERA) errores.carrera = MENSAJES.carrera;
  else if (carrera && tieneContacto(carrera)) errores.carrera = MENSAJE_CONTACTO;

  let semestre: number | null = null;
  if (semestreEscrito) {
    semestre = /^\d{1,2}$/.test(semestreEscrito) ? Number(semestreEscrito) : NaN;
    if (!(semestre >= SEMESTRE_MINIMO && semestre <= SEMESTRE_MAXIMO)) errores.semestre = MENSAJES.semestre;
  }

  if (presentacion && largo(presentacion) > LARGO_PRESENTACION) errores.presentacion = MENSAJES.presentacion;
  else if (presentacion && tieneContacto(presentacion)) errores.presentacion = MENSAJE_CONTACTO;

  if (Object.keys(errores).length) return { ok: false, errores };
  return { ok: true, datos: { carrera, semestre, presentacion } };
}

/** «{carrera} · {n}.º semestre», o la parte que haya. `null` si no hay ninguna. */
export function lineaDeEstudios(perfil: Pick<DatosDelPerfil, "carrera" | "semestre">): string | null {
  const partes = [perfil.carrera, perfil.semestre ? `${perfil.semestre}.º semestre` : null].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}
