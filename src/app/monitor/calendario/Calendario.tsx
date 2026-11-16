import type { CSSProperties } from "react";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import {
  TEXTO_DE_ESTADO,
  etiquetaDeDia,
  hrefDelCalendario,
  marcasDelDia,
  mismoMes,
  nombreAccesibleDelDia,
  nombreCortoDelDia,
  numeroDelDia,
  ocurrenciasPorDia,
  primerDiaDelMes,
  rangoDeHoras,
  rangoDeSemana,
  rejillaDelMes,
  resumenDelDia,
  rutaDeOcurrencia,
  semanaDe,
  sumarDias,
  tituloDelMes,
  type EstadoDeFranja,
  type FranjaDeCalendario,
  type MonitoriaParaCalendario,
  type Ocurrencia,
  type VistaDelCalendario,
} from "@/lib/calendario/reglas";
import { formatearPesos } from "@/lib/moneda";
import estilos from "./calendario.module.css";
import { FormularioNuevaFranja } from "./FormularioNuevaFranja";

const CLASE_DE_ESTADO: Record<EstadoDeFranja, string> = {
  libre: estilos.estadoLibre,
  reservada: estilos.estadoReservada,
  por_pagar: estilos.estadoPorPagar,
};

type Props = {
  vista: VistaDelCalendario;
  /** El día elegido (`AAAA-MM-DD`). */
  dia: string;
  /** Hoy en la zona del negocio. */
  hoy: string;
  /** `null` si las franjas o la agenda no cargaron. */
  datos: { franjas: readonly FranjaDeCalendario[]; monitorias: readonly MonitoriaParaCalendario[] } | null;
};

/**
 * HU-140 (D-94): el calendario de «Inicio». Sin estado de cliente: la vista y el día viven en la dirección (`?vista=`, `?dia=`) y todo
 * es un enlace, así que funciona sin JavaScript. Solo el formulario de agregar es de cliente. Nunca cifras de comisión: el precio de la
 * franja es lo que cobra el monitor.
 */
