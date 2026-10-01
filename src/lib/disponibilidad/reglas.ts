/**
 * Monitores certificados de una materia y sus fechas libres (HU-016). Aquí va lo puro: leer la materia
 * del enlace, agrupar las fechas por monitor y la ruta de la lista. Qué fecha está libre lo decide la
 * base (`public.fechas_libres_de_materia`): la antelación, lo ocupado y lo cerrado viven allá.
 */

/** Semanas hacia adelante que muestra la lista (D-4). */
export const SEMANAS_DEL_HORIZONTE = 4;

/** Fechas que se ven de cada monitor antes de "Ver N fechas más". */
export const FECHAS_A_LA_VISTA = 6;

export const RUTA_MONITORES = "/monitores";

export type FechaLibre = {
  idMonitor: string;
  nombreMonitor: string;
  idFranja: string;
  /** Día de calendario, `AAAA-MM-DD`. */
  fecha: string;
  /** Hora de inicio en la zona del negocio, `HH:MM:SS` (RN-36). */
  hora: string;
  duracionMin: number;
  presencial: boolean;
  precio: number;
};

export type MonitorConFechas = { idMonitor: string; nombre: string; fechas: FechaLibre[] };

const LARGO_MAXIMO_CODIGO = 50;

/**
 * El código de materia que trae el enlace (`?materia=MATE-1214`). Con varios, el primero. `null` si no
 * viene, está vacío o no puede ser un código. La base lo compara exacto, sin comodines.
 */
export function leerCodigoDeMateria(valor: string | string[] | undefined): string | null {
  const texto = (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
  if (!texto || texto.length > LARGO_MAXIMO_CODIGO || /[\u0000-\u001f\u007f]/.test(texto)) return null;
  return texto;
}

/** La lista de una materia (o la de elegir materia, sin código). La usan los enlaces de HU-009 y HU-011. */
export function rutaDeMonitores(codigoMateria?: string): string {
  return codigoMateria ? `${RUTA_MONITORES}?${new URLSearchParams({ materia: codigoMateria })}` : RUTA_MONITORES;
}

const momento = (f: FechaLibre) => `${f.fecha} ${f.hora}`;

/**
 * Agrupa las fechas por monitor (D-4): primero el que tiene la fecha libre más próxima y, en empate, por
 * nombre. Las fechas de cada monitor, de la más próxima a la más lejana.
 */
export function agruparPorMonitor(fechas: FechaLibre[]): MonitorConFechas[] {
  const porMonitor = new Map<string, MonitorConFechas>();
  for (const fecha of fechas) {
    const grupo = porMonitor.get(fecha.idMonitor) ?? { idMonitor: fecha.idMonitor, nombre: fecha.nombreMonitor, fechas: [] };
    grupo.fechas.push(fecha);
    porMonitor.set(fecha.idMonitor, grupo);
  }
  const grupos = [...porMonitor.values()];
  for (const grupo of grupos) {
    grupo.fechas.sort((a, b) => momento(a).localeCompare(momento(b)) || a.idFranja.localeCompare(b.idFranja));
  }
  return grupos.sort(
    (a, b) =>
      momento(a.fechas[0]).localeCompare(momento(b.fechas[0])) ||
      a.nombre.localeCompare(b.nombre, "es") ||
      a.idMonitor.localeCompare(b.idMonitor),
  );
}
