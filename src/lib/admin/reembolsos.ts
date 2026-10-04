import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diaDelNegocio } from "@/lib/fechas";
import type { Database } from "@/lib/supabase/tipos";
import {
  esEstadoDeLaVista,
  esResultadoDeRegistro,
  type EstadoDeLaVista,
  type PedidoDeRegistro,
  type ResultadoDeRegistro,
} from "./reembolsos-reglas";

/**
 * Gestionar un reembolso (HU-026) con la sesión del admin. Nada de la llave secreta: las políticas dejan leer los
 * reembolsos a cualquier admin activo, `public.estado_de_reembolso` dice con la hora de la base si un caso que espera la
 * llave ya venció, y `public.ejecutar_reembolso` toma la identidad de la sesión (`auth.uid()`) y vuelve a decidir todo
 * bajo candado. No se lee el desembolso ni los montos de los pagos: el reembolso es el pago completo (RN-60) y se
 * muestra tal cual.
 */

type Cliente = SupabaseClient<Database>;

export type ReembolsoParaGestionar = {
  id: string;
  /**
   * El estado que muestra la página: el de la fila leída, o `cerrado` si esperaba la llave y venció según la hora de la
   * base.
   */
  estadoVista: EstadoDeLaVista;
  /** El fin de los 7 días del ciclo actual para entregar la llave (P-10). */
  venceEn: Date;
  /** Cuándo lo cerró pg_cron; `null` si no se ha cerrado (aunque ya haya vencido). */
  cerradoEn: Date | null;
  /** El pago completo (RN-60). */
  monto: number;
  /** HU-030 le suma el comentario del admin (D-37: corto, pero la base no le pone tope). */
  motivo: string;
  nombrePagador: string;
  /** `pago.contacto`: a donde va el enlace (RN-44). */
  contacto: string;
  /**
   * La llave que entregó quien pagó: nula mientras espera la llave. La página la pinta a cualquier admin activo en
   * `pendiente` y `reembolsado` (D-48).
   */
  llaveDestino: string | null;
  /** El admin asignado; `null` si nació sin admin activo y el cron todavía no lo asigna (D-28). */
  asignado: { id: string; nombre: string } | null;
  /** El admin que registró la transferencia (`id_admin_registro`); `null` si no se ha registrado o no hay dato (HU-082). */
  registradoPor: { id: string; nombre: string } | null;
  /** El día en Bogotá en que se creó, `AAAA-MM-DD`: la transferencia no puede ser anterior. */
  fechaMinima: string;
  /** La referencia y la fecha registradas; `null` mientras no se reembolse. */
  transferencia: { referencia: string; fecha: Date } | null;
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
};

/**
 * Un reembolso con su pago y su monitoría, o `null` si no existe. Cualquier admin activo lo lee; a otro rol las
 * políticas se lo esconden y también da `null`.
 */
