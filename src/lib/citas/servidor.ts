import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LOTE_POR_DEFECTO,
  MAXIMO_DE_INTENTOS,
  PRESUPUESTO_DE_CORRIDA_MS,
  procesarBandeja,
  type DefinicionDeBandeja,
  type DependenciasDeBandeja,
  type ResumenDeBandeja,
} from "@/lib/correo/bandeja";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { urlDelSitio } from "@/lib/correo/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import {
  citaDeFila,
  confirmacionVigente,
  datosDeConfirmacion,
  ESTADOS_DE_CITA,
  rutaDeCita,
  tieneFormaDeTokenDeCita,
  type Cita,
  type DatosDeConfirmacionCita,
} from "./reglas";

type Cliente = SupabaseClient<Database>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuántas confirmaciones toma cada corrida. Lo normal es una por corrida: el trigger la pide al anotarla. */
export const LOTE_DE_CONFIRMACIONES = LOTE_POR_DEFECTO;

// El presupuesto de la corrida y el máximo de intentos viven en `procesarBandeja`; se reexportan porque las pruebas los importan de aquí.
export { MAXIMO_DE_INTENTOS, PRESUPUESTO_DE_CORRIDA_MS };

export const instanteIso = (valor: string): string => new Date(valor).toISOString();

/** Los datos del correo de una monitoría, con la llave secreta. `null` si la monitoría no tiene confirmación anotada. */
async function leerDatos(cliente: Cliente, idMonitoria: string): Promise<DatosDeConfirmacionCita | null> {
  const { data, error } = await cliente.rpc("datos_de_confirmacion_cita", { p_id_monitoria: idMonitoria });
  if (error) throw new Error(`No se pudieron leer los datos de la confirmación: ${error.message}`);
  const fila = data?.[0];
  if (!fila) return null;
  const estado = ESTADOS_DE_CITA.find((e) => e === fila.estado);
  if (!estado) throw new Error(`Estado de la cita desconocido: ${fila.estado}`);
  return {
    token: fila.token,
    // Siempre en ISO: el cuerpo del correo no puede cambiar entre un envío y su reintento.
    creadaEn: instanteIso(fila.creada_en),
    estado,
    grupal: fila.grupal,
    correoDestino: fila.correo_destino,
    nombreLead: fila.nombre_lead,
    nombreMonitor: fila.nombre_monitor,
    nombreMateria: fila.nombre_materia,
    inicio: instanteIso(fila.inicio),
    duracionMin: fila.duracion_min,
    presencial: fila.presencial,
    lugar: fila.lugar,
    enlace: fila.enlace,
    valorTotal: fila.valor_total,
    cancelableHasta: instanteIso(fila.cancelable_hasta),
  };
}

/**
 * Para mandar o reintentar el correo de confirmación (HU-065). La entidad es el id de la monitoría. Es `null` si
 * la monitoría no tiene confirmación anotada o ya no vale: la cita ya no está confirmada (el admin rechazó el pago),
 * ya empezó o es grupal. También si no hay a quién escribirle (D-19: el correo del Lead o, si no tiene, el del
 * primer pago). El enlace de gestión es siempre el mismo token (D-20).
 */
