import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import { esCierre, estadoDelCaso } from "./casos-p24-reglas";
import {
  esResultadoDeResolucion,
  type EstadoDeDesembolso,
  type EstadoDeReembolso,
  type EstadoDeReporte,
  type PagoDelReporte,
  type PedidoDeResolucion,
  type ResultadoDeResolucion,
} from "./reportes-reglas";

/**
 * Resolver un reporte de inasistencia (HU-030) con la sesión del admin. Nada de la llave secreta: las políticas dejan
 * leer los reportes, las monitorías, los pagos y los contactos a cualquier admin activo, y `public.resolver_reporte_inasistencia`
 * toma la identidad de la sesión (`auth.uid()`, que tiene que ser la del admin asignado) y la hora de la base, y vuelve a
 * decidir todo bajo candado. Nunca se leen la llave del monitor, la del desembolso ni su bruto, comisión o neto
 * (CLAUDE.md, P-32): del desembolso, solo su estado.
 */

type Cliente = SupabaseClient<Database>;

type Contacto = { nombre: string; correo: string | null; telefono: string | null };

export type ReporteParaResolver = {
  id: string;
  estado: EstadoDeReporte;
  /** El admin asignado: el único que lo resuelve (RN-63, supuesto 1). */
  idAdmin: string;
  nombreAdmin: string;
  fechaReporte: Date;
  /** `null` mientras está en revisión. */
  fechaDecision: Date | null;
  observaciones: string | null;
  /** Quien agendó y reportó. El admin gestiona el caso, así que ve su contacto (supuesto 10). */
  lead: Contacto;
  /** El monitor y su contacto. Nunca su llave. */
  monitor: Contacto;
  /** Solo el estado: es lo que el admin necesita para saber qué pasa al decidir. `null` si la monitoría no se ha realizado. */
  desembolso: EstadoDeDesembolso | null;
  /** El desembolso es ejecutable después de este instante, no desde él (N-6). */
  desembolsableDesde: Date;
  monitoria: {
    id: string;
    estado: Database["public"]["Enums"]["estado_monitoria"];
    motivoCancelacion: Database["public"]["Enums"]["motivo_cancelacion"] | null;
    /** Día de calendario, `AAAA-MM-DD`. */
    fecha: string;
    /** Hora de inicio en la zona del negocio, `HH:MM:SS`. */
    hora: string;
    duracionMin: number;
    nombreMateria: string;
    /** La pone el monitor al finalizar o el cierre automático de HU-023: no prueba por sí sola que el monitor llegara. */
    fechaFinalizacion: Date | null;
    grupal: boolean;
  };
  pagos: PagoParaElReporte[];
};

export type PagoParaElReporte = PagoDelReporte & {
  id: string;
  /** Su reembolso, si ya nació. */
  reembolso: { id: string; estado: EstadoDeReembolso } | null;
  resena: { calificacion: number; comentario: string | null } | null;
};

/**
 * Un reporte con su monitoría, sus pagos y lo que hace falta para decidir, o `null` si no existe. Cualquier admin activo
 * lo lee; a otro rol las políticas se lo esconden y también da `null`. La suma a reembolsar sale de los `monto` de los
 * pagos aprobados (lo que el pagador pagó, RN-60), no del desembolso.
 */
