"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { pedirEnlace, type EstadoRestablecer } from "./acciones";

const estadoInicial: EstadoRestablecer = { enviado: false, error: null };

export function FormularioRestablecer() {
  const [estado, accion, enviando] = useActionState(pedirEnlace, estadoInicial);

  if (estado.enviado) {
    return (
      <p role="status" className={formulario.exito}>
        Si ese correo tiene una cuenta, te enviamos un enlace para elegir una nueva contraseña. Revisa tu bandeja de
        entrada.
      </p>
    );
  }

  return (
    <form action={accion} className={formulario.formulario} noValidate>
      <div className={formulario.campo}>
        <label htmlFor="correo" className={formulario.etiqueta}>
          Correo
        </label>
        <input id="correo" name="correo" type="email" autoComplete="email" required className={formulario.entrada} />
      </div>

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Enviando…" : "Enviarme el enlace"}
      </button>
    </form>
  );
}
