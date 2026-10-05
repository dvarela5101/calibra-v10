import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotonCopiar } from "@/components/BotonCopiar";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { cargarReembolso, type ReembolsoParaGestionar } from "@/lib/admin/reembolsos";
import { avisosDeLaPagina, consecuenciasDeRegistrar, type EstadoDeLaVista } from "@/lib/admin/reembolsos-reglas";
import { textoDeEstado } from "@/lib/agenda/reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { diaDelNegocio, formatearDia, formatearFechaHora } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { reenviar } from "./acciones";
import estilos from "./reembolso.module.css";
import { RegistrarTransferencia } from "./RegistrarTransferencia";

export const metadata: Metadata = { title: "Gestionar un reembolso · Calibra" };

const EYEBROW = "Reembolsos";

const TITULOS: Record<EstadoDeLaVista, string> = {
  esperando_llave: "Esperando la llave",
  cerrado: "Caso cerrado sin llave",
  pendiente: "Transferir el reembolso",
  reembolsado: "Reembolso registrado",
};

const ESTADOS: Record<EstadoDeLaVista, string> = {
  esperando_llave: "Esperando la llave",
  cerrado: "Cerrado sin llave",
  pendiente: "Listo para transferir",
  reembolsado: "Reembolsado",
};

/**
 * HU-026: un reembolso, para que el admin lo gestione según su estado. Lo ve cualquier admin activo (la política «admin
 * lee»). Si espera la llave, cualquiera reenvía el enlace (criterio 3); si está pendiente, cualquier admin activo ve la
 * llave de quien pagó y registra la transferencia (HU-082, D-48). Un caso cerrado solo se muestra: reabrirlo sigue en
 * la bandeja (supuesto 11). El estado lo dice la base con su hora; al registrar lo vuelve a decidir bajo candado.
 */
