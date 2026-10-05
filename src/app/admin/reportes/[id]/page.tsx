import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { cargarReporte, type ReporteParaResolver } from "@/lib/admin/reportes";
import {
  avisosDeLaPagina,
  consecuenciasDeAceptar,
  consecuenciasDeRechazar,
  MENSAJES_DE_RESOLUCION,
  puedeResolver,
  TEXTOS_DEL_ESTADO,
  TEXTOS_DEL_ESTADO_DE_PAGO,
  TEXTOS_DEL_REEMBOLSO,
} from "@/lib/admin/reportes-reglas";
import { textoDeEstado } from "@/lib/agenda/reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { formatearDia, formatearFechaHora } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { ResolverReporte } from "./ResolverReporte";
import estilos from "./reporte.module.css";

export const metadata: Metadata = { title: "Resolver un reporte · Calibra" };

const EYEBROW = "Reportes de inasistencia";

const TITULOS: Record<ReporteParaResolver["estado"], string> = {
  en_revision: "Resolver el reporte",
  aceptado: "Reporte aceptado",
  rechazado: "Reporte rechazado",
};

/** Los contactos que haya, en una línea: el correo y el teléfono. */
const contactoDe = ({ correo, telefono }: { correo: string | null; telefono: string | null }) =>
  [correo, telefono].filter((dato): dato is string => Boolean(dato)).join(" · ") || "Sin datos de contacto";

/**
 * HU-030: un reporte de inasistencia con los datos que el admin pesa al decidir (RN-62): quién reportó y cómo
 * contactarlo, el monitor y cómo contactarlo (nunca su llave), la monitoría, los pagos con su reembolso y la reseña si
 * existe (D-40). Cualquier admin activo lo ve (las políticas ya lo dejan; supuesto 10); lo acepta o lo rechaza solo el
 * asignado (RN-63), con confirmación y sin vuelta atrás. Un reporte ya decidido dice cómo, cuándo y con qué observaciones.
 * Nunca muestra bruto, comisión ni neto del desembolso.
 */
