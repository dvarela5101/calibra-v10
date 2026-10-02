import formulario from "@/components/formulario.module.css";
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
  /** Dónde es la presencial (D-5). Solo lo pasa quien muestra una cita confirmada o en curso (HU-019, D-21). */
  lugar?: string | null;
  /** La videollamada de la virtual (D-5). Solo se muestra como enlace si es `https:`. */
  enlace?: string | null;
};

/** Un enlace de videollamada solo se abre si es `https:`: nada de `javascript:`, `data:` ni `http:`. */
export function esEnlaceHttps(enlace: string): boolean {
  try {
    return new URL(enlace).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Lo que se agenda (HU-017): sin lugar ni enlace antes de la cita confirmada (D-5). La cita confirmada (HU-019)
 * agrega, si se los pasan, el lugar de la presencial o el enlace de la virtual.
 */
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
      {cita.lugar && (
        <>
          <dt className={estilos.dato}>Lugar</dt>
          <dd className={estilos.valor}>{cita.lugar}</dd>
        </>
      )}
      {cita.enlace && esEnlaceHttps(cita.enlace) && (
        <>
          <dt className={estilos.dato}>Enlace de la videollamada</dt>
          <dd className={estilos.valor}>
            <a href={cita.enlace} target="_blank" rel="noopener noreferrer" className={formulario.enlace}>
              Abrir la videollamada
            </a>
          </dd>
        </>
      )}
      <dt className={estilos.dato}>Valor</dt>
      <dd className={estilos.valor}>{formatearPesos(cita.valor)}</dd>
    </dl>
  );
}
