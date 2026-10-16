"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import type { EstadoNuevaContrasena } from "./acciones";

const estadoInicial: EstadoNuevaContrasena = { error: null };

/**
 * Pide la contraseña y su repetición. La acción que la guarda la pone quien lo usa: `/restablecer/nueva` guarda y cierra
 * la sesión del enlace; `/cuenta/contrasena` (HU-032) guarda y deja la sesión abierta.
 */
export function FormularioNuevaContrasena({
  accion: accionDelFormulario,
  textoDelBoton = "Guardar contraseña",
}: {
  accion: (anterior: EstadoNuevaContrasena, datos: FormData) => Promise<EstadoNuevaContrasena>;
  textoDelBoton?: string;
}) {
  const [estado, accion, enviando] = useActionState(accionDelFormulario, estadoInicial);

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
        {enviando ? "Guardando…" : textoDelBoton}
      </button>
    </form>
  );
}
