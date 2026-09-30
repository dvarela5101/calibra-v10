import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos";
import type { RegistroDeEnvios } from "./enviar";
import { limpiarError } from "./proveedor";

type Cliente = SupabaseClient<Database>;

/**
 * Cuánto tiempo puede estar un correo `pendiente` antes de darlo por abandonado (el proceso que lo
 * reservó murió) y dejar que otro lo tome. Un envío dura segundos, así que 5 minutos sobran.
 */
export const PENDIENTE_VENCE_MS = 5 * 60_000;

const UNICA_VIOLADA = "23505";

/**
 * El registro de envíos sobre la tabla `correo_envio`. Necesita el cliente con la llave secreta: la
 * tabla solo la escribe el servidor.
 *
 * `reservar` es el candado que evita duplicados: la clave es única, así que solo un proceso inserta la
 * fila. Quien llega después la encuentra y decide: `enviado` no se repite, `fallido` se toma para
 * reintentar, y `pendiente` reciente es de otro (`en_curso`). Tomar una fila es un
 * UPDATE condicionado a que no haya cambiado (`actualizado_en`): si dos procesos intentan tomar la
 * misma fila fallida, uno solo lo consigue.
 */
export function crearRegistroDeEnvios(cliente: Cliente, ahora: () => number = Date.now): RegistroDeEnvios {
  return {
    async reservar({ clave, plantilla, destinatario }) {
      const nuevo = await cliente.from("correo_envio").insert({ clave, plantilla, destinatario }).select("id").maybeSingle();
      if (!nuevo.error) return { accion: "enviar", intentosPrevios: 0 };
      if (nuevo.error.code !== UNICA_VIOLADA) throw new Error(nuevo.error.message);

      const existente = await cliente
        .from("correo_envio")
        .select("id, estado, intentos, actualizado_en")
        .eq("clave", clave)
        .maybeSingle();
      if (existente.error) throw new Error(existente.error.message);
      // La fila desapareció entre el insert y la lectura (alguien la limpió): que quien llama reintente.
      if (!existente.data) return { accion: "en_curso" };

      const fila = existente.data;
      if (fila.estado === "enviado") return { accion: "ya_enviado" };
      const abandonado = ahora() - Date.parse(fila.actualizado_en) > PENDIENTE_VENCE_MS;
      if (fila.estado === "pendiente" && !abandonado) return { accion: "en_curso" };

      // `fallido`, o `pendiente` abandonado: se toma solo si nadie la movió mientras tanto.
      const tomada = await cliente
        .from("correo_envio")
        .update({ estado: "pendiente", destinatario, actualizado_en: new Date(ahora()).toISOString() })
        .eq("id", fila.id)
        .eq("estado", fila.estado)
        .eq("actualizado_en", fila.actualizado_en)
        .select("id");
      if (tomada.error) throw new Error(tomada.error.message);
      return tomada.data.length === 1 ? { accion: "enviar", intentosPrevios: fila.intentos } : { accion: "en_curso" };
    },

    async marcarEnviado(clave, { idProveedor, intentos }) {
      const ahoraIso = new Date(ahora()).toISOString();
      const { error } = await cliente
        .from("correo_envio")
        .update({
          estado: "enviado",
          intentos,
          id_proveedor: idProveedor,
          ultimo_error: null,
          reintentable: false,
          enviado_en: ahoraIso,
          actualizado_en: ahoraIso,
        })
        .eq("clave", clave);
      if (error) throw new Error(error.message);
    },

    async marcarFallido(clave, { error: mensaje, intentos, reintentable }) {
      const { error } = await cliente
        .from("correo_envio")
        .update({
          estado: "fallido",
          intentos,
          reintentable,
          // limpiarError deja el mensaje en una línea, sin secretos y en 300 caracteres: cabe en el tope de 500 de la columna.
          ultimo_error: limpiarError(mensaje),
          actualizado_en: new Date(ahora()).toISOString(),
        })
        .eq("clave", clave);
      if (error) throw new Error(error.message);
    },
  };
}
