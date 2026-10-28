"use client";

import { useEffect, useState } from "react";
import { EVENTOS } from "@/lib/analitica/eventos";
import { ANCLA_DE_LA_SOLICITUD } from "@/lib/solicitudes/reglas";
import { EnlaceConEvento } from "./EnlaceConEvento";
import estilos from "./portada.module.css";

/**
 * HU-109: en el teléfono, «Quiero ser monitor» queda al alcance del pulgar (la barra solo se ve por debajo de 720 px, como la de
 * la portada) y se esconde cuando el formulario está a la vista, porque ahí ya no hace falta llevar a él.
 */
export function BarraMovilDeMonitores() {
  const [formularioALaVista, setFormularioALaVista] = useState(false);

  useEffect(() => {
    const formulario = document.getElementById(ANCLA_DE_LA_SOLICITUD);
    if (!formulario) return;
    const observador = new IntersectionObserver(([entrada]) => setFormularioALaVista(entrada.isIntersecting));
    observador.observe(formulario);
    return () => observador.disconnect();
  }, []);

  return (
    <div className={`${estilos.barraMovil} ${formularioALaVista ? estilos.barraOculta : ""}`}>
      <EnlaceConEvento
        href={`#${ANCLA_DE_LA_SOLICITUD}`}
        evento={EVENTOS.clicCtaSerMonitor}
        propiedades={{ ubicacion: "barra_movil" }}
        className={estilos.ctaBarra}
      >
        Quiero ser monitor
      </EnlaceConEvento>
    </div>
  );
}
