import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { IDIOMA } from "@/config/regional";
import "@/styles/tokens.css";
import "./globals.css";

const inter = Inter({
  variable: "--fuente-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
      <body>{children}</body>
    </html>
  );
}
