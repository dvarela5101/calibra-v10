import "server-only";
import { LOTE_POR_DEFECTO, procesarBandeja, type Cliente, type DefinicionDeBandeja, type DependenciasDeBandeja, type ResumenDeBandeja } from "@/lib/correo/bandeja";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { urlDelSitio } from "@/lib/correo/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import {
  correoDeAvisoDePagoNuevo,
  entidadDeAvisoDePagoNuevo,
  partirEntidadDeAvisoDePagoNuevo,
  tieneBaneoVigente,
} from "./avisos-pago-nuevo-reglas";

/** Cuántos avisos toma cada corrida. Con varios admins activos un pago nuevo anota varios: la base pide la corrida al anotarlos. */
export const LOTE_DE_AVISOS_DE_PAGO_NUEVO = LOTE_POR_DEFECTO;

/** El mismo resumen que las demás bandejas: cada aviso termina enviado, descartado, fallido, tomado por otro o con error. */
export type ResumenDeAvisosDePagoNuevo = ResumenDeBandeja;

/** Las mismas dependencias que las demás bandejas: `aviso_pago_nuevo` solo la lee y la marca el servidor. */
export type DependenciasDeAvisosDePagoNuevo = DependenciasDeBandeja;

/**
 * Para mandar o reintentar el correo de un pago nuevo (HU-065). La entidad es `<id_pago>:<id_admin>`. Es `null` si ya no
 * aplica: la entidad no es válida, no hay aviso, el pago ya no está en revisión, el admin no existe o Auth lo tiene
 * baneado. El baneo cubre la ventana de `desactivarCuenta`, que reasigna, banea y vuelve a reasignar en transacciones
 * distintas: hasta el segundo paso el admin sigue siendo activo para la base. Con la llave secreta de `cliente`.
 *
 * El responsable sale del aviso (`id_responsable`, la foto de quién era al llegar el pago) y no de `pago.id_admin`:
 * HU-074 puede reasignar el pago entre el primer envío y el reintento, y el reintento tiene que dar el mismo correo.
 */
export async function reconstruirAvisoPagoNuevo(
  entidad: string,
  cliente: Cliente = crearClienteAdmin(),
  ahora: Date = new Date(),
): Promise<Reconstruccion<"aviso_admin_pago_nuevo"> | null> {
  const partes = partirEntidadDeAvisoDePagoNuevo(entidad);
  if (!partes) return null;
  const { idPago, idAdmin } = partes;

  const { data: pago, error: errorDelPago } = await cliente.from("pago").select("estado, nombre_pagador, monto").eq("id", idPago).maybeSingle();
  if (errorDelPago) throw new Error(`No se pudo leer el pago nuevo: ${errorDelPago.message}`);
  if (!pago || pago.estado !== "en_revision") return null;

  const { data: aviso, error: errorDelAviso } = await cliente
    .from("aviso_pago_nuevo")
    .select("id_responsable")
    .eq("id_pago", idPago)
    .eq("id_admin", idAdmin)
    .maybeSingle();
  if (errorDelAviso) throw new Error(`No se pudo leer el aviso del pago nuevo: ${errorDelAviso.message}`);
  if (!aviso) return null;

  const { data: admins, error: errorDeLosAdmins } = await cliente
    .from("admin")
    .select("id, nombre, correo")
    .in("id", [idAdmin, aviso.id_responsable]);
  if (errorDeLosAdmins) throw new Error(`No se pudieron leer los admins del aviso: ${errorDeLosAdmins.message}`);
  const destinatario = admins?.find((a) => a.id === idAdmin);
  const responsable = admins?.find((a) => a.id === aviso.id_responsable);
  // Los admins no se borran (RN-23): sin el responsable el correo no puede decir a quién le tocaba, y no se inventa.
  if (!destinatario || !responsable) return null;

  const { data: cuenta, error: errorDeAuth } = await cliente.auth.admin.getUserById(idAdmin);
  if (errorDeAuth) throw new Error(`No se pudo leer la cuenta del admin: ${errorDeAuth.message}`);
  if (!cuenta.user || tieneBaneoVigente(cuenta.user.banned_until, ahora)) return null;

  return correoDeAvisoDePagoNuevo({
    pago: { estado: pago.estado, nombrePagador: pago.nombre_pagador, monto: pago.monto },
    destinatario,
    responsable,
    enlace: urlDelSitio(`/admin/pagos/${idPago}`),
  });
}

type Aviso = { id: string; id_pago: string; id_admin: string; intentos: number };

const BANDEJA = {
  prefijo: "pagos",
  tabla: "aviso_pago_nuevo",
  lote: LOTE_DE_AVISOS_DE_PAGO_NUEVO,
  lectura: { columnas: "id, id_pago, id_admin, intentos", orden: "creado_en" },
  textos: { leer: "No se pudieron leer los avisos de pago nuevo", marcar: "No se pudo marcar el aviso de pago nuevo" },
  nombrar: (aviso) => `el aviso del pago nuevo ${aviso.id_pago} para el admin ${aviso.id_admin}`,
  mandar: async (aviso, { cliente, enviar }) => {
    const entidad = entidadDeAvisoDePagoNuevo(aviso.id_pago, aviso.id_admin);
    const correo = await reconstruirAvisoPagoNuevo(entidad, cliente);
    return correo && enviar({ plantilla: "aviso_admin_pago_nuevo", ...correo, entidad });
  },
} satisfies DefinicionDeBandeja<Aviso>;

/**
 * Manda los avisos de pago nuevo pendientes (HU-034) con `procesarBandeja`, del más antiguo al más reciente: un correo
 * por admin activo al llegar el pago. Si el pago ya se revisó, o el admin ya no existe o se desactivó, el correo no sale y
 * el aviso queda procesado. Dos corridas a la vez no lo mandan dos veces: la clave del correo
 * (`aviso_admin_pago_nuevo:<id_pago>:<id_admin>`) es única.
 */
export function procesarAvisosDePagoNuevo(dependencias?: Partial<DependenciasDeAvisosDePagoNuevo>): Promise<ResumenDeAvisosDePagoNuevo> {
  return procesarBandeja(BANDEJA, dependencias);
}