export function Calendario({ vista, dia, hoy, datos }: Props) {
  if (!datos) {
    return (
      <section aria-labelledby="calendario-titulo" className={estilos.calendario}>
        <h2 id="calendario-titulo" className={estilos.tituloDelCalendario}>
          Tu calendario
        </h2>
        <p role="alert" className={estilos.error}>
          No pudimos cargar tu calendario.
        </p>
      </section>
    );
  }

  const semana = semanaDe(dia);
  const mes = vista === "mes" ? rejillaDelMes(dia) : null;
  const desde = mes ? mes[0][0] : semana[0];
  const hasta = mes ? mes[mes.length - 1][6] : semana[6];
  const ocurrencias = ocurrenciasPorDia(datos.franjas, datos.monitorias, desde, hasta, hoy);
  const delDia = ocurrencias[dia] ?? [];

  // El mes siguiente o anterior arranca en su día 1, salvo que sea el de hoy: ahí se cae en hoy.
  const delMes = (desplazamiento: number) => {
    const primero = primerDiaDelMes(dia, desplazamiento);
    return mismoMes(primero, hoy) ? hoy : primero;
  };
  const anterior = vista === "mes" ? delMes(-1) : sumarDias(dia, -7);
  const siguiente = vista === "mes" ? delMes(1) : sumarDias(dia, 7);
  const unidad = vista === "mes" ? "Mes" : "Semana";

  return (
    <section aria-labelledby="calendario-titulo" className={estilos.calendario}>
      <h2 id="calendario-titulo" className={estilos.tituloDelCalendario}>
        Tu calendario
      </h2>

      <div className={estilos.barra}>
        <div role="group" aria-label="Cambiar de periodo" className={estilos.periodo}>
          <Link href={hrefDelCalendario(vista, anterior)} scroll={false} aria-label={`${unidad} anterior`} className={estilos.flecha}>
            ‹
          </Link>
          <p className={estilos.rango}>{vista === "mes" ? tituloDelMes(dia) : rangoDeSemana(dia)}</p>
          <Link href={hrefDelCalendario(vista, siguiente)} scroll={false} aria-label={`${unidad} siguiente`} className={estilos.flecha}>
            ›
          </Link>
        </div>
        <div className={estilos.accionesBarra}>
          <Link href={hrefDelCalendario(vista, hoy)} scroll={false} className={estilos.enlaceDeBarra}>
            Hoy
          </Link>
          <div role="group" aria-label="Vista del calendario" className={estilos.conmutador}>
            {(["semana", "mes"] as const).map((v) => (
              <Link
                key={v}
                href={hrefDelCalendario(v, dia)}
                scroll={false}
                aria-current={v === vista ? "true" : undefined}
                className={estilos.enlaceDeBarra}
              >
                {v === "semana" ? "Semana" : "Mes"}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className={estilos.cuerpo}>
        <div className={estilos.vista}>
          {mes ? (
            <VistaDelMes semanas={mes} dia={dia} hoy={hoy} vista={vista} ocurrencias={ocurrencias} />
          ) : (
            <>
              <TiraDeLaSemana semana={semana} dia={dia} hoy={hoy} ocurrencias={ocurrencias} />
              <RejillaPorHoras semana={semana} dia={dia} hoy={hoy} ocurrencias={ocurrencias} />
            </>
          )}
        </div>
        <PanelDelDia dia={dia} hoy={hoy} ocurrencias={delDia} />
      </div>
    </section>
  );
}

function Marcas({ ocurrencias }: { ocurrencias: readonly Ocurrencia[] }) {
  const { estados, hayMas } = marcasDelDia(ocurrencias);
  return (
    <span className={estilos.marcas} aria-hidden="true">
      {estados.map((estado, i) => (
        <span key={i} className={`${estilos.marca} ${estado === "libre" ? estilos.marcaLibre : estilos.marcaOcupada}`} />
      ))}
      {hayMas && <span className={estilos.mas}>+</span>}
    </span>
  );
}

type PropsDeVista = { dia: string; hoy: string; ocurrencias: Record<string, Ocurrencia[]> };

/** Hasta 1023 px: los siete días con una marca por franja; el elegido va relleno. */
function TiraDeLaSemana({ semana, dia, hoy, ocurrencias }: PropsDeVista & { semana: string[] }) {
  return (
    <div role="group" aria-label="Días de la semana" className={estilos.tira}>
      {semana.map((fecha) => (
        <Link
          key={fecha}
          href={hrefDelCalendario("semana", fecha)}
          scroll={false}
          aria-label={nombreAccesibleDelDia(fecha, ocurrencias[fecha].length, hoy)}
          aria-current={fecha === dia ? "date" : undefined}
          className={`${estilos.dia} ${fecha === dia ? estilos.elegido : ""} ${fecha === hoy ? estilos.hoy : ""}`}
        >
          <span className={estilos.nombreCorto}>{nombreCortoDelDia(fecha)}</span>
          <span className={estilos.numero}>{numeroDelDia(fecha)}</span>
          <Marcas ocurrencias={ocurrencias[fecha]} />
        </Link>
      ))}
    </div>
  );
}

/** Desde 1024 px: columna de horas y siete días; cada franja es un bloque según su hora y duración, y un enlace que elige ese día. */
function RejillaPorHoras({ semana, dia, hoy, ocurrencias }: PropsDeVista & { semana: string[] }) {
  const { desde, hasta } = rangoDeHoras(semana.flatMap((fecha) => ocurrencias[fecha]));
  const horas = Array.from({ length: hasta - desde }, (_, i) => desde + i);
  return (
    <div role="group" aria-label="Semana por horas" className={estilos.horas}>
      <div className={estilos.cabeceraDeHoras} />
      {semana.map((fecha) => (
        <Link
          key={fecha}
          href={hrefDelCalendario("semana", fecha)}
          scroll={false}
          aria-label={nombreAccesibleDelDia(fecha, ocurrencias[fecha].length, hoy)}
          aria-current={fecha === dia ? "date" : undefined}
          className={`${estilos.dia} ${estilos.cabeceraDia} ${fecha === dia ? estilos.elegido : ""} ${fecha === hoy ? estilos.hoy : ""}`}
        >
          <span className={estilos.nombreCorto}>{nombreCortoDelDia(fecha)}</span>
          <span className={estilos.numero}>{numeroDelDia(fecha)}</span>
        </Link>
      ))}

      <div className={estilos.columnaDeHoras}>
        {horas.map((h) => (
          <span key={h} className={estilos.horaEtiqueta}>
            {h}:00
          </span>
        ))}
      </div>
      {semana.map((fecha) => (
        <div key={fecha} className={`${estilos.columnaDia} ${fecha === dia ? estilos.columnaElegida : ""}`}>
          {horas.map((h) => (
            <div key={h} className={estilos.celdaHora} />
          ))}
          {ocurrencias[fecha].map((o) => {
            const estilo: CSSProperties = {
              insetBlockStart: `calc(var(--hora-px) * ${(o.minutoInicio - desde * 60) / 60})`,
              blockSize: `calc(var(--hora-px) * ${o.duracionMin / 60})`,
            };
            return (
              <Link
                key={o.clave}
                href={hrefDelCalendario("semana", fecha)}
                scroll={false}
                aria-label={`${etiquetaDeDia(fecha)}, de ${o.hora} a ${o.fin}, ${TEXTO_DE_ESTADO[o.estado].toLowerCase()}`}
                className={`${estilos.bloque} ${CLASE_DE_ESTADO[o.estado]}`}
                style={estilo}
              >
                <span className={estilos.bloqueHora}>{o.hora}</span>
                <span>{TEXTO_DE_ESTADO[o.estado]}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const NOMBRES_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** El mes: semanas completas de lunes a domingo; los días de otro mes en gris y el elegido relleno. */
function VistaDelMes({ semanas, dia, hoy, vista, ocurrencias }: PropsDeVista & { semanas: string[][]; vista: VistaDelCalendario }) {
  return (
    <div role="group" aria-label="Días del mes" className={estilos.mes}>
      {NOMBRES_CORTOS.map((nombre) => (
        <span key={nombre} className={estilos.mesNombre}>
          {nombre}
        </span>
      ))}
      {semanas.flat().map((fecha) => (
        <Link
          key={fecha}
          href={hrefDelCalendario(vista, fecha)}
          scroll={false}
          aria-label={nombreAccesibleDelDia(fecha, ocurrencias[fecha].length, hoy)}
          aria-current={fecha === dia ? "date" : undefined}
          className={`${estilos.dia} ${estilos.mesDia} ${mismoMes(fecha, dia) ? "" : estilos.fueraDelMes} ${fecha === dia ? estilos.elegido : ""} ${fecha === hoy ? estilos.hoy : ""}`}
        >
          <span className={estilos.numero}>{numeroDelDia(fecha)}</span>
          <Marcas ocurrencias={ocurrencias[fecha]} />
        </Link>
      ))}
    </div>
  );
}

/** El día elegido: su resumen, sus franjas por hora y, de hoy en adelante, agregar una. */
function PanelDelDia({ dia, hoy, ocurrencias }: { dia: string; hoy: string; ocurrencias: Ocurrencia[] }) {
  return (
    <section aria-labelledby="calendario-dia" className={estilos.panel}>
      <h3 id="calendario-dia" className={estilos.tituloDelDia}>
        {etiquetaDeDia(dia)}
      </h3>
      <p className={estilos.resumen}>{resumenDelDia(ocurrencias)}</p>

      {ocurrencias.length > 0 && (
        <ul aria-label="Franjas del día" className={estilos.franjas}>
          {ocurrencias.map((o) => (
            <li key={o.clave} className={estilos.franja}>
              <div className={estilos.filaDeFranja}>
                <Link href={rutaDeOcurrencia(o)} className={estilos.enlaceDeFranja}>
                  {o.hora} a {o.fin}
                </Link>
                <span className={`${estilos.etiquetaDeEstado} ${CLASE_DE_ESTADO[o.estado]}`}>{TEXTO_DE_ESTADO[o.estado]}</span>
              </div>
              <p className={estilos.detalle}>
                {o.presencial ? "Presencial" : "Virtual"}
                {o.precio !== null && ` · ${formatearPesos(o.precio)}`}
              </p>
              {o.estado !== "libre" && (
                <p className={estilos.detalleSecundario}>
                  Agendó: {o.estudiante}
                  {o.materia && ` · ${o.materia}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {dia >= hoy && (
        <details key={dia} className={estilos.agregar}>
          <summary className={`${formulario.boton} ${estilos.resumenDeAgregar}`}>Agregar una franja este día</summary>
          <FormularioNuevaFranja fecha={dia} />
        </details>
      )}
    </section>
  );
}
