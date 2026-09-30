import "server-only";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { enviarCorreoDesdeServidor, urlDelSitio } from "@/lib/correo/servidor";
import type { Consentimiento } from "@/lib/privacidad/consentimiento";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { DatosDeContacto } from "./reglas";
import { MAXIMO_DE_ENLACES_POR_HORA, generarToken, hashDeToken, rutaDeVerificacion, tieneFormaDeToken } from "./verificacion";

/**
 * El visitante que va a agendar queda como Lead (HU-068, D-3, P-23). Todo con la llave secreta: ninguna
 * sesión escribe `lead`, `lead_sesion` ni `verificacion_lead`. Quien llama ya comprobó la sesión
 * (`obtenerSesion()`) y pasa su id, nunca uno que venga del navegador.
 */

export type LeadDeSesion = { id: string; nombre: string; correo: string | null; numeroTelefono: string | null };

type FilaDeLead = { id: string; nombre: string; correo: string | null; numero_telefono: string | null };

const COLUMNAS = "id, nombre, correo, numero_telefono";

const deFila = (fila: FilaDeLead): LeadDeSesion => ({
  id: fila.id,
  nombre: fila.nombre,
  correo: fila.correo,
  numeroTelefono: fila.numero_telefono,
});

/**
 * El Lead de una sesión, como lo entiende `privado.es_mi_lead`: el que creó desde esa sesión, el de su
 * cuenta de Estudiante o uno cuyo correo confirmó con el enlace de verificación (P-23).
 */
export async function leadDeLaSesion(idSesion: string): Promise<LeadDeSesion | null> {
  const admin = crearClienteAdmin();
  const [propio, confirmado, estudiante] = await Promise.all([
    admin.from("lead").select(COLUMNAS).eq("id_sesion_anonima", idSesion).maybeSingle(),
    admin.from("lead_sesion").select(`lead(${COLUMNAS})`).eq("id_sesion", idSesion).maybeSingle(),
    admin.from("estudiante").select(`lead(${COLUMNAS})`).eq("id", idSesion).maybeSingle(),
  ]);
  const fallo = propio.error ?? confirmado.error ?? estudiante.error;
  if (fallo) throw fallo;
  const fila = propio.data ?? confirmado.data?.lead ?? estudiante.data?.lead ?? null;
  return fila ? deFila(fila) : null;
}

export type ResultadoContacto =
  | { resultado: "lead" }
  | { resultado: "verificar"; correoEnviado: boolean }
  | { resultado: "error"; error: string };

export type EntradaDeContacto = {
  idSesion: string;
  contacto: DatosDeContacto;
  consentimiento: Consentimiento;
  origen: string | null;
  /** Ruta interna a la que vuelve quien confirme el correo, si hace falta confirmarlo. */
  siguiente: string;
};

const CORREO_DE_OTRO = "Ese correo ya es de otro contacto de Calibra. Escribe el tuyo.";

/** ¿El 23505 fue por el correo (`lead_correo_key`) y no por la sesión? */
const esPorElCorreo = (error: { message?: string; details?: string }) =>
  `${error.message ?? ""} ${error.details ?? ""}`.includes("lead_correo_key");

/**
 * Deja a la sesión como Lead (HU-068):
 * - si ya es Lead, actualiza sus datos y no crea otro (criterio 4);
 * - si no, crea el Lead con sus diagnósticos (`registrar_lead`);
 * - si el correo ya es de otro Lead, no liga nada: manda el enlace de verificación a ese correo (P-23).
 */
export async function registrarContacto(entrada: EntradaDeContacto): Promise<ResultadoContacto> {
  const { idSesion, contacto, consentimiento, origen, siguiente } = entrada;
  const admin = crearClienteAdmin();

  const actual = await leadDeLaSesion(idSesion);
  if (actual) {
    const { error } = await admin
      .from("lead")
      .update({
        nombre: contacto.nombre,
        correo: contacto.correo,
        numero_telefono: contacto.numeroTelefono,
        fecha_consentimiento: consentimiento.fecha_consentimiento,
        acepta_contacto: consentimiento.acepta_contacto,
      })
      .eq("id", actual.id);
    if (error?.code === "23505") return { resultado: "error", error: CORREO_DE_OTRO };
    if (error) throw error;
    return { resultado: "lead" };
  }

  const { error } = await admin.rpc("registrar_lead", {
    p_id_sesion: idSesion,
    p_nombre: contacto.nombre,
    p_correo: contacto.correo,
    p_numero_telefono: contacto.numeroTelefono ?? "",
    p_acepta_contacto: consentimiento.acepta_contacto,
    p_fecha_consentimiento: consentimiento.fecha_consentimiento,
    p_origen: origen ?? "",
  });
  if (!error) return { resultado: "lead" };
  if (error.code !== "23505") throw error;
  // Otra pestaña de la misma sesión lo creó un instante antes: ya es Lead.
  if (!esPorElCorreo(error)) return { resultado: "lead" };

  return { resultado: "verificar", correoEnviado: await mandarVerificacion(contacto.correo, siguiente) };
}

