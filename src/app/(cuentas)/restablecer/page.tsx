import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { mensajeDeError } from "@/lib/auth/mensajes";
import { FormularioRestablecer } from "./FormularioRestablecer";

export const metadata: Metadata = { title: "Restablecer contraseña · Calibra" };

export default async function Restablecer({ searchParams }: PageProps<"/restablecer">) {
  const { error } = await searchParams;

  return (
    <Pantalla
      titulo="Restablece tu contraseña"
      subtitulo="Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una nueva."
    >
      {error === "enlace" && (
        <p role="alert" className={formulario.error}>
          {mensajeDeError("otp_expired")}
        </p>
      )}
      <FormularioRestablecer />
      <Link href="/ingresar" className={formulario.enlace}>
        Volver a iniciar sesión
      </Link>
    </Pantalla>
  );
}
