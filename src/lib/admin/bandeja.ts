import type { SupabaseClient } from "@supabase/supabase-js";
import { VENTANA_DE_REINTENTO_MS } from "@/lib/correo/reintentos";
import { esPlantilla, NOMBRE_DE_PLANTILLA } from "@/lib/correo/plantillas";
import { revisionHasta } from "@/lib/plazos/motor";
import { cargarParametros } from "@/lib/plazos/parametros";
import { describirTiempoRestante, type TiempoRestante } from "@/lib/plazos/restante";
import type { Database } from "@/lib/supabase/tipos";

/** Cuántas filas trae cada lista. Los contadores son exactos aunque la lista se corte aquí. */
export const MAX_FILAS_POR_SECCION = 100;

const MS_POR_MINUTO = 60_000;

export type PagoPorRevisar = {
  id: string;
  nombrePagador: string;
  monto: number;
  /** Cuándo vence la hora que tiene el admin asignado para revisarlo (RN-42). */
  revisionHasta: Date;
  restante: TiempoRestante;
};

/**
 * Un pago en revisión de otro admin al que ya se le pasó la hora (HU-077, supuesto 2): cualquier admin activo puede
 * aprobarlo o rechazarlo (D-38). `nombreAdmin` es el asignado, que sigue siéndolo (supuesto 4).
 */
export type PagoVencidoDeOtro = PagoPorRevisar & { nombreAdmin: string };

export type ReembolsoActivo = { id: string; monto: number; motivo: string };

export type ReporteEnRevision = { id: string; fechaReporte: Date; fechaSesion: string | null };

export type DesembolsoEjecutable = {
  id: string;
  /** Lo que hay que transferir al monitor. Ni el bruto ni la comisión llegan a la bandeja (P-32). */
  montoNeto: number;
  desembolsableDesde: Date;
  fechaSesion: string;
};

/** Un correo que no salió y que el proceso de reintentos ya no va a mandar (HU-065). */
export type CorreoSinEnviar = {
  id: string;
  /** Nombre legible de la plantilla. */
  tipo: string;
  destinatario: string;
  creadoEn: Date;
  error: string | null;
};

export type Bandeja = {
  /** Los pagos en revisión asignados a este admin. */
  pagos: PagoPorRevisar[];
  /** HU-077: los de otros admins con la hora vencida, en su propia lista y con su propio corte. */
  pagosVencidosDeOtros: PagoVencidoDeOtro[];
  /** Cada estado activo tiene su propia lista y su propio corte: una larga no tapa a la otra. */
  reembolsos: { esperandoLlave: ReembolsoActivo[]; pendientes: ReembolsoActivo[] };
  reportes: ReporteEnRevision[];
  desembolsos: DesembolsoEjecutable[];
  /** Correos que fallaron de forma definitiva o siguieron fallando 24 horas (HU-065). Los ven todos los admins. */
  correosSinEnviar: CorreoSinEnviar[];
  /** Cuántos hay en cada sección, contando los que no caben en la lista. */
  contadores: {
    pagos: number;
    pagosVencidosDeOtros: number;
    reembolsos: number;
    reembolsosEsperandoLlave: number;
    reembolsosPendientes: number;
    reportes: number;
    desembolsos: number;
    correosSinEnviar: number;
  };
};

type Cliente = SupabaseClient<Database>;

/** Falla con el nombre de la sección y el mensaje de la base si una consulta no salió bien. */
function exigir<T extends unknown[]>(
  seccion: string,
  resultado: { data: T | null; error: { message: string } | null; count: number | null },
) {
  if (resultado.error || resultado.data === null) {
    throw new Error(`No se pudo cargar ${seccion}: ${resultado.error?.message ?? "sin datos"}`);
  }
  return { filas: resultado.data, total: resultado.count ?? resultado.data.length };
}

/**
 * Lo que tiene asignado un admin (RN-07): pagos en revisión por vencimiento, reembolsos activos por
 * estado, reportes en revisión y desembolsos ejecutables. Los desembolsos no tienen admin hasta que
 * se ejecutan (RN-80), así que todos ven los mismos ejecutables. Lo que tienen asignado otros admins
 * no entra, salvo los pagos en revisión a los que ya se les pasó la hora (HU-077, supuesto 2): van
 * aparte, después de los propios. Las políticas de la base ya dejan leer estas tablas solo a los
 * admins: con la sesión de cualquier otro rol las listas salen vacías.
 *
 * `ahora` se pasa para poder probar el tiempo restante con una hora fija, y `maxFilas` para probar el
 * corte de las listas sin crear cientos de filas.
 */
