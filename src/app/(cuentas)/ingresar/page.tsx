import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { PANEL_POR_ROL, rutaInternaSegura, tienePanel } from "@/lib/auth/roles";
import { obtenerSesion } from "@/lib/auth/sesion";
import { FormularioIngreso } from "./FormularioIngreso";

export const metadata: Metadata = { title: "Iniciar sesión · Calibra" };

export default async function Ingresar({ searchParams }: PageProps<"/ingresar">) {
  const { siguiente, contrasena } = await searchParams;

  const sesion = await obtenerSesion();
  if (sesion && tienePanel(sesion.rol)) redirect(PANEL_POR_ROL[sesion.rol]);

  return (
    <Pantalla
      eyebrow="Monitores y equipo de Calibra"
      titulo="Inicia sesión"
      subtitulo="Entra con el correo y la contraseña de tu cuenta."
    >
      {contrasena === "actualizada" && (
        <p role="status" className={formulario.exito}>
          Tu contraseña quedó actualizada. Ya puedes entrar con ella.
        </p>
      )}
      <FormularioIngreso siguiente={rutaInternaSegura(typeof siguiente === "string" ? siguiente : "", "")} />
      <Link href="/restablecer" className={formulario.enlace}>
        ¿Olvidaste tu contraseña?
      </Link>
    </Pantalla>
  );
}
