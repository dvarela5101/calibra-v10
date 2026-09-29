import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { comoRol, destinoPorRol, type Rol, type RolConPanel } from "./roles";

export type Sesion = { idUsuario: string; rol: Rol | null };

/**
 * Quién hace la petición y con qué rol. Capa de acceso a datos (DAL): toda página o
 * acción protegida pasa por aquí. getClaims() verifica la firma del token; el rol sale
 * de public.mi_rol(), que consulta la base (así un admin desactivado pierde el rol al
 * instante, aunque su token siga vigente).
 */
export const obtenerSesion = cache(async (): Promise<Sesion | null> => {
  const supabase = await crearClienteServidor();
  if (!supabase) return null;

  const { data } = await supabase.auth.getClaims();
  const idUsuario = data?.claims?.sub;
  if (!idUsuario) return null;

  const { data: rol } = await supabase.rpc("mi_rol");
  return { idUsuario, rol: comoRol(rol) };
});

/** Deja pasar solo al rol pedido; a los demás los redirige (a su panel o a /ingresar). */
export async function exigirRol(rol: RolConPanel, ruta: string): Promise<Sesion> {
  const sesion = await obtenerSesion();
  const destino = destinoPorRol(rol, sesion?.rol ?? null, ruta);
  if (destino || !sesion) redirect(destino ?? "/ingresar");
  return sesion;
}
