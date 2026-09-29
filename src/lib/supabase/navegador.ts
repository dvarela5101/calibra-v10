import { createBrowserClient } from "@supabase/ssr";
import { configuracionSupabase } from "./config";
import type { Database } from "./tipos";

/** Cliente para Client Components. createBrowserClient ya es un singleton. */
export function crearClienteNavegador() {
  const config = configuracionSupabase();
  if (!config) return null;
  return createBrowserClient<Database>(config.url, config.llave);
}
