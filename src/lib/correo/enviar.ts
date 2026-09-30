import { esCorreo } from "./contacto";
import { renderizar, type DatosPorPlantilla, type Plantilla } from "./plantillas";
import { limpiarError, type Proveedor, type EleccionDeProveedor } from "./proveedor";

/**
 * Envío de un correo transaccional (HU-006): arma la plantilla, reserva el correo en el registro,
 * lo manda con el proveedor, reintenta si el fallo es pasajero y deja el resultado anotado.
 *
 * Aquí no hay red ni base: el registro y el proveedor entran por parámetro (`Dependencias`), y
 * `servidor.ts` los conecta con los de verdad. Así el flujo se prueba con dobles, y las pruebas de
 * integración solo comprueban el cableado.
 *
 * Reintentar sin duplicar tiene dos partes:
 *  - Dentro de una llamada, los fallos pasajeros (red, 5xx, límite de ritmo) se reintentan con
 *    espera creciente. Los definitivos (llave inválida, remitente sin verificar) no.
 *  - Entre llamadas, la clave del correo (`plantilla:entidad`) es única en el registro: si ya está
 *    `enviado`, no se manda otra vez; si quedó `fallido`, la siguiente llamada lo reintenta sobre la
 *    misma fila. El registro no guarda el cuerpo, así que reintentar es volver a llamar con los
 *    mismos datos (quien dispara el evento, o un proceso programado que lo repita).
 */

export type Reserva =
  | { accion: "enviar"; intentosPrevios: number }
  | { accion: "ya_enviado" }
  | { accion: "en_curso" };

export type RegistroDeEnvios = {
  /** Reserva la clave. Solo quien recibe `enviar` manda el correo. */
  reservar(datos: { clave: string; plantilla: string; destinatario: string }): Promise<Reserva>;
  marcarEnviado(clave: string, datos: { idProveedor: string | null; intentos: number }): Promise<void>;
  /** `reintentable`: la falla fue temporal y el proceso programado la reintenta (HU-065). */
  marcarFallido(clave: string, datos: { error: string; intentos: number; reintentable: boolean }): Promise<void>;
};

export type Dependencias = {
  registro: RegistroDeEnvios;
  proveedor: EleccionDeProveedor;
  /** Intentos por llamada. Por defecto 3. */
  intentosMaximos?: number;
  /** Espera antes del reintento 2, 3... en milisegundos. Por defecto 500 y 1500. */
  esperas?: readonly number[];
  esperar?: (milisegundos: number) => Promise<void>;
};

export type EntradaDeEnvio<P extends Plantilla> = {
  plantilla: P;
  datos: DatosPorPlantilla[P];
  /** El correo del destinatario. Un teléfono no sirve: WhatsApp y SMS quedan fuera (P-22). */
  destinatario: string;
  /**
   * Lo que motiva el correo, distinto en cada correo que deba salir: el id del reembolso, del diagnóstico o de
   * la monitoría. Un mismo evento que se repite necesita una entidad distinta cada vez: el escalamiento de un
   * pago (RN-42) vuelve al primer admin al terminar la lista, así que `pago:admin` sola se repetiría en la
   * segunda vuelta y ese aviso se descartaría como ya enviado. Ahí conviene sumar la fecha de asignación o
   * el número de escalamiento (`pago:admin:n`). Solo ASCII imprimible: viaja como Idempotency-Key.
   */
  entidad: string;
};

export type MotivoDeFallo =
  | "contacto_no_es_correo"
  | "sin_proveedor"
  | "en_curso"
  | "fallo_del_proveedor"
  | "fallo_del_registro";

export type ResultadoEnvio =
  | { ok: true; yaEnviado: boolean; intentos: number; idProveedor: string | null }
  | { ok: false; motivo: MotivoDeFallo; error: string; intentos: number };

const LARGO_MAXIMO_DE_CLAVE = 256;

/** Clave del correo: `plantilla:entidad`. Mismo evento, misma clave. */
export function claveDeCorreo(plantilla: Plantilla, entidad: string): string {
  const id = entidad.trim();
  if (!id) throw new RangeError("La entidad que motiva el correo no puede estar vacía.");
  const clave = `${plantilla}:${id}`;
  // La clave va de encabezado HTTP: un carácter fuera de ASCII imprimible haría fallar el envío en silencio.
  if (!/^[\x20-\x7e]+$/.test(clave)) {
    throw new RangeError("La entidad del correo solo admite caracteres ASCII imprimibles (viaja como Idempotency-Key).");
  }
  if (clave.length > LARGO_MAXIMO_DE_CLAVE) {
    throw new RangeError(`La clave del correo mide ${clave.length} caracteres y el máximo es ${LARGO_MAXIMO_DE_CLAVE}.`);
  }
  return clave;
}

