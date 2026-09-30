"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { invitar, type EstadoInvitacion } from "./acciones";

const estadoInicial: EstadoInvitacion = { error: null, exito: null };

export function FormularioInvitar() {
  const [estado, accion, enviando] = useActionState(invitar, estadoInicial);

  return (
    <form action={accion} className={formulario.formulario} noValidate>
      <div className={formulario.campo}>
        <label htmlFor="correo" className={formulario.etiqueta}>
          Correo del aspirante
        </label>
        <input id="correo" name="correo" type="email" autoComplete="off" required className={formulario.entrada} />
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

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar invitación"}
      </button>
    </form>
  );
}
