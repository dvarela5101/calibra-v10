"use client";

import Link from "next/link";
import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { RUTA_CREAR_CUENTA, TEXTOS } from "@/lib/cuentas/reglas";
import { confirmar, type EstadoConfirmarCuenta } from "./acciones";

const estadoInicial: EstadoConfirmarCuenta = { error: null, siguientePaso: null };

/** HU-032: confirmar el correo con un botón, no al abrir el enlace. No lleva el CAPTCHA propio: Auth no lo pide al verificar. */
export function FormularioConfirmarCuenta({ tokenHash }: { tokenHash: string }) {
  const [estado, accion, enviando] = useActionState(confirmar, estadoInicial);

  return (
    <form action={accion} className={formulario.formulario}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      {estado.siguientePaso && (
        <Link href={RUTA_CREAR_CUENTA} className={formulario.enlace}>
          {estado.siguientePaso === "pedir_otro" ? TEXTOS.pedirOtroEnlace : TEXTOS.irATerminar}
        </Link>
      )}
      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? TEXTOS.botonConfirmando : TEXTOS.botonConfirmar}
      </button>
    </form>
  );
}
