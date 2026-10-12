"use client";

import type { FormEvent } from "react";
import { useExigirSesionAnonima } from "@/components/captcha/useExigirSesionAnonima";
import { ResultadoDelDiagnostico } from "@/components/diagnostico/ResultadoDelDiagnostico";
import formulario from "@/components/formulario.module.css";
import { TEXTO_VERIFICANDO } from "@/lib/captcha/textos";
import type { ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import { TEXTOS } from "@/lib/diagnostico/presentacion";
import estilos from "./diagnostico.module.css";

type Props = {
  /** El último resultado de la persona, o `null` si el servidor no trae uno: el mensaje y la pregunta salen igual. */
  ultimo: ResultadoParaMostrar | null;
  /** Un fallo al volver a tomarlo: se queda en esta pantalla, con su último resultado. */
  mensaje: string | null;
  pendiente: boolean;
  ocupado: boolean;
  alVolverATomar: () => void;
  alNo: () => void;
};

/**
 * HU-009, D-51: la persona ya vio todas las preguntas de la Evaluación y no se creó nada. En este orden: el mensaje que se lo
 * dice, la pregunta «¿Quieres volver a tomar el diagnóstico?» con «Sí, volver a tomarlo» y «No», y debajo su último resultado
 * con su fecha. «Sí» empieza uno nuevo que puede repetir preguntas; «No» vuelve al selector sin llamar a nada. El título
 * (h1) lo pone `Recorrido`.
 */
export function SinPreguntasNuevas({ ultimo, mensaje, pendiente, ocupado, alVolverATomar, alNo }: Props) {
  const sesion = useExigirSesionAnonima();

  function enviar(evento: FormEvent<HTMLFormElement>) {
    // La misma guardia de sesión que «Empezar»: «Sí» también crea un diagnóstico.
    if (sesion.alEnviar(evento)) return;
    evento.preventDefault();
    if (ocupado) return;
    alVolverATomar();
  }

  return (
    <div className={estilos.seccion}>
      <p className={estilos.mensaje}>{TEXTOS.mensajeSinPreguntas}</p>

      <section aria-labelledby="volver-a-tomar" className={estilos.seccion}>
        <h2 id="volver-a-tomar" className={estilos.subtitulo}>
          {TEXTOS.preguntaDeVolverATomar}
        </h2>
        <form onSubmit={enviar} className={formulario.formulario} noValidate>
          {mensaje && (
            <p role="alert" className={formulario.error}>
              {mensaje}
            </p>
          )}
          {sesion.aviso}
          <div className={estilos.botones}>
            <button type="submit" className={formulario.boton} disabled={ocupado || sesion.verificando}>
              {sesion.verificando ? TEXTO_VERIFICANDO : pendiente ? TEXTOS.empezando : TEXTOS.volverATomar}
            </button>
            <button type="button" className={formulario.botonSecundario} onClick={alNo} disabled={ocupado}>
              {TEXTOS.noVolverATomar}
            </button>
          </div>
        </form>
      </section>

      {ultimo && (
        <section aria-labelledby="ultimo-resultado" className={estilos.seccion}>
          <h2 id="ultimo-resultado" className={estilos.subtitulo}>
            {TEXTOS.ultimoResultado}
          </h2>
          <ResultadoDelDiagnostico resultado={ultimo} acciones="ninguna" nivelDeTitulos={3} />
        </section>
      )}
    </div>
  );
}
