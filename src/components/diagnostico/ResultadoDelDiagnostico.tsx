import Link from "next/link";
import type { ReactNode } from "react";
import { TextoDelBanco } from "@/components/contenido/TextoDelBanco";
import formulario from "@/components/formulario.module.css";
import { rutaDeMonitores } from "@/lib/disponibilidad/reglas";
import type { ResultadoParaMostrar } from "@/lib/diagnostico/mostrar";
import type { NivelHabilidad } from "@/lib/diagnostico/motor";
import {
  TEXTOS,
  cifrasDeHabilidad,
  etiquetaDeNivel,
  ordenarErrores,
  prefijoDeError,
  textoDePuntaje,
  textoDeRespondidas,
  textoDeVerMonitores,
} from "@/lib/diagnostico/presentacion";
import { rutaDeDiagnostico } from "@/lib/diagnostico/rutas";
import { textoDeVeces } from "@/lib/diagnostico/vista-del-monitor";
import { diaDelNegocio, formatearDia } from "@/lib/fechas";
import estilos from "./resultado.module.css";

/**
 * El resultado de un diagnóstico (HU-009). Recibe la proyección ya hecha en el servidor (`ResultadoParaMostrar`) y no lee
 * datos ni usa hooks: sirve desde un componente de servidor (la página del resultado) y de cliente (el mensaje de D-51), y lo
 * reutilizan HU-011 y, con otro encabezado, HU-022. Todo texto del banco (descripciones, títulos de error, detalles y
 * prerrequisitos) pasa por `TextoDelBanco`; el componente no repasa las preguntas una por una.
 */

type NivelDeTitulos = 2 | 3;

/** El título de una sección: h2, o h3 cuando el resultado va debajo de un h2. */
function TituloDeSeccion({ nivel, id, children }: { nivel: NivelDeTitulos; id: string; children: ReactNode }) {
  return nivel === 3 ? (
    <h3 id={id} className={estilos.titulo}>
      {children}
    </h3>
  ) : (
    <h2 id={id} className={estilos.titulo}>
      {children}
    </h2>
  );
}

/**
 * El nivel de una habilidad, escrito: el color del borde solo lo refuerza. `etiqueta` es opcional: la persona ve «Lo dominas» y el
 * monitor (HU-022) «Lo domina»; sin ella, la de la persona.
 */
export function NivelEscrito({ nivel, etiqueta }: { nivel: NivelHabilidad; etiqueta?: string }) {
  return <span className={`${estilos.nivel} ${estilos[nivel]}`}>{etiqueta ?? etiquetaDeNivel(nivel)}</span>;
}

type PropsDeSeccion = {
  /** Distingue los `id` de los títulos si hay más de un resultado en la página. */
  idBase: string;
  nivelDeTitulos?: NivelDeTitulos;
};

/**
 * «Error detectado» o «Posible error», los confirmados primero. Sin errores, dice que no hubo. El monitor (HU-022) agrega `veces`
 * a cada error, y entonces se imprime «Lo eligió N veces»; la persona no lo trae y no lo ve.
 */
