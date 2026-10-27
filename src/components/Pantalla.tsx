import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { RielDelEstudiante, type PasoDelEstudiante } from "./RielDelEstudiante";
import estilos from "./pantalla.module.css";

type Props = {
  eyebrow?: string;
  titulo: string;
  subtitulo?: ReactNode;
  /** Solo en el recorrido del estudiante: el paso en que va, para el carril de la izquierda (D-74 d). */
  paso?: PasoDelEstudiante;
  /** Solo en las pantallas del visitante: `<AccesoDeCabecera />`, a la derecha de la marca (D-75 a). */
  acceso?: ReactNode;
  children?: ReactNode;
};

/** Columna de contenido con la marca arriba. El logo lleva al inicio. */
export function Pantalla({ eyebrow, titulo, subtitulo, paso, acceso, children }: Props) {
  return (
    <div className={`${estilos.pantalla} ${paso ? estilos.conRiel : ""}`}>
      <header className={estilos.marca}>
        <Link href="/" className={estilos.enlaceMarca} aria-label="Calibra, ir al inicio">
          <Image src="/logo.svg" alt="" width={36} height={36} priority />
          <span className={estilos.nombre}>Calibra</span>
        </Link>
        {acceso}
      </header>

      {paso && <RielDelEstudiante actual={paso} />}

      <main className={estilos.contenido}>
        {eyebrow && <p className={estilos.eyebrow}>{eyebrow}</p>}
        <h1 className={estilos.titulo}>{titulo}</h1>
        {subtitulo && <p className={estilos.subtitulo}>{subtitulo}</p>}
        {children}
      </main>
    </div>
  );
}
