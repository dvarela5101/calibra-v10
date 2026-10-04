"use server";

import { tieneFormaDeTokenDeResena, validarResena } from "@/lib/resenas/reglas";
import { registrarResena } from "@/lib/resenas/servidor";

/**
 * HU-035: resultado de calificar. `pendiente` es el formulario (con su error de validación, si lo hay);
 * los demás sustituyen al formulario por un mensaje. `valores` devuelve lo escrito para no vaciar los campos.
 */
export type EstadoResena = {
  resultado: "pendiente" | "registrada" | "ya_resenada" | "con_reporte" | "no_disponible" | "no_existe";
  error: string | null;
  valores: { calificacion: string; comentario: string };
};

export async function calificar(_anterior: EstadoResena, datos: FormData): Promise<EstadoResena> {
  const valores = {
    calificacion: String(datos.get("calificacion") ?? ""),
    comentario: String(datos.get("comentario") ?? ""),
  };
  const estado = (resultado: EstadoResena["resultado"], error: string | null = null): EstadoResena => ({ resultado, error, valores });

  const token = datos.get("token");
  if (typeof token !== "string" || !tieneFormaDeTokenDeResena(token)) return estado("no_existe");

  const validada = validarResena(datos);
  if (!validada.ok) return estado("pendiente", validada.error);

  try {
    return estado(await registrarResena(token, validada.calificacion, validada.comentario));
  } catch (error) {
    // Nunca se le muestra un error técnico: al log va solo el mensaje, sin el token.
    console.error("[resenas] no se pudo registrar la reseña:", error instanceof Error ? error.message : "error desconocido");
    return estado("pendiente", "No pudimos guardar tu calificación. Intenta de nuevo.");
  }
}
