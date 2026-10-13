import "server-only";
import { LOTE_POR_DEFECTO, procesarBandeja, type Cliente, type DefinicionDeBandeja, type DependenciasDeBandeja, type ResumenDeBandeja } from "@/lib/correo/bandeja";
import type { ResultadoEnvio } from "@/lib/correo/servidor";
import { esCasoDeAvisoDeRechazo, type CasoDeAvisoDeRechazo } from "./avisos-rechazo-reglas";
import { reconstruirPagoRechazado, reconstruirPagoRechazadoSinReembolso } from "./pagos";

/** Cuántos avisos toma cada corrida. Lo normal es uno por corrida: la base la pide al anotarlo. */
export const LOTE_DE_AVISOS_DE_RECHAZO = LOTE_POR_DEFECTO;

/** El mismo resumen que las cancelaciones: cada aviso termina enviado, descartado, fallido, tomado por otro o con error. */
export type ResumenDeAvisosDeRechazo = ResumenDeBandeja;

/** Las mismas dependencias que las cancelaciones: `aviso_rechazo_pago` solo la lee y la marca el servidor. */
export type DependenciasDeAvisosDeRechazo = DependenciasDeBandeja;

type Aviso = { id: string; id_pago: string; caso: string; intentos: number };

/** Manda el correo del aviso según su caso, o `null` si ya no vale (el caso no se conoce o el pago cambió). */
async function mandarAviso(
  cliente: Cliente,
  enviar: DependenciasDeAvisosDeRechazo["enviar"],
  caso: CasoDeAvisoDeRechazo,
  idPago: string,
): Promise<ResultadoEnvio | null> {
  if (caso === "cita_cancelada") {
    const correo = await reconstruirPagoRechazado(idPago, cliente);
    return correo && enviar({ plantilla: "pago_rechazado_individual", ...correo, entidad: idPago });
  }
  const correo = await reconstruirPagoRechazadoSinReembolso(idPago, cliente);
  return correo && enviar({ plantilla: "pago_rechazado_sin_reembolso", ...correo, entidad: idPago });
}

const BANDEJA = {
  prefijo: "pagos",
  tabla: "aviso_rechazo_pago",
  lote: LOTE_DE_AVISOS_DE_RECHAZO,
  lectura: { columnas: "id, id_pago, caso, intentos", orden: "creado_en" },
  textos: { leer: "No se pudieron leer los avisos de rechazo", marcar: "No se pudo marcar el aviso de rechazo" },
  nombrar: (aviso) => `el aviso del rechazo del pago ${aviso.id_pago}`,
  mandar: (aviso, { cliente, enviar }) => (esCasoDeAvisoDeRechazo(aviso.caso) ? mandarAviso(cliente, enviar, aviso.caso, aviso.id_pago) : Promise.resolve(null)),
} satisfies DefinicionDeBandeja<Aviso>;

/**
 * Manda los avisos de rechazo de pago pendientes (HU-076) con `procesarBandeja`, del más antiguo al más reciente. Dos
 * corridas a la vez no lo mandan dos veces: la clave del correo (`pago_rechazado_individual:<id_pago>` o
 * `pago_rechazado_sin_reembolso:<id_pago>`) es única. El caso lo fijó la base al rechazar; el correo no caduca: sigue
 * siendo cierto aunque la sesión ya haya pasado.
 */
export function procesarAvisosDeRechazoDePago(dependencias?: Partial<DependenciasDeAvisosDeRechazo>): Promise<ResumenDeAvisosDeRechazo> {
  return procesarBandeja(BANDEJA, dependencias);
}
