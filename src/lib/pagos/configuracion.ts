import "server-only";
import { correoConsultasDatos } from "@/lib/privacidad/consentimiento";

/**
 * Configuración del pago por Llave (HU-018, RN-40): la llave de la plataforma, su titular y el QR que da el
 * banco, y la identidad del proveedor que se muestra antes de pagar (Ley 1480 de 2011, art. 50). Todo son
 * variables solo de servidor (sin `NEXT_PUBLIC_`), así que cambiarlas en Vercel no exige otro build. Los
 * valores reales los pone dvarela5101 en el corte (docs/pendientes-dvarela.md §C, D-18); en local y en CI
 * los de prueba los escribe `scripts/env-local.mjs`.
 */

type Entorno = Record<string, string | undefined>;

export type ConfiguracionDeLlave = { llave: string; titular: string; qrUrl: string };

export type IdentidadDelProveedor = {
  nombre: string;
  documento: string | null;
  /** El correo de Calibra (`CORREO_DATOS_PERSONALES`, D-1). `null` si no está configurado. */
  correo: string | null;
};

const NOMBRE_POR_DEFECTO = "Calibra";

const texto = (valor: string | undefined) => valor?.trim() || null;

/**
 * La imagen del QR la da el banco y se sube a un lugar público (`https:`). En local va como `data:image/…`,
 * para no dejar en `public/` una imagen que se pudiera confundir con la real. Otra cosa (una ruta suelta, un
 * `http:`) sería un QR roto en la página: se trata como si faltara.
 */
function esUrlDeImagen(valor: string): boolean {
  if (/^data:image\//i.test(valor)) return true;
  try {
    return new URL(valor).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * La llave, su titular y la URL del QR, recortados. Si falta cualquiera de los tres, `null`: la página dice
 * que el pago por Llave no está disponible en vez de mostrar una llave incompleta o falsa.
 */
export function configuracionDeLlave(entorno: Entorno = process.env): ConfiguracionDeLlave | null {
  const llave = texto(entorno.LLAVE_PLATAFORMA);
  const titular = texto(entorno.LLAVE_PLATAFORMA_TITULAR);
  const qrUrl = texto(entorno.LLAVE_PLATAFORMA_QR_URL);
  if (!llave || !titular || !qrUrl || !esUrlDeImagen(qrUrl)) return null;
  return { llave, titular, qrUrl };
}

/**
 * A quién le paga la persona. Nombre y documento son opcionales mientras no estén los datos legales (a
 * validar con asesoría): sin nombre se muestra "Calibra" y sin documento, ninguno. El correo es el mismo de
 * consultas de datos, que es el buzón de Calibra (D-1); no se repite aquí.
 */
export function identidadDelProveedor(entorno: Entorno = process.env): IdentidadDelProveedor {
  return {
    nombre: texto(entorno.PROVEEDOR_NOMBRE) ?? NOMBRE_POR_DEFECTO,
    documento: texto(entorno.PROVEEDOR_DOCUMENTO),
    correo: correoConsultasDatos(entorno),
  };
}
