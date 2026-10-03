/**
 * Reportar que el monitor no asistió (HU-029, RN-62, RN-83). Aquí va lo puro: los resultados que devuelve la base y
 * qué se le dice a la persona con cada uno. Si cabe o no reportar lo decide la base en una sola transacción
 * (`privado.reportar_inasistencia`, con la hora de la base y el borde inclusivo de P-40): nada de eso se recalcula
 * aquí. El reporte lo revisa un admin (HU-030) y mientras tanto el desembolso queda suspendido por la propia
 * existencia del reporte.
 *
 * Nada de esto muestra cifras de comisión ni el contacto del monitor (P-37).
 */

/** Lo que responden `public.reportar_inasistencia_por_token` y `public.reportar_inasistencia_de_mi_cita`. */
export const RESULTADOS_DE_REPORTAR = [
  "reportada",
  "ya_reportada",
  "aun_no_empieza",
  "fuera_de_ventana",
  "no_reportable",
  "no_individual",
  "sin_admin",
  "no_existe",
] as const;
export type ResultadoDeReportar = (typeof RESULTADOS_DE_REPORTAR)[number];

export function esResultadoDeReportar(valor: unknown): valor is ResultadoDeReportar {
  return typeof valor === "string" && (RESULTADOS_DE_REPORTAR as readonly string[]).includes(valor);
}

const MENSAJES: Record<Exclude<ResultadoDeReportar, "reportada" | "ya_reportada" | "sin_admin">, string> = {
  aun_no_empieza: "La monitoría todavía no empieza. Puedes reportar que el monitor no llegó desde su hora de inicio.",
  fuera_de_ventana: "Ya pasó el plazo para reportar que el monitor no llegó.",
  no_reportable: "Esta monitoría ya no se puede reportar.",
  no_individual: "Las monitorías grupales todavía no se reportan desde esta página.",
  // No distingue "no existe" de "es de otra persona": no revela qué citas existen.
  no_existe: "No encontramos esta monitoría. Solo quien la agendó puede reportar.",
};

/**
 * Qué se le dice a la persona con cada resultado. `reportada` y `ya_reportada` no llevan mensaje (`null`): la página
 * ya muestra el estado del reporte. Con `sin_admin` (nadie del equipo puede recibir el reporte ahora) se le ofrece el
 * correo de Calibra si se conoce; puede reintentar.
 */
export function mensajeDeReportar(resultado: ResultadoDeReportar, correoDeContacto: string | null = null): string | null {
  switch (resultado) {
    case "reportada":
    case "ya_reportada":
      return null;
    case "sin_admin": {
      const base = "No pudimos recibir tu reporte en este momento. Intenta de nuevo en unos minutos";
      const correo = correoDeContacto?.trim();
      return correo ? `${base} o escríbenos a ${correo}.` : `${base}.`;
    }
    default:
      return MENSAJES[resultado];
  }
}
