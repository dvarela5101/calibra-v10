"use client";

import { useActionState, useEffect, useId, useRef, useState, type Ref } from "react";
import formulario from "@/components/formulario.module.css";
import { BORRAR_FALLO } from "@/lib/materias/reglas";
import { borrar, borrarEvaluacion, type EstadoBorrado } from "./acciones";
import estilos from "./materias.module.css";
import { sinCaerse } from "./sinCaerse";

const estadoInicial: EstadoBorrado = { error: null };

const alFallar = (): EstadoBorrado => ({ error: BORRAR_FALLO });
const borrarMateriaSinCaerse = sinCaerse(borrar, alFallar);
const borrarEvaluacionSinCaerse = sinCaerse(borrarEvaluacion, alFallar);

type Props = {
  tipo: "materia" | "evaluacion";
  id: string;
  /** La pregunta del paso de confirmación, con el nombre de lo que se borra. */
  pregunta: string;
  /** Lo que dice el botón que abre el paso: «Borrar materia» o «Borrar». */
  etiqueta: string;
  /** El id de lo que nombra al botón, cuando la etiqueta sola no alcanza (una evaluación entre varias). */
  descritoPor?: string;
};

/**
 * HU-055 (D-62 c): borrar una materia o una evaluación que no tiene nada ligado. El botón solo abre un paso de
 * confirmación (borrar no se deshace), en la misma tarjeta; ahí se pregunta y se confirma o se desiste. La página solo lo
 * ofrece cuando la base dijo que no hay nada ligado, pero quien decide es la base: si entre tanto alguien ligó algo, la
 * acción responde con qué y se muestra aquí. Con éxito la acción lleva a otra página, así que este componente se va.
 */
export function BorrarConConfirmacion({ tipo, id, pregunta, etiqueta, descritoPor }: Props) {
  const [estado, borrarLoSeleccionado, enviando] = useActionState(
    tipo === "materia" ? borrarMateriaSinCaerse : borrarEvaluacionSinCaerse,
    estadoInicial,
  );
  const [confirmando, setConfirmando] = useState(false);
  // El error de un intento anterior no vuelve a verse al desistir ni al reabrir el paso: se guarda el estado que ya se descartó.
  const [descartado, setDescartado] = useState<EstadoBorrado | null>(null);
  const idPregunta = useId();
  const botonAbrir = useRef<HTMLButtonElement>(null);
  const botonCancelar = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  // Si la acción responde con un error, el foco vuelve a la salida segura (los botones estuvieron inhabilitados al enviar).
  useEffect(() => {
    if (estado.error) botonCancelar.current?.focus();
  }, [estado]);

  // Al desistir, el foco vuelve al botón que abrió el paso (el que tenía el foco desaparece con él).
  useEffect(() => {
    if (!confirmando && devolverFoco.current) {
      devolverFoco.current = false;
      botonAbrir.current?.focus();
    }
  }, [confirmando]);

  const cancelar = () => {
    devolverFoco.current = true;
    setDescartado(estado);
    setConfirmando(false);
  };

  const abrir = () => {
    setDescartado(estado);
    setConfirmando(true);
  };

  return (
    <form action={borrarLoSeleccionado} className={estilos.borrar}>
      <input type="hidden" name="id" value={id} />

      {confirmando ? (
        <PasoDeBorrado
          idPregunta={idPregunta}
          pregunta={pregunta}
          error={estado !== descartado ? estado.error : null}
          enviando={enviando}
          alCancelar={cancelar}
          refCancelar={botonCancelar}
        />
      ) : (
        <button ref={botonAbrir} type="button" className={estilos.abrirBorrar} aria-describedby={descritoPor} onClick={abrir}>
          {etiqueta}
        </button>
      )}
    </form>
  );
}

type PasoProps = {
  /** El id de la pregunta: nombra al grupo. */
  idPregunta: string;
  pregunta: string;
  error: string | null;
  enviando: boolean;
  alCancelar: () => void;
  /** Para devolverle el foco cuando la acción responde con un error. */
  refCancelar?: Ref<HTMLButtonElement>;
};

/**
 * El segundo paso: la pregunta y los dos botones. El foco empieza en «Cancelar», la salida segura; el grupo lleva la
 * pregunta como nombre, así que un lector de pantalla la dice al entrar. Los errores de la acción salen aquí, dentro del paso.
 */
export function PasoDeBorrado({ idPregunta, pregunta, error, enviando, alCancelar, refCancelar }: PasoProps) {
  return (
    <div role="group" aria-labelledby={idPregunta} className={estilos.confirmacion}>
      <p id={idPregunta} className={estilos.pregunta}>
        {pregunta}
      </p>
      <button type="submit" className={estilos.confirmarBorrar} disabled={enviando}>
        {enviando ? "Borrando…" : "Sí, borrar"}
      </button>
      <button ref={refCancelar} type="button" className={formulario.botonSecundario} onClick={alCancelar} disabled={enviando} autoFocus>
        Cancelar
      </button>
      {error && (
        <p role="alert" className={formulario.error}>
          {error}
        </p>
      )}
    </div>
  );
}
