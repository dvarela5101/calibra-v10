import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatearDia } from "@/lib/fechas";
import { horaCorta, minutosDe } from "@/lib/franjas/reglas";
import type { Database } from "@/lib/supabase/tipos";
import { esSituacion, grupoDe, type DesembolsoDelMonitor, type MontosDeDesembolso } from "./reglas";

type FilaTipada = Database["public"]["Functions"]["mis_desembolsos"]["Returns"][number];

/**
 * Lo que llega de verdad. El tipo que genera la base dice que ninguna columna es nula, y varias lo son (un anulado
 * no trae montos ni llave, solo un transferido trae referencia y día): no se fía del tipo, se revisa.
 */
type FilaDeLaBase = { [K in keyof FilaTipada]: FilaTipada[K] | null };

export type MisDesembolsos = {
  desembolsos: DesembolsoDelMonitor[];
  /** La llave que el monitor tiene hoy (`monitor_privado`), para avisar si la de un desembolso por transferir es otra. */
  llaveActual: string | null;
};

/**
 * Los desembolsos del monitor de la sesión (HU-050) y su llave de hoy. Con su propia sesión: `public.mis_desembolsos()`
 * solo devuelve los de sus monitorías, y a otro monitor, a un admin o a un Lead les devuelve una lista vacía. La
 * situación y las tres cifras vienen resueltas de la base (D-59): aquí no se calcula nada, ni la comisión (N-2).
 *
 * Lanza si la lectura falla o si una fila no tiene sentido (una situación desconocida, cifras que no cuadran, un
 * anulado con montos): es mejor mostrar el error que pintar una cifra incoherente. Los mensajes llevan el código y
 * el mensaje de la base o el id del desembolso, nunca montos, llaves ni referencias.
 */
export async function cargarMisDesembolsos(cliente: SupabaseClient<Database>, idUsuario: string): Promise<MisDesembolsos> {
  const [desembolsos, llave] = await Promise.all([
    cliente.rpc("mis_desembolsos"),
    cliente.from("monitor_privado").select("llave").eq("id_monitor", idUsuario).maybeSingle(),
  ]);
  if (desembolsos.error) throw new Error(`No se pudo leer los desembolsos: ${detalleDe(desembolsos.error)}`);
  // Sin poder decir si la llave cambió, la lista escondería en silencio el aviso del criterio 11: también tumba la carga.
  if (llave.error) throw new Error(`No se pudo leer la llave del monitor: ${detalleDe(llave.error)}`);
  return {
    desembolsos: ((desembolsos.data ?? []) as FilaDeLaBase[]).map(convertirFila),
    llaveActual: typeof llave.data?.llave === "string" ? llave.data.llave : null,
  };
}

/** Solo el código y el mensaje de la base: nunca filas. */
const detalleDe = (error: { code?: string; message: string }) => [error.code, error.message].filter(Boolean).join(" ");

const esTextoConDatos = (valor: unknown): valor is string => typeof valor === "string" && valor.trim() !== "";
const esEntero = (valor: unknown): valor is number => typeof valor === "number" && Number.isInteger(valor);
const esMonto = (valor: unknown): valor is number => esEntero(valor) && valor >= 0;

/** Un día `AAAA-MM-DD` que existe. La misma comprobación que `formatearDia`, que lanza con cualquier otra cosa. */
function esDia(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  try {
    formatearDia(valor);
    return true;
  } catch {
    return false;
  }
}

/** Una hora `HH:MM` o `HH:MM:SS` de la zona del negocio: la que la tarjeta muestra con `horaCorta` y `horaDeFin`. */
const esHora = (valor: unknown): valor is string => typeof valor === "string" && minutosDe(horaCorta(valor)) !== null;

/** La fila de la base como la usa la app, con el guardia de 4.2: lanza si algo no cuadra. */
function convertirFila(fila: FilaDeLaBase): DesembolsoDelMonitor {
  const id = fila.id_desembolso;
  const falla = (motivo: string): never => {
    throw new Error(`Desembolso ${esTextoConDatos(id) ? id : "sin id"} incoherente: ${motivo}`);
  };

  if (!esTextoConDatos(id)) return falla("falta el id");
  const situacion = fila.situacion;
  if (!esSituacion(situacion)) throw new Error(`Situación de desembolso inesperada: ${JSON.stringify(situacion)}`);
  if (!esDia(fila.fecha)) return falla("el día de la sesión no es AAAA-MM-DD");
  if (!esHora(fila.hora)) return falla("la hora de la sesión no es válida");
  if (!esEntero(fila.duracion_min) || fila.duracion_min <= 0) return falla("la duración de la sesión no es válida");
  if (!esTextoConDatos(fila.nombre_materia)) return falla("falta la materia");
  if (fila.fecha_desembolso !== null && !esDia(fila.fecha_desembolso)) return falla("el día de la transferencia no es AAAA-MM-DD");

  let desembolsableDesde: Date | null = null;
  if (fila.desembolsable_desde !== null) {
    desembolsableDesde = new Date(fila.desembolsable_desde);
    if (Number.isNaN(desembolsableDesde.getTime())) return falla("desembolsable_desde no es una fecha");
  }
  if (situacion === "en_plazo" && desembolsableDesde === null) return falla("en plazo sin la fecha desde la que se puede transferir");

  let montos: MontosDeDesembolso | null = null;
  if (grupoDe(situacion) === "anulados") {
    const traeAlgo = [fila.monto_bruto, fila.comision, fila.monto_neto, fila.llave_destino, fila.referencia_transferencia, fila.fecha_desembolso].some(
      (valor) => valor !== null,
    );
    if (traeAlgo) return falla("un anulado trae montos, llave, referencia o día");
  } else {
    const { monto_bruto: bruto, comision, monto_neto: neto } = fila;
    if (!esMonto(bruto) || !esMonto(comision) || !esMonto(neto)) return falla("faltan las tres cifras o no son pesos enteros");
    if (neto !== bruto - comision) return falla("el neto no es el total menos la comisión");
    montos = { bruto, comision, neto };
  }

  if (situacion === "transferido") {
    if (!esTextoConDatos(fila.llave_destino)) return falla("un transferido sin llave");
    if (!esTextoConDatos(fila.referencia_transferencia)) return falla("un transferido sin referencia");
    if (fila.fecha_desembolso === null) return falla("un transferido sin día de transferencia");
  }

  return {
    idDesembolso: id,
    fecha: fila.fecha,
    hora: fila.hora,
    duracionMin: fila.duracion_min,
    nombreMateria: fila.nombre_materia,
    situacion,
    desembolsableDesde,
    montos,
    llaveDestino: fila.llave_destino,
    referencia: fila.referencia_transferencia,
    diaDeTransferencia: fila.fecha_desembolso,
  };
}
