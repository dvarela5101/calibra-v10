import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import estilos from "./pantalla.module.css";

type Props = {
  eyebrow?: string;
  titulo: string;
  subtitulo?: ReactNode;
  children?: ReactNode;
};

/** Columna de contenido con la marca arriba. El logo lleva al inicio. */
export function Pantalla({ eyebrow, titulo, subtitulo, children }: Props) {
  return (
    <div className={estilos.pantalla}>
      <header className={estilos.marca}>
        <Link href="/" className={estilos.enlaceMarca} aria-label="Calibra, ir al inicio">
          <Image src="/logo.svg" alt="" width={36} height={36} priority />
          <span className={estilos.nombre}>Calibra</span>
        </Link>
      </header>

      <main className={estilos.contenido}>
        {eyebrow && <p className={estilos.eyebrow}>{eyebrow}</p>}
        <h1 className={estilos.titulo}>{titulo}</h1>
        {subtitulo && <p className={estilos.subtitulo}>{subtitulo}</p>}
        {children}
      </main>
    </div>
  );
}
