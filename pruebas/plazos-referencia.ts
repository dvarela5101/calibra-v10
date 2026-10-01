import type { ParametrosComision, ParametrosNegocio } from "@/lib/plazos/parametros";

/**
 * La tabla de plazos (sección 6.1 de `calibra_reglas_negocio.md`), tal como la dicta el documento.
 * Es el oráculo de las pruebas y NO se importa desde el código de la app: los parámetros de verdad
 * viven solo en `public.parametros_negocio()`. `integracion/plazos.test.ts` comprueba que la base
 * devuelva exactamente estos valores.
 */
export const PARAMETROS_DEL_DOCUMENTO: ParametrosNegocio = {
  reservaMin: 10, // bloqueo de la franja: 10 min
  revisionMin: 60, // revisión de un pago: 1 h
  antelacionIndividualMin: 3 * 60, // antelación mínima individual: 3 h
  antelacionGrupalMin: 36 * 60, // antelación mínima grupal: 36 h
  cancelacionIndividualMin: 12 * 60, // cancelación individual: hasta 12 h antes
  cancelacionGrupalMin: 24 * 60, // cancelación grupal: hasta 24 h antes
  pagoIntegrantesMin: 24 * 60, // pago de integrantes: hasta 24 h antes
  diferenciaMin: 5 * 60, // cubrir la diferencia: hasta 5 h antes
  reporteInasistenciaMin: 24 * 60, // reporte de inasistencia: hasta 24 h después del fin
  resenaGrupalMin: 60, // reseña grupal: 1 h después de finalizar
  desembolsoMin: 24 * 60, // desembolso ejecutable: desde 24 h después del fin
  cierreAutomaticoMin: 24 * 60, // una individual sin finalizar se cierra 24 h después del fin (P-05, D-14)
};

/**
 * La comisión de la plataforma (RN-81, P-14), como la dicta el documento. Aparte de los plazos
 * porque solo el servidor la lee (N-2): vive en `public.parametros_comision()`.
 */
export const COMISION_DEL_DOCUMENTO: ParametrosComision = {
  comisionPorcentaje: 10, // 10 % del bruto
  comisionTope: 15_000, // con tope de 15.000 COP
};
