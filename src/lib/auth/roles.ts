/** Roles que devuelve la función SQL public.mi_rol(). */
export type Rol = "admin" | "monitor" | "estudiante" | "anonimo";

/** Roles con panel propio, que entran con correo y contraseña por /ingresar. */
export type RolConPanel = "admin" | "monitor";

export const PANEL_POR_ROL: Record<RolConPanel, string> = {
  admin: "/admin",
  monitor: "/monitor",
};

const ROLES: readonly Rol[] = ["admin", "monitor", "estudiante", "anonimo"];

/** Valida lo que devuelve la base antes de confiar en él. */
export function comoRol(valor: unknown): Rol | null {
  return ROLES.includes(valor as Rol) ? (valor as Rol) : null;
}

export function tienePanel(rol: Rol | null): rol is RolConPanel {
  return rol === "admin" || rol === "monitor";
}

/**
 * A dónde mandar a alguien que pidió `ruta` y tiene `rol`.
 * null significa que puede quedarse.
 */
export function destinoPorRol(rolRequerido: RolConPanel, rol: Rol | null, ruta: string): string | null {
  if (rol === rolRequerido) return null;
  if (tienePanel(rol)) return PANEL_POR_ROL[rol];
  return `/ingresar?siguiente=${encodeURIComponent(ruta)}`;
}

/** Después de iniciar sesión: la ruta pedida si es del panel de su rol; si no, su panel. */
export function destinoTrasIngresar(rol: Rol | null, siguiente: string | null): string {
  if (!tienePanel(rol)) return "/";
  const panel = PANEL_POR_ROL[rol];
  if (siguiente && (siguiente === panel || siguiente.startsWith(`${panel}/`))) return siguiente;
  return panel;
}

/** Solo rutas internas: evita que ?siguiente= mande a otro sitio. */
export function rutaInternaSegura(ruta: string | null | undefined, porDefecto = "/"): string {
  if (!ruta || !ruta.startsWith("/") || ruta.startsWith("//") || ruta.includes("\\")) return porDefecto;
  return ruta;
}
