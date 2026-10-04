"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState, type Ref } from "react";
import formulario from "@/components/formulario.module.css";
import { textoDelDineroAlCancelar, type EstadoDePagoDeCita } from "@/lib/citas/reglas";
import { cancelarCita, type EstadoCancelar } from "./acciones";
import estilos from "./cita.module.css";

const estadoInicial: EstadoCancelar = { error: null };

export const SIN_RESPUESTA = "No pudimos comunicarnos con Calibra. Revisa tu conexión e inténtalo de nuevo.";

/**
 * La acción, sin que un fallo de la red o un despliegue nuevo tumbe la página. Volver a intentar es seguro: si la
 * primera vez sí llegó, la base responde `ya_cancelada` y la acción lleva a la cita. El `redirect` de la acción
 * llega aquí como un rechazo: no es una falla, se deja pasar para que Next haga la navegación.
 */
export async function cancelarSinCaerse(anterior: EstadoCancelar, datos: FormData): Promise<EstadoCancelar> {
  try {
    return await cancelarCita(anterior, datos);
  } catch (error) {
    unstable_rethrow(error);
    return { error: SIN_RESPUESTA };
  }
}

type Props = {
  /** Con el enlace del correo, su token; con la sesión del navegador, el id de la monitoría. Viaja en un campo oculto. */
  origen: { token: string } | { id: string };
  /** El pago de la cita: de él depende la nota del dinero en el paso de confirmación. */
  estadoPago: EstadoDePagoDeCita;
};

/**
 * HU-024: cancelar la monitoría. El botón solo abre un paso de confirmación (cancelar no se deshace: la fecha queda
 * libre para otra persona); ahí se dice qué pasa con el dinero y se confirma o se desiste. La página solo lo ofrece
 * mientras hay plazo, pero quien decide es la base: si el plazo ya pasó, la acción responde con su explicación y se
 * muestra aquí. Con éxito la acción lleva a la misma cita, que ya se ve cancelada.
 */
export function CancelarCita({ origen, estadoPago }: Props) {
  const [estado, cancelar, enviando] = useActionState(cancelarSinCaerse, estadoInicial);
  const [confirmando, setConfirmando] = useState(false);
  // El error de un intento anterior no vuelve a verse al desistir ni al reabrir el paso: se guarda el estado que ya se descartó.
  const [descartado, setDescartado] = useState<EstadoCancelar | null>(null);
  const botonAbrir = useRef<HTMLButtonElement>(null);
  const botonMantener = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  // Si la acción responde con un error, el foco vuelve a la salida segura (los botones estuvieron inhabilitados al enviar).
  useEffect(() => {
    if (estado.error) botonMantener.current?.focus();
  }, [estado]);

  // Al desistir, el foco vuelve al botón que abrió el paso (el que tenía el foco desaparece con él).
  useEffect(() => {
    if (!confirmando && devolverFoco.current) {
      devolverFoco.current = false;
      botonAbrir.current?.focus();
    }
  }, [confirmando]);

  const mantener = () => {
    devolverFoco.current = true;
    setDescartado(estado);
    setConfirmando(false);
  };

  const abrir = () => {
    setDescartado(estado);
    setConfirmando(true);
  };

  return (
    <form action={cancelar} className={estilos.cancelar}>
      {"token" in origen ? (
        <input type="hidden" name="token" value={origen.token} />
      ) : (
        <input type="hidden" name="id" value={origen.id} />
      )}

      {confirmando ? (
        <PasoDeConfirmacion estadoPago={estadoPago} enviando={enviando} alMantener={mantener} refMantener={botonMantener} />
      ) : (
        <button ref={botonAbrir} type="button" className={estilos.abrirCancelar} onClick={abrir}>
          Cancelar mi monitoría
        </button>
      )}

      {confirmando && estado.error && estado !== descartado && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
    </form>
  );
}

type PasoProps = {
  estadoPago: EstadoDePagoDeCita;
  enviando: boolean;
  alMantener: () => void;
  /** Para devolverle el foco cuando la acción responde con un error. */
  refMantener?: Ref<HTMLButtonElement>;
};

/**
 * El segundo paso: la pregunta, qué pasa con el dinero y los dos botones. El foco empieza en "No, mantenerla", la
 * salida segura; el grupo lleva la pregunta como nombre, así que un lector de pantalla la dice al entrar.
 */
export function PasoDeConfirmacion({ estadoPago, enviando, alMantener, refMantener }: PasoProps) {
  const idPregunta = useId();
  const nota = textoDelDineroAlCancelar(estadoPago);

  return (
    <div role="group" aria-labelledby={idPregunta} className={estilos.confirmacion}>
      <p id={idPregunta} className={estilos.pregunta}>
        ¿Cancelar tu monitoría? La fecha queda libre para otra persona.
      </p>
      {nota && <p className={estilos.notaDelDinero}>{nota}</p>}
      <button type="submit" className={estilos.confirmarCancelar} disabled={enviando}>
        {enviando ? "Cancelando…" : "Sí, cancelar"}
      </button>
      <button
        ref={refMantener}
        type="button"
        className={formulario.botonSecundario}
        onClick={alMantener}
        disabled={enviando}
        autoFocus
      >
        No, mantenerla
      </button>
    </div>
  );
}
