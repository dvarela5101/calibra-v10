"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { ingresar, type EstadoIngreso } from "./acciones";

const estadoInicial: EstadoIngreso = { error: null };

export function FormularioIngreso({ siguiente }: { siguiente: string }) {
  const [estado, accion, enviando] = useActionState(ingresar, estadoInicial);

  return (
    <form action={accion} className={formulario.formulario} noValidate>
      <input type="hidden" name="siguiente" value={siguiente} />

      <div className={formulario.campo}>
        <label htmlFor="correo" className={formulario.etiqueta}>
          Correo
        </label>
        <input id="correo" name="correo" type="email" autoComplete="email" required className={formulario.entrada} />
      </div>

      <div className={formulario.campo}>
        <label htmlFor="contrasena" className={formulario.etiqueta}>
          Contraseña
        </label>
        <input
          id="contrasena"
          name="contrasena"
          type="password"
          autoComplete="current-password"
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
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
