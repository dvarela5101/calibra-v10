import { RUTA_DE_CITAS } from "@/lib/citas/reglas";
import { PANEL_POR_ROL, tienePanel, type Rol } from "./roles";

export const RUTA_DE_INGRESO = "/ingresar";
export const RUTA_DE_REGISTRO = "/registrarse";

export type EnlaceDeAcceso = { texto: string; href: string; principal: boolean };

/**
 * D-75 a: lo que la cabecera de las pantallas del visitante ofrece según quién mira. Sin cuenta (sin sesión o con la
 * anónima del diagnóstico), «Iniciar sesión» y «Registrarse»; con cuenta, un solo enlace a lo suyo.
 */
export function enlacesDeAcceso(rol: Rol | null): EnlaceDeAcceso[] {
  if (tienePanel(rol)) return [{ texto: "Mi panel", href: PANEL_POR_ROL[rol], principal: false }];
  if (rol === "estudiante") return [{ texto: "Mis citas", href: RUTA_DE_CITAS, principal: false }];
  return [
    { texto: "Iniciar sesión", href: RUTA_DE_INGRESO, principal: false },
    { texto: "Registrarse", href: RUTA_DE_REGISTRO, principal: true },
  ];
}

/**
 * D-77 a (HU-108): en la landing de la portada, quien no tiene cuenta ve solo «Iniciar sesión» (`/ingresar` enlaza el
 * registro), para no competir con el único CTA. Con cuenta, lo mismo que en las demás pantallas.
 */
export function enlacesDeAccesoDeLaPortada(rol: Rol | null): EnlaceDeAcceso[] {
  return enlacesDeAcceso(rol).filter((enlace) => enlace.href !== RUTA_DE_REGISTRO);
}
