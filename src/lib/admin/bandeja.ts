import type { SupabaseClient } from "@supabase/supabase-js";
import { revisionHasta } from "@/lib/plazos/motor";
import { cargarParametros } from "@/lib/plazos/parametros";
import { describirTiempoRestante, type TiempoRestante } from "@/lib/plazos/restante";
import type { Database } from "@/lib/supabase/tipos";

/** Cuántas filas trae cada lista. Los contadores son exactos aunque la lista se corte aquí. */
export const MAX_FILAS_POR_SECCION = 100;

export type PagoPorRevisar = {
  id: string;
  nombrePagador: string;
  monto: number;
  /** Cuándo vence la hora que tiene este admin para revisarlo (RN-42). */
  revisionHasta: Date;
  restante: TiempoRestante;
};

export type ReembolsoActivo = { id: string; monto: number; motivo: string };

export type ReporteEnRevision = { id: string; fechaReporte: Date; fechaSesion: string | null };

export type DesembolsoEjecutable = {
  id: string;
  /** Lo que hay que transferir al monitor. Ni el bruto ni la comisión llegan a la bandeja (P-32). */
  montoNeto: number;
  desembolsableDesde: Date;
  fechaSesion: string;
};

export type Bandeja = {
  pagos: PagoPorRevisar[];
  /** Cada estado activo tiene su propia lista y su propio corte: una larga no tapa a la otra. */
  reembolsos: { esperandoLlave: ReembolsoActivo[]; pendientes: ReembolsoActivo[] };
  reportes: ReporteEnRevision[];
  desembolsos: DesembolsoEjecutable[];
  /** Cuántos hay en cada sección, contando los que no caben en la lista. */
  contadores: {
    pagos: number;
    reembolsos: number;
    reembolsosEsperandoLlave: number;
    reembolsosPendientes: number;
    reportes: number;
    desembolsos: number;
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
 * no entra. Las políticas de la base ya dejan leer estas tablas solo a los admins: con la sesión de
 * cualquier otro rol las listas salen vacías.
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

  const [parametros, pagos, esperandoLlave, pendientes, reportes, desembolsos] = await Promise.all([
    cargarParametros(cliente),
    cliente
      .from("pago")
      .select("id, nombre_pagador, monto, fecha_asignacion", { count: "exact" })
      .eq("id_admin", idAdmin)
      .eq("estado", "en_revision")
      // El vencimiento es la fecha de asignación más un plazo fijo: ordenar por una es ordenar por la otra.
      .order("fecha_asignacion", { ascending: true })
      .limit(maxFilas),
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
  ]);

  const p = exigir("los pagos por revisar", pagos);
  const e = exigir("los reembolsos que esperan la llave", esperandoLlave);
  const r = exigir("los reembolsos listos para transferir", pendientes);
  const i = exigir("los reportes de inasistencia", reportes);
  const d = exigir("los desembolsos", desembolsos);

  const reembolso = (fila: { id: string; monto: number; motivo: string }): ReembolsoActivo => ({
    id: fila.id,
    monto: fila.monto,
    motivo: fila.motivo,
  });

  return {
    pagos: p.filas.map((fila) => {
      const limite = revisionHasta(new Date(fila.fecha_asignacion), parametros);
      return {
        id: fila.id,
        nombrePagador: fila.nombre_pagador,
        monto: fila.monto,
        revisionHasta: limite,
        restante: describirTiempoRestante(limite, ahora),
      };
    }),
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
    contadores: {
      pagos: p.total,
      reembolsos: e.total + r.total,
      reembolsosEsperandoLlave: e.total,
      reembolsosPendientes: r.total,
      reportes: i.total,
      desembolsos: d.total,
    },
  };
}