export async function cargarReembolso(cliente: Cliente, idReembolso: string): Promise<ReembolsoParaGestionar | null> {
  const [leido, estado] = await Promise.all([
    cliente
      .from("reembolso")
      .select(
        "id, estado, monto, motivo, llave_destino, id_admin, admin!reembolso_id_admin_fkey(nombre), id_admin_registro, registrador:admin!reembolso_id_admin_registro_fkey(nombre), fecha_generacion, cerrado_en, fecha_reembolso, referencia_transferencia, pago(nombre_pagador, contacto, monitoria(estado, motivo_cancelacion, fecha, id_franja, id_materia))",
      )
      .eq("id", idReembolso)
      .maybeSingle(),
    cliente.rpc("estado_de_reembolso", { p_id_reembolso: idReembolso }),
  ]);
  if (leido.error) throw new Error(`No se pudo leer el reembolso: ${leido.error.message}`);
  if (estado.error) throw new Error(`No se pudo saber el estado del reembolso: ${estado.error.code ?? ""} ${estado.error.message}`.trim());
  const r = leido.data;
  if (!r) return null;
  // reembolso_id_pago_fkey y pago_id_monitoria_fkey son obligatorias: el pago y su monitoría siempre vienen.
  const p = r.pago;
  const m = p?.monitoria;
  if (!p || !m) throw new Error("El reembolso está incompleto.");

  // La base da una fila a un admin activo, el mismo que acaba de leer el reembolso.
  const fila = estado.data?.[0];
  if (!fila || !esEstadoDeLaVista(fila.estado)) {
    throw new Error(`Respuesta inesperada al ver el estado del reembolso: ${JSON.stringify(fila?.estado ?? null)}`);
  }
  // Las dos lecturas son dos peticiones, cada una con su foto de la base: entre una y otra quien pagó pudo entregar la
  // llave u otra pestaña registrar la transferencia. El estado sale de la misma foto que la llave y la transferencia; de
  // estado_de_reembolso solo se toma si uno que espera la llave ya venció, junto con su plazo (los dos de la misma foto).
  const estadoVista: EstadoDeLaVista = r.estado === "esperando_llave" ? (fila.estado === "cerrado" ? "cerrado" : "esperando_llave") : r.estado;

  const [franja, materia] = await Promise.all([
    cliente.from("franja").select("hora, duracion_min").eq("id", m.id_franja).single(),
    cliente.from("materia").select("nombre").eq("id", m.id_materia).single(),
  ]);
  const fallo = franja.error ?? materia.error;
  if (fallo) throw new Error(`No se pudo leer la monitoría del reembolso: ${fallo.message}`);
  if (!franja.data || !materia.data) throw new Error("El reembolso está incompleto.");

  let transferencia: ReembolsoParaGestionar["transferencia"] = null;
  if (r.estado === "reembolsado") {
    // La base exige fecha y referencia en un reembolsado.
    if (!r.referencia_transferencia || !r.fecha_reembolso) throw new Error("El reembolso está incompleto.");
    transferencia = { referencia: r.referencia_transferencia, fecha: new Date(r.fecha_reembolso) };
  }
  // La base exige la llave en un pendiente: sin ella no hay a dónde transferir.
  if (r.estado === "pendiente" && !r.llave_destino) throw new Error("El reembolso está incompleto.");

  return {
    id: r.id,
    estadoVista,
    venceEn: new Date(fila.vence_en),
    cerradoEn: r.cerrado_en ? new Date(r.cerrado_en) : null,
    monto: r.monto,
    motivo: r.motivo,
    nombrePagador: p.nombre_pagador,
    contacto: p.contacto,
    llaveDestino: r.llave_destino,
    registradoPor: r.id_admin_registro ? { id: r.id_admin_registro, nombre: r.registrador?.nombre ?? "un admin" } : null,
    asignado: r.id_admin ? { id: r.id_admin, nombre: r.admin?.nombre ?? "un admin" } : null,
    fechaMinima: diaDelNegocio(new Date(r.fecha_generacion)),
    transferencia,
    monitoria: {
      estado: m.estado,
      motivoCancelacion: m.motivo_cancelacion,
      fecha: m.fecha,
      hora: franja.data.hora,
      duracionMin: franja.data.duracion_min,
      nombreMateria: materia.data.nombre,
    },
  };
}

/**
 * Registra la transferencia con la sesión de `cliente` (sin vuelta atrás). La base comprueba que la sesión sea un admin
 * activo (cualquiera, no solo el asignado), revisa la referencia y la fecha con su hora, bloquea la fila del reembolso y
 * vuelve a mirar el estado y que el admin siga activo.
 */
export async function ejecutarReembolso(cliente: Cliente, pedido: PedidoDeRegistro): Promise<ResultadoDeRegistro> {
  const { data, error } = await cliente.rpc("ejecutar_reembolso", {
    p_id_reembolso: pedido.idReembolso,
    p_referencia: pedido.referencia,
    p_fecha: pedido.fecha,
  });
  // Solo el código y el mensaje: el detalle de PostgREST podría traer la fila, con la llave.
  if (error) throw new Error(`No se pudo registrar el reembolso: ${error.code ?? ""} ${error.message}`.trim());
  if (!esResultadoDeRegistro(data)) throw new Error(`Respuesta inesperada al registrar el reembolso: ${JSON.stringify(data ?? null)}`);
  return data;
}
