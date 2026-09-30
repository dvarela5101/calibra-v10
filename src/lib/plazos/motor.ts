import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import type { ParametrosComision, ParametrosNegocio } from "./parametros";

/**
 * Motor de plazos y montos derivados (HU-003): las mismas fórmulas de la base
 * (`supabase/migrations/*_plazos_y_comision.sql`, que es la fuente de verdad), para que las
 * pantallas calculen sin ir a la base. `integracion/plazos.test.ts` comprueba que ambas
 * coincidan. Ningún número vive aquí: todos vienen de `ParametrosNegocio`.
 *
 * Bordes inclusivos (P-40): "hasta X" es ahora <= X, "desde X" es ahora >= X, y con la
 * antelación exacta todavía se puede agendar. Solo `dentroDePlazo` y `plazoAlcanzado` deciden el
 * borde. Hoy únicamente `cumpleAntelacion` y `desembolsoEjecutable` las llaman; las demás
 * funciones devuelven el instante límite sin compararlo, y quien lo compare con `ahora` debe usar
 * esas dos y no repetir < ni >.
 *
 * Los instantes son `Date` (UTC). Nada usa la zona del servidor ni la del navegador: la fecha y
 * la hora de una franja se interpretan siempre en `ZONA_HORARIA_NEGOCIO`.
 */

const MS_POR_MINUTO = 60_000;

function exigirInstante(valor: Date, nombre: string): void {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) {
    throw new RangeError(`${nombre} debe ser una fecha válida.`);
  }
}

function exigirEnteroNoNegativo(valor: number, nombre: string): void {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new RangeError(`${nombre} debe ser un entero mayor o igual a cero (llegó ${String(valor)}).`);
  }
}

function sumarMinutos(instante: Date, minutos: number, nombre: string): Date {
  exigirInstante(instante, nombre);
  return new Date(instante.getTime() + minutos * MS_POR_MINUTO);
}

// ---------------------------------------------------------------------------
// Bordes inclusivos (P-40)
// ---------------------------------------------------------------------------

/** "Hasta X": con ahora = X todavía se está dentro del plazo. */
export function dentroDePlazo(limite: Date, ahora: Date): boolean {
  exigirInstante(limite, "limite");
  exigirInstante(ahora, "ahora");
  return ahora.getTime() <= limite.getTime();
}

/** "Desde X": con ahora = X el plazo ya se alcanzó. */
export function plazoAlcanzado(desde: Date, ahora: Date): boolean {
  exigirInstante(desde, "desde");
  exigirInstante(ahora, "ahora");
  return ahora.getTime() >= desde.getTime();
}

// ---------------------------------------------------------------------------
// Inicio y fin de la sesión (RN-36)
// ---------------------------------------------------------------------------

const MIN_ANIO = 1900;
const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORMATO_HORA = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

const formatoDePared = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** Cuánto adelanta la hora de pared del negocio a UTC en ese instante, en ms. */
function desfaseDelNegocio(instanteMs: number): number {
  const segundos = Math.floor(instanteMs / 1000) * 1000;
  const partes = formatoDePared.formatToParts(new Date(segundos));
  const numero = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((parte) => parte.type === tipo)?.value);
  const paredComoUtc = Date.UTC(
    numero("year"),
    numero("month") - 1,
    numero("day"),
    numero("hour"),
    numero("minute"),
    numero("second"),
  );
  return paredComoUtc - segundos;
}

/** Fecha `YYYY-MM-DD` validada contra el calendario (rechaza 2026-02-30). */
function leerFecha(fecha: string): { anio: number; mes: number; dia: number } {
  const coincidencia = FORMATO_FECHA.exec(fecha);
  if (!coincidencia) throw new RangeError(`La fecha debe ser AAAA-MM-DD (llegó "${fecha}").`);
  const [anio, mes, dia] = [Number(coincidencia[1]), Number(coincidencia[2]), Number(coincidencia[3])];
  // Date.UTC trata los años 0 a 99 como 1900 a 1999, y antes de 1914 Bogotá tenía otro huso:
  // ninguna sesión de Calibra cae ahí, así que se rechaza en vez de calcular un instante erróneo.
  if (anio < MIN_ANIO) throw new RangeError(`El año ${anio} está fuera de rango (mínimo ${MIN_ANIO}).`);
  const control = new Date(Date.UTC(anio, mes - 1, dia));
  if (control.getUTCFullYear() !== anio || control.getUTCMonth() !== mes - 1 || control.getUTCDate() !== dia) {
    throw new RangeError(`La fecha "${fecha}" no existe en el calendario.`);
  }
  return { anio, mes, dia };
}

/** Día ISO de la semana de una fecha `YYYY-MM-DD`: 1 = lunes ... 7 = domingo. */
export function diaIsoDeFecha(fecha: string): number {
  const { anio, mes, dia } = leerFecha(fecha);
  const diaJs = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return diaJs === 0 ? 7 : diaJs;
}

