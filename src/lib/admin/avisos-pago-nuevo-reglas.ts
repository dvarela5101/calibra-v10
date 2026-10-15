import type { Reconstruccion } from "@/lib/correo/plantillas";
import type { EstadoDePago } from "./pagos-reglas";

/**
 * El aviso a los admins de que llegó un pago por revisar (HU-034, D-56). Aquí va lo puro: la entidad del correo, quién
 * está baneado y los datos del correo. La base anota un aviso por cada admin activo al llegar el pago (trigger sobre
 * `pago`, con el responsable de ese momento como foto) y el procesador (`avisos-pago-nuevo.ts`) lo manda.
 */

/**
 * La entidad del correo: el pago y el admin que lo recibe, `<id_pago>:<id_admin>`. La clave del correo es la plantilla
 * más la entidad, así que cada admin recibe un solo correo por pago aunque dos corridas lo procesen a la vez. Dos uuid y
 * dos puntos: ASCII imprimible, como pide la Idempotency-Key.
 */
export function entidadDeAvisoDePagoNuevo(idPago: string, idAdmin: string): string {
  return `${idPago}:${idAdmin}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATRON_DE_ENTIDAD = new RegExp(`^(${UUID}):(${UUID})$`, "i");

/** El pago y el admin de una entidad, o `null` si no tiene la forma `<id_pago>:<id_admin>` con dos uuid. */
export function partirEntidadDeAvisoDePagoNuevo(entidad: string): { idPago: string; idAdmin: string } | null {
  const partes = PATRON_DE_ENTIDAD.exec(entidad);
  return partes && { idPago: partes[1], idAdmin: partes[2] };
}

/**
 * ¿Auth tiene baneada la cuenta ahora? `banned_until` es el fin del baneo (`desactivarCuenta` lo pone a cien años). Sin
 * baneo, o con uno ya vencido, la cuenta cuenta como activa, igual que en la base. Con un valor que no es una fecha no
 * se puede decir que esté baneada.
 */
export function tieneBaneoVigente(bannedUntil: string | null | undefined, ahora: Date): boolean {
  if (!bannedUntil) return false;
  const hasta = new Date(bannedUntil).getTime();
  return !Number.isNaN(hasta) && hasta > ahora.getTime();
}

export type PagoParaElAvisoDePagoNuevo = { estado: EstadoDePago; nombrePagador: string; monto: number };
export type AdminParaElAviso = { id: string; nombre: string; correo: string };

/**
 * El correo `aviso_admin_pago_nuevo` para un admin, a su `admin.correo` (criterio 5). `responsable` es el admin al que le
 * tocaba el pago al llegar (la foto del aviso, no `pago.id_admin`): `nombreResponsable` es `null` si es el mismo
 * destinatario. Es `null` si el pago ya no está en revisión: lo revisó otro admin y el aviso ya no sirve. No lleva el
 * contacto del pagador, ni el comprobante, ni cifras de comisión. Lo usan el primer envío y el reintento (HU-065): los
 * mismos datos dan el mismo correo.
 */
export function correoDeAvisoDePagoNuevo(entrada: {
  pago: PagoParaElAvisoDePagoNuevo;
  destinatario: AdminParaElAviso;
  responsable: Pick<AdminParaElAviso, "id" | "nombre">;
  enlace: string;
}): Reconstruccion<"aviso_admin_pago_nuevo"> | null {
  const { pago, destinatario, responsable, enlace } = entrada;
  if (pago.estado !== "en_revision") return null;
  return {
    destinatario: destinatario.correo,
    datos: {
      nombreAdmin: destinatario.nombre,
      nombrePagador: pago.nombrePagador,
      monto: pago.monto,
      nombreResponsable: responsable.id === destinatario.id ? null : responsable.nombre,
      enlace,
    },
  };
}
