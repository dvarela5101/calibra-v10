import type { Metadata } from "next";
import Link from "next/link";
import { AccesoDeCabecera } from "@/components/AccesoDeCabecera";
import { ResultadoDelDiagnostico } from "@/components/diagnostico/ResultadoDelDiagnostico";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import type { ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import { TEXTOS } from "@/lib/diagnostico/presentacion";
import { leerResultadoPorToken } from "@/lib/diagnostico/recuperacion";

// El enlace trae el token: que no quede en buscadores ni se filtre por el Referer.
export const metadata: Metadata = {
  title: "Tu resultado · Calibra",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * HU-031 (RN-12, D-20): el resultado de un diagnóstico con el enlace del correo, desde cualquier dispositivo. Va fuera del
 * grupo `(publico)`, como `/cita`: abrirlo no crea una sesión anónima, no liga el navegador al Lead y no escribe nada (el
 * reconocimiento del dispositivo es de HU-032). Lee con la llave secreta (`resultado_por_token`) y le pasa al componente de
 * HU-009 solo la proyección: la vista nunca recibe el token ni datos del Lead. Sin la ranura del contacto: ya es Lead.
 *
 * Un token ausente, vacío, repetido (`?token=a&token=b` llega como arreglo), mal formado, inexistente o de un diagnóstico sin
 * Lead da la misma pantalla, con el mismo código: no dice si el enlace existió. Lee `searchParams`, así que es dinámica y
 * sale con `Cache-Control` privado.
 */
export default async function Resultados({ searchParams }: PageProps<"/resultados">) {
  const { token } = await searchParams;

  let resultado: ResultadoParaMostrar | null;
  try {
    resultado = await leerResultadoPorToken(token);
  } catch (error) {
    // Solo el mensaje: el token nunca va al registro.
    console.error("[diagnostico] no se pudo leer el resultado del enlace:", error instanceof Error ? error.message : error);
    return (
      <Pantalla acceso={<AccesoDeCabecera />} eyebrow={TEXTOS.eyebrow} titulo="No pudimos cargar tus resultados">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, inténtalo más tarde.
        </p>
      </Pantalla>
    );
  }
  if (!resultado) return <EnlaceQueNoSirve />;

  return (
    <Pantalla acceso={<AccesoDeCabecera />} eyebrow={resultado.materia.nombre} titulo={TEXTOS.tituloDelResultado}>
      <ResultadoDelDiagnostico resultado={resultado} />
    </Pantalla>
  );
}

function EnlaceQueNoSirve() {
  return (
    <Pantalla acceso={<AccesoDeCabecera />}
      eyebrow={TEXTOS.eyebrow}
      titulo="Este enlace no sirve"
      subtitulo="Está incompleto o no lo reconocemos. Abre de nuevo el enlace del correo que te mandamos."
    >
      <Link href="/" className={formulario.enlace}>
        Ir al inicio
      </Link>
    </Pantalla>
  );
}
