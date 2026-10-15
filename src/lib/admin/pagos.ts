import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { esUuid } from "@/lib/agendar/reglas";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { correoConsultasDatos } from "@/lib/privacidad/consentimiento";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import { esCierre, type CierreDeCaso } from "./casos-p24-reglas";
import { correoDeRechazoSinReembolso } from "./avisos-rechazo-reglas";
import {
  correoDeRechazo,
  esResultadoDeRevision,
  type EstadoDePago,
  type PagoParaElCorreo,
  type PedidoDeRevision,
  type ResultadoDeRevision,
} from "./pagos-reglas";

/**
 * Revisar un pago (HU-020) con la sesión del admin. Nada de la llave secreta para leer ni para revisar: las políticas
 * dejan leer los pagos a cualquier admin activo, y `public.revisar_pago` toma la identidad de la sesión
 * (`auth.uid()`, que tiene que ser la de un admin activo, el responsable o no: D-56, HU-034) y la hora de la base. Solo la reconstrucción del correo al pagador usa la llave secreta, porque corre sin sesión
 * (el procesador de `avisos-rechazo.ts` y el reintento de HU-065).
 */

type Cliente = SupabaseClient<Database>;

export type PagoParaRevisar = {
  id: string;
  monto: number;
  nombrePagador: string;
  /** Correo o teléfono del pagador (RN-44). Desde HU-018 siempre es un correo. */
  contacto: string;
  /** Hoy siempre es `null`: nadie la escribe todavía (supuesto 6). */
  referencia: string | null;
  estado: EstadoDePago;
  /** El responsable según el orden de revisión (RN-42, D-56). Cualquier admin activo lo revisa desde que llega. */
  idAdmin: string;
  nombreAdmin: string;
  /** Cuándo llegó el pago (`fecha_pago`, que pone la base): con el reloj del servidor da «hace 25 min». */
  llegoEn: Date;
  fechaRevision: Date | null;
  /**
   * Quién lo aprobó o lo rechazó (HU-077, criterio 3), que puede ser otro admin y no el responsable. `null` mientras
   * está en revisión, y en un pago revisado que no lo registró (los que se insertan ya revisados, como las fixtures de las pruebas).
   */
  idAdminRevisor: string | null;
  nombreAdminRevisor: string | null;
  observaciones: string | null;
  /**
   * HU-078: cómo, quién y cuándo se cerró su caso P-24, con la nota si la hay. `null` mientras el caso está abierto o
   * si el pago no es un caso (`estadoDelCaso`).
   */
  cierre: { como: CierreDeCaso; nota: string | null; idAdmin: string; nombreAdmin: string; fecha: Date } | null;
  monitoria: {
    estado: Database["public"]["Enums"]["estado_monitoria"];
    motivoCancelacion: Database["public"]["Enums"]["motivo_cancelacion"] | null;
    /** Día de calendario, `AAAA-MM-DD`. */
    fecha: string;
    /** Hora de inicio en la zona del negocio, `HH:MM:SS`. */
    hora: string;
    duracionMin: number;
    nombreMateria: string;
    nombreMonitor: string;
    inicio: Date;
    grupal: boolean;
  };
};

/**
 * Un pago con su monitoría, su responsable y cuándo llegó (criterio 1), o `null` si no existe. Cualquier admin activo lo
 * lee; a otro rol las políticas se lo esconden y también da `null`. El comprobante no se lee aquí: su enlace firmado se
 * pide al abrirlo (criterio 6).
 */
