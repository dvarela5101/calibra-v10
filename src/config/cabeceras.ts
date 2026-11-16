/*
 * Cabeceras de seguridad que lleva toda respuesta (HU-132). Las usa `next.config.ts` y las comprueba
 * `cabeceras.test.ts`. Este módulo no importa nada: `next.config.ts` lo carga antes de arrancar la app.
 *
 * La CSP se limita a lo que no exige nonces: no lleva `script-src` ni `style-src` (queda para otra HU).
 * Cuando se agregue `script-src`, Turnstile necesita https://challenges.cloudflare.com en `script-src` y `frame-src`.
 *
 * `form-action 'self'`: ningún `<form>` de `src/` envía a otro origen (las acciones del servidor y el POST
 * del pago van al mismo sitio). La subida del comprobante a Supabase Storage y el token de Turnstile salen
 * por `fetch` o por el iframe de Cloudflare, que `form-action` no cubre. La redirección del comprobante del
 * admin (`/admin/pagos/[id]/comprobante`) es una navegación por enlace, no un envío de formulario.
 */

export interface CabeceraHttp {
  key: string;
  value: string;
}

export const DIRECTIVAS_CSP = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
] as const;

export const CABECERAS_DE_SEGURIDAD: readonly CabeceraHttp[] = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: DIRECTIVAS_CSP.join("; ") },
];

/** Entrada de `headers()` de Next que aplica las cabeceras a toda ruta. */
export const REGLA_DE_CABECERAS = {
  source: "/:path*",
  headers: [...CABECERAS_DE_SEGURIDAD],
};
