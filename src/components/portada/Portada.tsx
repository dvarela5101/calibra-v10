import { NivelEscrito } from "@/components/diagnostico/ResultadoDelDiagnostico";
import { EVENTOS, type UbicacionDelCta } from "@/lib/analitica/eventos";
import { rutaDeDiagnostico } from "@/lib/diagnostico/rutas";
import type { ParametrosNegocio } from "@/lib/plazos/parametros";
import { respuestaDeCancelar, respuestaDeCuenta, textoDelBeneficioDeCancelar } from "@/lib/portada/textos";
import { RUTA_SER_MONITOR } from "@/lib/solicitudes/reglas";
import { EnlaceConEvento } from "./EnlaceConEvento";
import { Beneficio, CabeceraDeLaPortada, Paso, PieDeLaPortada, Pregunta, Problema } from "./piezas";
import { PreguntaDeMuestra } from "./PreguntaDeMuestra";
import estilos from "./portada.module.css";

/**
 * HU-108: la landing de la portada para quien no tiene un diagnóstico terminado (la portada con resultado es HU-011). Sigue
 * el diseño de docs/diseno/2026-10-27-landing.dc.html y las pautas de la clase: una sola acción (empezar el diagnóstico),
 * sin menú, y hero → problema → cómo funciona → beneficios → prueba social → preguntas frecuentes → CTA final.
 *
 * `data-landing` le dice a globals.css que esconda el pie global: este lleva el suyo, con solo el aviso (D-77 b).
 *
 * HU-109 (D-78): en pantallas anchas cada sección se parte en dos (el titular a la izquierda, el contenido a la derecha) dentro
 * del ancho del hero, y después del CTA final una franja lleva a la landing de monitores (D-78 b).
 */
