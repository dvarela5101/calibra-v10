import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plantilla, Reconstruccion } from "@/lib/correo/plantillas";
import { enviarCorreoDesdeServidor, urlDelSitio, type EntradaDeEnvio, type ResultadoEnvio } from "@/lib/correo/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import {
  avisoVigente,
  datosDeCancelada,
  datosDeConfirmada,
  datosDePagoRechazado,
  esEventoDeAviso,
  RUTA_DE_LA_AGENDA,
  type DatosDeAviso,
  type EventoDeAviso,
} from "./reglas";

type Cliente = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuántos avisos toma cada corrida. Lo normal es uno por corrida: el trigger la pide al anotarlo. */
export const LOTE_DE_AVISOS = 10;

/**
 * La corrida deja de tomar avisos pasado este tiempo, como los reintentos de HU-065: un envío con el proveedor caído
 * puede tardar unos 32 s, y 20 s más ese envío caben en el límite de la función (60 s). Cortar a mitad de un envío
 * podría dejarlo `pendiente` aunque haya salido, y el reintento lo mandaría otra vez.
 */
export const PRESUPUESTO_DE_CORRIDA_MS = 20_000;

/** Corridas en las que un aviso puede fallar antes de abandonarlo, para que no tape a los demás. */
export const MAXIMO_DE_INTENTOS = 5;

/** Los datos del correo de una monitoría, con la llave secreta. `null` si la monitoría ya no existe. */
async function leerDatos(cliente: Cliente, idMonitoria: string): Promise<DatosDeAviso | null> {
  const { data, error } = await cliente.rpc("datos_de_aviso_monitor", { p_id_monitoria: idMonitoria });
  if (error) throw new Error(`No se pudieron leer los datos del aviso: ${error.message}`);
  const fila = data?.[0];
  if (!fila) return null;
  return {
    estado: fila.estado,
    motivoCancelacion: fila.motivo_cancelacion,
    grupal: fila.grupal,
    correoMonitor: fila.correo_monitor,
    nombreMonitor: fila.nombre_monitor,
    nombreEstudiante: fila.nombre_estudiante,
    nombreMateria: fila.nombre_materia,
    inicio: new Date(fila.inicio).toISOString(),
    duracionMin: fila.duracion_min,
    presencial: fila.presencial,
  };
}

/** Los datos del aviso, si todavía vale ahora (`avisoVigente`). */
async function datosVigentes(cliente: Cliente, evento: EventoDeAviso, idMonitoria: string): Promise<DatosDeAviso | null> {
  if (!UUID.test(idMonitoria)) return null;
  const d = await leerDatos(cliente, idMonitoria);
  // Sin datos es raro: la monitoría se borró, o le falta el monitor_privado o el Lead. Se deja rastro.
  if (!d) console.warn(`[avisos] la monitoría ${idMonitoria} no tiene los datos del aviso: no se manda.`);
  return d && avisoVigente(evento, d, new Date()) ? d : null;
}

