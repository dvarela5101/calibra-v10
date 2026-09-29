import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";

/**
 * Parámetros de plazos y comisión (sección 6.1 y RN-81). No están escritos en ningún archivo
 * de la app: viven solo en la función SQL `public.parametros_negocio()` y aquí se leen de
 * ella. Para cambiar un plazo se crea una migración que la redefine. Los plazos van en
 * minutos; la comisión, en porcentaje entero y pesos.
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
  /** Porcentaje del monto bruto que cobra la plataforma (RN-81). */
  comisionPorcentaje: number;
  /** Tope de la comisión, en COP (RN-81). */
  comisionTope: number;
};

/** Columna de `parametros_negocio()` de cada parámetro. */
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
  comisionPorcentaje: "comision_porcentaje",
  comisionTope: "comision_tope",
};

/** Valida la fila que devuelve la base antes de confiar en ella. */
export function comoParametros(fila: unknown): ParametrosNegocio {
  if (typeof fila !== "object" || fila === null) {
    throw new Error("parametros_negocio() no devolvió una fila.");
  }
  const resultado: Record<string, number> = {};
  for (const [nombre, columna] of Object.entries(COLUMNAS)) {
    const valor = (fila as Record<string, unknown>)[columna];
    if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
      throw new Error(`parametros_negocio(): ${columna} debe ser un entero mayor o igual a cero (llegó ${String(valor)}).`);
    }
    resultado[nombre] = valor;
  }
  return resultado as ParametrosNegocio;
}

/** Lee los parámetros de la base. Quien llama decide cuánto tiempo los guarda. */
export async function cargarParametros(cliente: SupabaseClient<Database>): Promise<ParametrosNegocio> {
  const { data, error } = await cliente.rpc("parametros_negocio").single();
  if (error) throw new Error(`No se pudieron leer los parámetros de negocio: ${error.message}`);
  return comoParametros(data);
}
