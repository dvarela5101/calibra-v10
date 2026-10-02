import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { cargarPagoParaRevisar, type PagoParaRevisar } from "@/lib/admin/pagos";
import {
  avisosDeLaPagina,
  ayudaDeObservaciones,
  casoDeRechazo,
  consecuenciasDelRechazo,
  MENSAJES_DE_REVISION,
  pideObservaciones,
} from "@/lib/admin/pagos-reglas";
import { textoDeEstado } from "@/lib/agenda/reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { VIGENCIA_ENLACE_COMPROBANTE_SEG } from "@/lib/comprobantes/reglas";
import { formatearDia, formatearFechaHora } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { RevisionDelPago } from "./RevisionDelPago";
import estilos from "./revision.module.css";

export const metadata: Metadata = { title: "Revisar un pago · Calibra" };

const EYEBROW = "Pagos por revisar";

const TITULOS: Record<PagoParaRevisar["estado"], string> = {
  en_revision: "Revisar el pago",
  aprobado: "Pago aprobado",
  rechazado: "Pago rechazado",
};

/**
 * HU-020: el pago con su comprobante, sus datos y su monitoría (criterio 1). Cualquier admin activo lo ve (las
 * políticas ya lo dejan), pero solo el asignado lo aprueba o lo rechaza (supuesto 1), aunque se le haya vencido la
 * hora: el escalamiento llega con HU-034. El comprobante se firma al abrirlo, no al pintar la página (criterio 6).
 */
export default async function RevisarPago({ params, searchParams }: PageProps<"/admin/pagos/[id]">) {
  const { id } = await params;
  const sesion = await exigirRol("admin", `/admin/pagos/${id}`);
  if (!esUuid(id)) notFound();

  const ahora = new Date();
  let pago: PagoParaRevisar | null;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    pago = await cargarPagoParaRevisar(supabase, id, ahora);
  } catch (error) {
    console.error("[pagos] no se pudo cargar el pago:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar el pago">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, avisa al equipo.
        </p>
        <VolverALaBandeja />
      </Pantalla>
    );
  }
  if (!pago) notFound();

  const avisos = avisosDeLaPagina(await searchParams, pago);
  const m = pago.monitoria;
  const enRevision = pago.estado === "en_revision";
  const asignado = pago.idAdmin === sesion.idUsuario;
  const caso = casoDeRechazo(m.estado, m.inicio, ahora);

  return (
    <Pantalla
      eyebrow={EYEBROW}
      titulo={TITULOS[pago.estado]}
      subtitulo={enRevision && asignado ? "Compara el comprobante con estos datos antes de aprobarlo o rechazarlo." : undefined}
    >
      {avisos.map((aviso) => (
        <p key={aviso.texto} role={aviso.exito ? "status" : "alert"} className={aviso.exito ? formulario.exito : formulario.error}>
          {aviso.texto}
        </p>
      ))}

      <section aria-labelledby="pago" className={estilos.seccion}>
        <h2 id="pago" className={estilos.titulo}>
          Pago
        </h2>
        <dl className={estilos.datos}>
          <dt className={estilos.dato}>Pagador</dt>
          <dd className={estilos.valor}>{pago.nombrePagador}</dd>
          <dt className={estilos.dato}>Contacto</dt>
          <dd className={estilos.valor}>{pago.contacto}</dd>
          <dt className={estilos.dato}>Monto</dt>
          <dd className={estilos.valor}>{formatearPesos(pago.monto)}</dd>
          <dt className={estilos.dato}>Referencia</dt>
          <dd className={estilos.valor}>{pago.referencia ?? "Sin referencia"}</dd>
          <dt className={estilos.dato}>Estado</dt>
          <dd className={estilos.valor}>{enRevision ? "En revisión" : pago.estado === "aprobado" ? "Aprobado" : "Rechazado"}</dd>
          {enRevision ? (
            <>
              <dt className={estilos.dato}>Tiempo para revisarlo</dt>
              <dd className={pago.restante.vencido ? estilos.vencido : estilos.valor}>
                <time dateTime={pago.revisionHasta.toISOString()}>{pago.restante.texto}</time>
              </dd>
            </>
          ) : (
            pago.fechaRevision && (
              <>
                <dt className={estilos.dato}>Revisado</dt>
                <dd className={estilos.valor}>
                  <time dateTime={pago.fechaRevision.toISOString()}>{formatearFechaHora(pago.fechaRevision)}</time>
                </dd>
              </>
            )
          )}
          {pago.observaciones && (
            <>
              <dt className={estilos.dato}>Observaciones</dt>
              <dd className={`${estilos.valor} ${estilos.observaciones}`}>{pago.observaciones}</dd>
            </>
          )}
        </dl>
        {/* Un <a> y no un Link: el enlace firmado se pide al tocarlo, nunca en una precarga. */}
        <a href={`/admin/pagos/${pago.id}/comprobante`} target="_blank" rel="noopener noreferrer" className={formulario.enlace}>
          Ver comprobante
        </a>
        <p className={formulario.ayuda}>
          Se abre en otra pestaña con un enlace que vence a los {VIGENCIA_ENLACE_COMPROBANTE_SEG} segundos. Para volver a verlo,
          ábrelo otra vez desde aquí.
        </p>
      </section>

      <section aria-labelledby="monitoria" className={estilos.seccion}>
        <h2 id="monitoria" className={estilos.titulo}>
          Monitoría
        </h2>
        <dl className={estilos.datos}>
          <dt className={estilos.dato}>Materia</dt>
          <dd className={estilos.valor}>{m.nombreMateria}</dd>
          <dt className={estilos.dato}>Monitor</dt>
          <dd className={estilos.valor}>{m.nombreMonitor}</dd>
          <dt className={estilos.dato}>Fecha</dt>
          <dd className={estilos.valor}>
            <time dateTime={m.fecha}>{formatearDia(m.fecha)}</time>
          </dd>
          <dt className={estilos.dato}>Hora</dt>
          <dd className={estilos.valor}>
            {horaCorta(m.hora)} a {horaDeFin(m.hora, m.duracionMin)}
          </dd>
          <dt className={estilos.dato}>Estado</dt>
          <dd className={estilos.valor}>
            {m.grupal ? "Grupal · " : ""}
            {textoDeEstado({ estado: m.estado, motivoCancelacion: m.motivoCancelacion, reservaVencida: false })}
          </dd>
        </dl>
      </section>

      {enRevision &&
        (!asignado ? (
          <p className={formulario.ayuda}>Este pago está asignado a {pago.nombreAdmin}. Solo esa persona puede aprobarlo o rechazarlo.</p>
        ) : m.grupal ? (
          // Supuesto 8: las grupales llegan con HU-038; la base también responde no_individual.
          <p className={formulario.ayuda}>{MENSAJES_DE_REVISION.no_individual}</p>
        ) : (
          <RevisionDelPago
            idPago={pago.id}
            consecuencias={consecuenciasDelRechazo(caso, { fechaSesion: m.fecha, nombrePagador: pago.nombrePagador, contacto: pago.contacto })}
            observacionesObligatorias={pideObservaciones(caso)}
            ayudaObservaciones={ayudaDeObservaciones(caso)}
          />
        ))}

      <VolverALaBandeja />
    </Pantalla>
  );
}

function VolverALaBandeja() {
  return (
    <Link href="/admin" className={formulario.enlace}>
      Volver a mi bandeja
    </Link>
  );
}
