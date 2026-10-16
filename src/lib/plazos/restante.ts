import { dentroDePlazo } from "./motor";

export type TiempoRestante = {
  /** Listo para mostrar: `Quedan 42 min` o `Vencido hace 1 h 5 min`. */
  texto: string;
  vencido: boolean;
};

const MS_POR_MINUTO = 60_000;
const MIN_POR_HORA = 60;
const MIN_POR_DIA = 24 * MIN_POR_HORA;

/** `3 d 2 h`, `1 h 5 min`, `42 min`. Muestra a lo sumo las dos unidades mayores y omite las que valen cero. */
function describirDuracion(minutos: number): string {
  const dias = Math.floor(minutos / MIN_POR_DIA);
  const horas = Math.floor((minutos % MIN_POR_DIA) / MIN_POR_HORA);
  const min = minutos % MIN_POR_HORA;
  const partes: string[] = [];
  if (dias > 0) partes.push(`${dias} d`);
  if (horas > 0) partes.push(`${horas} h`);
  if (min > 0 && dias === 0) partes.push(`${min} min`);
  return partes.join(" ");
}

/**
 * Cuánto lleva esperando algo desde `desde` (HU-034): `hace menos de 1 min`, `hace 25 min`, `hace 1 h 5 min`, `hace 2 d 3 h`.
 * No es un plazo: no hay borde ni «vencido». Un `desde` posterior a `ahora` (el reloj del servidor atrasado frente al de
 * la base, que fecha lo que llega) también dice `hace menos de 1 min`.
 */
export function describirEspera(desde: Date, ahora: Date): string {
  if (Number.isNaN(desde.getTime())) throw new RangeError("desde debe ser una fecha válida.");
  if (Number.isNaN(ahora.getTime())) throw new RangeError("ahora debe ser una fecha válida.");
  const minutos = Math.floor((ahora.getTime() - desde.getTime()) / MS_POR_MINUTO);
  return minutos < 1 ? "hace menos de 1 min" : `hace ${describirDuracion(minutos)}`;
}

/**
 * Cuánto falta para un plazo, o cuánto lleva vencido. El borde es inclusivo, como en todo el motor
 * de plazos (P-40): con `ahora` igual al límite todavía queda tiempo, no está vencido.
 */
export function describirTiempoRestante(limite: Date, ahora: Date): TiempoRestante {
  if (dentroDePlazo(limite, ahora)) {
    const minutos = Math.floor((limite.getTime() - ahora.getTime()) / MS_POR_MINUTO);
    return { texto: minutos < 1 ? "Queda menos de 1 min" : `Quedan ${describirDuracion(minutos)}`, vencido: false };
  }
  const minutos = Math.floor((ahora.getTime() - limite.getTime()) / MS_POR_MINUTO);
  return { texto: minutos < 1 ? "Venció hace menos de 1 min" : `Vencido hace ${describirDuracion(minutos)}`, vencido: true };
}