export default async function ResolverUnReporte({ params, searchParams }: PageProps<"/admin/reportes/[id]">) {
  const { id } = await params;
  const sesion = await exigirRol("admin", `/admin/reportes/${id}`);
  if (!esUuid(id)) notFound();

  const ahora = new Date();
  let reporte: ReporteParaResolver | null;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    reporte = await cargarReporte(supabase, id);
  } catch (error) {
    console.error("[reportes] no se pudo cargar el reporte:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar el reporte">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, avisa al equipo.
        </p>
        <VolverALaBandeja />
      </Pantalla>
    );
  }
  if (!reporte) notFound();

  const m = reporte.monitoria;
  const consulta = await searchParams;
  const avisos = avisosDeLaPagina(consulta, {
    estado: reporte.estado,
    desembolso: reporte.desembolso,
    pagos: reporte.pagos.map((p) => ({ estado: p.estado, tieneReembolso: p.reembolso !== null })),
  });
  const enRevision = reporte.estado === "en_revision";
  const puede = puedeResolver(reporte, sesion.idUsuario);
  const resenas = reporte.pagos.filter((p) => p.resena !== null);

  return (
    <Pantalla
      eyebrow={EYEBROW}
      titulo={TITULOS[reporte.estado]}
      subtitulo={puede ? "Quien agendó dice que el monitor no llegó. Revisa los datos y decide." : undefined}
    >
      {avisos.map((aviso) => (
        <p key={aviso.texto} role={aviso.exito ? "status" : "alert"} className={aviso.exito ? formulario.exito : formulario.error}>
          {aviso.texto}
        </p>
      ))}

      <section aria-labelledby="reporte" className={estilos.seccion}>
        <h2 id="reporte" className={estilos.titulo}>
          Reporte
        </h2>
        <dl className={estilos.datos}>
          <dt className={estilos.dato}>Reportó</dt>
          <dd className={estilos.valor}>{reporte.lead.nombre}</dd>
          <dt className={estilos.dato}>Contacto de quien reportó</dt>
          <dd className={estilos.valor}>{contactoDe(reporte.lead)}</dd>
          <dt className={estilos.dato}>Reportado</dt>
          <dd className={estilos.valor}>
            <time dateTime={reporte.fechaReporte.toISOString()}>{formatearFechaHora(reporte.fechaReporte)}</time>
          </dd>
          <dt className={estilos.dato}>Estado</dt>
          <dd className={estilos.valor}>{TEXTOS_DEL_ESTADO[reporte.estado]}</dd>
          <dt className={estilos.dato}>Asignado a</dt>
          <dd className={estilos.valor}>{reporte.nombreAdmin}</dd>
          {reporte.fechaDecision && (
            <>
              <dt className={estilos.dato}>Decidido</dt>
              <dd className={estilos.valor}>
                <time dateTime={reporte.fechaDecision.toISOString()}>{formatearFechaHora(reporte.fechaDecision)}</time>
              </dd>
            </>
          )}
          {reporte.observaciones && (
            <>
              <dt className={estilos.dato}>Observaciones</dt>
              <dd className={`${estilos.valor} ${estilos.observaciones}`}>{reporte.observaciones}</dd>
            </>
          )}
        </dl>
      </section>

      <section aria-labelledby="monitoria" className={estilos.seccion}>
        <h2 id="monitoria" className={estilos.titulo}>
          Monitoría
        </h2>
        <dl className={estilos.datos}>
          <dt className={estilos.dato}>Materia</dt>
          <dd className={estilos.valor}>{m.nombreMateria}</dd>
          <dt className={estilos.dato}>Monitor</dt>
          <dd className={estilos.valor}>{reporte.monitor.nombre}</dd>
          <dt className={estilos.dato}>Contacto del monitor</dt>
          <dd className={estilos.valor}>{contactoDe(reporte.monitor)}</dd>
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
        {/* Un dato que el admin pesa al decidir. No dice que el monitor la marcó: también la pone el cierre automático
            (HU-023), 24 h después del fin, y no prueba que el monitor llegara. */}
        {m.fechaFinalizacion && (
          <p className={formulario.ayuda}>
            La monitoría quedó realizada el{" "}
            <time dateTime={m.fechaFinalizacion.toISOString()}>{formatearFechaHora(m.fechaFinalizacion)}</time>
            {/* La hora termina en "a. m." o "p. m.": ese punto ya cierra la frase. */}
            {formatearFechaHora(m.fechaFinalizacion).endsWith(".") ? "" : "."}
          </p>
        )}
      </section>

      <section aria-labelledby="pagos" className={estilos.seccion}>
        <h2 id="pagos" className={estilos.titulo}>
          Pagos
        </h2>
        {reporte.pagos.length === 0 ? (
          <p className={formulario.ayuda}>Esta monitoría no tiene pagos.</p>
        ) : (
          <ul className={estilos.pagos}>
            {reporte.pagos.map((pago) => (
              <li key={pago.id} className={estilos.pago}>
                <span className={estilos.valor}>{pago.nombrePagador}</span>
                <span className={estilos.detalle}>
                  {formatearPesos(pago.monto)} · {TEXTOS_DEL_ESTADO_DE_PAGO[pago.estado]}
                </span>
                {/* HU-078: un pago rechazado cuando la sesión ya había empezado sigue por cobrar o asumir. */}
                {pago.caso === "abierto" && <span className={estilos.detalle}>Por cobrar o asumir</span>}
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
      </section>

      {/* D-40 (c): la reseña se conserva y el admin la ve al decidir. */}
      {resenas.length > 0 && (
        <section aria-labelledby="resena" className={estilos.seccion}>
          <h2 id="resena" className={estilos.titulo}>
            Reseña
          </h2>
          {/* Una tarjeta por reseña, como los pagos: el nombre de quien pagó es texto libre de hasta 120 caracteres y, como etiqueta
              de una lista de datos, su columna (`max-content`) se come el ancho y deja la reseña fuera de la pantalla a 390 px. */}
          <ul className={estilos.pagos}>
            {resenas.map((pago) => (
              <ResenaDelPago key={pago.id} pago={pago} />
            ))}
          </ul>
        </section>
      )}

      {!enRevision ? null : !puede ? (
        <p className={formulario.ayuda}>Este reporte lo tiene asignado {reporte.nombreAdmin}: solo esa persona lo resuelve.</p>
      ) : m.grupal ? (
        // Las grupales llegan con HU-045; la base también responde no_individual.
        <p className={formulario.ayuda}>{MENSAJES_DE_RESOLUCION.no_individual}</p>
      ) : (
        <ResolverReporte
          idReporte={reporte.id}
          consecuenciasDeAceptar={consecuenciasDeAceptar({ fechaSesion: m.fecha, desembolso: reporte.desembolso, pagos: reporte.pagos })}
          consecuenciasDeRechazar={consecuenciasDeRechazar({ desembolso: reporte.desembolso, desembolsableDesde: reporte.desembolsableDesde }, ahora)}
        />
      )}

      <VolverALaBandeja />
    </Pantalla>
  );
}

/** La calificación y el comentario de un pago, escapados por React. */
function ResenaDelPago({ pago }: { pago: ReporteParaResolver["pagos"][number] }) {
  if (!pago.resena) return null;
  return (
    <li className={estilos.pago}>
      <span className={estilos.detalle}>{pago.nombrePagador}</span>
      <span className={`${estilos.valor} ${estilos.observaciones}`}>
        {pago.resena.calificacion} de 5{pago.resena.comentario ? `. ${pago.resena.comentario}` : ""}
      </span>
    </li>
  );
}

function VolverALaBandeja() {
  return (
    <Link href="/admin" className={formulario.enlace}>
      Volver a mi bandeja
    </Link>
  );
}
