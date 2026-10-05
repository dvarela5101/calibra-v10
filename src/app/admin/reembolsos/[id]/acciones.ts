"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutarReembolso } from "@/lib/admin/reembolsos";
import {
  CAMBIOS_DEL_REEMBOLSO,
  leerRegistro,
  MENSAJE_DE_FALLO,
  MENSAJES_DE_REGISTRO,
  type ResultadoDeRegistro,
} from "@/lib/admin/reembolsos-reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { diaDelNegocio } from "@/lib/fechas";
import { REENVIOS_PARA_LA_BANDEJA, type DesenlaceDeReenviar } from "@/lib/reembolsos/reglas";
import { reenviarPedidoDeLlave } from "@/lib/reembolsos/servidor";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-026, HU-082: cualquier admin activo registra la transferencia de un reembolso pendiente (sin vuelta atrás). Escribe
 * con la sesión del admin: si se puede registrar y quién lo registra lo decide `public.ejecutar_reembolso`. Tras
 * registrarla vuelve a la página del reembolso, que dice qué pasó (`?registrado=`); lo que cambió mientras el admin
 * miraba (otro lo registró o todavía espera la llave) también vuelve a pintarla (`?error=`).
 * `valores` devuelve lo escrito para no vaciar el formulario tras un error.
 */
export type EstadoRegistro = { error: string | null; valores: { referencia: string; fecha: string } };

const rutaDelReembolso = (idReembolso: string) => `/admin/reembolsos/${idReembolso}`;

export async function registrar(_anterior: EstadoRegistro, datos: FormData): Promise<EstadoRegistro> {
  const id = String(datos.get("id_reembolso") ?? "").trim().toLowerCase();
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  await exigirRol("admin", esUuid(id) ? rutaDelReembolso(id) : "/admin");
  const escrito = (campo: string) => {
    const valor = datos.get(campo);
    return typeof valor === "string" ? valor : "";
  };
  const valores = { referencia: escrito("referencia"), fecha: escrito("fecha") };
  const lectura = leerRegistro(datos, diaDelNegocio(new Date()));
  if (!lectura.ok) return { error: lectura.error, valores };
  const ruta = rutaDelReembolso(lectura.datos.idReembolso);

  let resultado: ResultadoDeRegistro;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    resultado = await ejecutarReembolso(supabase, lectura.datos);
  } catch (error) {
    // Solo el mensaje: ni la llave ni la referencia van al registro.
    console.error("[reembolsos] no se pudo registrar la transferencia:", error instanceof Error ? error.message : error);
    return { error: MENSAJE_DE_FALLO, valores };
  }

  if (resultado === "reembolsado") {
    revalidatePath("/admin");
    revalidatePath(ruta);
    redirect(`${ruta}?${new URLSearchParams({ registrado: resultado })}`);
  }
  if ((CAMBIOS_DEL_REEMBOLSO as readonly string[]).includes(resultado)) {
    revalidatePath("/admin");
    redirect(`${ruta}?${new URLSearchParams({ error: resultado })}`);
  }
  return { error: MENSAJES_DE_REGISTRO[resultado], valores };
}

/**
 * HU-026 (criterio 3): cualquier admin activo vuelve a mandar el enlace para entregar la llave, sin reabrir ni cambiar
 * el plazo. Con la sesión del admin: si el caso todavía espera la llave y no venció lo decide
 * `public.reenviar_pedido_llave` con su hora. Vuelve a la página del reembolso con lo que pasó (`?reenvio=`), como
 * reabrir en la bandeja: funciona sin JavaScript. Si el reembolso no existe o quien lo pide ya no es un admin activo, la
 * página no podría decirlo (404, o no lo deja entrar): vuelve a la bandeja (`/admin?reenvio=`).
 */
export async function reenviar(datos: FormData): Promise<void> {
  const id = String(datos.get("id_reembolso") ?? "").trim().toLowerCase();
  // La acción se protege por sí sola: se puede llamar sin pasar por la página.
  await exigirRol("admin", esUuid(id) ? rutaDelReembolso(id) : "/admin");
  if (!esUuid(id)) redirect("/admin");

  let desenlace: DesenlaceDeReenviar;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    desenlace = await reenviarPedidoDeLlave(supabase, id);
  } catch (error) {
    console.error("[reembolsos] no se pudo reenviar el enlace:", error instanceof Error ? error.message : error);
    desenlace = "fallo";
  }
  const destino = (REENVIOS_PARA_LA_BANDEJA as readonly string[]).includes(desenlace) ? "/admin" : rutaDelReembolso(id);
  redirect(`${destino}?${new URLSearchParams({ reenvio: desenlace })}`);
}