/** Manda el enlace de verificación al dueño del correo. `false` si no salió (o si se frenó por abuso). */
async function mandarVerificacion(correo: string, siguiente: string, ahora: Date = new Date()): Promise<boolean> {
  const admin = crearClienteAdmin();
  const { data: dueno, error } = await admin.from("lead").select("id, nombre, correo").eq("correo", correo).maybeSingle();
  if (error) throw error;
  if (!dueno?.correo) return false;

  // Freno: pocos enlaces por hora a un mismo Lead, para que nadie llene su buzón escribiendo su correo.
  const haceUnaHora = new Date(ahora.getTime() - 60 * 60_000).toISOString();
  const { count, error: errorConteo } = await admin
    .from("verificacion_lead")
    .select("id", { count: "exact", head: true })
    .eq("id_lead", dueno.id)
    .gt("creada_en", haceUnaHora);
  if (errorConteo) throw errorConteo;
  if ((count ?? 0) >= MAXIMO_DE_ENLACES_POR_HORA) {
    console.warn(`[leads] se frenó otro enlace de verificación para el Lead ${dueno.id}: ya van ${count} en una hora.`);
    return false;
  }

  const { token, hash } = generarToken();
  const { data: verificacion, error: errorVerificacion } = await admin
    .from("verificacion_lead")
    .insert({ id_lead: dueno.id, token_hash: hash, siguiente })
    .select("id, vence_en")
    .single();
  if (errorVerificacion) throw errorVerificacion;

  const envio = await enviarCorreoDesdeServidor({
    plantilla: "verificacion_lead",
    datos: { nombre: dueno.nombre, enlace: urlDelSitio(rutaDeVerificacion(token)), venceEn: verificacion.vence_en },
    destinatario: dueno.correo,
    entidad: verificacion.id,
  });
  if (!envio.ok) console.error(`[leads] el enlace de verificación ${verificacion.id} no salió: ${envio.motivo}`);
  return envio.ok;
}

/** ¿El enlace todavía sirve (sin usar y sin vencer)? Para mostrar el botón de confirmar o avisar que no. */
export async function verificacionVigente(token: unknown, ahora: Date = new Date()): Promise<boolean> {
  if (!tieneFormaDeToken(token)) return false;
  const { data, error } = await crearClienteAdmin()
    .from("verificacion_lead")
    .select("vence_en, usada_en")
    .eq("token_hash", hashDeToken(token))
    .maybeSingle();
  if (error) throw error;
  return Boolean(data && !data.usada_en && new Date(data.vence_en) > ahora);
}

export type ResultadoConfirmacion = { ok: true; siguiente: string } | { ok: false };

/**
 * Confirma el correo: la sesión que abrió el enlace queda ligada al Lead, con sus diagnósticos
 * (`confirmar_correo_de_lead`). No sirve si el enlace ya se usó o venció, o si esa sesión ya es de otro Lead.
 */
export async function confirmarCorreo(token: unknown, idSesion: string): Promise<ResultadoConfirmacion> {
  if (!tieneFormaDeToken(token)) return { ok: false };
  const { data, error } = await crearClienteAdmin().rpc("confirmar_correo_de_lead", {
    p_token_hash: hashDeToken(token),
    p_id_sesion: idSesion,
  });
  if (error) throw error;
  const fila = data?.[0];
  return fila?.id_lead ? { ok: true, siguiente: fila.siguiente } : { ok: false };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reconstruye el correo de verificación que no salió (HU-065). Como la invitación de monitor: el token no
 * se guarda, así que se genera uno nuevo y se reemplaza el hash (el enlace viejo nunca llegó). Si el
 * enlace ya se usó o venció, `null`.
 */
export async function reconstruirVerificacion(
  idVerificacion: string,
  ahora: Date = new Date(),
): Promise<Reconstruccion<"verificacion_lead"> | null> {
  if (!UUID.test(idVerificacion)) return null;
  const { token, hash } = generarToken();
  const { data, error } = await crearClienteAdmin()
    .from("verificacion_lead")
    .update({ token_hash: hash })
    .eq("id", idVerificacion)
    .is("usada_en", null)
    .gt("vence_en", ahora.toISOString())
    .select("vence_en, lead(nombre, correo)")
    .maybeSingle();
  if (error) throw new Error(`No se pudo reconstruir el enlace de verificación: ${error.message}`);
  if (!data?.lead?.correo) return null;
  return {
    destinatario: data.lead.correo,
    datos: { nombre: data.lead.nombre, enlace: urlDelSitio(rutaDeVerificacion(token)), venceEn: data.vence_en },
  };
}
