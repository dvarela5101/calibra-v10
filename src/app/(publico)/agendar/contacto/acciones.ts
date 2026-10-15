"use server";

import { redirect } from "next/navigation";
import { procesarContacto, type EstadoContacto } from "@/lib/leads/dejar-contacto";
import { rutaSiguiente } from "@/lib/leads/reglas";

/**
 * HU-068 (D-3): el visitante deja su contacto al agendar y queda como Lead. Sigue a la ruta que trae el formulario, y el
 * enlace de verificación (P-23) lleva a esa misma ruta.
 */
export async function dejarContacto(_anterior: EstadoContacto, datos: FormData): Promise<EstadoContacto> {
  const siguiente = rutaSiguiente(datos.get("siguiente"));
  const estado = await procesarContacto(datos, { siguienteDeVerificacion: siguiente });
  if ("listo" in estado) redirect(siguiente);
  return estado;
}
