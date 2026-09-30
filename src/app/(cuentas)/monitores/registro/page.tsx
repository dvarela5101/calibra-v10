import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { formatearFechaHora } from "@/lib/fechas";
import { buscarInvitacion } from "@/lib/monitores/servidor";
import { FormularioRegistro } from "./FormularioRegistro";

export const metadata: Metadata = {
  title: "Crear mi cuenta de monitor · Calibra",
  // El enlace trae un token: que no quede en buscadores ni se filtre por el Referer.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * HU-013 (P-20): solo se llega con una invitación. Sin ella, o con una usada o vencida, no hay
 * formulario: no existe el autorregistro de monitores.
 */
export default async function RegistroMonitor({ searchParams }: PageProps<"/monitores/registro">) {
  const { token } = await searchParams;
  const invitacion = await buscarInvitacion(token);

  if (!invitacion.vigente) {
    return (
      <Pantalla
        eyebrow="Cuenta de monitor"
        titulo="Necesitas una invitación vigente"
        subtitulo="Las cuentas de monitor se crean con una invitación del equipo de Calibra, después de la evaluación presencial. Este enlace no sirve: ya se usó, venció o está incompleto. Pide otra invitación al equipo."
      >
        <Link href="/ingresar" className={formulario.enlace}>
          ¿Ya tienes cuenta? Inicia sesión
        </Link>
      </Pantalla>
    );
  }

  return (
    <Pantalla
      eyebrow="Cuenta de monitor"
      titulo="Crea tu cuenta de monitor"
      subtitulo={`Con ella vas a abrir tus franjas y recibir tus pagos. Esta invitación vence el ${formatearFechaHora(new Date(invitacion.venceEn))}.`}
    >
      <FormularioRegistro token={token as string} correo={invitacion.correo} />
    </Pantalla>
  );
}
