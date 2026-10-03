"use client";

import { useActionState, type FormEvent } from "react";
import formulario from "@/components/formulario.module.css";
import { CIERRES, CONSECUENCIAS_DEL_CIERRE, LARGO_MAXIMO_NOTA, TEXTOS_DEL_CIERRE } from "@/lib/admin/casos-p24-reglas";
import { cerrarCaso, type EstadoCierre } from "./acciones-caso";
import estilos from "./revision.module.css";

const estadoInicial: EstadoCierre = { error: null, valores: { cierre: "", nota: "" } };

/**
 * Defensa: un envío con la confirmación cerrada no llega a la acción, como al ejecutar un desembolso. Con los campos
 * dentro de ella no debería ocurrir, pero el navegador envía con el botón de confirmar aunque esté oculto.
 */
function soloConLaConfirmacionAbierta(evento: FormEvent<HTMLFormElement>) {
  if (!evento.currentTarget.closest("details")?.open) evento.preventDefault();
}

/**
 * HU-078: cerrar un caso P-24 como cobrado o asumido, con una nota opcional (criterio 2). Cerrarlo no se deshace
 * (D-38), así que todo el formulario va dentro de una confirmación, como registrar un desembolso: un `<details>` que,
 * al abrirse, dice qué cambia y trae las opciones, la nota y el botón. Así nada se envía sin abrirla. Quién lo cierra
 * lo pone la sesión.
 */
export function CerrarCaso({ idPago }: { idPago: string }) {
  const [estado, accion, enviando] = useActionState(cerrarCaso, estadoInicial);
  // La llave remonta los campos con lo devuelto tras un error (React vacía el formulario al enviar).
  const llave = JSON.stringify(estado.valores);

  return (
    // Abierto si volvió con un error, para que se lea aunque la página se haya vuelto a pintar.
    <details className={estilos.confirmar} open={estado.error ? true : undefined}>
      <summary className={estilos.resumen}>Cerrar el caso</summary>
      <p id="cierre-consecuencias" className={estilos.consecuencias}>
        {CONSECUENCIAS_DEL_CIERRE}
      </p>
      <form action={accion} onSubmit={soloConLaConfirmacionAbierta} className={formulario.formulario} noValidate>
        <input type="hidden" name="id_pago" value={idPago} />
        <div key={llave} className={estilos.campos}>
          <fieldset className={estilos.grupo}>
            <legend className={formulario.etiqueta}>¿Cómo se resolvió?</legend>
            {CIERRES.map((cierre) => (
              <label key={cierre} className={estilos.opcion}>
                <input type="radio" name="cierre" value={cierre} defaultChecked={estado.valores.cierre === cierre} className={estilos.radio} />
                {TEXTOS_DEL_CIERRE[cierre]}
              </label>
            ))}
          </fieldset>

          <div className={formulario.campo}>
            <label htmlFor="nota" className={formulario.etiqueta}>
              Nota (opcional)
            </label>
            <p id="nota-ayuda" className={formulario.ayuda}>
              Lo que quieras dejar anotado, por ejemplo cómo se cobró. Hasta {LARGO_MAXIMO_NOTA} caracteres.
            </p>
            <textarea
              id="nota"
              name="nota"
              rows={3}
              maxLength={LARGO_MAXIMO_NOTA}
              defaultValue={estado.valores.nota}
              aria-describedby="nota-ayuda"
              className={`${formulario.entrada} ${estilos.campoObservaciones}`}
            />
          </div>
        </div>

        {estado.error && (
          <p role="alert" className={formulario.error}>
            {estado.error}
          </p>
        )}

        <button type="submit" aria-describedby="cierre-consecuencias" className={formulario.boton} disabled={enviando}>
          {enviando ? "Cerrando…" : "Sí, cerrar el caso"}
        </button>
      </form>
    </details>
  );
}
