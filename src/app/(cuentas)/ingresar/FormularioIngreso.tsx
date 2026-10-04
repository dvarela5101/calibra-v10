"use client";

import { useActionState } from "react";
import { CampoCaptcha } from "@/components/captcha/CampoCaptcha";
import { useTokenCaptcha } from "@/components/captcha/useTokenCaptcha";
import formulario from "@/components/formulario.module.css";
import { TEXTO_VERIFICANDO } from "@/lib/captcha/textos";
import { ingresar, type EstadoIngreso } from "./acciones";

const estadoInicial: EstadoIngreso = { error: null };

export function FormularioIngreso({ siguiente }: { siguiente: string }) {
  const [estado, accion, enviando] = useActionState(ingresar, estadoInicial);
  // HU-058 (D-30): Supabase Auth exige el token de Turnstile también en el login con contraseña.
  const captcha = useTokenCaptcha("ingreso", enviando);

  return (
    <form action={accion} onSubmit={captcha.alEnviar} className={formulario.formulario} noValidate>
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

      <CampoCaptcha captcha={captcha} />

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando || captcha.verificando}>
        {captcha.verificando ? TEXTO_VERIFICANDO : enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
