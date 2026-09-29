import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { configuracionSupabase } from "./config";
import type { Database } from "./tipos";

/**
 * Cliente para Server Components, Server Actions y Route Handlers, con la sesión
 * de las cookies. Uno nuevo por petición.
 */
export async function crearClienteServidor() {
  const config = configuracionSupabase();
  if (!config) return null;
  const almacen = await cookies();

  return createServerClient<Database>(config.url, config.llave, {
    cookies: {
      getAll() {
        return almacen.getAll();
      },
      setAll(cookiesPorPoner) {
        try {
          cookiesPorPoner.forEach(({ name, value, options }) => almacen.set(name, value, options));
        } catch {
          // Llamado desde un Server Component, que no puede escribir cookies.
          // No importa: src/proxy.ts refresca la sesión en cada petición.
        }
      },
    },
  });
}