export default async function GestionarUnReembolso({ params, searchParams }: PageProps<"/admin/reembolsos/[id]">) {
  const { id } = await params;
  const sesion = await exigirRol("admin", `/admin/reembolsos/${id}`);
  if (!esUuid(id)) notFound();

  let reembolso: ReembolsoParaGestionar | null;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    reembolso = await cargarReembolso(supabase, id);
  } catch (error) {
    console.error("[reembolsos] no se pudo cargar el reembolso:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar el reembolso">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, avisa al equipo.
        </p>
        <VolverALaBandeja />
      </Pantalla>
    );
  }
  if (!reembolso) notFound();

  const r = reembolso;
  const avisos = avisosDeLaPagina(
    await searchParams,
    { estado: r.estadoVista, idAdminRegistro: r.registradoPor?.id ?? null },
    sesion.idUsuario,
  );
  // La llave la ve cualquier admin activo (quien llega aquí ya lo es) en pendiente, para transferir, y en reembolsado.
  // En los demás estados no se pinta ni se le pasa a un componente de cliente.
  const llaveParaTransferir = r.estadoVista === "pendiente" ? r.llaveDestino : null;
  const llaveTransferida = r.estadoVista === "reembolsado" ? r.llaveDestino : null;
  const t = r.transferencia;
  const diaDeLaTransferencia = t && diaDelNegocio(t.fecha);
  const m = r.monitoria;

  const subtitulos: Record<EstadoDeLaVista, string | undefined> = {
    esperando_llave: "Le pedimos la llave a quien pagó. Cuando la envíe, el reembolso queda listo para transferir.",
    cerrado: "Pasó el plazo sin que quien pagó enviara su llave.",
    pendiente: "Transfiere el monto a la llave de quien pagó desde la cuenta de Calibra y después registra la referencia y la fecha.",
    reembolsado: undefined,
  };

  return (
    <Pantalla eyebrow={EYEBROW} titulo={TITULOS[r.estadoVista]} subtitulo={subtitulos[r.estadoVista]}>
      {avisos.map((aviso) => (
        <p key={aviso.texto} role={aviso.exito ? "status" : "alert"} className={aviso.exito ? formulario.exito : formulario.error}>
          {aviso.texto}
        </p>
      ))}

      <section aria-labelledby="reembolso" className={estilos.seccion}>
        <h2 id="reembolso" className={estilos.titulo}>
          Reembolso
        </h2>
        <dl className={estilos.datos}>
          <dt className={estilos.dato}>Pagador</dt>
          <dd className={estilos.valor}>{r.nombrePagador}</dd>
          <dt className={estilos.dato}>Correo de quien pagó</dt>
          <dd className={estilos.valor}>{r.contacto}</dd>
          <dt className={estilos.dato}>Monto</dt>
          <dd className={estilos.valor}>{formatearPesos(r.monto)}</dd>
          <dt className={estilos.dato}>Motivo</dt>
          <dd className={estilos.valor}>{r.motivo}</dd>
          <dt className={estilos.dato}>Estado</dt>
          <dd className={estilos.valor}>{ESTADOS[r.estadoVista]}</dd>
          {r.estadoVista === "esperando_llave" && (
            <>
              <dt className={estilos.dato}>Plazo para enviar la llave</dt>
              <dd className={estilos.valor}>
                Hasta el <time dateTime={r.venceEn.toISOString()}>{formatearFechaHora(r.venceEn)}</time>
              </dd>
            </>
          )}
          {r.estadoVista === "cerrado" && (
            <>
              <dt className={estilos.dato}>Plazo para enviar la llave</dt>
              <dd className={estilos.valor}>
                Terminó el <time dateTime={r.venceEn.toISOString()}>{formatearFechaHora(r.venceEn)}</time>
              </dd>
              {/* Solo si ya corrió el cierre de pg_cron (cada 15 minutos): antes, vencido, todavía no tiene fecha. */}
              {r.cerradoEn && (
                <>
                  <dt className={estilos.dato}>Cierre</dt>
                  <dd className={estilos.valor}>
                    Se cerró el <time dateTime={r.cerradoEn.toISOString()}>{formatearFechaHora(r.cerradoEn)}</time>
                  </dd>
                </>
              )}
            </>
          )}
          {/* En un reembolsado lo dice «Registrado por» (id_admin_registro), no el asignado. */}
          {r.estadoVista !== "reembolsado" && (
            <>
              <dt className={estilos.dato}>Asignado a</dt>
              <dd className={estilos.valor}>{r.asignado ? r.asignado.nombre : "Nadie todavía: en unos minutos se asigna al primer admin activo."}</dd>
            </>
          )}
          {t && diaDeLaTransferencia && (
            <>
              <dt className={estilos.dato}>Referencia</dt>
              <dd className={estilos.valor}>{t.referencia}</dd>
              <dt className={estilos.dato}>Fecha de la transferencia</dt>
              <dd className={estilos.valor}>
                <time dateTime={diaDeLaTransferencia}>{formatearDia(diaDeLaTransferencia)}</time>
              </dd>
              <dt className={estilos.dato}>Registrado por</dt>
              <dd className={estilos.valor}>{r.registradoPor ? r.registradoPor.nombre : "Sin dato"}</dd>
            </>
          )}
          {llaveTransferida && (
            <>
              <dt className={estilos.dato}>Llave de quien pagó</dt>
              <dd className={`${estilos.valor} ${estilos.llave}`}>{llaveTransferida}</dd>
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

      {r.estadoVista === "esperando_llave" && (
        // Un formulario común, sin JavaScript ni confirmación: no se pierde nada y la base deja un solo reenvío en cola.
        <section aria-labelledby="reenviar" className={estilos.seccion}>
          <h2 id="reenviar" className={estilos.titulo}>
            ¿No le llegó el correo?
          </h2>
          <p id="reenviar-explicacion" className={estilos.explicacion}>
            Le volvemos a mandar el enlace a {r.contacto}. El plazo no cambia: sigue venciendo el{" "}
            <time dateTime={r.venceEn.toISOString()}>{formatearFechaHora(r.venceEn)}</time>.
          </p>
          <form action={reenviar}>
            <input type="hidden" name="id_reembolso" value={r.id} />
            <button type="submit" aria-describedby="reenviar-explicacion" className={formulario.botonSecundario}>
              Reenviar el enlace
            </button>
          </form>
        </section>
      )}

      {r.estadoVista === "cerrado" && (
        // Reabrir es P-10, fuera de alcance de HU-026: vive en la bandeja, que pg_cron alimenta cada 15 minutos.
        <p className={estilos.explicacion}>
          Si quien pagó te escribe, reábrelo desde “Cerrados sin llave”, en tu bandeja. Si acaba de vencer, puede tardar hasta 15 minutos
          en aparecer ahí.
        </p>
      )}

      {llaveParaTransferir && (
        <section aria-labelledby="transferir" className={estilos.seccion}>
          <h2 id="transferir" className={estilos.titulo}>
            Transferir {formatearPesos(r.monto)}
          </h2>
          <div className={formulario.campo}>
            <label htmlFor="llave-destino" className={formulario.etiqueta}>
              Llave de quien pagó
            </label>
            <p id="llave-ayuda" className={formulario.ayuda}>
              La que envió desde el enlace del correo. Revísala antes de transferir.
            </p>
            <input
              id="llave-destino"
              readOnly
              value={llaveParaTransferir}
              aria-describedby="llave-ayuda"
              className={`${formulario.entrada} ${estilos.llave}`}
            />
            <BotonCopiar texto={llaveParaTransferir} idCampo="llave-destino" />
          </div>
          <RegistrarTransferencia
            idReembolso={r.id}
            fechaMinima={r.fechaMinima}
            hoy={diaDelNegocio(new Date())}
            consecuencias={consecuenciasDeRegistrar(formatearPesos(r.monto), llaveParaTransferir)}
          />
        </section>
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
