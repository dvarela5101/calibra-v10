"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { confirmar, type EstadoConfirmacion } from "./acciones";

const estadoInicial: EstadoConfirmacion = { error: null };

/** HU-068 (P-23): confirmar el correo con un botón, no al abrir el enlace. */
export function FormularioConfirmar({ token }: { token: string }) {
  const [estado, accion, enviando] = useActionState(confirmar, estadoInicial);

  return (
    <form action={accion} className={formulario.formulario}>
      <input type="hidden" name="token" value={token} />
      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Confirmando…" : "Sí, es mi correo"}
      </button>
    </form>
  );
}
