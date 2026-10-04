import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MOTIVOS_DE_CANCELACION } from "@/lib/citas/reglas";
import {
  instanteIso,
  MAXIMO_DE_INTENTOS,
  PRESUPUESTO_DE_CORRIDA_MS,
  UUID,
  type DependenciasDeConfirmaciones,
  type ResumenDeConfirmaciones,
} from "@/lib/citas/servidor";
import type { DatosPorPlantilla, Reconstruccion } from "@/lib/correo/plantillas";
import { enviarCorreoDesdeServidor, urlDelSitio, type ResultadoEnvio } from "@/lib/correo/servidor";
import { correoConsultasDatos } from "@/lib/privacidad/consentimiento";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import {
  datosDelPedido,
  datosDelRecordatorio,
  ESTADOS_DE_REEMBOLSO,
  pedidoVigente,
  plantillaDelPedido,
  TIPOS_DE_PEDIDO,
  type PedidoDeLlave,
  type PlantillaDePedido,
} from "./reglas";

/**
 * Los correos que piden la llave de un reembolso (HU-025, P-10, P-22). La base los anota en `public.pedido_llave`
 * (al crearse el reembolso, a los 3 días, al reabrirlo y al reenviarlo) y le pide a la app que los mande por
 * `/api/procesos/pedir-llaves`. El procesador copia el de la cancelación (HU-024), que copia el de la confirmación
 * (HU-019): HU-079 los unifica. La entidad de cada correo es el id de su fila en `pedido_llave`, así que el reintento
 * (HU-065) reconstruye el mismo correo y un mismo reembolso puede recibir varios sin chocar.
 */

type Cliente = SupabaseClient<Database>;
type FilaDeDatos = Database["public"]["Functions"]["datos_de_pedido_llave"]["Returns"][number];

/** Cuántos pedidos toma cada corrida. Lo normal es uno o pocos: la base los pide al anotarlos. */
export const LOTE_DE_PEDIDOS = 10;

function uno<T extends string>(valores: readonly T[], valor: string, campo: string): T {
  const encontrado = valores.find((v) => v === valor);
  if (!encontrado) throw new Error(`${campo} desconocido en el pedido de la llave: ${valor}`);
  return encontrado;
}

function pedidoDeFila(fila: FilaDeDatos): PedidoDeLlave {
  return {
    tipo: uno(TIPOS_DE_PEDIDO, fila.tipo, "Tipo"),
    // Siempre en ISO: el cuerpo del correo no puede cambiar entre un envío y su reintento.
    plazoDesde: instanteIso(fila.plazo_desde),
    venceEn: instanteIso(fila.vence_en),
    plazoLlaveDesde: instanteIso(fila.plazo_llave_desde),
    estado: uno(ESTADOS_DE_REEMBOLSO, fila.estado, "Estado del reembolso"),
    // El tipo generado dice que siempre vienen, pero un caso abierto no tiene cierre y una monitoría sin cancelar no
    // tiene motivo.
    cerradoEn: fila.cerrado_en == null ? null : instanteIso(fila.cerrado_en),
    enCorreoDeCancelacion: fila.en_correo_de_cancelacion,
    contacto: fila.contacto,
    nombrePagador: fila.nombre_pagador,
    monto: fila.monto,
    motivo: fila.motivo,
    token: fila.token,
    motivoCancelacion: fila.motivo_cancelacion == null ? null : uno(MOTIVOS_DE_CANCELACION, fila.motivo_cancelacion, "Motivo de cancelación"),
  };
}

/** Los datos de un pedido, con la llave secreta. `null` si no existe (se borró su reembolso). */
async function leerPedido(cliente: Cliente, idPedido: string): Promise<PedidoDeLlave | null> {
  const { data, error } = await cliente.rpc("datos_de_pedido_llave", { p_id: idPedido });
  // El mensaje del error no lleva el token: una falla de la base no deja una credencial en el log.
  if (error) throw new Error(`No se pudieron leer los datos del pedido de la llave: ${error.message}`);
  const fila = data?.[0];
  return fila ? pedidoDeFila(fila) : null;
}

/**
 * El correo de un pedido con su plantilla, o `null` si ya no se manda: el id no es un uuid, el pedido no existe, es de
 * la otra plantilla o ya no vale (`pedidoVigente`). También si no hay a quién escribirle, y eso deja rastro.
 */
async function reconstruir<P extends PlantillaDePedido>(
  plantilla: P,
  idPedido: string,
  cliente: Cliente,
  datos: (p: PedidoDeLlave, url: (ruta: string) => string, contactoSoporte: string | null) => DatosPorPlantilla[P],
): Promise<Reconstruccion<P> | null> {
  if (!UUID.test(idPedido)) return null;
  const p = await leerPedido(cliente, idPedido);
  if (!p || plantillaDelPedido(p.tipo) !== plantilla || !pedidoVigente(p, new Date())) return null;
  const destinatario = p.contacto.trim();
  if (!destinatario) {
    console.warn(`[reembolsos] el pedido de la llave ${idPedido} no tiene a quién escribirle: no se manda.`);
    return null;
  }
  return { destinatario, datos: datos(p, urlDelSitio, correoConsultasDatos()) };
}

/**
 * Para mandar o reintentar el pedido de la llave (HU-065): el pedido al crearse el reembolso, la reapertura o el
 * reenvío. La entidad es el id del pedido. Va a `pago.contacto`, con el enlace a la página de la llave y la fecha en
 * que vence el plazo de su ciclo.
 */