/**
 * Inicio de la sesión: fecha más hora de la franja, en la zona del negocio (RN-36).
 * `fecha` es `AAAA-MM-DD` y `hora` es `HH:MM` o `HH:MM:SS`.
 */
export function inicioDeSesion(fecha: string, hora: string): Date {
  const { anio, mes, dia } = leerFecha(fecha);
  const horaLeida = FORMATO_HORA.exec(hora);
  if (!horaLeida) throw new RangeError(`La hora debe ser HH:MM o HH:MM:SS (llegó "${hora}").`);
  const pared = Date.UTC(anio, mes - 1, dia, Number(horaLeida[1]), Number(horaLeida[2]), Number(horaLeida[3] ?? 0));
  // Dos pasadas: la segunda corrige si el desfase de la zona cambió entre ambos instantes.
  const primero = pared - desfaseDelNegocio(pared);
  return new Date(pared - desfaseDelNegocio(primero));
}

/** Fin programado: inicio más la duración de la franja (RN-36). */
export function finProgramado(inicio: Date, duracionMin: number): Date {
  if (!Number.isSafeInteger(duracionMin) || duracionMin <= 0) {
    throw new RangeError(`duracionMin debe ser un entero mayor que cero (llegó ${String(duracionMin)}).`);
  }
  return sumarMinutos(inicio, duracionMin, "inicio");
}

export type FranjaDeSesion = {
  /** Día ISO de la semana: 1 = lunes ... 7 = domingo. */
  dia: number;
  /** `HH:MM` o `HH:MM:SS`. */
  hora: string;
  duracionMin: number;
};

/**
 * Inicio y fin de la sesión de una franja en una fecha concreta. Como el trigger de la base,
 * rechaza una fecha que no cae en el día de la franja.
 */
export function sesionDeFranja(franja: FranjaDeSesion, fecha: string): { inicio: Date; fin: Date } {
  if (diaIsoDeFecha(fecha) !== franja.dia) {
    throw new RangeError(`La fecha ${fecha} no cae en el día ${franja.dia} de la franja.`);
  }
  const inicio = inicioDeSesion(fecha, franja.hora);
  return { inicio, fin: finProgramado(inicio, franja.duracionMin) };
}

// ---------------------------------------------------------------------------
// Plazos (sección 6.1)
// ---------------------------------------------------------------------------

/** `/reservaHasta`: la franja queda bloqueada hasta aquí si no llega comprobante (RN-34). */
export function reservaHasta(fechaCreacion: Date, p: ParametrosNegocio): Date {
  return sumarMinutos(fechaCreacion, p.reservaMin, "fechaCreacion");
}

/** `/revisionHasta`: hasta aquí revisa el admin asignado; después se escala (RN-42). */
export function revisionHasta(fechaAsignacion: Date, p: ParametrosNegocio): Date {
  return sumarMinutos(fechaAsignacion, p.revisionMin, "fechaAsignacion");
}

/** `/cancelableHasta`: 12 h antes del inicio en una individual, 24 h en una grupal (RN-60). */
export function cancelableHasta(inicio: Date, esGrupal: boolean, p: ParametrosNegocio): Date {
  return sumarMinutos(inicio, -(esGrupal ? p.cancelacionGrupalMin : p.cancelacionIndividualMin), "inicio");
}

/** `/fechaLimitePago`: los integrantes de una grupal pagan hasta aquí (RN-54). */
export function fechaLimitePago(inicio: Date, p: ParametrosNegocio): Date {
  return sumarMinutos(inicio, -p.pagoIntegrantesMin, "inicio");
}

/** `/fechaLimiteDiferencia`: hasta aquí se cubre la diferencia al pasar a individual (RN-55). */
export function fechaLimiteDiferencia(inicio: Date, p: ParametrosNegocio): Date {
  return sumarMinutos(inicio, -p.diferenciaMin, "inicio");
}

/** `/reporteInasistenciaHasta`: 24 h después del fin programado (RN-62). */
export function reporteInasistenciaHasta(finProgramadoDeSesion: Date, p: ParametrosNegocio): Date {
  return sumarMinutos(finProgramadoDeSesion, p.reporteInasistenciaMin, "finProgramado");
}

/**
 * `/ventanaResenaHasta`: 1 h después de finalizar una grupal (RN-71). Sin fecha de finalización no
 * hay ventana: rechaza, igual que `public.ventana_resena_hasta(null)` en la base.
 */
export function ventanaResenaHasta(fechaFinalizacion: Date, p: ParametrosNegocio): Date {
  return sumarMinutos(fechaFinalizacion, p.resenaGrupalMin, "fechaFinalizacion");
}

