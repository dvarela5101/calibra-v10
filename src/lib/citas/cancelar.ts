import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { enviarCorreoDesdeServidor, urlDelSitio } from "@/lib/correo/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import {
  cancelacionDeEstudiante,
  cancelacionVigente,
  datosDeCancelacion,
  esResultadoDeCancelar,
  type DatosDeCancelacionCita,
  type LlaveDeCancelacion,
  type ResultadoDeCancelar,
} from "./cancelar-reglas";
import { ESTADOS_DE_CITA, MOTIVOS_DE_CANCELACION, tieneFormaDeTokenDeCita, type MotivoDeCancelacion } from "./reglas";
import { instanteIso, MAXIMO_DE_INTENTOS, PRESUPUESTO_DE_CORRIDA_MS, UUID, type DependenciasDeConfirmaciones, type ResumenDeConfirmaciones } from "./servidor";

type Cliente = SupabaseClient<Database>;

/** Cuántas cancelaciones toma cada corrida. Lo normal es una por corrida: la base la pide al anotarla. */
export const LOTE_DE_CANCELACIONES = 10;

// ---------------------------------------------------------------------------
// Las dos puertas de la cancelación: el token del correo y la sesión del Lead (criterios 1 y 3)
// ---------------------------------------------------------------------------

/** El resultado de la base, o un error si responde algo que no conoce (la página no puede decidir con eso). */
function resultadoDe(data: unknown): ResultadoDeCancelar {
  if (!esResultadoDeCancelar(data)) throw new Error(`Respuesta inesperada al cancelar la cita: ${JSON.stringify(data ?? null)}`);
  return data;
}

/**
 * Cancela la cita a la que pertenece el token del correo de confirmación (HU-019, D-20). Con la llave secreta: el
 * token es la credencial y la base no lo expone; solo `service_role` puede llamar a `public.cancelar_cita_por_token`.
 * Un valor sin forma de token es `no_existe` sin consultar la base. La hora y todo lo demás lo decide la base.
 */
export async function cancelarCitaPorToken(token: string): Promise<ResultadoDeCancelar> {
  if (!tieneFormaDeTokenDeCita(token)) return "no_existe";
  const { data, error } = await crearClienteAdmin().rpc("cancelar_cita_por_token", { p_token: token });
  // El mensaje del error no lleva el token: una falla de la base no deja una credencial en el log.
  if (error) throw new Error(`No se pudo cancelar la cita: ${error.message}`);
  return resultadoDe(data);
}

/**
 * Cancela una cita del Lead de la sesión (el mismo navegador con el que agendó, sin el enlace). Con la sesión de
 * quien mira, sin la llave secreta: la base exige que la cita sea de su Lead y, si no, responde `no_existe`. Un id
 * que no es un uuid es `no_existe` sin consultar.
 */
export async function cancelarMiCita(cliente: Cliente, idMonitoria: string): Promise<ResultadoDeCancelar> {
  if (!UUID.test(idMonitoria)) return "no_existe";
  const { data, error } = await cliente.rpc("cancelar_mi_cita", { p_id_monitoria: idMonitoria });
  if (error) throw new Error(`No se pudo cancelar la cita: ${error.message}`);
  return resultadoDe(data);
}

// ---------------------------------------------------------------------------
// El correo de cancelación (D-27)
// ---------------------------------------------------------------------------

