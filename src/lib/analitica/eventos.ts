/**
 * HU-108 (D-77 g): los eventos de Vercel Web Analytics. La tasa de conversión de la portada es `clic_cta_diagnostico` sobre
 * los visitantes únicos de `/`. Ningún evento lleva datos personales: solo dónde se hizo clic o la materia.
 *
 * HU-109 (D-78): los de monitores. `clic_ser_monitor` es la franja de la portada que lleva a `/quiero-ser-monitor`;
 * `clic_cta_ser_monitor`, cada «Quiero ser monitor» de esa landing, y `solicitud_monitor_enviada`, su conversión.
 */
export const EVENTOS = {
  clicCtaDiagnostico: "clic_cta_diagnostico",
  clicIniciarSesion: "clic_iniciar_sesion",
  diagnosticoTerminado: "diagnostico_terminado",
  contactoDejado: "contacto_dejado",
  clicSerMonitor: "clic_ser_monitor",
  clicCtaSerMonitor: "clic_cta_ser_monitor",
  solicitudMonitorEnviada: "solicitud_monitor_enviada",
} as const;

export type Evento = (typeof EVENTOS)[keyof typeof EVENTOS];

/** Dónde está el CTA que se tocó. */
export type UbicacionDelCta = "hero" | "pregunta" | "final" | "barra_movil";

/** Dónde está el «Quiero ser monitor» que se tocó en la landing de monitores. */
export type UbicacionDelCtaDeMonitor = "hero" | "final" | "barra_movil";

/** Propiedades de un evento: solo textos cortos o números, sin datos personales. */
export type PropiedadesDeEvento = Record<string, string | number>;
