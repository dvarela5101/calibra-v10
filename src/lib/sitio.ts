/**
 * HU-135: la dirección pública del sitio para lo que ve un buscador o una red social (`metadataBase`, `robots.txt`, `sitemap.xml`).
 * Sale de `SITIO_URL`, la misma variable que arma los enlaces de los correos (`urlDelSitio`). A diferencia de esa, aquí no se lanza
 * nada si falta: el build no debe caerse por una vista previa. Sin ella, en desarrollo se usa `http://localhost:3000`; en producción
 * se devuelve `null` (los llamadores omiten lo que necesita una URL absoluta y Next usa su respaldo para `metadataBase`).
 */
export function baseDelSitio(entorno: Record<string, string | undefined> = process.env): URL | null {
  const sitio = entorno.SITIO_URL?.trim();
  try {
    if (sitio) return new URL(sitio);
    if (entorno.NODE_ENV !== "production") return new URL("http://localhost:3000");
  } catch {
    // Un valor mal escrito se trata como ausente.
  }
  return null;
}

/** URL absoluta de una ruta del sitio, o `null` si no hay dirección pública. */
export function urlAbsoluta(ruta: string, entorno: Record<string, string | undefined> = process.env): string | null {
  const base = baseDelSitio(entorno);
  return base ? new URL(ruta, base).href : null;
}

/** Nombre, título y descripción del sitio para buscadores y vistas previas (HU-135). El título sale de la portada. */
export const NOMBRE_DEL_SITIO = "Calibra";
export const TITULO_DEL_SITIO = "Calibra · Monitorías de ciclo básico que empiezan por tu error";
export const DESCRIPCION_DEL_SITIO =
  "Un diagnóstico corto te dice en qué habilidad fallas y te conecta con un monitor certificado de tu materia.";
