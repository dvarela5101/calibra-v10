/**
 * HU-136: las materias del selector (`/diagnostico` y `/monitores`) se muestran agrupadas por área. El área sale del prefijo del
 * código de la materia (los cuatro primeros caracteres de `MATE-1214`), sin tocar la base. Código puro, sin Next ni Supabase.
 */

/** Los grupos, en el orden en que se muestran. «Otras» (lo que no tiene un prefijo conocido) va siempre al final. */
export const AREAS_DE_MATERIAS = [
  { prefijo: "MATE", nombre: "Matemáticas" },
  { prefijo: "FISI", nombre: "Física" },
  { prefijo: "ISIS", nombre: "Programación y sistemas" },
  { prefijo: "IIND", nombre: "Probabilidad y estadística" },
] as const;

export const AREA_OTRAS = "Otras";

export type GrupoDeMaterias<T> = { area: string; materias: T[] };

/** El nombre del área de un código de materia: el prefijo antes del guion, sin importar mayúsculas ni espacios. */
export function areaDeMateria(codigo: string): string {
  const prefijo = codigo.trim().split("-")[0]?.toUpperCase() ?? "";
  return AREAS_DE_MATERIAS.find((a) => a.prefijo === prefijo)?.nombre ?? AREA_OTRAS;
}

/**
 * Agrupa las materias por área, en el orden de `AREAS_DE_MATERIAS` y «Otras» al final. Un grupo vacío no sale. Dentro de cada grupo
 * se conserva el orden en que llegan (las páginas las leen ya ordenadas por nombre), así que sigue siendo alfabético.
 */
export function agruparMateriasPorArea<T extends { codigo: string }>(materias: readonly T[]): GrupoDeMaterias<T>[] {
  const nombres = [...AREAS_DE_MATERIAS.map((a) => a.nombre as string), AREA_OTRAS];
  const grupos = nombres.map((area): GrupoDeMaterias<T> => ({ area, materias: [] }));
  for (const materia of materias) {
    const area = areaDeMateria(materia.codigo);
    grupos.find((g) => g.area === area)!.materias.push(materia);
  }
  return grupos.filter((g) => g.materias.length > 0);
}
