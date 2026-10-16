import { TextoDelBanco } from "@/components/contenido/TextoDelBanco";
import { marcaDeLaPregunta, TEXTOS, type PreguntaDelMonitor } from "@/lib/diagnostico/vista-del-monitor";
import estilos from "./diagnostico-del-monitor.module.css";

/**
 * Las preguntas que respondió el estudiante, para el monitor (HU-022, D-54 c): todas, falladas y acertadas, en el orden en que las
 * respondió. De cada una, el enunciado, las cuatro opciones en el orden en que él las vio, la que eligió, la correcta y la
 * solución si la tiene. No hay hooks: sirve desde un componente de servidor. Nada sale solo en color: «Acertó» o «Falló», «Eligió»
 * y «Correcta» van escritos y el borde solo los refuerza. Todo texto del banco pasa por `TextoDelBanco`; el enunciado y la
 * solución, en un `div`, porque pueden traer un bloque de código y este no cabe en un `h*`, un `p` ni un `label`.
 *
 * `null` es que el Lead de la cita no autorizó compartir las respuestas (D-67): el mensaje, y ninguna pregunta.
 */
export function PreguntasDelDiagnostico({ preguntas }: { preguntas: PreguntaDelMonitor[] | null }) {
  if (preguntas === null) {
    return (
      <p role="status" className={estilos.mensaje}>
        {TEXTOS.noAutorizo}
      </p>
    );
  }
  return (
    <ol className={estilos.preguntas}>
      {preguntas.map((pregunta, posicion) => {
        const acerto = pregunta.letraElegida === pregunta.letraCorrecta;
        return (
          <li key={posicion} className={estilos.pregunta}>
            <h3 className={estilos.encabezadoDePregunta}>
              <span>{`Pregunta ${posicion + 1}`}</span>{" "}
              <span className={`${estilos.marca} ${acerto ? estilos.acerto : estilos.fallo}`}>{marcaDeLaPregunta(pregunta)}</span>
            </h3>
            <div className={estilos.enunciado}>
              <TextoDelBanco texto={pregunta.enunciado} />
            </div>
            <ul className={estilos.opciones}>
              {pregunta.opciones.map((opcion) => {
                const eligio = opcion.letra === pregunta.letraElegida;
                const esLaCorrecta = opcion.letra === pregunta.letraCorrecta;
                return (
                  <li
                    key={opcion.letra}
                    className={`${estilos.opcion} ${eligio ? estilos.elegida : ""} ${esLaCorrecta ? estilos.laCorrecta : ""}`.trim()}
                  >
                    <span className={estilos.letra}>{opcion.letra}</span>
                    <TextoDelBanco texto={opcion.texto} className={estilos.textoDeOpcion} />
                    {(eligio || esLaCorrecta) && (
                      <span className={estilos.marcas}>
                        {eligio && <span className={`${estilos.etiqueta} ${estilos.etiquetaElegida}`}>{TEXTOS.eligio}</span>}
                        {esLaCorrecta && <span className={`${estilos.etiqueta} ${estilos.etiquetaCorrecta}`}>{TEXTOS.correcta}</span>}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {pregunta.solucion !== null && pregunta.solucion.trim() !== "" && (
              <div className={estilos.solucion}>
                <h4 className={estilos.tituloDeSolucion}>{TEXTOS.solucion}</h4>
                <div className={estilos.textoDeSolucion}>
                  <TextoDelBanco texto={pregunta.solucion} />
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
