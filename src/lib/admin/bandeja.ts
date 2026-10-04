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

/**
 * Un caso P-24 abierto (HU-078): un pago rechazado cuando la sesión ya había empezado, que alguien tiene que cerrar como
 * cobrado o asumido. Lo ven todos los admins activos (supuesto 2), como los desembolsos ejecutables.
 */
export type PagoPorCobrarOAsumir = {
  id: string;
  nombrePagador: string;
  contacto: string;
  monto: number;
  /** Lo que anotó el admin al rechazarlo: en P-24 es obligatorio, pero un pago insertado ya rechazado puede no tenerlo. */
  observaciones: string | null;
  /** Cuándo se rechazó: el más antiguo va arriba. */
  rechazadoEn: Date;
  monitoria: {
    /** Día de calendario, `AAAA-MM-DD`. */
    fecha: string;
    nombreMateria: string;
    nombreMonitor: string;
  };
};

export type ReembolsoActivo = { id: string; monto: number; motivo: string };

/**
 * Un reembolso que se cerró porque pasó el plazo sin que quien pagó enviara su llave (P-10, HU-025). Cualquier admin
 * activo lo reabre (supuesto 4), así que todos ven los mismos. Del pago, quién es y su correo: así el admin lo reconoce
 * cuando le escriben. Nunca la llave (un caso cerrado no la tiene).
 */
