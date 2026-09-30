import "server-only";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { enviarCorreoDesdeServidor, urlDelSitio } from "@/lib/correo/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { generarToken, hashDeToken, rutaDeRegistro, tieneFormaDeToken, type DatosDeRegistro } from "./invitacion";

/**
 * Invitaciones y alta de monitores (HU-013). Todo con la llave secreta: ninguna persona escribe estas
 * tablas con su sesión. Quien llama ya comprobó el rol (`exigirRol("admin")`) y pasa el id del admin
 * de la sesión, nunca uno que venga del navegador.
 */

export type ResultadoInvitacion =
  | { ok: true; correoEnviado: boolean }
  | { ok: false; error: string };

export async function invitarMonitor(idAdmin: string, correo: string): Promise<ResultadoInvitacion> {
  const admin = crearClienteAdmin();

  // Si ya es monitor, no tiene sentido otra cuenta con el mismo correo.
  const { data: yaMonitor, error: errorMonitor } = await admin
    .from("monitor_privado")
    .select("id_monitor")
    .eq("correo", correo)
    .maybeSingle();
  if (errorMonitor) throw errorMonitor;
  if (yaMonitor) return { ok: false, error: "Ese correo ya tiene una cuenta de monitor." };

  const { token, hash } = generarToken();
  const { data: invitacion, error } = await admin
    .from("invitacion_monitor")
    .insert({ correo, token_hash: hash, id_admin: idAdmin })
    .select("id, vence_en")
    .single();
  if (error) throw error;

  const envio = await enviarCorreoDesdeServidor({
    plantilla: "invitacion_monitor",
    datos: { enlace: urlDelSitio(rutaDeRegistro(token)), venceEn: invitacion.vence_en },
    destinatario: correo,
    entidad: invitacion.id,
  });
  if (!envio.ok) console.error(`[monitores] la invitación ${invitacion.id} no salió: ${envio.motivo}`);
  return { ok: true, correoEnviado: envio.ok };
}

export type Invitacion = { vigente: true; correo: string; venceEn: string } | { vigente: false };

/** La invitación de un token, si todavía sirve: sin usar y sin vencer. */
export async function buscarInvitacion(token: unknown, ahora: Date = new Date()): Promise<Invitacion> {
  if (!tieneFormaDeToken(token)) return { vigente: false };
  const { data, error } = await crearClienteAdmin()
    .from("invitacion_monitor")
    .select("correo, vence_en, usada_en")
    .eq("token_hash", hashDeToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!data || data.usada_en || new Date(data.vence_en) <= ahora) return { vigente: false };
  return { vigente: true, correo: data.correo, venceEn: data.vence_en };
}

export type ResultadoRegistro =
  | { ok: true; correo: string }
  | { ok: false; motivo: "invitacion_no_sirve" | "correo_con_cuenta" | "fallo"; error: string };

const INVITACION_NO_SIRVE = "Este enlace ya se usó o venció. Pide otra invitación al equipo de Calibra.";

/**
 * Crea la cuenta en Auth y, en una sola transacción de la base, gasta la invitación y crea Monitor,
 * su parte privada y su PerfilMonitor (`registrar_monitor`). Si la base dice que la invitación ya no
 * sirve (otra pestaña la gastó un instante antes), se borra la cuenta recién creada.
 */
export async function registrarMonitor(token: unknown, datos: DatosDeRegistro): Promise<ResultadoRegistro> {
  const invitacion = await buscarInvitacion(token);
  if (!invitacion.vigente) return { ok: false, motivo: "invitacion_no_sirve", error: INVITACION_NO_SIRVE };

  const admin = crearClienteAdmin();
  const { data: creado, error: errorCuenta } = await admin.auth.admin.createUser({
    email: invitacion.correo,
    password: datos.contrasena,
    // El correo ya se comprobó: la invitación llegó a esa bandeja.
    email_confirm: true,
  });
  if (errorCuenta || !creado.user) {
    if (errorCuenta?.code === "email_exists") {
      return {
        ok: false,
        motivo: "correo_con_cuenta",
        error: "Ya hay una cuenta de Calibra con este correo. Escribe al equipo para que te ayude.",
      };
    }
    console.error("[monitores] no se pudo crear la cuenta:", errorCuenta?.code ?? errorCuenta?.message);
    return { ok: false, motivo: "fallo", error: "No pudimos crear tu cuenta. Intenta de nuevo." };
  }

  const idUsuario = creado.user.id;
  const { data: registrado, error } = await admin.rpc("registrar_monitor", {
    p_token_hash: hashDeToken(token as string),
    p_id_usuario: idUsuario,
    p_correo: invitacion.correo,
    p_nombre: datos.nombre,
    p_numero_telefono: datos.numeroTelefono,
    p_llave: datos.llave,
  });
  if (error || !registrado) {
    const { error: errorBorrado } = await admin.auth.admin.deleteUser(idUsuario);
    // Una cuenta que quede sin monitor bloquea ese correo: el equipo tiene que borrarla a mano en Auth.
    if (errorBorrado) console.error(`[monitores] quedó una cuenta sin monitor en Auth (${idUsuario}); bórrala a mano.`);
    if (error) {
      console.error("[monitores] no se pudo registrar el monitor:", error.code ?? error.message);
      return { ok: false, motivo: "fallo", error: "No pudimos crear tu cuenta. Intenta de nuevo." };
    }
    return { ok: false, motivo: "invitacion_no_sirve", error: INVITACION_NO_SIRVE };
  }
  return { ok: true, correo: invitacion.correo };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reconstruye el correo de una invitación que no salió (HU-065). El token no se guarda, así que no se
 * puede volver a armar el mismo enlace: se genera uno nuevo y se reemplaza el hash. El enlace viejo
 * nunca llegó (el correo falló), así que nadie lo pierde. Si la invitación ya se usó o venció, `null`:
 * ese correo ya no tiene sentido.
 */
export async function reconstruirInvitacion(
  idInvitacion: string,
  ahora: Date = new Date(),
): Promise<Reconstruccion<"invitacion_monitor"> | null> {
  if (!UUID.test(idInvitacion)) return null;
  const { token, hash } = generarToken();
  const { data, error } = await crearClienteAdmin()
    .from("invitacion_monitor")
    .update({ token_hash: hash })
    .eq("id", idInvitacion)
    .is("usada_en", null)
    .gt("vence_en", ahora.toISOString())
    .select("correo, vence_en")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { destinatario: data.correo, datos: { enlace: urlDelSitio(rutaDeRegistro(token)), venceEn: data.vence_en } };
}

