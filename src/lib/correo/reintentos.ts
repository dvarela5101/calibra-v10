import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import type { EntradaDeEnvio, ResultadoEnvio } from "./enviar";
import { esPlantilla, type Plantilla, type Reconstruccion } from "./plantillas";
import { limpiarError } from "./proveedor";

/**
 * Reintentos de correos que fallaron (HU-065). Un proceso programado (pg_cron, cada 10 minutos, ver la
 * migración `*_reintento_correos.sql`) llama a la ruta `/api/procesos/reintentar-correos`, que corre
 * `reintentarCorreosFallidos`.
 *
 * Toma los correos `fallido` y `reintentable` de las últimas 24 horas, reconstruye sus datos a partir
 * de la entidad (el registro no guarda el cuerpo) y los vuelve a mandar con la misma plantilla y la
 * misma entidad: la misma clave, la misma fila, sin duplicados. Lo que falló de forma definitiva, o
 * sigue fallando después de 24 horas, queda para el admin en su bandeja.
 */

export const VENTANA_DE_REINTENTO_MS = 24 * 60 * 60_000;

/** Cuántos correos toma cada corrida. Con envíos de pocos segundos, cabe de sobra en la corrida. */
export const LOTE_DE_REINTENTOS = 25;

/**
 * Cómo reconstruir los datos de cada plantilla a partir de su entidad. `null` si la entidad ya no
 * aplica (por ejemplo, la invitación se usó o venció): ese correo ya no se manda.
 */
export type Reconstructor<P extends Plantilla> = (entidad: string) => Promise<Reconstruccion<P> | null>;

/**
 * Un reconstructor por plantilla. `null` mientras ninguna HU dispare esa plantilla: la primera que la
 * dispare escribe su reconstructor (HU-065, notas técnicas), y una prueba lo exige.
 */
export type Reconstructores = { [P in Plantilla]: Reconstructor<P> | null };

export type ResumenDeReintentos = {
  revisados: number;
  enviados: number;
  siguenFallando: number;
  descartados: number;
  conError: number;
  /** Otra corrida simultánea tomó la fila primero. */
  tomadosPorOtro: number;
};

type Cliente = SupabaseClient<Database>;

export type DependenciasDeReintento = {
  /** Cliente con la llave secreta: `correo_envio` solo la escribe el servidor. */
  cliente: Cliente;
  reconstructores: Reconstructores;
  enviar: <P extends Plantilla>(entrada: EntradaDeEnvio<P>) => Promise<ResultadoEnvio>;
  ahora?: Date;
  lote?: number;
};

/** La entidad de una clave `plantilla:entidad`, o `null` si la clave no es de esa plantilla. */
export function entidadDeClave(clave: string, plantilla: string): string | null {
  const prefijo = `${plantilla}:`;
  if (!clave.startsWith(prefijo)) return null;
  const entidad = clave.slice(prefijo.length);
  return entidad ? entidad : null;
}

export async function reintentarCorreosFallidos({
  cliente,
  reconstructores,
  enviar,
  ahora = new Date(),
  lote = LOTE_DE_REINTENTOS,
}: DependenciasDeReintento): Promise<ResumenDeReintentos> {
  const desde = new Date(ahora.getTime() - VENTANA_DE_REINTENTO_MS).toISOString();
  const { data: filas, error } = await cliente
    .from("correo_envio")
    .select("id, clave, plantilla, actualizado_en")
    .eq("estado", "fallido")
    .eq("reintentable", true)
    .gt("creado_en", desde)
    // Los que llevan más tiempo esperando van primero.
    .order("actualizado_en", { ascending: true })
    .limit(lote);
  if (error) throw new Error(`No se pudieron leer los correos por reintentar: ${error.message}`);

  const resumen: ResumenDeReintentos = {
    revisados: filas.length,
    enviados: 0,
    siguenFallando: 0,
    descartados: 0,
    conError: 0,
    tomadosPorOtro: 0,
  };

  /**
   * Toma la fila antes de reconstruir el correo: si dos corridas se solapan, solo una la reconstruye.
   * Importa porque reconstruir puede cambiar algo (la invitación rota su token): si las dos lo hicieran,
   * saldría un solo correo con el enlace de la corrida que no lo mandó. Es el mismo candado de
   * `registro.reservar`: un UPDATE condicionado a que `actualizado_en` no haya cambiado.
   */
  const tomar = async (fila: { id: string; actualizado_en: string }) => {
    const { data, error: errorAlTomar } = await cliente
      .from("correo_envio")
      .update({ actualizado_en: ahora.toISOString() })
      .eq("id", fila.id)
      .eq("estado", "fallido")
      .eq("actualizado_en", fila.actualizado_en)
      .select("id");
    if (errorAlTomar) throw new Error(errorAlTomar.message);
    return data.length === 1;
  };

  /** Deja de reintentar un correo: queda `fallido` y el admin lo ve en su bandeja. */
  const descartar = async (id: string, motivo: string) => {
    const { error: errorAlDescartar } = await cliente
      .from("correo_envio")
      .update({ reintentable: false, ultimo_error: limpiarError(motivo), actualizado_en: ahora.toISOString() })
      .eq("id", id)
      .eq("estado", "fallido");
    if (errorAlDescartar) throw new Error(errorAlDescartar.message);
    resumen.descartados += 1;
  };

  for (const fila of filas) {
    try {
      const entidad = esPlantilla(fila.plantilla) ? entidadDeClave(fila.clave, fila.plantilla) : null;
      if (!esPlantilla(fila.plantilla) || entidad === null) {
        await descartar(fila.id, `No se reconoce la plantilla o la clave del correo (${fila.plantilla}).`);
        continue;
      }
      const reconstructor = reconstructores[fila.plantilla] as Reconstructor<Plantilla> | null;
      if (!reconstructor) {
        await descartar(fila.id, "No hay cómo reconstruir este correo para reintentarlo.");
        continue;
      }
      if (!(await tomar(fila))) {
        resumen.tomadosPorOtro += 1;
        continue;
      }
      const reconstruido = await reconstructor(entidad);
      if (!reconstruido) {
        await descartar(fila.id, "El correo ya no aplica: lo que lo motivó cambió (por ejemplo, la invitación venció o se usó).");
        continue;
      }
      const resultado = await enviar({
        plantilla: fila.plantilla,
        datos: reconstruido.datos,
        destinatario: reconstruido.destinatario,
        entidad,
      });
      if (resultado.ok) resumen.enviados += 1;
      else resumen.siguenFallando += 1;
    } catch (errorDeLaFila) {
      // Un correo que no se pudo reconstruir no detiene a los demás; la próxima corrida lo vuelve a intentar.
      resumen.conError += 1;
      const mensaje = errorDeLaFila instanceof Error ? errorDeLaFila.message : String(errorDeLaFila);
      console.error(`[correo] no se pudo reintentar ${fila.id}: ${limpiarError(mensaje)}`);
    }
  }
  return resumen;
}
