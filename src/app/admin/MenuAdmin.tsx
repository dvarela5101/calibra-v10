"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { SECCIONES_DEL_MENU, seccionActual } from "@/lib/admin/menu-reglas";
import estilos from "./menu.module.css";

/** HU-137: el menú de secciones del panel. Marca la actual con `aria-current="page"` según la ruta. */
export function MenuAdmin() {
  const actual = seccionActual(usePathname());
  const carril = useRef<HTMLDivElement>(null);

  // En el celular el carril se desplaza: deja a la vista la sección actual (solo en horizontal, sin mover la página).
  useEffect(() => {
    const elCarril = carril.current;
    const enlace = elCarril?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!elCarril || !enlace) return;
    elCarril.scrollLeft = enlace.offsetLeft - (elCarril.clientWidth - enlace.offsetWidth) / 2;
  }, [actual]);

  return (
    <nav aria-label="Secciones del panel" className={estilos.barra}>
      <div ref={carril} className={estilos.carril}>
        {SECCIONES_DEL_MENU.map((seccion) => (
          <Link
            key={seccion.href}
            href={seccion.href}
            className={estilos.enlace}
            aria-current={seccion.href === actual ? "page" : undefined}
          >
            {seccion.etiqueta}
          </Link>
        ))}
      </div>
    </nav>
  );
}