export async function cargarPagoParaRevisar(cliente: Cliente, idPago: string): Promise<PagoParaRevisar | null> {
  const leido = await cliente
    .from("pago")
    // pago tiene tres llaves a admin (id_admin, id_admin_revisor desde HU-077 e id_admin_cierre desde HU-078): cada
    // embebido nombra la suya.
    .select(
      "id, monto, nombre_pagador, contacto, referencia_transferencia, estado, id_admin, fecha_pago, fecha_revision, observaciones, id_admin_revisor, cierre_rechazo, nota_cierre, id_admin_cierre, fecha_cierre, admin!pago_id_admin_fkey(nombre), revisor:admin!pago_id_admin_revisor_fkey(nombre), cerrador:admin!pago_id_admin_cierre_fkey(nombre), monitoria(estado, motivo_cancelacion, fecha, id_franja, id_monitor, id_materia), monitoria_plazos(inicio, es_grupal)",
    )
    .eq("id", idPago)
    .maybeSingle();
  if (leido.error) throw new Error(`No se pudo leer el pago: ${leido.error.message}`);
  const pago = leido.data;
  if (!pago) return null;
  const m = pago.monitoria;
  const plazos = pago.monitoria_plazos;
  if (!m || !pago.admin || !plazos?.inicio || plazos.es_grupal === null) throw new Error("El pago está incompleto.");

  const [franja, monitor, materia] = await Promise.all([
    cliente.from("franja").select("hora, duracion_min").eq("id", m.id_franja).single(),
    cliente.from("monitor").select("nombre").eq("id", m.id_monitor).single(),
    cliente.from("materia").select("nombre").eq("id", m.id_materia).single(),
  ]);
  const fallo = franja.error ?? monitor.error ?? materia.error;
  if (fallo) throw new Error(`No se pudo leer la monitoría del pago: ${fallo.message}`);
  if (!franja.data || !monitor.data || !materia.data) throw new Error("El pago está incompleto.");

  let cierre: PagoParaRevisar["cierre"] = null;
  if (pago.cierre_rechazo !== null) {
    // La base exige cómo, quién y cuándo juntos (pago_cierre_coherente, HU-078).
    if (!esCierre(pago.cierre_rechazo) || !pago.id_admin_cierre || !pago.fecha_cierre) throw new Error("El pago está incompleto.");
    cierre = {
      como: pago.cierre_rechazo,
      nota: pago.nota_cierre,
      idAdmin: pago.id_admin_cierre,
      nombreAdmin: pago.cerrador?.nombre ?? "un admin",
      fecha: new Date(pago.fecha_cierre),
    };
  }

  return {
    id: pago.id,
    monto: pago.monto,
    nombrePagador: pago.nombre_pagador,
    contacto: pago.contacto,
    referencia: pago.referencia_transferencia,
    estado: pago.estado,
    idAdmin: pago.id_admin,
    nombreAdmin: pago.admin.nombre,
    llegoEn: new Date(pago.fecha_pago),
    fechaRevision: pago.fecha_revision ? new Date(pago.fecha_revision) : null,
    idAdminRevisor: pago.id_admin_revisor,
    nombreAdminRevisor: pago.revisor?.nombre ?? null,
    observaciones: pago.observaciones,
    cierre,
    monitoria: {
      estado: m.estado,
      motivoCancelacion: m.motivo_cancelacion,
      fecha: m.fecha,
      hora: franja.data.hora,
      duracionMin: franja.data.duracion_min,
      nombreMateria: materia.data.nombre,
      nombreMonitor: monitor.data.nombre,
      inicio: new Date(plazos.inicio),
      grupal: plazos.es_grupal,
    },
  };
}

export type Revision = { resultado: ResultadoDeRevision; canceloMonitoria: boolean };

/**
 * Aprueba o rechaza el pago con la sesión de `cliente` (§5.2, sin vuelta atrás). La base comprueba que la sesión sea
 * un admin activo (el responsable o no: D-56, HU-034), que el pago siga en revisión y, al rechazar, si la cita se
 * cancela o es P-24. Guarda quién lo revisó.
 */
export async function revisarPago(cliente: Cliente, pedido: PedidoDeRevision): Promise<Revision> {
  const { data, error } = await cliente.rpc("revisar_pago", {
    p_id_pago: pedido.idPago,
    p_decision: pedido.decision,
    ...(pedido.observaciones ? { p_observaciones: pedido.observaciones } : {}),
  });
  // Solo el código y el mensaje: el detalle de PostgREST podría traer la fila, con el contacto del pagador.
  if (error) throw new Error(`No se pudo revisar el pago: ${error.code ?? ""} ${error.message}`.trim());
  const fila = data?.[0];
  if (!fila || !esResultadoDeRevision(fila.resultado)) {
    throw new Error(`Respuesta inesperada al revisar el pago: ${JSON.stringify(fila?.resultado ?? null)}`);
  }
  return { resultado: fila.resultado, canceloMonitoria: fila.cancelo_monitoria === true };
}

/** El pago con lo que necesita el correo de su rechazo, o `null` si no existe. Con la llave secreta de `cliente`. */
async function leerPagoParaElCorreo(cliente: Cliente, idPago: string): Promise<PagoParaElCorreo | null> {
  const { data, error } = await cliente
    .from("pago")
    .select("estado, contacto, nombre_pagador, monto, monitoria(estado, motivo_cancelacion, fecha)")
    .eq("id", idPago)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el pago rechazado: ${error.message}`);
  if (!data) return null;
  const m = data.monitoria;
  return {
    estado: data.estado,
    contacto: data.contacto,
    nombrePagador: data.nombre_pagador,
    monto: data.monto,
    monitoria: m && { estado: m.estado, motivoCancelacion: m.motivo_cancelacion, fecha: m.fecha },
  };
}

/**
 * Para mandar o reintentar el correo del rechazo (HU-065). La entidad es el id del pago. Es `null` si ya no aplica:
 * el pago no está rechazado o su cita no se canceló por `pago_rechazado` (`correoDeRechazo`).
 */
export async function reconstruirPagoRechazado(
  idPago: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"pago_rechazado_individual"> | null> {
  if (!esUuid(idPago)) return null;
  const pago = await leerPagoParaElCorreo(cliente, idPago);
  return pago && correoDeRechazo(pago, correoConsultasDatos());
}

/**
 * Para mandar o reintentar el correo del rechazo de un pago cuya cita ya estaba cancelada por el estudiante
 * (HU-076, D-39 d). La entidad es el id del pago. Es `null` si ya no aplica (`correoDeRechazoSinReembolso`).
 */
export async function reconstruirPagoRechazadoSinReembolso(
  idPago: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"pago_rechazado_sin_reembolso"> | null> {
  if (!esUuid(idPago)) return null;
  const pago = await leerPagoParaElCorreo(cliente, idPago);
  return pago && correoDeRechazoSinReembolso(pago, correoConsultasDatos());
}
