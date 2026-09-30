"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { cerrarFranja, type EstadoFranja } from "../acciones";

/** Cerrar una franja desde una fecha (P-30). La base no deja cerrarla antes de su última monitoría. */
export function FormularioCierre({ id, desdeMinimo }: { id: string; desdeMinimo: string }) {
  const [estado, enviar, enviando] = useActionState<EstadoFranja, FormData>(cerrarFranja, {
    error: null,
    exito: null,
    valores: {},
  });

  return (
    <form action={enviar} className={formulario.formulario} noValidate>
      <input type="hidden" name="id" value={id} />
      <div className={formulario.campo}>
        <label htmlFor="cerrada_desde" className={formulario.etiqueta}>
          Cerrar desde
        </label>
        <p id="cierre-ayuda" className={formulario.ayuda}>
          Desde esa fecha no te pueden agendar en esta franja. Las monitorías de antes se mantienen.
        </p>
        <input
          id="cerrada_desde"
          name="cerrada_desde"
          type="date"
          min={desdeMinimo}
          defaultValue={estado.valores.cerrada_desde ?? desdeMinimo}
          aria-describedby="cierre-ayuda"
          required
          className={formulario.entrada}
        />
      </div>

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}

      <button type="submit" className={formulario.botonSecundario} disabled={enviando}>
        {enviando ? "Cerrando…" : "Cerrar la franja"}
      </button>
    </form>
  );
}