/** Los datos del correo de una monitoría, con la llave secreta. `null` si la monitoría no tiene cancelación anotada. */
async function leerDatos(cliente: Cliente, idMonitoria: string): Promise<DatosDeCancelacionCita | null> {
  const { data, error } = await cliente.rpc("datos_de_cancelacion_cita", { p_id_monitoria: idMonitoria });
  if (error) throw new Error(`No se pudieron leer los datos de la cancelación: ${error.message}`);
  const fila = data?.[0];
  if (!fila) return null;
  const estado = ESTADOS_DE_CITA.find((e) => e === fila.estado);
  if (!estado) throw new Error(`Estado de la cita desconocido: ${fila.estado}`);
  // El tipo generado dice que el motivo siempre viene, pero una cita no cancelada no lo tiene.
  let motivo: MotivoDeCancelacion | null = null;
  if (fila.motivo_cancelacion != null) {
    motivo = MOTIVOS_DE_CANCELACION.find((m) => m === fila.motivo_cancelacion) ?? null;
    if (!motivo) throw new Error(`Motivo de cancelación desconocido: ${fila.motivo_cancelacion}`);
  }
  return {
    // Siempre en ISO: el cuerpo del correo no puede cambiar entre un envío y su reintento.
    creadaEn: instanteIso(fila.creada_en),
    correoDestino: fila.correo_destino ?? null,
    conPagoEnRevision: fila.con_pago_en_revision,
    reembolsoAOtroContacto: fila.reembolso_a_otro_contacto,
    estado,
    motivo,
    grupal: fila.grupal,
    nombreLead: fila.nombre_lead,
    nombreMateria: fila.nombre_materia,
    inicio: instanteIso(fila.inicio),
    tokenCita: fila.token_cita ?? null,
  };
}

/** Los reembolsos que este correo le pide al Lead: monto y token de su página de llave, en el orden en que se generaron. */
async function leerLlaves(cliente: Cliente, idMonitoria: string): Promise<LlaveDeCancelacion[]> {
  const { data, error } = await cliente.rpc("llaves_de_cancelacion", { p_id_monitoria: idMonitoria });
  // El mensaje del error no lleva los tokens: una falla de la base no deja una credencial en el log.
  if (error) throw new Error(`No se pudieron leer las llaves de la cancelación: ${error.message}`);
  return (data ?? []).map((fila) => ({ idReembolso: fila.id_reembolso, monto: fila.monto, token: fila.token }));
}

/**
 * Para mandar o reintentar el correo de cancelación (HU-065). La entidad es el id de la monitoría. Es `null` si la
 * monitoría no tiene cancelación anotada o ya no vale: no está cancelada por el estudiante o es grupal. También si
 * no hay a quién escribirle (D-19: el correo del Lead o, si no tiene, el del primer pago). Los reembolsos que pide
 * el correo y los avisos salen de lo anotado al cancelar, así que el reintento da el mismo cuerpo y los mismos
 * enlaces (D-27).
 */
