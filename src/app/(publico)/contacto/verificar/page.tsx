import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { verificacionVigente } from "@/lib/leads/servidor";
import { FormularioConfirmar } from "./FormularioConfirmar";

export const metadata: Metadata = {
  title: "Confirma tu correo · Calibra",
  // El enlace trae un token: que no quede en buscadores ni se filtre por el Referer.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * HU-068 (P-23): el enlace que llega al dueño de un correo que alguien escribió al agendar. Abrirlo no
 * cambia nada; confirmar con el botón liga este navegador a sus datos.
 */
export default async function VerificarCorreo({ searchParams }: PageProps<"/contacto/verificar">) {
  const { token } = await searchParams;
  const vigente = await verificacionVigente(token);

  if (!vigente) {
    return (
      <Pantalla
        eyebrow="Tu correo"
        titulo="Este enlace ya no sirve"
        subtitulo="Ya se usó, venció o está incompleto. Si quieres agendar, vuelve a escribir tu correo y te mandamos otro."
      >
        <Link href="/" className={formulario.enlace}>
          Ir al inicio
        </Link>
      </Pantalla>
    );
  }

  return (
    <Pantalla
      eyebrow="Tu correo"
      titulo="Confirma que este correo es tuyo"
      subtitulo="Al confirmar, este navegador queda con tus datos de Calibra y puedes seguir agendando aquí. Si no fuiste tú quien quiso agendar, cierra esta página: sin confirmar, nadie ve tus datos."
    >
      <FormularioConfirmar token={token as string} />
    </Pantalla>
  );
}
