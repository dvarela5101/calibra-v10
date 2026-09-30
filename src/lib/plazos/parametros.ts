import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";

/**
 * Parámetros de plazos (sección 6.1). No están escritos en ningún archivo de la app: viven solo
 * en la función SQL `public.parametros_negocio()` y aquí se leen de ella. Para cambiar un plazo
 * se crea una migración que la redefine. Los plazos van en minutos. Cualquier sesión de la app
 * puede leerlos, la anónima incluida.
 */
export type ParametrosNegocio = {
  /** Bloqueo de la franja al agendar (RN-34). */
  reservaMin: number;
  /** Tiempo de un admin para revisar un pago (RN-42). */
  revisionMin: number;
  /** Antelación mínima para agendar una individual, antes de T (RN-35). */
  antelacionIndividualMin: number;
  /** Antelación mínima para agendar una grupal, antes de T (RN-35). */
  antelacionGrupalMin: number;
  /** Se cancela una individual hasta tanto antes de T (RN-60). */
  cancelacionIndividualMin: number;
  /** Se cancela una grupal hasta tanto antes de T (RN-60). */
  cancelacionGrupalMin: number;
  /** Los integrantes de una grupal pagan hasta tanto antes de T (RN-54). */
  pagoIntegrantesMin: number;
  /** El pagador cubre la diferencia hasta tanto antes de T (RN-55). */
  diferenciaMin: number;
  /** Se reporta la inasistencia hasta tanto después del fin (RN-62). */
  reporteInasistenciaMin: number;
  /** Los integrantes reseñan hasta tanto después de finalizar la grupal (RN-71). */
  resenaGrupalMin: number;
  /** El desembolso es ejecutable desde tanto después del fin (RN-83). */
  desembolsoMin: number;
};

/**
 * Parámetros de la comisión de la plataforma (RN-81). Solo el servidor los lee: la función SQL
 * `public.parametros_comision()` es ejecutable únicamente por `service_role` (N-2, P-32), así que
 * un cliente con la sesión de una persona, anónima o no, recibe un error de permisos.
 */
export type ParametrosComision = {
  /** Porcentaje del monto bruto que cobra la plataforma (RN-81). */
  comisionPorcentaje: number;
  /** Tope de la comisión, en COP (RN-81). */
  comisionTope: number;
};

/** Columna de `parametros_negocio()` de cada parámetro de plazo. */
const COLUMNAS: Record<keyof ParametrosNegocio, string> = {
  reservaMin: "reserva_min",
  revisionMin: "revision_min",
  antelacionIndividualMin: "antelacion_individual_min",
  antelacionGrupalMin: "antelacion_grupal_min",
  cancelacionIndividualMin: "cancelacion_individual_min",
  cancelacionGrupalMin: "cancelacion_grupal_min",
  pagoIntegrantesMin: "pago_integrantes_min",
  diferenciaMin: "diferencia_min",
  reporteInasistenciaMin: "reporte_inasistencia_min",
  resenaGrupalMin: "resena_grupal_min",
  desembolsoMin: "desembolso_min",
};

/** Columna de `parametros_comision()` de cada parámetro de comisión. */
const COLUMNAS_COMISION: Record<keyof ParametrosComision, string> = {
  comisionPorcentaje: "comision_porcentaje",
  comisionTope: "comision_tope",
};

/** Lee cada columna como entero no negativo, o dice cuál llegó mal. */
function leerEnteros<T extends string>(fila: unknown, columnas: Record<T, string>, origen: string): Record<T, number> {
  if (typeof fila !== "object" || fila === null) {
    throw new Error(`${origen} no devolvió una fila.`);
  }
  const resultado: Record<string, number> = {};
  for (const [nombre, columna] of Object.entries<string>(columnas)) {
    const valor = (fila as Record<string, unknown>)[columna];
    if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
      throw new Error(`${origen}: ${columna} debe ser un entero mayor o igual a cero (llegó ${String(valor)}).`);
    }
    resultado[nombre] = valor;
  }
  return resultado as Record<T, number>;
}

/** Valida la fila que devuelve `parametros_negocio()` antes de confiar en ella. */
export function comoParametros(fila: unknown): ParametrosNegocio {
  return leerEnteros(fila, COLUMNAS, "parametros_negocio()");
}

/** Valida la fila que devuelve `parametros_comision()` antes de confiar en ella. */
export function comoParametrosComision(fila: unknown): ParametrosComision {
  return leerEnteros(fila, COLUMNAS_COMISION, "parametros_comision()");
}

/** Lee los parámetros de plazo de la base. Quien llama decide cuánto tiempo los guarda. */
export async function cargarParametros(cliente: SupabaseClient<Database>): Promise<ParametrosNegocio> {
  const { data, error } = await cliente.rpc("parametros_negocio").single();
  if (error) throw new Error(`No se pudieron leer los parámetros de negocio: ${error.message}`);
  return comoParametros(data);
}

/**
 * Lee los parámetros de comisión. Solo funciona con el cliente de la llave secreta
 * (`crearClienteAdmin()`, solo servidor): con cualquier otra sesión la base responde 42501.
 */
export async function cargarParametrosComision(cliente: SupabaseClient<Database>): Promise<ParametrosComision> {
  const { data, error } = await cliente.rpc("parametros_comision").single();
  if (error) throw new Error(`No se pudieron leer los parámetros de comisión: ${error.message}`);
  return comoParametrosComision(data);
}
