"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { guardarContrasena, type EstadoNuevaContrasena } from "./acciones";

const estadoInicial: EstadoNuevaContrasena = { error: null };

export function FormularioNuevaContrasena() {
  const [estado, accion, enviando] = useActionState(guardarContrasena, estadoInicial);

  return (
    <form action={accion} className={formulario.formulario} noValidate>
      <div className={formulario.campo}>
        <label htmlFor="contrasena" className={formulario.etiqueta}>
          Nueva contraseña
        </label>
        <input
          id="contrasena"
          name="contrasena"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={formulario.entrada}
        />
      </div>

      <div className={formulario.campo}>
        <label htmlFor="confirmacion" className={formulario.etiqueta}>
          Repite la contraseña
        </label>
        <input
          id="confirmacion"
          name="confirmacion"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={formulario.entrada}
        />
      </div>

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
