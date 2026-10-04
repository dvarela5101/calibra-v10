import type { ReactNode } from "react";
import formulario from "@/components/formulario.module.css";
import type { Bandeja, PagoPorCobrarOAsumir, PagoPorRevisar, ReembolsoActivo } from "@/lib/admin/bandeja";
import { formatearDia, formatearFechaHora } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";
import { reabrir } from "./acciones";
import estilos from "./bandeja.module.css";

/** Si la lista no muestra todo, lo dice: el contador de arriba cuenta todo. */
function AvisoDeCorte({ mostrados, total }: { mostrados: number; total: number }) {
  if (total <= mostrados) return null;
  return (
    <p className={estilos.ayuda}>
      Se muestran los primeros {mostrados} de {total}.
    </p>
  );
}

function Seccion({
  id,
  titulo,
  total,
  ayuda,
  vacio,
  children,
  despues,
}: {
  id: string;
  titulo: string;
  total: number;
  ayuda: string;
  vacio: string;
  children: ReactNode;
  /** Lo que va al final de la sección aunque su lista esté vacía. */
  despues?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className={estilos.seccion}>
      <h2 id={`${id}-titulo`} className={estilos.tituloSeccion}>
        {titulo} <span className={estilos.cuenta}>({total})</span>
      </h2>
      <p className={estilos.ayuda}>{ayuda}</p>
      {total === 0 ? <p className={estilos.vacio}>{vacio}</p> : children}
      {despues}
    </section>
  );
}

/**
 * HU-020: cada pago abre su revisión. Un <a>, como los contadores: la bandeja no necesita JavaScript. Con
 * `asignadoA` (HU-077) dice de quién es el pago antes del tiempo.
 */
function EnlaceAlPago({ pago, asignadoA }: { pago: PagoPorRevisar; asignadoA?: string }) {
  const tiempo = (
    <span className={pago.restante.vencido ? estilos.vencido : estilos.meta}>
      <time dateTime={pago.revisionHasta.toISOString()}>{pago.restante.texto}</time>
    </span>
  );
  return (
    <a href={`/admin/pagos/${pago.id}`} className={estilos.filaEnlace}>
      <span className={estilos.nombre}>
        {pago.nombrePagador} · {formatearPesos(pago.monto)}
      </span>
      {asignadoA ? (
        <span className={estilos.meta}>
          De {asignadoA} · {tiempo}
        </span>
      ) : (
        tiempo
      )}
    </a>
  );
}

/**
 * HU-077 (supuesto 2): los pagos de otros admins a los que ya se les pasó la hora, después de los propios, con de
 * quién son y desde cuándo están vencidos. Si no hay ninguno, no se muestra nada.
 */
function PagosVencidosDeOtros({ bandeja }: { bandeja: Bandeja }) {
  const total = bandeja.contadores.pagosVencidosDeOtros;
  if (total === 0) return null;
  return (
    <>
      <h3 id="pagos-de-otros-titulo" className={estilos.subtitulo}>
        Vencidos de otros admins <span className={estilos.cuenta}>({total})</span>
      </h3>
      <p className={estilos.ayuda}>
        Al admin asignado se le pasó la hora para revisarlos: ya puedes aprobarlos o rechazarlos tú. El que lleva más tiempo
        vencido va arriba.
      </p>
      <ul aria-labelledby="pagos-de-otros-titulo" className={estilos.lista}>
        {bandeja.pagosVencidosDeOtros.map((pago) => (
          <li key={pago.id}>
            <EnlaceAlPago pago={pago} asignadoA={pago.nombreAdmin} />
          </li>
        ))}
      </ul>
      <AvisoDeCorte mostrados={bandeja.pagosVencidosDeOtros.length} total={total} />
    </>
  );
}

/**
 * HU-078: cada caso P-24 abre la página de su pago, donde se cierra (supuesto 3). Un <a>, como los pagos por revisar:
 * dentro van el pagador, su contacto, el monto, la monitoría y las observaciones del rechazo (criterio 1).
 */
function EnlaceAlCaso({ pago }: { pago: PagoPorCobrarOAsumir }) {
  const m = pago.monitoria;
  return (
    <a href={`/admin/pagos/${pago.id}`} className={estilos.filaEnlace}>
      <span className={estilos.nombre}>
        {pago.nombrePagador} · {formatearPesos(pago.monto)}
      </span>
      <span className={estilos.meta}>{pago.contacto}</span>
      <span className={estilos.meta}>
        {m.nombreMateria} con {m.nombreMonitor} · Sesión del {formatearDia(m.fecha)}
      </span>
      <span className={estilos.meta}>
        Rechazado el <time dateTime={pago.rechazadoEn.toISOString()}>{formatearFechaHora(pago.rechazadoEn)}</time>
      </span>
      {pago.observaciones && <span className={estilos.observaciones}>Observaciones: {pago.observaciones}</span>}
    </a>
  );
}