const esperarReal = (milisegundos: number) => new Promise<void>((resolver) => setTimeout(resolver, milisegundos));

/**
 * Manda un correo. Nunca lanza por un fallo del proveedor ni del registro: devuelve `ok: false` con
 * el motivo, porque un correo que no salió no debe tumbar el flujo que lo pidió. Sí lanza
 * `RangeError` si los datos de la plantilla son inválidos, que es un error de quien la llama.
 */
export async function enviarCorreo<P extends Plantilla>(
  dependencias: Dependencias,
  entrada: EntradaDeEnvio<P>,
): Promise<ResultadoEnvio> {
  const { registro, proveedor, intentosMaximos = 3, esperas = [500, 1_500], esperar = esperarReal } = dependencias;
  const destinatario = entrada.destinatario.trim();

  if (!esCorreo(destinatario)) {
    return {
      ok: false,
      motivo: "contacto_no_es_correo",
      error: "El contacto no es un correo. Los avisos por teléfono no existen todavía.",
      intentos: 0,
    };
  }

  // Antes de tocar el registro: si los datos son inválidos, no queda una fila a medias.
  const correo = renderizar(entrada.plantilla, entrada.datos);
  const clave = claveDeCorreo(entrada.plantilla, entrada.entidad);

  let reserva: Reserva;
  try {
    reserva = await registro.reservar({ clave, plantilla: entrada.plantilla, destinatario });
  } catch (error) {
    // Sin registro no hay forma de no duplicar: no se manda.
    return { ok: false, motivo: "fallo_del_registro", error: limpiarError(`No se pudo reservar el correo: ${mensajeDe(error)}`), intentos: 0 };
  }

  if (reserva.accion === "ya_enviado") return { ok: true, yaEnviado: true, intentos: 0, idProveedor: null };
  if (reserva.accion === "en_curso") {
    return { ok: false, motivo: "en_curso", error: "Otro proceso está enviando este correo.", intentos: 0 };
  }

  let intentos = reserva.intentosPrevios;

  if (!proveedor.ok) {
    // Falta configurar el proveedor: cuando se configure, el proceso programado lo reintenta.
    return await terminarConFallo(registro, clave, "sin_proveedor", proveedor.error, intentos, true);
  }

  let ultimoError = "";
  let ultimoReintentable = true;
  for (let intento = 1; intento <= intentosMaximos; intento++) {
    intentos += 1;
    const resultado = await enviarUnaVez(proveedor.proveedor, {
      para: destinatario,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      claveIdempotencia: clave,
    });
    if (resultado.ok) {
      try {
        await registro.marcarEnviado(clave, { idProveedor: resultado.idProveedor, intentos });
      } catch (error) {
        // El correo salió; lo que falló es anotarlo. Un reintento usa la misma Idempotency-Key.
        console.error("[correo] salió, pero no se pudo anotar en el registro:", limpiarError(mensajeDe(error)));
      }
      return { ok: true, yaEnviado: false, intentos, idProveedor: resultado.idProveedor };
    }
    ultimoError = resultado.error;
    ultimoReintentable = resultado.reintentable;
    if (!resultado.reintentable || intento === intentosMaximos) break;
    await esperar(esperas[Math.min(intento - 1, esperas.length - 1)] ?? 0);
  }
  return await terminarConFallo(registro, clave, "fallo_del_proveedor", ultimoError, intentos, ultimoReintentable);
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Un proveedor que lanza en vez de devolver un resultado se trata como un fallo pasajero. */
async function enviarUnaVez(proveedor: Proveedor, correo: Parameters<Proveedor["enviar"]>[0]) {
  try {
    return await proveedor.enviar(correo);
  } catch (error) {
    return { ok: false as const, reintentable: true, error: limpiarError(`El proveedor falló: ${mensajeDe(error)}`) };
  }
}

async function terminarConFallo(
  registro: RegistroDeEnvios,
  clave: string,
  motivo: "sin_proveedor" | "fallo_del_proveedor",
  error: string,
  intentos: number,
  reintentable: boolean,
): Promise<ResultadoEnvio> {
  try {
    await registro.marcarFallido(clave, { error, intentos, reintentable });
  } catch (falloDelRegistro) {
    console.error("[correo] no se pudo anotar el fallo:", limpiarError(mensajeDe(falloDelRegistro)));
  }
  return { ok: false, motivo, error, intentos };
}
