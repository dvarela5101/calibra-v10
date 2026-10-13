import formulario from "@/components/formulario.module.css";
import {
  avisoDeLlave,
  detallesDeTransferencia,
  grupoDe,
  hayMonto,
  rotulosDeMontos,
  TEXTOS,
  textoDeSituacion,
  type DesembolsoDelMonitor,
} from "@/lib/desembolsos/reglas";
import { formatearDiaConSemana } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import estilos from "./desembolsos.module.css";

type Props = {
  desembolso: DesembolsoDelMonitor;
  /** La llave que el monitor tiene hoy; si no es la del desembolso por transferir, la tarjeta lo avisa. */
  llaveActual: string | null;
  /** El correo de Calibra (`identidadDelProveedor().correo`); sin él, el aviso omite la línea de escribir. */
  correo: string | null;
};

/**
 * Un desembolso del monitor (HU-050). Componente de servidor: el módulo que sabe de la comisión no viaja al
 * navegador. Un anulado no muestra montos ni llave (P-28); uno por transferir rotula las tres cifras como estimadas.
 */
export function TarjetaDeDesembolso({ desembolso: d, llaveActual, correo }: Props) {
  const grupo = grupoDe(d.situacion);
  const aviso = avisoDeLlave(d, llaveActual, correo);
  const claseDeSituacion = [estilos.situacion, d.situacion === "transferido" && estilos.transferido, d.situacion === "anulado" && estilos.anulado]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={estilos.tarjeta}>
      <span className={estilos.cabeza}>
        <time dateTime={d.fecha}>{formatearDiaConSemana(d.fecha)}</time>, {horaCorta(d.hora)} a {horaDeFin(d.hora, d.duracionMin)}
      </span>
      <span className={estilos.detalle}>
        {d.nombreMateria} · {d.duracionMin} min
      </span>
      <span className={claseDeSituacion}>{textoDeSituacion(d)}</span>
      {detallesDeTransferencia(d).map((detalle) => (
        <span key={detalle} className={estilos.dato}>
          {detalle}
        </span>
      ))}
      {grupo !== "anulados" && d.montos && <Montos desembolso={d} montos={d.montos} />}
      {grupo === "porTransferir" && hayMonto(d) && <p className={estilos.dato}>{TEXTOS.confirmacion}</p>}
      {aviso && (
        <p className={estilos.dato}>
          {aviso.escribirA ? `${aviso.cambio} ${TEXTOS.siLaLlaveNoSirve} ` : aviso.cambio}
          {aviso.escribirA && (
            <>
              <a href={`mailto:${aviso.escribirA}`} className={formulario.enlaceEnTexto}>
                {aviso.escribirA}
              </a>
              .
            </>
          )}
        </p>
      )}
    </li>
  );
}

/** Las tres cifras en este orden: el total de la monitoría, la comisión de Calibra y lo que se transfiere (D-59 a). */
function Montos({ desembolso: d, montos }: { desembolso: DesembolsoDelMonitor; montos: NonNullable<DesembolsoDelMonitor["montos"]> }) {
  if (!hayMonto(d)) return <span className={estilos.dato}>{TEXTOS.sinMonto}</span>;
  const [rotuloTotal, rotuloComision, rotuloNeto] = rotulosDeMontos(d.situacion);
  const filas = [
    { rotulo: rotuloTotal, valor: montos.bruto, clase: estilos.fila },
    { rotulo: rotuloComision, valor: montos.comision, clase: estilos.fila },
    { rotulo: rotuloNeto, valor: montos.neto, clase: `${estilos.fila} ${estilos.neto}` },
  ];
  return (
    <dl className={estilos.montos}>
      {filas.map(({ rotulo, valor, clase }) => (
        <div key={rotulo} className={clase}>
          <dt className={estilos.rotulo}>{rotulo}</dt>
          <dd className={estilos.valor}>{formatearPesos(valor)}</dd>
        </div>
      ))}
    </dl>
  );
}
