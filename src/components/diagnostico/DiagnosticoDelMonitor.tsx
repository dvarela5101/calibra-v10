import { TextoDelBanco } from "@/components/contenido/TextoDelBanco";
import formulario from "@/components/formulario.module.css";
import {
  agruparHabilidades,
  etiquetaDeNivelParaElMonitor,
  TEXTOS,
  textoDeLasDominadas,
  textoDeRespuestas,
  type HabilidadParaElMonitor,
  type VistaDelMonitor,
} from "@/lib/diagnostico/vista-del-monitor";
import { formatearFechaHora } from "@/lib/fechas";
import estilos from "./diagnostico-del-monitor.module.css";
import { PreguntasDelDiagnostico } from "./PreguntasDelDiagnostico";
import { ErroresDetectados, NivelEscrito, RepasarAntes } from "./ResultadoDelDiagnostico";
import resultado from "./resultado.module.css";
import { ResumenDelDiagnostico } from "./ResumenDelDiagnostico";

/**
 * El diagnóstico de una cita, para el monitor (HU-022). Recibe la vista ya leída y validada en el servidor y no lee datos ni usa
 * hooks. Reutiliza las piezas del resultado de la persona (HU-009: el resumen de HU-110, el nivel escrito, los errores y los
 * prerrequisitos) y trae el orden por nivel y las preguntas. Todo texto del banco pasa por `TextoDelBanco`. Orden: la nota de
 * repetido, el resumen, las habilidades, los errores, los prerrequisitos y las preguntas. Una sola `role="status"` en toda la pantalla: la de
 * «sin diagnóstico» o la de «no autorizó compartir sus respuestas», nunca las dos.
 */

/** Los títulos de sección solo tienen que ser distintos dentro de la página: hay un diagnóstico por pantalla. */
const ID_BASE = "monitor";
const ID_RESUMEN = `resumen-${ID_BASE}`;
const ID_HABILIDADES = `habilidades-${ID_BASE}`;
const ID_ERRORES = `errores-${ID_BASE}`;
const ID_PREGUNTAS = `preguntas-${ID_BASE}`;

function TarjetaDeHabilidad({ habilidad }: { habilidad: HabilidadParaElMonitor }) {
  return (
    <li className={resultado.tarjeta}>
      <p className={resultado.descripcion}>
        <TextoDelBanco texto={habilidad.descripcion} />
      </p>
      <NivelEscrito nivel={habilidad.nivel} etiqueta={etiquetaDeNivelParaElMonitor(habilidad.nivel)} />
      <p className={formulario.ayuda}>{textoDeRespuestas(habilidad)}</p>
    </li>
  );
}

export function DiagnosticoDelMonitor({ vista }: { vista: VistaDelMonitor }) {
  const diagnostico = vista.diagnostico;
  if (diagnostico === null) {
    return (
      <p role="status" className={estilos.mensaje}>
        {TEXTOS.sinDiagnostico}
      </p>
    );
  }

  const { paraMirar, dominadas } = agruparHabilidades(diagnostico.habilidades);
  // Un diagnóstico terminado siempre tiene al menos una respuesta; sin preguntas que mostrar ni mensaje que dar no hay sección.
  const hayQueDecirDeLasPreguntas = diagnostico.preguntas === null || diagnostico.preguntas.length > 0;

  return (
    <div className={estilos.vista}>
      {diagnostico.repetido && <p className={estilos.nota}>{TEXTOS.repetido}</p>}

      <section aria-labelledby={ID_RESUMEN} className={resultado.seccion}>
        <h2 id={ID_RESUMEN} className={resultado.titulo}>
          {TEXTOS.resumen}
        </h2>
        <ResumenDelDiagnostico
          aciertos={diagnostico.aciertos}
          respondidas={diagnostico.respondidas}
          habilidades={diagnostico.habilidades}
          errores={diagnostico.errores.length}
          para="monitor"
          idBase={ID_BASE}
          nivelDeTitulos={3}
        >
          <span className={resultado.materia}>{`${TEXTOS.evaluacion} ${diagnostico.nombreEvaluacion}`}</span>
          <span>
            {`${TEXTOS.fecha} `}
            {/* La hora del negocio, no la del servidor ni la del navegador: un diagnóstico de las 04:30 UTC es del día anterior en Bogotá. */}
            <time dateTime={diagnostico.fechaRealizacion}>{formatearFechaHora(new Date(diagnostico.fechaRealizacion))}</time>
          </span>
        </ResumenDelDiagnostico>
      </section>

      <section aria-labelledby={ID_HABILIDADES} className={resultado.seccion}>
        <h2 id={ID_HABILIDADES} className={resultado.titulo}>
          {TEXTOS.habilidades}
        </h2>
        {paraMirar.length > 0 && (
          <ul className={resultado.lista}>
            {paraMirar.map((habilidad, posicion) => (
              <TarjetaDeHabilidad key={posicion} habilidad={habilidad} />
            ))}
          </ul>
        )}
        {dominadas.length > 0 && (
          <details className={estilos.plegable}>
            <summary className={estilos.resumenDelPlegable}>{textoDeLasDominadas(dominadas.length)}</summary>
            <ul className={resultado.lista}>
              {dominadas.map((habilidad, posicion) => (
                <TarjetaDeHabilidad key={posicion} habilidad={habilidad} />
              ))}
            </ul>
          </details>
        )}
      </section>

      {diagnostico.errores.length === 0 ? (
        // El mensaje del monitor no es el de la persona («No detectamos errores concretos en esta prueba»): no se usa la pieza vacía.
        <section aria-labelledby={ID_ERRORES} className={resultado.seccion}>
          <h2 id={ID_ERRORES} className={resultado.titulo}>
            {TEXTOS.errores}
          </h2>
          <p className={formulario.ayuda}>{TEXTOS.sinErrores}</p>
        </section>
      ) : (
        <ErroresDetectados errores={diagnostico.errores} idBase={ID_BASE} />
      )}

      <RepasarAntes prerrequisitos={diagnostico.prerrequisitos} idBase={ID_BASE} titulo={TEXTOS.prerrequisitos} />

      {hayQueDecirDeLasPreguntas && (
        <section aria-labelledby={ID_PREGUNTAS} className={resultado.seccion}>
          <h2 id={ID_PREGUNTAS} className={resultado.titulo}>
            {TEXTOS.preguntas}
          </h2>
          <PreguntasDelDiagnostico preguntas={diagnostico.preguntas} />
        </section>
      )}
    </div>
  );
}
