/**
 * Reglas de los comprobantes de pago (HU-007). El comprobante es la captura o el PDF de la
 * transferencia por Llave. Se guarda en un bucket privado y `pago.comprobante` guarda la ruta.
 *
 * El Storage de Supabase ya hace cumplir el tamaño y los tipos del bucket (respuestas 413 y 415).
 * Estas reglas las repiten para dar un mensaje claro ANTES de subir. La fuente es el bucket tal
 * como lo dejan las migraciones `*_comprobantes_privados.sql` y `*_ajustes_comprobantes.sql` (la
 * segunda manda: subió el límite de 5 a 10 MiB), e `integracion/comprobantes.test.ts` comprueba que
 * coincidan. Todo aquí es puro: no toca red ni base.
 */

export const BUCKET_COMPROBANTES = "comprobantes";

/**
 * 10 MiB por archivo (N-3, decidido el 29-sep-2026 al revisar HU-007; era 5 MiB). El bucket dice lo
 * mismo en la migración `*_ajustes_comprobantes.sql`.
 */
export const LIMITE_COMPROBANTE_BYTES = 10 * 1024 * 1024;

/** Vida del enlace firmado con el que un admin ve un comprobante. */
export const VIGENCIA_ENLACE_COMPROBANTE_SEG = 60;

/** Tipo MIME permitido y la extensión con la que se guarda. */
export const TIPOS_DE_COMPROBANTE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
} as const;

export type TipoDeComprobante = keyof typeof TIPOS_DE_COMPROBANTE;

/** Lo que ve la persona cuando el archivo no es JPG, PNG ni PDF. */
export const MENSAJE_TIPO = "El comprobante debe ser una imagen JPG o PNG, o un PDF.";

/** Primeros bytes de cada formato. El tipo que declara el navegador no basta: se contrasta con esto. */
const FIRMAS: readonly (readonly [TipoDeComprobante, readonly number[]])[] = [
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
];

/** Cuántos bytes del inicio hacen falta para reconocer cualquier formato permitido. */
export const BYTES_PARA_RECONOCER = Math.max(...FIRMAS.map(([, firma]) => firma.length));

function esTipoPermitido(tipo: string): tipo is TipoDeComprobante {
  return Object.hasOwn(TIPOS_DE_COMPROBANTE, tipo);
}

/** Formato real del archivo según sus primeros bytes, o null si no es JPG, PNG ni PDF. */
export function tipoPorContenido(inicio: Uint8Array): TipoDeComprobante | null {
  for (const [tipo, firma] of FIRMAS) {
    if (inicio.length >= firma.length && firma.every((byte, i) => inicio[i] === byte)) return tipo;
  }
  return null;
}

export type ArchivoDeComprobante = { name: string; type: string; size: number };

export type ResultadoValidacion =
  | { ok: true; tipo: TipoDeComprobante; extension: string }
  | { ok: false; mensaje: string };

const formatoMb = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });
/** MB con un decimal, redondeado hacia arriba: un archivo que pasa el límite nunca se ve igual a él. */
const enMb = (bytes: number) => formatoMb.format(Math.ceil((bytes / (1024 * 1024)) * 10) / 10);

/**
 * Valida un archivo antes de subirlo. Con `inicio` (sus primeros bytes) también comprueba que el
 * contenido sea del formato que declara. Devuelve un mensaje en español listo para mostrar.
 */
export function validarComprobante(archivo: ArchivoDeComprobante, inicio?: Uint8Array): ResultadoValidacion {
  if (!Number.isFinite(archivo.size) || archivo.size <= 0) {
    return { ok: false, mensaje: "El archivo está vacío. Elige la captura o el PDF del comprobante." };
  }
  if (!esTipoPermitido(archivo.type)) return { ok: false, mensaje: MENSAJE_TIPO };
  if (archivo.size > LIMITE_COMPROBANTE_BYTES) {
    return {
      ok: false,
      mensaje: `El comprobante pesa ${enMb(archivo.size)} MB y el máximo es ${enMb(LIMITE_COMPROBANTE_BYTES)} MB. Comprime la imagen o toma otra captura.`,
    };
  }
  if (inicio && tipoPorContenido(inicio) !== archivo.type) {
    return { ok: false, mensaje: "El contenido del archivo no coincide con su formato. Sube la captura o el PDF original." };
  }
  return { ok: true, tipo: archivo.type, extension: TIPOS_DE_COMPROBANTE[archivo.type] };
}

// ---------------------------------------------------------------------------
// Ruta en el bucket: <id del usuario>/<uuid>.<jpg|png|pdf>
// ---------------------------------------------------------------------------

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RUTA = new RegExp(`^(${UUID})/${UUID}\\.(?:jpg|png|pdf)$`);

/** Ruta de un comprobante nuevo en la carpeta del pagador. */
export function rutaDeComprobante(idUsuario: string, extension: string, idArchivo: string = crypto.randomUUID()): string {
  const ruta = `${idUsuario}/${idArchivo}.${extension}`;
  if (!esRutaDeComprobante(ruta)) throw new RangeError(`No es una ruta de comprobante válida: ${ruta}`);
  return ruta;
}

/** ¿Tiene la forma de una ruta de comprobante? Nada de carpetas anidadas, `..` ni otros nombres. */
export function esRutaDeComprobante(ruta: string): boolean {
  return RUTA.test(ruta);
}

/**
 * ¿Es esta ruta de una carpeta de `idUsuario`? Quien cree un pago desde el servidor con la
 * llave secreta (que se salta las políticas) debe comprobarlo antes de guardar la ruta en
 * `pago.comprobante`: si no, alguien podría apuntar su pago al comprobante de otra persona.
 */
export function rutaEsDelUsuario(idUsuario: string, ruta: string): boolean {
  return RUTA.exec(ruta)?.[1] === idUsuario;
}
