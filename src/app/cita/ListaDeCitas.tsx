import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { momentoDeCita, rutaDeMiCita, type Cita } from "@/lib/citas/reglas";
import { formatearDiaConSemana } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import estilos from "./cita.module.css";

type Props = {
  /** Las citas del navegador, la más reciente primero (`leerMisCitas`). Vacía si no tiene o si no hay sesión. */
  citas: Cita[];
  ahora: Date;
};

/** La etiqueta corta de una cita en la lista y el color de su texto. */
function etiquetaDeCita(cita: Cita, ahora: Date): { texto: string; clase: string } {
  switch (cita.estado) {
    case "confirmada": {
      const momento = momentoDeCita(cita, ahora);
      if (momento === "en_curso") return { texto: "En curso", clase: estilos.estadoConfirmada };
      return momento === "antes" ? { texto: "Confirmada", clase: estilos.estadoConfirmada } : { texto: "Terminó", clase: estilos.estado };
    }
    case "realizada":
      return { texto: "Realizada", clase: estilos.estado };
    case "cancelada":
      return { texto: "Cancelada", clase: estilos.estadoCancelada };
    case "pendiente_pago":
      // La lista no trae reservas sin pagar; si una llegara, se dice como es.
      return { texto: "Esperando el pago", clase: estilos.estado };
  }
}

/**
 * "Mis citas" (HU-019, criterio 4 y D-24): las citas de la sesión del navegador, sin el enlace del correo. Cada una
 * lleva a su detalle. Sin citas (o sin sesión, que se ve igual) explica cómo abrir una agendada desde otro dispositivo.
 */
export function ListaDeCitas({ citas, ahora }: Props) {
  if (citas.length === 0) {
    return (
      <Pantalla
        eyebrow="Tus monitorías"
        titulo="Mis citas"
        subtitulo="No tienes citas en este navegador. Si agendaste desde otro dispositivo, abre el enlace del correo de confirmación."
      >
        <Link href="/monitores" className={formulario.enlace}>
          Ver monitores
        </Link>
      </Pantalla>
    );
  }

  return (
    <Pantalla eyebrow="Tus monitorías" titulo="Mis citas" subtitulo="Las monitorías que agendaste desde este navegador.">
      <ul className={estilos.lista}>
        {citas.map((cita) => {
          const etiqueta = etiquetaDeCita(cita, ahora);
          return (
            <li key={cita.idMonitoria}>
              <Link href={rutaDeMiCita(cita.idMonitoria)} className={estilos.tarjeta}>
                <span className={estilos.materia}>{cita.nombreMateria}</span>
                <span className={estilos.detalle}>Con {cita.nombreMonitor}</span>
                <span className={estilos.detalle}>
                  <time dateTime={cita.fecha}>{formatearDiaConSemana(cita.fecha)}</time>, {horaCorta(cita.hora)} a{" "}
                  {horaDeFin(cita.hora, cita.duracionMin)}
                </span>
                <span className={etiqueta.clase}>{etiqueta.texto}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Pantalla>
  );
}
