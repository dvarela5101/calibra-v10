import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import type { Plantilla } from "./plantillas";
import { enviarCorreoDesdeServidor, type EntradaDeEnvio, type ResultadoEnvio } from "./servidor";

/**
 * El procesador de las bandejas de salida de correos (HU-079). Una bandeja es una tabla donde la base anota lo que hay que
 * avisar (`aviso_monitor`, `confirmacion_cita`...) y le pide a la app que lo mande por `/api/procesos/<ruta>`. El bucle que
 * la recorre vive aquí, una sola vez: cada bandeja declara su `DefinicionDeBandeja` (qué lee, cómo arma y manda el correo de
 * una fila, cómo nombrarla en el log) y llama a `procesarBandeja`. Una prueba (`pruebas/bandejas.test.ts`) falla si otro
 * archivo marca `procesado_en`.
 */

export type Cliente = SupabaseClient<Database>;

/** Cuántas filas toma cada corrida. Lo normal es una por corrida: la base la pide al anotarla. */
export const LOTE_POR_DEFECTO = 10;

/**
 * La corrida deja de tomar filas pasado este tiempo, como los reintentos de HU-065 (`reintentos.ts` repite el número): un
 * envío con el proveedor caído puede tardar unos 32 s, y 20 s más ese envío caben en el límite de la función (60 s). Cortar
 * a mitad de un envío podría dejarlo `pendiente` aunque haya salido, y el reintento lo mandaría otra vez.
 */
export const PRESUPUESTO_DE_CORRIDA_MS = 20_000;

/** Corridas en las que una fila puede fallar antes de abandonarla, para que no tape a las demás. */
export const MAXIMO_DE_INTENTOS = 5;

/** Las tablas que son una bandeja de salida. Una bandeja nueva suma la suya aquí. */
export type TablaDeBandeja =
  | "aviso_monitor"
  | "confirmacion_cita"
  | "cancelacion_cita"
  | "pedido_llave"
  | "aviso_rechazo_pago"
  | "invitacion_resena";

/** Lo que el procesador necesita de toda fila: cómo se marca y cuántas veces falló. */
export type FilaDeBandeja = { id: string; intentos: number };

export type DependenciasDeBandeja = {
  /** Con la llave secreta: las bandejas solo las lee y las marca el servidor. */
  cliente: Cliente;
  enviar: <P extends Plantilla>(entrada: EntradaDeEnvio<P>) => Promise<ResultadoEnvio>;
  /** El reloj de la corrida, para el presupuesto de tiempo. */
  reloj: () => number;
};

/** Cada fila termina enviada, descartada, fallida, tomada por otro o con error; las que no alcanzaron quedan pospuestas. */
export type ResumenDeBandeja = {
  revisadas: number;
  enviadas: number;
  /** La fila ya no valía: no se manda. */
  descartadas: number;
  /** El correo falló y quedó `fallido` en `correo_envio`: lo reintenta HU-065 o lo ve el admin. */
  fallidas: number;
  /** Otra corrida lo estaba mandando (la clave del correo es única). */
  tomadasPorOtro: number;
  /** No se pudo procesar (error de la base o de los datos): se reintenta en otra corrida, hasta `MAXIMO_DE_INTENTOS`. */
  conError: number;
  /** Se acabó el presupuesto de tiempo: quedan para la próxima corrida. */
  pospuestas: number;
};

/** El resumen de una bandeja con gancho «en espera» (HU-080). */
export type ResumenDeBandejaConEspera = ResumenDeBandeja & {
  /** Se salta sin marcarla ni sumar intento: espera a que algo se decida. */
  enEspera: number;
};

type Lectura<F> = PromiseLike<{ data: F[] | null; error: { message: string } | null }>;

export type DefinicionDeBandeja<F extends FilaDeBandeja> = {
  /** El prefijo de sus líneas en el log (`avisos` para `[avisos]`). */
  prefijo: string;
  /** La tabla donde se marca la fila y, salvo que traiga su propia lectura, de donde se lee. */
  tabla: TablaDeBandeja;
  lote: number;
  /**
   * Cómo se toman las filas sin procesar: las columnas y el orden de la consulta de siempre (`creada_en` o `creado_en`,
   * la más antigua primero), o una lectura propia, como la función de SQL de las invitaciones de reseña (HU-080).
   */
  lectura: { columnas: string; orden: string } | { leer: (cliente: Cliente, lote: number) => Lectura<F> };
  /** Los textos de los errores que lanza, sin los dos puntos ni el mensaje de la base: «No se pudieron leer los avisos». */
  textos: { leer: string; marcar: string };
  /** Cómo se nombra la fila en el log: por su id, nunca con su token, su correo ni su nombre. */
  nombrar: (fila: F) => string;
  /** Arma y manda el correo de la fila; `null` si ya no vale. Lanza si no puede decidirlo: la fila se reintenta. */
  mandar: (fila: F, contexto: Pick<DependenciasDeBandeja, "cliente" | "enviar">) => Promise<ResultadoEnvio | null>;
  /** Solo se pregunta cuando `mandar` dio `null`: si responde que sí, la fila se salta sin marcarla ni sumar intento. */
  enEspera?: (fila: F, cliente: Cliente) => Promise<boolean>;
};

