/**
 * URL y llave publishable de Supabase. Son públicas por diseño: llegan al navegador.
 * Sin ellas la app sigue funcionando sin sesión (por ejemplo, la página de inicio).
 */
export function configuracionSupabase(): { url: string; llave: string } | null {
  // Referencias literales: Next las reemplaza al compilar.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && llave ? { url, llave } : null;
}
