/**
 * Franjas semanales del monitor (HU-015, RN-30, RN-31, P-30, P-31). Validación del formulario, igual a
 * la de la base (trigger `privado.validar_franja_del_monitor`): aquí se da el mensaje antes de ir a la
 * base, y la base lo exige aunque alguien se salte la app. Desde D-76 (HU-107) la franja no lleva lugar
 * ni enlace: son de cada monitoría y el monitor los pone desde su agenda.
 */

/** Día ISO: 1 = lunes ... 7 = domingo, como `franja.dia` y `extract(isodow ...)`. */
export const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;

export const MINUTOS_DEL_DIA = 24 * 60;
export const LARGO_MAXIMO_LUGAR = 200;
const LARGO_MAXIMO_ENLACE = 500;

export type DatosDeFranja = {
  dia: number;
  /** `HH:MM`, en la hora del negocio. */
  hora: string;
  presencial: boolean;
  /** Pesos colombianos enteros (RN-31). */
  precio: number;
  duracionMin: number;
};

export type Lectura<T> = { ok: true; datos: T } | { ok: false; error: string };

export function nombreDelDia(dia: number): string {
  const nombre = DIAS[dia - 1];
  if (!nombre) throw new RangeError(`El día debe estar entre 1 y 7 (llegó ${dia}).`);
  return nombre;
}

/** Minutos desde la medianoche de `HH:MM` o `HH:MM:SS`; `null` si no es una hora. */
export function minutosDe(hora: string): number | null {
  const partes = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(hora.trim());
  return partes ? Number(partes[1]) * 60 + Number(partes[2]) : null;
}

