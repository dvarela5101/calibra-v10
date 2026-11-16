"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SECCIONES_DEL_MENU, seccionActual } from "@/lib/admin/menu-reglas";
import estilos from "./menu.module.css";

/**
 * HU-137: el menú de secciones del panel. Marca la actual con `aria-current="page"` según la ruta. En el celular las nueve
 * secciones no caben en una fila y nada puede desplazarse en horizontal, así que el menú se pliega tras un botón que dice en
 * cuál sección estás; desde 768 px el botón no existe y las secciones van siempre a la vista.
 */
export function MenuAdmin() {
  const ruta = usePathname();
  const actual = seccionActual(ruta);
  const etiquetaActual = SECCIONES_DEL_MENU.find((seccion) => seccion.href === actual)?.etiqueta;
  // Se guarda en qué ruta se abrió: al navegar la ruta cambia y el menú queda plegado sin un efecto.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const abierto = abiertoEn === ruta;

  return (
    <nav aria-label="Secciones del panel" className={estilos.barra}>
      <div className={estilos.carril}>
        <button
          type="button"
          className={estilos.boton}
          aria-expanded={abierto}
          aria-controls="secciones-del-panel"
          onClick={() => setAbiertoEn(abierto ? null : ruta)}
        >
          <span>{etiquetaActual ? `Secciones · ${etiquetaActual}` : "Secciones"}</span>
          <span aria-hidden="true" className={estilos.flecha} />
        </button>
        <div id="secciones-del-panel" className={`${estilos.secciones} ${abierto ? estilos.abiertas : ""}`}>
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
      </div>
    </nav>
  );
}
