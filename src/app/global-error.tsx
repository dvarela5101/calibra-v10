"use client";

import { useEffect } from "react";
import formulario from "@/components/formulario.module.css";
import estilos from "@/components/pantalla.module.css";
import { TEXTOS_DE_ERROR, datosDelRegistro } from "@/components/textosDeError";
import { IDIOMA } from "@/config/regional";
// Reemplaza al layout raíz, así que trae sus propios estilos (la guía de Next: `global-error` define su `<html>`, estilos y
// dependencias). Sin la fuente Inter: si el layout falló, el texto sale en la del sistema (el cuerpo ya la lista de respaldo).
import "@/styles/tokens.css";
import "./globals.css";

/**
 * HU-133: un fallo del layout raíz. Es un documento aparte: no usa `Pantalla` ni `next/link` (el enrutador puede estar
 * roto), sino su misma estructura con enlaces comunes, que recargan la página entera.
 */
export default function ErrorGlobal({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("Error en el layout raíz", datosDelRegistro(error));
  }, [error]);

  return (
    <html lang={IDIOMA}>
      <body>
        <title>Algo salió mal · Calibra</title>
        <div className={estilos.pantalla}>
          <header className={estilos.marca}>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- recarga completa a propósito: el enrutador puede estar roto */}
            <a href="/" className={estilos.enlaceMarca} aria-label="Calibra, ir al inicio">
              {/* eslint-disable-next-line @next/next/no-img-element -- fuera del layout, sin la optimización de next/image */}
              <img src="/logo.svg" alt="" width={36} height={36} />
              <span className={estilos.nombre}>Calibra</span>
            </a>
          </header>
          <main className={estilos.contenido}>
            <p className={estilos.eyebrow}>{TEXTOS_DE_ERROR.eyebrow}</p>
            <h1 className={estilos.titulo}>{TEXTOS_DE_ERROR.titulo}</h1>
            <p className={estilos.subtitulo}>{TEXTOS_DE_ERROR.subtitulo}</p>
            <button type="button" className={formulario.boton} onClick={() => retry()}>
              {TEXTOS_DE_ERROR.reintentar}
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- recarga completa a propósito */}
            <a href="/" className={formulario.botonSecundario}>
              {TEXTOS_DE_ERROR.inicio}
            </a>
          </main>
        </div>
      </body>
    </html>
  );
}
