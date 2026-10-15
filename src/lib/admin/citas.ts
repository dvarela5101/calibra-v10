import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoDePagoDeCita } from "@/lib/citas/reglas";
import type { Database } from "@/lib/supabase/tipos";
import {
  esCategoria,
  esResultadoDeAutorizacion,
  estadoDePagoDeLaCita,
  type AutorizacionRegistrada,
  type EstadoDeMonitoria,
  type EstadoDeReembolso,
  type MotivoDeCancelacion,
  type PagoDeLaCita,
  type PedidoDeAutorizacion,
  type ResultadoDeAutorizacion,
} from "./citas-reglas";

/**
 * Autorizar una cancelación fuera de plazo (HU-052) con la sesión del admin. Nada de la llave secreta: las políticas dejan
 * leer las monitorías, los pagos, los contactos y la autorización a cualquier admin activo, y la vista de la lista da
 * cero filas a quien no lo es. `public.autorizar_cancelacion_fuera_de_plazo` toma la identidad de la sesión (`auth.uid()`)
 * y la hora de la base, y vuelve a decidir todo bajo candado. Del monitor, solo su nombre: nunca su contacto (P-37).
 * Nada de cifras del desembolso.
 */

type Cliente = SupabaseClient<Database>;

type Contacto = { nombre: string; correo: string | null; telefono: string | null };

/** Cuántas citas se muestran en la lista: son las de una ventana de 12 h, así que no hace falta paginar. */
export const MAX_CITAS_SIN_PLAZO = 100;

export type CitaSinPlazo = {
  id: string;
  /** El inicio de la sesión: la lista va de la que empieza primero a la que empieza última. */
  inicio: Date;
  /** Día de calendario, `AAAA-MM-DD`. */
  fecha: string;
  /** Hora de inicio en la zona del negocio, `HH:MM:SS`. */
  hora: string;
  duracionMin: number;
  nombreMateria: string;
  nombreMonitor: string;
  /** Quien agendó y cómo contactarlo. */
  lead: Contacto;
  estadoPago: EstadoDePagoDeCita;
};

export type CitasSinPlazo = { filas: CitaSinPlazo[]; total: number };

const unicos = (ids: string[]) => [...new Set(ids)];

const instante = (texto: string | null, nombre: string): Date => {
  const fecha = texto === null ? null : new Date(texto);
  if (fecha === null || Number.isNaN(fecha.getTime())) throw new Error(`La cita está incompleta: falta ${nombre}.`);
  return fecha;
};

/**
 * Las individuales confirmadas a las que ya se les pasó el plazo de 12 h y todavía no empiezan, la que empieza primero
 * arriba. Cuáles son lo decide la vista `citas_sin_plazo_para_cancelar` con la hora de la base y las mismas funciones con
 * que el núcleo de la autorización deja pasar a un admin: lo que la lista muestra y lo que la base autoriza no difieren en
 * el borde. Las columnas de una vista salen anulables en los tipos: un dato nulo lanza. `monitoria` no declara llaves
 * directas a monitor ni a materia, así que los nombres se piden aparte, una vez por lista. `maxFilas` se pasa para probar
 * el corte sin crear cientos de citas; el total sale exacto.
 */