export function Portada({ parametros }: { parametros: ParametrosNegocio | null }) {
  return (
    <div className={estilos.portada} data-landing="">
      <CabeceraDeLaPortada />

      <main>
        <section className={estilos.hero}>
          <div className={estilos.heroInterior}>
            <div className={estilos.propuesta}>
              <h1 className={estilos.titular}>Monitorías de ciclo básico que empiezan por tu error.</h1>
              <p className={estilos.bajada}>
                Un diagnóstico corto encuentra en qué te equivocas exactamente. El monitor certificado de tu materia lo lee antes
                de la sesión, así que no gastas la hora explicando qué no entiendes.
              </p>
              <CtaDelDiagnostico ubicacion="hero" />
            </div>
            <PreguntaDeMuestra />
          </div>
        </section>

        <section className={`${estilos.contenedor} ${estilos.seccion}`} aria-labelledby="problema">
          <div className={estilos.partido}>
            <h2 id="problema" className={estilos.tituloSeccion}>
              Estudiar más horas no arregla un error que no sabes que tienes.
            </h2>
            <div className={estilos.problemas}>
              <Problema titulo="Crees que entendiste hasta que llega el parcial.">
                Los parciales viejos te dicen que fallaste un punto, no qué paso del razonamiento está mal.
              </Problema>
              <Problema titulo="Pedir ayuda da pena, y las monitorías del departamento se llenan.">
                Entonces dejas la duda para después, y después es la semana del parcial.
              </Problema>
              <Problema titulo="El monitor llega sin saber qué explicarte.">
                La primera parte de la sesión se va en encontrar dónde está el problema.
              </Problema>
            </div>
          </div>
        </section>

        <section className={estilos.franjaPasos} aria-labelledby="como-funciona">
          <div className={estilos.contenedor}>
            <h2 id="como-funciona" className={estilos.tituloSeccion}>
              Cómo funciona
            </h2>
            <ol className={estilos.pasos}>
              <Paso numero={1} titulo="Haz el diagnóstico">
                Escoges materia y parcial y respondes preguntas de opción múltiple. Al final ves qué habilidades dominas y qué
                errores aparecieron.
              </Paso>
              <Paso numero={2} titulo="Agenda con un monitor certificado">
                Eliges horario entre los monitores certificados en tu materia y pagas por transferencia.
              </Paso>
              <Paso numero={3} titulo="La sesión empieza por tu error">
                El monitor ya leyó tu diagnóstico y llega con el plan de por dónde empezar.
              </Paso>
            </ol>
          </div>
        </section>

        <section className={`${estilos.contenedor} ${estilos.seccion}`} aria-labelledby="beneficios">
          <div className={`${estilos.partido} ${estilos.partidoAlCentro}`}>
            <div>
              <h2 id="beneficios" className={estilos.tituloSeccion}>
                La hora de monitoría rinde, porque nadie empieza a ciegas.
              </h2>
              <ul className={estilos.beneficios}>
                <Beneficio titulo="Sabes qué repasar aunque no agendes.">
                  El resultado es tuyo: qué habilidades dominas y qué errores cometiste.
                </Beneficio>
                <Beneficio titulo="Tu monitor llega preparado.">Ve lo mismo que tú, con cuántas veces elegiste cada error.</Beneficio>
                <Beneficio titulo="Solo te enseña quien sabe la materia.">
                  Cada monitor está certificado por materia; si no tiene el de la tuya, no aparece.
                </Beneficio>
                <Beneficio titulo="Si se te cruza algo, recuperas tu plata.">{textoDelBeneficioDeCancelar(parametros)}</Beneficio>
              </ul>
            </div>
            <VistaDelMonitor />
          </div>
        </section>

        <section className={`${estilos.contenedor} ${estilos.seccion}`} aria-labelledby="prueba-social">
          <div className={estilos.partido}>
            <h2 id="prueba-social" className={estilos.tituloSeccion}>
              Hecho con los parciales de ciclo básico
            </h2>
            {/* D-77 f: los testimonios aparecen solo con citas reales y con permiso; aún no hay. D-77 d: cifras revisadas a
                mano contra lo activo en producción (el 28-oct-2026, en el banco: 263 preguntas y 445 errores revisados). */}
            <p className={estilos.cifras}>
              El diagnóstico cubre <strong className={estilos.cifra}>8 materias</strong> de ciclo básico, con{" "}
              <strong className={estilos.cifra}>más de 250 preguntas</strong> y{" "}
              <strong className={estilos.cifra}>más de 400 errores típicos</strong> catalogados a partir de parciales de semestres
              anteriores.
            </p>
          </div>
        </section>

        <section className={`${estilos.contenedor} ${estilos.seccion}`} aria-labelledby="preguntas-frecuentes">
          <div className={estilos.partido}>
            <h2 id="preguntas-frecuentes" className={estilos.tituloSeccion}>
              Preguntas frecuentes
            </h2>
            <div className={estilos.faq}>
              <Pregunta titulo="¿Cuánto cuesta?">
                El diagnóstico es gratis. La monitoría se paga por sesión, por transferencia, y cada monitor pone el precio de su
                horario: lo ves antes de agendar.
              </Pregunta>
              <Pregunta titulo="¿Qué pasa con mis datos?">
                Tu resultado solo lo ve el monitor de la monitoría que agendas. El correo o el teléfono te los pedimos al final,
                con tu autorización según la Ley 1581 de 2012, y para ver tu resultado desde otro dispositivo te enviamos un
                enlace.
              </Pregunta>
              <Pregunta titulo="¿Por qué no le pregunto a una IA?">
                Una IA te explica lo que le preguntas. El diagnóstico encuentra lo que no sabías que tenías que preguntar, y
                después te sientas con una persona certificada en tu materia.
              </Pregunta>
              <Pregunta titulo="¿Quiénes son los monitores?">
                Estudiantes que Calibra certifica materia por materia. Un monitor solo aparece en las materias en que tiene el
                certificado.
              </Pregunta>
              <Pregunta titulo="¿Y si tengo que cancelar?">{respuestaDeCancelar(parametros)}</Pregunta>
              <Pregunta titulo="¿Necesito crear una cuenta?">{respuestaDeCuenta(parametros)}</Pregunta>
            </div>
          </div>
        </section>

        <section className={estilos.cierre} aria-labelledby="cierre">
          <div className={estilos.contenedor}>
            <h2 id="cierre" className={estilos.tituloCierre}>
              Averigua qué te falla antes del próximo parcial.
            </h2>
            <CtaDelDiagnostico ubicacion="final" centrado />
          </div>
        </section>

        {/* D-78 b: la otra cara del producto, después del CTA final y con borde, para no competir con el del estudiante. */}
        <section className={estilos.franjaMonitores} aria-label="Para monitores">
          <div className={`${estilos.contenedor} ${estilos.franjaMonitoresInterior}`}>
            <p className={estilos.textoFranja}>
              <strong className={estilos.fuerte}>¿Dominas una materia de ciclo básico?</strong>{" "}
              <span className={estilos.cuerpoFranja}>Enséñala con Calibra: tú pones tus horarios y tu precio.</span>
            </p>
            <EnlaceConEvento href={RUTA_SER_MONITOR} evento={EVENTOS.clicSerMonitor} className={estilos.botonBorde}>
              Quiero ser monitor
            </EnlaceConEvento>
          </div>
        </section>
      </main>

      <PieDeLaPortada />

      <div className={estilos.barraMovil}>
        <EnlaceConEvento
          href={rutaDeDiagnostico()}
          evento={EVENTOS.clicCtaDiagnostico}
          propiedades={{ ubicacion: "barra_movil" }}
          className={estilos.ctaBarra}
        >
          Hacer mi diagnóstico gratis
        </EnlaceConEvento>
      </div>
    </div>
  );
}

