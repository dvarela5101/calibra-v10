/**
 * HU-140 (D-94): lógica pura del calendario del monitor en `/monitor`. Qué día y vista se ven (salen de la dirección), la semana
 * y la rejilla del mes, qué franjas ocurren cada día y en qué estado, y el texto de la repetición del formulario «Agregar».
 * Un día de calendario (`AAAA-MM-DD`) no tiene zona: toda la aritmética va en UTC con `Date.UTC`, nunca con la zona del servidor.
 */
import type { MonitoriaDeAgenda } from "@/lib/agenda/reglas";
import { horaCorta, horaDeFin, minutosDe } from "@/lib/franjas/reglas";

export type VistaDelCalendario = "semana" | "mes";
export type EstadoDeFranja = "libre" | "reservada" | "por_pagar";
export type Repite = "una" | "semanas" | "siempre";

export const MIN_SEMANAS = 2;
export const MAX_SEMANAS = 16;

/** Lo que el calendario lee de una franja del monitor (columnas de `public.franja`). */
export type FranjaDeCalendario = {
  id: string;
  /** Día ISO: 1 = lunes ... 7 = domingo. */
  dia: number;
  /** `HH:MM` o `HH:MM:SS`. */
  hora: string;
  duracion_min: number;
  presencial: boolean;
  precio: number;
  abierta_desde: string;
  cerrada_desde: string | null;
};

/** Lo que el calendario toma de una monitoría de la agenda. */
export type MonitoriaParaCalendario = Pick<
  MonitoriaDeAgenda,
  "idMonitoria" | "fecha" | "hora" | "duracionMin" | "presencial" | "estado" | "reservaVencida" | "nombreEstudiante" | "nombreMateria"
>;

/** Una franja en una fecha concreta. */
export type Ocurrencia = {
  clave: string;
  fecha: string;
  /** `HH:MM`. */
  hora: string;
  /** `HH:MM`. */
  fin: string;
  minutoInicio: number;
  duracionMin: number;
  presencial: boolean;
  /** Pesos; `null` si no se sabe (una monitoría reservada de una franja que ya no existe). */
  precio: number | null;
  estado: EstadoDeFranja;
  /** La franja que la origina; `null` si se construyó solo desde la monitoría. */
  idFranja: string | null;
  estudiante: string | null;
  materia: string | null;
};

// ---------------------------------------------------------------------------------------------------------------------------
// Fechas civiles
// ---------------------------------------------------------------------------------------------------------------------------

const MS_POR_DIA = 24 * 60 * 60 * 1000;

const aUtc = (fecha: string): number => {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return Date.UTC(anio, mes - 1, dia);
};
const deUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** ¿Es un día de calendario real `AAAA-MM-DD`? Rechaza `2026-02-30`, que `Date` rueda al mes siguiente. */
export function esFecha(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) && deUtc(aUtc(valor)) === valor;
}

/** Suma (o resta) días a una fecha `AAAA-MM-DD`. */
export function sumarDias(fecha: string, dias: number): string {
  return deUtc(aUtc(fecha) + dias * MS_POR_DIA);
}

