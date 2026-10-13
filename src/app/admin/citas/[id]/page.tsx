import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { cargarCitaParaAutorizar, type CitaParaAutorizar } from "@/lib/admin/citas";
import {
  ADVERTENCIA_DE_QUIEN_ESCRIBIO,
  aDevolver,
  avisosDeLaPagina,
  consecuenciasDeAutorizar,
  contactoDe,
  MENSAJES_DE_AUTORIZACION,
  TEXTOS_DEL_REGISTRO,
  textoDePagosEnRevision,
  vistaDeLaCita,
  type AutorizacionRegistrada,
  type VistaDeLaCita,
} from "@/lib/admin/citas-reglas";
import { TEXTOS_DEL_ESTADO_DE_PAGO, TEXTOS_DEL_REEMBOLSO } from "@/lib/admin/reportes-reglas";
import { textoDeEstado } from "@/lib/agenda/reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { formatearDia, formatearFechaHora } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import { dentroDePlazo } from "@/lib/plazos/motor";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { AutorizarCancelacion } from "./AutorizarCancelacion";
import estilos from "./cita.module.css";

export const metadata: Metadata = { title: "Autorizar una cancelación · Calibra" };

const EYEBROW = "Cancelaciones";

const TITULO_DE_AUTORIZAR = "Autorizar la cancelación";
const TITULO_DE_AUTORIZADA = "Cancelación autorizada";
const TITULO_DE_NO_AUTORIZABLE = "No se puede autorizar esta cancelación";

const tituloDe = (vista: VistaDeLaCita) =>
  vista === "autorizar" ? TITULO_DE_AUTORIZAR : vista === "autorizada" ? TITULO_DE_AUTORIZADA : TITULO_DE_NO_AUTORIZABLE;

/**
 * HU-052: una cita con los datos que el admin pesa al autorizar su cancelación fuera de plazo (RN-60, D-60): quién agendó
 * y cómo contactarlo, el monitor (nunca su contacto), los pagos con su reembolso y cuánto se devolvería. Cualquier admin
 * activo la ve (las políticas ya lo dejan) y la autoriza, con confirmación y sin vuelta atrás. Una cita que ya se autorizó
 * dice quién, cuándo, con qué motivo y qué nota; una que no se puede autorizar, por qué. Nunca muestra comisión.
 */
