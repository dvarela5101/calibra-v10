"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useExigirSesionAnonima } from "@/components/captcha/useExigirSesionAnonima";
import casillas from "@/components/casillas.module.css";
import formulario from "@/components/formulario.module.css";
import { TEXTO_CASILLA_SIN_CANCELACION, type PedidoDeAgendar } from "@/lib/agendar/reglas";
import { TEXTO_VERIFICANDO } from "@/lib/captcha/textos";
import { agendar, type EstadoAgendar } from "./acciones";
import estilos from "./agendar.module.css";

const estadoInicial: EstadoAgendar = { error: null, avisoSinCancelacion: false, reservaPendiente: null };

/**
 * HU-017: confirma la fecha. Con menos de 12 h (RN-37, D-10) muestra el aviso y una casilla que hay que
 * marcar; si la hora cruzó ese límite mientras la persona decidía, la acción la devuelve con la casilla.
 */
export function FormularioAgendar({ pedido, avisoSinCancelacion }: { pedido: PedidoDeAgendar; avisoSinCancelacion: boolean }) {
  const [estado, accion, enviando] = useActionState(agendar, estadoInicial);
  // HU-058: sin sesión lista, el envío espera la verificación; el aviso solo sale si no se logra.
  const sesion = useExigirSesionAnonima();
  const conAviso = avisoSinCancelacion || estado.avisoSinCancelacion;

  return (
    <form action={accion} onSubmit={sesion.alEnviar} className={formulario.formulario} noValidate>
      <input type="hidden" name="franja" value={pedido.idFranja} />
      <input type="hidden" name="fecha" value={pedido.fecha} />
      <input type="hidden" name="materia" value={pedido.codigoMateria} />

      {conAviso && (
        <div className={estilos.aviso}>
          <p id="aviso-sin-cancelacion" className={estilos.textoAviso}>
            Faltan menos de 12 horas para esta monitoría: si la apartas, no podrás cancelarla.
          </p>
          <div className={casillas.casilla}>
            <input
              id="acepta_sin_cancelacion"
              name="acepta_sin_cancelacion"
              type="checkbox"
              value="si"
              aria-describedby="aviso-sin-cancelacion"
              className={casillas.control}
            />
            <label htmlFor="acepta_sin_cancelacion" className={casillas.texto}>
              {TEXTO_CASILLA_SIN_CANCELACION}
            </label>
          </div>
        </div>
      )}

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      {estado.reservaPendiente && (
        <Link href={estado.reservaPendiente} className={formulario.enlace}>
          Ver la reserva que tengo por pagar
        </Link>
      )}
      {sesion.aviso}

      <button type="submit" className={formulario.boton} disabled={enviando || sesion.verificando}>
        {sesion.verificando ? TEXTO_VERIFICANDO : enviando ? "Apartando…" : "Apartar esta fecha"}
      </button>
    </form>
  );
}
