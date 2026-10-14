/**
 * El cuerpo de una respuesta que vigila una e2e (HU-011), o "" si no llega.
 *
 * Una recarga o una navegación corta a medias las peticiones que la página que se deja tenía en el aire (los prefetch de sus
 * enlaces), y entonces `response.text()` de Playwright no devuelve ni falla. Sin tope, `Promise.all` sobre esos cuerpos esperaba
 * hasta el timeout de la prueba (tres minutos) y recién entonces la prueba seguía, con la página ya cerrada. Lo que una
 * navegación cortó el navegador no lo recibió, así que se descarta; quien use esto lo acompaña con un control positivo (que
 * el HTML que importa sí se leyó) para que descartar no deje la comprobación vacía.
 *
 * Solo pide `text()`: lo usa Playwright con su `Response` y Vitest con un invento.
 */

/** Lo más que se espera el cuerpo de una respuesta antes de darla por cortada. */
export const TOPE_DEL_CUERPO_MS = 5_000;

export function cuerpoDe(respuesta: { text(): Promise<string> }, tope: number = TOPE_DEL_CUERPO_MS): Promise<string> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const corte = new Promise<string>((resolver) => {
    temporizador = setTimeout(() => resolver(""), tope);
  });
  // `text()` rechaza con «No resource with given identifier» cuando la respuesta ya no existe: también se descarta.
  return Promise.race([respuesta.text().catch(() => ""), corte]).finally(() => clearTimeout(temporizador));
}