export async function cargarReporte(cliente: Cliente, idReporte: string): Promise<ReporteParaResolver | null> {
  const leido = await cliente
    .from("reporte_inasistencia")
    .select(
      "id, estado, id_admin, fecha_reporte, fecha_decision, observaciones, admin(nombre), monitoria(id, estado, motivo_cancelacion, fecha, fecha_finalizacion, id_franja, id_materia, id_monitor, id_lead), monitoria_plazos(desembolsable_desde, es_grupal)",
    )
    .eq("id", idReporte)
    .maybeSingle();
  if (leido.error) throw new Error(`No se pudo leer el reporte: ${leido.error.message}`);
  const reporte = leido.data;
  if (!reporte) return null;
  const m = reporte.monitoria;
  const plazos = reporte.monitoria_plazos;
  if (!m || !reporte.admin || !plazos?.desembolsable_desde || plazos.es_grupal === null) throw new Error("El reporte está incompleto.");

  const [franja, materia, monitor, privado, lead, desembolso, pagos] = await Promise.all([
    cliente.from("franja").select("hora, duracion_min").eq("id", m.id_franja).single(),
    cliente.from("materia").select("nombre").eq("id", m.id_materia).single(),
    cliente.from("monitor").select("nombre").eq("id", m.id_monitor).single(),
    cliente.from("monitor_privado").select("correo, numero_telefono").eq("id_monitor", m.id_monitor).maybeSingle(),
    cliente.from("lead").select("nombre, correo, numero_telefono").eq("id", m.id_lead).single(),
    cliente.from("desembolso").select("estado").eq("id_monitoria", m.id).maybeSingle(),
    cliente
      .from("pago")
      .select("id, nombre_pagador, monto, estado, cierre_rechazo, reembolso(id, estado), resena(calificacion, comentario)")
      .eq("id_monitoria", m.id)
      .order("fecha_pago", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  const fallo = franja.error ?? materia.error ?? monitor.error ?? privado.error ?? lead.error ?? desembolso.error ?? pagos.error;
  if (fallo) throw new Error(`No se pudo leer la monitoría del reporte: ${fallo.message}`);
  if (!franja.data || !materia.data || !monitor.data || !lead.data) throw new Error("El reporte está incompleto.");

  return {
    id: reporte.id,
    estado: reporte.estado,
    idAdmin: reporte.id_admin,
    nombreAdmin: reporte.admin.nombre,
    fechaReporte: new Date(reporte.fecha_reporte),
    fechaDecision: reporte.fecha_decision ? new Date(reporte.fecha_decision) : null,
    observaciones: reporte.observaciones,
    lead: { nombre: lead.data.nombre, correo: lead.data.correo, telefono: lead.data.numero_telefono },
    monitor: { nombre: monitor.data.nombre, correo: privado.data?.correo ?? null, telefono: privado.data?.numero_telefono ?? null },
    desembolso: desembolso.data?.estado ?? null,
    desembolsableDesde: new Date(plazos.desembolsable_desde),
    monitoria: {
      id: m.id,
      estado: m.estado,
      motivoCancelacion: m.motivo_cancelacion,
      fecha: m.fecha,
      hora: franja.data.hora,
      duracionMin: franja.data.duracion_min,
      nombreMateria: materia.data.nombre,
      fechaFinalizacion: m.fecha_finalizacion ? new Date(m.fecha_finalizacion) : null,
      grupal: plazos.es_grupal,
    },
    pagos: (pagos.data ?? []).map((p) => {
      const cierre = esCierre(p.cierre_rechazo) ? p.cierre_rechazo : null;
      return {
        id: p.id,
        nombrePagador: p.nombre_pagador,
        monto: p.monto,
        estado: p.estado,
        caso: estadoDelCaso(p.estado, m.estado, cierre),
        cierre,
        reembolso: p.reembolso ? { id: p.reembolso.id, estado: p.reembolso.estado } : null,
        resena: p.resena ? { calificacion: p.resena.calificacion, comentario: p.resena.comentario } : null,
      };
    }),
  };
}

/** A quién está asignado un reporte y en qué estado va: lo que hace falta para anticipar `no_asignado` y `ya_decidido`. */
export type AsignacionDeReporte = { idAdmin: string; estado: EstadoDeReporte };

/**
 * La asignación de un reporte, sin su monitoría ni sus pagos: la acción de resolver la mira antes de validar las
 * observaciones (nota de D-39). `null` si el reporte no existe o la sesión no lo puede leer.
 */
export async function cargarAsignacionDeReporte(cliente: Cliente, idReporte: string): Promise<AsignacionDeReporte | null> {
  const { data, error } = await cliente.from("reporte_inasistencia").select("id_admin, estado").eq("id", idReporte).maybeSingle();
  if (error) throw new Error(`No se pudo leer el reporte: ${error.message}`);
  return data && { idAdmin: data.id_admin, estado: data.estado };
}

/**
 * Acepta o rechaza el reporte con la sesión de `cliente` (sin vuelta atrás). La base comprueba que la sesión sea el admin
 * asignado y activo, que el reporte siga en revisión y, al aceptar, que la monitoría siga confirmada o realizada. Sin
 * observaciones se manda el texto vacío, que la base toma como ninguna.
 */
export async function resolverReporte(cliente: Cliente, pedido: PedidoDeResolucion): Promise<ResultadoDeResolucion> {
  const { data, error } = await cliente.rpc("resolver_reporte_inasistencia", {
    p_id_reporte: pedido.idReporte,
    p_decision: pedido.decision,
    p_observaciones: pedido.observaciones ?? "",
  });
  // Solo el código y el mensaje: el detalle de PostgREST podría traer las observaciones o la fila.
  if (error) throw new Error(`No se pudo resolver el reporte: ${error.code ?? ""} ${error.message}`.trim());
  if (!esResultadoDeResolucion(data)) throw new Error(`Respuesta inesperada al resolver el reporte: ${JSON.stringify(data ?? null)}`);
  return data;
}
