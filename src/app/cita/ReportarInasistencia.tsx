"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState, type Ref } from "react";
import formulario from "@/components/formulario.module.css";
import { reportarInasistencia, type EstadoReportar } from "./acciones-de-reporte";
import { SIN_RESPUESTA } from "./CancelarCita";
import estilos from "./cita.module.css";

const estadoInicial: EstadoReportar = { error: null };

/**
 * La acción, sin que un fallo de la red o un despliegue nuevo tumbe la página. Volver a intentar es seguro: si la
 * primera vez sí llegó, la base responde `ya_reportada` y la acción lleva a la cita. El `redirect` de la acción
 * llega aquí como un rechazo: no es una falla, se deja pasar para que Next haga la navegación.
 */
export async function reportarSinCaerse(anterior: EstadoReportar, datos: FormData): Promise<EstadoReportar> {
  try {
    return await reportarInasistencia(anterior, datos);
  } catch (error) {
    unstable_rethrow(error);
    return { error: SIN_RESPUESTA };
  }
}

type Props = {
  /** Con el enlace del correo, su token; con la sesión del navegador, el id de la monitoría. Viaja en un campo oculto. */
  origen: { token: string } | { id: string };
};

/**
 * HU-029: reportar que el monitor no llegó. El botón solo abre un paso de confirmación (solo se puede reportar una
 * vez por monitoría); ahí se confirma o se desiste. La página solo lo ofrece mientras se puede, pero quien decide es
 * la base: si ya no cabe, la acción responde con su explicación y se muestra aquí. Con éxito la acción lleva a la
 * misma cita, que ya muestra el estado del reporte.
 */
export function ReportarInasistencia({ origen }: Props) {
  const [estado, reportar, enviando] = useActionState(reportarSinCaerse, estadoInicial);
  const [confirmando, setConfirmando] = useState(false);
  // El error de un intento anterior no vuelve a verse al desistir ni al reabrir el paso: se guarda el estado que ya se descartó.
  const [descartado, setDescartado] = useState<EstadoReportar | null>(null);
  const botonAbrir = useRef<HTMLButtonElement>(null);
  const botonVolver = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  // Si la acción responde con un error, el foco vuelve a la salida segura (los botones estuvieron inhabilitados al enviar).
  useEffect(() => {
    if (estado.error) botonVolver.current?.focus();
  }, [estado]);

  // Al desistir, el foco vuelve al botón que abrió el paso (el que tenía el foco desaparece con él).
  useEffect(() => {
    if (!confirmando && devolverFoco.current) {
      devolverFoco.current = false;
      botonAbrir.current?.focus();
    }
  }, [confirmando]);

  const volver = () => {
    devolverFoco.current = true;
    setDescartado(estado);
    setConfirmando(false);
  };

  const abrir = () => {
    setDescartado(estado);
    setConfirmando(true);
  };

  return (
    <form action={reportar} className={estilos.reportar}>
      {"token" in origen ? (
        <input type="hidden" name="token" value={origen.token} />
      ) : (
        <input type="hidden" name="id" value={origen.id} />
      )}

      {confirmando ? (
        <PasoDeReporte enviando={enviando} alVolver={volver} refVolver={botonVolver} />
      ) : (
        <button ref={botonAbrir} type="button" className={formulario.boton} onClick={abrir}>
          El monitor no llegó
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
  enviando: boolean;
  alVolver: () => void;
  /** Para devolverle el foco cuando la acción responde con un error. */
  refVolver?: Ref<HTMLButtonElement>;
};

/**
 * El segundo paso: la pregunta, la nota y los dos botones. El foco empieza en "No, volver", la salida segura; el
 * grupo lleva la pregunta como nombre, así que un lector de pantalla la dice al entrar.
 */
export function PasoDeReporte({ enviando, alVolver, refVolver }: PasoProps) {
  const idPregunta = useId();

  return (
    <div role="group" aria-labelledby={idPregunta} className={estilos.confirmacionReporte}>
      <p id={idPregunta} className={estilos.pregunta}>
        ¿Reportar que el monitor no llegó?
      </p>
      <p className={estilos.notaDelDinero}>Un admin revisará tu reporte. Solo puedes reportar una vez esta monitoría.</p>
      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Enviando…" : "Sí, reportar"}
      </button>
      <button ref={refVolver} type="button" className={formulario.botonSecundario} onClick={alVolver} disabled={enviando} autoFocus>
        No, volver
      </button>
    </div>
  );
}
