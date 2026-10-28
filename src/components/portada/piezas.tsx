import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { RUTA_AVISO } from "@/lib/privacidad/consentimiento";
import { AccesoDeLaPortada } from "./AccesoDeLaPortada";
import estilos from "./portada.module.css";

/**
 * HU-109: lo que comparten la landing de estudiantes (`/`) y la de monitores (`/quiero-ser-monitor`), para que las dos tengan la
 * misma estética sin copiar marcado ni estilos.
 */

/** Solo la marca y el acceso a la cuenta, sin menú (D-77 a). */
export function CabeceraDeLaPortada() {
  return (
    <header className={estilos.cabecera}>
      <div className={estilos.cabeceraInterior}>
        <Link href="/" className={estilos.enlaceMarca} aria-label="Calibra, ir al inicio">
          <Image src="/logo.svg" alt="" width={34} height={34} priority />
          <span className={estilos.nombreMarca}>Calibra</span>
        </Link>
        <AccesoDeLaPortada />
      </div>
    </header>
  );
}

/** El pie propio de la landing (el global se esconde con `data-landing`): la marca, los enlaces que reciba y el aviso (D-77 b). */
export function PieDeLaPortada({ children }: { children?: ReactNode }) {
  return (
    <footer className={estilos.pie}>
      <p className={estilos.nombrePie}>Calibra</p>
      <div className={estilos.enlacesPie}>
        {children}
        <Link href={RUTA_AVISO} className={estilos.enlacePie}>
          Aviso de privacidad
        </Link>
      </div>
    </footer>
  );
}

/** Un paso numerado de «Cómo funciona». */
export function Paso({ numero, titulo, children }: { numero: number; titulo: string; children: ReactNode }) {
  return (
    <li className={estilos.paso}>
      <span className={estilos.numeroPaso} aria-hidden="true">
        {numero}
      </span>
      <h3 className={estilos.tituloPaso}>{titulo}</h3>
      <p className={estilos.parrafo}>{children}</p>
    </li>
  );
}

/** Una afirmación del problema, con su explicación. */
export function Problema({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className={estilos.problema}>
      <p className={estilos.afirmacion}>{titulo}</p>
      <p className={estilos.parrafo}>{children}</p>
    </div>
  );
}

export function Beneficio({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <li className={estilos.beneficio}>
      <svg className={estilos.chulo} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12.5l5 5L20 6.5" />
      </svg>
      <p className={estilos.parrafo}>
        <strong className={estilos.fuerte}>{titulo}</strong> {children}
      </p>
    </li>
  );
}

export function Pregunta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className={estilos.pregunta}>
      <summary className={estilos.resumen}>{titulo}</summary>
      <p className={estilos.respuesta}>{children}</p>
    </details>
  );
}
