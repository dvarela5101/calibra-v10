"use client";

import { useActionState } from "react";
import { useExigirSesionAnonima } from "@/components/captcha/useExigirSesionAnonima";
import formulario from "@/components/formulario.module.css";
import { TEXTO_VERIFICANDO } from "@/lib/captcha/textos";
import { confirmar, type EstadoConfirmacion } from "./acciones";

const estadoInicial: EstadoConfirmacion = { error: null };

/** HU-068 (P-23): confirmar el correo con un botón, no al abrir el enlace. */
export function FormularioConfirmar({ token }: { token: string }) {
  const [estado, accion, enviando] = useActionState(confirmar, estadoInicial);
  // HU-058: sin sesión lista, el envío espera la verificación; el aviso solo sale si no se logra.
  const sesion = useExigirSesionAnonima();

  return (
    <form action={accion} onSubmit={sesion.alEnviar} className={formulario.formulario}>
      <input type="hidden" name="token" value={token} />
      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      {sesion.aviso}
      <button type="submit" className={formulario.boton} disabled={enviando || sesion.verificando}>
        {sesion.verificando ? TEXTO_VERIFICANDO : enviando ? "Confirmando…" : "Sí, es mi correo"}
      </button>
    </form>
  );
}
