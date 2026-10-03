"use client";

import { useActionState, type FormEvent } from "react";
import formulario from "@/components/formulario.module.css";
import { LARGO_MAXIMO_REFERENCIA } from "@/lib/admin/desembolsos-reglas";
import { ejecutar, type EstadoEjecucion } from "./acciones";
import estilos from "./desembolso.module.css";

/**
 * Defensa: un envío con la confirmación cerrada no llega a la acción. Con los campos dentro de ella no debería
 * ocurrir (cerrada, no hay dónde pulsar Enter), pero el navegador envía con el botón de confirmar aunque esté oculto.
 */
function soloConLaConfirmacionAbierta(evento: FormEvent<HTMLFormElement>) {
  if (!evento.currentTarget.closest("details")?.open) evento.preventDefault();
}

/**
 * HU-028: registrar la transferencia de un desembolso ejecutable (criterio 4). El admin transfiere primero desde la
 * cuenta de Calibra y después escribe la referencia y la fecha (supuesto 3). Registrarla no se deshace, así que todo
 * el formulario va dentro de una confirmación, como rechazar un pago: un `<details>` que, al abrirse, dice qué queda
 * registrado y trae los campos y el botón. Así nada se envía sin abrirla (antes, Enter en la referencia registraba la
 * transferencia con la confirmación cerrada). El neto que vio el admin viaja oculto para que la base no registre otro
 * (`monto_cambio`); quién ejecuta lo pone la sesión.
 */
export function EjecutarDesembolso({
  idDesembolso,
  netoEsperado,
  fechaSesion,
  hoy,
  consecuencias,
}: {
  idDesembolso: string;
  netoEsperado: number;
  /** Día de la sesión, `AAAA-MM-DD`: la transferencia no puede ser anterior. */
  fechaSesion: string;
  /** Día del negocio, `AAAA-MM-DD`: la transferencia no puede ser posterior. */
  hoy: string;
  consecuencias: string;
}) {
  const estadoInicial: EstadoEjecucion = { error: null, valores: { referencia: "", fecha: hoy } };
  const [estado, accion, enviando] = useActionState(ejecutar, estadoInicial);
  // La llave remonta los campos cuando cambian los valores devueltos (React vacía el formulario al enviar).
  const llave = JSON.stringify(estado.valores);

  return (
    // Abierto si volvió con un error, para que se lea aunque la página se haya vuelto a pintar.
    <details className={estilos.confirmar} open={estado.error ? true : undefined}>
      <summary className={estilos.resumen}>Registrar la transferencia</summary>
      <p id="ejecutar-consecuencias" className={estilos.consecuencias}>
        {consecuencias}
      </p>
      <form action={accion} onSubmit={soloConLaConfirmacionAbierta} className={formulario.formulario} noValidate>
        <input type="hidden" name="id_desembolso" value={idDesembolso} />
        <input type="hidden" name="neto_esperado" value={netoEsperado} />
        <input type="hidden" name="fecha_sesion" value={fechaSesion} />
        <div key={llave} className={estilos.campos}>
          <div className={formulario.campo}>
            <label htmlFor="referencia" className={formulario.etiqueta}>
              Referencia de la transferencia
            </label>
            <p id="referencia-ayuda" className={formulario.ayuda}>
              La que da el banco al transferir. Hasta {LARGO_MAXIMO_REFERENCIA} caracteres.
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
              No puede ser posterior a hoy ni anterior al día de la sesión.
            </p>
            <input
              id="fecha"
              name="fecha"
              type="date"
              min={fechaSesion}
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

        <button type="submit" aria-describedby="ejecutar-consecuencias" className={formulario.boton} disabled={enviando}>
          {enviando ? "Registrando…" : "Sí, registrar la transferencia"}
        </button>
      </form>
    </details>
  );
}
