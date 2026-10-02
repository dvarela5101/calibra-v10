import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plantilla, Reconstruccion } from "@/lib/correo/plantillas";
import { enviarCorreoDesdeServidor, urlDelSitio, type EntradaDeEnvio, type ResultadoEnvio } from "@/lib/correo/servidor";
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuántas confirmaciones toma cada corrida. Lo normal es una por corrida: el trigger la pide al anotarla. */
export const LOTE_DE_CONFIRMACIONES = 10;

/**
 * La corrida deja de tomar confirmaciones pasado este tiempo, como los avisos de HU-051: un envío con el proveedor
 * caído puede tardar unos 32 s, y 20 s más ese envío caben en el límite de la función (60 s). Cortar a mitad de un
 * envío podría dejarlo `pendiente` aunque haya salido, y el reintento lo mandaría otra vez.
 */
export const PRESUPUESTO_DE_CORRIDA_MS = 20_000;

/** Corridas en las que una confirmación puede fallar antes de abandonarla, para que no tape a las demás. */
export const MAXIMO_DE_INTENTOS = 5;

const instanteIso = (valor: string): string => new Date(valor).toISOString();

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

export type ResumenDeConfirmaciones = {
  revisadas: number;
  enviadas: number;
  /** La confirmación ya no valía (la cita se canceló, ya empezó o no tiene a quién escribirle): no se manda. */
  descartadas: number;
  /** El correo falló y quedó `fallido` en `correo_envio`: lo reintenta HU-065 o lo ve el admin. */
  fallidas: number;
  /** Otra corrida lo estaba mandando (la clave del correo es única). */
  tomadasPorOtro: number;
  /** No se pudo procesar (error de la base o de los datos): se reintenta en otra corrida, hasta `MAXIMO_DE_INTENTOS`. */
  conError: number;
  /** Se acabó el presupuesto de tiempo: quedan para la próxima corrida. */
  pospuestas: number;
};

export type DependenciasDeConfirmaciones = {
  /** Con la llave secreta: `confirmacion_cita` solo la lee y la marca el servidor. */
  cliente: Cliente;
  enviar: <P extends Plantilla>(entrada: EntradaDeEnvio<P>) => Promise<ResultadoEnvio>;
  /** El reloj de la corrida, para el presupuesto de tiempo. */
  reloj: () => number;
};

type Confirmacion = { id: string; id_monitoria: string; intentos: number };

/**
 * Manda las confirmaciones pendientes (HU-019), de la más antigua a la más reciente. Cada una queda procesada
 * cuando su correo queda en `correo_envio` (enviado, o fallido para reintentar) o cuando ya no vale. Si no se
 * pudo procesar, suma un intento y se abandona al llegar a `MAXIMO_DE_INTENTOS`. Dos corridas a la vez no la
 * mandan dos veces: la clave del correo (`confirmacion_cita:<id_monitoria>`) es única.
 */
export async function procesarConfirmacionesDeCita(dependencias?: Partial<DependenciasDeConfirmaciones>): Promise<ResumenDeConfirmaciones> {
  const cliente = dependencias?.cliente ?? crearClienteAdmin();
  const enviar = dependencias?.enviar ?? enviarCorreoDesdeServidor;
  const reloj = dependencias?.reloj ?? Date.now;
  const inicio = reloj();
  const resumen: ResumenDeConfirmaciones = { revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 };

  const { data: confirmaciones, error } = await cliente
    .from("confirmacion_cita")
    .select("id, id_monitoria, intentos")
    .is("procesado_en", null)
    .order("creada_en")
    .limit(LOTE_DE_CONFIRMACIONES);
  if (error) throw new Error(`No se pudieron leer las confirmaciones: ${error.message}`);

  for (const confirmacion of confirmaciones ?? []) {
    resumen.revisadas++;
    if (reloj() - inicio >= PRESUPUESTO_DE_CORRIDA_MS) {
      resumen.pospuestas++;
      continue;
    }
    try {
      const correo = await reconstruirConfirmacionCita(confirmacion.id_monitoria, cliente);
      const resultado = correo && (await enviar({ plantilla: "confirmacion_cita", ...correo, entidad: confirmacion.id_monitoria }));
      if (!resultado) {
        resumen.descartadas++;
      } else if (resultado.ok) {
        resumen.enviadas++;
      } else if (resultado.motivo === "en_curso") {
        resumen.tomadasPorOtro++;
      } else if (resultado.motivo === "fallo_del_registro") {
        // Sin registro no hay reintento de HU-065: la confirmación vuelve a intentarse en otra corrida.
        throw new Error(resultado.error);
      } else {
        // Quedó `fallido` en el registro (o el correo del Lead no es un correo): HU-065 y la bandeja del admin.
        console.error(`[citas] la confirmación de la monitoría ${confirmacion.id_monitoria} no salió: ${resultado.error}`);
        resumen.fallidas++;
      }
      await marcar(cliente, confirmacion, { procesado_en: new Date().toISOString() });
    } catch (falla) {
      resumen.conError++;
      await sumarIntento(cliente, confirmacion, falla);
    }
  }
  return resumen;
}

async function marcar(cliente: Cliente, confirmacion: Confirmacion, cambios: { procesado_en?: string; intentos?: number }): Promise<void> {
  const { error } = await cliente.from("confirmacion_cita").update(cambios).eq("id", confirmacion.id);
  if (error) throw new Error(`No se pudo marcar la confirmación: ${error.message}`);
}

/** Suma un intento fallido; al llegar al máximo, abandona la confirmación (queda procesada y se avisa en el log). */
async function sumarIntento(cliente: Cliente, confirmacion: Confirmacion, falla: unknown): Promise<void> {
  const mensaje = falla instanceof Error ? falla.message : String(falla);
  const intentos = confirmacion.intentos + 1;
  const abandonar = intentos >= MAXIMO_DE_INTENTOS;
  console.error(
    `[citas] no se pudo procesar la confirmación de la monitoría ${confirmacion.id_monitoria} (intento ${intentos}${abandonar ? ", se abandona" : ""}): ${mensaje}`,
  );
  try {
    await marcar(cliente, confirmacion, abandonar ? { intentos, procesado_en: new Date().toISOString() } : { intentos });
  } catch (otra) {
    console.error("[citas] tampoco se pudo anotar el intento:", otra instanceof Error ? otra.message : otra);
  }
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
