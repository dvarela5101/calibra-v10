/** Textos de la pantalla de error (HU-133), compartidos por `error.tsx` y `global-error.tsx`. Sin detalles técnicos. */
export const TEXTOS_DE_ERROR = {
  eyebrow: "Algo salió mal",
  titulo: "No pudimos mostrar esta página",
  subtitulo:
    "Fue un fallo de nuestra parte, no tuyo. Intenta de nuevo; si sigue pasando, vuelve al inicio y prueba en unos minutos.",
  reintentar: "Intentar de nuevo",
  inicio: "Ir al inicio",
} as const;

/** Lo único que se registra de un error: su `digest` (el mismo del registro del servidor), nunca el mensaje, que puede traer datos personales. */
export function datosDelRegistro(error: Error & { digest?: string }): { digest: string } {
  return { digest: error.digest ?? "sin-digest" };
}
