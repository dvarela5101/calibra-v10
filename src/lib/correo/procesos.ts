import "server-only";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { RECONSTRUCTORES } from "./reconstructores";
import { reintentarCorreosFallidos, type ResumenDeReintentos } from "./reintentos";
import { enviarCorreoDesdeServidor } from "./servidor";

/**
 * Procesos programados del correo (HU-065). Los dispara pg_cron con pg_net, con el secreto
 * `CRON_SECRETO` en el encabezado `Authorization: Bearer ...` (en la base vive en Vault como
 * `calibra_cron_secreto`). La comprobación del secreto vive en `@/lib/procesos/autorizacion`, que
 * comparten todos los procesos programados; se reexporta aquí para quien ya la importaba.
 */
export { autorizaProceso, LARGO_MINIMO_DEL_SECRETO } from "@/lib/procesos/autorizacion";

export function reintentarCorreosDesdeServidor(ahora: Date = new Date()): Promise<ResumenDeReintentos> {
  return reintentarCorreosFallidos({
    cliente: crearClienteAdmin(),
    reconstructores: RECONSTRUCTORES,
    enviar: enviarCorreoDesdeServidor,
    ahora,
  });
}
