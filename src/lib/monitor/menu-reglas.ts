/** HU-123: las secciones del menú fijo del monitor y cuál de ellas es la actual según la ruta. */

export type SeccionDelMenu = {
  /** Ruta de la sección. */
  href: string;
  /** Texto del enlace del menú: corto y distinto del de las tarjetas del panel («Mi agenda», «Mis franjas»...). */
  etiqueta: string;
  /** Solo la ve un monitor con al menos un certificado: sin él esas pantallas no tienen qué mostrar. */
  exigeCertificado?: boolean;
  /** Otras rutas bajo `/monitor` que cuentan como esta sección, porque se abren desde ella. */
  tambien?: readonly string[];
};

const cubre = (base: string, ruta: string) => ruta === base || ruta.startsWith(`${base}/`);

/**
 * Las secciones, en el orden del menú. D-94 c (HU-140): las franjas se ven y se abren en el calendario de Inicio, así que
 * «Franjas» ya no está en el menú y `/monitor/franjas` (la lista, el formulario y cada franja) deja marcado Inicio.
 */
export const SECCIONES_DEL_MENU: readonly SeccionDelMenu[] = [
  { href: "/monitor", etiqueta: "Inicio", tambien: ["/monitor/franjas"] },
  { href: "/monitor/agenda", etiqueta: "Agenda", exigeCertificado: true },
  { href: "/monitor/desembolsos", etiqueta: "Pagos", exigeCertificado: true },
  { href: "/monitor/perfil", etiqueta: "Perfil" },
];

/** Las secciones que le tocan a un monitor: sin certificados, solo Inicio y Perfil. */
export function seccionesPara(conCertificados: boolean): readonly SeccionDelMenu[] {
  return SECCIONES_DEL_MENU.filter((seccion) => conCertificados || !seccion.exigeCertificado);
}

/**
 * La ruta (`href`) de la sección del menú a la que pertenece `pathname`, o null si no es de ninguna. Cuenta la ruta exacta y
 * cualquier subruta (`/monitor/agenda/123` es Agenda); `/monitor` solo cuenta tal cual, porque toda página del panel cuelga de
 * ella. Ignora la barra final y distingue `/monitor/agendaX` de `/monitor/agenda`.
 */
export function seccionActual(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const ruta = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const seccion of SECCIONES_DEL_MENU) {
    if (ruta === seccion.href) return seccion.href;
    if (seccion.href !== "/monitor" && ruta.startsWith(`${seccion.href}/`)) return seccion.href;
    if (seccion.tambien?.some((otra) => cubre(otra, ruta))) return seccion.href;
  }
  return null;
}
