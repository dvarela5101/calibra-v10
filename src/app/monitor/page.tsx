import type { Metadata } from "next";
import Link from "next/link";
import { BotonSalir } from "@/components/BotonSalir";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { separarAgenda, textoDeEstado, type MonitoriaDeAgenda } from "@/lib/agenda/reglas";
import { cargarAgenda } from "@/lib/agenda/servidor";
import { exigirRol } from "@/lib/auth/sesion";
import { TEXTOS } from "@/lib/diagnostico/vista-del-monitor";
import { diaDelNegocio, formatearDia, formatearDiaConSemana } from "@/lib/fechas";
import { horaCorta, horaDeFin } from "@/lib/franjas/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import estilos from "./monitor.module.css";

export const metadata: Metadata = { title: "Panel del monitor · Calibra" };

/** Lo que el panel toma de la agenda: cuántas por finalizar, cuántas próximas y cuál es la primera. */
type ResumenDeAgenda = { porFinalizar: number; proximas: number; proxima: MonitoriaDeAgenda | null };

/** Plural simple: «1 próxima», «2 próximas». */
const conteo = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

/**
 * HU-123 (D-89, D-93): el panel del monitor. De arriba abajo: el recordatorio de finalizar (HU-023), su próxima monitoría, cuatro
 * tarjetas con un dato de estado cada una, sus materias certificadas y «Salir». La llave de pago vive en el perfil. Nunca cifras de
 * comisión ni montos: la tarjeta de desembolsos no lee nada, porque la guarda de la comisión reserva esa lectura a su pantalla.
 */
