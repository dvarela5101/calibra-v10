import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import {
  agruparPorMonitor,
  FECHAS_A_LA_VISTA,
  leerCodigoDeMateria,
  rutaDeMonitores,
  SEMANAS_DEL_HORIZONTE,
  type FechaLibre,
  type MonitorConFechas,
} from "@/lib/disponibilidad/reglas";
import { cargarFechasLibres, cargarMaterias, type MateriaDeLaLista } from "@/lib/disponibilidad/servidor";
import { formatearDiaConSemana } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import estilos from "./monitores.module.css";

export const metadata: Metadata = { title: "Monitores certificados · Calibra" };

const EYEBROW = "Monitores certificados";

/**
 * HU-016 (RN-22, RN-30, RN-33, RN-35, D-3, D-4, D-5): los monitores certificados en una materia y sus
 * fechas libres de las próximas semanas. La materia llega en el enlace (`?materia=CODIGO`, desde el
 * diagnóstico o un enlace directo); sin ella, el visitante la elige. Las fechas todavía no se agendan
 * desde aquí: eso llega con HU-017.
 */
export default async function Monitores({ searchParams }: PageProps<"/monitores">) {
  const pedido = (await searchParams).materia;
  const codigo = leerCodigoDeMateria(pedido);
  // El enlace traía una materia (aunque no se pueda leer): si no aparece, se avisa.
  const traiaMateria = [pedido ?? []].flat().some((valor) => valor.trim() !== "");
  const supabase = await crearClienteServidor();

  let materias: MateriaDeLaLista[];
  let fechas: FechaLibre[];
  try {
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    [materias, fechas] = await Promise.all([
      cargarMaterias(supabase),
      codigo ? cargarFechasLibres(supabase, codigo, SEMANAS_DEL_HORIZONTE) : Promise.resolve([]),
    ]);
  } catch (error) {
    console.error("[monitores] no se pudo cargar la lista:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar los monitores">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, inténtalo más tarde.
        </p>
      </Pantalla>
    );
  }

  const elegida = codigo ? materias.find((m) => m.codigo.toLowerCase() === codigo.toLowerCase()) : undefined;
  if (!elegida) return <ElegirMateria materias={materias.filter((m) => m.conCertificados)} noEncontrada={traiaMateria} />;

  const monitores = agruparPorMonitor(fechas);
  return (
    <Pantalla
      eyebrow={EYEBROW}
      titulo={`Monitores de ${elegida.nombre}`}
      subtitulo={
        monitores.length > 0 ? `Estas son sus fechas libres de las próximas ${SEMANAS_DEL_HORIZONTE} semanas, con el precio de cada una.` : undefined
      }
    >
      {!elegida.conCertificados ? (
        <p role="status" className={formulario.ayuda}>
          Todavía no hay monitores certificados en esta materia. Vuelve pronto o elige otra.
        </p>
      ) : monitores.length === 0 ? (
        <p role="status" className={formulario.ayuda}>
          Los monitores de esta materia no tienen fechas libres en las próximas {SEMANAS_DEL_HORIZONTE} semanas. Vuelve en unos días o
          elige otra materia.
        </p>
      ) : (
        <ul className={estilos.monitores}>
          {monitores.map((monitor) => (
            <li key={monitor.idMonitor}>
              <TarjetaDeMonitor monitor={monitor} />
            </li>
          ))}
        </ul>
      )}

      <Link href={rutaDeMonitores()} className={formulario.enlace}>
        Cambiar de materia
      </Link>
    </Pantalla>
  );
}

function ElegirMateria({ materias, noEncontrada }: { materias: MateriaDeLaLista[]; noEncontrada: boolean }) {
  return (
    <Pantalla
      eyebrow={EYEBROW}
      titulo="Elige tu materia"
      subtitulo={`Te mostramos los monitores certificados en ella y sus fechas libres de las próximas ${SEMANAS_DEL_HORIZONTE} semanas.`}
    >
      {noEncontrada && (
        <p role="alert" className={formulario.error}>
          No encontramos esa materia. Elige una de la lista.
        </p>
      )}
      {materias.length === 0 ? (
        <p role="status" className={formulario.ayuda}>
          Todavía no hay monitores certificados. Vuelve pronto.
        </p>
      ) : (
        <ul className={estilos.materias}>
          {materias.map((m) => (
            <li key={m.codigo}>
              <Link href={rutaDeMonitores(m.codigo)} className={estilos.materia}>
                <span className={estilos.nombre}>{m.nombre}</span>
                <span className={estilos.detalle}>{m.codigo}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Pantalla>
  );
}

function TarjetaDeMonitor({ monitor }: { monitor: MonitorConFechas }) {
  const titulo = `monitor-${monitor.idMonitor}`;
  const aLaVista = monitor.fechas.slice(0, FECHAS_A_LA_VISTA);
  const resto = monitor.fechas.slice(FECHAS_A_LA_VISTA);
  return (
    <section aria-labelledby={titulo} className={estilos.tarjeta}>
      <h2 id={titulo} className={estilos.nombre}>
        {monitor.nombre}
      </h2>
      <ListaDeFechas fechas={aLaVista} />
      {resto.length > 0 && (
        <details className={estilos.mas}>
          <summary className={estilos.resumen}>Ver {resto.length === 1 ? "1 fecha más" : `${resto.length} fechas más`}</summary>
          <ListaDeFechas fechas={resto} />
        </details>
      )}
    </section>
  );
}

function ListaDeFechas({ fechas }: { fechas: FechaLibre[] }) {
  return (
    <ul className={estilos.fechas}>
      {fechas.map((f) => (
        <li key={`${f.idFranja}-${f.fecha}`} className={estilos.fecha}>
          <time dateTime={f.fecha} className={estilos.dia}>
            {formatearDiaConSemana(f.fecha)}
          </time>
          <span className={estilos.detalle}>
            {horaCorta(f.hora)} a {horaDeFin(f.hora, f.duracionMin)} ({f.duracionMin} min) · {f.presencial ? "Presencial" : "Virtual"} ·{" "}
            {formatearPesos(f.precio)}
          </span>
        </li>
      ))}
    </ul>
  );
}
