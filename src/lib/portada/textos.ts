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

/** HU-109: el beneficio de la landing de monitores sobre las cancelaciones (RN-60). */
export function textoDelBeneficioDeCancelarParaMonitor(p: ParametrosNegocio | null): string {
  return p
    ? `Una individual se cancela hasta ${horas(p.cancelacionIndividualMin)} antes; una grupal, hasta ${horas(p.cancelacionGrupalMin)}.`
    : "Cada monitoría tiene un plazo para cancelar, y después de él ya no se cancela.";
}

/** HU-109: «¿Cuándo y cómo me pagan?» (RN-80, RN-83). */
export function respuestaDePagoAlMonitor(p: ParametrosNegocio | null): string {
  const desde = p
    ? `El pago sale a partir de ${horas(p.desembolsoMin)} después de que termina la sesión.`
    : "El pago sale cuando termina el plazo del estudiante para reportar si no llegaste.";
  return `Por cada monitoría realizada, Calibra te transfiere a tu llave. ${desde}`;
}

/** HU-109: «¿Qué pasa si un estudiante cancela?» (RN-60). */
export function respuestaDeCancelarParaMonitor(p: ParametrosNegocio | null): string {
  const plazos = p
    ? `Una individual se puede cancelar hasta ${horas(p.cancelacionIndividualMin)} antes y una grupal hasta ${horas(p.cancelacionGrupalMin)}.`
    : "Cada monitoría tiene un plazo para cancelar.";
  return `${plazos} Después de eso no se cancela, salvo casos extremos que revisa Calibra.`;
}

/**
 * HU-109: «¿Y las sesiones grupales?» (RN-35, RN-51). No promete el diagnóstico de cada integrante: el monitor solo ve el
 * diagnóstico de las individuales (HU-022, `diagnostico_de_mi_monitoria`).
 */
export function respuestaDeGrupalesParaMonitor(p: ParametrosNegocio | null): string {
  const antelacion = p ? `, con ${horas(p.antelacionGrupalMin)} de antelación` : "";
  return `Un estudiante con cuenta puede organizar una grupal en uno de tus horarios${antelacion}, y cada integrante paga su parte.`;
}

/** «¿Necesito crear una cuenta?» */
export function respuestaDeCuenta(p: ParametrosNegocio | null): string {
  const grupal = p ? `, con ${horas(p.antelacionGrupalMin)} de antelación` : "";
  return `No para el diagnóstico ni para agendar una sesión individual. Solo si quieres organizar una sesión grupal${grupal}.`;
}
