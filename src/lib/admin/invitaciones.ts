import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { esUuid } from "@/lib/agendar/reglas";
import type { Reconstruccion } from "@/lib/correo/plantillas";
import { enviarCorreoDesdeServidor, urlDelSitio } from "@/lib/correo/servidor";
import { generarToken, hashDeToken, tieneFormaDeToken } from "@/lib/monitores/invitacion";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import {
  esResultadoDeCancelar,
  rutaDeRegistroDeAdmin,
  type DatosDeRegistroDeAdmin,
  type InvitacionAbierta,
  type MotivoDeRechazoAlInvitar,
  type ResultadoDeCancelar,
} from "./invitaciones-reglas";

/**
 * Invitaciones y alta de admins (HU-072). Crear la invitación, registrar al admin y reconstruir el correo se hacen con
 * la llave secreta: ninguna persona escribe estas tablas con su sesión (`invitacion_admin` ni siquiera se puede leer).
 * Quien llama ya comprobó el rol (`exigirRol("admin")`) y pasa el id del admin de la sesión, nunca uno del navegador;
 * la base lo vuelve a comprobar (`crear_invitacion_admin` responde `sin_permiso` si no es un admin activo). La lista y
 * la cancelación van con la sesión del admin: la base exige un admin activo y no devuelve el hash.
 */

type Cliente = SupabaseClient<Database>;

/** Cómo se le llama a quien invita si su nombre viniera vacío (un admin creado a mano): la plantilla lanza con un nombre vacío. */
const NOMBRE_SI_FALTA = "Un admin de Calibra";

const unaLinea = (valor: string | null | undefined) => (valor ?? "").replace(/\s+/g, " ").trim();

export type ResultadoDeInvitarAdmin = { ok: true; correoEnviado: boolean } | { ok: false; motivo: MotivoDeRechazoAlInvitar };

const RESULTADOS_DE_CREAR = ["creada", "es_admin", "es_admin_desactivado", "es_monitor", "sin_permiso"] as const;

/**
 * Invita a un correo. El enlace y el nombre de quien invita se arman ANTES de crear la invitación: si `SITIO_URL`
 * falta en producción, o el nombre no se puede leer, falla sin dejar una invitación sin correo y sin fila en
 * `correo_envio`, que HU-065 no podría reintentar (S5; `invitarMonitor` lo hace al revés). Queda un hueco que HU-013
 * también tiene: si el registro de correos no responde justo después de crear, no hay fila que reintentar; la
 * invitación se ve en la lista y se puede cancelar o repetir.
 */
export async function invitarAdmin(idAdmin: string, correo: string): Promise<ResultadoDeInvitarAdmin> {
  const admin = crearClienteAdmin();
  const { token, hash } = generarToken();

  const { data: quien, error: errorDelNombre } = await admin.from("admin").select("nombre").eq("id", idAdmin).maybeSingle();
  if (errorDelNombre) throw new Error(`No se pudo leer el nombre de quien invita: ${errorDelNombre.code} ${errorDelNombre.message}`);
  // Quien llama no es un admin: ni se crea la invitación.
  if (!quien) return { ok: false, motivo: "sin_permiso" };
  const invitadoPor = unaLinea(quien.nombre) || NOMBRE_SI_FALTA;
  const enlace = urlDelSitio(rutaDeRegistroDeAdmin(token));

  const { data, error } = await admin.rpc("crear_invitacion_admin", { p_token_hash: hash, p_correo: correo, p_id_admin: idAdmin });
  // Solo el código y el mensaje: PostgREST pone en `details` el valor repetido, es decir, el correo de un tercero.
  if (error) throw new Error(`No se pudo crear la invitación: ${error.code} ${error.message}`);
  const fila = data?.[0];
  if (!fila || !(RESULTADOS_DE_CREAR as readonly string[]).includes(fila.resultado)) {
    throw new Error(`Respuesta inesperada al crear la invitación: ${JSON.stringify(fila ?? null)}`);
  }
  if (fila.resultado !== "creada") return { ok: false, motivo: fila.resultado as MotivoDeRechazoAlInvitar };

  const envio = await enviarCorreoDesdeServidor({
    plantilla: "invitacion_admin",
    datos: { enlace, venceEn: fila.vencimiento, invitadoPor },
    destinatario: correo,
    entidad: fila.id_invitacion,
  });
  // El id de la invitación y el motivo, no el correo.
  if (!envio.ok) console.error(`[equipo] la invitación ${fila.id_invitacion} no salió: ${envio.motivo}`);
  return { ok: true, correoEnviado: envio.ok };
}

export type InvitacionDeAdmin = { vigente: true; correo: string; venceEn: string } | { vigente: false };

/**
 * La invitación de un token, si todavía sirve: sin usar, sin cancelar, sin vencer y con quien la hizo todavía activo.
 * Una invitación de un admin que ya se desactivó no sirve (si la cuenta de quien invitó se comprometió, su invitación
 * no puede convertir a otra persona en admin); si lo reactivan, vuelve a servir. La base decide al gastarla, con su
 * `now()` y la misma comprobación (`registrar_admin`); esta lectura solo ahorra mostrar un formulario que no va a
 * servir y crear un usuario de Auth de más.
 */