/** Día ISO de una fecha: 1 = lunes ... 7 = domingo. */
export function diaIso(fecha: string): number {
  const d = new Date(aUtc(fecha)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** El lunes de la semana que contiene la fecha. */
export function lunesDe(fecha: string): string {
  return sumarDias(fecha, 1 - diaIso(fecha));
}

/** Los siete días (lunes a domingo) de la semana que contiene la fecha. */
export function semanaDe(fecha: string): string[] {
  const lunes = lunesDe(fecha);
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

/** El día 1 del mes de la fecha, o de `desplazamiento` meses después (negativo: antes). */
export function primerDiaDelMes(fecha: string, desplazamiento = 0): string {
  const [anio, mes] = fecha.split("-").map(Number);
  return deUtc(Date.UTC(anio, mes - 1 + desplazamiento, 1));
}

/** Las semanas completas (lunes a domingo) que cubren el mes de la fecha, de a siete días. */
export function rejillaDelMes(fecha: string): string[][] {
  const primero = primerDiaDelMes(fecha);
  const [anio, mes] = primero.split("-").map(Number);
  const ultimo = deUtc(Date.UTC(anio, mes, 0));
  const inicio = lunesDe(primero);
  const fin = sumarDias(lunesDe(ultimo), 6);
  const semanas: string[][] = [];
  for (let lunes = inicio; lunes <= fin; lunes = sumarDias(lunes, 7)) semanas.push(semanaDe(lunes));
  return semanas;
}

/** ¿Está la fecha en el mismo mes (y año) que la de referencia? */
export const mismoMes = (fecha: string, referencia: string): boolean => fecha.slice(0, 7) === referencia.slice(0, 7);

// ---------------------------------------------------------------------------------------------------------------------------
// Textos de fechas
// ---------------------------------------------------------------------------------------------------------------------------

const DIAS_EN_MINUSCULA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
const DIAS_EN_PLURAL = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"] as const;
const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;
const MESES_CORTOS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."] as const;

const partes = (fecha: string) => {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return { anio, mes, dia };
};

/** `jueves 19 de noviembre`. */
export function etiquetaDeDia(fecha: string): string {
  const { mes, dia } = partes(fecha);
  return `${DIAS_EN_MINUSCULA[diaIso(fecha) - 1]} ${dia} de ${MESES[mes - 1]}`;
}

/** `jue`: el nombre corto del día de la tira de la semana. */
export const nombreCortoDelDia = (fecha: string): string => DIAS_CORTOS[diaIso(fecha) - 1];

/** El número del día: `19`. */
export const numeroDelDia = (fecha: string): number => partes(fecha).dia;

/** `Noviembre de 2026`. */
export function tituloDelMes(fecha: string): string {
  const { anio, mes } = partes(fecha);
  const nombre = MESES[mes - 1];
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} de ${anio}`;
}

/** El rango de la semana que contiene la fecha: `16 a 22 de nov.`, `30 de nov. a 6 de dic.` o, si cruza el año, con los años. */
export function rangoDeSemana(fecha: string): string {
  const lunes = lunesDe(fecha);
  const domingo = sumarDias(lunes, 6);
  const a = partes(lunes);
  const b = partes(domingo);
  if (a.anio !== b.anio) {
    return `${a.dia} de ${MESES_CORTOS[a.mes - 1]} de ${a.anio} a ${b.dia} de ${MESES_CORTOS[b.mes - 1]} de ${b.anio}`;
  }
  if (a.mes !== b.mes) return `${a.dia} de ${MESES_CORTOS[a.mes - 1]} a ${b.dia} de ${MESES_CORTOS[b.mes - 1]}`;
  return `${a.dia} a ${b.dia} de ${MESES_CORTOS[b.mes - 1]}`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// La dirección: vista y día
// ---------------------------------------------------------------------------------------------------------------------------

type ValorDeDireccion = string | string[] | undefined;
const primero = (valor: ValorDeDireccion): string | undefined => (Array.isArray(valor) ? valor[0] : valor);

/** `?vista=`: «mes» o, para cualquier otra cosa, «semana». */
export function leerVista(valor: ValorDeDireccion): VistaDelCalendario {
  return primero(valor) === "mes" ? "mes" : "semana";
}

/** `?dia=`: una fecha real; si falta o no lo es, hoy. */
export function leerDia(valor: ValorDeDireccion, hoy: string): string {
  const dia = primero(valor);
  return esFecha(dia) ? dia : hoy;
}

/** La dirección del calendario para una vista y un día elegido. */
export const hrefDelCalendario = (vista: VistaDelCalendario, dia: string): string => `/monitor?vista=${vista}&dia=${dia}`;

// ---------------------------------------------------------------------------------------------------------------------------
// Ocurrencias de las franjas
// ---------------------------------------------------------------------------------------------------------------------------

/** ¿Ocurre la franja en esa fecha? Su día de la semana, desde `abierta_desde` y antes de `cerrada_desde` (exclusivo). */
export function franjaOcurreEn(franja: Pick<FranjaDeCalendario, "dia" | "abierta_desde" | "cerrada_desde">, fecha: string): boolean {
  return diaIso(fecha) === franja.dia && fecha >= franja.abierta_desde && (franja.cerrada_desde === null || fecha < franja.cerrada_desde);
}

/** Confirmada o realizada es reservada; pendiente de pago con la reserva vigente, por pagar; el resto no ocupa la fecha. */
export function estadoDeMonitoria(m: Pick<MonitoriaParaCalendario, "estado" | "reservaVencida">): Exclude<EstadoDeFranja, "libre"> | null {
  if (m.estado === "confirmada" || m.estado === "realizada") return "reservada";
  if (m.estado === "pendiente_pago" && !m.reservaVencida) return "por_pagar";
  return null;
}

/** La monitoría que ocupa la fecha y hora, si hay: una reservada gana a una por pagar. */
function ocupante(monitorias: readonly MonitoriaParaCalendario[], fecha: string, hora: string): MonitoriaParaCalendario | null {
  let porPagar: MonitoriaParaCalendario | null = null;
  for (const m of monitorias) {
    if (m.fecha !== fecha || horaCorta(m.hora) !== hora) continue;
    const estado = estadoDeMonitoria(m);
    if (estado === "reservada") return m;
    if (estado === "por_pagar" && !porPagar) porPagar = m;
  }
  return porPagar;
}

const porHora = (a: Ocurrencia, b: Ocurrencia) => a.minutoInicio - b.minutoInicio || a.clave.localeCompare(b.clave);

/**
 * Las franjas de cada día de `desde` a `hasta` (ambos incluidos), ordenadas por hora. Una libre en una fecha pasada (antes de `hoy`)
 * no se muestra. Una monitoría reservada o por pagar cuya franja ya no ocurre ese día (se cerró después) se muestra igual, armada
 * desde la monitoría.
 */
export function ocurrenciasPorDia(
  franjas: readonly FranjaDeCalendario[],
  monitorias: readonly MonitoriaParaCalendario[],
  desde: string,
  hasta: string,
  hoy: string,
): Record<string, Ocurrencia[]> {
  const resultado: Record<string, Ocurrencia[]> = {};
  for (let fecha = desde; fecha <= hasta; fecha = sumarDias(fecha, 1)) {
    const lista: Ocurrencia[] = [];
    const horasDeFranjas = new Set<string>();
    for (const franja of franjas) {
      if (!franjaOcurreEn(franja, fecha)) continue;
      const hora = horaCorta(franja.hora);
      horasDeFranjas.add(hora);
      const m = ocupante(monitorias, fecha, hora);
      const estado: EstadoDeFranja = m ? (estadoDeMonitoria(m) ?? "libre") : "libre";
      if (estado === "libre" && fecha < hoy) continue;
      lista.push({
        clave: `${fecha}|${hora}|${franja.id}`,
        fecha,
        hora,
        fin: horaDeFin(hora, franja.duracion_min),
        minutoInicio: minutosDe(hora) ?? 0,
        duracionMin: franja.duracion_min,
        presencial: franja.presencial,
        precio: Number(franja.precio),
        estado,
        idFranja: franja.id,
        estudiante: m?.nombreEstudiante ?? null,
        materia: m?.nombreMateria ?? null,
      });
    }
    // Reservadas o por pagar de una franja que ya no ocurre ese día.
    for (const candidata of monitorias) {
      if (candidata.fecha !== fecha) continue;
      const hora = horaCorta(candidata.hora);
      if (!estadoDeMonitoria(candidata) || horasDeFranjas.has(hora)) continue;
      // Una sola por hora: si hay una reservada y otra por pagar, gana la reservada.
      horasDeFranjas.add(hora);
      const m = ocupante(monitorias, fecha, hora) ?? candidata;
      const estado = estadoDeMonitoria(m)!;
      const origen = franjas.find((f) => f.dia === diaIso(fecha) && horaCorta(f.hora) === hora);
      lista.push({
        clave: `${fecha}|${hora}|${m.idMonitoria}`,
        fecha,
        hora,
        fin: horaDeFin(hora, m.duracionMin),
        minutoInicio: minutosDe(hora) ?? 0,
        duracionMin: m.duracionMin,
        presencial: m.presencial,
        precio: origen ? Number(origen.precio) : null,
        estado,
        idFranja: null,
        estudiante: m.nombreEstudiante,
        materia: m.nombreMateria,
      });
    }
    resultado[fecha] = lista.sort(porHora);
  }
  return resultado;
}

export const HORA_MINIMA_DE_LA_REJILLA = 8;
export const HORA_MAXIMA_DE_LA_REJILLA = 18;

/**
 * Las horas que cubre la rejilla de la semana: de 8:00 a 18:00 como mínimo, ampliadas (a horas completas) para que quepan todas
 * las franjas de la semana. `desde` es la primera hora y `hasta` la hora en que termina la última fila.
 */
export function rangoDeHoras(ocurrencias: readonly Pick<Ocurrencia, "minutoInicio" | "duracionMin">[]): { desde: number; hasta: number } {
  let desde = HORA_MINIMA_DE_LA_REJILLA;
  let hasta = HORA_MAXIMA_DE_LA_REJILLA;
  for (const o of ocurrencias) {
    desde = Math.min(desde, Math.floor(o.minutoInicio / 60));
    hasta = Math.max(hasta, Math.min(24, Math.ceil((o.minutoInicio + o.duracionMin) / 60)));
  }
  return { desde, hasta };
}

/** A dónde lleva una franja: la libre, a su página; la reservada o por pagar, a la agenda. */
export function rutaDeOcurrencia(o: Pick<Ocurrencia, "estado" | "idFranja">): string {
  return o.estado === "libre" && o.idFranja ? `/monitor/franjas/${o.idFranja}` : "/monitor/agenda";
}

export const TEXTO_DE_ESTADO: Record<EstadoDeFranja, string> = { libre: "Libre", reservada: "Reservada", por_pagar: "Por pagar" };

/** Las marcas de un día: una por franja, hasta tres, y si hay más, un «+». */
export function marcasDelDia(ocurrencias: readonly Pick<Ocurrencia, "estado">[]): { estados: EstadoDeFranja[]; hayMas: boolean } {
  return { estados: ocurrencias.slice(0, 3).map((o) => o.estado), hayMas: ocurrencias.length > 3 };
}

/** `3 franjas · 1 libre`, o `Sin franjas este día`. */
export function resumenDelDia(ocurrencias: readonly Pick<Ocurrencia, "estado">[]): string {
  if (ocurrencias.length === 0) return "Sin franjas este día";
  const libres = ocurrencias.filter((o) => o.estado === "libre").length;
  const franjas = `${ocurrencias.length} ${ocurrencias.length === 1 ? "franja" : "franjas"}`;
  return `${franjas} · ${libres === 0 ? "ninguna libre" : `${libres} ${libres === 1 ? "libre" : "libres"}`}`;
}

/** El nombre accesible de un día de la tira o del mes: `jueves 19 de noviembre, 3 franjas`. */
export function nombreAccesibleDelDia(fecha: string, cantidad: number, hoy: string): string {
  const franjas = cantidad === 0 ? "sin franjas" : `${cantidad} ${cantidad === 1 ? "franja" : "franjas"}`;
  return `${etiquetaDeDia(fecha)}${fecha === hoy ? " (hoy)" : ""}, ${franjas}`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Repetición al abrir una franja
// ---------------------------------------------------------------------------------------------------------------------------

/** El número de semanas escrito, si es un entero de 2 a 16. */
export function leerSemanas(valor: string | number): number | null {
  const n = typeof valor === "number" ? valor : /^\d{1,3}$/.test(valor.trim()) ? Number(valor.trim()) : Number.NaN;
  return Number.isInteger(n) && n >= MIN_SEMANAS && n <= MAX_SEMANAS ? n : null;
}

/**
 * Las fechas que cubre la repetición, para el texto del formulario: «solo este día» es una; «N semanas», las N; «todas las
 * semanas», las cuatro primeras (no tiene fin). Con un número de semanas inválido, ninguna.
 */
export function fechasDeRepeticion(fecha: string, repite: Repite, semanas: string | number): string[] {
  if (repite === "una") return [fecha];
  if (repite === "siempre") return Array.from({ length: 4 }, (_, i) => sumarDias(fecha, 7 * i));
  const n = leerSemanas(semanas);
  return n === null ? [] : Array.from({ length: n }, (_, i) => sumarDias(fecha, 7 * i));
}

/** `el 19 y el 26 de noviembre, y el 3 y el 10 de diciembre`: agrupa por mes y pone el año solo si cambia respecto del primero. */
function listaDeFechas(fechas: readonly string[]): string {
  const anioInicial = partes(fechas[0]).anio;
  const grupos: { anio: number; mes: number; dias: number[] }[] = [];
  for (const f of fechas) {
    const { anio, mes, dia } = partes(f);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.anio === anio && ultimo.mes === mes) ultimo.dias.push(dia);
    else grupos.push({ anio, mes, dias: [dia] });
  }
  return grupos
    .map(({ anio, mes, dias }) => {
      const items = dias.map((d) => `el ${d}`);
      const dichos = items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
      return `${dichos} de ${MESES[mes - 1]}${anio === anioInicial ? "" : ` de ${anio}`}`;
    })
    .join(", y ");
}

/** `19 de noviembre` (con el año si no es el de la referencia). */
function diaYMes(fecha: string, anioDeReferencia: number): string {
  const { anio, mes, dia } = partes(fecha);
  return `${dia} de ${MESES[mes - 1]}${anio === anioDeReferencia ? "" : ` de ${anio}`}`;
}

/** Lo que el formulario dice que quedará abierto con la repetición elegida. */
export function textoDeRepeticion(fecha: string, repite: Repite, semanas: string | number): string {
  const indice = diaIso(fecha) - 1;
  if (repite === "una") return `Quedará abierta solo el ${diaYMes(fecha, partes(fecha).anio)}.`;
  const fechas = fechasDeRepeticion(fecha, repite, semanas);
  if (fechas.length === 0) return `Elige entre ${MIN_SEMANAS} y ${MAX_SEMANAS} semanas.`;
  if (repite === "siempre") return `Quedará abierta ${listaDeFechas(fechas)}, y así cada ${DIAS_EN_MINUSCULA[indice]}, sin fecha final.`;
  if (fechas.length <= 4) return `Quedará abierta ${listaDeFechas(fechas)}.`;
  const anio = partes(fecha).anio;
  return `Quedará abierta cada ${DIAS_EN_MINUSCULA[indice]}, desde el ${diaYMes(fechas[0], anio)} hasta el ${diaYMes(fechas[fechas.length - 1], anio)} (${fechas.length} semanas).`;
}

/** El texto de la opción «Cada jueves durante N semanas»: el día en minúscula. */
export const nombreDelDiaEnMinuscula = (fecha: string): string => DIAS_EN_MINUSCULA[diaIso(fecha) - 1];
export const nombreDelDiaEnPlural = (fecha: string): string => DIAS_EN_PLURAL[diaIso(fecha) - 1];
