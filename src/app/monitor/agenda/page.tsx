import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import {
  cierreAutomaticoDe,
  finDeSesionDe,
  MENSAJES_DE_FINALIZAR,
  rutaDelDiagnosticoDeLaCita,
  separarAgenda,
  sePuedePonerLugar,
  sePuedeVerDiagnostico,
  textoDeEstado,
  textoDelLugar,
  textoDePago,
  type LugarDeMonitoria,
  type MonitoriaDeAgenda,
} from "@/lib/agenda/reglas";
import { cargarAgenda, cargarLugares } from "@/lib/agenda/servidor";
import { exigirRol } from "@/lib/auth/sesion";
import { TEXTOS } from "@/lib/diagnostico/vista-del-monitor";
import { formatearDiaConSemana, formatearFechaHora } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { cargarParametros, type ParametrosNegocio } from "@/lib/plazos/parametros";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { finalizar } from "./acciones";
import estilos from "./agenda.module.css";
import { FormularioLugar } from "./FormularioLugar";

export const metadata: Metadata = { title: "Mi agenda · Calibra" };

/** Pasadas que se ven antes de "Ver N más". */
const PASADAS_A_LA_VISTA = 10;

/** Lo que se dice al volver de finalizar (`?finalizada=1` o `?no_finalizada=<motivo>`). */
function avisoDeFinalizar(finalizada: unknown, noFinalizada: unknown): { exito: boolean; texto: string } | null {
  if (finalizada === "1") return { exito: true, texto: "Marcaste la monitoría como realizada." };
  if (typeof noFinalizada !== "string") return null;
  const texto = Object.hasOwn(MENSAJES_DE_FINALIZAR, noFinalizada)
    ? MENSAJES_DE_FINALIZAR[noFinalizada as keyof typeof MENSAJES_DE_FINALIZAR]
    : "No pudimos marcar la monitoría como realizada. Intenta de nuevo.";
  return { exito: false, texto };
}

/**
 * HU-021 (RN-17, RN-36, P-24, P-37, D-11, D-12): el monitor ve sus monitorías próximas y pasadas, con quién
 * agendó (solo el nombre) y el estado del pago (sin cifras). Las notificaciones no existen todavía (P-11):
 * la agenda es su forma de enterarse. HU-023 (P-05, D-13 a D-15): arriba, las confirmadas que ya empezaron,
 * para marcarlas como realizadas, con la hora en que se cierran solas (el recordatorio es este). HU-022 (D-54): la tarjeta de una
 * cita cuyo diagnóstico se puede ver lleva el enlace «Ver diagnóstico»; en el resto no hay enlace ni aviso. HU-107 (D-76): la
 * tarjeta de una monitoría vigente lleva su lugar o su enlace y el formulario para ponerlo o cambiarlo.
 */
