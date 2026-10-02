"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { LARGO_MAXIMO_OBSERVACIONES } from "@/lib/admin/pagos-reglas";
import { revisar, type EstadoRevision } from "./acciones";
import estilos from "./revision.module.css";

const estadoInicial: EstadoRevision = { error: null, valores: { observaciones: "" } };

/**
 * HU-020: aprobar o rechazar el pago, solo para el admin asignado. La revisión no se deshace (§5.2), así que el
 * rechazo pide confirmación: abre un `<details>` con las consecuencias escritas antes del botón (supuesto 7, como
 * desactivar a un admin). Mientras una decisión se envía, los dos botones quedan inactivos.
 */
export function RevisionDelPago({
  idPago,
  consecuencias,
  observacionesObligatorias,
  ayudaObservaciones,
}: {
  idPago: string;
  consecuencias: string;
  observacionesObligatorias: boolean;
  ayudaObservaciones: string;
}) {
  const [aprobacion, aprobar, aprobando] = useActionState(revisar, estadoInicial);
  const [rechazo, rechazar, rechazando] = useActionState(revisar, estadoInicial);
  const enviando = aprobando || rechazando;

  return (
    <div className={estilos.acciones}>
      <form action={aprobar} noValidate>
        <input type="hidden" name="id_pago" value={idPago} />
        <input type="hidden" name="decision" value="aprobar" />
        <button type="submit" className={formulario.boton} disabled={enviando}>
          {aprobando ? "Aprobando…" : "Aprobar pago"}
        </button>
      </form>
      {aprobacion.error && (
        <p role="alert" className={formulario.error}>
          {aprobacion.error}
        </p>
      )}

      {/* Abierto si el rechazo volvió con un error, para que se lea aunque la página se haya vuelto a pintar. */}
      <details className={estilos.rechazar} open={rechazo.error ? true : undefined}>
        <summary className={estilos.resumen}>Rechazar el pago</summary>
        <p id="rechazo-consecuencias" className={estilos.consecuencias}>
          {consecuencias}
        </p>
        <form action={rechazar} className={formulario.formulario} noValidate>
          <input type="hidden" name="id_pago" value={idPago} />
          <input type="hidden" name="decision" value="rechazar" />
          {/* La llave remonta el campo con lo devuelto tras un error (React vacía el formulario al enviar). */}
          <div key={rechazo.valores.observaciones} className={formulario.campo}>
            <label htmlFor="observaciones" className={formulario.etiqueta}>
              {observacionesObligatorias ? "Observaciones" : "Observaciones (opcionales)"}
            </label>
            <p id="observaciones-ayuda" className={formulario.ayuda}>
              {ayudaObservaciones}
            </p>
            <textarea
              id="observaciones"
              name="observaciones"
              rows={4}
              maxLength={LARGO_MAXIMO_OBSERVACIONES}
              defaultValue={rechazo.valores.observaciones}
              required={observacionesObligatorias}
              aria-describedby="observaciones-ayuda"
              className={`${formulario.entrada} ${estilos.campoObservaciones}`}
            />
          </div>

          {rechazo.error && (
            <p role="alert" className={formulario.error}>
              {rechazo.error}
            </p>
          )}

          <button type="submit" aria-describedby="rechazo-consecuencias" className={formulario.boton} disabled={enviando}>
            {rechazando ? "Rechazando…" : "Sí, rechazar el pago"}
          </button>
        </form>
      </details>
    </div>
  );
}
