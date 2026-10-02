import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plantilla, Reconstruccion } from "@/lib/correo/plantillas";
import { enviarCorreoDesdeServidor, urlDelSitio, type EntradaDeEnvio, type ResultadoEnvio } from "@/lib/correo/servidor";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/tipos";
import { datosDeResenaIndividual, rutaDeResena, tieneFormaDeTokenDeResena, type DatosDeInvitacion, type EstadoDeResena } from "./reglas";

type Cliente = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuántas invitaciones toma cada corrida. Lo normal es una por corrida: el trigger la pide al anotarla. */
export const LOTE_DE_INVITACIONES = 10;

/**
 * La corrida deja de tomar invitaciones pasado este tiempo, como los avisos de HU-051: un envío con el proveedor
 * caído puede tardar unos 32 s, y 20 s más ese envío caben en el límite de la función (60 s). Cortar a mitad de
 * un envío podría dejarlo `pendiente` aunque haya salido, y el reintento lo mandaría otra vez.
 */
export const PRESUPUESTO_DE_CORRIDA_MS = 20_000;

/** Corridas en las que una invitación puede fallar antes de abandonarla, para que no tape a las demás. */
export const MAXIMO_DE_INTENTOS = 5;

/** Los datos del correo de un pago, con la llave secreta. `null` si el pago no tiene invitación. */
async function leerDatos(cliente: Cliente, idPago: string): Promise<DatosDeInvitacion | null> {
  const { data, error } = await cliente.rpc("datos_de_invitacion_resena", { p_id_pago: idPago });
  if (error) throw new Error(`No se pudieron leer los datos de la invitación: ${error.message}`);
  const fila = data?.[0];
  if (!fila) return null;
  return {
    token: fila.token,
    disponible: fila.disponible,
    correoLead: fila.correo_lead,
    nombreLead: fila.nombre_lead,
    nombreMonitor: fila.nombre_monitor,
  };
}

/**
 * Para mandar o reintentar el correo de la reseña (HU-065). La entidad es el id del pago. Es `null` si el pago no
 * tiene invitación o ya no se puede reseñar (la reseña ya se dejó, o el pago se rechazó después de anotarla).
 */
export async function reconstruirInvitacionResena(
  idPago: string,
  cliente: Cliente = crearClienteAdmin(),
): Promise<Reconstruccion<"resena_individual"> | null> {
  if (!UUID.test(idPago)) return null;
  const d = await leerDatos(cliente, idPago);
  // Sin datos es raro: la invitación solo existe si el pago tiene monitoría, monitor y Lead. Se deja rastro.
  if (!d) console.warn(`[resenas] el pago ${idPago} no tiene los datos de la invitación: no se manda.`);
  return d?.disponible ? { destinatario: d.correoLead, datos: datosDeResenaIndividual(d, urlDelSitio(rutaDeResena(d.token))) } : null;
}

export type ResumenDeInvitaciones = {
  revisadas: number;
  enviadas: number;
  /** La invitación ya no valía (ya hay reseña, el pago se rechazó o no tiene datos): no se manda. */
  descartadas: number;
  /** El correo falló y quedó `fallido` en `correo_envio`: lo reintenta HU-065 o lo ve el admin. */
  fallidas: number;
  /** Otra corrida lo estaba mandando (la clave del correo es única). */
  tomadasPorOtro: number;
  /** No se pudo procesar (error de la base o de los datos): se reintenta en otra corrida, hasta `MAXIMO_DE_INTENTOS`. */
  conError: number;
  /** Se acabó el presupuesto de tiempo: quedan para la próxima corrida. */
  pospuestas: number;
};

export type DependenciasDeInvitaciones = {
  /** Con la llave secreta: `invitacion_resena` solo la lee y la marca el servidor. */
  cliente: Cliente;
  enviar: <P extends Plantilla>(entrada: EntradaDeEnvio<P>) => Promise<ResultadoEnvio>;
  /** El reloj de la corrida, para el presupuesto de tiempo. */
  reloj: () => number;
};

type Invitacion = { id: string; id_pago: string; intentos: number };

/**
 * Manda las invitaciones pendientes (HU-035), de la más antigua a la más reciente. Cada una queda procesada cuando
 * su correo queda en `correo_envio` (enviado, o fallido para reintentar) o cuando ya no vale. Si no se pudo
 * procesar, suma un intento y se abandona al llegar a `MAXIMO_DE_INTENTOS`. Dos corridas a la vez no lo mandan dos
 * veces: la clave del correo (`resena_individual:<id_pago>`) es única.
 */
