import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotonCopiar } from "@/components/BotonCopiar";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { cargarDesembolso, type DesembolsoParaEjecutar } from "@/lib/admin/desembolsos";
import { avisosDeLaPagina, consecuenciasDeEjecutar, MENSAJES_DE_MOTIVO } from "@/lib/admin/desembolsos-reglas";
import { textoDeEstado } from "@/lib/agenda/reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { diaDelNegocio, formatearDia, formatearFechaHora } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import estilos from "./desembolso.module.css";
import { EjecutarDesembolso } from "./EjecutarDesembolso";

export const metadata: Metadata = { title: "Ejecutar un desembolso · Calibra" };

const EYEBROW = "Desembolsos ejecutables";

const TITULOS: Record<DesembolsoParaEjecutar["estado"], string> = {
  pendiente: "Ejecutar el desembolso",
  desembolsado: "Desembolso registrado",
  anulado: "Desembolso anulado",
};

const ESTADOS: Record<DesembolsoParaEjecutar["estado"], string> = {
  pendiente: "Pendiente",
  desembolsado: "Desembolsado",
  anulado: "Anulado",
};

/**
 * HU-028: el desembolso de una monitoría realizada, para que un admin le transfiera al monitor y lo registre. Todos
 * los admins activos ven los mismos (RN-80). Se muestra el neto, nunca el bruto ni la comisión (supuesto 4). Si se
 * puede ejecutar ahora lo dice la base con su hora (criterios 2 y 3); si no, la página dice por qué y no muestra el
 * formulario. Al registrar, la base lo vuelve a decidir bajo candado.
 */
export default async function EjecutarUnDesembolso({ params, searchParams }: PageProps<"/admin/desembolsos/[id]">) {
  const { id } = await params;
  const sesion = await exigirRol("admin", `/admin/desembolsos/${id}`);
  if (!esUuid(id)) notFound();

  let desembolso: DesembolsoParaEjecutar | null;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    desembolso = await cargarDesembolso(supabase, id);
  } catch (error) {
    console.error("[desembolsos] no se pudo cargar el desembolso:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar el desembolso">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, avisa al equipo.
        </p>
        <VolverALaBandeja />
      </Pantalla>
    );
  }
  if (!desembolso) notFound();

  const e = desembolso.ejecucion;
  const avisos = avisosDeLaPagina(await searchParams, { estado: desembolso.estado, idAdmin: e?.idAdmin ?? null }, sesion.idUsuario);
  const m = desembolso.monitoria;
  // El neto que se transfiere ahora, solo si la base dice que se puede ejecutar (P-29: es el recalculado).
  const netoAhora = desembolso.estado === "pendiente" && desembolso.motivo === null ? desembolso.montoNeto : null;
  // Lo que se dice en vez del formulario. Un anulado lo dice aunque la base haya leído otra cosa un instante antes.
  const motivo = desembolso.estado === "anulado" ? "anulado" : desembolso.estado === "pendiente" ? desembolso.motivo : null;
  const diaDeLaTransferencia = e && diaDelNegocio(e.fecha);

  return (
    <Pantalla
      eyebrow={EYEBROW}
      titulo={TITULOS[desembolso.estado]}
      subtitulo={
        netoAhora !== null ? "Transfiere el monto a la llave del monitor desde la cuenta de Calibra y después registra la referencia y la fecha." : undefined
      }
    >
      {avisos.map((aviso) => (
        <p key={aviso.texto} role={aviso.exito ? "status" : "alert"} className={aviso.exito ? formulario.exito : formulario.error}>
          {aviso.texto}
        </p>
      ))}

      <section aria-labelledby="desembolso" className={estilos.seccion}>
        <h2 id="desembolso" className={estilos.titulo}>
          Desembolso
        </h2>
        <dl className={estilos.datos}>
          <dt className={estilos.dato}>Monitor</dt>
          <dd className={estilos.valor}>{desembolso.nombreMonitor}</dd>
          <dt className={estilos.dato}>Estado</dt>
          <dd className={estilos.valor}>{ESTADOS[desembolso.estado]}</dd>
          {desembolso.estado === "pendiente" && (
            <>
              <dt className={estilos.dato}>Ejecutable</dt>
              <dd className={estilos.valor}>
                Después del <time dateTime={desembolso.desembolsableDesde.toISOString()}>{formatearFechaHora(desembolso.desembolsableDesde)}</time>
              </dd>
            </>
          )}
          {e && desembolso.montoNeto !== null && (
            <>
              <dt className={estilos.dato}>Monto transferido</dt>
              <dd className={estilos.valor}>{formatearPesos(desembolso.montoNeto)}</dd>
            </>
          )}
          {netoAhora === null && (
            <>
              <dt className={estilos.dato}>Llave destino</dt>
              <dd className={`${estilos.valor} ${estilos.llave}`}>{desembolso.llaveDestino}</dd>
            </>
          )}
          {e && diaDeLaTransferencia && (
            <>
              <dt className={estilos.dato}>Referencia</dt>
              <dd className={estilos.valor}>{e.referencia}</dd>
              <dt className={estilos.dato}>Fecha de la transferencia</dt>
              <dd className={estilos.valor}>
                <time dateTime={diaDeLaTransferencia}>{formatearDia(diaDeLaTransferencia)}</time>
              </dd>
              <dt className={estilos.dato}>Registrado por</dt>
              <dd className={estilos.valor}>{e.nombreAdmin}</dd>
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
          <dt className={estilos.dato}>Fecha</dt>
          <dd className={estilos.valor}>
            <time dateTime={m.fecha}>{formatearDia(m.fecha)}</time>
          </dd>
          <dt className={estilos.dato}>Hora</dt>
          <dd className={estilos.valor}>
            {horaCorta(m.hora)} a {horaDeFin(m.hora, m.duracionMin)}
          </dd>
          <dt className={estilos.dato}>Estado</dt>
          <dd className={estilos.valor}>{textoDeEstado({ estado: m.estado, motivoCancelacion: m.motivoCancelacion, reservaVencida: false })}</dd>
        </dl>
      </section>

      {netoAhora !== null ? (
        <section aria-labelledby="transferir" className={estilos.seccion}>
          <h2 id="transferir" className={estilos.titulo}>
            Transferir {formatearPesos(netoAhora)}
          </h2>
          <div className={formulario.campo}>
            <label htmlFor="llave-destino" className={formulario.etiqueta}>
              Llave del monitor
            </label>
            <p id="llave-ayuda" className={formulario.ayuda}>
              La que tenía cuando se realizó la monitoría: si la cambió después, el desembolso va a esta.
            </p>
            <input
              id="llave-destino"
              readOnly
              value={desembolso.llaveDestino}
              aria-describedby="llave-ayuda"
              className={`${formulario.entrada} ${estilos.llave}`}
            />
            <BotonCopiar texto={desembolso.llaveDestino} idCampo="llave-destino" />
          </div>
          <EjecutarDesembolso
            idDesembolso={desembolso.id}
            netoEsperado={netoAhora}
            fechaSesion={m.fecha}
            hoy={diaDelNegocio(new Date())}
            consecuencias={consecuenciasDeEjecutar(formatearPesos(netoAhora), desembolso.llaveDestino)}
          />
        </section>
      ) : (
        motivo && <p className={estilos.motivo}>{MENSAJES_DE_MOTIVO[motivo]}</p>
      )}

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