export async function reconstruirConfirmacionCita(
  idMonitoria: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"confirmacion_cita"> | null> {
  if (!UUID.test(idMonitoria)) return null;
  const d = await leerDatos(cliente, idMonitoria);
  // Sin datos es raro: la confirmación solo existe si la monitoría tiene monitor, materia, franja y Lead. Se deja rastro.
  if (!d) {
    console.warn(`[citas] la monitoría ${idMonitoria} no tiene los datos de la confirmación: no se manda.`);
    return null;
  }
  if (!confirmacionVigente(d, new Date())) return null;
  const destinatario = d.correoDestino?.trim();
  if (!destinatario) {
    console.warn(`[citas] la monitoría ${idMonitoria} no tiene un correo al que confirmarla: no se manda.`);
    return null;
  }
  return { destinatario, datos: datosDeConfirmacion(d, urlDelSitio(rutaDeCita(d.token))) };
}

/** El resumen que comparten las confirmaciones, las cancelaciones, los pedidos de llave y los avisos de rechazo. */
export type ResumenDeConfirmaciones = ResumenDeBandeja;

export type DependenciasDeConfirmaciones = DependenciasDeBandeja;

type Confirmacion = { id: string; id_monitoria: string; intentos: number };

const BANDEJA = {
  prefijo: "citas",
  tabla: "confirmacion_cita",
  lote: LOTE_DE_CONFIRMACIONES,
  lectura: { columnas: "id, id_monitoria, intentos", orden: "creada_en" },
  textos: { leer: "No se pudieron leer las confirmaciones", marcar: "No se pudo marcar la confirmación" },
  nombrar: (confirmacion) => `la confirmación de la monitoría ${confirmacion.id_monitoria}`,
  mandar: async (confirmacion, { cliente, enviar }) => {
    const correo = await reconstruirConfirmacionCita(confirmacion.id_monitoria, cliente);
    return correo && enviar({ plantilla: "confirmacion_cita", ...correo, entidad: confirmacion.id_monitoria });
  },
} satisfies DefinicionDeBandeja<Confirmacion>;

/**
 * Manda las confirmaciones pendientes (HU-019) con `procesarBandeja`, de la más antigua a la más reciente. Dos corridas
 * a la vez no la mandan dos veces: la clave del correo (`confirmacion_cita:<id_monitoria>`) es única.
 */
export function procesarConfirmacionesDeCita(dependencias?: Partial<DependenciasDeConfirmaciones>): Promise<ResumenDeConfirmaciones> {
  return procesarBandeja(BANDEJA, dependencias);
}

// ---------------------------------------------------------------------------
// Las tres puertas de la página: el token del correo y la sesión del Lead (criterios 2 a 4)
// ---------------------------------------------------------------------------

/**
 * La cita a la que pertenece el token del correo (HU-019, D-20), para la página. `null` si el token no tiene forma
 * de token o no existe: la página responde igual a las dos y no muestra nada de ninguna cita (criterio 3). Con la
 * llave secreta: el token es la credencial y la base no lo expone. Abrirlo no liga el navegador al Lead.
 */
export async function leerCitaPorToken(token: string): Promise<Cita | null> {
  if (!tieneFormaDeTokenDeCita(token)) return null;
  const { data, error } = await crearClienteAdmin().rpc("cita_por_token", { p_token: token });
  // El mensaje del error no lleva el token: una falla de la base no deja una credencial en el log.
  if (error) throw new Error(`No se pudo leer la cita: ${error.message}`);
  const fila = data?.[0];
  return fila ? citaDeFila(fila) : null;
}

/**
 * Una cita del Lead de la sesión (criterio 4: el mismo navegador con el que agendó, sin el enlace), o `null` si no
 * existe o no es suya. Con la sesión de quien mira, sin la llave secreta: la base exige que la cita sea de su Lead.
 */
export async function leerMiCita(cliente: Cliente, idMonitoria: string): Promise<Cita | null> {
  if (!UUID.test(idMonitoria)) return null;
  const { data, error } = await cliente.rpc("mi_cita", { p_id_monitoria: idMonitoria });
  if (error) throw new Error(`No se pudo leer la cita: ${error.message}`);
  const fila = data?.[0];
  return fila ? citaDeFila(fila) : null;
}

/**
 * Las citas del Lead de la sesión: individuales, sin reservas por pagar ni vencidas, por fecha de inicio de la más
 * reciente a la más antigua (el orden lo da la base). Con la sesión de quien mira, sin la llave secreta. Vacía si la
 * sesión no tiene Lead.
 */
export async function leerMisCitas(cliente: Cliente): Promise<Cita[]> {
  const { data, error } = await cliente.rpc("mis_citas");
  if (error) throw new Error(`No se pudieron leer las citas: ${error.message}`);
  return (data ?? []).map(citaDeFila);
}
