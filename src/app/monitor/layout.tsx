import type { Metadata } from "next";
import type { ReactNode } from "react";
import { obtenerSesion } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { MenuMonitor } from "./MenuMonitor";
import estilos from "./menu.module.css";

// HU-135: nada de este segmento debe quedar en buscadores. Las páginas que declaran su propio `robots` lo reemplazan por uno igual o más estricto.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** ¿Tiene el monitor al menos un certificado? Si el cliente falta o la consulta falla, se muestran todas las secciones: cada página autoriza y explica lo suyo. */
async function tieneCertificados(idMonitor: string): Promise<boolean> {
  const supabase = await crearClienteServidor();
  if (!supabase) return true;
  const { count, error } = await supabase
    .from("certificado")
    .select("id", { count: "exact", head: true })
    .eq("id_monitor", idMonitor);
  if (error) {
    console.error("No se pudieron contar los certificados del monitor para el menú", error.message);
    return true;
  }
  return (count ?? 0) > 0;
}

/**
 * HU-123: la navegación fija en toda página bajo `/monitor`. Solo decide si la pinta: con la sesión de un monitor sí, sin ella
 * no. No redirige ni autoriza: eso sigue en cada página y acción con `exigirRol`. En el DOM el menú va primero; el CSS lo baja
 * al pie en el teléfono y lo deja a la izquierda en el escritorio.
 */
export default async function LayoutMonitor({ children }: { children: ReactNode }) {
  const sesion = await obtenerSesion();
  if (sesion?.rol !== "monitor") return children;

  const conCertificados = await tieneCertificados(sesion.idUsuario);
  return (
    <div className={estilos.contenedor}>
      <MenuMonitor conCertificados={conCertificados} />
      <div className={estilos.contenido}>{children}</div>
    </div>
  );
}