/** `/desembolsableDesde`: 24 h después del fin programado (RN-83). */
export function desembolsableDesde(finProgramadoDeSesion: Date, p: ParametrosNegocio): Date {
  return sumarMinutos(finProgramadoDeSesion, p.desembolsoMin, "finProgramado");
}

/**
 * ¿Se puede ejecutar el desembolso de una sesión que terminó en `finProgramadoDeSesion`? Solo cuando
 * ya venció la ventana de reporte de inasistencia (RN-83, N-6): se alcanzó `desembolsableDesde` y
 * `ahora` ya no está dentro de `reporteInasistenciaHasta`. En el instante exacto fin + 24 h el
 * reporte todavía se puede hacer (P-40), así que el desembolso todavía no es ejecutable; lo es
 * desde un instante después. Igual que `public.desembolso_ejecutable()` en la base.
 */
export function desembolsoEjecutable(finProgramadoDeSesion: Date, ahora: Date, p: ParametrosNegocio): boolean {
  return (
    plazoAlcanzado(desembolsableDesde(finProgramadoDeSesion, p), ahora) &&
    !dentroDePlazo(reporteInasistenciaHasta(finProgramadoDeSesion, p), ahora)
  );
}

/**
 * Antelación mínima para agendar (RN-35): 3 h en individual y 36 h en grupal, desde `ahora`
 * hasta el inicio. Con la antelación exacta todavía se puede agendar (P-40).
 */
export function cumpleAntelacion(inicio: Date, ahora: Date, esGrupal: boolean, p: ParametrosNegocio): boolean {
  const antelacionMin = esGrupal ? p.antelacionGrupalMin : p.antelacionIndividualMin;
  return dentroDePlazo(sumarMinutos(inicio, -antelacionMin, "inicio"), ahora);
}

// ---------------------------------------------------------------------------
// Atributos derivados de una monitoría (sección 10)
// ---------------------------------------------------------------------------

export type EntradaMonitoria = {
  franja: FranjaDeSesion;
  /** Fecha concreta de la sesión, `AAAA-MM-DD`. */
  fecha: string;
  fechaCreacion: Date;
  esGrupal: boolean;
  /** Se llena al pasar a `realizada`. */
  fechaFinalizacion: Date | null;
};

export type PlazosDeMonitoria = {
  inicio: Date;
  finProgramado: Date;
  reservaHasta: Date;
  cancelableHasta: Date;
  /** Solo grupales. */
  fechaLimitePago: Date | null;
  /** Solo grupales. */
  fechaLimiteDiferencia: Date | null;
  reporteInasistenciaHasta: Date;
  /** Solo grupales ya finalizadas: la reseña individual no tiene límite (RN-72). */
  ventanaResenaHasta: Date | null;
  desembolsableDesde: Date;
};

/** Mismos valores que la vista `public.monitoria_plazos` de la base. */
export function derivadosDeMonitoria(entrada: EntradaMonitoria, p: ParametrosNegocio): PlazosDeMonitoria {
  const { inicio, fin } = sesionDeFranja(entrada.franja, entrada.fecha);
  return {
    inicio,
    finProgramado: fin,
    reservaHasta: reservaHasta(entrada.fechaCreacion, p),
    cancelableHasta: cancelableHasta(inicio, entrada.esGrupal, p),
    fechaLimitePago: entrada.esGrupal ? fechaLimitePago(inicio, p) : null,
    fechaLimiteDiferencia: entrada.esGrupal ? fechaLimiteDiferencia(inicio, p) : null,
    reporteInasistenciaHasta: reporteInasistenciaHasta(fin, p),
    ventanaResenaHasta:
      entrada.esGrupal && entrada.fechaFinalizacion ? ventanaResenaHasta(entrada.fechaFinalizacion, p) : null,
    desembolsableDesde: desembolsableDesde(fin, p),
  };
}

// ---------------------------------------------------------------------------
// Comisión de la plataforma (RN-81)
// ---------------------------------------------------------------------------

/**
 * `comision = min(10 % del bruto, 15.000)`. Los montos son pesos enteros, así que el 10 % se
 * redondea al peso más cercano y, en el empate de medio peso, hacia arriba (N-1, aprobado el
 * 29-sep-2026). Aritmética entera: nada de coma flotante en dinero.
 *
 * La comisión solo la calcula el servidor (N-2): los parámetros salen de `cargarParametrosComision`,
 * que necesita la llave secreta, y ninguna pantalla debe mostrar la cifra (P-32).
 */
export function calcularComision(montoBruto: number, p: ParametrosComision): number {
  exigirEnteroNoNegativo(montoBruto, "montoBruto");
  const porcentaje = Math.floor((montoBruto * p.comisionPorcentaje + 50) / 100);
  return Math.min(porcentaje, p.comisionTope);
}

/** `montoNeto = montoBruto - comision`. */
export function calcularMontoNeto(montoBruto: number, p: ParametrosComision): number {
  return montoBruto - calcularComision(montoBruto, p);
}
