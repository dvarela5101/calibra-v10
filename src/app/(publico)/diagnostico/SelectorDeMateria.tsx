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

/** «¿No ves tu materia? Mira los monitores» (D-53 a): desde D-74 c sale solo cuando no hay materias. */
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
 * Las Evaluaciones de la materia elegida: una tarjeta por Evaluación, con su nombre y sus temas («cada Evaluación se reconoce por
 * su nombre y sus temas»). Ninguna viene elegida, ni siquiera la única (D-74 b).
 */
export function EvaluacionesDeLaMateria({ evaluaciones, elegida, alElegir }: PropsDeEvaluaciones) {
  if (evaluaciones.length === 0) return null;
  return (
    <div className={estilos.grupo}>
      <p id="grupo-de-evaluaciones" className={formulario.etiqueta}>
        {TEXTOS.grupoDeEvaluaciones}
      </p>
      <div role="radiogroup" aria-labelledby="grupo-de-evaluaciones" className={estilos.cuadricula}>
        {evaluaciones.map((evaluacion) => (
          <label key={evaluacion.id} className={`${estilos.tarjetaSinRadio} ${elegida?.id === evaluacion.id ? estilos.elegida : ""}`}>
            <input
              type="radio"
              name="evaluacion"
              value={evaluacion.id}
              checked={elegida?.id === evaluacion.id}
              onChange={() => alElegir(evaluacion.id)}
              className={estilos.radioEncima}
            />
            <NombreYTemas evaluacion={evaluacion} />
          </label>
        ))}
      </div>
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
  /** «Volver a mi pregunta», con un diagnóstico en curso: la Evaluación en que va puede ya no estar entre las que se ofrecen. */
  alVolver: () => void;
};

/** La salida del selector que se abrió con un diagnóstico en curso: vuelve a su pregunta sin llamar a nada. */
function VolverAMiPregunta({ ocupado, alVolver }: { ocupado: boolean; alVolver: () => void }) {
  return (
    <button type="button" className={formulario.botonSecundario} onClick={alVolver} disabled={ocupado}>
      {TEXTOS.volverAMiPregunta}
    </button>
  );
}

/**
 * HU-009: elegir la materia y la Evaluación y empezar, sin escribir ningún dato. Lo elegido se guarda como códigos e ids y se
 * valida contra las `materias` que llegan en cada render (`resolverSeleccion`): si la lista cambia (la Evaluación se apagó y la
 * página se refrescó), lo que ya no existe se descarta y no se envía. El envío espera la sesión anónima (HU-058).
 *
 * Con un diagnóstico en curso, además del aviso de que empezar otra Evaluación lo descarta, ofrece volver a su pregunta: elegir
 * la misma Evaluación no basta si esta ya no está entre las activas (D-13), y sin materias no hay nada que elegir.
 */
export function SelectorDeMateria({ materias, enCurso, mensaje, pendiente, ocupado, alEmpezar, alVolver }: Props) {
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
    // Sin materias no hay nada que empezar, así que tampoco se avisa de que empezar otra descarta el diagnóstico en curso: lo que
    // sí hay es una salida, volver a su pregunta (la persona que llegó por «Cambiar de materia» no queda varada).
    return (
      <div className={estilos.seccion}>
        {mensaje && (
          <p role="alert" className={formulario.error}>
            {mensaje}
          </p>
        )}
        <p className={estilos.mensaje}>{TEXTOS.sinMaterias}</p>
        {enCurso && <VolverAMiPregunta ocupado={ocupado} alVolver={alVolver} />}
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
        <div role="radiogroup" aria-labelledby="grupo-de-materias" className={estilos.cuadricula}>
          {materias.map((m) => (
            <label key={m.codigo} className={`${estilos.tarjetaSinRadio} ${materia?.codigo === m.codigo ? estilos.elegida : ""}`}>
              <input
                type="radio"
                name="materia"
                value={m.codigo}
                checked={materia?.codigo === m.codigo}
                onChange={() => elegirMateria(m.codigo)}
                className={estilos.radioEncima}
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

      {/* Sin `disabled`: ese atributo le quita el foco al botón y quien usa el teclado no podría reintentar tras un fallo (ver `.envio`). */}
      <button type="submit" className={`${formulario.boton} ${estilos.envio}`} aria-disabled={ocupado || sesion.verificando || undefined}>
        {sesion.verificando ? TEXTO_VERIFICANDO : pendiente ? TEXTOS.empezando : TEXTOS.empezar}
      </button>
      {/* D-74 c: directo a los monitores, de la materia elegida si ya hay una. */}
      <Link href={rutaDeMonitores(materia?.codigo)} className={`${formulario.botonSecundario} ${estilos.botonAMonitores}`}>
        {TEXTOS.verMonitoresSinPrueba}
      </Link>
      {enCurso && <VolverAMiPregunta ocupado={ocupado} alVolver={alVolver} />}
    </form>
  );
}
