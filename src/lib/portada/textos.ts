import type { ParametrosNegocio } from "@/lib/plazos/parametros";

/**
 * HU-108: los textos de la portada que citan plazos. Los plazos no se escriben a mano: llegan de `parametros_negocio()`
 * (RN-35, RN-60, RN-62). Si no se pudieron leer, el texto los omite en lugar de inventarlos.
 */

const horas = (minutos: number) => {
  const h = Math.round(minutos / 60);
  return `${h} ${h === 1 ? "hora" : "horas"}`;
};

/** El beneficio de cancelar a tiempo. */
export function textoDelBeneficioDeCancelar(p: ParametrosNegocio | null): string {
  return p
    ? `Cancelas hasta ${horas(p.cancelacionIndividualMin)} antes y te devolvemos todo.`
    : "Si cancelas a tiempo, te devolvemos todo.";
}

/** «¿Y si tengo que cancelar?» */
export function respuestaDeCancelar(p: ParametrosNegocio | null): string {
  if (!p) {
    return "Si cancelas dentro del plazo que dice tu cita, te devolvemos todo. Si el monitor no llega, lo reportas y revisamos el caso.";
  }
  return (
    `Cancelas hasta ${horas(p.cancelacionIndividualMin)} antes de una sesión individual, o ${horas(p.cancelacionGrupalMin)} ` +
    `antes de una grupal, y te devolvemos todo. Si el monitor no llega, lo reportas hasta ${horas(p.reporteInasistenciaMin)} ` +
    "después y revisamos el caso."
  );
}

/** «¿Necesito crear una cuenta?» */
export function respuestaDeCuenta(p: ParametrosNegocio | null): string {
  const grupal = p ? `, con ${horas(p.antelacionGrupalMin)} de antelación` : "";
  return `No para el diagnóstico ni para agendar una sesión individual. Solo si quieres organizar una sesión grupal${grupal}.`;
}
