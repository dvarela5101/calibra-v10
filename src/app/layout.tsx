import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { PieDePagina } from "@/components/PieDePagina";
import { IDIOMA } from "@/config/regional";
import "@/styles/tokens.css";
import "./globals.css";

// Inter variable (pesos 100 a 900), subconjunto latino: cubre tildes, ñ, ¿ y ¡.
// Va dentro del repo para que el build no dependa de descargar Google Fonts
// (una descarga fallida tumbó el build en CI). Licencia: fuentes/OFL-Inter.txt.
const inter = localFont({
  src: "./fuentes/inter-latin-variable.woff2",
  variable: "--fuente-inter",
  weight: "100 900",
  display: "swap",
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
    <html lang={IDIOMA} className={inter.variable}>
      <body>
        {children}
        <PieDePagina />
      </body>
    </html>
  );
}
