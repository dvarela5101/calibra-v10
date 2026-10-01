/**
 * El equipo de admins (HU-054): ordenarlo y desactivar a uno. Aquí va lo puro: quién sigue en el turno y si se
 * puede desactivar. La base decide lo mismo al reasignar (`privado.siguiente_admin_activo`, P-44).
 */

export type MiembroDelEquipo = {
  id: string;
  nombre: string;
  correo: string;
  ordenRevision: number;
  activo: boolean;
  /** Reembolsos activos y reportes en revisión a su nombre: pasan al siguiente si se desactiva (P-44). */
  casosAbiertos: number;
};

/**
 * RN-07: el admin activo que sigue a uno dado en el orden de revisión, volviendo al primero al pasar el último y
 * saltándose a los inactivos. Nunca el mismo. `null` si no hay otro activo.
 */
export function siguienteActivo(equipo: MiembroDelEquipo[], idDado: string): MiembroDelEquipo | null {
  const dado = equipo.find((m) => m.id === idDado);
  const activos = equipo.filter((m) => m.activo && m.id !== idDado).sort((a, b) => a.ordenRevision - b.ordenRevision);
  if (!dado) return activos[0] ?? null;
  return activos.find((m) => m.ordenRevision > dado.ordenRevision) ?? activos[0] ?? null;
}

export type MotivoParaNoDesactivar = "propio" | "no_encontrado" | "ya_inactivo" | "ultimo_activo";

/**
 * ¿Se puede desactivar a este admin? Nadie se desactiva a sí mismo (perdería el acceso a mitad de la acción) y el
 * equipo nunca se queda sin admins activos: nadie podría revisar pagos ni volver a activar a nadie.
 */
export function motivoParaNoDesactivar(equipo: MiembroDelEquipo[], idPropio: string, idObjetivo: string): MotivoParaNoDesactivar | null {
  if (idObjetivo === idPropio) return "propio";
  const objetivo = equipo.find((m) => m.id === idObjetivo);
  if (!objetivo) return "no_encontrado";
  if (!objetivo.activo) return "ya_inactivo";
  if (!siguienteActivo(equipo, idObjetivo)) return "ultimo_activo";
  return null;
}

export const MENSAJES_PARA_NO_DESACTIVAR: Record<MotivoParaNoDesactivar, string> = {
  propio: "No puedes desactivarte a ti mismo. Pídeselo a otro admin.",
  no_encontrado: "No encontramos a ese admin en el equipo.",
  ya_inactivo: "Ese admin ya estaba desactivado.",
  ultimo_activo: "Es el único admin activo: el equipo no puede quedarse sin admins.",
};

export const RESULTADOS_DE_MOVER = ["movido", "en_el_borde", "no_encontrado", "sin_permiso"] as const;
export type ResultadoDeMover = (typeof RESULTADOS_DE_MOVER)[number];

export function esResultadoDeMover(valor: unknown): valor is ResultadoDeMover {
  return typeof valor === "string" && (RESULTADOS_DE_MOVER as readonly string[]).includes(valor);
}

export type Direccion = "arriba" | "abajo";

export function esDireccion(valor: unknown): valor is Direccion {
  return valor === "arriba" || valor === "abajo";
}

/** Qué se le dice al admin cuando el orden no cambió. */
export const MENSAJES_DE_MOVER: Record<Exclude<ResultadoDeMover, "movido">, string> = {
  en_el_borde: "Ese admin ya está en el borde de la lista.",
  no_encontrado: "No encontramos a ese admin en el equipo.",
  sin_permiso: "Solo un admin activo cambia el orden.",
};

/** Cómo se cuentan los casos abiertos en la pantalla. */
export function textoDeCasos(casos: number): string {
  if (casos === 0) return "Sin casos abiertos";
  return casos === 1 ? "1 caso abierto" : `${casos} casos abiertos`;
}
