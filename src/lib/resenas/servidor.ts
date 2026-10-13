import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LOTE_POR_DEFECTO,
  MAXIMO_DE_INTENTOS,
  PRESUPUESTO_DE_CORRIDA_MS,
  procesarBandeja,
  type DefinicionDeBandeja,
  type DependenciasDeBandeja,
  type ResumenDeBandejaConEspera,
} from "@/lib/correo/bandeja";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { urlDelSitio } from "@/lib/correo/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import { datosDeResenaIndividual, rutaDeResena, tieneFormaDeTokenDeResena, type DatosDeInvitacion, type EstadoDeResena } from "./reglas";

type Cliente = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuántas invitaciones toma cada corrida. Lo normal es una por corrida: el trigger la pide al anotarla. */
export const LOTE_DE_INVITACIONES = LOTE_POR_DEFECTO;

// El presupuesto de la corrida y el máximo de intentos viven en `procesarBandeja`; se reexportan porque las pruebas los importan de aquí.
export { MAXIMO_DE_INTENTOS, PRESUPUESTO_DE_CORRIDA_MS };

/** Los datos del correo de un pago, con la llave secreta. `null` si el pago no tiene invitación. */
async function leerDatos(cliente: Cliente, idPago: string): Promise<DatosDeInvitacion | null> {
  const { data, error } = await cliente.rpc("datos_de_invitacion_resena", { p_id_pago: idPago });
  if (error) throw new Error(`No se pudieron leer los datos de la invitación: ${error.message}`);
  const fila = data?.[0];
  if (!fila) return null;
  return {
    token: fila.token,
    disponible: fila.disponible,
    correoLead: fila.correo_lead,
    nombreLead: fila.nombre_lead,
    nombreMonitor: fila.nombre_monitor,
  };
}

/**
 * Para mandar o reintentar el correo de la reseña (HU-065). La entidad es el id del pago. Es `null` si el pago no
 * tiene invitación o ya no se puede reseñar (la reseña ya se dejó, o el pago se rechazó después de anotarla).
 */
export async function reconstruirInvitacionResena(
  idPago: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"resena_individual"> | null> {
  if (!UUID.test(idPago)) return null;
  const d = await leerDatos(cliente, idPago);
  // Sin datos es raro: la invitación solo existe si el pago tiene monitoría, monitor y Lead. Se deja rastro.
  if (!d) console.warn(`[resenas] el pago ${idPago} no tiene los datos de la invitación: no se manda.`);
  return d?.disponible ? { destinatario: d.correoLead, datos: datosDeResenaIndividual(d, urlDelSitio(rutaDeResena(d.token))) } : null;
}

/** El resumen de las otras bandejas, más las invitaciones que esperan a que se decida un reporte (HU-080, D-40). */
export type ResumenDeInvitaciones = ResumenDeBandejaConEspera;

export type DependenciasDeInvitaciones = DependenciasDeBandeja;

type Invitacion = { id: string; id_pago: string; intentos: number };

/** ¿La invitación sigue sin procesar y su monitoría tiene un reporte de inasistencia abierto? (HU-080) */
async function invitacionEnEspera(cliente: Cliente, idPago: string): Promise<boolean> {
  const { data, error } = await cliente.rpc("invitacion_resena_en_espera", { p_id_pago: idPago });
  if (error) throw new Error(`No se pudo saber si la invitación está en espera: ${error.message}`);
  return data === true;
}

const BANDEJA = {
  prefijo: "resenas",
  tabla: "invitacion_resena",
  lote: LOTE_DE_INVITACIONES,
  // Sin las que están en espera por un reporte abierto: las excluye la base (HU-080).
  lectura: { leer: (cliente, lote) => cliente.rpc("invitaciones_resena_por_procesar", { p_limite: lote }) },
  textos: { leer: "No se pudieron leer las invitaciones", marcar: "No se pudo marcar la invitación" },
  nombrar: (invitacion) => `la invitación del pago ${invitacion.id_pago}`,
  mandar: async (invitacion, { cliente, enviar }) => {
    const correo = await reconstruirInvitacionResena(invitacion.id_pago, cliente);
    return correo && enviar({ plantilla: "resena_individual", ...correo, entidad: invitacion.id_pago });
  },
  // Un reporte abierto que llegó después del listado no descarta la invitación: queda para cuando se decida.
  enEspera: (invitacion, cliente) => invitacionEnEspera(cliente, invitacion.id_pago),
} satisfies DefinicionDeBandeja<Invitacion>;

/**
 * Manda las invitaciones pendientes (HU-035) con `procesarBandeja`, de la más antigua a la más reciente. Las que tienen
 * un reporte abierto se saltan (HU-080). Dos corridas a la vez no lo mandan dos veces: la clave del correo
 * (`resena_individual:<id_pago>`) es única.
 */
export function procesarInvitacionesResena(dependencias?: Partial<DependenciasDeInvitaciones>): Promise<ResumenDeInvitaciones> {
  return procesarBandeja(BANDEJA, dependencias);
}

const ESTADOS: readonly EstadoDeResena[] = ["disponible", "ya_resenada", "con_reporte", "no_disponible"];

export type ResenaPorToken = { estado: EstadoDeResena; nombreMonitor: string; nombreMateria: string; inicio: string };

/**
 * Lo que muestra la página del enlace (HU-035): si se puede reseñar y de qué monitoría. `null` si el token no
 * tiene forma de token o no existe. Con la llave secreta: el token es la credencial y la base no lo expone.
 */
export async function leerResenaPorToken(token: string): Promise<ResenaPorToken | null> {
  if (!tieneFormaDeTokenDeResena(token)) return null;
  const { data, error } = await crearClienteAdmin().rpc("resena_por_token", { p_token: token });
  if (error) throw new Error(`No se pudo leer la reseña: ${error.message}`);
  const fila = data?.[0];
  if (!fila) return null;
  const estado = ESTADOS.find((e) => e === fila.estado);
  if (!estado) throw new Error(`Estado de reseña desconocido: ${fila.estado}`);
  return { estado, nombreMonitor: fila.nombre_monitor, nombreMateria: fila.nombre_materia, inicio: new Date(fila.inicio).toISOString() };
}

export type ResultadoDeResena = "registrada" | "ya_resenada" | "con_reporte" | "no_disponible" | "no_existe";

const RESULTADOS: readonly ResultadoDeResena[] = ["registrada", "ya_resenada", "con_reporte", "no_disponible", "no_existe"];

/**
 * Guarda la reseña del pago al que pertenece el token (RN-70). La base vuelve a revisar todo con el pago
 * bloqueado, así que dos envíos a la vez dejan una sola reseña. La calificación y el comentario vienen ya
 * validados (`validarResena`); la base los revisa otra vez con sus `check`.
 */
export async function registrarResena(token: string, calificacion: number, comentario: string | null): Promise<ResultadoDeResena> {
  if (!tieneFormaDeTokenDeResena(token)) return "no_existe";
  const { data, error } = await crearClienteAdmin().rpc("registrar_resena", {
    p_token: token,
    p_calificacion: calificacion,
    // La RPC recibe texto: vacío equivale a sin comentario (como `registrar_lead` con el teléfono).
    p_comentario: comentario ?? "",
  });
  if (error) throw new Error(`No se pudo registrar la reseña: ${error.message}`);
  const resultado = RESULTADOS.find((r) => r === data);
  if (!resultado) throw new Error(`Respuesta desconocida al registrar la reseña: ${String(data)}`);
  return resultado;
}
