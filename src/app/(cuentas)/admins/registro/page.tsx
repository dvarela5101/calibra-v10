import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { buscarInvitacionDeAdmin } from "@/lib/admin/invitaciones";
import { formatearFechaHora } from "@/lib/fechas";
import { FormularioRegistro } from "./FormularioRegistro";

export const metadata: Metadata = {
  title: "Crear mi cuenta de admin · Calibra",
  // El enlace trae un token: que no quede en buscadores ni se filtre por el Referer.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * HU-072: solo se llega con una invitación de un admin. Sin ella, o con una usada, vencida, cancelada o incompleta, no
 * hay formulario: no existe el autorregistro de admins, y ninguna página enlaza aquí.
 */
export default async function RegistroDeAdmin({ searchParams }: PageProps<"/admins/registro">) {
  const { token } = await searchParams;
  const invitacion = await buscarInvitacionDeAdmin(token);

  if (!invitacion.vigente) {
    return (
      <Pantalla
        eyebrow="Cuenta de admin"
        titulo="Necesitas una invitación vigente"
        subtitulo="Las cuentas de admin se crean con una invitación del equipo de Calibra. Este enlace no sirve: ya se usó, venció, se canceló o está incompleto. Pide otra invitación al equipo."
      >
        <Link href="/ingresar" className={formulario.enlace}>
          ¿Ya tienes cuenta? Inicia sesión
        </Link>
      </Pantalla>
    );
  }

  // La fecha de la mañana termina en «a. m.»: no se le agrega otro punto.
  const vence = formatearFechaHora(new Date(invitacion.venceEn));
  return (
    <Pantalla
      eyebrow="Cuenta de admin"
      titulo="Crea tu cuenta de admin"
      subtitulo={`Esta invitación vence el ${vence}${vence.endsWith(".") ? "" : "."}`}
    >
      <FormularioRegistro token={token as string} correo={invitacion.correo} />
    </Pantalla>
  );
}
