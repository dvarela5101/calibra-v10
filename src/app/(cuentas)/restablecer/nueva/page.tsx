import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Pantalla } from "@/components/Pantalla";
import { obtenerSesion } from "@/lib/auth/sesion";
import { FormularioNuevaContrasena } from "./FormularioNuevaContrasena";

export const metadata: Metadata = { title: "Nueva contraseña · Calibra" };

export default async function NuevaContrasena() {
  // Solo se llega con la sesión que abre el enlace del correo.
  const sesion = await obtenerSesion();
  if (!sesion || sesion.rol === "anonimo") redirect("/restablecer?error=enlace");

  return (
    <Pantalla titulo="Elige una nueva contraseña" subtitulo="Debe tener al menos 8 caracteres.">
      <FormularioNuevaContrasena />
    </Pantalla>
  );
}
