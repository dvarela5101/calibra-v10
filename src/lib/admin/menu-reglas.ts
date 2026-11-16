/** HU-137: las secciones del menú del panel del admin y cuál de ellas es la actual según la ruta. */

export type SeccionDelMenu = {
  /** Ruta de la sección. */
  href: string;
  /** Texto del enlace del menú. */
  etiqueta: string;
  /** Otras rutas bajo `/admin` que cuentan como esta sección, porque se abren desde ella. */
  tambien?: readonly string[];
};

/**
 * Las secciones, en el orden del menú. La bandeja es el origen de las páginas de pagos, reembolsos, desembolsos y reportes
 * (se abren desde sus tarjetas y filas), así que esas rutas la dejan marcada.
 */
export const SECCIONES_DEL_MENU: readonly SeccionDelMenu[] = [
  { href: "/admin", etiqueta: "Bandeja", tambien: ["/admin/pagos", "/admin/reembolsos", "/admin/desembolsos", "/admin/reportes"] },
  { href: "/admin/citas", etiqueta: "Citas" },
  { href: "/admin/monitores", etiqueta: "Monitores" },
  { href: "/admin/certificados", etiqueta: "Certificados" },
  { href: "/admin/materias", etiqueta: "Materias" },
  { href: "/admin/franjas", etiqueta: "Franjas" },
  { href: "/admin/solicitudes", etiqueta: "Solicitudes" },
  { href: "/admin/leads", etiqueta: "Leads" },
  { href: "/admin/equipo", etiqueta: "Equipo" },
];

const cubre = (base: string, ruta: string) => ruta === base || ruta.startsWith(`${base}/`);

/**
 * La ruta (`href`) de la sección del menú a la que pertenece `pathname`, o null si no es de ninguna. Cuenta la ruta exacta y
 * cualquier subruta (`/admin/citas/123` es Citas); `/admin` solo cuenta tal cual, porque toda página del panel cuelga de ella.
 * Ignora la barra final y distingue `/admin/citasX` de `/admin/citas`.
 */
export function seccionActual(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const ruta = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const seccion of SECCIONES_DEL_MENU) {
    if (ruta === seccion.href) return seccion.href;
    if (seccion.href !== "/admin" && cubre(seccion.href, ruta)) return seccion.href;
    if (seccion.tambien?.some((otra) => cubre(otra, ruta))) return seccion.href;
  }
  return null;
}
