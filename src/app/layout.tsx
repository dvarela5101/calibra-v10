import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { PieDePagina } from "@/components/PieDePagina";
import { IDIOMA } from "@/config/regional";
import "@/styles/tokens.css";
import "./globals.css";
import "@/styles/contenido.css";

// Inter variable (pesos 100 a 900), subconjunto latino: cubre tildes, ñ, ¿ y ¡.
// Va dentro del repo para que el build no dependa de descargar Google Fonts
// (una descarga fallida tumbó el build en CI). Licencia: fuentes/OFL-Inter.txt.
const inter = localFont({
  src: "./fuentes/inter-latin-variable.woff2",
  variable: "--fuente-inter",
  weight: "100 900",
  display: "swap",
});

// Noto Sans Math (peso 400) para las fórmulas del banco (HU-083), completa: es el woff2 de Google Fonts (v19), sin recortar.
// Mismo criterio que Inter: va dentro del repo y el build no baja nada. Licencia: fuentes/OFL-NotoSansMath.txt.
// `preload: false`: pesa unos 270 KB y solo la usan las fórmulas, así que no se precarga en las páginas que no tienen ninguna;
// el navegador la baja cuando un `math` la pide. `adjustFontFallback: false`: el respaldo automático de Next es Arial, que
// no tiene tabla MATH y quedaría delante de Cambria Math y STIX Two Math (contenido.css los lista como respaldo).
const notoSansMath = localFont({
  src: "./fuentes/noto-sans-math.woff2",
  variable: "--fuente-math",
  weight: "400",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Calibra",
  description:
    "Un diagnóstico corto te dice en qué subtema fallas y te conecta con un monitor certificado de tu materia.",
};

export const viewport: Viewport = {
  themeColor: "#FFFDF5",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={IDIOMA} className={`${inter.variable} ${notoSansMath.variable}`}>
      <body>
        {children}
        <PieDePagina />
      </body>
    </html>
  );
}