export async function buscarInvitacionDeAdmin(token: unknown, ahora: Date = new Date()): Promise<InvitacionDeAdmin> {
  if (!tieneFormaDeToken(token)) return { vigente: false };
  const admin = crearClienteAdmin();
  const { data, error } = await admin
    .from("invitacion_admin")
    .select("correo, vence_en, usada_en, cancelada_en, id_admin")
    .eq("token_hash", hashDeToken(token))
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la invitación: ${error.code} ${error.message}`);
  if (!data || data.usada_en || data.cancelada_en || new Date(data.vence_en) <= ahora) return { vigente: false };

  const { data: activo, error: errorDeQuienInvito } = await admin.rpc("invitador_activo", { p_id_admin: data.id_admin });
  if (errorDeQuienInvito) throw new Error(`No se pudo comprobar a quien invitó: ${errorDeQuienInvito.code} ${errorDeQuienInvito.message}`);
  if (activo !== true) return { vigente: false };
  return { vigente: true, correo: data.correo, venceEn: data.vence_en };
}

export type ResultadoDeRegistrarAdmin =
  | { ok: true; correo: string }
  | { ok: false; motivo: "invitacion_no_sirve" | "correo_con_cuenta" | "fallo"; error: string };

export const TEXTO_INVITACION_NO_SIRVE = "Este enlace ya se usó o venció. Pide otra invitación al equipo de Calibra.";
export const TEXTO_CORREO_CON_CUENTA = "Ya hay una cuenta de Calibra con este correo. Escribe al equipo para que te ayude.";
export const TEXTO_FALLO_AL_REGISTRAR = "No pudimos crear tu cuenta. Intenta de nuevo.";

/** Cada cuánto se vuelve a leer la invitación mientras se espera a que otro registro la gaste. */
export const PAUSA_AL_RELEER_MS = 250;
/** Cuánto se espera, como máximo, a que otro registro de la misma invitación termine. */
export const ESPERA_AL_RELEER_MS = 2_000;

/**
 * Lee la invitación; si sigue vigente, la vuelve a leer cada `PAUSA_AL_RELEER_MS` hasta `ESPERA_AL_RELEER_MS`. Devuelve
 * la primera lectura en que ya no sirve, o la última si nunca dejó de servir.
 */
async function releerHastaQueSeGaste(token: unknown): Promise<InvitacionDeAdmin> {
  let invitacion = await buscarInvitacionDeAdmin(token);
  for (let esperado = 0; invitacion.vigente && esperado < ESPERA_AL_RELEER_MS; esperado += PAUSA_AL_RELEER_MS) {
    await new Promise((resolver) => setTimeout(resolver, PAUSA_AL_RELEER_MS));
    invitacion = await buscarInvitacionDeAdmin(token);
  }
  return invitacion;
}

/**
 * Crea la cuenta en Auth y, en una sola transacción de la base, gasta la invitación y da de alta al admin al final del
 * orden de revisión (`registrar_admin`). Si la base dice que la invitación ya no sirve (otra pestaña la gastó un
 * instante antes) o falla, se borra la cuenta recién creada: no queda un usuario de Auth sin admin.
 *
 * Dos registros a la vez de la misma invitación crean el usuario con el mismo correo y Auth rechaza el segundo antes de
 * que la base se entere de que el ganador la gasta. Si el segundo llega cuando el primero ya existe, Auth contesta
 * `email_exists`; si los dos llegan a la vez a su índice de correos, contesta un 500 sin código («Database error creating
 * new user»), que es lo que pasa en la práctica (se comprobó contra el Auth local). En los dos casos se vuelve a leer la
 * invitación unas veces (cada `PAUSA_AL_RELEER_MS`, hasta `ESPERA_AL_RELEER_MS`) a ver si el ganador la gasta: así el
 * perdedor ve que el enlace ya no sirve (criterio 8). Solo si pasa la espera y la invitación sigue vigente se dice otra
 * cosa: con `email_exists`, que el correo es de una cuenta que ya existía (un estudiante, por ejemplo); con el 500, que no
 * se pudo crear la cuenta. Lo que no puede pasar es una segunda cuenta, un segundo admin o un usuario huérfano.
 */
export async function registrarAdmin(token: unknown, datos: DatosDeRegistroDeAdmin): Promise<ResultadoDeRegistrarAdmin> {
  const invitacion = await buscarInvitacionDeAdmin(token);
  if (!invitacion.vigente) return { ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE };

  const admin = crearClienteAdmin();
  const { data: creado, error: errorDeCuenta } = await admin.auth.admin.createUser({
    email: invitacion.correo,
    password: datos.contrasena,
    // El correo ya se comprobó: la invitación llegó a esa bandeja.
    email_confirm: true,
  });
  if (errorDeCuenta || !creado.user) {
    const correoYaExiste = errorDeCuenta?.code === "email_exists";
    // Un 500 de Auth puede ser el choque con otro registro de la misma invitación (ver arriba). Un 4xx, o un fallo de red
    // (sin estado), no lo es: no se espera.
    const errorDelServidor = (errorDeCuenta?.status ?? 0) >= 500;
    if (correoYaExiste || errorDelServidor) {
      const despues = await releerHastaQueSeGaste(token);
      if (!despues.vigente) return { ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE };
      if (correoYaExiste) return { ok: false, motivo: "correo_con_cuenta", error: TEXTO_CORREO_CON_CUENTA };
    }
    console.error("[admins] no se pudo crear la cuenta:", errorDeCuenta?.code ?? errorDeCuenta?.message);
    return { ok: false, motivo: "fallo", error: TEXTO_FALLO_AL_REGISTRAR };
  }

  const idUsuario = creado.user.id;
  const { data: registrado, error } = await admin.rpc("registrar_admin", {
    p_token_hash: hashDeToken(token as string),
    p_id_usuario: idUsuario,
    p_correo: invitacion.correo,
    p_nombre: datos.nombre,
  });
  if (error || !registrado) {
    const { error: errorDeBorrado } = await admin.auth.admin.deleteUser(idUsuario);
    // Una cuenta que quede sin admin bloquea ese correo: el equipo tiene que borrarla a mano en Auth.
    if (errorDeBorrado) console.error(`[admins] quedó una cuenta sin admin en Auth (${idUsuario}); bórrala a mano.`);
    if (error) {
      console.error("[admins] no se pudo registrar al admin:", error.code ?? error.message);
      return { ok: false, motivo: "fallo", error: TEXTO_FALLO_AL_REGISTRAR };
    }
    return { ok: false, motivo: "invitacion_no_sirve", error: TEXTO_INVITACION_NO_SIRVE };
  }
  return { ok: true, correo: invitacion.correo };
}

/**
 * Reconstruye el correo de una invitación que no salió (HU-065). El token no se guarda, así que no se puede volver a
 * armar el mismo enlace: se genera uno nuevo y se reemplaza el hash, solo si la invitación sigue abierta y vigente. El
 * enlace viejo nunca llegó (el correo falló), así que nadie lo pierde. Si ya se usó, venció o se canceló, `null`: ese
 * correo ya no tiene sentido. El nombre de quien invitó va en una segunda consulta y no en un embebido: la tabla tiene
 * dos llaves hacia `admin` y PostgREST pediría el nombre de la llave.
 */
export async function reconstruirInvitacionDeAdmin(
  idInvitacion: string,
  ahora: Date = new Date(),
): Promise<Reconstruccion<"invitacion_admin"> | null> {
  if (!esUuid(idInvitacion)) return null;
  const admin = crearClienteAdmin();
  const { token, hash } = generarToken();
  const { data, error } = await admin
    .from("invitacion_admin")
    .update({ token_hash: hash })
    .eq("id", idInvitacion)
    .is("usada_en", null)
    .is("cancelada_en", null)
    .gt("vence_en", ahora.toISOString())
    .select("correo, vence_en, id_admin")
    .maybeSingle();
  if (error) throw new Error(`No se pudo reconstruir la invitación: ${error.code} ${error.message}`);
  if (!data) return null;

  const { data: quien, error: errorDelNombre } = await admin.from("admin").select("nombre").eq("id", data.id_admin).maybeSingle();
  if (errorDelNombre) throw new Error(`No se pudo leer el nombre de quien invitó: ${errorDelNombre.code} ${errorDelNombre.message}`);
  return {
    destinatario: data.correo,
    datos: {
      enlace: urlDelSitio(rutaDeRegistroDeAdmin(token)),
      venceEn: data.vence_en,
      invitadoPor: unaLinea(quien?.nombre) || NOMBRE_SI_FALTA,
    },
  };
}

/** Las invitaciones abiertas, con la sesión del admin: `public.invitaciones_de_admin()` a cualquier otro rol le da una lista vacía. */
export async function listarInvitaciones(cliente: Cliente): Promise<InvitacionAbierta[]> {
  const { data, error } = await cliente.rpc("invitaciones_de_admin");
  if (error) throw new Error(`No se pudieron leer las invitaciones: ${error.code} ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id,
    correo: f.correo,
    invitadaPor: f.invitada_por,
    invitoActivo: f.invito_activo,
    creadaEn: new Date(f.creada_en),
    venceEn: new Date(f.vence_en),
  }));
}

/**
 * Cancela una invitación abierta, con la sesión del admin: su enlace deja de servir. La base comprueba que quien llama
 * sea un admin activo. Se llama distinto de la acción `cancelarInvitacion` para que el archivo de la acción no importe
 * un nombre que ya declara.
 */
export async function cancelarInvitacionAbierta(cliente: Cliente, id: string): Promise<ResultadoDeCancelar> {
  const { data, error } = await cliente.rpc("cancelar_invitacion_admin", { p_id: id });
  if (error) throw new Error(`No se pudo cancelar la invitación: ${error.code} ${error.message}`);
  if (!esResultadoDeCancelar(data)) throw new Error(`Respuesta inesperada al cancelar: ${JSON.stringify(data)}`);
  return data;
}
