import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { formatearFechaHora } from "@/lib/fechas";
import { leerResenaPorToken } from "@/lib/resenas/servidor";
import { FormularioResena, MENSAJE_NO_DISPONIBLE, MENSAJE_YA_RESENADA } from "./FormularioResena";
import estilos from "./resena.module.css";

export const metadata: Metadata = {
  title: "Califica tu monitoría · Calibra",
  // El enlace trae un token: que no quede en buscadores ni se filtre por el Referer.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * HU-035 (RN-70, RN-72): el enlace del correo que le llega al Lead cuando su monitoría individual pasa a
 * realizada. El token es la única credencial: sirve para dejar una calificación y nada más.
 */
export default async function Resena({ searchParams }: PageProps<"/resena">) {
  const { token } = await searchParams;
  // Un parámetro repetido (?token=a&token=b) llega como arreglo: no es un enlace válido.
  const tokenDelEnlace = typeof token === "string" ? token : "";
  const resena = await leerResenaPorToken(tokenDelEnlace);

  if (!resena) {
    return (
      <Pantalla
        eyebrow="Tu monitoría"
        titulo="Este enlace no sirve"
        subtitulo="Está incompleto o no lo reconocemos. Abre de nuevo el enlace del correo que te mandamos."
      >
        <Link href="/" className={formulario.enlace}>
          Ir al inicio
        </Link>
      </Pantalla>
    );
  }

  if (resena.estado === "ya_resenada") {
    return (
      <Pantalla eyebrow="Tu monitoría" titulo="Ya calificaste esta monitoría" subtitulo={MENSAJE_YA_RESENADA}>
        <Link href="/" className={formulario.enlace}>
          Ir al inicio
        </Link>
      </Pantalla>
    );
  }

  if (resena.estado === "no_disponible") {
    return (
      <Pantalla eyebrow="Tu monitoría" titulo="No se puede calificar" subtitulo={MENSAJE_NO_DISPONIBLE}>
        <Link href="/" className={formulario.enlace}>
          Ir al inicio
        </Link>
      </Pantalla>
    );
  }

  return (
    <Pantalla
      eyebrow="Tu monitoría"
      titulo="Califica tu monitoría"
      subtitulo="Tu opinión ayuda a otros estudiantes a escoger monitor."
    >
      <dl className={estilos.resumen}>
        <div className={estilos.dato}>
          <dt className={estilos.rotulo}>Monitor</dt>
          <dd className={estilos.valor}>{resena.nombreMonitor}</dd>
        </div>
        <div className={estilos.dato}>
          <dt className={estilos.rotulo}>Materia</dt>
          <dd className={estilos.valor}>{resena.nombreMateria}</dd>
        </div>
        <div className={estilos.dato}>
          <dt className={estilos.rotulo}>Sesión</dt>
          <dd className={estilos.valor}>{formatearFechaHora(new Date(resena.inicio))}</dd>
        </div>
      </dl>
      <FormularioResena token={tokenDelEnlace} />
    </Pantalla>
  );
}
