"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { seccionActual, seccionesPara } from "@/lib/monitor/menu-reglas";
import estilos from "./menu.module.css";

/**
 * HU-123: la navegación fija del monitor. Marca la sección actual con `aria-current="page"` según la ruta. Sin certificados
 * solo salen Inicio y Perfil. El texto de cada enlace es la etiqueta corta, distinta de la de las tarjetas del panel.
 */
export function MenuMonitor({ conCertificados }: { conCertificados: boolean }) {
  const actual = seccionActual(usePathname());

  return (
    <nav aria-label="Secciones del monitor" className={estilos.menu} data-barra-fija="" data-menu-monitor="">
      {seccionesPara(conCertificados).map((seccion) => (
        <Link
          key={seccion.href}
          href={seccion.href}
          className={estilos.enlace}
          aria-current={seccion.href === actual ? "page" : undefined}
        >
          {seccion.etiqueta}
        </Link>
      ))}
    </nav>
  );
}
