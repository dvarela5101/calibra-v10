"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useExigirSesionAnonima } from "@/components/captcha/useExigirSesionAnonima";
import formulario from "@/components/formulario.module.css";
import { TEXTO_VERIFICANDO } from "@/lib/captcha/textos";
import { errorDeSeleccion, resolverSeleccion, type EvaluacionParaElegir, type MateriaConEvaluaciones } from "@/lib/diagnostico/pantalla";
import { TEXTOS, avisoDeCambioDeMateria, textoDeTemas } from "@/lib/diagnostico/presentacion";
import type { EnCurso } from "@/lib/diagnostico/reglas";
import { rutaDeMonitores } from "@/lib/disponibilidad/reglas";
import estilos from "./diagnostico.module.css";

/** «¿No ves tu materia? Mira los monitores» (D-53 a): sale con las materias y también cuando no hay ninguna. */
function EnlaceAMonitores() {
  return (
    <p className={estilos.lineaDeMonitores}>
      {`${TEXTOS.noVesTuMateria} `}
      <Link href={rutaDeMonitores()} className={formulario.enlace}>
        {TEXTOS.enlaceAMonitores}
      </Link>
    </p>
  );
}

/** El nombre de una Evaluación y sus temas: así se reconoce cada una, sea una o varias. */
function NombreYTemas({ evaluacion }: { evaluacion: EvaluacionParaElegir }) {
  return (
    <span className={estilos.contenidoDeTarjeta}>
      <span className={estilos.nombreDeTarjeta}>{evaluacion.nombre}</span>
      {evaluacion.temas.length > 0 && <span className={estilos.temas}>{textoDeTemas(evaluacion.temas)}</span>}
    </span>
  );
}

type PropsDeEvaluaciones = {
  evaluaciones: EvaluacionParaElegir[];
  elegida: EvaluacionParaElegir | null;
  alElegir: (id: string) => void;
};

/**
 * Las Evaluaciones de la materia elegida. Con una sola, un bloque ya elegido y sin radio; con varias, una tarjeta con radio por
 * Evaluación. En los dos casos cada una lleva su nombre y sus temas («cada Evaluación se reconoce por su nombre y sus temas»).
 */
export function EvaluacionesDeLaMateria({ evaluaciones, elegida, alElegir }: PropsDeEvaluaciones) {
  if (evaluaciones.length === 0) return null;
  const unica = evaluaciones.length === 1;
  return (
    <div className={estilos.grupo}>
      <p id="grupo-de-evaluaciones" className={formulario.etiqueta}>
        {TEXTOS.grupoDeEvaluaciones}
      </p>
      {unica ? (
        <div role="group" aria-labelledby="grupo-de-evaluaciones" className={estilos.fija}>
          <NombreYTemas evaluacion={evaluaciones[0]} />
        </div>
      ) : (
        <div role="radiogroup" aria-labelledby="grupo-de-evaluaciones" className={estilos.lista}>
          {evaluaciones.map((evaluacion) => (
            <label key={evaluacion.id} className={`${estilos.tarjeta} ${elegida?.id === evaluacion.id ? estilos.elegida : ""}`}>
              <input
                type="radio"
                name="evaluacion"
                value={evaluacion.id}
                checked={elegida?.id === evaluacion.id}
                onChange={() => alElegir(evaluacion.id)}
                className={estilos.radio}
              />
              <NombreYTemas evaluacion={evaluacion} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

type Props = {
  materias: MateriaConEvaluaciones[];
  /** El diagnóstico que sigue en curso, si lo hay: el aviso de que empezar otra Evaluación lo descarta. */
  enCurso: EnCurso | null;
  mensaje: string | null;
  /** Hay una llamada en curso: el botón dice «Empezando…» y queda deshabilitado. */
  pendiente: boolean;
  /** Además de la llamada, ya se está yendo a otra página. */
  ocupado: boolean;
  alEmpezar: (idEvaluacion: string) => void;
};

/**
 * HU-009: elegir la materia y la Evaluación y empezar, sin escribir ningún dato. Lo elegido se guarda como códigos e ids y se
 * valida contra las `materias` que llegan en cada render (`resolverSeleccion`): si la lista cambia (la Evaluación se apagó y la
 * página se refrescó), lo que ya no existe se descarta y no se envía. El envío espera la sesión anónima (HU-058).
 */
export function SelectorDeMateria({ materias, enCurso, mensaje, pendiente, ocupado, alEmpezar }: Props) {
  const sesion = useExigirSesionAnonima();
  const [codigoElegido, setCodigoElegido] = useState<string | null>(null);
  const [idElegido, setIdElegido] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seleccion = resolverSeleccion(materias, codigoElegido, idElegido);
  const { materia, evaluacion } = seleccion;

  function elegirMateria(codigo: string) {
    setCodigoElegido(codigo);
    setIdElegido(null);
    setError(null);
  }

  function elegirEvaluacion(id: string) {
    setIdElegido(id);
    setError(null);
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    // Primero la guardia de la sesión: si frena el envío, vuelve a enviar sola cuando la sesión esté lista.
    if (sesion.alEnviar(evento)) return;
    evento.preventDefault();
    if (ocupado) return;
    const falta = errorDeSeleccion(seleccion);
    if (falta !== null || !evaluacion) {
      setError(falta);
      return;
    }
    setError(null);
    alEmpezar(evaluacion.id);
  }

  const avisoDeEnCurso = enCurso ? avisoDeCambioDeMateria(enCurso.materia.nombre, enCurso.evaluacion.nombre) : null;
  const aviso = error ?? mensaje;

  if (materias.length === 0) {
    return (
      <div className={estilos.seccion}>
        {avisoDeEnCurso && (
          <p role="status" className={estilos.aviso}>
            {avisoDeEnCurso}
          </p>
        )}
        {mensaje && (
          <p role="alert" className={formulario.error}>
            {mensaje}
          </p>
        )}
        <p className={estilos.mensaje}>{TEXTOS.sinMaterias}</p>
        <EnlaceAMonitores />
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className={formulario.formulario} noValidate>
      {avisoDeEnCurso && (
        <p role="status" className={estilos.aviso}>
          {avisoDeEnCurso}
        </p>
      )}

      <div className={estilos.grupo}>
        <p id="grupo-de-materias" className={formulario.etiqueta}>
          {TEXTOS.grupoDeMaterias}
        </p>
        <div role="radiogroup" aria-labelledby="grupo-de-materias" className={estilos.lista}>
          {materias.map((m) => (
            <label key={m.codigo} className={`${estilos.tarjeta} ${materia?.codigo === m.codigo ? estilos.elegida : ""}`}>
              <input
                type="radio"
                name="materia"
                value={m.codigo}
                checked={materia?.codigo === m.codigo}
                onChange={() => elegirMateria(m.codigo)}
                className={estilos.radio}
              />
              <span className={estilos.nombreDeTarjeta}>{m.nombre}</span>
            </label>
          ))}
        </div>
      </div>

      {materia && <EvaluacionesDeLaMateria evaluaciones={materia.evaluaciones} elegida={evaluacion} alElegir={elegirEvaluacion} />}

      {aviso && (
        <p role="alert" className={formulario.error}>
          {aviso}
        </p>
      )}
      {sesion.aviso}

      <button type="submit" className={formulario.boton} disabled={ocupado || sesion.verificando}>
        {sesion.verificando ? TEXTO_VERIFICANDO : pendiente ? TEXTOS.empezando : TEXTOS.empezar}
      </button>

      <EnlaceAMonitores />
    </form>
  );
}