export default async function MiAgenda({ searchParams }: PageProps<"/monitor/agenda">) {
  await exigirRol("monitor", "/monitor/agenda");
  const { finalizada, no_finalizada } = await searchParams;
  const aviso = avisoDeFinalizar(finalizada, no_finalizada);
  const supabase = await crearClienteServidor();

  let monitorias: MonitoriaDeAgenda[];
  let parametros: ParametrosNegocio;
  let lugares: Map<string, LugarDeMonitoria>;
  try {
    [monitorias, parametros, lugares] = await Promise.all([cargarAgenda(supabase!), cargarParametros(supabase!), cargarLugares(supabase!)]);
  } catch (error) {
    console.error("[agenda] no se pudo cargar la agenda:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow="Panel del monitor" titulo="Mi agenda">
        <p role="alert" className={formulario.error}>
          No pudimos cargar tu agenda. Recarga la página; si sigue igual, avisa al equipo.
        </p>
        <Link href="/monitor" className={formulario.enlace}>
          Volver a mi panel
        </Link>
      </Pantalla>
    );
  }

  // Una sola hora para separar la agenda y para decidir los enlaces: no pueden discrepar dentro de una misma respuesta.
  const ahora = new Date();
  const { porFinalizar, proximas, pasadas } = separarAgenda(monitorias, ahora);
  const pasadasALaVista = pasadas.slice(0, PASADAS_A_LA_VISTA);
  const restoDePasadas = pasadas.slice(PASADAS_A_LA_VISTA);

  return (
    <Pantalla
      eyebrow="Panel del monitor"
      titulo="Mi agenda"
      subtitulo="Tus monitorías con quién agendó y cómo va su pago. El contacto del estudiante no se muestra."
    >
      {aviso && (
        <p role={aviso.exito ? "status" : "alert"} className={aviso.exito ? formulario.exito : formulario.error}>
          {aviso.texto}
        </p>
      )}

      {porFinalizar.length > 0 && (
        <section aria-labelledby="por-finalizar" className={estilos.seccion}>
          <h2 id="por-finalizar" className={estilos.titulo}>
            Por finalizar ({porFinalizar.length})
          </h2>
          <p className={formulario.ayuda}>Márcalas como realizadas cuando termines la sesión. Si no, se cierran solas.</p>
          <ul className={estilos.lista}>
            {porFinalizar.map((m) => (
              <li key={m.idMonitoria} className={estilos.tarjeta}>
                <DatosDeMonitoria monitoria={m} />
                <span className={estilos.dato}>
                  Si no la finalizas, se cierra sola a partir del {formatearFechaHora(cierreAutomaticoDe(m, parametros))}.
                </span>
                <EnlaceDelDiagnostico monitoria={m} ahora={ahora} />
                <LugarDeLaMonitoria monitoria={m} lugares={lugares} ahora={ahora} />
                <form action={finalizar} className={estilos.accion}>
                  <input type="hidden" name="monitoria" value={m.idMonitoria} />
                  {/* El nombre del botón se repite en cada tarjeta: la descripción dice de qué monitoría es. */}
                  <button type="submit" aria-describedby={`cabeza-${m.idMonitoria}`} className={formulario.botonSecundario}>
                    Marcar como realizada
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="proximas" className={estilos.seccion}>
        <h2 id="proximas" className={estilos.titulo}>
          Próximas ({proximas.length})
        </h2>
        {proximas.length === 0 ? (
          <p className={formulario.ayuda}>No tienes monitorías próximas.</p>
        ) : (
          <ListaDeMonitorias monitorias={proximas} lugares={lugares} ahora={ahora} />
        )}
      </section>

      <section aria-labelledby="pasadas" className={estilos.seccion}>
        <h2 id="pasadas" className={estilos.titulo}>
          Pasadas ({pasadas.length})
        </h2>
        {pasadas.length === 0 ? (
          <p className={formulario.ayuda}>Todavía no tienes monitorías pasadas.</p>
        ) : (
          <>
            <ListaDeMonitorias monitorias={pasadasALaVista} lugares={lugares} ahora={ahora} />
            {restoDePasadas.length > 0 && (
              <details className={estilos.mas}>
                <summary className={estilos.resumen}>
                  Ver {restoDePasadas.length === 1 ? "1 monitoría más" : `${restoDePasadas.length} monitorías más`}
                </summary>
                <ListaDeMonitorias monitorias={restoDePasadas} lugares={lugares} ahora={ahora} />
              </details>
            )}
          </>
        )}
      </section>

      <Link href="/monitor" className={formulario.enlace}>
        Volver a mi panel
      </Link>
    </Pantalla>
  );
}

type ConLugares = { lugares: Map<string, LugarDeMonitoria>; ahora: Date };

function ListaDeMonitorias({ monitorias, lugares, ahora }: { monitorias: MonitoriaDeAgenda[] } & ConLugares) {
  return (
    <ul className={estilos.lista}>
      {monitorias.map((m) => (
        <li key={m.idMonitoria} className={estilos.tarjeta}>
          <DatosDeMonitoria monitoria={m} />
          <EnlaceDelDiagnostico monitoria={m} ahora={ahora} />
          <LugarDeLaMonitoria monitoria={m} lugares={lugares} ahora={ahora} />
        </li>
      ))}
    </ul>
  );
}

/**
 * HU-022: «Ver diagnóstico» solo si el estado de la cita lo permite (`sePuedeVerDiagnostico`, el espejo de la función de la base).
 * Es un `a` hijo directo de la tarjeta, no un `span`: las pruebas de la tarjeta cuentan sus `span`. Se repite en cada tarjeta, así que
 * su descripción es el renglón de fecha y hora de la misma tarjeta; el nombre sigue siendo «Ver diagnóstico». Sin enlace no hay aviso
 * que lo explique (D-54).
 */
function EnlaceDelDiagnostico({ monitoria: m, ahora }: { monitoria: MonitoriaDeAgenda; ahora: Date }) {
  if (!sePuedeVerDiagnostico(m.estado, finDeSesionDe(m), ahora)) return null;
  return (
    <Link href={rutaDelDiagnosticoDeLaCita(m.idMonitoria)} aria-describedby={`cabeza-${m.idMonitoria}`} className={formulario.enlace}>
      {TEXTOS.verDiagnostico}
    </Link>
  );
}

/**
 * HU-107 (D-76): en una monitoría vigente, el lugar o el enlace que ya puso el monitor (o que aún falta) y el formulario para
 * ponerlo o cambiarlo. Es un `div` hijo de la tarjeta, no un `span`: las pruebas de la tarjeta cuentan sus `span`.
 */
function LugarDeLaMonitoria({ monitoria: m, lugares, ahora }: { monitoria: MonitoriaDeAgenda } & ConLugares) {
  if (!sePuedePonerLugar(m, ahora)) return null;
  const dato = lugares.get(m.idMonitoria);
  return (
    <div className={estilos.lugar}>
      <p className={estilos.dato}>{textoDelLugar(m.presencial, dato)}</p>
      <FormularioLugar
        idMonitoria={m.idMonitoria}
        presencial={m.presencial}
        valor={(m.presencial ? dato?.lugar : dato?.enlace) ?? null}
        descripcion={`cabeza-${m.idMonitoria}`}
      />
    </div>
  );
}

function DatosDeMonitoria({ monitoria: m }: { monitoria: MonitoriaDeAgenda }) {
  return (
    <>
      <span id={`cabeza-${m.idMonitoria}`} className={estilos.cabeza}>
        <time dateTime={m.fecha}>{formatearDiaConSemana(m.fecha)}</time>, {horaCorta(m.hora)} a {horaDeFin(m.hora, m.duracionMin)}
      </span>
      <span className={estilos.detalle}>
        {m.nombreMateria} · {m.duracionMin} min · {m.presencial ? "Presencial" : "Virtual"}
      </span>
      <span className={estilos.dato}>Agendó: {m.nombreEstudiante}</span>
      <span className={estilos.dato}>
        {textoDeEstado(m)} · {textoDePago(m.estadoPago)}
      </span>
    </>
  );
}
