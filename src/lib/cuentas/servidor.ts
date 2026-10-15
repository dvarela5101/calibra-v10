import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vincularCorreo } from "@/lib/auth/convertir";
import { mensajeDeError } from "@/lib/auth/mensajes";
import { resumenDeError } from "@/lib/leads/reglas";
import type { LeadDeSesion } from "@/lib/leads/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { configuracionSupabase } from "@/lib/supabase/config";
import { esResultadoDeCrearEstudiante, esResultadoDeTope, TEXTOS, type ResultadoDeTope } from "./reglas";

/**
 * Crear la cuenta de Estudiante (HU-032): lo que toca Auth y la base. Las funciones que necesitan la sesión del
 * navegador reciben su cliente por parámetro (la integración les pasa un cliente anónimo real); lo que solo hace el
 * servidor usa `crearClienteAdmin()`. Nunca se registra el correo ni el token: solo códigos y mensajes.
 */

/** ¿Este Lead ya tiene un Estudiante, de esta sesión o de otra? */
export async function leadTieneCuenta(idLead: string): Promise<boolean> {
  const { data, error } = await crearClienteAdmin().from("estudiante").select("id").eq("id_lead", idLead).maybeSingle();
  if (error) throw error;
  return data !== null;
}

// ---------------------------------------------------------------------------
// La guardia contra el panel olvidado
// ---------------------------------------------------------------------------

const PLAZO_DE_LA_GUARDIA_MS = 3_000;
const VIGENCIA_DE_LA_GUARDIA_MS = 5 * 60_000;

/** Hasta cuándo vale la última lectura que dijo «confirmaciones activas». Solo se recuerda el resultado seguro. */
let seguraHasta = 0;

/** Para las pruebas: olvida la última lectura. */
export function olvidarLaGuardia(): void {
  seguraHasta = 0;
}

/**
 * ¿Auth exige confirmar el correo? Con `mailer_autoconfirm` activo, `updateUser({ email })` convierte a un anónimo al
 * instante con un correo que nadie confirmó, y eso no se deshace (RN-12). La configuración de la nube es manual
 * (`docs/pendientes-dvarela.md` §C), así que no se confía en ella: se lee `GET /auth/v1/settings` con la llave pública,
 * con 3 s de plazo, y solo una lectura segura se recuerda 5 minutos. Si no se pudo leer o la respuesta es rara, es que no:
 * falla cerrado.
 */
export async function confirmacionDeCorreoActiva(opciones: { ahora?: number; leer?: typeof fetch } = {}): Promise<boolean> {
  const ahora = opciones.ahora ?? Date.now();
  if (seguraHasta > ahora) return true;

  const config = configuracionSupabase();
  if (!config) return false;
  try {
    const respuesta = await (opciones.leer ?? fetch)(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.llave },
      signal: AbortSignal.timeout(PLAZO_DE_LA_GUARDIA_MS),
      cache: "no-store",
    });
    if (!respuesta.ok) return false;
    const ajustes = (await respuesta.json()) as { mailer_autoconfirm?: unknown };
    if (typeof ajustes?.mailer_autoconfirm !== "boolean" || ajustes.mailer_autoconfirm) return false;
    seguraHasta = ahora + VIGENCIA_DE_LA_GUARDIA_MS;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pedir la cuenta
// ---------------------------------------------------------------------------

/**
 * Anota el pedido en la base y dice si la sesión puede seguir (`anotar_envio_de_cuenta`, criterio 13). Una respuesta que
 * no es una de las tres lanza: nunca se toma como un permiso.
 */
export async function anotarEnvio(idSesion: string): Promise<ResultadoDeTope> {
  const { data, error } = await crearClienteAdmin().rpc("anotar_envio_de_cuenta", { p_id_sesion: idSesion });
  if (error) throw error;
  if (!esResultadoDeTope(data)) throw new Error("anotar_envio_de_cuenta devolvió una respuesta desconocida.");
  return data;
}

export type ResultadoDelPedido =
  | { resultado: "enviado" }
  | { resultado: "tope"; cual: "sesion" | "total" }
  | { resultado: "error"; error: string };

/**
 * Pide a Auth el correo de confirmación para el correo del Lead, con la sesión anónima del navegador. En este orden:
 * 1. anota el pedido (el cupo se gasta aunque Auth falle después, criterio 2); con tope no llama a Auth;
 * 2. comprueba que Auth exija confirmar el correo;
 * 3. liga el correo (`updateUser({ email })`), que manda el correo y deja al usuario anónimo hasta que lo confirme.
 * Si Auth responde `email_exists` (el correo es de un monitor o un admin), la respuesta es la misma que en un envío normal:
 * nadie averigua qué correos tienen cuenta escribiéndolos (RN-12).
 */