/** Para reintentar un aviso de confirmación que falló (HU-065). La entidad es el id de la monitoría. */
export async function reconstruirAvisoConfirmada(
  idMonitoria: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"aviso_monitor_confirmada"> | null> {
  const d = await datosVigentes(cliente, "confirmada", idMonitoria);
  return d && { destinatario: d.correoMonitor, datos: datosDeConfirmada(d, urlDelSitio(RUTA_DE_LA_AGENDA)) };
}

/** Para reintentar un aviso de cancelación que falló (HU-065). La entidad es el id de la monitoría. */
export async function reconstruirAvisoCancelada(
  idMonitoria: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"aviso_monitor_cancelada"> | null> {
  const d = await datosVigentes(cliente, "cancelada", idMonitoria);
  return d && { destinatario: d.correoMonitor, datos: datosDeCancelada(d, urlDelSitio(RUTA_DE_LA_AGENDA)) };
}

/** Para reintentar un aviso de cancelación por pago rechazado que falló (HU-076, HU-065). La entidad es el id de la monitoría. */
export async function reconstruirAvisoPagoRechazado(
  idMonitoria: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"aviso_monitor_pago_rechazado"> | null> {
  const d = await datosVigentes(cliente, "pago_rechazado", idMonitoria);
  return d && { destinatario: d.correoMonitor, datos: datosDePagoRechazado(d, urlDelSitio(RUTA_DE_LA_AGENDA)) };
}

/** Manda el correo de un aviso, o `null` si ya no vale. */
async function mandarAviso(
  cliente: Cliente,
  enviar: DependenciasDeAvisos["enviar"],
  evento: EventoDeAviso,
  idMonitoria: string,
): Promise<ResultadoEnvio | null> {
  if (evento === "confirmada") {
    const correo = await reconstruirAvisoConfirmada(idMonitoria, cliente);
    return correo && enviar({ plantilla: "aviso_monitor_confirmada", ...correo, entidad: idMonitoria });
  }
  if (evento === "pago_rechazado") {
    const correo = await reconstruirAvisoPagoRechazado(idMonitoria, cliente);
    return correo && enviar({ plantilla: "aviso_monitor_pago_rechazado", ...correo, entidad: idMonitoria });
  }
  const correo = await reconstruirAvisoCancelada(idMonitoria, cliente);
  return correo && enviar({ plantilla: "aviso_monitor_cancelada", ...correo, entidad: idMonitoria });
}

export type ResumenDeAvisos = {
  revisados: number;
  enviados: number;
  /** El aviso ya no valía (la monitoría cambió, ya empezó o no tiene datos): no se manda. */
  descartados: number;
  /** El correo falló y quedó `fallido` en `correo_envio`: lo reintenta HU-065 o lo ve el admin. */
  fallidos: number;
  /** Otra corrida lo estaba mandando (la clave del correo es única). */
  tomadosPorOtro: number;
  /** No se pudo procesar (error de la base o de los datos): se reintenta en otra corrida, hasta `MAXIMO_DE_INTENTOS`. */
  conError: number;
  /** Se acabó el presupuesto de tiempo: quedan para la próxima corrida. */
  pospuestos: number;
};

export type DependenciasDeAvisos = {
  /** Con la llave secreta: `aviso_monitor` solo la lee y la marca el servidor. */
  cliente: Cliente;
  enviar: <P extends Plantilla>(entrada: EntradaDeEnvio<P>) => Promise<ResultadoEnvio>;
  /** El reloj de la corrida, para el presupuesto de tiempo. */
  reloj: () => number;
};

type Aviso = { id: string; id_monitoria: string; evento: string; intentos: number };

/**
 * Manda los avisos pendientes (HU-051), del más antiguo al más reciente. Cada uno queda procesado cuando su
 * correo queda en `correo_envio` (enviado, o fallido para reintentar) o cuando ya no vale. Si no se pudo procesar,
 * suma un intento y se abandona al llegar a `MAXIMO_DE_INTENTOS`. Dos corridas a la vez no lo mandan dos veces: la
 * clave del correo es única.
 */
export async function procesarAvisosAlMonitor(dependencias?: Partial<DependenciasDeAvisos>): Promise<ResumenDeAvisos> {
  const cliente = dependencias?.cliente ?? crearClienteAdmin();
  const enviar = dependencias?.enviar ?? enviarCorreoDesdeServidor;
  const reloj = dependencias?.reloj ?? Date.now;
  const inicio = reloj();
  const resumen: ResumenDeAvisos = { revisados: 0, enviados: 0, descartados: 0, fallidos: 0, tomadosPorOtro: 0, conError: 0, pospuestos: 0 };

  const { data: avisos, error } = await cliente
    .from("aviso_monitor")
    .select("id, id_monitoria, evento, intentos")
    .is("procesado_en", null)
    .order("creado_en")
    .limit(LOTE_DE_AVISOS);
  if (error) throw new Error(`No se pudieron leer los avisos: ${error.message}`);

  for (const aviso of avisos ?? []) {
    resumen.revisados++;
    if (reloj() - inicio >= PRESUPUESTO_DE_CORRIDA_MS) {
      resumen.pospuestos++;
      continue;
    }
    try {
      const resultado = esEventoDeAviso(aviso.evento) ? await mandarAviso(cliente, enviar, aviso.evento, aviso.id_monitoria) : null;
      if (!resultado) {
        resumen.descartados++;
      } else if (resultado.ok) {
        resumen.enviados++;
      } else if (resultado.motivo === "en_curso") {
        resumen.tomadosPorOtro++;
      } else if (resultado.motivo === "fallo_del_registro") {
        // Sin registro no hay reintento de HU-065: el aviso vuelve a intentarse en otra corrida.
        throw new Error(resultado.error);
      } else {
        // Quedó `fallido` en el registro (o el correo del monitor no es un correo): HU-065 y la bandeja del admin.
        console.error(`[avisos] el aviso ${aviso.evento} de la monitoría ${aviso.id_monitoria} no salió: ${resultado.error}`);
        resumen.fallidos++;
      }
      await marcar(cliente, aviso, { procesado_en: new Date().toISOString() });
    } catch (falla) {
      resumen.conError++;
      await sumarIntento(cliente, aviso, falla);
    }
  }
  return resumen;
}

async function marcar(cliente: Cliente, aviso: Aviso, cambios: { procesado_en?: string; intentos?: number }): Promise<void> {
  const { error } = await cliente.from("aviso_monitor").update(cambios).eq("id", aviso.id);
  if (error) throw new Error(`No se pudo marcar el aviso: ${error.message}`);
}

/** Suma un intento fallido; al llegar al máximo, abandona el aviso (queda procesado y se avisa en el log). */
async function sumarIntento(cliente: Cliente, aviso: Aviso, falla: unknown): Promise<void> {
  const mensaje = falla instanceof Error ? falla.message : String(falla);
  const intentos = aviso.intentos + 1;
  const abandonar = intentos >= MAXIMO_DE_INTENTOS;
  console.error(
    `[avisos] no se pudo procesar el aviso ${aviso.evento} de la monitoría ${aviso.id_monitoria} (intento ${intentos}${abandonar ? ", se abandona" : ""}): ${mensaje}`,
  );
  try {
    await marcar(cliente, aviso, abandonar ? { intentos, procesado_en: new Date().toISOString() } : { intentos });
  } catch (otra) {
    console.error("[avisos] tampoco se pudo anotar el intento:", otra instanceof Error ? otra.message : otra);
  }
}
