import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAXIMO_DE_INTENTOS, PRESUPUESTO_DE_CORRIDA_MS, type DependenciasDeConfirmaciones, type ResumenDeConfirmaciones } from "@/lib/citas/servidor";
import { enviarCorreoDesdeServidor, type ResultadoEnvio } from "@/lib/correo/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import { esCasoDeAvisoDeRechazo, type CasoDeAvisoDeRechazo } from "./avisos-rechazo-reglas";
import { reconstruirPagoRechazado, reconstruirPagoRechazadoSinReembolso } from "./pagos";

type Cliente = SupabaseClient<Database>;

/** Cuántos avisos toma cada corrida. Lo normal es uno por corrida: la base la pide al anotarlo. */
export const LOTE_DE_AVISOS_DE_RECHAZO = 10;

/** El mismo resumen que las cancelaciones: cada aviso termina enviado, descartado, fallido, tomado por otro o con error. */
export type ResumenDeAvisosDeRechazo = ResumenDeConfirmaciones;

/** Las mismas dependencias que las cancelaciones: `aviso_rechazo_pago` solo la lee y la marca el servidor. */
export type DependenciasDeAvisosDeRechazo = DependenciasDeConfirmaciones;

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

/**
 * Manda los avisos de rechazo de pago pendientes (HU-076), del más antiguo al más reciente. Funciona como
 * `procesarCancelacionesDeCita`: cada uno queda procesado cuando su correo queda en `correo_envio` (enviado, o fallido
 * para reintentar) o cuando ya no vale; si no se pudo procesar, suma un intento y se abandona al llegar a
 * `MAXIMO_DE_INTENTOS`. Dos corridas a la vez no lo mandan dos veces: la clave del correo
 * (`pago_rechazado_individual:<id_pago>` o `pago_rechazado_sin_reembolso:<id_pago>`) es única. El caso lo fijó la
 * base al rechazar; el correo no caduca: sigue siendo cierto aunque la sesión ya haya pasado.
 */
export async function procesarAvisosDeRechazoDePago(dependencias?: Partial<DependenciasDeAvisosDeRechazo>): Promise<ResumenDeAvisosDeRechazo> {
  const cliente = dependencias?.cliente ?? crearClienteAdmin();
  const enviar = dependencias?.enviar ?? enviarCorreoDesdeServidor;
  const reloj = dependencias?.reloj ?? Date.now;
  const inicio = reloj();
  const resumen: ResumenDeAvisosDeRechazo = { revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 };

  const { data: avisos, error } = await cliente
    .from("aviso_rechazo_pago")
    .select("id, id_pago, caso, intentos")
    .is("procesado_en", null)
    .order("creado_en")
    .limit(LOTE_DE_AVISOS_DE_RECHAZO);
  if (error) throw new Error(`No se pudieron leer los avisos de rechazo: ${error.message}`);

  for (const aviso of avisos ?? []) {
    resumen.revisadas++;
    if (reloj() - inicio >= PRESUPUESTO_DE_CORRIDA_MS) {
      resumen.pospuestas++;
      continue;
    }
    try {
      const resultado = esCasoDeAvisoDeRechazo(aviso.caso) ? await mandarAviso(cliente, enviar, aviso.caso, aviso.id_pago) : null;
      if (!resultado) {
        resumen.descartadas++;
      } else if (resultado.ok) {
        resumen.enviadas++;
      } else if (resultado.motivo === "en_curso") {
        resumen.tomadasPorOtro++;
      } else if (resultado.motivo === "fallo_del_registro") {
        // Sin registro no hay reintento de HU-065: el aviso vuelve a intentarse en otra corrida.
        throw new Error(resultado.error);
      } else {
        // Quedó `fallido` en el registro (o el contacto del pagador no es un correo): HU-065 y la bandeja del admin.
        console.error(`[pagos] el aviso del rechazo del pago ${aviso.id_pago} no salió: ${resultado.error}`);
        resumen.fallidas++;
      }
      await marcar(cliente, aviso, { procesado_en: new Date().toISOString() });
    } catch (falla) {
      resumen.conError++;
      await sumarIntento(cliente, aviso, falla);
    }
  }
  return resumen;
}

async function marcar(cliente: Cliente, aviso: Aviso, cambios: { procesado_en?: string; intentos?: number }): Promise<void> {
  const { error } = await cliente.from("aviso_rechazo_pago").update(cambios).eq("id", aviso.id);
  if (error) throw new Error(`No se pudo marcar el aviso de rechazo: ${error.message}`);
}

/** Suma un intento fallido; al llegar al máximo, abandona el aviso (queda procesado y se avisa en el log). */
async function sumarIntento(cliente: Cliente, aviso: Aviso, falla: unknown): Promise<void> {
  const mensaje = falla instanceof Error ? falla.message : String(falla);
  const intentos = aviso.intentos + 1;
  const abandonar = intentos >= MAXIMO_DE_INTENTOS;
  console.error(
    `[pagos] no se pudo procesar el aviso del rechazo del pago ${aviso.id_pago} (intento ${intentos}${abandonar ? ", se abandona" : ""}): ${mensaje}`,
  );
  try {
    await marcar(cliente, aviso, abandonar ? { intentos, procesado_en: new Date().toISOString() } : { intentos });
  } catch (otra) {
    console.error("[pagos] tampoco se pudo anotar el intento:", otra instanceof Error ? otra.message : otra);
  }
}