async function leerFilas<F extends FilaDeBandeja>(cliente: Cliente, d: DefinicionDeBandeja<F>): Promise<F[]> {
  const { data, error } =
    "leer" in d.lectura
      ? await d.lectura.leer(cliente, d.lote)
      : await cliente.from(d.tabla).select(d.lectura.columnas).is("procesado_en", null).order(d.lectura.orden).limit(d.lote);
  if (error) throw new Error(`${d.textos.leer}: ${error.message}`);
  // supabase-js tipa las filas por el nombre literal de la tabla y de las columnas; aquí llegan como parámetros. Cada definición
  // declara la forma de su fila. Con `as F[]` solo, el compilador lo rechaza.
  return (data ?? []) as unknown as F[];
}

async function marcar<F extends FilaDeBandeja>(
  cliente: Cliente,
  d: DefinicionDeBandeja<F>,
  fila: F,
  cambios: { procesado_en?: string; intentos?: number },
): Promise<void> {
  const { error } = await cliente.from(d.tabla).update(cambios).eq("id", fila.id);
  if (error) throw new Error(`${d.textos.marcar}: ${error.message}`);
}

/** Suma un intento fallido; al llegar al máximo, abandona la fila (queda procesada y se avisa en el log). */
async function sumarIntento<F extends FilaDeBandeja>(cliente: Cliente, d: DefinicionDeBandeja<F>, fila: F, falla: unknown): Promise<void> {
  const mensaje = falla instanceof Error ? falla.message : String(falla);
  const intentos = fila.intentos + 1;
  const abandonar = intentos >= MAXIMO_DE_INTENTOS;
  console.error(`[${d.prefijo}] no se pudo procesar ${d.nombrar(fila)} (intento ${intentos}${abandonar ? ", se abandona" : ""}): ${mensaje}`);
  try {
    await marcar(cliente, d, fila, abandonar ? { intentos, procesado_en: new Date().toISOString() } : { intentos });
  } catch (otra) {
    console.error(`[${d.prefijo}] tampoco se pudo anotar el intento:`, otra instanceof Error ? otra.message : otra);
  }
}

/**
 * Manda las filas pendientes de una bandeja, de la más antigua a la más reciente. Cada una queda procesada cuando su correo
 * queda en `correo_envio` (enviado, o fallido para reintentar) o cuando ya no vale. Si no se pudo procesar, suma un intento
 * y se abandona al llegar a `MAXIMO_DE_INTENTOS`. Dos corridas a la vez no mandan dos veces: la clave del correo es única.
 */
export function procesarBandeja<F extends FilaDeBandeja>(
  definicion: DefinicionDeBandeja<F> & { enEspera: NonNullable<DefinicionDeBandeja<F>["enEspera"]> },
  dependencias?: Partial<DependenciasDeBandeja>,
): Promise<ResumenDeBandejaConEspera>;
export function procesarBandeja<F extends FilaDeBandeja>(definicion: DefinicionDeBandeja<F>, dependencias?: Partial<DependenciasDeBandeja>): Promise<ResumenDeBandeja>;
export async function procesarBandeja<F extends FilaDeBandeja>(
  d: DefinicionDeBandeja<F>,
  dependencias?: Partial<DependenciasDeBandeja>,
): Promise<ResumenDeBandeja | ResumenDeBandejaConEspera> {
  const cliente = dependencias?.cliente ?? crearClienteAdmin();
  const enviar = dependencias?.enviar ?? enviarCorreoDesdeServidor;
  const reloj = dependencias?.reloj ?? Date.now;
  const inicio = reloj();
  // El orden de las claves es el de la respuesta de las rutas: `enEspera` solo existe si la definición tiene el gancho.
  const resumen: ResumenDeBandeja & { enEspera?: number } = {
    revisadas: 0,
    enviadas: 0,
    ...(d.enEspera ? { enEspera: 0 } : {}),
    descartadas: 0,
    fallidas: 0,
    tomadasPorOtro: 0,
    conError: 0,
    pospuestas: 0,
  };

  const filas = await leerFilas(cliente, d);

  for (const fila of filas) {
    resumen.revisadas++;
    if (reloj() - inicio >= PRESUPUESTO_DE_CORRIDA_MS) {
      resumen.pospuestas++;
      continue;
    }
    try {
      const resultado = await d.mandar(fila, { cliente, enviar });
      if (!resultado) {
        // Un reporte abierto que llegó después del listado no descarta la fila: queda para cuando se decida.
        if (d.enEspera && (await d.enEspera(fila, cliente))) {
          resumen.enEspera = (resumen.enEspera ?? 0) + 1;
          continue;
        }
        resumen.descartadas++;
      } else if (resultado.ok) {
        resumen.enviadas++;
      } else if (resultado.motivo === "en_curso") {
        resumen.tomadasPorOtro++;
      } else if (resultado.motivo === "fallo_del_registro") {
        // Sin registro no hay reintento de HU-065: la fila vuelve a intentarse en otra corrida.
        throw new Error(resultado.error);
      } else {
        // Quedó `fallido` en el registro (o el contacto no es un correo): HU-065 y la bandeja del admin.
        console.error(`[${d.prefijo}] ${d.nombrar(fila)} no salió: ${resultado.error}`);
        resumen.fallidas++;
      }
      await marcar(cliente, d, fila, { procesado_en: new Date().toISOString() });
    } catch (falla) {
      resumen.conError++;
      await sumarIntento(cliente, d, fila, falla);
    }
  }
  return resumen;
}