export async function cargarBandeja(
  cliente: Cliente,
  idAdmin: string,
  ahora: Date = new Date(),
  { maxFilas = MAX_FILAS_POR_SECCION }: { maxFilas?: number } = {},
): Promise<Bandeja> {
  const reembolsosDe = (estado: "esperando_llave" | "pendiente") =>
    cliente
      .from("reembolso")
      .select("id, monto, motivo", { count: "exact" })
      .eq("id_admin", idAdmin)
      .eq("estado", estado)
      .order("fecha_generacion", { ascending: true })
      .limit(maxFilas);

  // El proceso de reintentos deja de intentar a las 24 horas: desde ahí, o si la falla fue definitiva, le toca al admin.
  const finDeReintentos = new Date(ahora.getTime() - VENTANA_DE_REINTENTO_MS).toISOString();

  // HU-077: para saber qué asignaciones ya vencieron hace falta el plazo de revisión, así que esa consulta espera a
  // los parámetros; las demás no.
  const parametrosLeidos = cargarParametros(cliente);

  const [parametros, pagos, vencidosDeOtros, esperandoLlave, pendientes, reportes, desembolsos, correos] = await Promise.all([
    parametrosLeidos,
    cliente
      .from("pago")
      .select("id, nombre_pagador, monto, fecha_asignacion", { count: "exact" })
      .eq("id_admin", idAdmin)
      .eq("estado", "en_revision")
      // El vencimiento es la fecha de asignación más un plazo fijo: ordenar por una es ordenar por la otra.
      .order("fecha_asignacion", { ascending: true })
      .limit(maxFilas),
    parametrosLeidos.then((p) =>
      cliente
        .from("pago")
        // pago tiene dos llaves a admin desde HU-077: se nombra la del asignado.
        .select("id, nombre_pagador, monto, fecha_asignacion, admin!pago_id_admin_fkey(nombre)", { count: "exact" })
        .neq("id_admin", idAdmin)
        .eq("estado", "en_revision")
        // Vencido es que `ahora` ya pasó revisionHasta(fecha_asignacion), sin contar el borde (P-40, como
        // privado.revisar_pago): fecha_asignacion < ahora - revisionMin. La base compara en microsegundos contra un
        // instante exacto, así que el borde no se corre.
        .lt("fecha_asignacion", new Date(ahora.getTime() - p.revisionMin * MS_POR_MINUTO).toISOString())
        // El que lleva más tiempo vencido, arriba.
        .order("fecha_asignacion", { ascending: true })
        .limit(maxFilas),
    ),
    reembolsosDe("esperando_llave"),
    reembolsosDe("pendiente"),
    cliente
      .from("reporte_inasistencia")
      .select("id, fecha_reporte, monitoria(fecha)", { count: "exact" })
      .eq("id_admin", idAdmin)
      .eq("estado", "en_revision")
      .order("fecha_reporte", { ascending: true })
      .limit(maxFilas),
    cliente
      .from("desembolsos_ejecutables")
      .select("id, monto_neto, desembolsable_desde, fecha_sesion", { count: "exact" })
      .order("desembolsable_desde", { ascending: true })
      .limit(maxFilas),
    cliente
      .from("correo_envio")
      .select("id, plantilla, destinatario, creado_en, ultimo_error", { count: "exact" })
      // Fallidos definitivos o que agotaron el plazo, y `pendiente` de antes del plazo (su envío murió y
      // ya no se reintenta).
      .or(
        `and(estado.eq.fallido,reintentable.is.false),` +
          `and(estado.eq.fallido,creado_en.lte.${finDeReintentos}),` +
          `and(estado.eq.pendiente,creado_en.lte.${finDeReintentos})`,
      )
      .order("creado_en", { ascending: false })
      .limit(maxFilas),
  ]);

  const p = exigir("los pagos por revisar", pagos);
  const v = exigir("los pagos vencidos de otros admins", vencidosDeOtros);
  const e = exigir("los reembolsos que esperan la llave", esperandoLlave);
  const r = exigir("los reembolsos listos para transferir", pendientes);
  const i = exigir("los reportes de inasistencia", reportes);
  const d = exigir("los desembolsos", desembolsos);
  const c = exigir("los correos que no salieron", correos);

  const reembolso = (fila: { id: string; monto: number; motivo: string }): ReembolsoActivo => ({
    id: fila.id,
    monto: fila.monto,
    motivo: fila.motivo,
  });

  const pagoPorRevisar = (fila: { id: string; nombre_pagador: string; monto: number; fecha_asignacion: string }): PagoPorRevisar => {
    const limite = revisionHasta(new Date(fila.fecha_asignacion), parametros);
    return {
      id: fila.id,
      nombrePagador: fila.nombre_pagador,
      monto: fila.monto,
      revisionHasta: limite,
      restante: describirTiempoRestante(limite, ahora),
    };
  };

  return {
    pagos: p.filas.map(pagoPorRevisar),
    pagosVencidosDeOtros: v.filas.map((fila) => ({ ...pagoPorRevisar(fila), nombreAdmin: fila.admin.nombre })),
    reembolsos: { esperandoLlave: e.filas.map(reembolso), pendientes: r.filas.map(reembolso) },
    reportes: i.filas.map((fila) => ({
      id: fila.id,
      fechaReporte: new Date(fila.fecha_reporte),
      fechaSesion: fila.monitoria?.fecha ?? null,
    })),
    desembolsos: d.filas.flatMap((fila) =>
      // La vista marca todo como posiblemente nulo; una fila sin estos datos no es un desembolso listable.
      fila.id && fila.monto_neto !== null && fila.desembolsable_desde && fila.fecha_sesion
        ? [
            {
              id: fila.id,
              montoNeto: fila.monto_neto,
              desembolsableDesde: new Date(fila.desembolsable_desde),
              fechaSesion: fila.fecha_sesion,
            },
          ]
        : [],
    ),
    correosSinEnviar: c.filas.map((fila) => ({
      id: fila.id,
      tipo: esPlantilla(fila.plantilla) ? NOMBRE_DE_PLANTILLA[fila.plantilla] : fila.plantilla,
      destinatario: fila.destinatario,
      creadoEn: new Date(fila.creado_en),
      error: fila.ultimo_error,
    })),
    contadores: {
      pagos: p.total,
      pagosVencidosDeOtros: v.total,
      reembolsos: e.total + r.total,
      reembolsosEsperandoLlave: e.total,
      reembolsosPendientes: r.total,
      reportes: i.total,
      desembolsos: d.total,
      correosSinEnviar: c.total,
    },
  };
}