/** Los reembolsos de un estado: su título con el total real, su lista y su aviso de corte. */
function GrupoDeReembolsos({
  titulo,
  total,
  vacio,
  reembolsos,
}: {
  titulo: string;
  total: number;
  vacio: string;
  reembolsos: ReembolsoActivo[];
}) {
  return (
    <>
      <h3 className={estilos.subtitulo}>
        {titulo} <span className={estilos.cuenta}>({total})</span>
      </h3>
      {reembolsos.length === 0 ? (
        <p className={estilos.vacio}>{vacio}</p>
      ) : (
        <ul className={estilos.lista}>
          {reembolsos.map((reembolso) => (
            <li key={reembolso.id} className={estilos.fila}>
              <span className={estilos.nombre}>{formatearPesos(reembolso.monto)}</span>
              <span className={estilos.meta}>{reembolso.motivo}</span>
            </li>
          ))}
        </ul>
      )}
      <AvisoDeCorte mostrados={reembolsos.length} total={total} />
    </>
  );
}

/**
 * HU-025 (supuesto 4): los reembolsos que se cerraron porque pasó el plazo sin llave, de todos los admins, después de
 * los propios. Cada uno se reabre con su formulario, que funciona sin JavaScript: quien pagó vuelve a tener el plazo
 * completo y le llega de nuevo el enlace. Si no hay ninguno, no se muestra nada.
 */
function ReembolsosCerrados({ bandeja }: { bandeja: Bandeja }) {
  const total = bandeja.contadores.reembolsosCerrados;
  if (total === 0) return null;
  return (
    <>
      <h3 id="reembolsos-cerrados-titulo" className={estilos.subtitulo}>
        Cerrados sin llave <span className={estilos.cuenta}>({total})</span>
      </h3>
      <p className={estilos.ayuda}>
        Pasó el plazo sin que quien pagó enviara su llave. Si te escribe, reabre su caso: vuelve a tener el plazo completo
        y le mandamos de nuevo el enlace. Son los mismos para todos los admins y el que se cerró último va arriba.
      </p>
      <ul aria-labelledby="reembolsos-cerrados-titulo" className={estilos.lista}>
        {bandeja.reembolsosCerrados.map((reembolso) => (
          <li key={reembolso.id} className={estilos.fila}>
            <span id={`cerrado-${reembolso.id}`} className={estilos.nombre}>
              {reembolso.nombrePagador} · {formatearPesos(reembolso.monto)}
            </span>
            <span className={estilos.metaLarga}>{reembolso.contacto}</span>
            <span className={estilos.metaLarga}>{reembolso.motivo}</span>
            <span className={estilos.meta}>
              Se cerró el <time dateTime={reembolso.cerradoEn.toISOString()}>{formatearFechaHora(reembolso.cerradoEn)}</time>
            </span>
            <form action={reabrir} className={estilos.accionDeFila}>
              <input type="hidden" name="reembolso" value={reembolso.id} />
              <button type="submit" aria-describedby={`cerrado-${reembolso.id}`} className={formulario.botonSecundario}>
                Reabrir y reenviar el enlace
              </button>
            </form>
          </li>
        ))}
      </ul>
      <AvisoDeCorte mostrados={bandeja.reembolsosCerrados.length} total={total} />
    </>
  );
}

/**
 * Lo que tiene asignado el admin: contadores arriba y una lista por sección. Sin JavaScript en el navegador: los casos
 * cerrados sin llave se reabren con un formulario común (HU-025).
 */