export async function procesarInvitacionesResena(dependencias?: Partial<DependenciasDeInvitaciones>): Promise<ResumenDeInvitaciones> {
  const cliente = dependencias?.cliente ?? crearClienteAdmin();
  const enviar = dependencias?.enviar ?? enviarCorreoDesdeServidor;
  const reloj = dependencias?.reloj ?? Date.now;
  const inicio = reloj();
  const resumen: ResumenDeInvitaciones = { revisadas: 0, enviadas: 0, descartadas: 0, fallidas: 0, tomadasPorOtro: 0, conError: 0, pospuestas: 0 };

  const { data: invitaciones, error } = await cliente
    .from("invitacion_resena")
    .select("id, id_pago, intentos")
    .is("procesado_en", null)
    .order("creada_en")
    .limit(LOTE_DE_INVITACIONES);
  if (error) throw new Error(`No se pudieron leer las invitaciones: ${error.message}`);

  for (const invitacion of invitaciones ?? []) {
    resumen.revisadas++;
    if (reloj() - inicio >= PRESUPUESTO_DE_CORRIDA_MS) {
      resumen.pospuestas++;
      continue;
    }
    try {
      const correo = await reconstruirInvitacionResena(invitacion.id_pago, cliente);
      const resultado = correo && (await enviar({ plantilla: "resena_individual", ...correo, entidad: invitacion.id_pago }));
      if (!resultado) {
        resumen.descartadas++;
      } else if (resultado.ok) {
        resumen.enviadas++;
      } else if (resultado.motivo === "en_curso") {
        resumen.tomadasPorOtro++;
      } else if (resultado.motivo === "fallo_del_registro") {
        // Sin registro no hay reintento de HU-065: la invitación vuelve a intentarse en otra corrida.
        throw new Error(resultado.error);
      } else {
        // Quedó `fallido` en el registro (o el correo del Lead no es un correo): HU-065 y la bandeja del admin.
        console.error(`[resenas] la invitación del pago ${invitacion.id_pago} no salió: ${resultado.error}`);
        resumen.fallidas++;
      }
      await marcar(cliente, invitacion, { procesado_en: new Date().toISOString() });
    } catch (falla) {
      resumen.conError++;
      await sumarIntento(cliente, invitacion, falla);
    }
  }
  return resumen;
}

async function marcar(cliente: Cliente, invitacion: Invitacion, cambios: { procesado_en?: string; intentos?: number }): Promise<void> {
  const { error } = await cliente.from("invitacion_resena").update(cambios).eq("id", invitacion.id);
  if (error) throw new Error(`No se pudo marcar la invitación: ${error.message}`);
}

/** Suma un intento fallido; al llegar al máximo, abandona la invitación (queda procesada y se avisa en el log). */
async function sumarIntento(cliente: Cliente, invitacion: Invitacion, falla: unknown): Promise<void> {
  const mensaje = falla instanceof Error ? falla.message : String(falla);
  const intentos = invitacion.intentos + 1;
  const abandonar = intentos >= MAXIMO_DE_INTENTOS;
  console.error(
    `[resenas] no se pudo procesar la invitación del pago ${invitacion.id_pago} (intento ${intentos}${abandonar ? ", se abandona" : ""}): ${mensaje}`,
  );
  try {
    await marcar(cliente, invitacion, abandonar ? { intentos, procesado_en: new Date().toISOString() } : { intentos });
  } catch (otra) {
    console.error("[resenas] tampoco se pudo anotar el intento:", otra instanceof Error ? otra.message : otra);
  }
}

const ESTADOS: readonly EstadoDeResena[] = ["disponible", "ya_resenada", "no_disponible"];

export type ResenaPorToken = { estado: EstadoDeResena; nombreMonitor: string; nombreMateria: string; inicio: string };

/**
 * Lo que muestra la página del enlace (HU-035): si se puede reseñar y de qué monitoría. `null` si el token no
 * tiene forma de token o no existe. Con la llave secreta: el token es la credencial y la base no lo expone.
 */
export async function leerResenaPorToken(token: string): Promise<ResenaPorToken | null> {
  if (!tieneFormaDeTokenDeResena(token)) return null;
  const { data, error } = await crearClienteAdmin().rpc("resena_por_token", { p_token: token });
  if (error) throw new Error(`No se pudo leer la reseña: ${error.message}`);
  const fila = data?.[0];
  if (!fila) return null;
  const estado = ESTADOS.find((e) => e === fila.estado);
  if (!estado) throw new Error(`Estado de reseña desconocido: ${fila.estado}`);
  return { estado, nombreMonitor: fila.nombre_monitor, nombreMateria: fila.nombre_materia, inicio: new Date(fila.inicio).toISOString() };
}

export type ResultadoDeResena = "registrada" | "ya_resenada" | "no_disponible" | "no_existe";

const RESULTADOS: readonly ResultadoDeResena[] = ["registrada", "ya_resenada", "no_disponible", "no_existe"];

/**
 * Guarda la reseña del pago al que pertenece el token (RN-70). La base vuelve a revisar todo con el pago
 * bloqueado, así que dos envíos a la vez dejan una sola reseña. La calificación y el comentario vienen ya
 * validados (`validarResena`); la base los revisa otra vez con sus `check`.
 */
export async function registrarResena(token: string, calificacion: number, comentario: string | null): Promise<ResultadoDeResena> {
  if (!tieneFormaDeTokenDeResena(token)) return "no_existe";
  const { data, error } = await crearClienteAdmin().rpc("registrar_resena", {
    p_token: token,
    p_calificacion: calificacion,
    // La RPC recibe texto: vacío equivale a sin comentario (como `registrar_lead` con el teléfono).
    p_comentario: comentario ?? "",
  });
  if (error) throw new Error(`No se pudo registrar la reseña: ${error.message}`);
  const resultado = RESULTADOS.find((r) => r === data);
  if (!resultado) throw new Error(`Respuesta desconocida al registrar la reseña: ${String(data)}`);
  return resultado;
}
