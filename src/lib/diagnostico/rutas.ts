/**
 * Las direcciones del diagnóstico de la persona (HU-009). Sin `server-only` ni React: las usan las páginas, las acciones, el
 * componente del resultado y las pruebas.
 */

const RUTA_DIAGNOSTICO = "/diagnostico";

/** El selector de materia y el recorrido de preguntas. */
export function rutaDeDiagnostico(): string {
  return RUTA_DIAGNOSTICO;
}

/** El resultado de un diagnóstico terminado, que sigue ahí al recargar. `id` es el `idDiagnostico` del en curso. */
export function rutaDeResultado(id: string): string {
  return `${RUTA_DIAGNOSTICO}/resultado/${id}`;
}

/** HU-031: el enlace del correo de recuperación, que se abre sin sesión desde cualquier dispositivo. */
export function rutaDeResultados(token: string): string {
  return `/resultados?token=${encodeURIComponent(token)}`;
}
