/**
 * HU-108 (D-77 g): los eventos de Vercel Web Analytics. La tasa de conversión de la portada es `clic_cta_diagnostico` sobre
 * los visitantes únicos de `/`. Ningún evento lleva datos personales: solo dónde se hizo clic o la materia.
 */
export const EVENTOS = {
  clicCtaDiagnostico: "clic_cta_diagnostico",
  clicIniciarSesion: "clic_iniciar_sesion",
  diagnosticoTerminado: "diagnostico_terminado",
  contactoDejado: "contacto_dejado",
} as const;

export type Evento = (typeof EVENTOS)[keyof typeof EVENTOS];

/** Dónde está el CTA que se tocó. */
export type UbicacionDelCta = "hero" | "pregunta" | "final" | "barra_movil";

/** Propiedades de un evento: solo textos cortos o números, sin datos personales. */
export type PropiedadesDeEvento = Record<string, string | number>;
