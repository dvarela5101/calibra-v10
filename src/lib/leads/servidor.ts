import "server-only";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { enviarCorreoDesdeServidor, urlDelSitio } from "@/lib/correo/servidor";
import type { Consentimiento } from "@/lib/privacidad/consentimiento";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { enmascararCorreo, type DatosDeContacto } from "./reglas";
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

/** Qué pasó con el enlace de verificación: salió, se frenó (ya van muchos en una hora) o no salió. */
export type EnvioDeVerificacion = "enviado" | "frenado" | "fallido";

export type ResultadoContacto =
  | { resultado: "lead" }
  | { resultado: "verificar"; envio: EnvioDeVerificacion }
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

/** Lo que ve una sesión que ya escribió el tope de correos distintos en la última hora (HU-075, D-36). */
export const TOPE_DE_CORREOS = "Probaste varios correos seguidos. Espera un rato y vuelve a intentarlo.";

/** ¿El 23505 fue por el correo (`lead_correo_key`) y no por la sesión? */
const esPorElCorreo = (error: { message?: string; details?: string }) =>
  `${error.message ?? ""} ${error.details ?? ""}`.includes("lead_correo_key");

/**
 * Deja a la sesión como Lead (HU-068):
 * - si ya escribió el tope de correos distintos en la última hora y este es otro, no guarda nada, no manda enlace
 *   y le pide esperar (HU-075, D-36; el tope y la ventana viven en la base, `parametros_contacto()`);
 * - si ya es Lead, actualiza sus datos y no crea otro (criterio 4);
 * - si no, crea el Lead con sus diagnósticos (`registrar_lead`);
 * - si el correo ya es de otro Lead, no liga nada: manda el enlace de verificación a ese correo (P-23).
 */
export async function registrarContacto(entrada: EntradaDeContacto): Promise<ResultadoContacto> {
  const { idSesion, contacto, consentimiento, origen, siguiente } = entrada;
  const admin = crearClienteAdmin();

  const actual = await leadDeLaSesion(idSesion);
  // El tope va antes de las dos ramas: las dos dicen si un correo ya es de otro Lead. Lo cuenta la base
  // (`anotar_correo_de_contacto`), por sesión y sin carreras, exista o no el correo. Volver a enviar el correo que
  // la sesión ya tiene guardado, para cambiar solo el nombre o el teléfono, no cuenta: no revela nada.
  if (contacto.correo !== actual?.correo) {
    const { data: puedeSeguir, error } = await admin.rpc("anotar_correo_de_contacto", { p_id_sesion: idSesion, p_correo: contacto.correo });
    if (error) throw error;
    if (!puedeSeguir) return { resultado: "error", error: TOPE_DE_CORREOS };
  }

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
  // La sesión ya tiene un Lead: otra pestaña lo creó o confirmó uno un instante antes.
  if (!esPorElCorreo(error) || (await leadDeLaSesion(idSesion))) return { resultado: "lead" };

  return { resultado: "verificar", envio: await mandarVerificacion(contacto.correo, siguiente) };
}

/**
 * Manda el enlace de verificación al dueño del correo. El freno (pocos enlaces por hora a un mismo Lead,
 * para que nadie llene su buzón escribiendo su correo) lo aplica la base, sin carreras.
 */
async function mandarVerificacion(correo: string, siguiente: string): Promise<EnvioDeVerificacion> {
  const { token, hash } = generarToken();
  const { data, error } = await crearClienteAdmin().rpc("crear_verificacion_lead", {
    p_correo: correo,
    p_token_hash: hash,
    p_siguiente: siguiente,
    p_maximo_por_hora: MAXIMO_DE_ENLACES_POR_HORA,
  });
  if (error) throw error;
  const verificacion = data?.[0];
  // Sin dueño: el Lead se borró entre el 23505 y ahora. Para quien escribe, es un envío que no salió.
  if (!verificacion?.correo_lead) return "fallido";
  if (!verificacion.id_verificacion || !verificacion.vence) {
    console.warn(`[leads] se frenó otro enlace de verificación para el Lead ${verificacion.id_del_lead}: ya van ${MAXIMO_DE_ENLACES_POR_HORA} en una hora.`);
    return "frenado";
  }

  const envio = await enviarCorreoDesdeServidor({
    plantilla: "verificacion_lead",
    datos: { nombre: verificacion.nombre_lead, enlace: urlDelSitio(rutaDeVerificacion(token)), venceEn: verificacion.vence },
    destinatario: verificacion.correo_lead,
    entidad: verificacion.id_verificacion,
  });
  if (!envio.ok) console.error(`[leads] el enlace de verificación ${verificacion.id_verificacion} no salió: ${envio.motivo}`);
  return envio.ok ? "enviado" : "fallido";
}

/**
 * Si el enlace todavía sirve (sin usar y sin vencer), el correo que confirma, enmascarado: quien lo abre
 * sabe qué correo confirma sin verlo entero. `null` si ya no sirve.
 */
export async function verificacionVigente(token: unknown, ahora: Date = new Date()): Promise<{ correo: string } | null> {
  if (!tieneFormaDeToken(token)) return null;
  const { data, error } = await crearClienteAdmin()
    .from("verificacion_lead")
    .select("vence_en, usada_en, lead(correo)")
    .eq("token_hash", hashDeToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!data || data.usada_en || new Date(data.vence_en) <= ahora || !data.lead?.correo) return null;
  return { correo: enmascararCorreo(data.lead.correo) };
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
