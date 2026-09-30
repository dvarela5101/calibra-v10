import { protocoloAdmitido } from "./html";

/**
 * ¿Es esto un correo? Sirve para decidir si un contacto (que puede ser un correo o un teléfono,
 * RN-44) admite un mensaje por correo. Es deliberadamente simple: una sola arroba, sin espacios,
 * saltos de línea, comas, comillas ni paréntesis (nada que abra la puerta a inyectar destinatarios
 * o cabeceras) y un punto en el dominio. La entrega real la confirma el proveedor.
 */
const CORREO = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

const LARGO_MAXIMO = 254;

export function esCorreo(valor: string): boolean {
  return valor.length <= LARGO_MAXIMO && CORREO.test(valor);
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
