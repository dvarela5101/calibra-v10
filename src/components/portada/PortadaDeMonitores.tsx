import Link from "next/link";
import type { ReactNode } from "react";
import { EVENTOS, type UbicacionDelCtaDeMonitor } from "@/lib/analitica/eventos";
import type { ParametrosNegocio } from "@/lib/plazos/parametros";
import {
  respuestaDeCancelarParaMonitor,
  respuestaDeGrupalesParaMonitor,
  respuestaDePagoAlMonitor,
  textoDelBeneficioDeCancelarParaMonitor,
} from "@/lib/portada/textos";
import { ANCLA_DE_LA_SOLICITUD } from "@/lib/solicitudes/reglas";
import { AgendaDeMuestra } from "./AgendaDeMuestra";
import { BarraMovilDeMonitores } from "./BarraMovilDeMonitores";
import { EnlaceConEvento } from "./EnlaceConEvento";
import { Beneficio, CabeceraDeLaPortada, Paso, PieDeLaPortada, Pregunta, Problema } from "./piezas";
import estilos from "./portada.module.css";

type Props = {
  /** Las materias en que se puede certificar, de la base; `null` si no se pudieron leer. */
  materias: string[] | null;
  parametros: ParametrosNegocio | null;
  /** El formulario de HU-062 (o el aviso de que no hay materias), que va al final. */
  solicitud: ReactNode;
};

/**
 * HU-109 (D-78 a): la landing de monitores en `/quiero-ser-monitor`, con la misma estética que la de estudiantes
 * (docs/diseno/2026-10-28-landing-monitores.dc.html). Una sola acción: dejar los datos. Cada «Quiero ser monitor» baja al
 * formulario, que va al final. `data-landing` esconde el pie global: lleva el suyo.
 *
 * No da cifras ni dice la palabra de la comisión (D-78 c, `pruebas/comision-solo-en-desembolsos.test.ts`).
 */
export function PortadaDeMonitores({ materias, parametros, solicitud }: Props) {
  return (
    <div className={estilos.portada} data-landing="">
      <CabeceraDeLaPortada />

      <main>
        <section className={estilos.hero}>
          <div className={estilos.heroInterior}>
            <div className={estilos.propuesta}>
              <h1 className={estilos.titular}>Monitorías de ciclo básico donde ya sabes qué explicar.</h1>
              <p className={estilos.bajada}>
                Antes de la sesión ves el diagnóstico de tu estudiante: qué domina y en qué se equivoca. Calibra te certifica por
                materia, tú pones horarios y precio, y el pago te llega a tu llave.
              </p>
              <CtaDeMonitor ubicacion="hero" />
            </div>
            <AgendaDeMuestra />
          </div>
        </section>

        <section className={`${estilos.contenedor} ${estilos.seccion}`} aria-labelledby="problema">
          <div className={estilos.partido}>
            <h2 id="problema" className={estilos.tituloSeccion}>
              Dar monitorías por tu cuenta es más trabajo que enseñar.
            </h2>
            <div className={estilos.problemas}>
              <Problema titulo="Conseguir estudiantes.">
                Publicar en grupos, responder mensajes y cuadrar horarios uno por uno.
              </Problema>
              <Problema titulo="Cobrar.">Recordar la transferencia y perder la hora cuando alguien cancela a última hora.</Problema>
              <Problema titulo="Adivinar qué no entiende.">
                El estudiante dice «no entiendo nada» y la primera parte de la sesión se va en encontrar el problema.
              </Problema>
            </div>
          </div>
        </section>

        <section className={estilos.franjaPasos} aria-labelledby="como-funciona">
          <div className={estilos.contenedor}>
            <h2 id="como-funciona" className={estilos.tituloSeccion}>
              Cómo llegas a tu primera monitoría
            </h2>
            <ol className={`${estilos.pasos} ${estilos.pasosCuatro}`}>
              <Paso numero={1} titulo="Deja tus datos">
                Y las materias en las que quieres certificarte.
              </Paso>
              <Paso numero={2} titulo="Presenta la evaluación">
                Es presencial, por materia. Te contactamos para agendarla.
              </Paso>
              <Paso numero={3} titulo="Crea tu cuenta">
                Si apruebas, te certificamos y te llega la invitación.
              </Paso>
              <Paso numero={4} titulo="Abre tus horarios">
                Desde ahí los estudiantes de tu materia te pueden agendar.
              </Paso>
            </ol>
          </div>
        </section>

        <section className={`${estilos.contenedor} ${estilos.seccion}`} aria-labelledby="beneficios">
          <div className={`${estilos.partido} ${estilos.partidoAlCentro}`}>
            <div>
              <h2 id="beneficios" className={estilos.tituloSeccion}>
                Tú enseñas. Lo demás lo hace Calibra.
              </h2>
              <ul className={estilos.beneficios}>
                <Beneficio titulo="Tu horario, tu precio.">
                  Cada horario lleva su día, hora, duración y precio, y puede costar más un domingo.
                </Beneficio>
                <Beneficio titulo="Los estudiantes te encuentran.">
                  Apareces en cada materia en que estás certificado, con los temas que marcas como tu fuerte.
                </Beneficio>
                <Beneficio titulo="No persigues pagos.">El estudiante paga antes de la sesión y Calibra revisa el comprobante.</Beneficio>
                <Beneficio titulo="Sin cancelaciones de último minuto.">{textoDelBeneficioDeCancelarParaMonitor(parametros)}</Beneficio>
                <Beneficio titulo="El certificado no vence.">Te certificas una vez por materia.</Beneficio>
              </ul>
            </div>
            <TusHorarios />
          </div>
        </section>

        {materias !== null && materias.length > 0 && (
          <section className={`${estilos.contenedor} ${estilos.seccion}`} aria-labelledby="materias">
            <div className={estilos.partido}>
              <h2 id="materias" className={estilos.tituloSeccion}>
                Materias en las que puedes certificarte
              </h2>
              <p className={estilos.cifras}>
                <ListaDeMaterias materias={materias} />. Te certificas con una evaluación presencial por cada una.
              </p>
            </div>
          </section>
        )}

        <section className={`${estilos.contenedor} ${estilos.seccion}`} aria-labelledby="preguntas-frecuentes">
          <div className={estilos.partido}>
            <h2 id="preguntas-frecuentes" className={estilos.tituloSeccion}>
              Preguntas frecuentes
            </h2>
            <div className={estilos.faq}>
              <Pregunta titulo="¿Cuándo y cómo me pagan?">{respuestaDePagoAlMonitor(parametros)}</Pregunta>
              <Pregunta titulo="¿Calibra se queda con una parte?">
                Sí, Calibra se queda con una parte de cada monitoría. Te mostramos la regla exacta cuando creas tu cuenta, antes de
                abrir tu primer horario.
              </Pregunta>
              <Pregunta titulo="¿Qué pasa si un estudiante cancela?">{respuestaDeCancelarParaMonitor(parametros)}</Pregunta>
              <Pregunta titulo="¿Puedo dar monitorías virtuales?">
                Sí. Cada horario dice si es presencial o virtual, y el enlace o el lugar lo pones en cada monitoría.
              </Pregunta>
              <Pregunta titulo="¿Y las sesiones grupales?">{respuestaDeGrupalesParaMonitor(parametros)}</Pregunta>
              <Pregunta titulo="¿Quién ve el diagnóstico del estudiante?">
                Solo el monitor de la monitoría que el estudiante agendó, y con su autorización.
              </Pregunta>
            </div>
          </div>
        </section>

        <section className={estilos.cierre} aria-labelledby="cierre">
          <div className={estilos.contenedor}>
            <h2 id="cierre" className={estilos.tituloCierre}>
              Tu primera monitoría empieza con una evaluación.
            </h2>
            <CtaDeMonitor ubicacion="final" centrado />
          </div>
        </section>

        <section
          id={ANCLA_DE_LA_SOLICITUD}
          className={`${estilos.contenedor} ${estilos.seccion} ${estilos.solicitud} ${estilos.cierreMonitores}`}
          aria-labelledby="quiero-ser-monitor"
        >
          <div className={estilos.partido}>
            <div>
              <h2 id="quiero-ser-monitor" className={estilos.tituloSeccion}>
                Quiero ser monitor
              </h2>
              <p className={`${estilos.parrafo} ${estilos.bajadaSolicitud}`}>
                Déjanos tus datos y las materias en las que quieres certificarte. Te contactamos para agendar una evaluación
                presencial; si la apruebas, te invitamos a crear tu cuenta de monitor.
              </p>
            </div>
            <div className={estilos.tarjetaSolicitud}>{solicitud}</div>
          </div>
        </section>
      </main>

      <PieDeLaPortada>
        <Link href="/" className={estilos.enlacePie}>
          Soy estudiante
        </Link>
      </PieDeLaPortada>

      <BarraMovilDeMonitores />
    </div>
  );
}

