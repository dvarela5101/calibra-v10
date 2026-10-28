"use server";

import { redirect } from "next/navigation";
import { EVENTOS } from "@/lib/analitica/eventos";
import { registrarEventoDelServidor } from "@/lib/analitica/servidor";
import { esUuid } from "@/lib/diagnostico/reglas";
import { procesarContacto, type EstadoContacto } from "@/lib/leads/dejar-contacto";

/** A dónde lleva el enlace de verificación cuando el correo ya es de otro Lead (D-68 c): a agendar, no al resultado. */
const SIGUIENTE_DE_VERIFICACION = "/agendar";

/**
 * HU-010 (D-3): el visitante deja su contacto debajo de su resultado y queda como Lead, con los diagnósticos de su sesión
 * (`registrar_lead`). Al guardar vuelve a su resultado, que ya muestra «Ya tenemos tu contacto».
 */
export async function dejarContactoDelDiagnostico(_anterior: EstadoContacto, datos: FormData): Promise<EstadoContacto> {
  const idDiagnostico = String(datos.get("id_diagnostico") ?? "");
  const estado = await procesarContacto(datos, { siguienteDeVerificacion: SIGUIENTE_DE_VERIFICACION });
  if ("listo" in estado) {
    // HU-108: el último paso del embudo de la portada. Sin datos de la persona.
    await registrarEventoDelServidor(EVENTOS.contactoDejado, { desde: "diagnostico" });
    redirect(esUuid(idDiagnostico) ? `/diagnostico/resultado/${idDiagnostico}` : SIGUIENTE_DE_VERIFICACION);
  }
  return estado;
}
