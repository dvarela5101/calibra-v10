"use server";

import { EVENTOS } from "@/lib/analitica/eventos";
import { registrarEventoDelServidor } from "@/lib/analitica/servidor";
import { leerConsentimiento } from "@/lib/privacidad/consentimiento";
import { CASILLA_TRATAMIENTO, MARCADA } from "@/lib/privacidad/consentimiento";
import {
  CAMPO_MATERIAS,
  CAMPO_OTRA,
  CAMPO_OTRA_MATERIA,
  ERROR_SIN_AUTORIZACION_ASPIRANTE,
  cayoEnLaTrampa,
  leerSolicitud,
} from "@/lib/solicitudes/reglas";
import { crearSolicitudMonitor } from "@/lib/solicitudes/servidor";

/**
 * HU-062 (P-19): el aspirante a monitor deja sus datos y las materias en las que quiere certificarse.
 * `valores` devuelve lo escrito para no vaciar el formulario tras un error; con `enviada` la página
 * cambia el formulario por la confirmación.
 */
/** Lo escrito, para no vaciar el formulario tras un error; `autorizado` y `otra` mantienen marcadas sus casillas. */
export type ValoresDeSolicitud = {
  nombre: string;
  correo: string;
  numero_telefono: string;
  materias: string[];
  otra: boolean;
  otra_materia: string;
  autorizado: boolean;
};
export type EstadoSolicitud = { error: string | null; enviada: boolean; valores: ValoresDeSolicitud };

const valoresDe = (datos: FormData): ValoresDeSolicitud => ({
  nombre: String(datos.get("nombre") ?? ""),
  correo: String(datos.get("correo") ?? ""),
  numero_telefono: String(datos.get("numero_telefono") ?? ""),
  materias: datos.getAll(CAMPO_MATERIAS).map(String),
  otra: datos.get(CAMPO_OTRA) !== null,
  otra_materia: String(datos.get(CAMPO_OTRA_MATERIA) ?? ""),
  autorizado: datos.get(CASILLA_TRATAMIENTO) === MARCADA,
});

const VACIOS: ValoresDeSolicitud = { nombre: "", correo: "", numero_telefono: "", materias: [], otra: false, otra_materia: "", autorizado: false };

export async function enviarSolicitud(_anterior: EstadoSolicitud, datos: FormData): Promise<EstadoSolicitud> {
  const valores = valoresDe(datos);
  const fallo = (error: string): EstadoSolicitud => ({ error, enviada: false, valores });

  // Un programa que llenó el campo trampa recibe la misma respuesta que una persona, sin que se guarde nada.
  if (cayoEnLaTrampa(datos)) return { error: null, enviada: true, valores: VACIOS };

  // Nada se guarda si falta un dato, el correo no sirve o no hay autorización (criterio 2).
  const lectura = leerSolicitud(datos);
  if (!lectura.ok) return fallo(lectura.error);
  const consentimiento = leerConsentimiento(datos);
  if (!consentimiento.ok) return fallo(ERROR_SIN_AUTORIZACION_ASPIRANTE);

  let resultado;
  try {
    resultado = await crearSolicitudMonitor(lectura.datos, consentimiento.consentimiento.fecha_consentimiento);
  } catch (error) {
    console.error("[solicitudes] no se pudo guardar la solicitud:", error instanceof Error ? error.message : "error sin mensaje");
    return fallo("No pudimos guardar tu solicitud. Intenta de nuevo.");
  }
  if (!resultado.ok) return fallo(resultado.error);

  // HU-109: la conversión de la landing de monitores, sin datos personales.
  await registrarEventoDelServidor(EVENTOS.solicitudMonitorEnviada, { materias: lectura.datos.materias.length });
  return { error: null, enviada: true, valores: VACIOS };
}
