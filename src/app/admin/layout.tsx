import type { Metadata } from "next";
import type { ReactNode } from "react";
import { obtenerSesion } from "@/lib/auth/sesion";
import { MenuAdmin } from "./MenuAdmin";

// El panel no es para buscadores. Cada página pone su título; esto solo suma `robots`.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * HU-137: el menú de secciones, en toda página bajo `/admin`. Solo decide si lo pinta: con la sesión de un admin sí, sin ella no.
 * No redirige ni autoriza: eso sigue en cada página y acción con `exigirRol`. Un layout no reemplaza esas comprobaciones (no
 * se vuelve a correr al navegar entre páginas hijas), y una descarga como `/admin/leads/exportar` es una ruta que no pasa por él.
 */
export default async function LayoutAdmin({ children }: { children: ReactNode }) {
  const sesion = await obtenerSesion();
  return (
    <>
      {sesion?.rol === "admin" && <MenuAdmin />}
      {children}
    </>
  );
}
