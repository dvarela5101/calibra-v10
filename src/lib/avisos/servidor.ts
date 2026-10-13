import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LOTE_POR_DEFECTO,
  MAXIMO_DE_INTENTOS,
  PRESUPUESTO_DE_CORRIDA_MS,
  procesarBandeja,
  type DefinicionDeBandeja,
  type DependenciasDeBandeja,
} from "@/lib/correo/bandeja";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { urlDelSitio, type ResultadoEnvio } from "@/lib/correo/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import {
  avisoVigente,
  datosDeCancelada,
  datosDeConfirmada,
  datosDeInasistenciaAceptada,
  datosDePagoRechazado,
  esEventoDeAviso,
  RUTA_DE_LA_AGENDA,
  type DatosDeAviso,
  type EventoDeAviso,
} from "./reglas";

type Cliente = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuántos avisos toma cada corrida. Lo normal es uno por corrida: el trigger la pide al anotarlo. */
export const LOTE_DE_AVISOS = LOTE_POR_DEFECTO;

// El presupuesto de la corrida y el máximo de intentos viven en `procesarBandeja`; se reexportan porque las pruebas los importan de aquí.
export { MAXIMO_DE_INTENTOS, PRESUPUESTO_DE_CORRIDA_MS };

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

/**
 * Si el desembolso de la monitoría ya se le transfirió al monitor. Aceptar un reporte no anula uno transferido (el dinero
 * ya salió) y el correo no puede decirle entonces que no se le desembolsa. Es un estado terminal: da lo mismo al mandar
 * el aviso que al reintentarlo. Si no se puede leer, falla y el aviso se reintenta en otra corrida.
 */
async function desembolsoTransferido(cliente: Cliente, idMonitoria: string): Promise<boolean> {
  const { data, error } = await cliente.from("desembolso").select("estado").eq("id_monitoria", idMonitoria).maybeSingle();
  if (error) throw new Error(`No se pudo leer el desembolso de la monitoría: ${error.message}`);
  return data?.estado === "desembolsado";
}

/** Para reintentar un aviso de reporte de inasistencia aceptado que falló (HU-030, HU-065). La entidad es el id de la monitoría. */
export async function reconstruirAvisoInasistenciaAceptada(
  idMonitoria: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"aviso_monitor_inasistencia_aceptada"> | null> {
  const d = await datosVigentes(cliente, "inasistencia_aceptada", idMonitoria);
  if (!d) return null;
  const transferido = await desembolsoTransferido(cliente, idMonitoria);
  return { destinatario: d.correoMonitor, datos: datosDeInasistenciaAceptada(d, urlDelSitio(RUTA_DE_LA_AGENDA), transferido) };
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
  if (evento === "inasistencia_aceptada") {
    const correo = await reconstruirAvisoInasistenciaAceptada(idMonitoria, cliente);
    return correo && enviar({ plantilla: "aviso_monitor_inasistencia_aceptada", ...correo, entidad: idMonitoria });
  }
  const correo = await reconstruirAvisoCancelada(idMonitoria, cliente);
  return correo && enviar({ plantilla: "aviso_monitor_cancelada", ...correo, entidad: idMonitoria });
}

/** El resumen de los avisos va en masculino (lo compara `integracion/avisos.test.ts` y lo devuelve la ruta); `procesarBandeja` lo da en femenino. */
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

export type DependenciasDeAvisos = DependenciasDeBandeja;

type Aviso = { id: string; id_monitoria: string; evento: string; intentos: number };

const BANDEJA = {
  prefijo: "avisos",
  tabla: "aviso_monitor",
  lote: LOTE_DE_AVISOS,
  lectura: { columnas: "id, id_monitoria, evento, intentos", orden: "creado_en" },
  textos: { leer: "No se pudieron leer los avisos", marcar: "No se pudo marcar el aviso" },
  nombrar: (aviso) => `el aviso ${aviso.evento} de la monitoría ${aviso.id_monitoria}`,
  mandar: (aviso, { cliente, enviar }) => (esEventoDeAviso(aviso.evento) ? mandarAviso(cliente, enviar, aviso.evento, aviso.id_monitoria) : Promise.resolve(null)),
} satisfies DefinicionDeBandeja<Aviso>;

/**
 * Manda los avisos pendientes (HU-051) con `procesarBandeja`, del más antiguo al más reciente. Dos corridas a la vez no
 * lo mandan dos veces: la clave del correo es única. El resumen de la bandeja se traduce a masculino, con las claves en
 * el orden de siempre.
 */
export async function procesarAvisosAlMonitor(dependencias?: Partial<DependenciasDeAvisos>): Promise<ResumenDeAvisos> {
  const resumen = await procesarBandeja(BANDEJA, dependencias);
  return {
    revisados: resumen.revisadas,
    enviados: resumen.enviadas,
    descartados: resumen.descartadas,
    fallidos: resumen.fallidas,
    tomadosPorOtro: resumen.tomadasPorOtro,
    conError: resumen.conError,
    pospuestos: resumen.pospuestas,
  };
}
