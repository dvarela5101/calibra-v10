/**
 * Mis desembolsos (HU-050; RN-80 a RN-83, P-28, P-29, P-37, D-59). Aquí va lo puro: repartir en grupos, ordenar,
 * partir los transferidos y qué se le dice al monitor de cada situación. En qué situación está cada desembolso y
 * sus tres cifras las da la base (`public.mis_desembolsos`); la app no recalcula nada, tampoco la comisión (N-2).
 * Esta es la única pantalla que muestra cifras de comisión (D-59): `pruebas/comision-solo-en-desembolsos.test.ts`
 * vigila que no se escapen a otra.
 */
import { diaDelNegocio, formatearDia, formatearHora } from "@/lib/fechas";

/**
 * Las siete situaciones que entrega la base, en este orden. No hay una de reporte en revisión: la base la junta con
 * `en_espera` para que el monitor no pueda leer que hay un reporte de inasistencia (D-59 b).
 */
export const SITUACIONES = ["en_plazo", "listo", "pago_en_revision", "pago_rechazado", "en_espera", "transferido", "anulado"] as const;
export type Situacion = (typeof SITUACIONES)[number];

export function esSituacion(valor: unknown): valor is Situacion {
  return typeof valor === "string" && (SITUACIONES as readonly string[]).includes(valor);
}

/** Las tres cifras de D-59 a, en pesos enteros: el total de la monitoría, la comisión de Calibra y lo que se transfiere. */
export type MontosDeDesembolso = { bruto: number; comision: number; neto: number };

export type DesembolsoDelMonitor = {
  idDesembolso: string;
  /** `AAAA-MM-DD`, el día de la sesión en la zona del negocio. */
  fecha: string;
  /** `HH:MM:SS`, en la zona del negocio. */
  hora: string;
  duracionMin: number;
  nombreMateria: string;
  situacion: Situacion;
  /** Solo en `en_plazo`: el instante desde el que se puede transferir (N-6). */
  desembolsableDesde: Date | null;
  /** Por transferir: el cálculo de ahora. Transferido: lo que quedó al ejecutar. Anulado: nulo. */
  montos: MontosDeDesembolso | null;
  /** La llave copiada al crear el desembolso (RN-80); nula en un anulado. */
  llaveDestino: string | null;
  /** Solo transferido: lo que escribió el admin. */
  referencia: string | null;
  /** Solo transferido: el día de la transferencia en la zona del negocio, `AAAA-MM-DD`. */
  diaDeTransferencia: string | null;
};

export type GrupoDeDesembolsos = "porTransferir" | "transferidos" | "anulados";

export function grupoDe(situacion: Situacion): GrupoDeDesembolsos {
  switch (situacion) {
    case "en_plazo":
    case "listo":
    case "pago_en_revision":
    case "pago_rechazado":
    case "en_espera":
      return "porTransferir";
    case "transferido":
      return "transferidos";
    case "anulado":
      return "anulados";
  }
}

export type DesembolsosAgrupados = Record<GrupoDeDesembolsos, DesembolsoDelMonitor[]>;

/** Un orden que no depende de la configuración regional del servidor. */
const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Reparte los desembolsos en sus tres grupos y ordena cada uno (el orden de la base es solo para que la salida sea
 * estable). Por transferir: el día de la sesión, el más viejo primero (la hora y el id desempatan). Transferidos: el
 * día de la transferencia, el más reciente primero, y después el día de la sesión. Anulados: el día de la sesión, el
 * más reciente primero. No pierde ni duplica ninguno ni cambia la lista que recibe.
 */
export function agruparDesembolsos(lista: readonly DesembolsoDelMonitor[]): DesembolsosAgrupados {
  const grupos: DesembolsosAgrupados = { porTransferir: [], transferidos: [], anulados: [] };
  for (const d of lista) grupos[grupoDe(d.situacion)].push(d);
  grupos.porTransferir.sort((a, b) => comparar(a.fecha, b.fecha) || comparar(a.hora, b.hora) || comparar(a.idDesembolso, b.idDesembolso));
  grupos.transferidos.sort(
    (a, b) =>
      comparar(b.diaDeTransferencia ?? "", a.diaDeTransferencia ?? "") ||
      comparar(b.fecha, a.fecha) ||
      comparar(b.hora, a.hora) ||
      comparar(a.idDesembolso, b.idDesembolso),
  );
  grupos.anulados.sort((a, b) => comparar(b.fecha, a.fecha) || comparar(b.hora, a.hora) || comparar(a.idDesembolso, b.idDesembolso));
  return grupos;
}

/** Transferidos que se ven antes de "Ver N más". */
export const TRANSFERIDOS_A_LA_VISTA = 10;

/** Los primeros `cuantos` y el resto, en el mismo orden. */
export function partirEn<T>(lista: readonly T[], cuantos: number): { aLaVista: T[]; resto: T[] } {
  const corte = Math.max(0, cuantos);
  return { aLaVista: lista.slice(0, corte), resto: lista.slice(corte) };
}