export default async function PanelMonitor() {
  const sesion = await exigirRol("monitor", "/monitor");
  const supabase = await crearClienteServidor();
  const [{ data: monitor }, { data: certificados, error: errorCertificados }, { data: franjas, error: errorFranjas }] = await Promise.all([
    supabase!.from("monitor").select("nombre").eq("id", sesion.idUsuario).maybeSingle(),
    // HU-014: sus materias certificadas, con la fecha del certificado.
    supabase!
      .from("certificado")
      .select("id, fecha_emision, materia(nombre, codigo)")
      .eq("id_monitor", sesion.idUsuario)
      .order("fecha_emision", { ascending: true })
      .order("id", { ascending: true }),
    // Las franjas abiertas se cuentan como en «Mis franjas»: sin cierre, o con un cierre que aún no llega.
    supabase!.from("franja").select("id, cerrada_desde").eq("id_monitor", sesion.idUsuario),
  ]);
  if (errorCertificados) console.error("[monitor] no se pudieron leer los certificados:", errorCertificados.message);
  if (errorFranjas) console.error("[monitor] no se pudieron leer las franjas:", errorFranjas.message);

  // HU-023 (D-15) y HU-123: la agenda da el recordatorio y la próxima monitoría. Si no carga, esa tarjeta lo dice y el resto sigue.
  const agenda: ResumenDeAgenda | null = await cargarAgenda(supabase!)
    .then((monitorias) => {
      const { porFinalizar, proximas } = separarAgenda(monitorias, new Date());
      return { porFinalizar: porFinalizar.length, proximas: proximas.length, proxima: proximas[0] ?? null };
    })
    .catch((error: unknown) => {
      console.error("[monitor] no se pudo leer la agenda:", error instanceof Error ? error.message : error);
      return null;
    });
  const hoy = diaDelNegocio(new Date());
  const abiertas = errorFranjas ? null : (franjas ?? []).filter((f) => !f.cerrada_desde || f.cerrada_desde > hoy).length;

  // Si la lectura falló no se sabe si tiene certificados: ni la lista ni "aún no tienes".
  const conCertificados = !errorCertificados && Boolean(certificados?.length);
  const sinCertificados = !errorCertificados && !certificados?.length;
  const porFinalizar = agenda?.porFinalizar ?? 0;

  const tarjetas: { href: string; nombre: string; dato: string }[] = [];
  if (conCertificados) {
    tarjetas.push({
      href: "/monitor/agenda",
      nombre: "Mi agenda",
      dato: !agenda ? "Tus monitorías y cómo va su pago" : agenda.proximas === 0 ? "Sin monitorías próximas" : conteo(agenda.proximas, "próxima", "próximas"),
    });
    tarjetas.push({
      href: "/monitor/franjas",
      nombre: "Mis franjas",
      dato: abiertas === null ? "Las horas que abres cada semana" : abiertas === 0 ? "Ninguna abierta" : conteo(abiertas, "abierta", "abiertas"),
    });
    tarjetas.push({ href: "/monitor/desembolsos", nombre: "Mis desembolsos", dato: "Lo que has recibido y lo que viene" });
  }
  // HU-049: entra aunque todavía no tenga certificados.
  tarjetas.push({ href: "/monitor/perfil", nombre: "Mi perfil", dato: "Carrera, semestre, presentación y tu llave" });

  const proxima = agenda?.proxima ?? null;

  return (
    <Pantalla
      eyebrow="Panel del monitor"
      titulo={monitor ? `Hola, ${monitor.nombre}` : "Hola"}
      subtitulo={
        sinCertificados
          ? "Tu cuenta está lista. Espera a que un admin te certifique en tu materia: cuando lo haga, podrás abrir tus franjas y recibir estudiantes."
          : TEXTOS.panel
      }
    >
      {porFinalizar > 0 && (
        <div className={estilos.recordatorio}>
          <p role="status">
            {porFinalizar === 1
              ? "Tienes 1 monitoría por finalizar. Márcala como realizada en tu agenda; si no, se cierra sola."
              : `Tienes ${porFinalizar} monitorías por finalizar. Márcalas como realizadas en tu agenda; si no, se cierran solas.`}
          </p>
          <Link href="/monitor/agenda" className={`${formulario.enlace} ${estilos.accionDelRecordatorio}`}>
            {porFinalizar === 1 ? "Finalizarla ahora" : "Finalizarlas ahora"}
          </Link>
        </div>
      )}

      {errorCertificados && (
        <p role="alert" className={formulario.error}>
          No pudimos cargar tus materias certificadas. Recarga la página; si sigue igual, avisa al equipo.
        </p>
      )}

      {conCertificados && (
        <section aria-labelledby="proxima-monitoria" className={estilos.proxima}>
          <h2 id="proxima-monitoria" className={estilos.titulo}>
            Tu próxima monitoría
          </h2>
          {!agenda ? (
            <p role="alert" className={formulario.error}>
              No pudimos cargar tu agenda.
            </p>
          ) : proxima ? (
            <>
              <p id="cuando-es-la-proxima" className={estilos.cuando}>
                <time dateTime={proxima.fecha}>{formatearDiaConSemana(proxima.fecha)}</time>, {horaCorta(proxima.hora)} a{" "}
                {horaDeFin(proxima.hora, proxima.duracionMin)}
              </p>
              <p className={estilos.detalle}>
                {proxima.nombreMateria} · {proxima.presencial ? "Presencial" : "Virtual"}
              </p>
              <p className={estilos.detalle}>Agendó: {proxima.nombreEstudiante}</p>
              <p className={estilos.meta}>{textoDeEstado(proxima)}</p>
              <Link href="/monitor/agenda" aria-describedby="proxima-monitoria cuando-es-la-proxima" className={`${formulario.botonSecundario} ${estilos.boton}`}>
                Ver los detalles
              </Link>
            </>
          ) : (
            <>
              <p className={formulario.ayuda}>No tienes monitorías próximas.</p>
              <Link href="/monitor/franjas" className={`${formulario.botonSecundario} ${estilos.boton}`}>
                Abrir una franja
              </Link>
            </>
          )}
        </section>
      )}

      {sinCertificados && (
        <>
          <p role="status" className={formulario.ayuda}>
            Aún no tienes materias certificadas.
          </p>
          <ol className={estilos.pasos} aria-label="Tu avance">
            <li className={estilos.paso}>
              Cuenta creada <span className={estilos.meta}>· hecho</span>
            </li>
            <li className={`${estilos.paso} ${estilos.pasoActual}`} aria-current="step">
              Certificación pendiente <span className={estilos.meta}>· en este paso</span>
            </li>
            <li className={estilos.paso}>
              Abrir tus franjas <span className={estilos.meta}>· después</span>
            </li>
          </ol>
        </>
      )}

      <ul className={estilos.tarjetas}>
        {tarjetas.map((t) => (
          <li key={t.href} className={estilos.tarjeta}>
            <Link href={t.href} className={estilos.enlaceDeTarjeta}>
              {t.nombre}
            </Link>
            <p className={estilos.dato}>{t.dato}</p>
          </li>
        ))}
      </ul>

      {conCertificados && (
        <section aria-labelledby="materias-certificadas" className={estilos.seccion}>
          <h2 id="materias-certificadas" className={estilos.titulo}>
            Tus materias certificadas
          </h2>
          <ul className={estilos.lista}>
            {certificados!.map((c) => (
              <li key={c.id}>
                {c.materia ? `${c.materia.nombre} (${c.materia.codigo})` : "Materia"}
                <span className={estilos.meta}> · desde el {formatearDia(c.fecha_emision)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <BotonSalir />
    </Pantalla>
  );
}