export async function reconstruirCancelacionCita(
  idMonitoria: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"cancelacion_cita"> | null> {
  if (!UUID.test(idMonitoria)) return null;
  const d = await leerDatos(cliente, idMonitoria);
  // Sin datos es raro: la cancelación solo existe si la monitoría tiene materia, franja y Lead. Se deja rastro.
  if (!d) {
    console.warn(`[citas] la monitoría ${idMonitoria} no tiene los datos de la cancelación: no se manda.`);
    return null;
  }
  if (!cancelacionVigente(d)) {
    // La cancelación vale pero no hay a quién escribirle: se deja rastro, como en la confirmación.
    if (cancelacionDeEstudiante(d)) {
      console.warn(`[citas] la monitoría ${idMonitoria} no tiene un correo al que avisarle la cancelación: no se manda.`);
    }
    return null;
  }
  const llaves = await leerLlaves(cliente, idMonitoria);
  return { destinatario: d.correoDestino.trim(), datos: datosDeCancelacion(d, llaves, urlDelSitio) };
}

/** El mismo resumen que las confirmaciones: cada correo termina enviado, descartado, fallido, tomado por otro o con error. */
export type ResumenDeCancelaciones = ResumenDeConfirmaciones;

/** Las mismas dependencias que las confirmaciones: `cancelacion_cita` también la lee y la marca solo el servidor. */
export type DependenciasDeCancelaciones = DependenciasDeConfirmaciones;

type Cancelacion = { id: string; id_monitoria: string; intentos: number };

/**
 * Manda los correos de cancelación pendientes (HU-024), de la más antigua a la más reciente. Funciona como
 * `procesarConfirmacionesDeCita`: cada una queda procesada cuando su correo queda en `correo_envio` (enviado, o
 * fallido para reintentar) o cuando ya no vale; si no se pudo procesar, suma un intento y se abandona al llegar a
 * `MAXIMO_DE_INTENTOS`. Dos corridas a la vez no la mandan dos veces: la clave del correo
 * (`cancelacion_cita:<id_monitoria>`) es única.
 */
export async function procesarCancelacionesDeCita(dependencias?: Partial<DependenciasDeCancelaciones>): Promise<ResumenDeCancelaciones> {
  const cliente = dependencias?.cliente ?? crearClienteAdmin();
  const enviar = dependencias?.enviar ?? enviarCorreoDesdeServidor;
  const reloj = dependencias?.reloj ?? Date.now;
  const inicio = reloj();
  const resumen: ResumenDeCancelaciones = { revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 };

  const { data: cancelaciones, error } = await cliente
    .from("cancelacion_cita")
    .select("id, id_monitoria, intentos")
    .is("procesado_en", null)
    .order("creada_en")
    .limit(LOTE_DE_CANCELACIONES);
  if (error) throw new Error(`No se pudieron leer las cancelaciones: ${error.message}`);

  for (const cancelacion of cancelaciones ?? []) {
    resumen.revisadas++;
    if (reloj() - inicio >= PRESUPUESTO_DE_CORRIDA_MS) {
      resumen.pospuestas++;
      continue;
    }
    try {
      const correo = await reconstruirCancelacionCita(cancelacion.id_monitoria, cliente);
      const resultado = correo && (await enviar({ plantilla: "cancelacion_cita", ...correo, entidad: cancelacion.id_monitoria }));
      if (!resultado) {
        resumen.descartadas++;
      } else if (resultado.ok) {
        resumen.enviadas++;
      } else if (resultado.motivo === "en_curso") {
        resumen.tomadasPorOtro++;
      } else if (resultado.motivo === "fallo_del_registro") {
        // Sin registro no hay reintento de HU-065: la cancelación vuelve a intentarse en otra corrida.
        throw new Error(resultado.error);
      } else {
        // Quedó `fallido` en el registro (o el correo del Lead no es un correo): HU-065 y la bandeja del admin.
        console.error(`[citas] la cancelación de la monitoría ${cancelacion.id_monitoria} no salió: ${resultado.error}`);
        resumen.fallidas++;
      }
      await marcar(cliente, cancelacion, { procesado_en: new Date().toISOString() });
    } catch (falla) {
      resumen.conError++;
      await sumarIntento(cliente, cancelacion, falla);
    }
  }
  return resumen;
}

async function marcar(cliente: Cliente, cancelacion: Cancelacion, cambios: { procesado_en?: string; intentos?: number }): Promise<void> {
  const { error } = await cliente.from("cancelacion_cita").update(cambios).eq("id", cancelacion.id);
  if (error) throw new Error(`No se pudo marcar la cancelación: ${error.message}`);
}

/** Suma un intento fallido; al llegar al máximo, abandona la cancelación (queda procesada y se avisa en el log). */
async function sumarIntento(cliente: Cliente, cancelacion: Cancelacion, falla: unknown): Promise<void> {
  const mensaje = falla instanceof Error ? falla.message : String(falla);
  const intentos = cancelacion.intentos + 1;
  const abandonar = intentos >= MAXIMO_DE_INTENTOS;
  console.error(
    `[citas] no se pudo procesar la cancelación de la monitoría ${cancelacion.id_monitoria} (intento ${intentos}${abandonar ? ", se abandona" : ""}): ${mensaje}`,
  );
  try {
    await marcar(cliente, cancelacion, abandonar ? { intentos, procesado_en: new Date().toISOString() } : { intentos });
  } catch (otra) {
    console.error("[citas] tampoco se pudo anotar el intento:", otra instanceof Error ? otra.message : otra);
  }
}
