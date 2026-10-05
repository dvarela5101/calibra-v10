"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { AYUDA_AL_ACEPTAR, AYUDA_AL_RECHAZAR, LARGO_MAXIMO_OBSERVACIONES } from "@/lib/admin/reportes-reglas";
import { resolver, type EstadoResolucion } from "./acciones";
import estilos from "./reporte.module.css";

const estadoInicial: EstadoResolucion = { error: null, valores: { observaciones: "" } };

/**
 * HU-030: aceptar o rechazar el reporte, para el admin asignado. Las dos decisiones son definitivas (supuesto 3), así que
 * las dos piden confirmación: cada una abre un `<details>` con sus consecuencias escritas antes del botón, como al rechazar
 * un pago (HU-020). Con la confirmación cerrada, Enter no envía nada. Mientras una decisión se envía, los dos botones
 * quedan inactivos. Las observaciones son opcionales y las lee quien pagó (si se acepta) o quien reportó (si se rechaza).
 */
export function ResolverReporte({
  idReporte,
  consecuenciasDeAceptar,
  consecuenciasDeRechazar,
}: {
  idReporte: string;
  consecuenciasDeAceptar: string;
  consecuenciasDeRechazar: string;
}) {
  const [aceptacion, aceptar, aceptando] = useActionState(resolver, estadoInicial);
  const [rechazo, rechazar, rechazando] = useActionState(resolver, estadoInicial);
  const enviando = aceptando || rechazando;

  return (
    <div className={estilos.acciones}>
      <Decision
        id="aceptar"
        resumen="Aceptar el reporte"
        consecuencias={consecuenciasDeAceptar}
        ayuda={AYUDA_AL_ACEPTAR}
        boton={aceptando ? "Aceptando…" : "Sí, aceptar el reporte"}
        idReporte={idReporte}
        estado={aceptacion}
        accion={aceptar}
        enviando={enviando}
      />
      <Decision
        id="rechazar"
        resumen="Rechazar el reporte"
        consecuencias={consecuenciasDeRechazar}
        ayuda={AYUDA_AL_RECHAZAR}
        boton={rechazando ? "Rechazando…" : "Sí, rechazar el reporte"}
        idReporte={idReporte}
        estado={rechazo}
        accion={rechazar}
        enviando={enviando}
      />
    </div>
  );
}

/** Una decisión: su `<details>` con la consecuencia, el campo de observaciones y el botón de confirmar. */
function Decision({
  id,
  resumen,
  consecuencias,
  ayuda,
  boton,
  idReporte,
  estado,
  accion,
  enviando,
}: {
  id: "aceptar" | "rechazar";
  resumen: string;
  consecuencias: string;
  ayuda: string;
  boton: string;
  idReporte: string;
  estado: EstadoResolucion;
  accion: (datos: FormData) => void;
  enviando: boolean;
}) {
  return (
    // Abierto si la decisión volvió con un error, para que se lea aunque la página se haya vuelto a pintar.
    <details className={estilos.decision} open={estado.error ? true : undefined}>
      <summary className={estilos.resumen}>{resumen}</summary>
      <p id={`${id}-consecuencias`} className={estilos.consecuencias}>
        {consecuencias}
      </p>
      <form action={accion} className={formulario.formulario} noValidate>
        <input type="hidden" name="id_reporte" value={idReporte} />
        <input type="hidden" name="decision" value={id} />
        {/* La llave remonta el campo con lo devuelto tras un error (React vacía el formulario al enviar). */}
        <div key={estado.valores.observaciones} className={formulario.campo}>
          <label htmlFor={`${id}-observaciones`} className={formulario.etiqueta}>
            Observaciones (opcionales)
          </label>
          <p id={`${id}-observaciones-ayuda`} className={formulario.ayuda}>
            {ayuda}
          </p>
          <textarea
            id={`${id}-observaciones`}
            name="observaciones"
            rows={4}
            maxLength={LARGO_MAXIMO_OBSERVACIONES}
            defaultValue={estado.valores.observaciones}
            aria-describedby={`${id}-observaciones-ayuda`}
            className={`${formulario.entrada} ${estilos.campoObservaciones}`}
          />
        </div>

        {estado.error && (
          <p role="alert" className={formulario.error}>
            {estado.error}
          </p>
        )}

        <button type="submit" aria-describedby={`${id}-consecuencias`} className={formulario.boton} disabled={enviando}>
          {boton}
        </button>
      </form>
    </details>
  );
}
