"use client";

import { useActionState } from "react";
import formulario from "@/components/formulario.module.css";
import { TEXTOS } from "@/lib/cuentas/reglas";
import type { EstadoContacto } from "../../agendar/contacto/acciones";
import { pedirCuenta, terminarCuenta, type EstadoTerminar } from "./acciones";

const estadoInicial: EstadoContacto = { error: null, aviso: null, valores: {} };
const terminarInicial: EstadoTerminar = { error: null };

/**
 * «Crear mi cuenta» para quien ya tiene su contacto (HU-032, criterio 1): no pide nada, la acción usa el Lead de la sesión.
 * Sin el CAPTCHA propio: Auth no lo pide al ligar el correo, y la sesión ya lo pasó al nacer (S26).
 */
export function FormularioCuenta({ siguiente, avisoInicial = null }: { siguiente: string; avisoInicial?: string | null }) {
  // `avisoInicial`: quien dejó su contacto y pidió la cuenta en el mismo paso llega aquí ya con el correo enviado.
  const [estado, accion, enviando] = useActionState(pedirCuenta, { ...estadoInicial, aviso: avisoInicial });

  return (
    <form action={accion} className={formulario.formulario}>
      <input type="hidden" name="siguiente" value={siguiente} />
      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      {estado.aviso && (
        <p role="status" className={formulario.exito}>
          {estado.aviso}
        </p>
      )}
      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? TEXTOS.botonCreando : TEXTOS.botonCrear}
      </button>
    </form>
  );
}

/** «Terminar de crear mi cuenta» (criterio 14): para quien confirmó su correo y quedó sin Estudiante. */
export function FormularioTerminar() {
  const [estado, accion, enviando] = useActionState(terminarCuenta, terminarInicial);

  return (
    <form action={accion} className={formulario.formulario}>
      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? TEXTOS.botonTerminando : TEXTOS.botonTerminar}
      </button>
    </form>
  );
}
