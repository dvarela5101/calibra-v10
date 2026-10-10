import { dibujarTexto } from "./dibujar";

/**
 * Un texto del banco de preguntas con sus fórmulas y su código dibujados (HU-083). Es el mismo componente para un enunciado,
 * una opción, un texto de error, una solución o una descripción. Sirve desde un componente de servidor o de cliente.
 *
 * Con bloques de código devuelve un `div`, que no cabe en un `p` ni en un `label`; sin ellos, un `span`. Todo el dibujo vive en
 * `dibujar.ts` (ahí están las reglas).
 */
export function TextoDelBanco({ texto, className }: { texto: string | null | undefined; className?: string }) {
  return dibujarTexto(texto, className);
}