/** `HH:MM` de unos minutos desde la medianoche. */
export function horaDe(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Un entero positivo escrito por una persona: acepta `25.000`, `25 000` y `25000`; no decimales. El punto y
 * el espacio solo valen para separar miles de a tres cifras: `25000.00` o `25.5` no se leen como 2.500.000
 * ni como 255.
 */
export function leerEntero(valor: string): number | null {
  const limpio = valor.trim();
  if (!/^(\d{1,9}|\d{1,3}(?:[. ]\d{3}){1,2})$/.test(limpio)) return null;
  return Number(limpio.replace(/[. ]/g, ""));
}

export function esEnlaceDeVideollamada(valor: string): boolean {
  if (valor.length > LARGO_MAXIMO_ENLACE || /\s/.test(valor)) return false;
  try {
    const url = new URL(valor);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

const texto = (valor: FormDataEntryValue | null) => String(valor ?? "").replace(/\s+/g, " ").trim();

export function leerFranja(formulario: FormData): Lectura<DatosDeFranja> {
  const dia = Number(texto(formulario.get("dia")));
  if (!Number.isInteger(dia) || dia < 1 || dia > 7) return { ok: false, error: "Elige el día de la semana." };

  const hora = texto(formulario.get("hora"));
  const inicio = minutosDe(hora);
  if (inicio === null) return { ok: false, error: "Escribe la hora de inicio, por ejemplo 14:00." };

  const duracionMin = leerEntero(texto(formulario.get("duracion_min")));
  if (!duracionMin) return { ok: false, error: "Escribe la duración en minutos, por ejemplo 60." };
  if (inicio + duracionMin > MINUTOS_DEL_DIA) {
    return { ok: false, error: "La franja debe terminar el mismo día: revisa la hora y la duración." };
  }

  const precio = leerEntero(texto(formulario.get("precio")));
  if (!precio) return { ok: false, error: "Escribe el precio en pesos, sin decimales, por ejemplo 25000." };

  const modalidad = texto(formulario.get("modalidad"));
  if (modalidad !== "presencial" && modalidad !== "virtual") return { ok: false, error: "Elige si es presencial o virtual." };
  const presencial = modalidad === "presencial";

  return { ok: true, datos: { dia, hora: horaDe(inicio), presencial, precio, duracionMin } };
}

/**
 * `HH:MM` de una hora que viene de la base (`HH:MM:SS`). Recorta los segundos: el monitor no los puede
 * escribir, pero una escritura de confianza sí, y la pantalla no debe caerse por eso.
 */
export function horaCorta(hora: string): string {
  return hora.slice(0, 5);
}

/** Fin de la franja en `HH:MM`, para mostrar "de 14:00 a 15:30". */
export function horaDeFin(hora: string, duracionMin: number): string {
  const inicio = minutosDe(horaCorta(hora));
  if (inicio === null) throw new RangeError(`Hora inválida: ${hora}`);
  return horaDe(inicio + duracionMin);
}

/**
 * Fecha desde la que se cierra una franja (P-30): `AAAA-MM-DD`, hoy o después, en la zona del negocio.
 * Que no tenga monitorías ese día o después lo revisa la base.
 */
export function leerCierre(formulario: FormData, hoy: string): Lectura<{ cerradaDesde: string }> {
  const fecha = String(formulario.get("cerrada_desde") ?? "").trim();
  const instante = new Date(`${fecha}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(instante.getTime()) || instante.toISOString().slice(0, 10) !== fecha) {
    return { ok: false, error: "Elige la fecha desde la que se cierra." };
  }
  if (fecha < hoy) return { ok: false, error: "La franja se cierra desde hoy o desde una fecha futura." };
  return { ok: true, datos: { cerradaDesde: fecha } };
}

/** Cuántas semanas puede durar una franja que se repite «durante N semanas» (D-94). */
export const SEMANAS_MIN = 2;
export const SEMANAS_MAX = 16;

/**
 * Cuándo empieza y cuándo termina una franja abierta desde el calendario (D-94). `cerradaDesde` es exclusivo, como
 * `franja.cerrada_desde`: la franja no recibe reservas desde esa fecha; `null` es «todas las semanas, sin fecha final».
 */
export type Repeticion = { abiertaDesde: string; cerradaDesde: string | null; dia: number };

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** La fecha civil `AAAA-MM-DD` como un instante UTC a medianoche, o `null` si no es una fecha real. */
function fechaCivil(fecha: string): number | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!partes) return null;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const instante = new Date(Date.UTC(anio, mes - 1, dia));
  // Date rueda los días que no existen al mes siguiente: la ida y vuelta los rechaza.
  if (instante.getUTCFullYear() !== anio || instante.getUTCMonth() !== mes - 1 || instante.getUTCDate() !== dia) return null;
  return instante.getTime();
}

/** Suma días a una fecha civil sin zona horaria. */
function sumarDias(fecha: string, dias: number): string {
  const base = fechaCivil(fecha);
  if (base === null) throw new RangeError(`La fecha debe ser AAAA-MM-DD (llegó "${fecha}").`);
  return new Date(base + dias * MS_POR_DIA).toISOString().slice(0, 10);
}

/** Día ISO (1 = lunes ... 7 = domingo) de una fecha civil. */
function diaIsoDe(fecha: string): number {
  const base = fechaCivil(fecha);
  if (base === null) throw new RangeError(`La fecha debe ser AAAA-MM-DD (llegó "${fecha}").`);
  return new Date(base).getUTCDay() || 7;
}

/**
 * Lee la repetición del formulario del calendario: `fecha` (`AAAA-MM-DD`), `repite` (`una`, `semanas` o `siempre`, por
 * defecto `siempre`) y `semanas` (de SEMANAS_MIN a SEMANAS_MAX, solo con `repite=semanas`). Sin `fecha` devuelve
 * `repeticion: null`: la franja se abre como siempre (desde hoy, todas las semanas) y el día lo manda el formulario.
 */
export function leerRepeticion(
  datos: FormData,
  hoy: string,
): { ok: true; repeticion: Repeticion | null } | { ok: false; error: string } {
  const fecha = texto(datos.get("fecha"));
  if (fecha === "") return { ok: true, repeticion: null };
  if (fechaCivil(fecha) === null) return { ok: false, error: "Elige una fecha válida para la franja." };
  if (fecha < hoy) return { ok: false, error: "No puedes abrir una franja en una fecha que ya pasó." };

  const repite = texto(datos.get("repite")) || "siempre";
  const dia = diaIsoDe(fecha);

  if (repite === "una") return { ok: true, repeticion: { abiertaDesde: fecha, cerradaDesde: sumarDias(fecha, 1), dia } };
  if (repite === "siempre") return { ok: true, repeticion: { abiertaDesde: fecha, cerradaDesde: null, dia } };
  if (repite === "semanas") {
    const crudo = texto(datos.get("semanas"));
    const semanas = /^\d{1,3}$/.test(crudo) ? Number(crudo) : NaN;
    if (!Number.isInteger(semanas) || semanas < SEMANAS_MIN || semanas > SEMANAS_MAX) {
      return { ok: false, error: `Elige entre ${SEMANAS_MIN} y ${SEMANAS_MAX} semanas.` };
    }
    return { ok: true, repeticion: { abiertaDesde: fecha, cerradaDesde: sumarDias(fecha, 7 * (semanas - 1) + 1), dia } };
  }
  return { ok: false, error: "Elige cuánto se repite la franja." };
}

/**
 * Las fechas concretas en que queda abierta una franja con cierre (una por semana, a lo sumo SEMANAS_MAX); `[]` si no
 * tiene fecha final.
 */
export function fechasDeLaRepeticion(r: Repeticion): string[] {
  if (r.cerradaDesde === null) return [];
  const fechas: string[] = [];
  for (let f = r.abiertaDesde; f < r.cerradaDesde && fechas.length < SEMANAS_MAX; f = sumarDias(f, 7)) fechas.push(f);
  return fechas;
}

/** Mensaje para la persona a partir de un error de la base al escribir una franja. */
export function mensajeDeErrorDeFranja(error: { code?: string; message?: string } | null): string {
  // P0001: los mensajes de las reglas de la franja (trigger `privado.validar_franja_del_monitor`), ya escritos para la persona.
  if (error?.code === "P0001" && error.message) return error.message;
  if (error?.code === "42501") return "No puedes hacer ese cambio en esta franja.";
  if (error?.code === "23514") return "Revisa los datos de la franja: alguno no es válido.";
  return "No pudimos guardar la franja. Intenta de nuevo.";
}

