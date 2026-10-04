import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import {
  esMotivoParaNoEjecutar,
  esResultadoDeEjecucion,
  type EstadoDeDesembolso,
  type MotivoParaNoEjecutar,
  type PedidoDeEjecucion,
  type ResultadoDeEjecucion,
} from "./desembolsos-reglas";

/**
 * Ejecutar un desembolso (HU-028) con la sesión del admin. Nada de la llave secreta: las políticas dejan leer los
 * desembolsos a cualquier admin activo, `public.estado_para_ejecutar` dice con la hora de la base si se puede ejecutar
 * y el neto, y `public.ejecutar_desembolso` toma la identidad de la sesión (`auth.uid()`) y vuelve a decidir todo bajo
 * candado. Del desembolso nunca se leen el bruto ni la comisión, ni los montos de los pagos, de los que se deduciría
 * la comisión (CLAUDE.md, P-32): el neto sale de la base ya calculado.
 */

type Cliente = SupabaseClient<Database>;

export type DesembolsoParaEjecutar = {
  id: string;
  estado: EstadoDeDesembolso;
  /** Por qué no se puede ejecutar ahora (`null` = se puede), según la base con su hora. */
  motivo: MotivoParaNoEjecutar | null;
  /** El neto que se transferiría ahora (P-29) o, si ya se desembolsó, el que se transfirió. */
  montoNeto: number | null;
  /** La llave del monitor copiada al crear el desembolso (RN-80): a donde se transfiere, aunque él cambie la suya. */
  llaveDestino: string;
  /** Es ejecutable después de este instante, no desde él (N-6). */
  desembolsableDesde: Date;
  nombreMonitor: string;
  monitoria: {
    estado: Database["public"]["Enums"]["estado_monitoria"];
    motivoCancelacion: Database["public"]["Enums"]["motivo_cancelacion"] | null;
    /** Día de calendario, `AAAA-MM-DD`. */
    fecha: string;
    /** Hora de inicio en la zona del negocio, `HH:MM:SS`. */
    hora: string;
    duracionMin: number;
    nombreMateria: string;
  };
  /** Quién lo ejecutó, con qué referencia y en qué fecha; `null` mientras no se desembolse. */
  ejecucion: { idAdmin: string; nombreAdmin: string; referencia: string; fecha: Date } | null;
};

/**
 * Un desembolso con su monitoría y lo que hace falta para transferirlo, o `null` si no existe. Cualquier admin activo
 * lo lee; a otro rol las políticas se lo esconden y también da `null`.
 */
export async function cargarDesembolso(cliente: Cliente, idDesembolso: string): Promise<DesembolsoParaEjecutar | null> {
  const [leido, estado] = await Promise.all([
    cliente
      .from("desembolso")
      .select(
        "id, estado, llave_destino, referencia_transferencia, fecha_desembolso, id_admin, admin(nombre), monitoria(estado, motivo_cancelacion, fecha, id_franja, id_monitor, id_materia), monitoria_plazos(desembolsable_desde)",
      )
      .eq("id", idDesembolso)
      .maybeSingle(),
    cliente.rpc("estado_para_ejecutar", { p_id_desembolso: idDesembolso }),
  ]);
  if (leido.error) throw new Error(`No se pudo leer el desembolso: ${leido.error.message}`);
  if (estado.error) throw new Error(`No se pudo saber si el desembolso se puede ejecutar: ${estado.error.code ?? ""} ${estado.error.message}`.trim());
  const d = leido.data;
  if (!d) return null;
  const m = d.monitoria;
  const desde = d.monitoria_plazos?.desembolsable_desde;
  if (!m || !desde) throw new Error("El desembolso está incompleto.");

  // La base da una fila a un admin activo; `motivo` nulo es que se puede ejecutar.
  const fila = estado.data?.[0];
  const motivo: unknown = fila?.motivo ?? null;
  if (!fila || (motivo !== null && !esMotivoParaNoEjecutar(motivo))) {
    throw new Error(`Respuesta inesperada al ver si el desembolso se puede ejecutar: ${JSON.stringify(fila?.motivo ?? null)}`);
  }
  const montoNeto = typeof fila.monto_neto === "number" ? fila.monto_neto : null;
  if (motivo === null && montoNeto === null) throw new Error("La base no dio el neto de un desembolso ejecutable.");

  const [franja, monitor, materia] = await Promise.all([
    cliente.from("franja").select("hora, duracion_min").eq("id", m.id_franja).single(),
    cliente.from("monitor").select("nombre").eq("id", m.id_monitor).single(),
    cliente.from("materia").select("nombre").eq("id", m.id_materia).single(),
  ]);
  const fallo = franja.error ?? monitor.error ?? materia.error;
  if (fallo) throw new Error(`No se pudo leer la monitoría del desembolso: ${fallo.message}`);
  if (!franja.data || !monitor.data || !materia.data) throw new Error("El desembolso está incompleto.");

  let ejecucion: DesembolsoParaEjecutar["ejecucion"] = null;
  if (d.estado === "desembolsado") {
    // La base exige admin, fecha y referencia en un desembolsado.
    if (!d.id_admin || !d.referencia_transferencia || !d.fecha_desembolso) throw new Error("El desembolso está incompleto.");
    ejecucion = {
      idAdmin: d.id_admin,
      nombreAdmin: d.admin?.nombre ?? "un admin",
      referencia: d.referencia_transferencia,
      fecha: new Date(d.fecha_desembolso),
    };
  }

  return {
    id: d.id,
    estado: d.estado,
    motivo,
    montoNeto,
    llaveDestino: d.llave_destino,
    desembolsableDesde: new Date(desde),
    nombreMonitor: monitor.data.nombre,
    monitoria: {
      estado: m.estado,
      motivoCancelacion: m.motivo_cancelacion,
      fecha: m.fecha,
      hora: franja.data.hora,
      duracionMin: franja.data.duracion_min,
      nombreMateria: materia.data.nombre,
    },
    ejecucion,
  };
}

/**
 * Registra la transferencia con la sesión de `cliente` (sin vuelta atrás). La base comprueba que la sesión sea un
 * admin activo, bloquea la monitoría y el desembolso, vuelve a mirar RN-83, D-39 y el supuesto 2, y recalcula los
 * montos con los pagos aprobados de ahora (P-29) y, desde HU-078, con los casos P-24 cerrados.
 */
export async function ejecutarDesembolso(cliente: Cliente, pedido: PedidoDeEjecucion): Promise<ResultadoDeEjecucion> {
  const { data, error } = await cliente.rpc("ejecutar_desembolso", {
    p_id_desembolso: pedido.idDesembolso,
    p_referencia: pedido.referencia,
    p_fecha: pedido.fecha,
    p_neto_esperado: pedido.netoEsperado,
  });
  // Solo el código y el mensaje: el detalle de PostgREST podría traer la fila.
  if (error) throw new Error(`No se pudo ejecutar el desembolso: ${error.code ?? ""} ${error.message}`.trim());
  if (!esResultadoDeEjecucion(data)) throw new Error(`Respuesta inesperada al ejecutar el desembolso: ${JSON.stringify(data ?? null)}`);
  return data;
}
