import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

/*
 * Filtro de privacidad del monitoreo de errores (HU-138). Funciones puras, sin importar el SDK de Sentry (solo sus tipos):
 * `beforeSend` y `beforeBreadcrumb` las usan antes de que algo salga de la app, y `filtro.test.ts` las comprueba.
 *
 * Quita de los mensajes y de las URL lo que identifica a una persona o da acceso a algo: correos, teléfonos, números largos
 * (documentos, llaves de pago), llaves y tokens, la cadena de consulta (`?token_hash=...`) y los ids de las rutas.
 * Es mejor pasarse de estricto que dejar salir un dato: un mensaje con un número largo pierde ese número, y ya.
 */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const LLAVE_DE_SUPABASE = /\bsb_(?:secret|publishable)_[\w-]+/g;
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi;
const CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Llave de pago en texto: lo que sigue a «llave:» o a «llave =», y las llaves alfanuméricas que empiezan por @. */
const LLAVE_DE_PAGO = /\bllave\b\s*[:=]\s*\S+/gi;
const LLAVE_ALFANUMERICA = /(^|[\s"'(])@[\w.-]{3,}/g;
/** Cadenas largas con algún dígito (hashes, tokens opacos, ids de otros servicios). */
const TOKEN_OPACO = /\b(?=[\w-]*\d)[A-Za-z0-9_-]{32,}\b/g;
/** Teléfonos con separadores o con indicativo: +57 300 123 4567, 300-123-4567, (601) 234 5678. */
const TELEFONO = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,3}\)?[\s.-]\d{3}[\s.-]\d{3,4}\b|\+\d{1,3}[\s.-]?\d{7,}/g;
/** Cualquier número de 7 dígitos o más: celulares sin separadores, documentos, llaves numéricas, marcas de tiempo. */
const NUMERO_LARGO = /\d{7,}/g;
/** Una URL o ruta con su cadena de consulta o fragmento: se conserva hasta el `?` o el `#`. */
const CONSULTA_O_FRAGMENTO = /((?:https?:\/\/|\/)[^\s?#"'<>]*)[?#][^\s"'<>]*/g;

/** Quita los datos personales y los secretos de un texto libre (mensaje de error, nombre de transacción, migas de pan). */
export function limpiarTexto(texto: string): string {
  return texto
    .replace(CONSULTA_O_FRAGMENTO, "$1")
    .replace(UUID, "[id]")
    .replace(JWT, "[token]")
    .replace(LLAVE_DE_SUPABASE, "[llave]")
    .replace(BEARER, "$1 [token]")
    .replace(CORREO, "[correo]")
    .replace(LLAVE_DE_PAGO, "llave: [llave]")
    .replace(LLAVE_ALFANUMERICA, "$1[llave]")
    .replace(TOKEN_OPACO, "[token]")
    .replace(TELEFONO, "[teléfono]")
    .replace(NUMERO_LARGO, "[número]");
}

const SEGMENTO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un segmento de ruta: un id o algo que parece un dato personal se reemplaza; el resto (`/admin`, `/reserva`) se conserva. */
function limpiarSegmento(segmento: string): string {
  let decodificado = segmento;
  try {
    decodificado = decodeURIComponent(segmento);
  } catch {
    // se queda como vino
  }
  if (SEGMENTO_UUID.test(decodificado)) return ":id";
  return limpiarTexto(decodificado) === decodificado ? segmento : ":dato";
}

/**
 * Deja de una URL solo el origen y la ruta: sin cadena de consulta, fragmento ni credenciales, y con los ids de la ruta
 * reemplazados por `:id`. Acepta rutas relativas (`/pagos/<uuid>?x=1`).
 */
export function limpiarUrl(url: string): string {
  let origen = "";
  let ruta: string;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(url)) {
    try {
      const analizada = new URL(url);
      origen = `${analizada.protocol}//${analizada.host}`;
      ruta = analizada.pathname;
    } catch {
      return "[url]";
    }
  } else {
    ruta = url.split(/[?#]/, 1)[0];
  }
  return origen + ruta.split("/").map(limpiarSegmento).join("/");
}

/** `beforeBreadcrumb`: limpia las URL y los mensajes de las migas de pan (fetch, navegación) y descarta el resto de sus datos. */
export function filtrarMigaDePan(miga: Breadcrumb): Breadcrumb | null {
  // El texto de la consola es libre: puede traer cualquier dato que alguien haya registrado.
  if (miga.category === "console") return null;
  const limpia: Breadcrumb = { ...miga };
  if (limpia.message) limpia.message = limpiarTexto(limpia.message);
  if (miga.data) {
    const data: Record<string, unknown> = {};
    for (const clave of ["url", "from", "to"] as const) {
      const valor = miga.data[clave];
      if (typeof valor === "string") data[clave] = limpiarUrl(valor);
    }
    for (const clave of ["method", "status_code", "reason"] as const) {
      if (clave in miga.data) data[clave] = miga.data[clave];
    }
    limpia.data = data;
  }
  return limpia;
}

/**
 * `beforeSend`: lo último que pasa por un evento antes de salir. Conserva el tipo de error, el mensaje limpio, la pila, el
 * método y la ruta sin consulta, el entorno y la versión. Quita usuario, cookies, cabeceras, cuerpo, IP y la cadena de consulta.
 */
export function filtrarEvento<T extends ErrorEvent>(evento: T): T {
  delete evento.user;
  if (evento.request) {
    const { method, url } = evento.request;
    evento.request = { ...(method ? { method } : {}), ...(url ? { url: limpiarUrl(url) } : {}) };
  }
  if (evento.message) evento.message = limpiarTexto(evento.message);
  if (evento.transaction) evento.transaction = limpiarTexto(evento.transaction);
  for (const excepcion of evento.exception?.values ?? []) {
    if (excepcion.value) excepcion.value = limpiarTexto(excepcion.value);
  }
  if (evento.breadcrumbs) {
    evento.breadcrumbs = evento.breadcrumbs.flatMap((miga) => filtrarMigaDePan(miga) ?? []);
  }
  const contextoNext = evento.contexts?.nextjs;
  if (contextoNext && typeof contextoNext.request_path === "string") {
    contextoNext.request_path = limpiarUrl(contextoNext.request_path);
  }
  // Nada de datos libres que el código o un SDK hayan agregado: el diagnóstico sale de la pila, la ruta y el digest.
  delete evento.extra;
  return evento;
}
