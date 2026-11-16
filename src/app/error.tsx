"use client";

import Link from "next/link";
import { useEffect } from "react";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { TEXTOS_DE_ERROR, datosDelRegistro } from "@/components/textosDeError";
import { reportarError } from "@/lib/monitoreo/reportar";

/**
 * HU-133: lo que se ve cuando una página falla al renderizarse. Envuelve la página y sus hijos, no el layout raíz (eso es
 * `global-error.tsx`). En el registro solo va el `digest`, que enlaza con el registro del servidor.
 */
export default function ErrorDePagina({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("Error al mostrar la página", datosDelRegistro(error));
    reportarError(error); // HU-138: sin DSN no hace nada
  }, [error]);

  return (
    <Pantalla eyebrow={TEXTOS_DE_ERROR.eyebrow} titulo={TEXTOS_DE_ERROR.titulo} subtitulo={TEXTOS_DE_ERROR.subtitulo}>
      <button type="button" className={formulario.boton} onClick={() => retry()}>
        {TEXTOS_DE_ERROR.reintentar}
      </button>
      <Link href="/" className={formulario.botonSecundario}>
        {TEXTOS_DE_ERROR.inicio}
      </Link>
    </Pantalla>
  );
}