export function reconstruirPedidoDeLlave(
  idPedido: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"solicitud_llave_reembolso"> | null> {
  return reconstruir("solicitud_llave_reembolso", idPedido, cliente, datosDelPedido);
}

/** Para mandar o reintentar el recordatorio de la llave (HU-065), con las mismas reglas que el pedido. */
export function reconstruirRecordatorioDeLlave(
  idPedido: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"recordatorio_llave_reembolso"> | null> {
  return reconstruir("recordatorio_llave_reembolso", idPedido, cliente, datosDelRecordatorio);
}

/** El mismo resumen que las confirmaciones: cada correo termina enviado, descartado, fallido, tomado por otro o con error. */
export type ResumenDePedidos = ResumenDeConfirmaciones;

/** Las mismas dependencias que las confirmaciones: `pedido_llave` también la lee y la marca solo el servidor. */
export type DependenciasDePedidos = DependenciasDeConfirmaciones;

type Pedido = { id: string; tipo: string; intentos: number };

/** Manda el correo de un pedido con la plantilla de su tipo. `null` si ya no se manda. */
async function mandar(pedido: Pedido, cliente: Cliente, enviar: DependenciasDePedidos["enviar"]): Promise<ResultadoEnvio | null> {
  // Cada reconstructor vuelve a mirar el tipo con lo que diga la base.
  if (pedido.tipo === "recordatorio") {
    const correo = await reconstruirRecordatorioDeLlave(pedido.id, cliente);
    return correo && enviar({ plantilla: "recordatorio_llave_reembolso", ...correo, entidad: pedido.id });
  }
  const correo = await reconstruirPedidoDeLlave(pedido.id, cliente);
  return correo && enviar({ plantilla: "solicitud_llave_reembolso", ...correo, entidad: pedido.id });
}

/**
 * Manda los pedidos de llave pendientes, del más antiguo al más reciente. Funciona como `procesarCancelacionesDeCita`:
 * cada uno queda procesado cuando su correo queda en `correo_envio` (enviado, o fallido para reintentar) o cuando ya no
 * vale; si no se pudo procesar, suma un intento y se abandona al llegar a `MAXIMO_DE_INTENTOS`. Dos corridas a la vez no
 * lo mandan dos veces: la clave del correo (`<plantilla>:<id del pedido>`) es única.
 */
export async function procesarPedidosDeLlave(dependencias?: Partial<DependenciasDePedidos>): Promise<ResumenDePedidos> {
  const cliente = dependencias?.cliente ?? crearClienteAdmin();
  const enviar = dependencias?.enviar ?? enviarCorreoDesdeServidor;
  const reloj = dependencias?.reloj ?? Date.now;
  const inicio = reloj();
  const resumen: ResumenDePedidos = { revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 };

  const { data: pedidos, error } = await cliente
    .from("pedido_llave")
    .select("id, tipo, intentos")
    .is("procesado_en", null)
    .order("creada_en")
    .limit(LOTE_DE_PEDIDOS);
  if (error) throw new Error(`No se pudieron leer los pedidos de llave: ${error.message}`);

  for (const pedido of pedidos ?? []) {
    resumen.revisadas++;
    if (reloj() - inicio >= PRESUPUESTO_DE_CORRIDA_MS) {
      resumen.pospuestas++;
      continue;
    }
    try {
      const resultado = await mandar(pedido, cliente, enviar);
      if (!resultado) {
        resumen.descartadas++;
      } else if (resultado.ok) {
        resumen.enviadas++;
      } else if (resultado.motivo === "en_curso") {
        resumen.tomadasPorOtro++;
      } else if (resultado.motivo === "fallo_del_registro") {
        // Sin registro no hay reintento de HU-065: el pedido vuelve a intentarse en otra corrida.
        throw new Error(resultado.error);
      } else {
        // Quedó `fallido` en el registro (o el contacto no es un correo): HU-065 y la bandeja del admin.
        console.error(`[reembolsos] el pedido de la llave ${pedido.id} no salió: ${resultado.error}`);
        resumen.fallidas++;
      }
      await marcar(cliente, pedido, { procesado_en: new Date().toISOString() });
    } catch (falla) {
      resumen.conError++;
      await sumarIntento(cliente, pedido, falla);
    }
  }
  return resumen;
}

async function marcar(cliente: Cliente, pedido: Pedido, cambios: { procesado_en?: string; intentos?: number }): Promise<void> {
  const { error } = await cliente.from("pedido_llave").update(cambios).eq("id", pedido.id);
  if (error) throw new Error(`No se pudo marcar el pedido de la llave: ${error.message}`);
}

/** Suma un intento fallido; al llegar al máximo, abandona el pedido (queda procesado y se avisa en el log). */
async function sumarIntento(cliente: Cliente, pedido: Pedido, falla: unknown): Promise<void> {
  const mensaje = falla instanceof Error ? falla.message : String(falla);
  const intentos = pedido.intentos + 1;
  const abandonar = intentos >= MAXIMO_DE_INTENTOS;
  console.error(`[reembolsos] no se pudo procesar el pedido de la llave ${pedido.id} (intento ${intentos}${abandonar ? ", se abandona" : ""}): ${mensaje}`);
  try {
    await marcar(cliente, pedido, abandonar ? { intentos, procesado_en: new Date().toISOString() } : { intentos });
  } catch (otra) {
    console.error("[reembolsos] tampoco se pudo anotar el intento:", otra instanceof Error ? otra.message : otra);
  }
}