export async function cargarCitasSinPlazo(
  cliente: Cliente,
  { maxFilas = MAX_CITAS_SIN_PLAZO }: { maxFilas?: number } = {},
): Promise<CitasSinPlazo> {
  const lista = await cliente
    .from("citas_sin_plazo_para_cancelar")
    .select("id_monitoria, inicio", { count: "exact" })
    .order("inicio", { ascending: true })
    .order("id_monitoria", { ascending: true })
    .limit(maxFilas);
  if (lista.error) throw new Error(`No se pudieron leer las citas sin plazo para cancelar: ${lista.error.message}`);
  const ordenadas = (lista.data ?? []).map((fila) => {
    if (!fila.id_monitoria) throw new Error("La cita está incompleta: falta su id.");
    return { id: fila.id_monitoria, inicio: instante(fila.inicio, "su inicio") };
  });
  const total = lista.count ?? ordenadas.length;
  if (ordenadas.length === 0) return { filas: [], total };

  const ids = ordenadas.map((fila) => fila.id);
  const [monitorias, pagos] = await Promise.all([
    cliente.from("monitoria").select("id, fecha, id_franja, id_materia, id_monitor, id_lead").in("id", ids),
    cliente.from("pago").select("id_monitoria, estado").in("id_monitoria", ids),
  ]);
  const fallo = monitorias.error ?? pagos.error;
  if (fallo) throw new Error(`No se pudieron leer las citas sin plazo para cancelar: ${fallo.message}`);
  const delasMonitorias = monitorias.data ?? [];

  const [franjas, materias, monitores, leads] = await Promise.all([
    cliente.from("franja").select("id, hora, duracion_min").in("id", unicos(delasMonitorias.map((m) => m.id_franja))),
    cliente.from("materia").select("id, nombre").in("id", unicos(delasMonitorias.map((m) => m.id_materia))),
    cliente.from("monitor").select("id, nombre").in("id", unicos(delasMonitorias.map((m) => m.id_monitor))),
    cliente.from("lead").select("id, nombre, correo, numero_telefono").in("id", unicos(delasMonitorias.map((m) => m.id_lead))),
  ]);
  const falloDeNombres = franjas.error ?? materias.error ?? monitores.error ?? leads.error;
  if (falloDeNombres) throw new Error(`No se pudieron leer las citas sin plazo para cancelar: ${falloDeNombres.message}`);

  const monitoriaDe = new Map(delasMonitorias.map((m) => [m.id, m]));
  const franjaDe = new Map((franjas.data ?? []).map((f) => [f.id, f]));
  const materiaDe = new Map((materias.data ?? []).map((m) => [m.id, m.nombre]));
  const monitorDe = new Map((monitores.data ?? []).map((m) => [m.id, m.nombre]));
  const leadDe = new Map((leads.data ?? []).map((l) => [l.id, l]));
  const pagosDe = new Map<string, { estado: PagoDeLaCita["estado"] }[]>();
  for (const pago of pagos.data ?? []) pagosDe.set(pago.id_monitoria, [...(pagosDe.get(pago.id_monitoria) ?? []), { estado: pago.estado }]);

  // El orden es el de la vista, no el de las consultas siguientes.
  const filas = ordenadas.map(({ id, inicio }): CitaSinPlazo => {
    const m = monitoriaDe.get(id);
    const franja = m && franjaDe.get(m.id_franja);
    const nombreMateria = m && materiaDe.get(m.id_materia);
    const nombreMonitor = m && monitorDe.get(m.id_monitor);
    const lead = m && leadDe.get(m.id_lead);
    if (!m || !franja || nombreMateria === undefined || nombreMonitor === undefined || !lead) {
      throw new Error(`La cita ${id} está incompleta.`);
    }
    return {
      id,
      inicio,
      fecha: m.fecha,
      hora: franja.hora,
      duracionMin: franja.duracion_min,
      nombreMateria,
      nombreMonitor,
      lead: { nombre: lead.nombre, correo: lead.correo, telefono: lead.numero_telefono },
      estadoPago: estadoDePagoDeLaCita(pagosDe.get(id) ?? []),
    };
  });
  return { filas, total };
}

/** Un pago de la cita con lo que el admin pesa: quién pagó, cuánto, cómo va, y su reembolso si ya nació. */
export type PagoParaAutorizar = PagoDeLaCita & {
  id: string;
  reembolso: { id: string; estado: EstadoDeReembolso } | null;
};

export type CitaParaAutorizar = {
  id: string;
  estado: EstadoDeMonitoria;
  motivoCancelacion: MotivoDeCancelacion | null;
  /** Día de calendario, `AAAA-MM-DD`. */
  fecha: string;
  /** Hora de inicio en la zona del negocio, `HH:MM:SS`. */
  hora: string;
  duracionMin: number;
  nombreMateria: string;
  nombreMonitor: string;
  /** Quien agendó. El admin gestiona el caso, así que ve su contacto. */
  lead: Contacto;
  inicio: Date;
  /** Hasta aquí quien agendó cancela solo: con el instante exacto todavía hay plazo (P-40). */
  cancelableHasta: Date;
  grupal: boolean;
  pagos: PagoParaAutorizar[];
  /** La autorización ya registrada, si esta cancelación se autorizó. Solo la leen los admins. */
  autorizacion: AutorizacionRegistrada | null;
};

/**
 * Una cita con los datos que el admin pesa al autorizar (criterio 2): quién agendó y cómo contactarlo, el monitor (solo su
 * nombre), los pagos con su reembolso y, si ya se autorizó, quién, cuándo, el motivo y la nota. `null` si no existe. Cualquier
 * admin activo la lee; a otro rol las políticas se la esconden y también da `null`. La suma a devolver sale de los `monto` de
 * los pagos aprobados (lo que el pagador pagó, RN-60). Cada instante se valida aquí: el motor de plazos lanza con una fecha
 * inválida y eso no debe pasar al pintar la página.
 */
