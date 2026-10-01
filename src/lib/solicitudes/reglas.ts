import { normalizarCorreo, normalizarTelefono } from "@/lib/leads/reglas";

/**
 * Solicitud de certificación del aspirante a monitor (HU-062, P-19): lectura del formulario y estados.
 * Todo aquí es puro. La autorización de datos la lee `leerConsentimiento` (HU-008); la base vuelve a
 * exigir cada dato (`*_solicitud_monitor.sql`).
 */

export type DatosDeSolicitud = {
  nombre: string;
  correo: string;
  /** Con indicativo, por ejemplo `+573001234567`. */
  numeroTelefono: string;
  /** Ids de las materias, sin repetir. */
  materias: string[];
};

export type Lectura<T> = { ok: true; datos: T } | { ok: false; error: string };

export const LARGO_MAXIMO_NOMBRE = 120;
export const MAXIMO_DE_MATERIAS = 20;

/** El nombre del campo de materias en el formulario: una casilla por materia, con su id como valor. */
export const CAMPO_MATERIAS = "materias";

/** Lo que ve el aspirante si envía sin marcar la autorización de datos (RN-13). */
export const ERROR_SIN_AUTORIZACION_ASPIRANTE = "Para enviar tu solicitud necesitamos tu autorización para tratar tus datos.";

/** El campo trampa: oculto para las personas; si llega con texto, lo llenó un programa. */
export const CAMPO_TRAMPA = "sitio_web";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Además de ser un correo, solo letras, dígitos y . _ % + ' - antes de la arroba y un dominio de letras,
 * dígitos, guiones y puntos. Así nada como ?, & o = se lee como parámetros en el enlace mailto: del panel
 * del admin. La base exige lo mismo (`solicitud_monitor_correo`).
 */
const CORREO_SEGURO = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Texto de una sola línea, sin espacios de sobra. */
const linea = (valor: FormDataEntryValue | null | undefined) => String(valor ?? "").replace(/\s+/g, " ").trim();

/** Lee y valida el formulario "Quiero ser monitor". Devuelve el primer error, en español y listo para mostrar. */
export function leerSolicitud(formulario: FormData): Lectura<DatosDeSolicitud> {
  const nombre = linea(formulario.get("nombre"));
  if (!nombre) return { ok: false, error: "Escribe tu nombre." };
  if (nombre.length > LARGO_MAXIMO_NOMBRE) return { ok: false, error: "Tu nombre es demasiado largo." };

  const correo = normalizarCorreo(formulario.get("correo"));
  if (!correo || !CORREO_SEGURO.test(correo)) return { ok: false, error: "Escribe un correo válido, por ejemplo ana@uniandes.edu.co." };

  const numeroTelefono = normalizarTelefono(formulario.get("numero_telefono"));
  if (numeroTelefono === null) return { ok: false, error: "Escribe tu teléfono: lo necesitamos para agendar tu evaluación." };
  if (numeroTelefono === undefined) {
    return { ok: false, error: "Escribe el teléfono con su indicativo, por ejemplo +57 300 123 4567." };
  }

  const elegidas = formulario.getAll(CAMPO_MATERIAS).map((valor) => String(valor).trim().toLowerCase());
  if (elegidas.some((id) => !UUID.test(id))) return { ok: false, error: "Alguna materia no es válida. Recarga la página." };
  const materias = [...new Set(elegidas)];
  if (materias.length === 0) return { ok: false, error: "Elige al menos una materia." };
  if (materias.length > MAXIMO_DE_MATERIAS) return { ok: false, error: `Elige como máximo ${MAXIMO_DE_MATERIAS} materias.` };

  return { ok: true, datos: { nombre, correo, numeroTelefono, materias } };
}

/** ¿Llenó un programa el campo trampa? Una persona no lo ve ni lo alcanza con el teclado. */
export function cayoEnLaTrampa(formulario: FormData): boolean {
  return String(formulario.get(CAMPO_TRAMPA) ?? "").trim() !== "";
}

/**
 * El enlace mailto: del correo de una solicitud. Todo va codificado salvo la arroba, así que ni un ? ni un %
 * del correo se leen como parámetros o como algo ya codificado, aunque la base dejara pasar uno.
 */
export function enlaceDeCorreo(correo: string): string {
  return `mailto:${encodeURIComponent(correo).replace(/%40/g, "@")}`;
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

export const ESTADOS_DE_SOLICITUD = ["nueva", "contactada", "evaluada", "descartada"] as const;
export type EstadoDeSolicitud = (typeof ESTADOS_DE_SOLICITUD)[number];

/** Los estados a los que el admin puede llevar una solicitud: volver a "nueva" no tiene sentido. */
export const ESTADOS_QUE_MARCA_EL_ADMIN = ["contactada", "evaluada", "descartada"] as const satisfies readonly EstadoDeSolicitud[];
export type EstadoQueMarcaElAdmin = (typeof ESTADOS_QUE_MARCA_EL_ADMIN)[number];

export const NOMBRE_DEL_ESTADO: Record<EstadoDeSolicitud, string> = {
  nueva: "Nueva",
  contactada: "Contactada",
  evaluada: "Evaluada",
  descartada: "Descartada",
};

/** El texto del botón con que el admin marca cada estado. */
export const ACCION_DEL_ESTADO: Record<EstadoQueMarcaElAdmin, string> = {
  contactada: "Marcar contactada",
  evaluada: "Marcar evaluada",
  descartada: "Descartar",
};

/** Lo que el admin lee después de marcar una solicitud. */
export const confirmacionDelEstado = (estado: EstadoQueMarcaElAdmin) => `Quedó como ${NOMBRE_DEL_ESTADO[estado].toLowerCase()}.`;

export type CambioDeEstado = { idSolicitud: string; estado: EstadoQueMarcaElAdmin };

/** Lee el cambio de estado que pide el admin (id de la solicitud y estado nuevo). */
export function leerCambioDeEstado(formulario: FormData): Lectura<CambioDeEstado> {
  const idSolicitud = String(formulario.get("id_solicitud") ?? "").trim().toLowerCase();
  if (!UUID.test(idSolicitud)) return { ok: false, error: "No encontramos esa solicitud. Recarga la página." };
  const estado = String(formulario.get("estado") ?? "");
  if (!(ESTADOS_QUE_MARCA_EL_ADMIN as readonly string[]).includes(estado)) {
    return { ok: false, error: "Ese estado no existe. Recarga la página." };
  }
  return { ok: true, datos: { idSolicitud, estado: estado as EstadoQueMarcaElAdmin } };
}

// ---------------------------------------------------------------------------
// Páginas de la lista del admin
// ---------------------------------------------------------------------------

export const SOLICITUDES_POR_PAGINA = 50;

/**
 * La página en que abre la lista del admin: la de la solicitud abierta más antigua, para que lo pendiente
 * quede a la vista. `antes` es cuántas van antes que ella en la lista; sin abiertas (`null`), la última.
 */
export function paginaDeInicio(antes: number | null, total: number, porPagina = SOLICITUDES_POR_PAGINA): number {
  if (antes === null) return Math.max(1, Math.ceil(total / porPagina));
  return Math.floor(antes / porPagina) + 1;
}

/** El número de página de la dirección (`?pagina=3`). Lo que no sea un entero positivo razonable es la primera. */
export function leerPagina(valor: string | string[] | undefined): number {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return texto && /^[1-9][0-9]{0,5}$/.test(texto) ? Number(texto) : 1;
}
