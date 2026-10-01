import { formatearDiaConSemana } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import estilos from "./agendar.module.css";

export type DatosDeCita = {
  nombreMateria: string;
  nombreMonitor: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  /** `HH:MM:SS`, en la zona del negocio. */
  hora: string;
  duracionMin: number;
  presencial: boolean;
  valor: number;
};

/** Lo que se agenda (HU-017): sin lugar ni enlace antes de la cita confirmada (D-5). */
export function ResumenDeCita({ cita }: { cita: DatosDeCita }) {
  return (
    <dl className={estilos.resumen}>
      <dt className={estilos.dato}>Materia</dt>
      <dd className={estilos.valor}>{cita.nombreMateria}</dd>
      <dt className={estilos.dato}>Monitor</dt>
      <dd className={estilos.valor}>{cita.nombreMonitor}</dd>
      <dt className={estilos.dato}>Fecha</dt>
      <dd className={estilos.valor}>
        <time dateTime={cita.fecha}>{formatearDiaConSemana(cita.fecha)}</time>
      </dd>
      <dt className={estilos.dato}>Hora</dt>
      <dd className={estilos.valor}>
        {horaCorta(cita.hora)} a {horaDeFin(cita.hora, cita.duracionMin)} ({cita.duracionMin} min)
      </dd>
      <dt className={estilos.dato}>Modalidad</dt>
      <dd className={estilos.valor}>{cita.presencial ? "Presencial" : "Virtual"}</dd>
      <dt className={estilos.dato}>Valor</dt>
      <dd className={estilos.valor}>{formatearPesos(cita.valor)}</dd>
    </dl>
  );
}
