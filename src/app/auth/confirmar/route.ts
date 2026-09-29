import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { rutaInternaSegura } from "@/lib/auth/roles";
import { crearClienteServidor } from "@/lib/supabase/servidor";

const TIPOS: readonly EmailOtpType[] = ["recovery", "email", "email_change", "signup", "invite", "magiclink"];

/**
 * Destino de los enlaces de los correos de Auth (plantillas con token_hash). Verifica el
 * token en el servidor, deja la sesión en cookies y redirige a `siguiente`.
 */
export async function GET(request: NextRequest) {
  const parametros = request.nextUrl.searchParams;
  const tokenHash = parametros.get("token_hash");
  const tipo = parametros.get("type") as EmailOtpType | null;
  const siguiente = rutaInternaSegura(parametros.get("siguiente"), "/");

  const destino = request.nextUrl.clone();
  destino.search = "";

  if (tokenHash && tipo && TIPOS.includes(tipo)) {
    const supabase = await crearClienteServidor();
    const resultado = await supabase?.auth.verifyOtp({ type: tipo, token_hash: tokenHash });
    if (resultado && !resultado.error) {
      destino.pathname = siguiente;
      return NextResponse.redirect(destino);
    }
  }

  destino.pathname = "/restablecer";
  destino.searchParams.set("error", "enlace");
  return NextResponse.redirect(destino);
}
