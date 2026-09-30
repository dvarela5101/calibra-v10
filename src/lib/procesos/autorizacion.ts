import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Autorización de los procesos programados (HU-065 y HU-059). Los dispara pg_cron con pg_net, con el
 * secreto `CRON_SECRETO` en el encabezado `Authorization: Bearer ...`; en la base vive en Vault como
 * `calibra_cron_secreto`. Todas las rutas de `/api/procesos/*` usan esta misma comprobación.
 */

/** Largo mínimo del secreto: 32 caracteres, por ejemplo `openssl rand -hex 32` (64). */
export const LARGO_MINIMO_DEL_SECRETO = 32;

/**
 * ¿La petición trae el secreto del proceso programado? Sin `CRON_SECRETO` (o con uno corto) nadie
 * pasa: mejor un proceso que no corre que una ruta abierta. Compara en tiempo constante.
 */
export function autorizaProceso(encabezado: string | null, entorno: Record<string, string | undefined> = process.env): boolean {
  const secreto = entorno.CRON_SECRETO?.trim();
  if (!secreto || secreto.length < LARGO_MINIMO_DEL_SECRETO || !encabezado) return false;
  const esperado = Buffer.from(`Bearer ${secreto}`);
  const recibido = Buffer.from(encabezado.trim());
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}
