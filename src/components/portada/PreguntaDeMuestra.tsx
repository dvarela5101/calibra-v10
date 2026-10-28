"use client";

import { useState } from "react";
import { TextoDelBanco } from "@/components/contenido/TextoDelBanco";
import { EVENTOS } from "@/lib/analitica/eventos";
import { rutaDeDiagnostico } from "@/lib/diagnostico/rutas";
import {
  CONTEXTO,
  CORRECTA,
  ENUNCIADO,
  ORDEN,
  resultadoDeMuestra,
  TEXTOS_DE_OPCION,
  type ClaveDeOpcion,
} from "@/lib/portada/pregunta-de-muestra";
import { EnlaceConEvento } from "./EnlaceConEvento";
import { Trazo } from "./Trazo";
import estilos from "./portada.module.css";

/**
 * HU-108: la pregunta de muestra del hero. El visitante elige una opción y ve lo que vería en su diagnóstico: el error que
 * cometió y su habilidad, o que la domina. Solo estado local: no lee la base ni crea la sesión anónima.
 */
export function PreguntaDeMuestra() {
  const [elegida, setElegida] = useState<ClaveDeOpcion | null>(null);
  const resultado = resultadoDeMuestra(elegida);

  return (
    <div className={estilos.tarjetaPregunta}>
      <p className={estilos.contexto}>{CONTEXTO}</p>
      <h2 className={estilos.enunciado}>
        <TextoDelBanco texto={ENUNCIADO} />
      </h2>

      <div role="group" aria-label="Opciones de respuesta" className={estilos.opciones}>
        {ORDEN.map((clave) => {
          const marcada = elegida === clave;
          const estado = !marcada ? "" : clave === CORRECTA ? estilos.opcionCorrecta : estilos.opcionEquivocada;
          return (
            <button
              key={clave}
              type="button"
              aria-pressed={marcada}
              className={`${estilos.opcion} ${estado}`}
              onClick={() => setElegida(clave)}
            >
              <span className={estilos.formula}>
                <TextoDelBanco texto={TEXTOS_DE_OPCION[clave]} />
                {marcada && clave !== CORRECTA && <Trazo />}
              </span>
              {marcada && clave === CORRECTA && (
                <svg className={estilos.marca} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className={estilos.resultado}>
        {resultado.tipo === "sin_elegir" && (
          <p className={estilos.invitacion}>Elige una respuesta. Si te equivocas, Calibra te dice qué error cometiste.</p>
        )}
        {resultado.tipo !== "sin_elegir" && (
          <div className={resultado.tipo === "error" ? estilos.conError : estilos.conAcierto}>
            {resultado.tipo === "error" ? (
              <>
                <p className={estilos.tituloError}>Error detectado</p>
                <p className={estilos.textoResultado}>{resultado.texto}</p>
                <p className={estilos.notaResultado}>
                  Habilidad: {resultado.habilidad}. Esto es lo que tu monitor lee antes de la sesión.
                </p>
              </>
            ) : (
              <>
                <p className={estilos.tituloAcierto}>Lo dominas: {resultado.habilidad}</p>
                <p className={estilos.textoResultado}>
                  En el diagnóstico completo cada habilidad tiene varias preguntas, y cada opción equivocada apunta a un error
                  distinto.
                </p>
              </>
            )}
            <div className={estilos.accionesResultado}>
              <EnlaceConEvento
                href={rutaDeDiagnostico()}
                evento={EVENTOS.clicCtaDiagnostico}
                propiedades={{ ubicacion: "pregunta" }}
                className={estilos.enlaceCta}
              >
                Hacer el diagnóstico completo
              </EnlaceConEvento>
              <button type="button" className={estilos.otraRespuesta} onClick={() => setElegida(null)}>
                Probar otra respuesta
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
