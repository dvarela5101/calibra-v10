import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { diaDelNegocio, formatearDia } from "@/lib/fechas";
import { horaCorta, horaDeFin, nombreDelDia } from "@/lib/franjas/reglas";
import { formatearPesos } from "@/lib/moneda";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { FormularioFranja } from "./FormularioFranja";
import estilos from "./franjas.module.css";

export const metadata: Metadata = { title: "Mis franjas · Calibra" };

/** HU-015: el monitor ve sus franjas semanales y abre otras (RN-30, P-31). */
export default async function MisFranjas({ searchParams }: PageProps<"/monitor/franjas">) {
  const sesion = await exigirRol("monitor", "/monitor/franjas");
  const { cerrada } = await searchParams;
  const supabase = await crearClienteServidor();
  // El lugar y el enlace no se leen de la tabla (P-31): los da acceso_a_mis_franjas(), solo de las propias.
  const [{ data: franjas, error }, { data: accesos }, { count: certificados }] = await Promise.all([
    supabase!
      .from("franja")
      .select("id, dia, hora, duracion_min, presencial, precio, cerrada_desde")
      .eq("id_monitor", sesion.idUsuario)
      .order("dia", { ascending: true })
      .order("hora", { ascending: true }),
    supabase!.rpc("acceso_a_mis_franjas"),
    supabase!.from("certificado").select("id", { count: "exact", head: true }).eq("id_monitor", sesion.idUsuario),
  ]);
  if (error) console.error("[franjas] no se pudieron leer las franjas:", error.message);
  const lugares = new Map((accesos ?? []).map((a) => [a.id_franja, a.lugar]));
  const hoy = diaDelNegocio(new Date());
  const abiertas = (franjas ?? []).filter((f) => !f.cerrada_desde || f.cerrada_desde > hoy);
  const cerradas = (franjas ?? []).filter((f) => f.cerrada_desde && f.cerrada_desde <= hoy);

  return (
    <Pantalla
      eyebrow="Panel del monitor"
      titulo="Mis franjas"
      subtitulo="Cada franja se repite todas las semanas. El estudiante elige la fecha y una de tus materias certificadas al agendar."
    >
      {error && (
        <p role="alert" className={formulario.error}>
          No pudimos cargar tus franjas. Recarga la página; si sigue igual, avisa al equipo.
        </p>
      )}

      {cerrada === "1" && (
        <p role="status" className={formulario.exito}>
          Cerraste la franja. Las monitorías que ya tenía se mantienen.
        </p>
      )}

      <section aria-labelledby="abiertas" className={estilos.seccion}>
        <h2 id="abiertas" className={estilos.titulo}>
          Abiertas ({abiertas.length})
        </h2>
        {abiertas.length === 0 ? (
          <p className={formulario.ayuda}>Todavía no tienes franjas abiertas.</p>
        ) : (
          <ul className={estilos.lista}>
            {abiertas.map((f) => (
              <li key={f.id}>
                <Link href={`/monitor/franjas/${f.id}`} className={estilos.tarjeta}>
                  <span className={estilos.cabeza}>
                    {nombreDelDia(f.dia)}, {horaCorta(f.hora)} a {horaDeFin(f.hora, f.duracion_min)}
                  </span>
                  <span className={estilos.detalle}>
                    {f.presencial ? `Presencial · ${lugares.get(f.id) ?? "sin lugar"}` : "Virtual"} · {formatearPesos(f.precio)}
                  </span>
                  {f.cerrada_desde && (
                    <span className={estilos.cerrada}>Se cierra desde el {formatearDia(f.cerrada_desde)}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="nueva" className={estilos.seccion}>
        <h2 id="nueva" className={estilos.titulo}>
          Abrir una franja
        </h2>
        {certificados ? (
          <FormularioFranja modo="abrir" />
        ) : (
          <p role="status" className={formulario.ayuda}>
            Para abrir franjas necesitas al menos un certificado. Un admin te certifica después de tu evaluación presencial.
          </p>
        )}
      </section>

      {cerradas.length > 0 && (
        <section aria-labelledby="cerradas" className={estilos.seccion}>
          <h2 id="cerradas" className={estilos.titulo}>
            Cerradas ({cerradas.length})
          </h2>
          <ul className={estilos.lista}>
            {cerradas.map((f) => (
              <li key={f.id} className={estilos.detalle}>
                {nombreDelDia(f.dia)}, {horaCorta(f.hora)} a {horaDeFin(f.hora, f.duracion_min)} · cerrada desde el{" "}
                {formatearDia(f.cerrada_desde!)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href="/monitor" className={formulario.enlace}>
        Volver a mi panel
      </Link>
    </Pantalla>
  );
}
