import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { configuracionSupabase } from "./config";

/**
 * Refresca la sesión de Supabase en cada petición y devuelve la respuesta con las
 * cookies al día. No autoriza: eso lo hace src/lib/auth/sesion.ts cerca de los datos.
 * Patrón del ejemplo oficial de Supabase para Next.js (examples/auth/nextjs).
 */
export async function actualizarSesion(request: NextRequest) {
  let respuesta = NextResponse.next({ request });
  const config = configuracionSupabase();
  if (!config) return respuesta;

  const supabase = createServerClient(config.url, config.llave, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesPorPoner, cabeceras) {
        cookiesPorPoner.forEach(({ name, value }) => request.cookies.set(name, value));
        respuesta = NextResponse.next({ request });
        cookiesPorPoner.forEach(({ name, value, options }) => respuesta.cookies.set(name, value, options));
        // Cache-Control, Expires y Pragma: que ningún CDN guarde la sesión de alguien.
        Object.entries(cabeceras).forEach(([clave, valor]) => respuesta.headers.set(clave, valor));
      },
    },
  });

  // Nada de código entre crear el cliente y getClaims(): si no, la sesión puede
  // cerrarse sola. getClaims() también refresca el token si está por vencer.
  await supabase.auth.getClaims();

  return respuesta;
}