export function ErroresDetectados({
  errores,
  idBase,
  nivelDeTitulos = 2,
}: PropsDeSeccion & { errores: (ResultadoParaMostrar["errores"][number] & { veces?: number })[] }) {
  const idTitulo = `errores-${idBase}`;
  return (
    <section aria-labelledby={idTitulo} className={estilos.seccion}>
      <TituloDeSeccion nivel={nivelDeTitulos} id={idTitulo}>
        {TEXTOS.errores}
      </TituloDeSeccion>
      {errores.length === 0 ? (
        <p className={formulario.ayuda}>{TEXTOS.sinErrores}</p>
      ) : (
        <ul className={estilos.lista}>
          {ordenarErrores(errores).map((error, posicion) => (
            <li key={posicion} className={estilos.tarjeta}>
              <p className={estilos.textoDelError}>
                <span className={estilos.prefijo}>{prefijoDeError(error.estado)}</span> <TextoDelBanco texto={error.titulo} />
              </p>
              {error.veces !== undefined && <p className={estilos.detalle}>{textoDeVeces(error.veces)}</p>}
              {error.descripcionDeLaHabilidad !== null && (
                <p className={estilos.detalle}>
                  {`${TEXTOS.habilidadDelError} `}
                  <TextoDelBanco texto={error.descripcionDeLaHabilidad} />
                </p>
              )}
              {error.detalles.map((detalle, lugar) => (
                <p key={lugar} className={estilos.detalle}>
                  <TextoDelBanco texto={detalle} />
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Una sola lista, sin repetir y sin separar por habilidad, con la otra materia al final del renglón. Sin prerrequisitos no dibuja
 * nada. `titulo` es opcional: la persona ve «Conviene repasar antes» y el monitor (HU-022) «Prerrequisitos».
 */
export function RepasarAntes({
  prerrequisitos,
  idBase,
  nivelDeTitulos = 2,
  titulo,
}: PropsDeSeccion & { prerrequisitos: ResultadoParaMostrar["prerrequisitos"]; titulo?: string }) {
  if (prerrequisitos.length === 0) return null;
  const idTitulo = `repasar-${idBase}`;
  return (
    <section aria-labelledby={idTitulo} className={estilos.seccion}>
      <TituloDeSeccion nivel={nivelDeTitulos} id={idTitulo}>
        {titulo ?? TEXTOS.repasarAntes}
      </TituloDeSeccion>
      <ul className={estilos.lista}>
        {prerrequisitos.map((prerrequisito, posicion) => (
          <li key={posicion} className={estilos.tarjeta}>
            <p className={estilos.descripcion}>
              <TextoDelBanco texto={prerrequisito.descripcion} />
              {prerrequisito.materia !== null && ` (${prerrequisito.materia})`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Props = {
  resultado: ResultadoParaMostrar;
  /** `ninguna` en el mensaje de D-51, donde el resultado es de consulta y las salidas son las del mensaje. */
  acciones?: "completas" | "ninguna";
  /** El nivel de los títulos de sección: 3 cuando el resultado va debajo de un `h2`. */
  nivelDeTitulos?: NivelDeTitulos;
  /** El formulario de contacto de HU-010. Sin ranura no se dibuja ningún contenedor. */
  ranura?: ReactNode;
};

export function ResultadoDelDiagnostico({ resultado, acciones = "completas", nivelDeTitulos = 2, ranura }: Props) {
  const idBase = resultado.idDiagnostico;
  const idHabilidades = `habilidades-${idBase}`;
  return (
    <div className={estilos.resultado}>
      <div className={estilos.encabezado}>
        <p className={estilos.materia}>{`${resultado.materia.nombre} · ${resultado.evaluacion.nombre}`}</p>
        <p className={estilos.dato}>
          {`${TEXTOS.fecha} `}
          {/* La hora del negocio, no la del servidor ni la del navegador: un diagnóstico de las 03:30 UTC es del día anterior en Bogotá. */}
          <time dateTime={resultado.fecha}>{formatearDia(diaDelNegocio(new Date(resultado.fecha)))}</time>
        </p>
        <p className={estilos.dato}>{textoDeRespondidas(resultado.respondidas)}</p>
        <p className={estilos.puntaje}>{textoDePuntaje(resultado.aciertos, resultado.respondidas)}</p>
      </div>

      <section aria-labelledby={idHabilidades} className={estilos.seccion}>
        <TituloDeSeccion nivel={nivelDeTitulos} id={idHabilidades}>
          {TEXTOS.habilidades}
        </TituloDeSeccion>
        <ul className={estilos.lista}>
          {resultado.habilidades.map((habilidad, posicion) => {
            const { cifra, sinMedir } = cifrasDeHabilidad(habilidad);
            return (
              <li key={posicion} className={estilos.tarjeta}>
                <p className={estilos.descripcion}>
                  <TextoDelBanco texto={habilidad.descripcion} />
                </p>
                <NivelEscrito nivel={habilidad.nivel} />
                {cifra !== null && <p className={formulario.ayuda}>{cifra}</p>}
                {sinMedir !== null && <p className={formulario.ayuda}>{sinMedir}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <ErroresDetectados errores={resultado.errores} idBase={idBase} nivelDeTitulos={nivelDeTitulos} />
      <RepasarAntes prerrequisitos={resultado.prerrequisitos} idBase={idBase} nivelDeTitulos={nivelDeTitulos} />

      {acciones === "completas" && (
        <div className={estilos.acciones}>
          <Link href={rutaDeMonitores(resultado.materia.codigo)} className={formulario.boton}>
            {textoDeVerMonitores(resultado.materia.nombre)}
          </Link>
          <Link href={rutaDeDiagnostico()} className={formulario.botonSecundario}>
            {TEXTOS.otroDiagnostico}
          </Link>
        </div>
      )}

      {ranura ? <div className={estilos.ranura}>{ranura}</div> : null}
    </div>
  );
}