export async function cargarCitaParaAutorizar(cliente: Cliente, id: string): Promise<CitaParaAutorizar | null> {
  const leida = await cliente
    .from("monitoria")
    .select("estado, motivo_cancelacion, fecha, id_franja, id_materia, id_monitor, id_lead")
    .eq("id", id)
    .maybeSingle();
  if (leida.error) throw new Error(`No se pudo leer la cita: ${leida.error.message}`);
  const m = leida.data;
  if (!m) return null;

  const [plazos, franja, materia, monitor, lead, pagos, autorizacion] = await Promise.all([
    cliente.from("monitoria_plazos").select("inicio, cancelable_hasta, es_grupal").eq("id_monitoria", id).maybeSingle(),
    cliente.from("franja").select("hora, duracion_min").eq("id", m.id_franja).single(),
    cliente.from("materia").select("nombre").eq("id", m.id_materia).single(),
    cliente.from("monitor").select("nombre").eq("id", m.id_monitor).single(),
    cliente.from("lead").select("nombre, correo, numero_telefono").eq("id", m.id_lead).single(),
    cliente
      .from("pago")
      .select("id, nombre_pagador, monto, estado, reembolso(id, estado)")
      .eq("id_monitoria", id)
      .order("fecha_pago", { ascending: true })
      .order("id", { ascending: true }),
    cliente
      .from("cancelacion_excepcional")
      .select("categoria, nota, autorizada_en, id_admin, admin(nombre)")
      .eq("id_monitoria", id)
      .maybeSingle(),
  ]);
  const fallo = plazos.error ?? franja.error ?? materia.error ?? monitor.error ?? lead.error ?? pagos.error ?? autorizacion.error;
  if (fallo) throw new Error(`No se pudo leer la cita: ${fallo.message}`);
  if (!plazos.data || plazos.data.es_grupal === null || !franja.data || !materia.data || !monitor.data || !lead.data) {
    throw new Error("La cita está incompleta.");
  }
  const inicio = instante(plazos.data.inicio, "su inicio");
  const cancelableHasta = instante(plazos.data.cancelable_hasta, "el fin de su plazo");

  const registro = autorizacion.data;
  let autorizada: AutorizacionRegistrada | null = null;
  if (registro) {
    if (!esCategoria(registro.categoria) || !registro.admin) throw new Error("La autorización de la cita está incompleta.");
    autorizada = {
      categoria: registro.categoria,
      nota: registro.nota,
      autorizadaEn: instante(registro.autorizada_en, "la hora de la autorización"),
      idAdmin: registro.id_admin,
      nombreAdmin: registro.admin.nombre,
    };
  }

  return {
    id,
    estado: m.estado,
    motivoCancelacion: m.motivo_cancelacion,
    fecha: m.fecha,
    hora: franja.data.hora,
    duracionMin: franja.data.duracion_min,
    nombreMateria: materia.data.nombre,
    nombreMonitor: monitor.data.nombre,
    lead: { nombre: lead.data.nombre, correo: lead.data.correo, telefono: lead.data.numero_telefono },
    inicio,
    cancelableHasta,
    grupal: plazos.data.es_grupal,
    pagos: (pagos.data ?? []).map((pago) => ({
      id: pago.id,
      nombrePagador: pago.nombre_pagador,
      monto: pago.monto,
      estado: pago.estado,
      reembolso: pago.reembolso ? { id: pago.reembolso.id, estado: pago.reembolso.estado } : null,
    })),
    autorizacion: autorizada,
  };
}

/**
 * Autoriza la cancelación con la sesión de `cliente` (sin vuelta atrás). La base comprueba que la sesión sea un admin
 * activo, que la cita siga confirmada, individual, con el plazo vencido y sin empezar, y la cancela con sus reembolsos y su
 * registro en una transacción. Sin nota se manda el texto vacío, que la base toma como ninguna.
 */
export async function autorizarCancelacion(cliente: Cliente, pedido: PedidoDeAutorizacion): Promise<ResultadoDeAutorizacion> {
  const { data, error } = await cliente.rpc("autorizar_cancelacion_fuera_de_plazo", {
    p_id_monitoria: pedido.idMonitoria,
    p_categoria: pedido.categoria,
    p_nota: pedido.nota ?? "",
  });
  // Solo el código y el mensaje: el detalle de PostgREST podría traer la nota o la fila.
  if (error) throw new Error(`No se pudo autorizar la cancelación: ${error.code ?? ""} ${error.message}`.trim());
  if (!esResultadoDeAutorizacion(data)) throw new Error(`Respuesta inesperada al autorizar la cancelación: ${JSON.stringify(data ?? null)}`);
  return data;
}
