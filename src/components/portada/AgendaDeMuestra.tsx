"use client";

import { useState } from "react";
import { NivelEscrito } from "@/components/diagnostico/ResultadoDelDiagnostico";
import { etiquetaDeNivelParaElMonitor, textoDeVeces } from "@/lib/diagnostico/vista-del-monitor";
import { AGENDA_DE_MUESTRA, textoDelError } from "@/lib/portada/agenda-de-muestra";
import { Trazo } from "./Trazo";
import estilos from "./portada.module.css";

/**
 * HU-109 (D-78): el hero de la landing de monitores es su agenda. Cada monitoría es un botón con la forma de las opciones de la
 * pregunta de muestra y abre, debajo, el diagnóstico de quien agendó, como lo ve el monitor (HU-022): lo que no domina va
 * encerrado con el trazo. Solo estado local: no lee la base.
 */
export function AgendaDeMuestra() {
  const [elegida, setElegida] = useState(AGENDA_DE_MUESTRA[0].clave);
  const monitoria = AGENDA_DE_MUESTRA.find((m) => m.clave === elegida) ?? AGENDA_DE_MUESTRA[0];

  return (
    <div className={estilos.tarjetaPregunta}>
      <p className={estilos.contexto}>Tu agenda, esta semana</p>
      <h2 className={estilos.enunciado}>Tus próximas monitorías</h2>

      <div role="group" aria-label="Monitorías agendadas" className={estilos.agenda}>
        {AGENDA_DE_MUESTRA.map((m) => {
          const marcada = m.clave === elegida;
          return (
            <button
              key={m.clave}
              type="button"
              aria-pressed={marcada}
              className={`${estilos.opcion} ${estilos.monitoria} ${marcada ? estilos.monitoriaElegida : ""}`}
              onClick={() => setElegida(m.clave)}
            >
              <span className={estilos.cuando}>
                {m.dia}
                <span className={estilos.hora}>{m.hora}</span>
              </span>
              <span>
                <strong className={estilos.fuerte}>{m.estudiante}</strong> · {m.materia}
                <span className={estilos.detalleMonitoria}>{m.detalle}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className={estilos.diagnosticoDeMuestra}>
        <p className={estilos.contexto}>
          Diagnóstico de {monitoria.estudiante} · {monitoria.materia}
        </p>
        <ul className={estilos.habilidadesDeMuestra}>
          {monitoria.habilidades.map((habilidad) => (
            <li key={habilidad.id} className={estilos.habilidadDeMuestra}>
              <span>{habilidad.descripcion}</span>
              {habilidad.nivel === "no_lo_domina" ? (
                // La clave reinicia el trazo al cambiar de monitoría, para que se vuelva a dibujar.
                <span key={monitoria.clave} className={estilos.nivelEncerrado}>
                  <NivelEscrito nivel={habilidad.nivel} etiqueta={etiquetaDeNivelParaElMonitor(habilidad.nivel)} />
                  <Trazo />
                </span>
              ) : (
                <NivelEscrito nivel={habilidad.nivel} etiqueta={etiquetaDeNivelParaElMonitor(habilidad.nivel)} />
              )}
            </li>
          ))}
        </ul>
        <div className={`${estilos.conError} ${estilos.errorDeMuestra}`}>
          <p className={estilos.tituloError}>Error detectado</p>
          <p className={estilos.textoResultado}>{textoDelError(monitoria.error.descripcion)}</p>
          <p className={estilos.notaResultado}>{textoDeVeces(monitoria.error.veces)}</p>
        </div>
      </div>
    </div>
  );
}