export async function pedirCuentaDeEstudiante(
  supabase: SupabaseClient,
  entrada: { idSesion: string; lead: Pick<LeadDeSesion, "correo"> },
): Promise<ResultadoDelPedido> {
  const { idSesion, lead } = entrada;
  if (!lead.correo) return { resultado: "error", error: TEXTOS.sinCorreo };

  const tope = await anotarEnvio(idSesion);
  if (tope === "tope_de_sesion") return { resultado: "tope", cual: "sesion" };
  if (tope === "tope_global") return { resultado: "tope", cual: "total" };

  if (!(await confirmacionDeCorreoActiva())) {
    console.error("[cuentas] Auth no exige confirmar el correo (o no se pudo leer su configuración): no se pide la cuenta.");
    return { resultado: "error", error: TEXTOS.noSalioElCorreo };
  }

  const vinculo = await vincularCorreo(supabase, lead.correo);
  if (vinculo.ok || vinculo.codigo === "email_exists") return { resultado: "enviado" };
  console.error(`[cuentas] Auth no pudo mandar el correo de la cuenta: ${vinculo.codigo}`);
  return { resultado: "error", error: mensajeDeError(vinculo.codigo, TEXTOS.noSalioElCorreo) };
}

// ---------------------------------------------------------------------------
// Confirmar el correo y activar la cuenta
// ---------------------------------------------------------------------------

export type ResultadoDeConfirmar =
  | { ok: true; idUsuario: string; tokenDeAcceso: string }
  | { ok: false; motivo: "no_sirve" | "fallo" };

/**
 * Gasta el enlace del correo: `verifyOtp` con el tipo `email_change` fijo en el servidor (el formulario solo trae el
 * `token_hash`). Deja al usuario sin ser anónimo, con el mismo id, y crea la sesión nueva en las cookies. Un enlace usado,
 * vencido o inventado es un 4xx de Auth («ya no sirve»); lo demás (Auth caído, un límite de frecuencia) se puede reintentar.
 */
export async function confirmarCorreoDeCuenta(supabase: SupabaseClient, tokenHash: string): Promise<ResultadoDeConfirmar> {
  const { data, error } = await supabase.auth.verifyOtp({ type: "email_change", token_hash: tokenHash });
  if (error) {
    const estado = error.status ?? 0;
    console.error(`[cuentas] no se pudo confirmar el correo: ${error.code ?? "sin_codigo"} (${estado})`);
    // 429 es el límite de verificaciones por IP: no dice nada del enlace.
    return { ok: false, motivo: estado >= 400 && estado < 500 && estado !== 429 ? "no_sirve" : "fallo" };
  }
  if (!data.session || !data.user || data.user.is_anonymous !== false) {
    // Sin sesión, o el usuario sigue anónimo: Auth gastó el enlace sin convertirlo (¿pidió una segunda confirmación?).
    console.error("[cuentas] la confirmación no dejó una cuenta: sin sesión o el usuario sigue anónimo.");
    return { ok: false, motivo: "fallo" };
  }
  return { ok: true, idUsuario: data.user.id, tokenDeAcceso: data.session.access_token };
}

export type ResultadoDeActivar = { ok: true } | { ok: false; motivo: "sesiones" | "soporte" | "no_confirmada" | "fallo" };

/**
 * Lo que sigue a confirmar el correo, y también lo que hace «Terminar de crear mi cuenta»: cierra las demás sesiones del
 * usuario y crea el Estudiante.
 * - El cierre va antes: si falla no se crea, y la persona repite el paso. Quien escribió el correo de otra persona (P-23)
 *   y consigue que su dueña confirme no puede renovar su sesión en la cuenta (criterio 5). Con llaves de firma
 *   asimétricas el token de acceso viejo sigue leyendo hasta que vence (`jwt_expiry`); lo que se cierra es su renovación.
 * - `soporte` agrupa lo que repetir el paso no arregla: `sin_lead`, `ya_tiene_cuenta` y `correo_distinto`.
 */
export async function activarCuenta(idUsuario: string, tokenDeAcceso: string): Promise<ResultadoDeActivar> {
  const admin = crearClienteAdmin();

  const { error: errorDeSesiones } = await admin.auth.admin.signOut(tokenDeAcceso, "others");
  if (errorDeSesiones) {
    console.error(`[cuentas] no se pudieron cerrar las demás sesiones: ${errorDeSesiones.code ?? "sin_codigo"}`);
    return { ok: false, motivo: "sesiones" };
  }

  try {
    const { data, error } = await admin.rpc("crear_estudiante", { p_id_usuario: idUsuario });
    if (error) throw error;
    if (!esResultadoDeCrearEstudiante(data)) throw new Error("crear_estudiante devolvió una respuesta desconocida.");
    if (data === "creada") return { ok: true };
    if (data === "no_confirmada") return { ok: false, motivo: "no_confirmada" };
    return { ok: false, motivo: "soporte" };
  } catch (error) {
    console.error("[cuentas] no se pudo crear el Estudiante:", resumenDeError(error));
    return { ok: false, motivo: "fallo" };
  }
}

/**
 * La cadena del token de acceso de la sesión del navegador, para pasársela a Auth en `activarCuenta` (que la valida y
 * cierra las demás sesiones). Solo se lee la cadena: quién es y qué rol tiene sale de `obtenerSesion()`, que verifica
 * la firma con `getClaims()`.
 */
export async function tokenDeAccesoDeLaSesion(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
