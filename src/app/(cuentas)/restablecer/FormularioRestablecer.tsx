"use client";

import { useActionState } from "react";
import { CampoCaptcha } from "@/components/captcha/CampoCaptcha";
import { useTokenCaptcha } from "@/components/captcha/useTokenCaptcha";
import formulario from "@/components/formulario.module.css";
import { TEXTO_VERIFICANDO } from "@/lib/captcha/textos";
import { pedirEnlace, type EstadoRestablecer } from "./acciones";

const estadoInicial: EstadoRestablecer = { enviado: false, error: null };

export function FormularioRestablecer() {
  const [estado, accion, enviando] = useActionState(pedirEnlace, estadoInicial);
  // HU-058 (D-30): Supabase Auth exige el token de Turnstile también en /recover.
  const captcha = useTokenCaptcha("restablecer", enviando);

  if (estado.enviado) {
    return (
      <p role="status" className={formulario.exito}>
        Si ese correo tiene una cuenta, te enviamos un enlace para elegir una nueva contraseña. Revisa tu bandeja de
        entrada.
      </p>
    );
  }

  return (
    <form action={accion} onSubmit={captcha.alEnviar} className={formulario.formulario} noValidate>
      <div className={formulario.campo}>
        <label htmlFor="correo" className={formulario.etiqueta}>
          Correo
        </label>
        <input id="correo" name="correo" type="email" autoComplete="email" required className={formulario.entrada} />
      </div>

      <CampoCaptcha captcha={captcha} />

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando || captcha.verificando}>
        {captcha.verificando ? TEXTO_VERIFICANDO : enviando ? "Enviando…" : "Enviarme el enlace"}
      </button>
    </form>
  );
}
