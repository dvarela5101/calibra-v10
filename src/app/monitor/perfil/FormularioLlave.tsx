"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { cambiarLlave, type EstadoLlave } from "./acciones";

const estadoInicial: EstadoLlave = { error: null, exito: null };

export function FormularioLlave({ llave }: { llave: string }) {
  const [estado, accion, enviando] = useActionState(cambiarLlave, estadoInicial);

  return (
    <form action={accion} className={formulario.formulario} noValidate>
      <div className={formulario.campo}>
        <label htmlFor="llave" className={formulario.etiqueta}>
          Tu llave para recibir pagos
        </label>
        <p id="llave-ayuda" className={formulario.ayuda}>
          Si la cambias, los pagos que ya estaban en camino siguen yendo a la anterior.
        </p>
        <input
          id="llave"
          name="llave"
          type="text"
          defaultValue={llave}
          autoComplete="off"
          aria-describedby="llave-ayuda"
          required
          className={formulario.entrada}
        />
      </div>

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      {estado.exito && (
        <p role="status" className={formulario.exito}>
          {estado.exito}
        </p>
      )}

      <button type="submit" className={formulario.botonSecundario} disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar mi llave"}
      </button>
    </form>
  );
}
