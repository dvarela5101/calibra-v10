import { protocoloAdmitido } from "./html";

/**
 * La regla de correo de todo Calibra (HU-070). Antes de la arroba, solo letras, dígitos y `. _ % + ' -`; después,
 * etiquetas de letras, dígitos y guiones separadas por puntos, con al menos un punto y ninguna vacía (`a@x..co` y
 * `a@.x.co` no valen). Es estricta a propósito: un `?`, `&`, `=`, `#` o `/` en un correo, puesto en un enlace
 * `mailto:`, se lee como copia oculta, cuerpo del mensaje u otro destinatario, y en una cabecera abre la puerta a
 * inyectar destinatarios. Quedan fuera las direcciones válidas pero raras (con `!`, `&`, `*`...) y las de dominio
 * con tildes o ñ. La base exige lo mismo con `privado.es_correo_seguro()`, la misma expresión: `contacto.test.ts`
 * comprueba que no se separen.
 *
 * Mayúsculas y minúsculas valen igual: quien guarda un correo (Leads, invitaciones, solicitudes) lo pasa antes a
 * minúsculas y la base lo exige aparte en esas tablas, pero `enviarCorreo` y `CORREO_DATOS_PERSONALES` validan el
 * texto tal como llega, y `ANA@Uniandes.EDU.CO` es una dirección real.
 */
export const PATRON_DE_CORREO = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export const LARGO_MAXIMO = 254;

/**
 * ¿Es esto un correo? Sirve para decidir si un contacto (que puede ser un correo o un teléfono, RN-44) admite un
 * mensaje por correo. No recorta nada: un espacio o un salto de línea de más lo vuelve inválido. La entrega real la
 * confirma el proveedor.
 */
export function esCorreo(valor: string): boolean {
  return valor.length <= LARGO_MAXIMO && PATRON_DE_CORREO.test(valor);
}

/**
 * URL absoluta a una ruta del sitio, para los enlaces de los correos. `sitio` es la dirección pública
 * (por ejemplo `https://calibra.example`); `ruta` empieza por `/` y puede traer consulta o ancla.
 * El resultado tiene que quedarse en el mismo origen que `sitio`: una ruta como `/\otro.sitio` o con una
 * tabulación entre las barras la leen los navegadores como otro host, y aquí se rechaza. Los mensajes de
 * error no repiten la ruta: puede traer un token.
 */
export function enlaceAbsoluto(sitio: string, ruta: string, entorno: Record<string, string | undefined> = process.env): string {
  if (!ruta.startsWith("/") || ruta.startsWith("//")) {
    throw new RangeError("La ruta debe empezar por una sola barra.");
  }
  const base = new URL(sitio);
  if (!protocoloAdmitido(base, entorno)) {
    throw new RangeError(
      base.protocol === "http:" ? "En producción el sitio debe ser https." : `El sitio debe ser http o https (llegó "${sitio}").`,
    );
  }
  const url = new URL(ruta, base);
  if (url.origin !== base.origin) throw new RangeError("La ruta debe quedarse en el sitio.");
  return url.href;
}

/**
 * URL pública de una ruta del sitio, con la dirección que diga `SITIO_URL`. En producción es
 * obligatoria y https: un enlace a localhost en un correo real no le sirve a nadie, y uno http deja
 * viajar el token en claro. En desarrollo, sin ella se usa `http://localhost:3000`.
 */
export function urlDelSitio(ruta: string, entorno: Record<string, string | undefined> = process.env): string {
  const sitio = entorno.SITIO_URL?.trim();
  if (sitio) return enlaceAbsoluto(sitio, ruta, entorno);
  if (entorno.NODE_ENV === "production") {
    throw new Error("Falta SITIO_URL: los enlaces de los correos necesitan la dirección pública del sitio.");
  }
  return enlaceAbsoluto("http://localhost:3000", ruta, entorno);
}