/** Los textos fijos que lee el monitor. Los que llevan un dato (un día, una llave) se arman en las funciones de abajo. */
export const TEXTOS = {
  listo: "Listo para transferir. Un admin lo transfiere a tu llave.",
  pagoEnRevision: "En espera: un pago de esta monitoría sigue en revisión.",
  pagoRechazado: "En espera: Calibra está resolviendo un pago rechazado de esta monitoría.",
  // D-59 b: sin las palabras "reporte" ni "inasistencia".
  enEspera: "En espera: Calibra tiene que resolver algo de esta monitoría antes de transferir.",
  anulado: "Anulado: la monitoría se canceló porque se aceptó un reporte de inasistencia. No se transfiere.",
  confirmacion: "Los montos se confirman cuando un admin hace la transferencia.",
  sinMonto: "Todavía no hay un monto para transferir.",
  siLaLlaveNoSirve: "Si esa llave ya no sirve, escribe a",
} as const;

/**
 * La frase de la situación. En `transferido` es solo la primera línea («Transferido el 30 de diciembre de 2031.»):
 * la referencia y la llave van aparte (`detallesDeTransferencia`). El día y la hora salen siempre en la zona del
 * negocio, nunca en la del servidor.
 */
export function textoDeSituacion(d: Pick<DesembolsoDelMonitor, "situacion" | "desembolsableDesde" | "diaDeTransferencia">): string {
  switch (d.situacion) {
    case "en_plazo": {
      if (!d.desembolsableDesde) throw new RangeError("Un desembolso en plazo necesita la fecha desde la que se puede transferir.");
      const hora = formatearHora(d.desembolsableDesde);
      // La hora de la mañana o de la tarde ya termina en punto ("a. m."): no se le agrega otro.
      return `Se puede transferir después del ${formatearDia(diaDelNegocio(d.desembolsableDesde))} a las ${hora}${hora.endsWith(".") ? "" : "."}`;
    }
    case "listo":
      return TEXTOS.listo;
    case "pago_en_revision":
      return TEXTOS.pagoEnRevision;
    case "pago_rechazado":
      return TEXTOS.pagoRechazado;
    case "en_espera":
      return TEXTOS.enEspera;
    case "transferido":
      if (!d.diaDeTransferencia) throw new RangeError("Un desembolso transferido necesita el día de la transferencia.");
      return `Transferido el ${formatearDia(d.diaDeTransferencia)}.`;
    case "anulado":
      return TEXTOS.anulado;
  }
}

/** Los renglones que siguen a «Transferido el …»: lo que escribió el admin y la llave a la que se transfirió (RN-80). Vacío si no es transferido. */
export function detallesDeTransferencia(d: Pick<DesembolsoDelMonitor, "situacion" | "referencia" | "llaveDestino">): string[] {
  if (d.situacion !== "transferido") return [];
  return [`Referencia: ${d.referencia ?? ""}`, `Llave: ${d.llaveDestino ?? ""}`];
}

/** Los rótulos de las tres cifras, en este orden. */
export const ROTULOS_DE_MONTOS = ["Total de la monitoría", "Comisión de Calibra", "Te transferimos"] as const;

const enMinuscula = (texto: string) => texto.charAt(0).toLocaleLowerCase("es-CO") + texto.slice(1);

/**
 * Los rótulos de las tres cifras. En un desembolso por transferir son el cálculo de ahora y llevan «Estimado:»
 * delante; en uno transferido son los montos finales (P-29) y van tal cual.
 */
export function rotulosDeMontos(situacion: Situacion): [string, string, string] {
  if (grupoDe(situacion) !== "porTransferir") return [...ROTULOS_DE_MONTOS];
  const [total, comision, neto] = ROTULOS_DE_MONTOS.map((rotulo) => `Estimado: ${enMinuscula(rotulo)}`);
  return [total, comision, neto];
}

/**
 * Si hay una cifra que mostrar. Un anulado no trae ninguna. Un por transferir con bruto 0 (su único pago sigue en
 * revisión, por ejemplo) no pinta tres ceros rotulados «Estimado», que sonarían a que no va a cobrar nada: la
 * tarjeta dice `TEXTOS.sinMonto`. Uno ya transferido siempre pinta lo que se transfirió.
 */
export function hayMonto(d: Pick<DesembolsoDelMonitor, "situacion" | "montos">): boolean {
  if (d.montos === null) return false;
  return grupoDe(d.situacion) === "transferidos" || d.montos.bruto > 0;
}

export type AvisoDeLlave = {
  /** Que la llave cambió y a cuál va este desembolso. */
  cambio: string;
  /** El correo de Calibra, si está configurado: el aviso agrega «Si esa llave ya no sirve, escribe a {correo}». */
  escribirA: string | null;
};

/**
 * HU-013 y criterio 11: si la llave copiada a un desembolso por transferir no es la que el monitor tiene hoy, se le
 * dice a cuál se transferirá. Nulo si no es por transferir, si falta alguna de las dos llaves o si son iguales.
 */
export function avisoDeLlave(
  d: Pick<DesembolsoDelMonitor, "situacion" | "llaveDestino">,
  llaveActual: string | null,
  correo: string | null,
): AvisoDeLlave | null {
  if (grupoDe(d.situacion) !== "porTransferir") return null;
  const actual = llaveActual?.trim();
  const copiada = d.llaveDestino?.trim();
  if (!actual || !copiada || actual === copiada) return null;
  return {
    cambio: `Cambiaste tu llave después de esta monitoría. Los pagos que ya estaban en camino siguen yendo a la anterior: ${copiada}.`,
    escribirA: correo?.trim() || null,
  };
}
