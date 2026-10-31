import type { ReactNode } from "react";
import { TextoDelBanco } from "@/components/contenido/TextoDelBanco";
import type { NivelHabilidad } from "@/lib/diagnostico/motor";
import {
  TEXTOS,
  descripcionDeNiveles,
  descripcionDelPorcentaje,
  etiquetaDeNivel,
  puntajeGlobal,
  queTrabajar,
  textoDeErroresDetectados,
  textoDePorcentaje,
  textoDeTramo,
  textoDeVerErrores,
  tramosDeNiveles,
} from "@/lib/diagnostico/presentacion";
import { TEXTOS as TEXTOS_DEL_MONITOR, etiquetaDeNivelParaElMonitor, textoDeCorrectas } from "@/lib/diagnostico/vista-del-monitor";
import estilos from "./resumen.module.css";

/**
 * El resumen del diagnóstico (HU-110, D-79): lo primero que se ve del resultado, para la persona (HU-009) y para el monitor (HU-022).
 * El porcentaje de acertadas con su barra, las habilidades por nivel en una barra apilada con su leyenda escrita y qué trabajar
 * primero. Las barras no dicen nada que no diga el texto: cada una lleva `role="img"` con la misma frase. Como el resultado, no lee
 * datos ni usa hooks, y sirve en componentes de servidor y de cliente (el mensaje de D-51). Con `listaDeErrores` (HU-112, D-81),
 * la cuenta de errores se abre ahí mismo; el monitor no la pasa porque ve los errores abiertos debajo del resumen.
 */

type Props = {
  aciertos: number;
  respondidas: number;
  /** En el orden guardado, que es el de la materia. */
  habilidades: readonly { descripcion: string; nivel: NivelHabilidad }[];
  /** Cuántos errores se detectaron, confirmados y posibles. */
  errores: number;
  /** Los errores, para abrirlos desde el resumen en un desplegable cerrado (D-81 a); sin ella, la cuenta es solo texto. */
  listaDeErrores?: ReactNode;
  /** Quién mira: cambia las etiquetas de nivel («Lo dominas» o «Lo domina») y el título de qué trabajar. */
  para?: "persona" | "monitor";
  /** Distingue el `id` del título si hay más de un resumen en la página. */
  idBase: string;
  /** El nivel del título de qué trabajar: 3 cuando el resumen va debajo de un `h2`. */
  nivelDeTitulos?: 2 | 3;
  /** La línea secundaria (materia, Evaluación, fecha, cuántas respondió), que cada vista escribe a su manera. */
  children?: ReactNode;
};

export function ResumenDelDiagnostico({
  aciertos,
  respondidas,
  habilidades,
  errores,
  listaDeErrores,
  para = "persona",
  idBase,
  nivelDeTitulos = 2,
  children,
}: Props) {
  const etiqueta = para === "monitor" ? etiquetaDeNivelParaElMonitor : etiquetaDeNivel;
  const tituloDeQueTrabajar = para === "monitor" ? TEXTOS_DEL_MONITOR.queTrabajarEnLaMonitoria : TEXTOS.queTrabajarPrimero;
  const tramos = tramosDeNiveles(habilidades);
  const paraTrabajar = queTrabajar(habilidades);
  const idQueTrabajar = `que-trabajar-${idBase}`;
  const Titulo = nivelDeTitulos === 3 ? "h3" : "h2";

  return (
    <div className={estilos.resumen}>
      <div className={estilos.puntaje}>
        <p className={estilos.porcentaje}>{textoDePorcentaje(aciertos, respondidas)}</p>
        <p className={estilos.correctas}>{textoDeCorrectas(aciertos, respondidas)}</p>
      </div>
      <div role="img" aria-label={descripcionDelPorcentaje(aciertos, respondidas)} className={estilos.barra}>
        <span className={estilos.relleno} style={{ inlineSize: `${puntajeGlobal(aciertos, respondidas)}%` }} />
      </div>

      {tramos.length > 0 && (
        <div className={estilos.niveles}>
          <div role="img" aria-label={descripcionDeNiveles(tramos, etiqueta)} className={estilos.barraDeNiveles}>
            {tramos.map((tramo) => (
              <span key={tramo.nivel} className={`${estilos.tramo} ${estilos[tramo.nivel]}`} style={{ flexGrow: tramo.cantidad }} />
            ))}
          </div>
          <ul className={estilos.leyenda}>
            {tramos.map((tramo) => (
              <li key={tramo.nivel} className={estilos.renglonDeLeyenda}>
                <span aria-hidden="true" className={`${estilos.muestra} ${estilos[tramo.nivel]}`} />
                {textoDeTramo(tramo, etiqueta)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby={idQueTrabajar} className={estilos.queTrabajar}>
        <Titulo id={idQueTrabajar} className={estilos.titulo}>
          {tituloDeQueTrabajar}
        </Titulo>
        {paraTrabajar.length === 0 ? (
          <p className={estilos.nota}>{TEXTOS.sinQueTrabajar}</p>
        ) : (
          <ul className={estilos.habilidades}>
            {paraTrabajar.map((habilidad, posicion) => (
              <li key={posicion} className={estilos.habilidad}>
                <span aria-hidden="true" className={`${estilos.muestra} ${estilos[habilidad.nivel]}`} />
                <span>
                  <TextoDelBanco texto={habilidad.descripcion} /> <span className={estilos.nivel}>{`(${etiqueta(habilidad.nivel)})`}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {listaDeErrores === undefined ? (
          errores > 0 && <p className={estilos.nota}>{textoDeErroresDetectados(errores)}</p>
        ) : errores > 0 ? (
          <details className={estilos.errores}>
            <summary className={estilos.verErrores}>{textoDeVerErrores(errores)}</summary>
            {listaDeErrores}
          </details>
        ) : (
          // D-81 c: sin errores lo dice aquí, porque el detalle del final ya no los trae.
          <p className={estilos.nota}>{TEXTOS.sinErrores}</p>
        )}
      </section>

      {children ? <div className={estilos.pie}>{children}</div> : null}
    </div>
  );
}
