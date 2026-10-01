import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import type { DatosDeSolicitud } from "./reglas";

export type ResultadoSolicitud = { ok: true; id: string } | { ok: false; error: string };

/**
 * Guarda la solicitud del aspirante a monitor (HU-062). La crea el servidor con la llave secreta: ninguna
 * sesión inserta directo, y `crear_solicitud_monitor()` guarda la solicitud y sus materias en una sola
 * transacción. `fechaConsentimiento` la pone el servidor al recibir el formulario (`leerConsentimiento`).
 * Si la persona ya tiene una solicitud abierta con ese correo o teléfono, la base devuelve esa y no crea otra.
 */
export async function crearSolicitudMonitor(
  datos: DatosDeSolicitud,
  fechaConsentimiento: string,
  cliente: SupabaseClient<Database> = crearClienteAdmin(),
): Promise<ResultadoSolicitud> {
  const { data, error } = await cliente.rpc("crear_solicitud_monitor", {
    p_nombre: datos.nombre,
    p_correo: datos.correo,
    p_numero_telefono: datos.numeroTelefono,
    p_materias: datos.materias,
    p_fecha_consentimiento: fechaConsentimiento,
  });
  if (!error && data) return { ok: true, id: data };
  // 23503: una materia que ya no existe (la borraron mientras la persona llenaba el formulario).
  if (error?.code === "23503") return { ok: false, error: "Alguna materia ya no está disponible. Recarga la página y elige de nuevo." };
  // 54000: el tope de solicitudes por hora, que frena los envíos masivos.
  if (error?.code === "54000") return { ok: false, error: "Recibimos muchas solicitudes en este momento. Intenta de nuevo en una hora." };
  if (error) console.error("[solicitudes] no se pudo guardar la solicitud:", error.code ?? error.message);
  return { ok: false, error: "No pudimos guardar tu solicitud. Intenta de nuevo." };
}