export type ReembolsoCerrado = {
  id: string;
  nombrePagador: string;
  contacto: string;
  monto: number;
  motivo: string;
  cerradoEn: Date;
};

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
  /** HU-078: los casos P-24 abiertos. Los ven todos los admins. */
  pagosPorCobrarOAsumir: PagoPorCobrarOAsumir[];
  /** Cada estado activo tiene su propia lista y su propio corte: una larga no tapa a la otra. */
  reembolsos: { esperandoLlave: ReembolsoActivo[]; pendientes: ReembolsoActivo[] };
  /** HU-025: los cerrados sin llave de todos los admins, el más reciente arriba. No cuentan como reembolsos por atender. */
  reembolsosCerrados: ReembolsoCerrado[];
  reportes: ReporteEnRevision[];
  desembolsos: DesembolsoEjecutable[];
  /** Correos que fallaron de forma definitiva o siguieron fallando 24 horas (HU-065). Los ven todos los admins. */
  correosSinEnviar: CorreoSinEnviar[];
  /** Cuántos hay en cada sección, contando los que no caben en la lista. */
  contadores: {
    pagos: number;
    pagosVencidosDeOtros: number;
    pagosPorCobrarOAsumir: number;
    reembolsos: number;
    reembolsosEsperandoLlave: number;
    reembolsosPendientes: number;
    reembolsosCerrados: number;
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
 * HU-078: los casos P-24 abiertos, del más antiguo al más reciente, con la materia y el monitor de su monitoría. La
 * condición es la de `privado.estado_caso_p24` (y `estadoDelCaso`), que la Data API no expone: pago rechazado, sin
 * cierre y con la monitoría no cancelada. monitoria no tiene llave directa a monitor ni a materia, así que sus nombres se
 * piden aparte, una vez por lista.
 */
async function cargarPagosPorCobrarOAsumir(cliente: Cliente, maxFilas: number) {
  const seccion = "los pagos por cobrar o asumir";
  const casos = exigir(
    seccion,
    await cliente
      .from("pago")
      .select("id, nombre_pagador, contacto, monto, observaciones, fecha_revision, monitoria!inner(estado, fecha, id_monitor, id_materia)", {
        count: "exact",
      })
      .eq("estado", "rechazado")
      .is("cierre_rechazo", null)
      .neq("monitoria.estado", "cancelada")
      // Un rechazado siempre tiene fecha de revisión (pago_revision_con_fecha).
      .order("fecha_revision", { ascending: true })
      .limit(maxFilas),
  );
  if (casos.filas.length === 0) return { filas: [], total: casos.total };

  const unicos = (ids: string[]) => [...new Set(ids)];
  const [monitores, materias] = await Promise.all([
    cliente.from("monitor").select("id, nombre").in("id", unicos(casos.filas.map((fila) => fila.monitoria.id_monitor))),
    cliente.from("materia").select("id, nombre").in("id", unicos(casos.filas.map((fila) => fila.monitoria.id_materia))),
  ]);
  const nombreDeMonitor = new Map(exigir(seccion, monitores).filas.map((fila) => [fila.id, fila.nombre]));
  const nombreDeMateria = new Map(exigir(seccion, materias).filas.map((fila) => [fila.id, fila.nombre]));

  const filas = casos.filas.map((fila): PagoPorCobrarOAsumir => {
    const nombreMonitor = nombreDeMonitor.get(fila.monitoria.id_monitor);
    const nombreMateria = nombreDeMateria.get(fila.monitoria.id_materia);
    if (nombreMonitor === undefined || nombreMateria === undefined || !fila.fecha_revision) {
      throw new Error(`No se pudo cargar ${seccion}: el pago ${fila.id} está incompleto`);
    }
    return {
      id: fila.id,
      nombrePagador: fila.nombre_pagador,
      contacto: fila.contacto,
      monto: fila.monto,
      observaciones: fila.observaciones,
      rechazadoEn: new Date(fila.fecha_revision),
      monitoria: { fecha: fila.monitoria.fecha, nombreMateria, nombreMonitor },
    };
  });
  return { filas, total: casos.total };
}

/**
 * Lo que tiene asignado un admin (RN-07): pagos en revisión por vencimiento, reembolsos activos por
 * estado, reportes en revisión y desembolsos ejecutables. Los desembolsos no tienen admin hasta que
 * se ejecutan (RN-80), así que todos ven los mismos ejecutables; lo mismo pasa con los pagos por cobrar o asumir
 * (HU-078, supuesto 2), que cierra cualquier admin activo, y con los reembolsos cerrados sin llave (HU-025, supuesto 4),
 * que reabre cualquier admin activo. Lo que tienen asignado otros admins
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
      // HU-025: un caso cerrado sin llave ya no espera nada (los listos para transferir nunca están cerrados).
      .is("cerrado_en", null)
      .order("fecha_generacion", { ascending: true })
      .limit(maxFilas);

  // El proceso de reintentos deja de intentar a las 24 horas: desde ahí, o si la falla fue definitiva, le toca al admin.
  const finDeReintentos = new Date(ahora.getTime() - VENTANA_DE_REINTENTO_MS).toISOString();

  // HU-077: para saber qué asignaciones ya vencieron hace falta el plazo de revisión, así que esa consulta espera a
  // los parámetros; las demás no.
  const parametrosLeidos = cargarParametros(cliente);

  const [parametros, pagos, vencidosDeOtros, porCobrar, esperandoLlave, pendientes, cerrados, reportes, desembolsos, correos] = await Promise.all([
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
    cargarPagosPorCobrarOAsumir(cliente, maxFilas),
    reembolsosDe("esperando_llave"),
    reembolsosDe("pendiente"),
    cliente
      .from("reembolso")
      .select("id, monto, motivo, cerrado_en, pago(nombre_pagador, contacto)", { count: "exact" })
      .eq("estado", "esperando_llave")
      .not("cerrado_en", "is", null)
      // La lista solo crece (un cerrado sale de ella al reabrirlo): el más reciente arriba, que es el que más se reabre.
      .order("cerrado_en", { ascending: false })
      .limit(maxFilas),
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
  const z = exigir("los reembolsos cerrados sin llave", cerrados);
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
    pagosPorCobrarOAsumir: porCobrar.filas,
    reembolsos: { esperandoLlave: e.filas.map(reembolso), pendientes: r.filas.map(reembolso) },
    reembolsosCerrados: z.filas.map((fila): ReembolsoCerrado => {
      // reembolso_id_pago_fkey es obligatoria: el pago siempre viene, y un cerrado siempre tiene su fecha de cierre.
      if (!fila.pago || !fila.cerrado_en) throw new Error(`No se pudo cargar los reembolsos cerrados sin llave: el reembolso ${fila.id} está incompleto`);
      return {
        id: fila.id,
        nombrePagador: fila.pago.nombre_pagador,
        contacto: fila.pago.contacto,
        monto: fila.monto,
        motivo: fila.motivo,
        cerradoEn: new Date(fila.cerrado_en),
      };
    }),
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
      pagosPorCobrarOAsumir: porCobrar.total,
      reembolsos: e.total + r.total,
      reembolsosEsperandoLlave: e.total,
      reembolsosPendientes: r.total,
      reembolsosCerrados: z.total,
      reportes: i.total,
      desembolsos: d.total,
      correosSinEnviar: c.total,
    },
  };
}
