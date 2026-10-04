"use client";

import { useActionState, type FormEvent } from "react";
import formulario from "@/components/formulario.module.css";
import { LARGO_MAXIMO_REFERENCIA } from "@/lib/admin/reembolsos-reglas";
import { registrar, type EstadoRegistro } from "./acciones";
import estilos from "./reembolso.module.css";

/**
 * Defensa: un envío con la confirmación cerrada no llega a la acción. Con los campos dentro de ella no debería
 * ocurrir (cerrada, no hay dónde pulsar Enter), pero el navegador envía con el botón de confirmar aunque esté oculto.
 */
function soloConLaConfirmacionAbierta(evento: FormEvent<HTMLFormElement>) {
  if (!evento.currentTarget.closest("details")?.open) evento.preventDefault();
}

/**
 * HU-026: registrar la transferencia de un reembolso pendiente (criterio 2). El admin asignado transfiere primero desde
 * la cuenta de Calibra y después escribe la referencia y la fecha (supuestos 2 y 3). Registrarla no se deshace
 * (supuesto 4), así que todo el formulario va dentro de una confirmación, como ejecutar un desembolso (HU-028): un
 * `<details>` que, al abrirse, dice qué queda registrado y trae los campos y el botón. Así nada se envía sin abrirla.
 * Quién registra lo pone la sesión.
 */
export function RegistrarTransferencia({
  idReembolso,
  fechaMinima,
  hoy,
  consecuencias,
}: {
  idReembolso: string;
  /** Día en que se creó el reembolso, `AAAA-MM-DD`: la transferencia no puede ser anterior. */
  fechaMinima: string;
  /** Día del negocio, `AAAA-MM-DD`: la transferencia no puede ser posterior. */
  hoy: string;
  consecuencias: string;
}) {
  const estadoInicial: EstadoRegistro = { error: null, valores: { referencia: "", fecha: hoy } };
  const [estado, accion, enviando] = useActionState(registrar, estadoInicial);
  // La llave remonta los campos cuando cambian los valores devueltos (React vacía el formulario al enviar).
  const llave = JSON.stringify(estado.valores);

  return (
    // Abierto si volvió con un error, para que se lea aunque la página se haya vuelto a pintar.
    <details className={estilos.confirmar} open={estado.error ? true : undefined}>
      <summary className={estilos.resumen}>Registrar la transferencia</summary>
      <p id="registrar-consecuencias" className={estilos.consecuencias}>
        {consecuencias}
      </p>
      <form action={accion} onSubmit={soloConLaConfirmacionAbierta} className={formulario.formulario} noValidate>
        <input type="hidden" name="id_reembolso" value={idReembolso} />
        <input type="hidden" name="fecha_minima" value={fechaMinima} />
        <div key={llave} className={estilos.campos}>
          <div className={formulario.campo}>
            <label htmlFor="referencia" className={formulario.etiqueta}>
              Referencia de la transferencia
            </label>
            <p id="referencia-ayuda" className={formulario.ayuda}>
              La que te da el banco al transferir. Hasta {LARGO_MAXIMO_REFERENCIA} caracteres.
            </p>
            <input
              id="referencia"
              name="referencia"
              type="text"
              maxLength={LARGO_MAXIMO_REFERENCIA}
              defaultValue={estado.valores.referencia}
              autoComplete="off"
              required
              aria-describedby="referencia-ayuda"
              className={formulario.entrada}
            />
          </div>

          <div className={formulario.campo}>
            <label htmlFor="fecha" className={formulario.etiqueta}>
              Fecha de la transferencia
            </label>
            <p id="fecha-ayuda" className={formulario.ayuda}>
              No puede ser posterior a hoy ni anterior al día en que se creó el reembolso.
            </p>
            <input
              id="fecha"
              name="fecha"
              type="date"
              min={fechaMinima}
              max={hoy}
              defaultValue={estado.valores.fecha}
              required
              aria-describedby="fecha-ayuda"
              className={formulario.entrada}
            />
          </div>
        </div>

        {estado.error && (
          <p role="alert" className={formulario.error}>
            {estado.error}
          </p>
        )}

        <button type="submit" aria-describedby="registrar-consecuencias" className={formulario.boton} disabled={enviando}>
          {enviando ? "Registrando…" : "Sí, registrar la transferencia"}
        </button>
      </form>
    </details>
  );
}
