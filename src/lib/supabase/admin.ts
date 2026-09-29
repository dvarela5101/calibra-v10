import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./tipos";

/**
 * Cliente con la llave secreta: se salta RLS. Solo servidor, solo para tareas que
 * ninguna persona puede hacer con su propia sesión (desactivar cuentas, procesos).
 */
export function crearClienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llaveSecreta = process.env.SUPABASE_SECRET_KEY;
  if (!url || !llaveSecreta) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en el servidor.");
  }
  return createClient<Database>(url, llaveSecreta, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