function CtaDeMonitor({ ubicacion, centrado = false }: { ubicacion: UbicacionDelCtaDeMonitor; centrado?: boolean }) {
  return (
    <div className={centrado ? estilos.ctaCentrado : estilos.cta}>
      <EnlaceConEvento
        href={`#${ANCLA_DE_LA_SOLICITUD}`}
        evento={EVENTOS.clicCtaSerMonitor}
        propiedades={{ ubicacion }}
        className={estilos.botonCta}
      >
        Quiero ser monitor
      </EnlaceConEvento>
      <p className={estilos.notaCta}>Dejas tus datos y te contactamos para la evaluación.</p>
    </div>
  );
}

/** «A, B y C», con cada materia en negrita, como las cifras de la prueba social de estudiantes. */
function ListaDeMaterias({ materias }: { materias: string[] }) {
  return materias.map((materia, i) => (
    <span key={materia}>
      {i === 0 ? "" : i === materias.length - 1 ? " y " : ", "}
      <strong className={estilos.cifra}>{materia}</strong>
    </span>
  ));
}

/** La pantalla de horarios del monitor como visual (F2, RN-30). Los precios son de ejemplo y lo dice. */
function TusHorarios() {
  const HORARIOS = [
    { dia: "Martes, 4:00 p. m.", detalle: "60 min · Presencial", precio: "$25.000" },
    { dia: "Miércoles, 6:00 p. m.", detalle: "90 min · Virtual", precio: "$35.000" },
    { dia: "Domingo, 10:00 a. m.", detalle: "60 min · Presencial", precio: "$30.000" },
  ];
  return (
    <figure className={estilos.figura}>
      <div className={estilos.vista}>
        <div className={estilos.vistaCabecera}>
          <p className={estilos.vistaTitulo}>Tus horarios</p>
          <p className={estilos.vistaContexto}>Se repiten cada semana</p>
        </div>
        <ul className={estilos.horarios}>
          {HORARIOS.map((h) => (
            <li key={h.dia} className={estilos.horario}>
              <span>{h.dia}</span>
              <span className={estilos.precio}>{h.precio}</span>
              <span className={estilos.detalleHorario}>{h.detalle}</span>
            </li>
          ))}
        </ul>
        <div className={estilos.vistaErrores}>
          <p className={estilos.parrafo}>El estudiante escoge la materia al agendar, entre las que tienes certificadas.</p>
        </div>
      </div>
      <figcaption className={estilos.leyenda}>Precios de ejemplo: cada monitor pone los suyos.</figcaption>
    </figure>
  );
}
