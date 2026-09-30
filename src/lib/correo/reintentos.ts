import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import type { EntradaDeEnvio, ResultadoEnvio } from "./enviar";
import { esPlantilla, type Plantilla, type Reconstruccion } from "./plantillas";
import { limpiarError } from "./proveedor";
import { PENDIENTE_VENCE_MS } from "./registro";

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

/**
 * Cuántos correos toma cada corrida. Con el proveedor caído, cada uno puede tardar unos 30 s (tres
 * intentos con timeouts de 10 s): el lote es corto y además hay un presupuesto de tiempo.
 */
export const LOTE_DE_REINTENTOS = 10;

/**
 * La corrida deja de tomar correos pasado este tiempo. Un envío con el proveedor caído puede tardar
 * unos 32 s: 20 s más ese envío caben en el límite de la función (60 s).
 */
export const PRESUPUESTO_DE_CORRIDA_MS = 20_000;

/**
 * Un fallido se reintenta cuando lleva al menos este tiempo quieto: da un respiro al proveedor y evita
 * que una corrida tome una fila que otra corrida acaba de tocar.
 */
export const ESPERA_ENTRE_REINTENTOS_MS = 2 * 60_000;

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
  /** Se acabó el presupuesto de tiempo: quedan para la próxima corrida. */
  pospuestos: number;
};

type Cliente = SupabaseClient<Database>;
type EstadoCorreo = Database["public"]["Enums"]["estado_correo"];

export type DependenciasDeReintento = {
  /** Cliente con la llave secreta: `correo_envio` solo la escribe el servidor. */
  cliente: Cliente;
  reconstructores: Reconstructores;
  enviar: <P extends Plantilla>(entrada: EntradaDeEnvio<P>) => Promise<ResultadoEnvio>;
  ahora?: Date;
  lote?: number;
  presupuestoMs?: number;
  /** Milisegundos transcurridos; se inyecta en las pruebas. */
  reloj?: () => number;
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
  presupuestoMs = PRESUPUESTO_DE_CORRIDA_MS,
  reloj = Date.now,
}: DependenciasDeReintento): Promise<ResumenDeReintentos> {
  const inicio = reloj();
  const antes = (ms: number) => new Date(ahora.getTime() - ms).toISOString();
  const { data: filas, error } = await cliente
    .from("correo_envio")
    .select("id, clave, plantilla, estado, actualizado_en")
    // Fallidos por algo temporal que ya esperaron un poco, y `pendiente` abandonados: el proceso que los
    // mandaba murió (por ejemplo, la función llegó a su límite) y nadie los va a terminar.
    .or(
      `and(estado.eq.fallido,reintentable.is.true,actualizado_en.lt.${antes(ESPERA_ENTRE_REINTENTOS_MS)}),` +
        `and(estado.eq.pendiente,actualizado_en.lt.${antes(PENDIENTE_VENCE_MS)})`,
    )
    .gt("creado_en", antes(VENTANA_DE_REINTENTO_MS))
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
    pospuestos: 0,
  };

  /**
   * Toma la fila antes de reconstruir el correo: si dos corridas se solapan, solo una la reconstruye.
   * Importa porque reconstruir puede cambiar algo (la invitación rota su token): si las dos lo hicieran,
   * saldría un solo correo con el enlace de la corrida que no lo mandó. Es el mismo candado de
   * `registro.reservar`: un UPDATE condicionado a que `actualizado_en` no haya cambiado. Un `pendiente`
   * abandonado se deja `fallido` al tomarlo, para que `reservar` lo acepte al enviar. Queda
   * `reintentable`: si algo falla antes de que el envío anote su resultado, la próxima corrida lo retoma.
   */
  const tomar = async (fila: { id: string; estado: EstadoCorreo; actualizado_en: string }) => {
    const { data, error: errorAlTomar } = await cliente
      .from("correo_envio")
      .update({ estado: "fallido", reintentable: true, actualizado_en: ahora.toISOString() })
      .eq("id", fila.id)
      .eq("estado", fila.estado)
      .eq("actualizado_en", fila.actualizado_en)
      .select("id");
    if (errorAlTomar) throw new Error(errorAlTomar.message);
    return data.length === 1;
  };

  /** Deja de reintentar un correo: queda `fallido` y el admin lo ve en su bandeja. */
  const descartar = async (fila: { id: string; estado: EstadoCorreo }, motivo: string) => {
    const { error: errorAlDescartar } = await cliente
      .from("correo_envio")
      .update({ estado: "fallido", reintentable: false, ultimo_error: limpiarError(motivo), actualizado_en: ahora.toISOString() })
      .eq("id", fila.id)
      .eq("estado", fila.estado);
    if (errorAlDescartar) throw new Error(errorAlDescartar.message);
    resumen.descartados += 1;
  };

  for (const fila of filas) {
    if (reloj() - inicio > presupuestoMs) {
      resumen.pospuestos += 1;
      continue;
    }
    try {
      const entidad = esPlantilla(fila.plantilla) ? entidadDeClave(fila.clave, fila.plantilla) : null;
      if (!esPlantilla(fila.plantilla) || entidad === null) {
        await descartar(fila, `No se reconoce la plantilla o la clave del correo (${fila.plantilla}).`);
        continue;
      }
      const reconstructor = reconstructores[fila.plantilla] as Reconstructor<Plantilla> | null;
      if (!reconstructor) {
        await descartar(fila, "No hay cómo reconstruir este correo para reintentarlo.");
        continue;
      }
      if (!(await tomar(fila))) {
        resumen.tomadosPorOtro += 1;
        continue;
      }
      const reconstruido = await reconstructor(entidad);
      if (!reconstruido) {
        // Ya se tomó: la fila quedó `fallido`.
        await descartar({ id: fila.id, estado: "fallido" }, "El correo ya no aplica: lo que lo motivó cambió (por ejemplo, la invitación venció o se usó).");
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