function CtaDelDiagnostico({ ubicacion, centrado = false }: { ubicacion: UbicacionDelCta; centrado?: boolean }) {
  return (
    <div className={centrado ? estilos.ctaCentrado : estilos.cta}>
      <EnlaceConEvento
        href={rutaDeDiagnostico()}
        evento={EVENTOS.clicCtaDiagnostico}
        propiedades={{ ubicacion }}
        className={estilos.botonCta}
      >
        Hacer mi diagnóstico gratis
      </EnlaceConEvento>
      <p className={estilos.notaCta}>Sin crear cuenta.</p>
    </div>
  );
}

/** El producto real como visual: lo que recibe el monitor (HU-022), con los niveles escritos como en el resultado. */
function VistaDelMonitor() {
  return (
    <figure className={estilos.figura}>
      <div className={estilos.vista}>
        <div className={estilos.vistaCabecera}>
          <p className={estilos.vistaTitulo}>Diagnóstico de tu estudiante</p>
          <p className={estilos.vistaContexto}>Cálculo Diferencial, parcial 2</p>
        </div>
        <ul className={estilos.vistaHabilidades}>
          <li className={estilos.vistaHabilidad}>
            <span>Derivar potencias, sumas, productos y cocientes</span>
            <NivelEscrito nivel="lo_domina" etiqueta="Lo domina" />
          </li>
          <li className={estilos.vistaHabilidad}>
            <span>Derivar funciones trigonométricas, exponenciales y logarítmicas</span>
            <NivelEscrito nivel="en_proceso" etiqueta="En proceso" />
          </li>
          <li className={estilos.vistaHabilidad}>
            <span>Derivar una composición con la regla de la cadena</span>
            <NivelEscrito nivel="no_lo_domina" etiqueta="No lo domina" />
          </li>
        </ul>
        <div className={estilos.vistaErrores}>
          <p className={estilos.parrafo}>
            <strong className={estilos.prefijoError}>Error detectado:</strong> deriva la función de afuera y olvida multiplicar
            por la derivada de lo que está adentro.
          </p>
          <p className={estilos.vistaVeces}>Lo eligió 2 veces</p>
        </div>
      </div>
      <figcaption className={estilos.leyenda}>Lo que recibe el monitor antes de la sesión.</figcaption>
    </figure>
  );
}
