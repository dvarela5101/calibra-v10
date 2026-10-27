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

/** D-75 c: dónde va cada correo de una solicitud. Una cuenta de monitor manda sobre una invitación que quede abierta. */
export type EstadoDeInvitacion = { tipo: "sin_invitar" } | { tipo: "invitado"; venceEn: string } | { tipo: "monitor" };

/**
 * El estado de varios correos de una vez (los de una página de solicitudes). Los correos llegan normalizados, como los guardan
 * las tres tablas. De varias invitaciones vigentes de un mismo correo cuenta la que vence más tarde.
 */
export async function estadosDeInvitacion(correos: readonly string[], ahora: Date = new Date()): Promise<Map<string, EstadoDeInvitacion>> {
  const estados = new Map<string, EstadoDeInvitacion>(correos.map((correo) => [correo, { tipo: "sin_invitar" }]));
  if (correos.length === 0) return estados;

  const admin = crearClienteAdmin();
  const [monitores, invitaciones] = await Promise.all([
    admin.from("monitor_privado").select("correo").in("correo", [...correos]),
    admin
      .from("invitacion_monitor")
      .select("correo, vence_en")
      .in("correo", [...correos])
      .is("usada_en", null)
      .gt("vence_en", ahora.toISOString())
      .order("vence_en", { ascending: true }),
  ]);
  if (monitores.error) throw monitores.error;
  if (invitaciones.error) throw invitaciones.error;

  // En orden de vencimiento: la última que se escribe es la que vence más tarde.
  for (const { correo, vence_en } of invitaciones.data ?? []) estados.set(correo, { tipo: "invitado", venceEn: vence_en });
  for (const { correo } of monitores.data ?? []) estados.set(correo, { tipo: "monitor" });
  return estados;
}

/** D-75 c: el correo de una solicitud, leído de la base: la invitación nunca usa uno que mande el navegador. */
export async function correoDeLaSolicitud(idSolicitud: string): Promise<{ correo: string; nombre: string } | null> {
  const { data, error } = await crearClienteAdmin()
    .from("solicitud_monitor")
    .select("correo, nombre")
    .eq("id", idSolicitud)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * D-75 c: el nombre y el teléfono que la persona dejó en su solicitud más reciente con ese correo, para que el registro ya los
 * traiga. Solo se llama con una invitación vigente, que llegó a esa misma bandeja.
 */
export async function datosDeLaSolicitud(correo: string): Promise<{ nombre: string; numeroTelefono: string } | null> {
  const { data, error } = await crearClienteAdmin()
    .from("solicitud_monitor")
    .select("nombre, numero_telefono")
    .eq("correo", correo)
    .order("creada_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { nombre: data.nombre, numeroTelefono: data.numero_telefono } : null;
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
  if (error) throw new Error(`No se pudo reconstruir la invitación: ${error.message}`);
  if (!data) return null;
  return { destinatario: data.correo, datos: { enlace: urlDelSitio(rutaDeRegistro(token)), venceEn: data.vence_en } };
}