export function BandejaAdmin({ bandeja }: { bandeja: Bandeja }) {
  const { contadores } = bandeja;

  const resumen = [
    { id: "pagos", rotulo: "Pagos por revisar", cifra: contadores.pagos },
    { id: "por-cobrar", rotulo: "Pagos por cobrar o asumir", cifra: contadores.pagosPorCobrarOAsumir },
    { id: "reembolsos", rotulo: "Reembolsos", cifra: contadores.reembolsos },
    { id: "reportes", rotulo: "Reportes en revisión", cifra: contadores.reportes },
    { id: "desembolsos", rotulo: "Desembolsos ejecutables", cifra: contadores.desembolsos },
    { id: "correos", rotulo: "Correos que no salieron", cifra: contadores.correosSinEnviar },
  ];

  return (
    <div className={estilos.bandeja}>
      <nav aria-label="Resumen de tu bandeja">
        <ul className={estilos.resumen}>
          {resumen.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} className={estilos.tarjetaResumen}>
                <span className={estilos.cifra}>{item.cifra}</span>
                <span className={estilos.rotulo}>{item.rotulo}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Seccion
        id="pagos"
        titulo="Pagos por revisar"
        total={contadores.pagos}
        ayuda="Cada pago tiene un plazo para revisarse: el que vence primero va arriba y en cada fila ves cuánto le queda."
        vacio="No tienes pagos por revisar."
        despues={<PagosVencidosDeOtros bandeja={bandeja} />}
      >
        {/* Con nombre: la lista de otros admins (HU-077) puede ir debajo, en la misma sección. */}
        <ul aria-label="Asignados a ti" className={estilos.lista}>
          {bandeja.pagos.map((pago) => (
            <li key={pago.id}>
              <EnlaceAlPago pago={pago} />
            </li>
          ))}
        </ul>
        <AvisoDeCorte mostrados={bandeja.pagos.length} total={contadores.pagos} />
      </Seccion>

      <Seccion
        id="por-cobrar"
        titulo="Pagos por cobrar o asumir"
        total={contadores.pagosPorCobrarOAsumir}
        ayuda="Pagos rechazados cuando la sesión ya había empezado: la monitoría no se canceló. Abre cada uno y ciérralo como cobrado si el pagador pagó por fuera, o asumido si Calibra no lo cobra; mientras siga abierto, el desembolso de esa monitoría espera. El más antiguo va arriba. Son los mismos para todos los admins."
        vacio="No hay pagos por cobrar ni por asumir."
      >
        <ul className={estilos.lista}>
          {bandeja.pagosPorCobrarOAsumir.map((pago) => (
            <li key={pago.id}>
              <EnlaceAlCaso pago={pago} />
            </li>
          ))}
        </ul>
        <AvisoDeCorte mostrados={bandeja.pagosPorCobrarOAsumir.length} total={contadores.pagosPorCobrarOAsumir} />
      </Seccion>

      <Seccion
        id="reembolsos"
        titulo="Reembolsos"
        total={contadores.reembolsos}
        ayuda="Los que te asignaron y aún no se han devuelto, por estado."
        vacio="No tienes reembolsos por atender."
        despues={<ReembolsosCerrados bandeja={bandeja} />}
      >
        <GrupoDeReembolsos
          titulo="Esperando la llave del pagador"
          total={contadores.reembolsosEsperandoLlave}
          vacio="Ninguno espera una llave."
          reembolsos={bandeja.reembolsos.esperandoLlave}
        />
        <GrupoDeReembolsos
          titulo="Listos para transferir"
          total={contadores.reembolsosPendientes}
          vacio="Ninguno está listo para transferir."
          reembolsos={bandeja.reembolsos.pendientes}
        />
      </Seccion>

      <Seccion
        id="reportes"
        titulo="Reportes en revisión"
        total={contadores.reportes}
        ayuda="Reportes de inasistencia del monitor. No tienen plazo: atiéndelos cuanto antes."
        vacio="No tienes reportes en revisión."
      >
        <ul className={estilos.lista}>
          {bandeja.reportes.map((reporte) => (
            <li key={reporte.id} className={estilos.fila}>
              <span className={estilos.nombre}>
                {reporte.fechaSesion ? `Sesión del ${formatearDia(reporte.fechaSesion)}` : "Sesión sin fecha"}
              </span>
              <span className={estilos.meta}>Reportado el {formatearFechaHora(reporte.fechaReporte)}</span>
            </li>
          ))}
        </ul>
        <AvisoDeCorte mostrados={bandeja.reportes.length} total={contadores.reportes} />
      </Seccion>

      <Seccion
        id="desembolsos"
        titulo="Desembolsos ejecutables"
        total={contadores.desembolsos}
        ayuda="Ya venció la ventana para reportar inasistencia, la monitoría no tiene un reporte en revisión ni aceptado, ni pagos en revisión ni casos por cobrar o asumir abiertos, y tiene algo que transferir. Son los mismos para todos los admins."
        vacio="No hay desembolsos listos para ejecutar."
      >
        <ul className={estilos.lista}>
          {bandeja.desembolsos.map((desembolso) => (
            <li key={desembolso.id}>
              {/* HU-028: cada desembolso abre su ejecución, con un <a> como los pagos. */}
              <a href={`/admin/desembolsos/${desembolso.id}`} className={estilos.filaEnlace}>
                <span className={estilos.nombre}>Transferir {formatearPesos(desembolso.montoNeto)}</span>
                <span className={estilos.meta}>
                  Sesión del {formatearDia(desembolso.fechaSesion)} · ejecutable después del {formatearFechaHora(desembolso.desembolsableDesde)}
                </span>
              </a>
            </li>
          ))}
        </ul>
        <AvisoDeCorte mostrados={bandeja.desembolsos.length} total={contadores.desembolsos} />
      </Seccion>

      <Seccion
        id="correos"
        titulo="Correos que no salieron"
        total={contadores.correosSinEnviar}
        ayuda="Los que fallaron por algo que no se arregla solo, o que se reintentaron sin éxito hasta agotar el plazo. Ya no se reintentan: avísale a la persona por otro medio. Son los mismos para todos los admins."
        vacio="Todos los correos salieron."
      >
        <ul className={estilos.lista}>
          {bandeja.correosSinEnviar.map((correo) => (
            <li key={correo.id} className={estilos.fila}>
              <span className={estilos.nombre}>
                {correo.tipo} · {correo.destinatario}
              </span>
              <span className={estilos.meta}>
                Desde el {formatearFechaHora(correo.creadoEn)}
                {correo.error ? ` · ${correo.error}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <AvisoDeCorte mostrados={bandeja.correosSinEnviar.length} total={contadores.correosSinEnviar} />
      </Seccion>
    </div>
  );
}
