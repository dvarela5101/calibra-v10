"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { TextoDelBanco } from "@/components/contenido/TextoDelBanco";
import formulario from "@/components/formulario.module.css";
import type { Letra } from "@/lib/diagnostico/motor";
import { decidirEnvioDeRespuesta } from "@/lib/diagnostico/pantalla";
import { TEXTOS } from "@/lib/diagnostico/presentacion";
import type { EnCurso } from "@/lib/diagnostico/reglas";
import estilos from "./diagnostico.module.css";

/** El enunciado recibe el foco cuando llega una pregunta nueva (lo mueve `Recorrido`). */
export const ID_DEL_ENUNCIADO = "enunciado-de-la-pregunta";

type Props = {
  enCurso: EnCurso;
  /** Un fallo al responder: la opción elegida se conserva porque la pregunta no se remonta. */
  mensaje: string | null;
  /**
   * Hay una llamada en curso o ya se está yendo al resultado: «Responder» queda `aria-disabled` (sigue enfocable y no envía) y
   * «Cambiar de materia» queda deshabilitado.
   */
  ocupado: boolean;
  alResponder: (letra: Letra) => void;
  alCambiarDeMateria: () => void;
};

/**
 * HU-009: una pregunta del diagnóstico. El enunciado, las cuatro opciones (radios nativos con su letra de A a D) y los botones.
 * Elegir una opción no envía nada: la elección es estado de esta pantalla, y la respuesta sale una sola vez con «Responder».
 * No muestra si acertó ni deja volver a una pregunta anterior. `Recorrido` la remonta (con `key`) en cada pregunta nueva para
 * limpiar la opción, y pone fuera de ella el avance «Pregunta N de hasta M», para que su región viva sea siempre el mismo elemento.
 */
export function Pregunta({ enCurso, mensaje, ocupado, alResponder, alCambiarDeMateria }: Props) {
  const [elegida, setElegida] = useState<Letra | null>(null);
  const [faltaElegir, setFaltaElegir] = useState(false);

  function elegir(letra: Letra) {
    setElegida(letra);
    setFaltaElegir(false);
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const decision = decidirEnvioDeRespuesta(elegida, ocupado);
    // «Elige una opción» no mueve el foco y no llama a nada.
    if (decision === "falta_elegir") setFaltaElegir(true);
    if (decision === "enviar" && elegida !== null) alResponder(elegida);
  }

  // No se confía en el envío implícito del navegador sobre un radio: Enter en una opción envía como «Responder».
  function alPulsar(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key !== "Enter") return;
    evento.preventDefault();
    evento.currentTarget.closest("form")?.requestSubmit();
  }

  const aviso = faltaElegir ? TEXTOS.eligeUnaOpcion : mensaje;

  return (
    <form onSubmit={enviar} noValidate className={formulario.formulario}>
      {/* Siempre un div: un enunciado con código lleva un bloque `pre`, que no cabe en un título, un p ni un label. */}
      <div id={ID_DEL_ENUNCIADO} tabIndex={-1} className={estilos.enunciado}>
        <TextoDelBanco texto={enCurso.pregunta.enunciado} />
      </div>

      <div role="radiogroup" aria-labelledby={ID_DEL_ENUNCIADO} className={estilos.lista} onKeyDown={alPulsar}>
        {enCurso.pregunta.opciones.map((opcion) => (
          <label key={opcion.letra} className={`${estilos.opcion} ${elegida === opcion.letra ? estilos.elegida : ""}`}>
            <input
              type="radio"
              name="opcion"
              value={opcion.letra}
              checked={elegida === opcion.letra}
              onChange={() => elegir(opcion.letra)}
              className={estilos.radio}
            />
            <span className={estilos.letra}>{opcion.letra}</span>
            <TextoDelBanco texto={opcion.texto} className={estilos.textoDeOpcion} />
          </label>
        ))}
      </div>

      {aviso && (
        <p role="alert" className={formulario.error}>
          {aviso}
        </p>
      )}

      {/* Sin `disabled`: ese atributo le quita el foco al botón y quien usa el teclado no podría reintentar tras un fallo (ver `.envio`). */}
      <button type="submit" className={`${formulario.boton} ${estilos.envio}`} aria-disabled={ocupado || undefined}>
        {TEXTOS.responder}
      </button>
      <button type="button" className={formulario.botonSecundario} onClick={alCambiarDeMateria} disabled={ocupado}>
        {TEXTOS.cambiarDeMateria}
      </button>
    </form>
  );
}