export default async function AutorizarUnaCancelacion({ params, searchParams }: PageProps<"/admin/citas/[id]">) {
  const { id } = await params;
  const sesion = await exigirRol("admin", `/admin/citas/${id}`);
  if (!esUuid(id)) notFound();

  const ahora = new Date();
  let cita: CitaParaAutorizar | null;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    cita = await cargarCitaParaAutorizar(supabase, id);
  } catch (error) {
    console.error("[citas] no se pudo cargar la cita:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar la cita">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, avisa al equipo.
        </p>
        <VolverALaBandeja />
      </Pantalla>
    );
  }
  if (!cita) notFound();

  const consulta = await searchParams;
  const vista = vistaDeLaCita(cita, ahora);
  const avisos = avisosDeLaPagina(
    consulta,
    { autorizacion: cita.autorizacion, pagos: cita.pagos.map((p) => ({ estado: p.estado, tieneReembolso: p.reembolso !== null })) },
    sesion.idUsuario,
  );
  const devolver = aDevolver(cita.pagos);
  // Solo donde es cierto: en los modos que no cancelan nada, aprobar un pago en revisión no genera un reembolso.
  const enRevision = vista === "autorizar" || vista === "autorizada" ? textoDePagosEnRevision(cita.pagos.filter((p) => p.estado === "en_revision").length) : null;
  // El mensaje de un resultado que ya salió arriba como alerta no se repite.
  const mensaje = typeof vista === "object" ? MENSAJES_DE_AUTORIZACION[vista.motivo] : null;
  const mensajeRepetido = mensaje !== null && avisos.some((aviso) => !aviso.exito && aviso.texto === mensaje);

  return (
    <Pantalla eyebrow={EYEBROW} titulo={tituloDe(vista)}>
      {avisos.map((aviso) => (
        <p key={aviso.texto} role={aviso.exito ? "status" : "alert"} className={aviso.exito ? formulario.exito : formulario.error}>
          {aviso.texto}
        </p>
      ))}

      <section aria-labelledby="cita" className={estilos.seccion}>
        <h2 id="cita" className={estilos.titulo}>
          Cita
        </h2>
        <dl className={estilos.datos}>
          <dt className={estilos.dato}>Materia</dt>
          <dd className={estilos.valor}>{cita.nombreMateria}</dd>
          <dt className={estilos.dato}>Fecha</dt>
          <dd className={estilos.valor}>
            <time dateTime={cita.fecha}>{formatearDia(cita.fecha)}</time>
          </dd>
          <dt className={estilos.dato}>Hora</dt>
          <dd className={estilos.valor}>
            {horaCorta(cita.hora)} a {horaDeFin(cita.hora, cita.duracionMin)}
          </dd>
          <dt className={estilos.dato}>Monitor</dt>
          <dd className={estilos.valor}>{cita.nombreMonitor}</dd>
          <dt className={estilos.dato}>Quién agendó</dt>
          <dd className={estilos.valor}>{cita.lead.nombre}</dd>
          <dt className={estilos.dato}>Contacto de quien agendó</dt>
          <dd className={estilos.valor}>{contactoDe(cita.lead)}</dd>
          <dt className={estilos.dato}>Estado</dt>
          <dd className={estilos.valor}>
            {cita.grupal ? "Grupal · " : ""}
            {textoDeEstado({ estado: cita.estado, motivoCancelacion: cita.motivoCancelacion, reservaVencida: false })}
          </dd>
          <dt className={estilos.dato}>Plazo para cancelar</dt>
          <dd className={estilos.valor}>
            {dentroDePlazo(cita.cancelableHasta, ahora) ? "Termina el " : "Terminó el "}
            <time dateTime={cita.cancelableHasta.toISOString()}>{formatearFechaHora(cita.cancelableHasta)}</time>
          </dd>
        </dl>
      </section>

      <section aria-labelledby="pagos" className={estilos.seccion}>
        <h2 id="pagos" className={estilos.titulo}>
          Pagos
        </h2>
        {cita.pagos.length === 0 ? (
          <p className={formulario.ayuda}>Esta monitoría no tiene pagos.</p>
        ) : (
          <ul className={estilos.pagos}>
            {cita.pagos.map((pago) => (
              <li key={pago.id} className={estilos.pago}>
                <span className={estilos.valor}>{pago.nombrePagador}</span>
                <span className={estilos.detalle}>
                  {formatearPesos(pago.monto)} · {TEXTOS_DEL_ESTADO_DE_PAGO[pago.estado]}
                </span>
                {pago.reembolso && (
                  <>
                    <span className={estilos.detalle}>{TEXTOS_DEL_REEMBOLSO[pago.reembolso.estado]}</span>
                    <a href={`/admin/reembolsos/${pago.reembolso.id}`} className={formulario.enlace}>
                      Abrir el reembolso
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {vista === "autorizar" && (
          <p className={estilos.dinero}>
            {devolver.cuantos > 0 ? `Se devolverían ${formatearPesos(devolver.suma)}.` : "No hay pagos aprobados que devolver."}
          </p>
        )}
        {enRevision && <p className={estilos.mensaje}>{enRevision}</p>}
      </section>

      {vista === "autorizar" && (
        <>
          <p className={estilos.advertencia}>{ADVERTENCIA_DE_QUIEN_ESCRIBIO}</p>
          <AutorizarCancelacion idMonitoria={cita.id} consecuencias={consecuenciasDeAutorizar(cita)} />
        </>
      )}
      {vista === "autorizada" && cita.autorizacion && <Autorizacion autorizacion={cita.autorizacion} />}
      {mensaje && !mensajeRepetido && <p className={estilos.mensaje}>{mensaje}</p>}

      <VolverALaBandeja />
    </Pantalla>
  );
}

/** Quién, cuándo, con qué motivo y qué nota: el registro que solo leen los admins. La nota se escapa y conserva sus saltos de línea. */
function Autorizacion({ autorizacion }: { autorizacion: AutorizacionRegistrada }) {
  return (
    <section aria-labelledby="autorizacion" className={estilos.seccion}>
      <h2 id="autorizacion" className={estilos.titulo}>
        Autorización
      </h2>
      <dl className={estilos.datos}>
        <dt className={estilos.dato}>Autorizó</dt>
        <dd className={estilos.valor}>{autorizacion.nombreAdmin}</dd>
        <dt className={estilos.dato}>Cuándo</dt>
        <dd className={estilos.valor}>
          <time dateTime={autorizacion.autorizadaEn.toISOString()}>{formatearFechaHora(autorizacion.autorizadaEn)}</time>
        </dd>
        <dt className={estilos.dato}>Motivo</dt>
        <dd className={estilos.valor}>{TEXTOS_DEL_REGISTRO[autorizacion.categoria]}</dd>
        <dt className={estilos.dato}>Nota</dt>
        <dd className={`${estilos.valor} ${estilos.nota}`}>{autorizacion.nota ?? "Sin nota"}</dd>
      </dl>
    </section>
  );
}

function VolverALaBandeja() {
  return (
    <Link href="/admin" className={formulario.enlace}>
      Volver a mi bandeja
    </Link>
  );
}
